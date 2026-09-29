import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeConfig } from './config.js';
import type { VerifiedFileMaterial } from './core-process-adapter.js';
import { RuntimeDatabase } from './database.js';
import type { RuntimeCreateRequest } from './index.js';
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

function request(): RuntimeCreateRequest {
  return {
    job_id: 'job-private-materialized',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    request_id: 'request-1',
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
    correlation_id: 'correlation-1',
  };
}

function coreResponse(): string {
  return [
    ['01 Purpose', 'purpose'],
    ['02 Premise', 'premise'],
    ['03 Facts', 'facts'],
    ['04 Crisis', 'risk'],
    ['05 Opposition', 'opposition'],
    ['06 Comparison', 'comparison'],
    ['07 Evidence', 'evidence'],
    ['08 Reinstruction', 'next'],
  ].map(([title, body]) => `${title}\n${body}`).join('\n---\n');
}

async function insert(database: RuntimeDatabase, input: RuntimeCreateRequest): Promise<void> {
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

test('private materialization feeds verified content into Core before cleanup and removes transient material afterwards', async () => {
  const input = request();
  const database = new RuntimeDatabase();
  await insert(database, input);
  const material: VerifiedFileMaterial = {
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
  const destroyed: string[] = [];
  const service = new PrivateMaterializingRuntimeService(
    config,
    { materialize: async () => [material] },
    async ({ objectId }) => { destroyed.push(objectId); },
  );
  Object.assign(service, { database });

  const originalFetch = globalThis.fetch;
  let sentBody = '';
  globalThis.fetch = async (_input, init) => {
    sentBody = String(init?.body ?? '');
    return new Response(coreResponse(), { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  try {
    await service.execute(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const sent = JSON.parse(sentBody) as { context?: string };
  const context = JSON.parse(sent.context ?? '{}') as { user_supplied_files?: Array<{ content?: string }> };
  assert.equal(context.user_supplied_files?.[0]?.content, 'private facts');
  assert.deepEqual(destroyed, ['11111111-1111-4111-8111-111111111111']);
  assert.equal(material.extractedText, '');
  assert.equal((input as RuntimeCreateRequest & { verified_file_materials?: unknown }).verified_file_materials, undefined);
  const job = await database.get('job-private-materialized');
  assert.equal(job?.state, 'completed');
  assert.equal(job?.result_json, null);
  assert.ok(service.getPrivateResult('job-private-materialized'));
});

test('materializer rejection fails closed, never calls Core, destroys private input, and persists the exact pipeline code', async () => {
  const input = request();
  input.job_id = 'job-malware';
  input.request_id = 'request-malware';
  const database = new RuntimeDatabase();
  await insert(database, input);
  const destroyed: string[] = [];
  const service = new PrivateMaterializingRuntimeService(
    config,
    { materialize: async () => { throw Object.assign(new Error('infected'), { code: 'MALWARE_DETECTED', retryable: false }); } },
    async ({ objectId }) => { destroyed.push(objectId); },
  );
  Object.assign(service, { database });

  const originalFetch = globalThis.fetch;
  let coreCalled = false;
  globalThis.fetch = async () => { coreCalled = true; return new Response(coreResponse(), { status: 200 }); };
  try {
    await service.execute(input);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(coreCalled, false);
  assert.deepEqual(destroyed, ['11111111-1111-4111-8111-111111111111']);
  const job = await database.get('job-malware');
  assert.equal(job?.state, 'failed');
  assert.equal(job?.error_code, 'MALWARE_DETECTED');
  assert.equal(input.prompt, '');
  assert.equal(input.files.length, 0);
});
