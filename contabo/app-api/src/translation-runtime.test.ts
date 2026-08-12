import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

test('translation runtime translates section bodies only and preserves protected values', async () => {
  const fakeVault = {
    providerJson: async (input: { body?: unknown }) => {
      const body = input.body as { contents: Array<{ parts: Array<{ text: string }> }> };
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
});
