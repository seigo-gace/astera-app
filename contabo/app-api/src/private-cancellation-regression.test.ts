import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeConfig } from './config.js';
import type { VerifiedFileMaterial } from './core-process-adapter.js';
import { RuntimeDatabase } from './database.js';
import type { RuntimeCreateRequest } from './index.js';
import { PrivateFileMaterializer } from './private-file-materializer.js';
import { PrivateMaterializingRuntimeService } from './private-materializing-runtime-service.js';

const config: RuntimeConfig = {
  port: 8788,
  internalServiceToken: 'internal',
  processOrigin: 'http://core',
  processToken: 'process',
  processTimeoutMs: 5_000,
  shutdownTimeoutMs: 5_000,
  vaultOrigin: 'http://vault',
  vaultServiceToken: 'vault',
  vaultJobKeyRef: 'job-key',
  vaultTimeoutMs: 5_000,
  translationModelId: '',
  translationGeminiKeyRef: '',
  translationTimeoutMs: 5_000,
  tgserverStorageOrigin: '',
  tgserverStorageToken: '',
  tgserverStorageTimeoutMs: 10_000,
};

function request(jobId: string): RuntimeCreateRequest {
  return {
    job_id: jobId,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    request_id: `request-${jobId}`,
    prompt: '添付内容を検証して',
    purpose: 'verify',
    purpose_text: null,
    options: [],
    files: [{
      upload_id: '11111111-1111-4111-8111-111111111111',
      storage_key: 'private:11111111-1111-4111-8111-111111111111',
      name: 'evidence.txt',
      content_type: 'text/plain',
      size_bytes: 13,
      sha256: 'a'.repeat(64),
      private_mode: true,
    }],
    private_mode: true,
    project_id: null,
    reserved_credits: 1,
    policy_version: 'policy-v1',
    correlation_id: `correlation-${jobId}`,
  };
}

async function seed(database: RuntimeDatabase, input: RuntimeCreateRequest): Promise<void> {
  await database.insertOrGet({
    id: input.job_id,
    tenantId: input.tenant_id,
    userId: input.user_id,
    requestId: input.request_id,
    purpose: input.purpose,
    privateMode: input.private_mode,
    projectId: input.project_id,
    policyVersion: input.policy_version,
    reservedCredits: input.reserved_credits,
    requestCiphertext: null,
    requestIv: null,
    correlationId: input.correlation_id,
  });
}

function material(input: RuntimeCreateRequest): VerifiedFileMaterial {
  return {
    inspection: {
      fileId: input.files[0]!.upload_id,
      sha256: input.files[0]!.sha256,
      size: input.files[0]!.size_bytes,
      detectedMime: 'text/plain',
      status: 'accepted',
      reasons: [],
    },
    extractedText: 'private facts',
  };
}

