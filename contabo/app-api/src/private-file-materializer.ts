import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { VerifiedFileMaterial } from './core-process-adapter.js';
import type { RuntimeCreateRequest } from './index.js';

export type PrivateFileMaterializerPolicy = Readonly<{
  version: string;
  maxExtractedTextBytes: number;
}>;

export interface PrivateFileReader {
  readObject(objectId: string, tenantId: string, userId: string): Promise<Uint8Array>;
}

export interface MalwareScanner {
  scan(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
}

export class PrivateFileMaterializerError extends Error {
  constructor(
    public readonly code: 'FILE_TYPE_BLOCKED' | 'MIME_MISMATCH' | 'EXTRACT_FAILED' | 'PRIVATE_PIPELINE_UNAVAILABLE',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'PrivateFileMaterializerError';
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const SUPPORTED = new Map<string, Readonly<{ detectedMime: string; acceptedMime: readonly string[]; json: boolean }>>([
  ['.txt', { detectedMime: 'text/plain', acceptedMime: ['text/plain'], json: false }],
  ['.md', { detectedMime: 'text/markdown', acceptedMime: ['text/markdown', 'text/plain'], json: false }],
  ['.json', { detectedMime: 'application/json', acceptedMime: ['application/json', 'text/json'], json: true }],
]);

function extension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot) : '';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateTextBytes(bytes: Uint8Array, json: boolean): void {
  if (!isUtf8(bytes) || bytes.includes(0)) {
    throw new PrivateFileMaterializerError('MIME_MISMATCH', 'File bytes do not match an approved UTF-8 text format.', false);
  }
  if (!json) return;
  let first = -1;
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    first = byte;
    break;
  }
  if (first !== 0x7b && first !== 0x5b) {
    throw new PrivateFileMaterializerError('MIME_MISMATCH', 'JSON bytes do not have an approved JSON leading token.', false);
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new PrivateFileMaterializerError('EXTRACT_FAILED', 'Text file is not valid UTF-8.', false);
  }
}

export class PrivateFileMaterializer {
  constructor(
    private readonly reader: PrivateFileReader,
    private readonly scanner: MalwareScanner,
    private readonly policy: PrivateFileMaterializerPolicy,
  ) {}

  async materialize(input: RuntimeCreateRequest, signal?: AbortSignal): Promise<VerifiedFileMaterial[]> {
    if (!input.private_mode) {
      throw new PrivateFileMaterializerError('PRIVATE_PIPELINE_UNAVAILABLE', 'Private materializer cannot process a normal-mode job.', false);
    }
    if (!this.policy.version.trim() || !Number.isSafeInteger(this.policy.maxExtractedTextBytes) || this.policy.maxExtractedTextBytes <= 0) {
      throw new PrivateFileMaterializerError('PRIVATE_PIPELINE_UNAVAILABLE', 'File Security Pipeline policy is not configured.', true);
    }

    const materials: VerifiedFileMaterial[] = [];
    for (const file of input.files) {
      const format = SUPPORTED.get(extension(file.name));
      if (!format) {
        throw new PrivateFileMaterializerError('FILE_TYPE_BLOCKED', 'File type does not have an approved in-memory extractor.', false);
      }
      const browserMime = file.content_type.trim().toLowerCase();
      if (!format.acceptedMime.includes(browserMime)) {
        throw new PrivateFileMaterializerError('MIME_MISMATCH', 'Browser MIME and approved file type do not match.', false);
      }

      const bytes = await this.reader.readObject(file.upload_id, input.tenant_id, input.user_id);
      try {
        if (bytes.byteLength !== file.size_bytes || sha256(bytes) !== file.sha256.toLowerCase()) {
          throw new PrivateFileMaterializerError('EXTRACT_FAILED', 'Private object metadata does not match decrypted bytes.', false);
        }

        // Type/MIME candidate validation happens before malware scanning without
        // creating an extracted plaintext string or a temporary plaintext file.
        validateTextBytes(bytes, format.json);
        await this.scanner.scan(bytes, signal);

        const extractedText = decodeUtf8(bytes);
        if (format.json) {
          try { JSON.parse(extractedText); }
          catch { throw new PrivateFileMaterializerError('EXTRACT_FAILED', 'JSON file is structurally invalid.', false); }
        }

        const extractedBytes = Buffer.byteLength(extractedText, 'utf8');
        if (extractedBytes <= 0 || extractedBytes > this.policy.maxExtractedTextBytes) {
          throw new PrivateFileMaterializerError('EXTRACT_FAILED', 'Extracted text exceeds the configured File Security policy.', false);
        }

        materials.push({
          inspection: {
            fileId: file.upload_id,
            sha256: file.sha256.toLowerCase(),
            size: file.size_bytes,
            detectedMime: format.detectedMime,
            status: 'accepted',
            reasons: [],
          },
          extractedText,
        });
      } finally {
        bytes.fill(0);
      }
    }
    return materials;
  }
}
