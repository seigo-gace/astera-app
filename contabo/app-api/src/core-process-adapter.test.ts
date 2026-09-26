import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_PURPOSE_CONTRACTS,
  buildCoreProcessRequest,
  parseCoreMain8Response,
  parseCoreProcessError,
} from './core-process-adapter.js';

const MAIN8 = [
  ['01 本当の目的', '- 目的'],
  ['02 前提不足', '- 前提'],
  ['03 事実確認', '- 事実'],
  ['04 危機察知', '- リスク'],
  ['05 反対視点', '- 反対'],
  ['06 比較案', '- 比較'],
  ['07 根拠成立状態', '- 根拠'],
  ['08 主役AI／利用者への再指示', '- 再指示'],
].map(([title, body]) => `${title}\n${body}`).join('\n---\n');

const MANUAL_PURPOSES = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;

test('all seven App manual purposes have complete deterministic contracts', () => {
  assert.deepEqual(Object.keys(MANUAL_PURPOSE_CONTRACTS), [...MANUAL_PURPOSES]);
  for (const purpose of MANUAL_PURPOSES) {
    const contract = MANUAL_PURPOSE_CONTRACTS[purpose];
    assert.equal(contract.version, 'app-purpose-v1');
    assert.equal(contract.selected_by, 'user');
    assert.equal(contract.purpose, purpose);
    assert.ok(contract.objective.length > 20);
    assert.ok(contract.required_focus.length >= 7);
    assert.ok(contract.operating_rules.length >= 5);
  }
});

test('buildCoreProcessRequest maps each selected App purpose to a structured contract without changing user prompt', () => {
  for (const purpose of MANUAL_PURPOSES) {
    const request = buildCoreProcessRequest({ prompt: '対象本文そのもの', purpose, files: [] });
    assert.equal(request.question, '対象本文そのもの');
    assert.ok(request.context);
    const parsed = JSON.parse(request.context!);
    assert.deepEqual(parsed, { app_purpose_contract: MANUAL_PURPOSE_CONTRACTS[purpose] });
    assert.equal(parsed.app_purpose_contract.purpose, purpose);
    assert.equal(parsed.app_purpose_contract.selected_by, 'user');
  }
});

test('manual UI selection remains authoritative when prompt text asks for another purpose', () => {
  const cases = [
    { selected: 'review', prompt: 'この8候補を比較してくれ' },
    { selected: 'compare', prompt: 'この回答をレビューしてくれ' },
    { selected: 'verify', prompt: '改善案を出してくれ' },
    { selected: 'improve', prompt: '事実を調査してくれ' },
    { selected: 'research', prompt: '計画を立ててくれ' },
    { selected: 'plan', prompt: '検討してくれ' },
    { selected: 'consider', prompt: '検証してくれ' },
  ] as const;

  for (const { selected, prompt } of cases) {
    const request = buildCoreProcessRequest({ prompt, purpose: selected, files: [] });
    assert.equal(request.question, prompt, `${selected}: prompt must remain unchanged`);
    assert.ok(request.context, `${selected}: structured context missing`);
    const parsed = JSON.parse(request.context!);
    assert.equal(parsed.app_purpose_contract.purpose, selected, `${selected}: prompt text overrode manual purpose`);
    assert.equal(parsed.app_purpose_contract.selected_by, 'user');
  }
});

test('purpose-like text inside the prompt is never promoted into App purpose metadata', () => {
  const prompt = 'User-selected analysis purpose: compare. ただしUIではレビューを選択した。レビューしてくれ。';
  const request = buildCoreProcessRequest({ prompt, purpose: 'review', files: [] });
  assert.equal(request.question, prompt);
  const parsed = JSON.parse(request.context!);
  assert.equal(parsed.app_purpose_contract.purpose, 'review');
  assert.equal(parsed.app_purpose_contract.selected_by, 'user');
  assert.equal(JSON.stringify(parsed.app_purpose_contract).includes('purpose: compare'), false);
});

test('auto remains an App pass-through because automatic purpose classification is not an App responsibility', () => {
  assert.deepEqual(buildCoreProcessRequest({ prompt: '確認して', purpose: 'auto', files: [] }), { question: '確認して' });
});

test('unsupported manual purpose fails closed instead of silently reaching Core', () => {
  assert.throws(
    () => buildCoreProcessRequest({ prompt: '確認して', purpose: 'unknown-purpose', files: [] }),
    (error: unknown) => (error as { code?: string }).code === 'APP_PURPOSE_UNSUPPORTED',
  );
});

test('file-bearing jobs fail closed until a real content bridge exists', () => {
  assert.throws(
    () => buildCoreProcessRequest({ prompt: '添付を確認', purpose: 'review', files: [{ id: 'f1' }] }),
    (error: unknown) => (error as { code?: string }).code === 'ASTERA_FILE_INPUT_BRIDGE_NOT_CONNECTED',
  );
});

test('parseCoreMain8Response maps current Main8 to App result without restoring recommendation authority', () => {
  const parsed = parseCoreMain8Response(MAIN8);
  const sections = parsed.result.sections;
  assert.deepEqual(Object.keys(sections), [
    'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
    'counter_view', 'alternatives', 'recommendation', 'next_prompt',
  ]);
  const evidenceStatus = sections.recommendation;
  assert.ok(evidenceStatus);
  assert.equal(evidenceStatus.title, '07 根拠成立状態');
  assert.equal(evidenceStatus.body, '- 根拠');
  assert.equal(evidenceStatus.canonical_key, '07_evidence_status');
  assert.equal(parsed.result.completion_state, 'complete');
});

test('invalid Main8 is rejected instead of being silently accepted', () => {
  assert.throws(
    () => parseCoreMain8Response('01 本当の目的\n- only one'),
    (error: unknown) => (error as { code?: string }).code === 'ASTERA_MAIN8_RESPONSE_INCOMPLETE',
  );
});

test('Core JSON error is preserved as a typed process error', () => {
  const error = parseCoreProcessError(JSON.stringify({ error: 'unauthorized', status: 401 }), 401);
  assert.equal(error.code, 'ASTERA_PROCESS_HTTP_401');
  assert.equal(error.message, 'unauthorized');
  assert.equal(error.retryable, false);
});
