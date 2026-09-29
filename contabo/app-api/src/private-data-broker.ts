import type { Hono } from 'hono';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeConfig } from './config.js';

const TMPFS_MAGIC = 0x01021994;
const PRIVATE_CHUNK_BYTES = 8 * 1024 * 1024;
const PRIVATE_UPLOAD_IDLE_TTL_MS = 30 * 60 * 1000;
const PRIVATE_ABSOLUTE_TTL_MS = 6 * 60 * 60 * 1000;
const PRIVATE_CLEANUP_INTERVAL_MS = 60 * 1000;
const PRIVATE_CONSUMER = 'astera-private-broker';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VaultEnvelope = { ciphertext: string; iv: string };

export interface PrivateDataVault {
  storeSecret(input: { value: Uint8Array; allowedConsumers: string[]; expiresAt?: number }): Promise<string>;
  sealBytes(input: { keyRef: string; consumer: string; value: Uint8Array }): Promise<VaultEnvelope>;
  unsealBytes(input: { keyRef: string; consumer: string; ciphertext: string; iv: string }): Promise<Uint8Array>;
  removeSecret(input: { secretId: string; consumer: string }): Promise<void>;
}

type PrivateChunkManifest = {
  order: number;
  file: string;
  plainSize: number;
  sealedSha256: string;
  tagBase64: string;
};

type PrivateObjectManifest = {
  version: 1;
  objectId: string;
  keyRef: string;
  tenantId: string;
  userId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: number;
  lastTouchedAt: number;
  absoluteExpiresAt: number;
  chunks: PrivateChunkManifest[];
};

export type PrivateObjectReference = Readonly<{
  objectId: string;
  storageKey: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: number;
}>;

export class PrivateDataBrokerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PrivateDataBrokerError';
    this.status = status;
    this.code = code;
  }
}

function safeId(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:@-]{1,256}$/.test(normalized)) {
    throw new PrivateDataBrokerError(422, code, 'Private Object owner identifier is invalid.');
  }
  return normalized;
}

function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim().slice(0, 240) || 'upload.bin';
}

function decodeFileName(value: string): string {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new PrivateDataBrokerError(422, 'PRIVATE_FILE_NAME_INVALID', 'Private File name header is invalid.');
  }
  const decoded = Buffer.from(value, 'base64');
  try {
    if (decoded.toString('base64') !== value) throw new PrivateDataBrokerError(422, 'PRIVATE_FILE_NAME_INVALID', 'Private File name header is invalid.');
    return safeName(decoded.toString('utf8'));
  } finally {
    decoded.fill(0);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalBase64(value: string, code: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new PrivateDataBrokerError(500, code, 'Private encrypted payload is invalid.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    bytes.fill(0);
    throw new PrivateDataBrokerError(500, code, 'Private encrypted payload is invalid.');
  }
  return bytes;
}

function validateManifest(value: unknown): PrivateObjectManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrivateDataBrokerError(500, 'PRIVATE_MANIFEST_INVALID', 'Private manifest is invalid.');
  }
  const source = value as Partial<PrivateObjectManifest>;
  if (
    source.version !== 1 || typeof source.objectId !== 'string' || !UUID.test(source.objectId) ||
    typeof source.keyRef !== 'string' || !source.keyRef || typeof source.tenantId !== 'string' || !source.tenantId ||
    typeof source.userId !== 'string' || !source.userId || typeof source.name !== 'string' || !source.name ||
    typeof source.contentType !== 'string' || !source.contentType || typeof source.sizeBytes !== 'number' ||
    !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 || typeof source.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.createdAt !== 'number' || !Number.isSafeInteger(source.createdAt) ||
    source.createdAt <= 0 || typeof source.lastTouchedAt !== 'number' || !Number.isSafeInteger(source.lastTouchedAt) ||
    source.lastTouchedAt <= 0 || typeof source.absoluteExpiresAt !== 'number' || !Number.isSafeInteger(source.absoluteExpiresAt) ||
    source.absoluteExpiresAt <= source.createdAt || !Array.isArray(source.chunks)
  ) {
    throw new PrivateDataBrokerError(500, 'PRIVATE_MANIFEST_INVALID', 'Private manifest is invalid.');
  }
  const chunks = source.chunks.map((chunk, index) => {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
      throw new PrivateDataBrokerError(500, 'PRIVATE_MANIFEST_INVALID', 'Private chunk manifest is invalid.');
    }
    const item = chunk as Partial<PrivateChunkManifest>;
    if (
      item.order !== index || item.file !== `${index}.agcm` || typeof item.plainSize !== 'number' ||
      !Number.isSafeInteger(item.plainSize) || item.plainSize <= 0 || item.plainSize > PRIVATE_CHUNK_BYTES ||
      typeof item.sealedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sealedSha256) ||
      typeof item.tagBase64 !== 'string' || !item.tagBase64
    ) {
      throw new PrivateDataBrokerError(500, 'PRIVATE_MANIFEST_INVALID', 'Private chunk manifest is invalid.');
    }
    return item as PrivateChunkManifest;
  });
  return { ...(source as PrivateObjectManifest), chunks };
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : '';
}

