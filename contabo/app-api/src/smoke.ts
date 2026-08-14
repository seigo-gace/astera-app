import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createFullApp } from './full-app.js';
import type { RuntimeConfig } from './config.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_NOT_CONFIGURED');

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

let processCalls = 0;
const processServer = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/process') {
    response.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { job?: { job_id?: string } };
  assert.ok(payload.job?.job_id);
  assert.equal(request.headers.authorization, 'Bearer process-test-token');
  processCalls += 1;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    result: {
      schema_version: 'astera-result-v1',
      runtime_version: 'smoke-runtime',
      purpose_version: 'purpose-v1',
      completion_state: 'complete',
      sections: {
        true_purpose: { title: '真の目的', body: 'Smoke Testの目的', source_ids: [] },
        missing_assumptions: { title: '不足前提', body: '前提', source_ids: [] },
        fact_check: { title: '事実確認', body: '事実', source_ids: [] },
        risk_detection: { title: '危機・リスク', body: 'リスク', source_ids: [] },
        counter_view: { title: '反対視点', body: '反対', source_ids: [] },
        alternatives: { title: '比較案', body: '比較', source_ids: [] },
        recommendation: { title: '推奨判断', body: '推奨', source_ids: [] },
        next_prompt: { title: '再指示', body: '再指示', source_ids: [] },
      },
      sources: [],
      warnings: [],
      generated_at: new Date().toISOString(),
    },
    resourceUsage: { inputUnits: 10, outputUnits: 20, durationMs: 3 },
  }));
});
processServer.listen(0, '127.0.0.1');
await once(processServer, 'listening');
const processPort = (processServer.address() as AddressInfo).port;

let vaultCalls = 0;
const vaultServer = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, 'Bearer vault-test-token');
  if (request.method === 'GET' && request.url === '/internal/v1/health') {
    vaultCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  if (request.method === 'POST' && request.url === '/internal/v1/crypto/seal') {
    const plaintext = typeof body.plaintext_base64 === 'string' ? body.plaintext_base64 : '';
    assert.ok(plaintext);
    assert.equal(body.key_ref, 'smoke-job-key');
    vaultCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ciphertext: plaintext, iv: 'smoke-iv' }));
    return;
  }
  if (request.method === 'POST' && request.url === '/internal/v1/crypto/unseal') {
    const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : '';
    assert.ok(ciphertext);
    assert.equal(body.key_ref, 'smoke-job-key');
    vaultCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ plaintext_base64: ciphertext }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { code: 'SMOKE_VAULT_ROUTE_NOT_FOUND' } }));
});
vaultServer.listen(0, '127.0.0.1');
await once(vaultServer, 'listening');
const vaultPort = (vaultServer.address() as AddressInfo).port;

const config: RuntimeConfig = {
  port: 0,
  databaseUrl,
  internalServiceToken: 'internal-test-token',
  processOrigin: `http://127.0.0.1:${processPort}`,
  processToken: 'process-test-token',
  processTimeoutMs: 5_000,
  shutdownTimeoutMs: 5_000,
  vaultOrigin: `http://127.0.0.1:${vaultPort}`,
  vaultServiceToken: 'vault-test-token',
  vaultJobKeyRef: 'smoke-job-key',
  vaultTimeoutMs: 5_000,
  translationModelId: '',
  translationGeminiKeyRef: '',
  translationTimeoutMs: 5_000,
};
const { app, service } = createFullApp(config);

