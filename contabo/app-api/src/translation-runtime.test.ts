import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

type ProviderInput = {
  secretId: string;
  consumer: string;
  url: string;
  secretHeader: string;
  headers?: Record<string, string>;
  body?: unknown;
};

test('translation runtime translates section bodies only and preserves protected values', async () => {
  let providerInput: ProviderInput | null = null;
  const fakeVault = {
    providerJson: async (input: ProviderInput) => {
      providerInput = input;
      const body = input.body as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig?: { temperature?: number; responseMimeType?: string };
      };
      const requestText = body.contents[0]?.parts[0]?.text ?? '';
      const source = requestText.replace(/^TARGET_LANGUAGE=.*?\nBEGIN_BODY\n/s, '').replace(/\nEND_BODY$/s, '');
      const translated = source.replace('Hello', 'こんにちは').replace('World', '世界');
      return {
        response: { status: 200, ok: true, body: '{}' },
        payload: {
          candidates: [{ content: { parts: [{ text: translated }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      };
    },
  } as unknown as VaultClient;
  const input = {
    result: {
      sections: [
        { key: 'true_purpose', title: '固定タイトル', body: '# Hello\nWorld https://example.com `const x = 1`' },
      ],
    },
  };
  const output = await translateAsteraResult(input, 'ja-JP', fakeVault, { modelId: 'configured-model', apiKeyRef: 'vault-ref', timeoutMs: 30_000 });
  const result = output.result as typeof input;
  assert.equal(result.result.sections[0]?.title, '固定タイトル');
  assert.equal(result.result.sections[0]?.body, '# こんにちは\n世界 https://example.com `const x = 1`');
  assert.equal(output.usage.calls, 1);
  assert.equal(output.usage.totalTokens, 15);

  assert.ok(providerInput);
  assert.equal(providerInput.secretId, 'vault-ref');
  assert.equal(providerInput.consumer, 'translation-flash-lite');
  assert.equal(providerInput.secretHeader, 'x-goog-api-key');
  assert.equal(providerInput.url, 'https://generativelanguage.googleapis.com/v1beta/models/configured-model:generateContent');
  assert.equal(providerInput.headers?.['content-type'], 'application/json');
  const providerBody = providerInput.body as {
    systemInstruction?: { parts?: Array<{ text?: string }> };
    generationConfig?: { temperature?: number; responseMimeType?: string };
  };
  const policy = providerBody.systemInstruction?.parts?.[0]?.text ?? '';
  assert.match(policy, /translation-only runtime/i);
  assert.match(policy, /Never summarize/);
  assert.match(policy, /Preserve headings, paragraphs, lists, tables, code, URLs, numbers, placeholders, line breaks, order, and information quantity/);
  assert.equal(providerBody.generationConfig?.temperature, 0);
  assert.equal(providerBody.generationConfig?.responseMimeType, 'text/plain');
});

test('translation runtime fails closed when Gemini provider profile is not configured', async () => {
  const fakeVault = { providerJson: async () => { throw new Error('provider must not be called'); } } as unknown as VaultClient;
  await assert.rejects(
    () => translateAsteraResult({ result: { sections: [] } }, 'ja-JP', fakeVault, { modelId: '', apiKeyRef: '', timeoutMs: 30_000 }),
    (error: unknown) => {
      const source = error as Error & { code?: string };
      assert.equal(source.code, 'TRANSLATION_PROVIDER_NOT_CONFIGURED');
      return true;
    },
  );
});
