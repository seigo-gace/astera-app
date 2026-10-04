import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

const QWEN = 'qwen3//models/Qwen3-8B-Q4_K_M.gguf';
const QWEN_RESPONSE = '/models/Qwen3-8B-Q4_K_M.gguf';
const GRANITE = 'granite//models/granite-4.2-8b-Q4_K_M.gguf';
const GRANITE_RESPONSE = '/models/granite-4.2-8b-Q4_K_M.gguf';
const vault = {} as VaultClient;
const MEANING = JSON.stringify({ detected_language: 'en', claims: ['same meaning'], constraints: [], conditions: [], entities: [], quantities: [], uncertainties: [] });

type RequestBody = { model: string; messages: Array<{ role: string; content: string }>; temperature: number; chat_template_kwargs: { enable_thinking: boolean } };
function body(init: RequestInit | undefined): RequestBody { return JSON.parse(String(init?.body)) as RequestBody; }
function user(request: RequestBody): string { return request.messages.find((item) => item.role === 'user')?.content ?? ''; }
function system(request: RequestBody): string { return request.messages.find((item) => item.role === 'system')?.content ?? ''; }
function translation(request: RequestBody): boolean { return request.model === QWEN && user(request).includes('BEGIN_BATCH'); }
function response(model: string, content: string): Response {
  return new Response(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
function pass(): string { return JSON.stringify({ equivalent: true, score: 1, target_language_match: true, critical_differences: [] }); }
async function env<T>(run: () => Promise<T>): Promise<T> {
  const oldOrigin = process.env.AI_CORE_BASE_URL; const oldKey = process.env.AI_CORE_API_KEY;
  process.env.AI_CORE_BASE_URL = 'http://127.0.0.1:18080'; process.env.AI_CORE_API_KEY = 'test-key';
  try { return await run(); } finally {
    if (oldOrigin === undefined) delete process.env.AI_CORE_BASE_URL; else process.env.AI_CORE_BASE_URL = oldOrigin;
    if (oldKey === undefined) delete process.env.AI_CORE_API_KEY; else process.env.AI_CORE_API_KEY = oldKey;
  }
}

test('batches all sections, protects critical values, and uses independent Qwen+Granite semantic validation', async () => env(async () => {
  const original = globalThis.fetch; const requests: RequestBody[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:18080/v1/chat/completions');
    const request = body(init); requests.push(request); assert.equal(request.temperature, 0); assert.equal(request.chat_template_kwargs.enable_thinking, false);
    if (translation(request)) {
      const content = user(request); assert.match(content, /__ASTERA_SECTION_000000_BEGIN__/); assert.match(content, /__ASTERA_SECTION_000001_BEGIN__/);
      assert.doesNotMatch(content, /2026-12-31|\$125\.50|v8\.4\.1|https:\/\/example\.com|`const x = 1`/);
      const batch = content.match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? '';
      return response(QWEN_RESPONSE, batch.replace('Hello', 'こんにちは').replace('World', '世界'));
    }
    if (request.model === QWEN) {
      assert.match(system(request), /untrusted data/);
      return response(QWEN_RESPONSE, MEANING);
    }
    assert.equal(request.model, GRANITE); assert.match(system(request), /untrusted data/); assert.match(user(request), /TARGET_LANGUAGE=ja/);
    return response(GRANITE_RESPONSE, pass());
  };
  try {
    const input = { result: { sections: [
      { title: '固定1', body: '# Hello\nKeep 2026-12-31 $125.50 USD v8.4.1 https://example.com `const x = 1`' },
      { title: '固定2', body: '- World\n- UUID 550e8400-e29b-41d4-a716-446655440000 95%' },
    ] } };
    const output = await translateAsteraResult(input, 'ja', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 });
    const result = output.result as typeof input;
    assert.match(result.result.sections[0]!.body, /こんにちは.*2026-12-31.*\$125\.50 USD.*v8\.4\.1.*https:\/\/example\.com.*`const x = 1`/s);
    assert.match(result.result.sections[1]!.body, /世界.*550e8400-e29b-41d4-a716-446655440000.*95%/s);
    assert.equal(requests.filter(translation).length, 1); assert.equal(requests.filter((item) => item.model === QWEN && !translation(item)).length, 2); assert.equal(requests.filter((item) => item.model === GRANITE).length, 1);
    assert.equal(output.usage.calls, 4); assert.equal(output.usage.validationModel, GRANITE); assert.equal(output.usage.semanticValidations, 1); assert.equal(output.usage.externalApiCalls, 0);
  } finally { globalThis.fetch = original; }
}));

test('semantic mismatch retries from original batch and passes only after second independent verdict', async () => env(async () => {
  const original = globalThis.fetch; let translations = 0; let verdicts = 0;
  globalThis.fetch = async (_input, init) => {
    const request = body(init);
    if (translation(request)) {
      translations += 1; const content = user(request); const batch = content.match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? '';
      if (translations === 1) return response(QWEN_RESPONSE, batch.replace('Do not publish', 'Publish'));
      assert.match(content, /STRATEGY=semantic_retry/); assert.match(content, /negation removed/);
      return response(QWEN_RESPONSE, batch.replace('Do not publish', '公開しないでください'));
    }
    if (request.model === QWEN) return response(QWEN_RESPONSE, MEANING);
    verdicts += 1;
    return response(GRANITE_RESPONSE, verdicts === 1
      ? JSON.stringify({ equivalent: false, score: 0.6, target_language_match: true, critical_differences: ['negation removed'] })
      : pass());
  };
  try {
    const output = await translateAsteraResult({ result: { sections: [{ body: 'Do not publish' }, { body: 'Keep v8.4.1' }] } }, 'ja', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 });
    assert.equal((output.result as { result: { sections: Array<{ body: string }> } }).result.sections[0]!.body, '公開しないでください');
    assert.equal(translations, 2); assert.equal(verdicts, 2); assert.equal(output.usage.calls, 7); assert.equal(output.usage.semanticRetries, 1); assert.equal(output.usage.semanticValidations, 2);
  } finally { globalThis.fetch = original; }
}));

