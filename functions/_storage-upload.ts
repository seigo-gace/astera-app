import { FunctionHttpError } from './_account-projection';

export const STORAGE_FILE_MAX_BYTES = 1024 * 1024 * 1024;
export const STORAGE_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
export const STORAGE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export function safeStorageFileName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\\/]/g, '_').trim().slice(0, 240) || 'upload.bin';
}

export function optionalStorageText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function storageFileSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new FunctionHttpError(422, 'STORAGE_FILE_SIZE_INVALID', 'File Sizeが不正です。');
  }
  if (size > STORAGE_FILE_MAX_BYTES) {
    throw new FunctionHttpError(413, 'STORAGE_FILE_TOO_LARGE', 'Fileは1GB上限です。');
  }
  return size;
}

export function storageChunkCount(fileSize: number): number {
  return fileSize === 0 ? 0 : Math.ceil(fileSize / STORAGE_UPLOAD_CHUNK_BYTES);
}

export function storageExpectedChunkBytes(fileSize: number, index: number): number {
  const count = storageChunkCount(fileSize);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new FunctionHttpError(422, 'STORAGE_UPLOAD_CHUNK_INDEX_INVALID', 'Upload Chunk番号が不正です。');
  }
  return Math.min(STORAGE_UPLOAD_CHUNK_BYTES, fileSize - index * STORAGE_UPLOAD_CHUNK_BYTES);
}

export async function deterministicStorageUploadObjectId(userId: string, idempotencyKey: string): Promise<string> {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) {
    throw new FunctionHttpError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Keyが必要です。');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}\u0000${key}`));
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `upl_${hex}`;
}
