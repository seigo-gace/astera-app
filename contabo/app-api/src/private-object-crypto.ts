const AES_KEY_BITS = 256;
const AES_KEY_BYTES = AES_KEY_BITS / 8;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BITS = 128;
const GCM_TAG_BYTES = GCM_TAG_BITS / 8;
const NONCE_ATTEMPTS = 16;
const AAD_VERSION = 'astera-private-object-v1';

export type PrivateChunkManifest = Readonly<{
  order: number;
  hashSha256: string;
  tagBase64: string;
}>;

export type SealedPrivateChunk = Readonly<{
  sealed: Uint8Array;
  manifest: PrivateChunkManifest;
}>;

export type PrivateObjectDekMaterial = Readonly<{
  key: CryptoKey;
  raw: Uint8Array;
}>;

export class PrivateObjectCryptoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PrivateObjectCryptoError';
    this.code = code;
  }
}

function requireOrder(order: number): number {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new PrivateObjectCryptoError('PRIVATE_CHUNK_ORDER_INVALID', 'Chunk Orderは0以上の整数である必要があります。');
  }
  return order;
}

function requireObjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new PrivateObjectCryptoError('PRIVATE_OBJECT_ID_REQUIRED', 'Private Object IDが必要です。');
  return normalized;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % Math.max(1, left.length)] ?? 0) ^ (right[index % Math.max(1, right.length)] ?? 0);
  }
  return diff === 0;
}

function additionalData(objectId: string, order: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([AAD_VERSION, objectId, order]));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

function keyAlgorithm(key: CryptoKey): AesKeyAlgorithm {
  if (key.algorithm.name !== 'AES-GCM') {
    throw new PrivateObjectCryptoError('PRIVATE_DEK_ALGORITHM_INVALID', 'Private Object DEKはAES-GCMである必要があります。');
  }
  const algorithm = key.algorithm as AesKeyAlgorithm;
  if (algorithm.length !== AES_KEY_BITS) {
    throw new PrivateObjectCryptoError('PRIVATE_DEK_LENGTH_INVALID', 'Private Object DEKは256-bitである必要があります。');
  }
  return algorithm;
}

export async function createPrivateObjectDekMaterial(): Promise<PrivateObjectDekMaterial> {
  const raw = crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt'],
    );
    keyAlgorithm(key);
    return { key, raw };
  } catch (error) {
    raw.fill(0);
    throw error;
  }
}

export function wipePrivateBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}

export class PrivateObjectCryptoSession {
  readonly objectId: string;
  readonly key: CryptoKey;
  private readonly usedOrders = new Set<number>();
  private readonly usedNonces = new Set<string>();

  constructor(objectId: string, key: CryptoKey) {
    this.objectId = requireObjectId(objectId);
    keyAlgorithm(key);
    if (!key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
      throw new PrivateObjectCryptoError('PRIVATE_DEK_USAGE_INVALID', 'Private Object DEKにはencrypt/decrypt権限が必要です。');
    }
    this.key = key;
  }

  private nonce(): Uint8Array {
    for (let attempt = 0; attempt < NONCE_ATTEMPTS; attempt += 1) {
      const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
      const fingerprint = bytesToHex(nonce);
      if (this.usedNonces.has(fingerprint)) continue;
      this.usedNonces.add(fingerprint);
      return nonce;
    }
    throw new PrivateObjectCryptoError('PRIVATE_NONCE_GENERATION_FAILED', 'Nonce重複を安全に回避できませんでした。');
  }

  async sealChunk(orderValue: number, plaintext: Uint8Array): Promise<SealedPrivateChunk> {
    const order = requireOrder(orderValue);
    if (this.usedOrders.has(order)) {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_ORDER_DUPLICATED', `Chunk Order ${order} は既に使用されています。`);
    }
    this.usedOrders.add(order);
    const nonce = this.nonce();
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: additionalData(this.objectId, order) as BufferSource,
        tagLength: GCM_TAG_BITS,
      },
      this.key,
      plaintext as BufferSource,
    ));
    if (encrypted.byteLength < GCM_TAG_BYTES) {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_ENCRYPTION_INVALID', 'AES-GCM暗号化結果が不正です。');
    }
    const tag = encrypted.slice(encrypted.byteLength - GCM_TAG_BYTES);
    const sealed = new Uint8Array(nonce.byteLength + encrypted.byteLength);
    sealed.set(nonce, 0);
    sealed.set(encrypted, nonce.byteLength);
    const manifest: PrivateChunkManifest = Object.freeze({
      order,
      hashSha256: await sha256Hex(sealed),
      tagBase64: bytesToBase64(tag),
    });
    return { sealed, manifest };
  }

  async openChunk(manifest: PrivateChunkManifest, sealed: Uint8Array): Promise<Uint8Array> {
    const order = requireOrder(manifest.order);
    if (sealed.byteLength < GCM_NONCE_BYTES + GCM_TAG_BYTES) {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_SEALED_INVALID', 'Encrypted Chunkが短すぎます。');
    }
    const actualHash = await sha256Hex(sealed);
    if (actualHash !== manifest.hashSha256) {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_HASH_MISMATCH', 'Encrypted Chunk Hashが一致しません。');
    }
    const nonce = sealed.slice(0, GCM_NONCE_BYTES);
    const encrypted = sealed.slice(GCM_NONCE_BYTES);
    const tag = encrypted.slice(encrypted.byteLength - GCM_TAG_BYTES);
    const expectedTag = new Uint8Array(Buffer.from(manifest.tagBase64, 'base64'));
    if (expectedTag.byteLength !== GCM_TAG_BYTES || !constantTimeEqual(tag, expectedTag)) {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_TAG_MISMATCH', 'AES-GCM Tagが一致しません。');
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonce as BufferSource,
          additionalData: additionalData(this.objectId, order) as BufferSource,
          tagLength: GCM_TAG_BITS,
        },
        this.key,
        encrypted,
      );
      return new Uint8Array(plaintext);
    } catch {
      throw new PrivateObjectCryptoError('PRIVATE_CHUNK_DECRYPT_FAILED', 'Private Chunkを復号できません。');
    } finally {
      expectedTag.fill(0);
    }
  }
}

export const privateObjectCryptoContract = Object.freeze({
  algorithm: 'AES-256-GCM',
  dekBytes: AES_KEY_BYTES,
  nonceBytes: GCM_NONCE_BYTES,
  tagBytes: GCM_TAG_BYTES,
  manifestFields: ['order', 'hashSha256', 'tagBase64'] as const,
});