export class PrivateDataBroker {
  readonly root: string;
  readonly maxBytes: number;
  readonly vault: PrivateDataVault;
  private readonly requireTmpfs: boolean;
  private readonly cleanupIntervalMs: number;
  private readonly now: () => number;
  private readonly objects = new Map<string, PrivateObjectManifest>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(
    config: Pick<RuntimeConfig, 'privateDataTmpDir' | 'privateUploadMaxBytes'>,
    vault: PrivateDataVault,
    options: { requireTmpfs?: boolean; cleanupIntervalMs?: number; now?: () => number } = {},
  ) {
    this.root = config.privateDataTmpDir?.trim() || '/run/astera-private-data';
    this.maxBytes = config.privateUploadMaxBytes ?? 20 * 1024 * 1024;
    this.vault = vault;
    this.requireTmpfs = options.requireTmpfs !== false;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? PRIVATE_CLEANUP_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  private objectDir(objectId: string): string {
    if (!UUID.test(objectId)) throw new PrivateDataBrokerError(422, 'PRIVATE_OBJECT_ID_INVALID', 'Private Object ID is invalid.');
    return join(this.root, objectId);
  }

  private manifestPath(objectId: string): string {
    return join(this.objectDir(objectId), 'manifest.json');
  }

  private async writeManifest(manifest: PrivateObjectManifest): Promise<void> {
    const destination = this.manifestPath(manifest.objectId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async recover(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const raw = await readFile(this.manifestPath(entry.name), 'utf8');
        const manifest = validateManifest(JSON.parse(raw));
        this.objects.set(manifest.objectId, manifest);
      } catch {
        await rm(this.objectDir(entry.name), { recursive: true, force: true });
      }
    }
    await this.cleanupExpired();
  }

  async ready(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (this.requireTmpfs) {
      const filesystem = await statfs(this.root);
      if (Number(filesystem.type) !== TMPFS_MAGIC) {
        throw new PrivateDataBrokerError(503, 'PRIVATE_TMPFS_REQUIRED', 'Private Data Broker root is not mounted on tmpfs.');
      }
    }
    this.initialized = true;
    try {
      await this.recover();
    } catch (error) {
      this.initialized = false;
      this.objects.clear();
      throw error;
    }
    if (this.cleanupIntervalMs > 0) {
      this.timer = setInterval(() => void this.cleanupExpired().catch(() => undefined), this.cleanupIntervalMs);
      this.timer.unref?.();
    }
  }

  private requireReady(): void {
    if (!this.initialized) throw new PrivateDataBrokerError(503, 'PRIVATE_BROKER_NOT_READY', 'Private Data Broker is not ready.');
  }

  async createObject(input: {
    tenantId: string;
    userId: string;
    name: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<PrivateObjectReference> {
    this.requireReady();
    const tenantId = safeId(input.tenantId, 'PRIVATE_TENANT_ID_INVALID');
    const userId = safeId(input.userId, 'PRIVATE_USER_ID_INVALID');
    const name = safeName(input.name);
    const contentType = input.contentType.trim().slice(0, 255) || 'application/octet-stream';
    if (input.bytes.byteLength <= 0) throw new PrivateDataBrokerError(422, 'PRIVATE_FILE_EMPTY', 'Private File is empty.');
    if (input.bytes.byteLength > this.maxBytes) throw new PrivateDataBrokerError(413, 'PRIVATE_FILE_TOO_LARGE', 'Private File exceeds the direct-upload limit.');

    const objectId = randomUUID();
    const createdAt = this.now();
    const absoluteExpiresAt = createdAt + PRIVATE_ABSOLUTE_TTL_MS;
    const directory = this.objectDir(objectId);
    await mkdir(directory, { recursive: false, mode: 0o700 });

    let keyRef = '';
    try {
      const dek = randomBytes(32);
      try {
        keyRef = await this.vault.storeSecret({
          value: dek,
          allowedConsumers: [PRIVATE_CONSUMER],
          expiresAt: absoluteExpiresAt,
        });
      } finally {
        dek.fill(0);
      }

      const chunks: PrivateChunkManifest[] = [];
      for (let offset = 0, order = 0; offset < input.bytes.byteLength; offset += PRIVATE_CHUNK_BYTES, order += 1) {
        const plaintext = input.bytes.subarray(offset, Math.min(input.bytes.byteLength, offset + PRIVATE_CHUNK_BYTES));
        const envelope = await this.vault.sealBytes({ keyRef, consumer: PRIVATE_CONSUMER, value: plaintext });
        const iv = canonicalBase64(envelope.iv, 'PRIVATE_IV_INVALID');
        const ciphertext = canonicalBase64(envelope.ciphertext, 'PRIVATE_CIPHERTEXT_INVALID');
        try {
          if (iv.byteLength !== 12 || ciphertext.byteLength < 16) {
            throw new PrivateDataBrokerError(502, 'PRIVATE_SEAL_RESPONSE_INVALID', 'Vault returned an invalid AES-GCM envelope.');
          }
          const sealed = Buffer.concat([iv, ciphertext]);
          try {
            const file = `${order}.agcm`;
            await writeFile(join(directory, file), sealed, { mode: 0o600, flag: 'wx' });
            chunks.push({
              order,
              file,
              plainSize: plaintext.byteLength,
              sealedSha256: sha256(sealed),
              tagBase64: ciphertext.subarray(ciphertext.byteLength - 16).toString('base64'),
            });
          } finally {
            sealed.fill(0);
          }
        } finally {
          iv.fill(0);
          ciphertext.fill(0);
        }
      }

      const manifest: PrivateObjectManifest = {
        version: 1,
        objectId,
        keyRef,
        tenantId,
        userId,
        name,
        contentType,
        sizeBytes: input.bytes.byteLength,
        sha256: sha256(input.bytes),
        createdAt,
        lastTouchedAt: createdAt,
        absoluteExpiresAt,
        chunks,
      };
      await this.writeManifest(manifest);
      this.objects.set(objectId, manifest);
      return Object.freeze({
        objectId,
        storageKey: `private:${objectId}`,
        name,
        contentType,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
        expiresAt: absoluteExpiresAt,
      });
    } catch (error) {
      if (keyRef) await this.removeKey(keyRef).catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private owned(objectId: string, tenantId: string, userId: string): PrivateObjectManifest {
    this.requireReady();
    const manifest = this.objects.get(objectId);
    if (!manifest) throw new PrivateDataBrokerError(404, 'PRIVATE_OBJECT_NOT_FOUND', 'Private Object was not found.');
    if (manifest.tenantId !== safeId(tenantId, 'PRIVATE_TENANT_ID_INVALID') || manifest.userId !== safeId(userId, 'PRIVATE_USER_ID_INVALID')) {
      throw new PrivateDataBrokerError(404, 'PRIVATE_OBJECT_NOT_FOUND', 'Private Object was not found.');
    }
    if (manifest.absoluteExpiresAt <= this.now()) throw new PrivateDataBrokerError(410, 'PRIVATE_OBJECT_EXPIRED', 'Private Object has expired.');
    return manifest;
  }

  async readObject(objectId: string, tenantId: string, userId: string): Promise<Uint8Array> {
    const manifest = this.owned(objectId, tenantId, userId);
    const plaintextChunks: Buffer[] = [];
    try {
      for (const chunk of manifest.chunks) {
        const sealed = await readFile(join(this.objectDir(objectId), chunk.file));
        try {
          if (sha256(sealed) !== chunk.sealedSha256 || sealed.byteLength < 28) {
            throw new PrivateDataBrokerError(500, 'PRIVATE_CHUNK_INTEGRITY_FAILED', 'Private encrypted Chunk integrity check failed.');
          }
          const iv = sealed.subarray(0, 12);
          const ciphertext = sealed.subarray(12);
          if (ciphertext.subarray(ciphertext.byteLength - 16).toString('base64') !== chunk.tagBase64) {
            throw new PrivateDataBrokerError(500, 'PRIVATE_CHUNK_TAG_MISMATCH', 'Private encrypted Chunk tag check failed.');
          }
          const plaintext = await this.vault.unsealBytes({
            keyRef: manifest.keyRef,
            consumer: PRIVATE_CONSUMER,
            ciphertext: ciphertext.toString('base64'),
            iv: iv.toString('base64'),
          });
          if (plaintext.byteLength !== chunk.plainSize) {
            plaintext.fill(0);
            throw new PrivateDataBrokerError(500, 'PRIVATE_CHUNK_SIZE_MISMATCH', 'Private decrypted Chunk size check failed.');
          }
          plaintextChunks.push(Buffer.from(plaintext));
          plaintext.fill(0);
        } finally {
          sealed.fill(0);
        }
      }
      const combined = Buffer.concat(plaintextChunks, manifest.sizeBytes);
      if (combined.byteLength !== manifest.sizeBytes || sha256(combined) !== manifest.sha256) {
        combined.fill(0);
        throw new PrivateDataBrokerError(500, 'PRIVATE_OBJECT_HASH_MISMATCH', 'Private Object checksum does not match.');
      }
      manifest.lastTouchedAt = this.now();
      await this.writeManifest(manifest);
      return combined;
    } finally {
      for (const chunk of plaintextChunks) chunk.fill(0);
    }
  }

  private async removeKey(keyRef: string): Promise<void> {
    try {
      await this.vault.removeSecret({ secretId: keyRef, consumer: PRIVATE_CONSUMER });
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'VAULT_SECRET_NOT_FOUND' && code !== 'VAULT_SECRET_EXPIRED') throw error;
    }
  }

  async destroyObject(objectId: string, tenantId?: string, userId?: string): Promise<void> {
    this.requireReady();
    const manifest = this.objects.get(objectId);
    if (!manifest) return;
    if (tenantId !== undefined && userId !== undefined) this.owned(objectId, tenantId, userId);
    await this.removeKey(manifest.keyRef);
    await rm(this.objectDir(objectId), { recursive: true, force: true });
    this.objects.delete(objectId);
  }

  async cleanupExpired(): Promise<number> {
    if (!this.initialized) return 0;
    const now = this.now();
    let removed = 0;
    for (const manifest of [...this.objects.values()]) {
      const uploadIdleExpired = manifest.chunks.length === 0 && manifest.lastTouchedAt + PRIVATE_UPLOAD_IDLE_TTL_MS <= now;
      if (!uploadIdleExpired && manifest.absoluteExpiresAt > now) continue;
      try {
        await this.destroyObject(manifest.objectId);
        removed += 1;
      } catch {
        // Keep the manifest so a later cleanup cycle retries instead of claiming success.
      }
    }
    return removed;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const failures: unknown[] = [];
    for (const manifest of [...this.objects.values()]) {
      try {
        await this.destroyObject(manifest.objectId);
      } catch (error) {
        failures.push(error);
      }
    }
    this.initialized = false;
    if (failures.length > 0) throw failures[0];
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof PrivateDataBrokerError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const code = errorCode(error) || 'PRIVATE_BROKER_INTERNAL_ERROR';
  return Response.json({ error: { code, message: 'Private Data Broker request failed.' } }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}

function requiredHeader(headers: Headers, name: string, code: string): string {
  const value = headers.get(name)?.trim() || '';
  if (!value) throw new PrivateDataBrokerError(422, code, `${name} is required.`);
  return value;
}

export function registerPrivateDataBrokerApi(app: Hono, broker: PrivateDataBroker): void {
  app.post('/api/private/uploads', async (context) => {
    let bytes: Uint8Array | null = null;
    try {
      const tenantId = requiredHeader(context.req.raw.headers, 'X-Astera-Tenant-ID', 'PRIVATE_TENANT_ID_REQUIRED');
      const userId = requiredHeader(context.req.raw.headers, 'X-Astera-User-ID', 'PRIVATE_USER_ID_REQUIRED');
      const encodedName = requiredHeader(context.req.raw.headers, 'X-Astera-File-Name-B64', 'PRIVATE_FILE_NAME_REQUIRED');
      const declared = Number(context.req.raw.headers.get('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > broker.maxBytes) {
        throw new PrivateDataBrokerError(413, 'PRIVATE_FILE_TOO_LARGE', 'Private File exceeds the direct-upload limit.');
      }
      bytes = new Uint8Array(await context.req.arrayBuffer());
      const created = await broker.createObject({
        tenantId,
        userId,
        name: decodeFileName(encodedName),
        contentType: context.req.header('content-type') || 'application/octet-stream',
        bytes,
      });
      return context.json({
        file: {
          upload_id: created.objectId,
          object_id: created.objectId,
          storage_key: created.storageKey,
          storage_reference: created.objectId,
          name: created.name,
          content_type: created.contentType,
          size_bytes: created.sizeBytes,
          sha256: created.sha256,
          status: 'ready',
          private_mode: true,
          expires_at: new Date(created.expiresAt).toISOString(),
        },
      }, 201, { 'Cache-Control': 'no-store' });
    } catch (error) {
      return errorResponse(error);
    } finally {
      bytes?.fill(0);
    }
  });

  app.delete('/api/private/objects/:objectId', async (context) => {
    try {
      const tenantId = requiredHeader(context.req.raw.headers, 'X-Astera-Tenant-ID', 'PRIVATE_TENANT_ID_REQUIRED');
      const userId = requiredHeader(context.req.raw.headers, 'X-Astera-User-ID', 'PRIVATE_USER_ID_REQUIRED');
      await broker.destroyObject(context.req.param('objectId'), tenantId, userId);
      return context.json({ removed: true }, 200, { 'Cache-Control': 'no-store' });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export const privateDataPolicy = Object.freeze({
  version: 'private-v1',
  chunkSizeBytes: PRIVATE_CHUNK_BYTES,
  uploadIdleTtlSeconds: PRIVATE_UPLOAD_IDLE_TTL_MS / 1000,
  absoluteTtlSeconds: PRIVATE_ABSOLUTE_TTL_MS / 1000,
  cleanupIntervalSeconds: PRIVATE_CLEANUP_INTERVAL_MS / 1000,
});
