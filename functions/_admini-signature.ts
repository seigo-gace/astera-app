import { FunctionHttpError } from './_account-projection';

export type AdminiSignatureEnv = {
  ADMINI_INTERNAL_SECRET?: string;
  ADMINI_API_ORIGIN?: string;
};

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function requiredSecret(env: AdminiSignatureEnv): string {
  const secret = env.ADMINI_INTERNAL_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new FunctionHttpError(503, 'ADMINI_INTERNAL_SECRET_NOT_CONFIGURED', 'Admini内部署名境界が設定されていません。');
  }
  return secret;
}

async function signPayload(secret: string, timestamp: string, exactBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${exactBody}`));
  return base64Url(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

export async function signedAdminiHeaders(env: AdminiSignatureEnv, exactBody: string): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  return {
    'Content-Type': 'application/json',
    'X-Astera-Internal-Timestamp': timestamp,
    'X-Astera-Internal-Signature': await signPayload(requiredSecret(env), timestamp, exactBody),
  };
}

export async function requireAdminiSignedBody(request: Request, env: AdminiSignatureEnv): Promise<{ exactBody: string; parsed: unknown }> {
  const timestamp = request.headers.get('X-Astera-Internal-Timestamp')?.trim() ?? '';
  const supplied = request.headers.get('X-Astera-Internal-Signature')?.trim() ?? '';
  if (!timestamp || !supplied) throw new FunctionHttpError(401, 'ADMINI_SIGNATURE_REQUIRED', '内部署名が必要です。');
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw new FunctionHttpError(401, 'ADMINI_SIGNATURE_EXPIRED', '内部署名の有効時間を超えています。');
  }
  const exactBody = await request.text();
  const expected = await signPayload(requiredSecret(env), timestamp, exactBody);
  if (!timingSafeEqual(expected, supplied)) throw new FunctionHttpError(401, 'ADMINI_SIGNATURE_INVALID', '内部署名を確認できません。');
  try {
    return { exactBody, parsed: JSON.parse(exactBody) as unknown };
  } catch {
    throw new FunctionHttpError(400, 'INTERNAL_BODY_INVALID', '内部Request Bodyが不正です。');
  }
}

export async function adminiSignedRequest<T>(env: AdminiSignatureEnv, path: string, payload: unknown): Promise<T> {
  const origin = env.ADMINI_API_ORIGIN?.trim().replace(/\/$/, '');
  if (!origin) throw new FunctionHttpError(503, 'ADMINI_API_ORIGIN_NOT_CONFIGURED', 'Admini接続先が設定されていません。');
  const exactBody = JSON.stringify(payload);
  const response = await fetch(`${origin}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...(await signedAdminiHeaders(env, exactBody)) },
    body: exactBody,
  });
  const result = await response.json().catch(() => null) as T | null;
  if (!response.ok || result === null) {
    throw new FunctionHttpError(response.status >= 500 ? 503 : response.status, 'ADMINI_REQUEST_FAILED', 'Admini連携を完了できませんでした。', { status: response.status });
  }
  return result;
}
