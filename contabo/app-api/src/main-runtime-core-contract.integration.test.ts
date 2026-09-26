import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { createFullApp } from './full-app.js';
import type { RuntimeConfig } from './config.js';

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const MAIN8 = [
  ['01 本当の目的', '- 目的'],
  ['02 前提不足', '- 前提'],
  ['03 事実確認', '- 事実'],
  ['04 危機察知', '- リスク'],
  ['05 反対視点', '- 反対'],
  ['06 比較案', '- 比較'],
  ['07 根拠成立状態', '- 根拠'],
  ['08 主役AI／利用者への再指示', '- 再指示'],
].map(([title, body]) => `${title}\n${body}`).join('\n---\n');

const MANUAL_PURPOSES = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'] as const;
const REQUIRED_FOCUS: Record<(typeof MANUAL_PURPOSES)[number], string> = {
  review: 'internal_consistency',
  compare: 'candidate_extraction',
  verify: 'claim_extraction',
  improve: 'defects_and_bottlenecks',
  research: 'entity_extraction',
  plan: 'execution_sequence',
  consider: 'opposing_views',
};

test('internal Job API preserves all seven manual App purpose contracts through Runtime adapter and returns Main8', async (t) => {
  let processCalls = 0;
  const seenPurposes = new Set<string>();
  const processServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/process') {
      res.writeHead(404).end();
      return;
    }
    assert.equal(req.headers['x-api-key'], 'process-test-token');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.accept, 'text/plain');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const question = String(body.question ?? '');
    const expectedPurpose = question.replace('Main API Contract Test:', '');
    assert.ok(MANUAL_PURPOSES.includes(expectedPurpose as (typeof MANUAL_PURPOSES)[number]));

    const context = JSON.parse(String(body.context ?? '{}')) as {
      app_purpose_contract?: {
        version?: string;
        selected_by?: string;
        purpose?: string;
        objective?: string;
        required_focus?: string[];
        operating_rules?: string[];
      };
    };
    const contract = context.app_purpose_contract;
    assert.equal(contract?.version, 'app-purpose-v1');
    assert.equal(contract?.selected_by, 'user');
    assert.equal(contract?.purpose, expectedPurpose);
    assert.ok((contract?.objective ?? '').length > 20);
    assert.ok(contract?.required_focus?.includes(REQUIRED_FOCUS[expectedPurpose as keyof typeof REQUIRED_FOCUS]));
    assert.ok(contract?.operating_rules?.some((rule) => /original user prompt/i.test(rule)));
    assert.equal(Object.hasOwn(body, 'actor'), false);
    assert.equal(Object.hasOwn(body, 'job'), false);
    processCalls += 1;
    seenPurposes.add(expectedPurpose);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(MAIN8);
  });
  processServer.listen(0, '127.0.0.1');
  await once(processServer, 'listening');
  t.after(async () => closeServer(processServer));
  const processPort = (processServer.address() as AddressInfo).port;

  const vaultServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer vault-test-token');
    if (req.method === 'GET' && req.url === '/internal/v1/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (req.method === 'POST' && req.url === '/internal/v1/crypto/seal') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ciphertext: String(body.plaintext_base64 ?? ''), iv: 'test-iv' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'TEST_VAULT_ROUTE_NOT_FOUND' } }));
  });
  vaultServer.listen(0, '127.0.0.1');
  await once(vaultServer, 'listening');
  t.after(async () => closeServer(vaultServer));
  const vaultPort = (vaultServer.address() as AddressInfo).port;

  const config: RuntimeConfig = {
    port: 0,
    internalServiceToken: 'internal-test-token',
    processOrigin: `http://127.0.0.1:${processPort}`,
    processToken: 'process-test-token',
    processTimeoutMs: 5000,
    shutdownTimeoutMs: 5000,
    vaultOrigin: `http://127.0.0.1:${vaultPort}`,
    vaultServiceToken: 'vault-test-token',
    vaultJobKeyRef: 'test-job-key',
    vaultTimeoutMs: 5000,
    translationModelId: '',
    translationGeminiKeyRef: '',
    translationTimeoutMs: 5000,
    tgserverStorageOrigin: '',
    tgserverStorageToken: '',
    tgserverStorageTimeoutMs: 600000,
  };

  const { app, service } = createFullApp(config);
  t.after(async () => {
    for (const controller of service.active.values()) controller.abort('test_shutdown');
    await service.database.close();
  });

  for (const purpose of MANUAL_PURPOSES) {
    const jobId = crypto.randomUUID();
    const prompt = `Main API Contract Test:${purpose}`;
    const created = await app.request('/internal/v1/jobs', {
      method: 'POST',
      headers: { Authorization: 'Bearer internal-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        tenant_id: 'tenant-test',
        user_id: 'user-test',
        request_id: crypto.randomUUID(),
        prompt,
        purpose,
        options: [],
        files: [],
        private_mode: false,
        project_id: null,
        reserved_credits: 10,
        policy_version: 'test-policy',
        correlation_id: crypto.randomUUID(),
      }),
    });
    assert.equal(created.status, 201, `${purpose}: create failed`);

    let completed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const polled = await app.request(`/internal/v1/jobs/${jobId}`, {
        headers: { Authorization: 'Bearer internal-test-token' },
      });
      assert.equal(polled.status, 200, `${purpose}: poll failed`);
      const payload = await polled.json() as { job: Record<string, unknown> };
      if (payload.job.state === 'completed') {
        completed = payload.job;
        break;
      }
      if (payload.job.state === 'failed') assert.fail(`${purpose}: Main Runtime failed: ${JSON.stringify(payload.job.error)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(completed, `${purpose}: Main Runtime Job did not complete`);
    const result = completed.result as { sections?: Record<string, { title?: string; body?: string; canonical_key?: string }> };
    assert.equal(result.sections?.true_purpose?.title, '01 本当の目的');
    assert.equal(result.sections?.recommendation?.title, '07 根拠成立状態');
    assert.equal(result.sections?.recommendation?.canonical_key, '07_evidence_status');
    assert.equal(result.sections?.next_prompt?.title, '08 主役AI／利用者への再指示');
  }

  assert.equal(processCalls, MANUAL_PURPOSES.length);
  assert.deepEqual([...seenPurposes].sort(), [...MANUAL_PURPOSES].sort());
});
