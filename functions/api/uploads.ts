import {
  FunctionHttpError,
  functionErrorResponse,
  requestCorrelationId,
  requireAsteraActor,
  type AsteraFunctionEnv,
} from '../_account-projection';

type R2ObjectBody = { key: string; size: number; etag: string };
type R2Bucket = {
  put: (key: string, value: ArrayBuffer | ReadableStream | Blob, options?: Record<string, unknown>) => Promise<R2ObjectBody | null>;
  delete: (key: string) => Promise<void>;
};

type Env = AsteraFunctionEnv & {
  ASTERA_UPLOADS: R2Bucket;
  DIRECT_UPLOAD_MAX_BYTES?: string;
  PRIVATE_UPLOAD_TTL_SECONDS?: string;
};
type PagesContext = { request: Request; env: Env };

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim().slice(0, 240) || 'upload.bin';
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const requestId = requestCorrelationId(context.request);
  let storageKey = '';
  try {
    const actor = await requireAsteraActor(context.request, context.env);
    if (!context.env.ASTERA_UPLOADS) throw new FunctionHttpError(503, 'UPLOAD_BUCKET_NOT_CONFIGURED', 'Astera Upload用R2 Bucketが設定されていません。');
    const contentLength = Number(context.request.headers.get('content-length') ?? 0);
    const directLimit = positiveInteger(context.env.DIRECT_UPLOAD_MAX_BYTES, 20 * 1024 * 1024, 100 * 1024 * 1024);
    if (contentLength > directLimit) {
      throw new FunctionHttpError(413, 'MULTIPART_UPLOAD_REQUIRED', 'このFile SizeはMultipart Uploadが必要です。', { direct_limit_bytes: directLimit });
    }

    const form = await context.request.formData();
    const value = form.get('file');
    if (!(value instanceof File)) throw new FunctionHttpError(422, 'UPLOAD_FILE_REQUIRED', 'UploadするFileがありません。');
    if (value.size <= 0) throw new FunctionHttpError(422, 'UPLOAD_FILE_EMPTY', '空のFileはUploadできません。');
    if (value.size > directLimit) throw new FunctionHttpError(413, 'MULTIPART_UPLOAD_REQUIRED', 'このFile SizeはMultipart Uploadが必要です。', { direct_limit_bytes: directLimit });
    const privateMode = form.get('private_mode') === 'true';
    const bytes = await value.arrayBuffer();
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    const uploadId = crypto.randomUUID();
    const now = new Date();
    const privateTtl = positiveInteger(context.env.PRIVATE_UPLOAD_TTL_SECONDS, 3600, 24 * 60 * 60);
    const expiresAt = privateMode ? new Date(now.getTime() + privateTtl * 1000).toISOString() : null;
    storageKey = `${actor.profile.tenant_id}/${privateMode ? 'private' : 'normal'}/${uploadId}/${encodeURIComponent(safeName(value.name))}`;

    const stored = await context.env.ASTERA_UPLOADS.put(storageKey, bytes, {
      httpMetadata: { contentType: value.type || 'application/octet-stream' },
      customMetadata: {
        tenant_id: actor.profile.tenant_id,
        user_id: actor.user.id,
        upload_id: uploadId,
        sha256,
        private_mode: String(privateMode),
      },
    });
    if (!stored) throw new FunctionHttpError(502, 'UPLOAD_OBJECT_WRITE_FAILED', 'R2へFileを書き込めませんでした。');

    try {
      await context.env.ASTERA_DB.prepare(
        `INSERT INTO upload_objects
          (id, tenant_id, user_id, storage_key, original_name, content_type, size_bytes, sha256,
           status, private_mode, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10, ?11, ?11)`,
      ).bind(
        uploadId,
        actor.profile.tenant_id,
        actor.user.id,
        storageKey,
        safeName(value.name),
        value.type || 'application/octet-stream',
        value.size,
        sha256,
        privateMode ? 1 : 0,
        expiresAt,
        now.toISOString(),
      ).run();
    } catch (error) {
      await context.env.ASTERA_UPLOADS.delete(storageKey);
      storageKey = '';
      throw error;
    }

    return Response.json({
      file: {
        upload_id: uploadId,
        object_id: uploadId,
        storage_reference: uploadId,
        name: safeName(value.name),
        content_type: value.type || 'application/octet-stream',
        size_bytes: value.size,
        sha256,
        status: 'ready',
        private_mode: privateMode,
        expires_at: expiresAt,
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId } });
  } catch (error) {
    if (storageKey && context.env.ASTERA_UPLOADS) await context.env.ASTERA_UPLOADS.delete(storageKey).catch(() => undefined);
    return functionErrorResponse(error, requestId);
  }
}

export function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'POST') {
    return Promise.resolve(Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POSTのみ対応しています。' } }, { status: 405 }));
  }
  return onRequestPost(context);
}
