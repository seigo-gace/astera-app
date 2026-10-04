import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TGSERVER_ZERO_PROJECT_ID,
  TgServerLogSink,
  buildAsteraAppZeroLog,
  buildTgServerBulkUrl,
  normalizeRuntimeCode,
  normalizeRuntimeSignal,
  validateTgServerBulkReceipt,
} from './tgserver-zero-log.js';

test('P010 producer normalizes the ZERO bulk endpoint', () => {
  assert.equal(buildTgServerBulkUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/ingest/bulk');
  assert.equal(buildTgServerBulkUrl('http://127.0.0.1:3000/ingest'), 'http://127.0.0.1:3000/ingest/bulk');
  assert.equal(buildTgServerBulkUrl('http://127.0.0.1:3000/ingest/bulk/'), 'http://127.0.0.1:3000/ingest/bulk');
});

test('P010 envelope is fixed and rejects arbitrary runtime text', () => {
  assert.equal(TGSERVER_ZERO_PROJECT_ID, 'P010');
  assert.equal(normalizeRuntimeCode('ASTERA_PROCESS_TIMEOUT'), 'ASTERA_PROCESS_TIMEOUT');
  assert.equal(normalizeRuntimeCode('secret=value'), 'ASTERA_APP_RUNTIME_ERROR');
  assert.equal(normalizeRuntimeSignal('SIGTERM'), 'SIGTERM');
  assert.equal(normalizeRuntimeSignal('secret-value'), 'UNKNOWN');
  assert.deepEqual(buildAsteraAppZeroLog({
    level: 'error',
    event: 'runtime_job_failed',
    code: 'ASTERA_PROCESS_TIMEOUT',
    createdAt: '2026-10-04T12:00:00.000Z',
  }), {
    project_id: 'P010',
    severity: 'error',
    message: JSON.stringify({ event: 'runtime_job_failed', code: 'ASTERA_PROCESS_TIMEOUT', signal: null }),
    hint: 'astera-app-runtime',
    timestamp: '2026-10-04T12:00:00.000Z',
  });
});

test('P010 sink sends logs[] without producer secret', async () => {
  let captured: { url: string; headers: HeadersInit | undefined; body: string | undefined } | null = null;
  const sink = new TgServerLogSink({
    url: 'http://127.0.0.1:3000/ingest',
    batchSize: 1,
    fetchImpl: async (input, init) => {
      captured = { url: String(input), headers: init?.headers, body: String(init?.body ?? '') };
      return new Response(JSON.stringify({ results: [{ status: 'accepted' }] }), { status: 200 });
    },
  });
  sink.log({ level: 'info', event: 'runtime_job_completed' });
  await sink.flush();
  assert.equal(captured?.url, 'http://127.0.0.1:3000/ingest/bulk');
  assert.deepEqual(captured?.headers, { 'content-type': 'application/json' });
  const body = JSON.parse(captured?.body ?? '{}');
  assert.equal(body.logs[0].project_id, 'P010');
  assert.equal(sink.queued, 0);
});

test('P010 sink is fail-open and requeues failed batches', async () => {
  const sink = new TgServerLogSink({
    url: 'http://127.0.0.1:3000',
    batchSize: 10,
    queueLimit: 10,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  sink.log({ level: 'error', event: 'runtime_job_failed', code: 'ASTERA_PROCESS_TIMEOUT' });
  assert.equal(await sink.flush(), false);
  assert.equal(sink.queued, 1);
  assert.doesNotThrow(() => validateTgServerBulkReceipt({ results: [{ status: 'duplicate' }] }, 1));
  assert.throws(() => validateTgServerBulkReceipt({ results: [{ status: 'rejected' }] }, 1));
});
