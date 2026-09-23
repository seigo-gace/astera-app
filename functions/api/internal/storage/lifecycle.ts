import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  type AsteraFunctionEnv,
} from '../../../_account-projection';
import {
  binaryError,
  storageBinaryFetch,
  type StorageBinaryEnv,
} from '../../../_storage-binary-client';
import {
  claimExpiredStorageDeletions,
  completeStoragePrimaryDeletion,
  readPrimaryDeletionReceipt,
  recordPrimaryDeletionReceipt,
  releaseStorageDeletionClaim,
  STORAGE_PRIMARY_DELETE_MAX_MS,
  storagePrimaryDeletionAgeMs,
  type StorageDeletionCandidate,
} from '../../../_storage-deletion-lifecycle';
import { StorageStoreError } from '../../../_storage-store';

type Env = AsteraFunctionEnv & StorageBinaryEnv;
type Context = { request: Request; env: Env };

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const SIGNATURE_FUTURE_SKEW_MS = 60 * 1000;

function normalizedError(error: unknown): unknown {
  return error instanceof StorageStoreError
    ? new FunctionHttpError(error.status, error.code, error.message, error.details)
    : error;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left.toLowerCase());
  const b = new TextEncoder().encode(right.toLowerCase());
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % Math.max(1, a.length)] ?? 0) ^ (b[index % Math.max(1, b.length)] ?? 0);
  }
  return diff === 0;
}

async function expectedSignature(secret: string, timestamp: string, method: string, pathname: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = `${timestamp}\n${method.toUpperCase()}\n${pathname}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return hex(new Uint8Array(signature));
}

async function requireLifecycleSignature(request: Request, env: Env): Promise<void> {
  const secret = env.APP_API_SERVICE_TOKEN?.trim();
  if (!secret) {
    throw new FunctionHttpError(503, 'APP_API_SERVICE_TOKEN_NOT_CONFIGURED', 'Storage lifecycle authentication is not configured.');
  }
  const timestamp = request.headers.get('x-astera-lifecycle-timestamp')?.trim() ?? '';
  const signature = request.headers.get('x-astera-lifecycle-signature')?.trim() ?? '';
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new FunctionHttpError(401, 'STORAGE_LIFECYCLE_AUTH_FAILED', 'Storage lifecycle authentication failed.');
  }
  const timestampMs = Number(timestamp);
  const now = Date.now();
  if (
    !Number.isSafeInteger(timestampMs) ||
    now - timestampMs > SIGNATURE_MAX_AGE_MS ||
    timestampMs - now > SIGNATURE_FUTURE_SKEW_MS
  ) {
    throw new FunctionHttpError(401, 'STORAGE_LIFECYCLE_AUTH_EXPIRED', 'Storage lifecycle request timestamp is outside the accepted window.');
  }
  const pathname = new URL(request.url).pathname;
  const expected = await expectedSignature(secret, timestamp, request.method, pathname);
  if (!constantTimeHexEqual(signature, expected)) {
    throw new FunctionHttpError(401, 'STORAGE_LIFECYCLE_AUTH_FAILED', 'Storage lifecycle authentication failed.');
  }
}

function purgeHeaders(candidate: StorageDeletionCandidate, correlationId: string): Headers {
  if (!candidate.topic_id || !candidate.message_id || !candidate.telegram_file_id) {
    throw new StorageStoreError(
      500,
      'ASTERA_STORAGE_PRIMARY_DELETE_REF_MISSING',
      'Storage primary deletion references are missing.',
    );
  }
  return new Headers({
    'X-Astera-User-ID': candidate.user_id,
    'X-Astera-Topic-ID': candidate.topic_id,
    'X-Astera-Message-ID': candidate.message_id,
    'X-Astera-Telegram-File-ID': candidate.telegram_file_id,
    'X-Correlation-ID': correlationId,
  });
}

export async function onRequestPost(context: Context): Promise<Response> {
  const correlationId = requestCorrelationId(context.request);
  try {
    await requireLifecycleSignature(context.request, context.env);
    const startedAt = new Date();
    const candidates = await claimExpiredStorageDeletions(context.env.ASTERA_DB, startedAt);
    const result = {
      claimed: candidates.length,
      purged: 0,
      finalized_from_receipt: 0,
      failed: 0,
      overdue_24h: 0,
      failures: [] as Array<{ object_id: string; code: string }>,
    };

    for (const candidate of candidates) {
      if (storagePrimaryDeletionAgeMs(candidate, startedAt.getTime()) >= STORAGE_PRIMARY_DELETE_MAX_MS) {
        result.overdue_24h += 1;
      }

      const existingReceipt = await readPrimaryDeletionReceipt(context.env.ASTERA_DB, candidate.id);
      if (existingReceipt) {
        await completeStoragePrimaryDeletion(context.env.ASTERA_DB, candidate, existingReceipt);
        result.finalized_from_receipt += 1;
        continue;
      }

      let purgeCompleted = false;
      try {
        const upstream = await storageBinaryFetch(
          context.env,
          `/internal/v1/storage-binary/objects/${encodeURIComponent(candidate.id)}/purge`,
          { method: 'POST', headers: purgeHeaders(candidate, correlationId) },
        );
        if (!upstream.ok) throw await binaryError(upstream);
        purgeCompleted = true;

        const receipt = await recordPrimaryDeletionReceipt(context.env.ASTERA_DB, candidate);
        await completeStoragePrimaryDeletion(context.env.ASTERA_DB, candidate, receipt);
        result.purged += 1;
      } catch (error) {
        const normalized = normalizedError(error);
        const code = normalized instanceof FunctionHttpError
          ? normalized.code
          : normalized instanceof Error
            ? normalized.message.slice(0, 160)
            : 'STORAGE_PRIMARY_DELETE_FAILED';
        result.failed += 1;
        result.failures.push({ object_id: candidate.id, code });
        if (!purgeCompleted) {
          await releaseStorageDeletionClaim(context.env.ASTERA_DB, candidate, code).catch(() => false);
        }
      }
    }

    return Response.json(
      {
        status: result.failed === 0 ? 'ok' : 'partial',
        ...result,
        primary_delete_max_ms: STORAGE_PRIMARY_DELETE_MAX_MS,
      },
      {
        status: result.failed === 0 ? 200 : 207,
        headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': correlationId },
      },
    );
  } catch (error) {
    return functionErrorResponse(normalizedError(error), correlationId);
  }
}

export function onRequest(context: Context): Promise<Response> {
  if (context.request.method === 'POST') return onRequestPost(context);
  return Promise.resolve(Response.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only.' } },
    { status: 405, headers: { Allow: 'POST' } },
  ));
}
