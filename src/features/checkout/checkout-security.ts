type JsonRecord = Record<string, unknown>;

export type CheckoutAuthenticationState = 'login-required' | 'reauth-required' | null;

export type CheckoutResponseError = {
  authentication: CheckoutAuthenticationState;
  code: string;
  message: string;
};

const LOGIN_REQUIRED_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'SESSION_REQUIRED',
  'SESSION_EXPIRED',
  'UNAUTHORIZED',
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function checkoutResponseError(
  status: number,
  payload: unknown,
  fallbackCode: string,
): CheckoutResponseError {
  const root = isRecord(payload) ? payload : {};
  const source = isRecord(root.error) ? root.error : root;
  const code = firstText(source, ['code', 'error_code', 'type'])
    || firstText(root, ['code', 'error_code'])
    || fallbackCode;
  const message = firstText(source, ['message', 'detail', 'title'])
    || firstText(root, ['message', 'detail', 'title'])
    || code;

  if (status === 401 && LOGIN_REQUIRED_CODES.has(code)) {
    return { authentication: 'login-required', code, message };
  }
  if (status === 403 && code === 'FRESH_SESSION_REQUIRED') {
    return { authentication: 'reauth-required', code, message };
  }
  return { authentication: null, code, message };
}

export async function readCheckoutResponseError(
  response: Response,
  fallbackCode: string,
): Promise<CheckoutResponseError> {
  const payload: unknown = await response.json().catch(() => null);
  return checkoutResponseError(response.status, payload, fallbackCode);
}

export function isAllowedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'square.link'
      || host === 'sandbox.square.link'
      || host.endsWith('.square.site')
      || host.endsWith('.squareup.com');
  } catch {
    return false;
  }
}
