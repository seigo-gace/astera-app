import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeConfig } from './config.js';
import { RuntimeDatabase } from './database.js';
import { AsteraRuntimeService, type RuntimeCreateRequest } from './index.js';
import type { VaultClient } from './vault-client.js';

const config = {
  processOrigin: 'http://127.0.0.1:9999',
  processToken: 'test-token',
  processTimeoutMs: 2_000,
  translationModelId: 'test-model',
  translationGeminiKeyRef: 'test-key-ref',
  translationTimeoutMs: 2_000,
} as RuntimeConfig;

function privateInput(jobId: string): RuntimeCreateRequest {
  return {
    job_id: jobId,
    tenant_id: 'tenant-private',
    user_id: 'user-private',
    request_id: `request-${jobId}`,
    prompt: 'attached fileを検証して',
    purpose: 'verify',
    purpose_text: null,
    options: [],
    files: [{
      upload_id: '11111111-1111-4111-8111-111111111111',
      storage_key: 'private:11111111-1111-4111-8111-111111111111',
      name: 'evidence.txt',
      content_type: 'text/plain',
      size_bytes: 12,
      sha256: 'a'.repeat(64),
      private_mode: true,
    }],
    private_mode: true,
    project_id: null,
    reserved_credits: 1,
    policy_version: 'test-policy',
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

function service(database: RuntimeDatabase) {
  return new AsteraRuntimeService(config, database, {} as VaultClient);
}

test('private file is destroyed before a file-bridge execution failure becomes terminal', async () => {
  const database = new RuntimeDatabase();
  const input = privateInput('job-private-failure');
  await seed(database, input);
  const runtime = service(database);
  const destroyed: Array<{ objectId: string; tenantId: string; userId: string }> = [];
  runtime.bindPrivateObjectDestroyer(async (target) => { destroyed.push(target); });

  await runtime.execute(input);

  const job = await database.get('job-private-failure');
  assert.equal(job?.state, 'failed');
  assert.equal(job?.error_code, 'ASTERA_FILE_INPUT_BRIDGE_NOT_CONNECTED');
  assert.deepEqual(destroyed, [{
    objectId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'tenant-private',
    userId: 'user-private',
  }]);
  assert.equal(input.files.length, 0);
});

test('private file is destroyed before a pre-run cancellation becomes terminal', async () => {
  const database = new RuntimeDatabase();
  const input = privateInput('job-private-cancel');
  await seed(database, input);
  await database.transition(input.job_id, ['queued'], 'cancel_requested', input.correlation_id);
  const runtime = service(database);
  const destroyed: string[] = [];
  runtime.bindPrivateObjectDestroyer(async ({ objectId }) => { destroyed.push(objectId); });

  await runtime.execute(input);

  const job = await database.get('job-private-cancel');
  assert.equal(job?.state, 'cancelled');
  assert.equal(job?.error_code, 'JOB_CANCELLED');
  assert.deepEqual(destroyed, ['11111111-1111-4111-8111-111111111111']);
});

test('private cleanup failure is surfaced instead of reporting the original execution failure', async () => {
  const database = new RuntimeDatabase();
  const input = privateInput('job-private-cleanup-failure');
  await seed(database, input);
  const runtime = service(database);
  runtime.bindPrivateObjectDestroyer(async () => { throw new Error('cleanup unavailable'); });

  await runtime.execute(input);

  const job = await database.get('job-private-cleanup-failure');
  assert.equal(job?.state, 'failed');
  assert.equal(job?.error_code, 'PRIVATE_OBJECT_CLEANUP_FAILED');
  assert.equal(job?.retryable, true);
});
