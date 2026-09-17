import { FunctionHttpError } from './_account-projection';

const DEFAULT_TOLERANCE_SECONDS = 300;

function decodeSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (trimmed.startsWith('whsec_')) {
    const encoded = trimmed.slice('whsec_'.length);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new TextEncoder().encode(trimmed);
}

function parseStandardSignatures(header: string): string[] {
  return header
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith('v1,') ? part.slice(3) : part));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return diff === 0;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyGatewayStandardWebhook(
  request: Request,
  rawBody: string,
  secret: string | undefined,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): Promise<boolean> {
  const configured = secret?.trim();
  if (!configured) return false;

  const id = request.headers.get('webhook-id')?.trim();
  const timestamp = request.headers.get('webhook-timestamp')?.trim();
  const signatureHeader = request.headers.get('webhook-signature')?.trim();
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    decodeSecret(configured),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = new Uint8Array(digest);
  const candidates = parseStandardSignatures(signatureHeader);
  return candidates.some((candidate) => {
    const received = base64ToBytes(candidate);
    return received ? constantTimeEqual(received, expected) : false;
  });
}

export function requireGatewayProvider(request: Request, expected: string): void {
  const provider = request.headers.get('x-gace-provider')?.trim().toLowerCase();
  if (!provider) {
    throw new FunctionHttpError(400, 'GATEWAY_PROVIDER_MISSING', 'Gateway provider headerがありません。');
  }
  if (provider !== expected) {
    throw new FunctionHttpError(403, 'GATEWAY_PROVIDER_MISMATCH', 'Gateway providerが一致しません。');
  }
}
