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

test('Browser MIME mismatch is rejected before private bytes are decrypted', async () => {
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

test('PDF magic masquerading as TXT is rejected before malware scan and decrypted bytes are wiped', async () => {
  const source = new Uint8Array(Buffer.from('%PDF-1.7\nprivate', 'ascii'));
  const original = new Uint8Array(source);
  let scanned = false;
  await assert.rejects(
    materializer(source, async () => { scanned = true; }).materialize(input('fake.txt', 'text/plain', original)),
    (error: unknown) => (error as { code?: string }).code === 'MIME_MISMATCH',
  );
  assert.equal(scanned, false);
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});

test('ZIP magic masquerading as Markdown is rejected before malware scan', async () => {
  const source = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x31, 0x32, 0x33, 0x34]);
  const original = new Uint8Array(source);
  let scanned = false;
  await assert.rejects(
    materializer(source, async () => { scanned = true; }).materialize(input('fake.md', 'text/plain', original)),
    (error: unknown) => (error as { code?: string }).code === 'MIME_MISMATCH',
  );
  assert.equal(scanned, false);
});

test('malware rejection stops extraction acceptance and wipes decrypted bytes', async () => {
  const source = new Uint8Array(Buffer.from('scan me before extraction acceptance', 'utf8'));
  const original = new Uint8Array(source);
  await assert.rejects(
    materializer(source, async () => {
      throw Object.assign(new Error('infected'), { code: 'MALWARE_DETECTED', retryable: false });
    }).materialize(input('evidence.txt', 'text/plain', original)),
    (error: unknown) => (error as { code?: string }).code === 'MALWARE_DETECTED',
  );
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});

test('invalid JSON is scanned before structural extraction fails and decrypted bytes are wiped', async () => {
  const source = new Uint8Array(Buffer.from('{invalid', 'utf8'));
  const original = new Uint8Array(source);
  let scanned = false;
  const runtime = materializer(source, async () => { scanned = true; });
  await assert.rejects(
    runtime.materialize(input('evidence.json', 'application/json', original)),
    (error: unknown) => (error as { code?: string }).code === 'EXTRACT_FAILED',
  );
  assert.equal(scanned, true);
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});

test('JSON with non-JSON leading bytes fails MIME/magic gate before scanner', async () => {
  const source = new Uint8Array(Buffer.from('not-json', 'utf8'));
  const original = new Uint8Array(source);
  let scanned = false;
  await assert.rejects(
    materializer(source, async () => { scanned = true; }).materialize(input('fake.json', 'application/json', original)),
    (error: unknown) => (error as { code?: string }).code === 'MIME_MISMATCH',
  );
  assert.equal(scanned, false);
});

test('multi-file failure wipes every decrypted byte buffer and never returns earlier accepted material', async () => {
  const first = new Uint8Array(Buffer.from('first private material', 'utf8'));
  const firstOriginal = new Uint8Array(first);
  const second = new Uint8Array(Buffer.from('second private material', 'utf8'));
  const secondOriginal = new Uint8Array(second);
  const request = input('first.txt', 'text/plain', firstOriginal);
  request.files.push({
    upload_id: '22222222-2222-4222-8222-222222222222',
    storage_key: 'private:22222222-2222-4222-8222-222222222222',
    name: 'second.txt',
    content_type: 'text/plain',
    size_bytes: secondOriginal.byteLength,
    sha256: sha256(secondOriginal),
    private_mode: true,
  });
  const sources = new Map<string, Uint8Array>([
    ['11111111-1111-4111-8111-111111111111', first],
    ['22222222-2222-4222-8222-222222222222', second],
  ]);
  let scans = 0;
  const runtime = new PrivateFileMaterializer(
    { readObject: async (objectId) => sources.get(objectId)! },
    { scan: async () => {
      scans += 1;
      if (scans === 2) throw Object.assign(new Error('infected second file'), { code: 'MALWARE_DETECTED', retryable: false });
    } },
    { version: 'file-security-test-v1', maxExtractedTextBytes: 64 * 1024 },
  );

  await assert.rejects(
    runtime.materialize(request),
    (error: unknown) => (error as { code?: string }).code === 'MALWARE_DETECTED',
  );
  assert.equal(scans, 2);
  assert.deepEqual(first, new Uint8Array(first.byteLength));
  assert.deepEqual(second, new Uint8Array(second.byteLength));
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
