import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoreProcessRequest, parseCoreMain8Response, parseCoreProcessError } from './core-process-adapter.js';

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

test('buildCoreProcessRequest maps App prompt and selected purpose to current Core contract', () => {
  assert.deepEqual(buildCoreProcessRequest({ prompt: '比較して', purpose: 'compare', files: [] }), {
    question: '比較して',
    context: 'User-selected analysis purpose: compare. Preserve this as analysis intent; do not treat it as evidence.',
  });
  assert.deepEqual(buildCoreProcessRequest({ prompt: '確認して', purpose: 'auto', files: [] }), { question: '確認して' });
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
