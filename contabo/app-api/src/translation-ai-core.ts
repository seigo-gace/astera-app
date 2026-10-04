export type EngineResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

type AiCorePayload = {
  choices?: Array<{ message?: { content?: unknown } }>;
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { code?: unknown; message?: unknown };
};

export const QWEN_MODEL_ID = 'qwen3//models/Qwen3-8B-Q4_K_M.gguf';
export const GRANITE_MODEL_ID = 'granite//models/granite-4.2-8b-Q4_K_M.gguf';
const QWEN_RESPONSE_ID = '/models/Qwen3-8B-Q4_K_M.gguf';
const GRANITE_RESPONSE_ID = '/models/granite-4.2-8b-Q4_K_M.gguf';
const DEFAULT_ORIGIN = 'http://127.0.0.1:18080';

export function codedError(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function acceptedIdentity(requestModel: string, responseModel: string): boolean {
  if (requestModel === QWEN_MODEL_ID) return responseModel === QWEN_MODEL_ID || responseModel === QWEN_RESPONSE_ID;
  if (requestModel === GRANITE_MODEL_ID) return responseModel === GRANITE_MODEL_ID || responseModel === GRANITE_RESPONSE_ID;
  return false;
}

function origin(): string {
  const configured = process.env.AI_CORE_BASE_URL?.trim() || DEFAULT_ORIGIN;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw codedError('TRANSLATION_AI_CORE_ORIGIN_INVALID', 'AI Core origin is invalid.');
  }
  if (!new Set(['127.0.0.1', 'localhost', '::1', '[::1]']).has(url.hostname)) {
    throw codedError('TRANSLATION_AI_CORE_LOCAL_ONLY', 'Translation AI Core must be loopback-local; remote translation providers are forbidden.');
  }
  if (url.protocol !== 'http:') throw codedError('TRANSLATION_AI_CORE_ORIGIN_INVALID', 'Translation AI Core must use local HTTP.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function apiKey(): string {
  const token = process.env.AI_CORE_API_KEY?.trim() || '';
  if (!token) throw codedError('TRANSLATION_AI_CORE_KEY_NOT_CONFIGURED', 'AI Core API key is not configured.');
  return token;
}

export async function requestAiCore(
  model: string,
  systemContent: string,
  userContent: string,
  timeoutMs: number,
  maxTokens: number,
): Promise<EngineResult> {
  const baseOrigin = origin();
  const token = apiKey();
  const controller = new AbortController();
  const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.trunc(timeoutMs)) : 90_000;
  const timer = setTimeout(() => controller.abort('translation_timeout'), safeTimeout);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseOrigin}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          temperature: 0,
          max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw codedError('TRANSLATION_AI_CORE_TIMEOUT', 'AI Core translation timed out.', true);
      throw codedError('TRANSLATION_AI_CORE_UNREACHABLE', error instanceof Error ? error.message : 'AI Core is unreachable.', true);
    }

    const payload = await response.json().catch(() => ({})) as AiCorePayload;
    if (!response.ok) {
      const code = valueText(payload.error?.code) || 'TRANSLATION_AI_CORE_FAILED';
      const message = valueText(payload.error?.message) || `AI Core returned HTTP ${response.status}.`;
      throw codedError(code, message, response.status === 429 || response.status >= 500);
    }
    const responseModel = valueText(payload.model);
    if (!acceptedIdentity(model, responseModel)) {
      throw codedError('TRANSLATION_MODEL_IDENTITY_MISMATCH', `AI Core did not confirm the pinned model identity for ${model}.`);
    }
    const raw = valueText(payload.choices?.[0]?.message?.content);
    if (!raw.trim() && userContent.trim()) throw codedError('TRANSLATION_AI_CORE_RESPONSE_INVALID', 'AI Core returned no output text.', true);
    return {
      text: raw,
      inputTokens: finiteNumber(payload.usage?.prompt_tokens),
      outputTokens: finiteNumber(payload.usage?.completion_tokens),
    };
  } finally {
    clearTimeout(timer);
  }
}
