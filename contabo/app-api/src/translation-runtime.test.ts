import assert from 'node:assert/strict';
import test from 'node:test';
import { translateAsteraResult } from './translation-runtime.js';
import type { VaultClient } from './vault-client.js';

const baseConfig = { modelId: 'configured-model', apiKeyRef: 'vault-ref', timeoutMs: 30_000 };

function fakeVault(translator: (source: string) => string): VaultClient {
  return {
    providerJson: async (input: { body?: unknown }) => {
      const body = input.body as { contents: Array<{ parts: Array<{ text: string }> }> };
      const requestText = body.contents[0]?.parts[0]?.text ?? '';
      const source = requestText.replace(/^TARGET_LANGUAGE=.*?\nBEGIN_BODY\n/s, '').replace(/\nEND_BODY$/s, '');
      const translated = translator(source);
      return {
        response: { status: 200, ok: true, body: '{}' },
        payload: {
          candidates: [{ content: { parts: [{ text: translated }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      };
    },
  } as unknown as VaultClient;
}

function errorCode(error: unknown): string {
  return (error as Error & { code?: string }).code ?? '';
}

test('translation runtime translates section bodies only and preserves protected values', async () => {
  const vault = fakeVault((source) => source.replace('Hello', 'こんにちは').replace('World', '世界'));
  const input = {
    result: {
      sections: [
        { key: 'true_purpose', title: '固定タイトル', body: '# Hello\nWorld https://example.com `const x = 1`' },
      ],
    },
  };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  assert.equal(result.result.sections[0]?.title, '固定タイトル');
  assert.equal(result.result.sections[0]?.body, '# こんにちは\n世界 https://example.com `const x = 1`');
  assert.equal(output.usage.calls, 1);
  assert.equal(output.usage.totalTokens, 15);
});

test('empty body is not translated and calls stay zero', async () => {
  let calls = 0;
  const vault = {
    providerJson: async () => {
      calls += 1;
      throw new Error('provider must not be called');
    },
  } as unknown as VaultClient;
  const input = {
    result: {
      sections: [{ key: 'true_purpose', title: '固定タイトル', body: '   ' }],
    },
  };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  assert.equal(result.result.sections[0]?.body, '   ');
  assert.equal(calls, 0);
  assert.equal(output.usage.calls, 0);
});

test('target language is required', async () => {
  const vault = fakeVault((source) => source);
  await assert.rejects(
    () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, '  ', vault, baseConfig),
    (error: unknown) => errorCode(error) === 'TARGET_LANGUAGE_REQUIRED',
  );
});

test('translation provider must be configured', async () => {
  const vault = fakeVault((source) => source);
  await assert.rejects(
    () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja-JP', vault, { ...baseConfig, modelId: '' }),
    (error: unknown) => errorCode(error) === 'TRANSLATION_PROVIDER_NOT_CONFIGURED',
  );
  await assert.rejects(
    () => translateAsteraResult({ result: { sections: [{ body: 'Hello' }] } }, 'ja-JP', vault, { ...baseConfig, apiKeyRef: '' }),
    (error: unknown) => errorCode(error) === 'TRANSLATION_PROVIDER_NOT_CONFIGURED',
  );
});

test('protected tokens for URL and inline code are restored after translation', async () => {
  const vault = fakeVault((source) => source.replace('Greeting', '挨拶'));
  const input = {
    result: {
      sections: [{ body: 'Greeting https://example.com/path `inline code`' }],
    },
  };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  assert.equal(result.result.sections[0]?.body, '挨拶 https://example.com/path `inline code`');
  assert.equal(output.usage.calls, 1);
});

test('non-body fields such as title are not translated', async () => {
  const vault = fakeVault((source) => source.replace('Body', '本文'));
  const input = {
    result: {
      sections: [{ key: 'true_purpose', title: 'Title should stay', body: 'Body text' }],
    },
  };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  assert.equal(result.result.sections[0]?.title, 'Title should stay');
  assert.equal(result.result.sections[0]?.body, '本文 text');
  assert.equal(output.usage.calls, 1);
});

test('all protected token kinds survive translation unchanged', async () => {
  const body = [
    'Intro sentence',
    '```',
    'const fenced = 1;',
    '```',
    'Use `inline code` carefully',
    'See https://example.com/docs for details',
    'Hello {{user_name}}',
    'Value is ${env_var}',
    'Legacy <% template %> marker',
    'Outro sentence',
  ].join('\n');
  const vault = fakeVault((source) => source.replace('Intro sentence', '導入文').replace('Outro sentence', '結び'));
  const input = { result: { sections: [{ body }] } };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  const translated = result.result.sections[0]?.body ?? '';
  assert.equal(translated.includes('```\nconst fenced = 1;\n```'), true);
  assert.equal(translated.includes('`inline code`'), true);
  assert.equal(translated.includes('https://example.com/docs'), true);
  assert.equal(translated.includes('{{user_name}}'), true);
  assert.equal(translated.includes('${env_var}'), true);
  assert.equal(translated.includes('<% template %>'), true);
  assert.equal(translated.startsWith('導入文'), true);
  assert.equal(translated.endsWith('結び'), true);
  assert.equal(output.usage.calls, 1);
});

test('structure validation failure rejects malformed translation output', async () => {
  const vault = fakeVault((source) => `${source}\nextra line breaks structure`);
  const input = { result: { sections: [{ body: 'Line one\nLine two' }] } };
  await assert.rejects(
    () => translateAsteraResult(input, 'ja-JP', vault, baseConfig),
    (error: unknown) => errorCode(error) === 'TRANSLATION_STRUCTURE_DIFF_FAILED',
  );
});

test('retries once after provider failure and succeeds on second attempt', async () => {
  let providerCalls = 0;
  const vault = {
    providerJson: async (input: { body?: unknown }) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        throw Object.assign(new Error('Gemini returned no translation text.'), { code: 'TRANSLATION_PROVIDER_EMPTY', retryable: true });
      }
      const body = input.body as { contents: Array<{ parts: Array<{ text: string }> }> };
      const requestText = body.contents[0]?.parts[0]?.text ?? '';
      const source = requestText.replace(/^TARGET_LANGUAGE=.*?\nBEGIN_BODY\n/s, '').replace(/\nEND_BODY$/s, '');
      return {
        response: { status: 200, ok: true, body: '{}' },
        payload: {
          candidates: [{ content: { parts: [{ text: source.replace('Retry', '再試行') }] } }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
        },
      };
    },
  } as unknown as VaultClient;
  const input = { result: { sections: [{ body: 'Retry message' }] } };
  const output = await translateAsteraResult(input, 'ja-JP', vault, baseConfig);
  const result = output.result as typeof input;
  assert.equal(providerCalls, 2);
  assert.equal(result.result.sections[0]?.body, '再試行 message');
  assert.equal(output.usage.calls, 1);
});

test('stops after two failed provider attempts', async () => {
  let providerCalls = 0;
  const vault = {
    providerJson: async () => {
      providerCalls += 1;
      throw Object.assign(new Error('Gemini returned no translation text.'), { code: 'TRANSLATION_PROVIDER_EMPTY', retryable: true });
    },
  } as unknown as VaultClient;
  const input = { result: { sections: [{ body: 'Will fail twice' }] } };
  await assert.rejects(
    () => translateAsteraResult(input, 'ja-JP', vault, baseConfig),
    (error: unknown) => errorCode(error) === 'TRANSLATION_PROVIDER_EMPTY',
  );
  assert.equal(providerCalls, 2);
});
