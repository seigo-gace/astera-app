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

type BinarySignature = Readonly<{
  name: string;
  offset: number;
  bytes: readonly number[];
}>;

const KNOWN_BINARY_SIGNATURES: readonly BinarySignature[] = [
  { name: 'PDF', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { name: 'ZIP', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'ZIP_EMPTY', offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] },
  { name: 'ZIP_SPANNED', offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08] },
  { name: 'PNG', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'JPEG', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { name: 'WEBP_RIFF', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
];

function extension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot) : '';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasSignature(bytes: Uint8Array, signature: BinarySignature): boolean {
  if (bytes.byteLength < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => bytes[signature.offset + index] === byte);
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  return hasSignature(bytes, KNOWN_BINARY_SIGNATURES[6]!)
    && bytes.byteLength >= 12
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50;
}

function rejectKnownBinaryMasquerade(bytes: Uint8Array): void {
  for (const signature of KNOWN_BINARY_SIGNATURES) {
    if (signature.name === 'WEBP_RIFF') continue;
    if (hasSignature(bytes, signature)) {
      throw new PrivateFileMaterializerError('MIME_MISMATCH', `File bytes match ${signature.name} while the approved input type is text.`, false);
    }
  }
  if (hasWebpSignature(bytes)) {
    throw new PrivateFileMaterializerError('MIME_MISMATCH', 'File bytes match WEBP while the approved input type is text.', false);
  }
}

function validateTextBytes(bytes: Uint8Array, json: boolean): void {
  rejectKnownBinaryMasquerade(bytes);
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

function scrubMaterials(materials: VerifiedFileMaterial[]): void {
  for (const material of materials) {
    material.extractedText = '';
    material.inspection.reasons.length = 0;
  }
  materials.length = 0;
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
    try {
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

          // Candidate type/MIME/magic validation happens before malware scanning
          // without creating an extracted plaintext string or temporary plaintext file.
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
    } catch (error) {
      // A later file may fail after earlier files were already extracted. Drop every
      // accumulated plaintext reference before propagating the failure so a failed
      // multi-file request cannot retain accepted material from earlier files.
      scrubMaterials(materials);
      throw error;
    }
  }
}