try {
  await service.database.ready();
  const unauthorized = await app.request('/internal/v1/jobs/test');
  assert.equal(unauthorized.status, 401);

  const ready = await app.request('/ready');
  assert.equal(ready.status, 200);

  const jobId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const body = {
    job_id: jobId,
    tenant_id: 'tenant-smoke',
    user_id: 'user-smoke',
    request_id: requestId,
    prompt: 'Smoke Test',
    purpose: 'verify',
    options: [],
    files: [],
    private_mode: false,
    project_id: null,
    reserved_credits: 10,
    policy_version: 'smoke-policy',
    correlation_id: crypto.randomUUID(),
  };
  const created = await app.request('/internal/v1/jobs', {
    method: 'POST',
    headers: { Authorization: 'Bearer internal-test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (created.status !== 201) throw new Error(`RUNTIME_JOB_CREATE_FAILED:${created.status}:${await created.text()}`);

  let completed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(`/internal/v1/jobs/${jobId}`, {
      headers: { Authorization: 'Bearer internal-test-token' },
    });
    if (response.status !== 200) throw new Error(`RUNTIME_JOB_POLL_FAILED:${response.status}:${await response.text()}`);
    const payload = await response.json() as { job: Record<string, unknown> };
    if (payload.job.state === 'completed') {
      completed = payload.job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(completed, 'Runtime Job did not complete');
  assert.equal(processCalls, 1);
  assert.ok(completed.result);

  const duplicate = await app.request('/internal/v1/jobs', {
    method: 'POST',
    headers: { Authorization: 'Bearer internal-test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (duplicate.status !== 200) throw new Error(`RUNTIME_JOB_IDEMPOTENCY_FAILED:${duplicate.status}:${await duplicate.text()}`);
  const duplicatePayload = await duplicate.json() as { created: boolean; job: { state: string } };
  assert.equal(duplicatePayload.created, false);
  assert.equal(duplicatePayload.job.state, 'completed');
  assert.equal(processCalls, 1);
  assert.ok(vaultCalls >= 2);

  const workspaceHeaders = {
    Authorization: 'Bearer internal-test-token',
    'X-Astera-Internal-Authenticated': '1',
    'X-Astera-User-ID': 'user-smoke',
    'X-Astera-Tenant-ID': 'tenant-smoke',
    'X-Astera-Account-Status': 'active',
    'X-Astera-UI-Language': 'ja-JP',
  };
  const historyResponse = await app.request('/api/history', { headers: workspaceHeaders });
  if (historyResponse.status !== 200) throw new Error(`WORKSPACE_HISTORY_FAILED:${historyResponse.status}:${await historyResponse.text()}`);
  const historyPayload = await historyResponse.json() as { history: Array<{ job_id: string; title: string }> };
  assert.equal(historyPayload.history.length, 1);
  assert.equal(historyPayload.history[0]?.job_id, jobId);
  assert.equal(historyPayload.history[0]?.title, 'Smoke Testの目的');

  const resultId = historyPayload.history[0]?.job_id ? (await service.database.pool.query<{ id: string }>('SELECT id FROM results WHERE job_id = $1', [jobId])).rows[0]?.id : null;
  assert.ok(resultId);
  const resultResponse = await app.request(`/api/results/${resultId}`, { headers: workspaceHeaders });
  if (resultResponse.status !== 200) throw new Error(`WORKSPACE_RESULT_FAILED:${resultResponse.status}:${await resultResponse.text()}`);
  const resultPayload = await resultResponse.json() as { result: { sections?: unknown } };
  assert.ok(resultPayload.result.sections);

  const privateJobId = crypto.randomUUID();
  const privateRequestId = crypto.randomUUID();
  const privateBody = {
    ...body,
    job_id: privateJobId,
    request_id: privateRequestId,
    prompt: 'PRIVATE_SMOKE_CANARY_DO_NOT_PERSIST',
    private_mode: true,
    correlation_id: crypto.randomUUID(),
  };
  const privateCreated = await app.request('/internal/v1/jobs', {
    method: 'POST',
    headers: { Authorization: 'Bearer internal-test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(privateBody),
  });
  if (privateCreated.status !== 201) throw new Error(`PRIVATE_RUNTIME_JOB_CREATE_FAILED:${privateCreated.status}:${await privateCreated.text()}`);

  let privateCompleted: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(`/internal/v1/jobs/${privateJobId}`, {
      headers: { Authorization: 'Bearer internal-test-token' },
    });
    if (response.status !== 200) throw new Error(`PRIVATE_RUNTIME_JOB_POLL_FAILED:${response.status}:${await response.text()}`);
    const payload = await response.json() as { job: Record<string, unknown> };
    if (payload.job.state === 'completed') {
      privateCompleted = payload.job;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(privateCompleted, 'Private Runtime Job did not complete');
  assert.ok(privateCompleted.result, 'Private Result must be delivered from memory');
  assert.equal(processCalls, 2);

  const privateDb = await service.database.pool.query<{
    result_json: unknown | null;
    request_ciphertext: string | null;
    request_iv: string | null;
  }>('SELECT result_json, request_ciphertext, request_iv FROM runtime_jobs WHERE id = $1', [privateJobId]);
  assert.equal(privateDb.rows[0]?.result_json, null);
  assert.equal(privateDb.rows[0]?.request_ciphertext, null);
  assert.equal(privateDb.rows[0]?.request_iv, null);

  const privateWorkspaceCount = await service.database.pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM results WHERE job_id = $1',
    [privateJobId],
  );
  assert.equal(Number(privateWorkspaceCount.rows[0]?.count ?? 0), 0);

  const privateRetryRead = await app.request(`/internal/v1/jobs/${privateJobId}`, {
    headers: { Authorization: 'Bearer internal-test-token' },
  });
  assert.equal(privateRetryRead.status, 200);
  const privateRetryPayload = await privateRetryRead.json() as { job: { state: string; result?: unknown } };
  assert.equal(privateRetryPayload.job.state, 'completed');
  assert.ok(privateRetryPayload.job.result, 'Private Result must remain retryable in memory during the 60 minute output TTL');

  const privateCanarySearch = await service.database.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM runtime_jobs
     WHERE id = $1 AND (
       COALESCE(result_json::text, '') ILIKE '%PRIVATE_SMOKE_CANARY_DO_NOT_PERSIST%'
       OR COALESCE(request_ciphertext, '') ILIKE '%PRIVATE_SMOKE_CANARY_DO_NOT_PERSIST%'
     )`,
    [privateJobId],
  );
  assert.equal(Number(privateCanarySearch.rows[0]?.count ?? 0), 0);

  console.log(JSON.stringify({
    event: 'contabo_runtime_smoke_passed',
    job_id: jobId,
    private_job_id: privateJobId,
    process_calls: processCalls,
    vault_calls: vaultCalls,
    history_items: historyPayload.history.length,
    private_result_persisted: false,
    private_result_retryable_in_memory: true,
  }));
} finally {
  for (const controller of service.active.values()) controller.abort('smoke_shutdown');
  await service.database.close();
  await Promise.all([
    closeServer(processServer),
    closeServer(vaultServer),
  ]);
}
