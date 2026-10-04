import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

const MODEL_ID = 'qwen3//models/Qwen3-8B-Q4_K_M.gguf';
const MODEL_RESPONSE_ID = '/models/Qwen3-8B-Q4_K_M.gguf';
const fakeVault = {} as VaultClient;

type ChatRequestBody = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  max_tokens: number;
  chat_template_kwargs: { enable_thinking: boolean };
};

function aiCoreResponse(content: string, extras: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model: MODEL_RESPONSE_ID,
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
    ...extras,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function withRuntimeEnv<T>(run: () => Promise<T>): Promise<T> {
  const previousOrigin = process.env.AI_CORE_BASE_URL;
  const previousKey = process.env.AI_CORE_API_KEY;
  process.env.AI_CORE_BASE_URL = 'http://127.0.0.1:18080';
  process.env.AI_CORE_API_KEY = 'unit-test-ai-core-key';
  try {
    return await run();
  } finally {
    if (previousOrigin === undefined) delete process.env.AI_CORE_BASE_URL;
    else process.env.AI_CORE_BASE_URL = previousOrigin;
    if (previousKey === undefined) delete process.env.AI_CORE_API_KEY;
    else process.env.AI_CORE_API_KEY = previousKey;
  }
}

function requestBody(init: RequestInit | undefined): ChatRequestBody {
  return JSON.parse(String(init?.body)) as ChatRequestBody;
}

function protectedBody(body: ChatRequestBody): string {
  const user = body.messages.find((item) => item.role === 'user');
  return user?.content ?? '';
}

test('translation runtime uses only local AI Core Qwen3 and preserves protected values', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  const requests: ChatRequestBody[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:18080/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer unit-test-ai-core-key');
    assert.equal(headers.get('content-type'), 'application/json');
    const body = requestBody(init);
    requests.push(body);
    assert.equal(body.model, MODEL_ID);
    assert.equal(body.temperature, 0);
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.match(protectedBody(body), /STRATEGY=document/);
    assert.doesNotMatch(protectedBody(body), /https:\/\/example\.com/);
    assert.doesNotMatch(protectedBody(body), /`const x = 1`/);
    assert.doesNotMatch(protectedBody(body), /2026-10-03/);
    const source = protectedBody(body).match(/BEGIN_BODY\n([\s\S]*)\nEND_BODY$/)?.[1] ?? '';
    return aiCoreResponse(source.replace('Hello', 'こんにちは').replace('World', '世界'));
  };
  try {
    const input = {
      result: {
        sections: [
          { key: 'true_purpose', title: '固定タイトル', body: '# Hello\nWorld https://example.com `const x = 1` 2026-10-03' },
        ],
      },
    };
    const output = await translateAsteraResult(input, 'ja-JP', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 });
    const result = output.result as typeof input;
    assert.equal(result.result.sections[0]?.title, '固定タイトル');
    assert.equal(result.result.sections[0]?.body, '# こんにちは\n世界 https://example.com `const x = 1` 2026-10-03');
    assert.equal(requests.length, 1);
    assert.equal(output.usage.provider, 'ai_core_qwen3');
    assert.equal(output.usage.model, MODEL_ID);
    assert.equal(output.usage.externalApiCalls, 0);
    assert.equal(output.usage.validationFallbacks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));

test('translation runtime falls back to same Qwen3 model with line-preserving strategy', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  const strategies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = requestBody(init);
    assert.equal(body.model, MODEL_ID);
    const user = protectedBody(body);
    const strategy = user.includes('STRATEGY=lines') ? 'lines' : 'document';
    strategies.push(strategy);
    const source = user.match(/BEGIN_BODY\n([\s\S]*)\nEND_BODY$/)?.[1] ?? '';
    if (strategy === 'document') return aiCoreResponse(`${source}\nBROKEN-LINE`);
    return aiCoreResponse(source.replace('Hello', 'こんにちは'), { usage: { prompt_tokens: 9, completion_tokens: 6 } });
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

test('translation runtime rejects non-loopback AI Core origin before network access', async () => {
  const originalFetch = globalThis.fetch;
  const previousOrigin = process.env.AI_CORE_BASE_URL;
  const previousKey = process.env.AI_CORE_API_KEY;
  process.env.AI_CORE_BASE_URL = 'https://ai.example.com';
  process.env.AI_CORE_API_KEY = 'unit-test-ai-core-key';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not be reached');
  };
  try {
    await assert.rejects(
      () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TRANSLATION_AI_CORE_LOCAL_ONLY');
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.AI_CORE_BASE_URL;
    else process.env.AI_CORE_BASE_URL = previousOrigin;
    if (previousKey === undefined) delete process.env.AI_CORE_API_KEY;
    else process.env.AI_CORE_API_KEY = previousKey;
  }
});

test('translation runtime fails closed when AI Core reports a different model', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => aiCoreResponse('こんにちは', { model: '/models/granite-4.2-8b-Q4_K_M.gguf' });
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

test('translation runtime fails closed when AI Core omits model identity', async () => withRuntimeEnv(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => aiCoreResponse('こんにちは', { model: undefined });
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

test('translation runtime requires AI Core API key', async () => {
  const previousOrigin = process.env.AI_CORE_BASE_URL;
  const previousKey = process.env.AI_CORE_API_KEY;
  process.env.AI_CORE_BASE_URL = 'http://127.0.0.1:18080';
  delete process.env.AI_CORE_API_KEY;
  try {
    await assert.rejects(
      () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TRANSLATION_AI_CORE_KEY_NOT_CONFIGURED');
        return true;
      },
    );
  } finally {
    if (previousOrigin === undefined) delete process.env.AI_CORE_BASE_URL;
    else process.env.AI_CORE_BASE_URL = previousOrigin;
    if (previousKey === undefined) delete process.env.AI_CORE_API_KEY;
    else process.env.AI_CORE_API_KEY = previousKey;
  }
});