test('target-language mismatch retries even when meaning is equivalent', async () => env(async () => {
  const original = globalThis.fetch; let translations = 0; let verdicts = 0;
  globalThis.fetch = async (_input, init) => {
    const request = body(init);
    if (translation(request)) {
      translations += 1; const content = user(request); const batch = content.match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? '';
      if (translations === 2) assert.match(content, /requested target language sw/);
      return response(QWEN_RESPONSE, batch);
    }
    if (request.model === QWEN) return response(QWEN_RESPONSE, MEANING);
    verdicts += 1;
    return response(GRANITE_RESPONSE, verdicts === 1
      ? JSON.stringify({ equivalent: true, score: 1, target_language_match: false, critical_differences: [] })
      : pass());
  };
  try {
    const output = await translateAsteraResult({ result: { sections: [{ body: 'Keep backups.' }] } }, 'sw', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 });
    assert.equal(translations, 2); assert.equal(verdicts, 2); assert.equal(output.usage.semanticRetries, 1);
  } finally { globalThis.fetch = original; }
}));

test('fails closed after second semantic mismatch', async () => env(async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = body(init);
    if (translation(request)) { const batch = user(request).match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? ''; return response(QWEN_RESPONSE, batch); }
    if (request.model === QWEN) return response(QWEN_RESPONSE, MEANING);
    return response(GRANITE_RESPONSE, JSON.stringify({ equivalent: false, score: 0.5, target_language_match: true, critical_differences: ['material meaning differs'] }));
  };
  try {
    await assert.rejects(() => translateAsteraResult({ result: { sections: [{ body: 'Never delete backups.' }] } }, 'sw', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }), (error: unknown) => (error as { code?: string }).code === 'TRANSLATION_SEMANTIC_EQUIVALENCE_FAILED');
  } finally { globalThis.fetch = original; }
}));

test('structure corruption triggers one whole-batch line-preserving fallback', async () => env(async () => {
  const original = globalThis.fetch; let translations = 0;
  globalThis.fetch = async (_input, init) => {
    const request = body(init);
    if (translation(request)) {
      translations += 1; const content = user(request); const batch = content.match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? '';
      if (translations === 1) return response(QWEN_RESPONSE, `${batch}\nBROKEN`);
      assert.match(content, /STRATEGY=lines/); return response(QWEN_RESPONSE, batch.replace('Hello', 'こんにちは'));
    }
    if (request.model === QWEN) return response(QWEN_RESPONSE, MEANING);
    return response(GRANITE_RESPONSE, pass());
  };
  try {
    const output = await translateAsteraResult({ result: { sections: [{ body: '# Hello' }] } }, 'ja', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 });
    assert.equal(translations, 2); assert.equal(output.usage.calls, 5); assert.equal(output.usage.validationFallbacks, 1);
  } finally { globalThis.fetch = original; }
}));

test('rejects non-loopback AI Core before network access', async () => {
  const original = globalThis.fetch; const oldOrigin = process.env.AI_CORE_BASE_URL; const oldKey = process.env.AI_CORE_API_KEY; let calls = 0;
  process.env.AI_CORE_BASE_URL = 'https://ai.example.com'; process.env.AI_CORE_API_KEY = 'test-key'; globalThis.fetch = async () => { calls += 1; throw new Error('no'); };
  try {
    await assert.rejects(() => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }), (error: unknown) => (error as { code?: string }).code === 'TRANSLATION_AI_CORE_LOCAL_ONLY'); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; if (oldOrigin === undefined) delete process.env.AI_CORE_BASE_URL; else process.env.AI_CORE_BASE_URL = oldOrigin; if (oldKey === undefined) delete process.env.AI_CORE_API_KEY; else process.env.AI_CORE_API_KEY = oldKey; }
});

test('fails closed when Granite response identity is not exact', async () => env(async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = body(init); if (translation(request)) { const batch = user(request).match(/BEGIN_BATCH\n([\s\S]*)\nEND_BATCH$/)?.[1] ?? ''; return response(QWEN_RESPONSE, batch); }
    if (request.model === QWEN) return response(QWEN_RESPONSE, MEANING); return response(QWEN_RESPONSE, pass());
  };
  try {
    await assert.rejects(() => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', vault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }), (error: unknown) => (error as { code?: string }).code === 'TRANSLATION_MODEL_IDENTITY_MISMATCH');
  } finally { globalThis.fetch = original; }
}));