test('cancellation after materialization never calls Core and scrubs transient material', async () => {
  const input = request('job-cancel-before-core');
  const database = new RuntimeDatabase();
  await seed(database, input);
  const transient = material(input);
  const destroyed: string[] = [];
  let service!: PrivateMaterializingRuntimeService;
  service = new PrivateMaterializingRuntimeService(
    config,
    {
      materialize: async () => {
        await service.cancel(input.job_id, 'cancel-during-materialize');
        return [transient];
      },
    },
    async ({ objectId }) => { destroyed.push(objectId); },
  );
  Object.assign(service, { database });

  const originalFetch = globalThis.fetch;
  let coreCalled = false;
  globalThis.fetch = async () => {
    coreCalled = true;
    return new Response('unexpected');
  };
  try {
    await service.execute(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const job = await database.get(input.job_id);
  assert.equal(coreCalled, false);
  assert.equal(job?.state, 'cancelled');
  assert.equal(job?.error_code, 'JOB_CANCELLED');
  assert.deepEqual(destroyed, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(transient.extractedText, '');
  assert.equal(input.prompt, '');
  assert.equal(input.files.length, 0);
});

test('private cleanup failure overrides an in-flight cancellation and remains failed', async () => {
  const input = request('job-cancel-cleanup-failure');
  const database = new RuntimeDatabase();
  await seed(database, input);
  let started!: () => void;
  const materializerStarted = new Promise<void>((resolve) => { started = resolve; });
  const service = new PrivateMaterializingRuntimeService(
    config,
    {
      materialize: async (_input, signal) => {
        started();
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw Object.assign(new Error('scanner aborted'), { code: 'ABORT_ERR', retryable: false });
      },
    },
    async () => { throw new Error('cleanup unavailable'); },
  );
  Object.assign(service, { database });

  const originalFetch = globalThis.fetch;
  let coreCalled = false;
  globalThis.fetch = async () => {
    coreCalled = true;
    return new Response('unexpected');
  };
  try {
    const running = service.execute(input);
    await materializerStarted;
    await service.cancel(input.job_id, 'cancel-cleanup-failure');
    await running;
  } finally {
    globalThis.fetch = originalFetch;
  }

  const job = await database.get(input.job_id);
  assert.equal(coreCalled, false);
  assert.equal(job?.state, 'failed');
  assert.equal(job?.error_code, 'PRIVATE_OBJECT_CLEANUP_FAILED');
  assert.equal(job?.retryable, true);
  assert.equal(input.prompt, '');
  assert.equal(input.files.length, 0);
});

test('multi-file cleanup keeps trying later private objects after one destroy failure', async () => {
  const input = request('job-multi-cleanup-best-effort');
  input.files.push({
    upload_id: '22222222-2222-4222-8222-222222222222',
    storage_key: 'private:22222222-2222-4222-8222-222222222222',
    name: 'second.txt',
    content_type: 'text/plain',
    size_bytes: 14,
    sha256: 'b'.repeat(64),
    private_mode: true,
  });
  const database = new RuntimeDatabase();
  await seed(database, input);
  const attempts: string[] = [];
  const service = new PrivateMaterializingRuntimeService(
    config,
    {
      materialize: async () => {
        throw Object.assign(new Error('scanner unavailable'), { code: 'PRIVATE_PIPELINE_UNAVAILABLE', retryable: true });
      },
    },
    async ({ objectId }) => {
      attempts.push(objectId);
      if (objectId === '11111111-1111-4111-8111-111111111111') throw new Error('first cleanup failed');
    },
  );
  Object.assign(service, { database });

  await service.execute(input);

  const job = await database.get(input.job_id);
  assert.deepEqual(attempts, [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
  assert.equal(job?.state, 'failed');
  assert.equal(job?.error_code, 'PRIVATE_OBJECT_CLEANUP_FAILED');
  assert.equal(job?.retryable, true);
  assert.equal(input.files.length, 0);
});

test('database terminal authority cannot report cleanup failure as cancelled', async () => {
  const input = request('job-terminal-cleanup-invariant');
  const database = new RuntimeDatabase();
  await seed(database, input);
  const job = await database.finish(input.job_id, {
    state: 'cancelled',
    errorCode: 'PRIVATE_OBJECT_CLEANUP_FAILED',
    errorMessage: 'cleanup unavailable',
    retryable: true,
  }, input.correlation_id);

  assert.equal(job.state, 'failed');
  assert.equal(job.error_code, 'PRIVATE_OBJECT_CLEANUP_FAILED');
  assert.equal(job.retryable, true);
  assert.equal(job.cancelled_at, null);
  assert.ok(job.completed_at);
});

test('materializer abort still wipes decrypted bytes', async () => {
  const source = new Uint8Array(Buffer.from('private bytes', 'utf8'));
  const original = new Uint8Array(source);
  const input = request('job-byte-wipe-on-abort');
  input.files[0]!.size_bytes = original.byteLength;
  const { createHash } = await import('node:crypto');
  input.files[0]!.sha256 = createHash('sha256').update(original).digest('hex');
  const controller = new AbortController();
  const runtime = new PrivateFileMaterializer(
    { readObject: async () => source },
    {
      scan: async (_bytes, signal) => {
        assert.equal(signal, controller.signal);
        controller.abort('test-cancel');
        throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
      },
    },
    { version: 'file-security-test-v1', maxExtractedTextBytes: 64 * 1024 },
  );

  await assert.rejects(runtime.materialize(input, controller.signal));
  assert.deepEqual(source, new Uint8Array(source.byteLength));
});
