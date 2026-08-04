import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createApp } from './index.js';
import type { RuntimeConfig } from './config.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_NOT_CONFIGURED');

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
        true_purpose: { title: '真の目的', body: '目的', source_ids: [] },
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

const config: RuntimeConfig = {
  port: 0,
  databaseUrl,
  internalServiceToken: 'internal-test-token',
  processOrigin: `http://127.0.0.1:${processPort}`,
  processToken: 'process-test-token',
  encryptionKey: crypto.getRandomValues(new Uint8Array(32)),
  processTimeoutMs: 5_000,
  shutdownTimeoutMs: 5_000,
};
const { app, service } = createApp(config);

try {
  await service.database.ready();
  const unauthorized = await app.request('/internal/v1/jobs/test');
  assert.equal(unauthorized.status, 401);

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
  assert.equal(created.status, 201, await created.text());

  let completed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.request(`/internal/v1/jobs/${jobId}`, {
      headers: { Authorization: 'Bearer internal-test-token' },
    });
    assert.equal(response.status, 200, await response.text());
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
  assert.equal(duplicate.status, 200, await duplicate.text());
  const duplicatePayload = await duplicate.json() as { created: boolean; job: { state: string } };
  assert.equal(duplicatePayload.created, false);
  assert.equal(duplicatePayload.job.state, 'completed');
  assert.equal(processCalls, 1);

  console.log(JSON.stringify({ event: 'contabo_runtime_smoke_passed', job_id: jobId, process_calls: processCalls }));
} finally {
  for (const controller of service.active.values()) controller.abort('smoke_shutdown');
  await service.database.close();
  processServer.close();
  await once(processServer, 'close').catch(() => undefined);
}
