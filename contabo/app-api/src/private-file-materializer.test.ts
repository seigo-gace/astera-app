import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { RuntimeCreateRequest } from './index.js';
import { PrivateFileMaterializer } from './private-file-materializer.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function input(name: string, mime: string, bytes: Uint8Array): RuntimeCreateRequest {
  return {
    job_id: 'job-materializer',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    request_id: 'request-1',
    prompt: '添付を確認して',
    purpose: 'verify',
    purpose_text: null,
    options: [],
    files: [{
      upload_id: '11111111-1111-4111-8111-111111111111',
      storage_key: 'private:11111111-1111-4111-8111-111111111111',
      name,
      content_type: mime,
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
      private_mode: true,
    }],
    private_mode: true,
    project_id: null,
    reserved_credits: 1,
    policy_version: 'test-policy',
    correlation_id: 'correlation-1',
  };
}

function materializer(source: Uint8Array, scan: (bytes: Uint8Array) => Promise<void> = async () => undefined) {
  return new PrivateFileMaterializer(
    { readObject: async () => source },
    { scan },
    { version: 'file-security-test-v1', maxExtractedTextBytes: 64 * 1024 },
  );
}

test('private TXT stays in memory, is scanned, produces accepted material, then wipes decrypted bytes', async () => {
  const source = new Uint8Array(Buffer.from('private evidence text', 'utf8'));
  const original = new Uint8Array(source);
  let scanned = Buffer.alloc(0);
  const runtime = materializer(source, async (bytes) => { scanned = Buffer.from(bytes); });
  const result = await runtime.materialize(input('evidence.txt', 'text/plain', original));

  assert.deepEqual(scanned, Buffer.from(original));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.inspection.status, 'accepted');
  assert.equal(result[0]?.inspection.detectedMime, 'text/plain');
  assert.equal(result[0]?.inspection.sha256, sha256(original));
  assert.equal(result[0]?.extractedText, 'private evidence text');
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});

test('valid JSON is structurally verified before it becomes accepted material', async () => {
  const source = new Uint8Array(Buffer.from('{"fact":true}', 'utf8'));
  const original = new Uint8Array(source);
  const result = await materializer(source).materialize(input('evidence.json', 'application/json', original));
  assert.equal(result[0]?.inspection.detectedMime, 'application/json');
  assert.equal(result[0]?.extractedText, '{"fact":true}');
});

test('unsupported PDF is blocked before reading or scanning it', async () => {
  const source = new Uint8Array(Buffer.from('%PDF-1.7', 'ascii'));
  let read = false;
  let scanned = false;
  const runtime = new PrivateFileMaterializer(
    { readObject: async () => { read = true; return source; } },
    { scan: async () => { scanned = true; } },
    { version: 'file-security-test-v1', maxExtractedTextBytes: 64 * 1024 },
  );
  await assert.rejects(
    runtime.materialize(input('evidence.pdf', 'application/pdf', new Uint8Array(source))),
    (error: unknown) => (error as { code?: string }).code === 'FILE_TYPE_BLOCKED',
  );
  assert.equal(read, false);
  assert.equal(scanned, false);
});

test('MIME mismatch is rejected before private bytes are decrypted', async () => {
  const source = new Uint8Array(Buffer.from('plain text', 'utf8'));
  let read = false;
  const runtime = new PrivateFileMaterializer(
    { readObject: async () => { read = true; return source; } },
    { scan: async () => undefined },
    { version: 'file-security-test-v1', maxExtractedTextBytes: 64 * 1024 },
  );
  await assert.rejects(
    runtime.materialize(input('evidence.txt', 'application/pdf', new Uint8Array(source))),
    (error: unknown) => (error as { code?: string }).code === 'MIME_MISMATCH',
  );
  assert.equal(read, false);
});

test('invalid JSON fails closed and decrypted bytes are wiped', async () => {
  const source = new Uint8Array(Buffer.from('{invalid', 'utf8'));
  const original = new Uint8Array(source);
  const runtime = materializer(source);
  await assert.rejects(
    runtime.materialize(input('evidence.json', 'application/json', original)),
    (error: unknown) => (error as { code?: string }).code === 'EXTRACT_FAILED',
  );
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});

test('missing versioned File Security policy fails closed before decrypting bytes', async () => {
  const source = new Uint8Array(Buffer.from('private text', 'utf8'));
  let read = false;
  const runtime = new PrivateFileMaterializer(
    { readObject: async () => { read = true; return source; } },
    { scan: async () => undefined },
    { version: '', maxExtractedTextBytes: 0 },
  );
  await assert.rejects(
    runtime.materialize(input('evidence.txt', 'text/plain', new Uint8Array(source))),
    (error: unknown) => (error as { code?: string }).code === 'PRIVATE_PIPELINE_UNAVAILABLE',
  );
  assert.equal(read, false);
});
