import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeConfig } from './config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

type Manifest = {
  version: 1;
  objectId: string;
  tenantId: string;
  userId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  absoluteExpiresAt: number;
};

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() || '';
  if (!value) throw Object.assign(new Error(`${name} is required.`), { status: 422, code: 'PRIVATE_METADATA_OWNER_REQUIRED' });
  return value;
}

function manifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Private manifest is invalid.'), { status: 500, code: 'PRIVATE_MANIFEST_INVALID' });
  const source = value as Partial<Manifest>;
  if (
    source.version !== 1 || typeof source.objectId !== 'string' || !UUID.test(source.objectId) ||
    typeof source.tenantId !== 'string' || !source.tenantId || typeof source.userId !== 'string' || !source.userId ||
    typeof source.name !== 'string' || !source.name || typeof source.contentType !== 'string' || !source.contentType ||
    typeof source.sizeBytes !== 'number' || !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 ||
    typeof source.sha256 !== 'string' || !SHA256.test(source.sha256) ||
    typeof source.absoluteExpiresAt !== 'number' || !Number.isSafeInteger(source.absoluteExpiresAt) || source.absoluteExpiresAt <= 0
  ) {
    throw Object.assign(new Error('Private manifest is invalid.'), { status: 500, code: 'PRIVATE_MANIFEST_INVALID' });
  }
  return source as Manifest;
}

function responseError(error: unknown): Response {
  const source = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown } : {};
  const status = Number.isInteger(Number(source.status)) ? Number(source.status) : 500;
  const code = typeof source.code === 'string' && source.code ? source.code : 'PRIVATE_METADATA_READ_FAILED';
  const message = status === 404 ? 'Private Object was not found.' : status === 410 ? 'Private Object has expired.' : 'Private Object metadataを確認できません。';
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function registerPrivateDataMetadataApi(app: Hono, config: Pick<RuntimeConfig, 'privateDataTmpDir'>): void {
  const root = config.privateDataTmpDir?.trim() || '/run/astera-private-data';
  app.get('/api/private/objects/:objectId', async (context) => {
    try {
      const objectId = context.req.param('objectId');
      if (!UUID.test(objectId)) throw Object.assign(new Error('Private Object ID is invalid.'), { status: 404, code: 'PRIVATE_OBJECT_NOT_FOUND' });
      const tenantId = requiredHeader(context.req.raw.headers, 'X-Astera-Tenant-ID');
      const userId = requiredHeader(context.req.raw.headers, 'X-Astera-User-ID');
      let raw: string;
      try {
        raw = await readFile(join(root, objectId, 'manifest.json'), 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') {
          throw Object.assign(new Error('Private Object was not found.'), { status: 404, code: 'PRIVATE_OBJECT_NOT_FOUND' });
        }
        throw error;
      }
      const value = manifest(JSON.parse(raw));
      if (value.objectId !== objectId || value.tenantId !== tenantId || value.userId !== userId) {
        throw Object.assign(new Error('Private Object was not found.'), { status: 404, code: 'PRIVATE_OBJECT_NOT_FOUND' });
      }
      if (value.absoluteExpiresAt <= Date.now()) {
        throw Object.assign(new Error('Private Object has expired.'), { status: 410, code: 'PRIVATE_OBJECT_EXPIRED' });
      }
      return context.json({
        file: {
          upload_id: objectId,
          object_id: objectId,
          storage_key: `private:${objectId}`,
          storage_reference: objectId,
          name: value.name,
          content_type: value.contentType,
          size_bytes: value.sizeBytes,
          sha256: value.sha256,
          status: 'ready',
          private_mode: true,
          expires_at: new Date(value.absoluteExpiresAt).toISOString(),
        },
      }, 200, { 'Cache-Control': 'no-store' });
    } catch (error) {
      return responseError(error);
    }
  });
}
