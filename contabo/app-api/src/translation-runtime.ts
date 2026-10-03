import type { VaultClient } from './vault-client.js';

type TranslationRuntimeConfig = {
  // Kept for RuntimeConfig ABI compatibility while the local engine is introduced.
  // The translation model is intentionally fixed below and this value is never used
  // to select a remote provider.
  modelId: string;
  apiKeyRef: string;
  timeoutMs: number;
};

type TranslationStrategy = 'document' | 'lines';

type EnginePayload = {
  translations?: unknown;
  model?: unknown;
  model_revision?: unknown;
  target_language?: unknown;
  strategy_used?: unknown;
  external_api_calls?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  code?: unknown;
  message?: unknown;
};

type TranslationUsage = {
  provider: 'local_madlad400';
  model: string;
  modelRevision: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  externalApiCalls: 0;
  validationFallbacks: number;
  targetLanguage: string;
};

type TranslationOutcome = { result: unknown; usage: TranslationUsage };

type EngineResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

const MODEL_ID = 'google/madlad400-3b-mt';
const MODEL_REVISION = 'fa184c675da0b5c9e1c8694fccd4e12e2d422094';
const DEFAULT_ENGINE_ORIGIN = 'http://127.0.0.1:8792';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function codedError(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function translationEngineOrigin(): string {
  const configured = process.env.ASTERA_TRANSLATION_ENGINE_ORIGIN?.trim() || DEFAULT_ENGINE_ORIGIN;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw codedError('TRANSLATION_ENGINE_ORIGIN_INVALID', 'Local translation engine origin is invalid.');
  }
  const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (!loopback.has(url.hostname)) {
    throw codedError('TRANSLATION_ENGINE_LOCAL_ONLY', 'Translation engine must be loopback-local; remote translation providers are forbidden.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw codedError('TRANSLATION_ENGINE_ORIGIN_INVALID', 'Translation engine origin must use HTTP or HTTPS.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function translationEngineToken(): string {
  const token = process.env.ASTERA_TRANSLATION_INTERNAL_TOKEN?.trim() || '';
  if (!token) throw codedError('TRANSLATION_ENGINE_TOKEN_NOT_CONFIGURED', 'Local translation engine token is not configured.');
  return token;
}

async function requestEngine(source: string, targetLanguage: string, strategy: TranslationStrategy, timeoutMs: number): Promise<EngineResult> {
  const origin = translationEngineOrigin();
  const token = translationEngineToken();
  const controller = new AbortController();
  const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.trunc(timeoutMs)) : 90_000;
  const timer = setTimeout(() => controller.abort('translation_timeout'), safeTimeout);
  try {
    let response: Response;
    try {
      response = await fetch(`${origin}/v1/translate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ texts: [source], target_language: targetLanguage, strategy }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw codedError('TRANSLATION_ENGINE_TIMEOUT', 'Local translation engine timed out.', true);
      }
      throw codedError('TRANSLATION_ENGINE_UNREACHABLE', error instanceof Error ? error.message : 'Local translation engine is unreachable.', true);
    }

    const payload = await response.json().catch(() => ({})) as EnginePayload;
    if (!response.ok) {
      const code = text(payload.code) || 'TRANSLATION_ENGINE_FAILED';
      const message = text(payload.message) || `Local translation engine returned HTTP ${response.status}.`;
      throw codedError(code, message, response.status === 429 || response.status >= 500);
    }
    if (text(payload.model) !== MODEL_ID || text(payload.model_revision) !== MODEL_REVISION) {
      throw codedError('TRANSLATION_MODEL_IDENTITY_MISMATCH', 'Local translation engine model identity does not match the pinned Astera translation model.');
    }
    if (finiteNumber(payload.external_api_calls) !== 0) {
      throw codedError('TRANSLATION_EXTERNAL_PROVIDER_FORBIDDEN', 'Translation engine reported an external provider call.');
    }
    const translations = Array.isArray(payload.translations) ? payload.translations : [];
    if (translations.length !== 1 || typeof translations[0] !== 'string' || (!translations[0] && source.trim())) {
      throw codedError('TRANSLATION_ENGINE_RESPONSE_INVALID', 'Local translation engine returned an invalid translation response.', true);
    }
    return {
      text: translations[0] as string,
      inputTokens: finiteNumber(payload.input_tokens),
      outputTokens: finiteNumber(payload.output_tokens),
    };
  } finally {
    clearTimeout(timer);
  }
}

const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>()]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\{\{[^{}\n]+\}\}|\$\{[^{}\n]+\}|<%[\s\S]*?%>|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b\d+(?:[.,:/-]\d+)*(?:%|[A-Za-z]{1,8})?\b/gi;

function protect(source: string): { text: string; tokens: Array<{ token: string; value: string }> } {
  const tokens: Array<{ token: string; value: string }> = [];
  const replaced = source.replace(PROTECTED, (value) => {
    const token = `__ASTERA_PROTECTED_${String(tokens.length).padStart(6, '0')}__`;
    tokens.push({ token, value });
    return token;
  });
  return { text: replaced, tokens };
}

function restore(source: string, tokens: Array<{ token: string; value: string }>): string {
  let result = source;
  for (const item of tokens) {
    const occurrences = result.split(item.token).length - 1;
    if (occurrences !== 1) throw codedError('TRANSLATION_PROTECTED_TOKEN_MISMATCH', `Protected token mismatch: ${item.token}`);
    result = result.replace(item.token, item.value);
  }
  return result;
}

function lineShape(source: string): string[] {
  return source.split('\n').map((line) => {
    if (!line.trim()) return 'blank';
    if (/^\s*```/.test(line)) return 'fence';
    const heading = line.match(/^\s*(#{1,6})\s+/);
    if (heading) return `heading:${heading[1]?.length ?? 0}`;
    if (/^\s*[-*+]\s+/.test(line)) return 'bullet';
    if (/^\s*\d+[.)]\s+/.test(line)) return 'ordered';
    if (/^\s*>\s?/.test(line)) return 'quote';
    if (/^\s*\|.*\|\s*$/.test(line)) return `table:${(line.match(/\|/g) ?? []).length}`;
    return 'text';
  });
}

function validateStructure(before: string, after: string): void {
  const left = lineShape(before);
  const right = lineShape(after);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw codedError('TRANSLATION_STRUCTURE_DIFF_FAILED', 'Translation changed the document line structure.');
  }
  const beforeLength = Math.max(1, [...before].length);
  const ratio = [...after].length / beforeLength;
  if (ratio < 0.2 || ratio > 5) {
    throw codedError('TRANSLATION_INFORMATION_VOLUME_INVALID', 'Translation output volume is outside the allowed structural range.');
  }
}

function validationFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code || '';
  return [
    'TRANSLATION_PROTECTED_TOKEN_MISMATCH',
    'TRANSLATION_STRUCTURE_DIFF_FAILED',
    'TRANSLATION_INFORMATION_VOLUME_INVALID',
  ].includes(code);
}

async function translateText(source: string, targetLanguage: string, timeoutMs: number): Promise<{ text: string; calls: number; inputTokens: number; outputTokens: number; fallback: number }> {
  if (!source.trim()) return { text: source, calls: 0, inputTokens: 0, outputTokens: 0, fallback: 0 };
  const protectedSource = protect(source);

  const primary = await requestEngine(protectedSource.text, targetLanguage, 'document', timeoutMs);
  try {
    const restored = restore(primary.text, protectedSource.tokens);
    validateStructure(source, restored);
    return { text: restored, calls: 1, inputTokens: primary.inputTokens, outputTokens: primary.outputTokens, fallback: 0 };
  } catch (error) {
    if (!validationFailure(error)) throw error;
  }

  const fallback = await requestEngine(protectedSource.text, targetLanguage, 'lines', timeoutMs);
  const restored = restore(fallback.text, protectedSource.tokens);
  validateStructure(source, restored);
  return {
    text: restored,
    calls: 2,
    inputTokens: primary.inputTokens + fallback.inputTokens,
    outputTokens: primary.outputTokens + fallback.outputTokens,
    fallback: 1,
  };
}

function bodySlot(value: unknown): { body: string; apply: (next: string) => unknown } | null {
  if (typeof value === 'string') return { body: value, apply: (next) => next };
  const source = record(value);
  for (const key of ['body', 'content', 'text']) {
    if (typeof source[key] === 'string') return { body: source[key] as string, apply: (next) => ({ ...source, [key]: next }) };
  }
  return null;
}

export async function translateAsteraResult(payload: unknown, targetLanguage: string, _vault: VaultClient, config: TranslationRuntimeConfig): Promise<TranslationOutcome> {
  if (!targetLanguage.trim()) throw codedError('TARGET_LANGUAGE_REQUIRED', 'Translation target language is required.');

  const cloned = structuredClone(payload) as unknown;
  const root = record(cloned);
  const result = record(root.result ?? root.data ?? root);
  const sections = result.sections;
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, validationFallbacks: 0 };
  const translateSlot = async (slot: { body: string; apply: (next: string) => unknown }): Promise<unknown> => {
    const translated = await translateText(slot.body, targetLanguage, config.timeoutMs);
    totals.calls += translated.calls;
    totals.inputTokens += translated.inputTokens;
    totals.outputTokens += translated.outputTokens;
    totals.validationFallbacks += translated.fallback;
    return slot.apply(translated.text);
  };

  if (Array.isArray(sections)) {
    const next: unknown[] = [];
    for (const item of sections) {
      const slot = bodySlot(item);
      next.push(slot ? await translateSlot(slot) : item);
    }
    result.sections = next;
  } else {
    const objectSections = record(sections);
    if (Object.keys(objectSections).length) {
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(objectSections)) {
        const slot = bodySlot(value);
        next[key] = slot ? await translateSlot(slot) : value;
      }
      result.sections = next;
    } else {
      for (const key of ['true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection', 'counter_view', 'alternatives', 'recommendation', 'next_prompt']) {
        const slot = bodySlot(result[key]);
        if (slot) result[key] = await translateSlot(slot);
      }
    }
  }

  return {
    result: cloned,
    usage: {
      provider: 'local_madlad400',
      model: MODEL_ID,
      modelRevision: MODEL_REVISION,
      calls: totals.calls,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      externalApiCalls: 0,
      validationFallbacks: totals.validationFallbacks,
      targetLanguage,
    },
  };
}
