import { FunctionHttpError } from '../part/billing-env.js';
import { decodeSecret, hmacSha256, timingSafeEqual } from '../part/crypto.js';

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseStandardSignatures(header: string): string[] {
  return header
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith('v1,') ? part.slice(3) : part));
}

function base64ToBytes(value: string): Buffer | null {
  try {
    return Buffer.from(value, 'base64');
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

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = hmacSha256(decodeSecret(configured), signedContent);
  const candidates = parseStandardSignatures(signatureHeader);
  return candidates.some((candidate) => {
    const received = base64ToBytes(candidate);
    return received ? timingSafeEqual(received, expected) : false;
  });
}

export function requireGatewayProvider(request: Request, expected: string): void {
  const provider = request.headers.get('x-gace-provider')?.trim().toLowerCase();
  if (!provider) {
    throw new FunctionHttpError(400, 'GATEWAY_PROVIDER_MISSING', 'Gateway provider headerがありません。');
  }
  if (provider !== expected) {
    throw new FunctionHttpError(400, 'GATEWAY_PROVIDER_MISMATCH', 'Gateway providerが一致しません。');
  }
}

export function requireGatewayDestination(request: Request, expected: string): void {
  const destination = request.headers.get('x-gace-destination')?.trim();
  if (!destination || destination !== expected) {
    throw new FunctionHttpError(400, 'GATEWAY_DESTINATION_MISMATCH', 'Gateway destinationが一致しません。');
  }
}
