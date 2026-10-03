import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

const MODEL_ID = 'google/madlad400-3b-mt';
const MODEL_REVISION = 'fa184c675da0b5c9e1c8694fccd4e12e2d422094';
const fakeVault = {} as VaultClient;

type RequestBody = { texts: string[]; target_language: string; strategy: 'document' | 'lines' };

function engineResponse(translations: string[], extras: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    translations,
    model: MODEL_ID,
    model_revision: MODEL_REVISION,
    target_language: 'ja',
    strategy_used: 'document',
    external_api_calls: 0,
    input_tokens: 12,
    output_tokens: 8,
    ...extras,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function withRuntimeEnv<T>(run: () => Promise<T>): Promise<T> {
  const previousOrigin = process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN;
  const previousToken = process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN;
  process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN = 'http://127.0.0.1:8792';
  process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN = 'unit-test-local-translation-token';
  try {
    return await run();
  } finally {
    if (previousOrigin === undefined) delete process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN;
    else process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN;
    else process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN = previousToken;
  }
}

test('translation runtime uses only the local MADLAD engine and preserves protected values', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestBody[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:8792/v1/translate');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer unit-test-local-translation-token');
    assert.equal(headers.get('content-type'), 'application/json');
    const body = JSON.parse(String(init?.body)) as RequestBody;
    requests.push(body);
    assert.equal(body.strategy, 'document');
    assert.equal(body.target_language, 'ja-JP');
    const source = body.texts[0] ?? '';
    assert.doesNotMatch(source, /https:\/\/example\.com/);
    assert.doesNotMatch(source, /`const x = 1`/);
    assert.doesNotMatch(source, /2026-10-03/);
    return engineResponse([source.replace('Hello', 'こんにちは').replace('World', '世界')]);
  };
  try {
    const input = {
      result: {
        sections: [
          { key: 'true_purpose', title: '固定タイトル', body: '# Hello\nWorld https://example.com `const x = 1` 2026-10-03' },
        ],
      },
    };
    const output = await translateAsteraResult(input, 'ja-JP', fakeVault, { modelId: 'legacy-value-is-ignored', apiKeyRef: '', timeoutMs: 30_000 });
    const result = output.result as typeof input;
    assert.equal(result.result.sections[0]?.title, '固定タイトル');
    assert.equal(result.result.sections[0]?.body, '# こんにちは\n世界 https://example.com `const x = 1` 2026-10-03');
    assert.equal(requests.length, 1);
    assert.equal(output.usage.provider, 'local_madlad400');
    assert.equal(output.usage.model, MODEL_ID);
    assert.equal(output.usage.modelRevision, MODEL_REVISION);
    assert.equal(output.usage.externalApiCalls, 0);
    assert.equal(output.usage.validationFallbacks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));

test('translation runtime falls back to same-model line strategy when document structure changes', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  const strategies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    strategies.push(body.strategy);
    const source = body.texts[0] ?? '';
    if (body.strategy === 'document') return engineResponse([`${source}\nBROKEN-LINE`]);
    return engineResponse([source.replace('Hello', 'こんにちは')], { strategy_used: 'lines', input_tokens: 9, output_tokens: 6 });
  };
  try {
    const output = await translateAsteraResult(
      { result: { sections: [{ key: 'true_purpose', body: '# Hello' }] } },
      'ja-JP',
      fakeVault,
      { modelId: '', apiKeyRef: '', timeoutMs: 30_000 },
    );
    assert.deepEqual(strategies, ['document', 'lines']);
    assert.equal(output.usage.calls, 2);
    assert.equal(output.usage.validationFallbacks, 1);
    assert.equal(output.usage.inputTokens, 21);
    assert.equal(output.usage.outputTokens, 14);
    const result = output.result as { result: { sections: Array<{ body: string }> } };
    assert.equal(result.result.sections[0]?.body, '# こんにちは');
  } finally {
    globalThis.fetch = originalFetch;
  }
}));

test('translation runtime rejects any non-loopback translation origin before network access', async () => {
  const originalFetch = globalThis.fetch;
  const previousOrigin = process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN;
  const previousToken = process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN;
  process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN = 'https://translation.example.com';
  process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN = 'unit-test-local-translation-token';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not be reached');
  };
  try {
    await assert.rejects(
      () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TRANSLATION_ENGINE_LOCAL_ONLY');
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN;
    else process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN;
    else process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN = previousToken;
  }
});

test('translation runtime fails closed when engine identity differs from the pinned model revision', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => engineResponse(['こんにちは'], { model_revision: 'unexpected-revision' });
  try {
    await assert.rejects(
      () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TRANSLATION_MODEL_IDENTITY_MISMATCH');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}));
