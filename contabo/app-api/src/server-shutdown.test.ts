import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { closeRuntimeResources, safeErrorCode } from './server-shutdown.js';

test('shutdown succeeds only when both runtime resources close successfully', async () => {
  const calls: string[] = [];
  const result = await closeRuntimeResources(
    { close: async () => { calls.push('broker'); } },
    { close: async () => { calls.push('database'); } },
  );

  assert.deepEqual(calls, ['broker', 'database']);
  assert.deepEqual(result, { ok: true, exitCode: 0, failures: [] });
});

test('broker cleanup failure is authoritative, redacted, and database close is still attempted', async () => {
  const calls: string[] = [];
  const result = await closeRuntimeResources(
    {
      close: async () => {
        calls.push('broker');
        throw Object.assign(new Error('private object /run/astera-private-data/secret-object cleanup failed'), {
          code: 'PRIVATE_OBJECT_CLEANUP_FAILED',
        });
      },
    },
    { close: async () => { calls.push('database'); } },
  );

  assert.deepEqual(calls, ['broker', 'database']);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failures, [{ event: 'private_broker_cleanup_failed', code: 'PRIVATE_OBJECT_CLEANUP_FAILED' }]);
  const serialized = JSON.stringify(result.failures);
  assert.equal(serialized.includes('/run/astera-private-data'), false);
  assert.equal(serialized.includes('secret-object'), false);
});

test('database close failure produces non-zero shutdown with a safe fallback code', async () => {
  const result = await closeRuntimeResources(
    { close: async () => undefined },
    { close: async () => { throw new Error('postgres://private-host/internal-db'); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failures, [{ event: 'database_close_failed', code: 'DATABASE_CLOSE_FAILED' }]);
  assert.equal(JSON.stringify(result.failures).includes('private-host'), false);
});

test('all resource closes are attempted and all failures remain visible without raw error text', async () => {
  const result = await closeRuntimeResources(
    { close: async () => { throw Object.assign(new Error('broker private path'), { code: 'EACCES' }); } },
    { close: async () => { throw Object.assign(new Error('database private path'), { code: 'unsafe path /tmp/db' }); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failures, [
    { event: 'private_broker_cleanup_failed', code: 'EACCES' },
    { event: 'database_close_failed', code: 'DATABASE_CLOSE_FAILED' },
  ]);
  const serialized = JSON.stringify(result.failures);
  assert.equal(serialized.includes('broker private path'), false);
  assert.equal(serialized.includes('database private path'), false);
  assert.equal(serialized.includes('/tmp/db'), false);
});

test('safe error code preserves approved codes and rejects raw or path-like values', () => {
  const privateMessage = new Error('PRIVATE-CANARY /run/astera-private-data/object-123');
  assert.equal(safeErrorCode(privateMessage, 'UNHANDLED_REJECTION'), 'UNHANDLED_REJECTION');
  assert.equal(
    safeErrorCode(Object.assign(privateMessage, { code: 'PRIVATE_PIPELINE_UNAVAILABLE' }), 'UNHANDLED_REJECTION'),
    'PRIVATE_PIPELINE_UNAVAILABLE',
  );
  assert.equal(
    safeErrorCode(Object.assign(new Error('secret'), { code: 'unsafe path /tmp/private' }), 'UNHANDLED_REJECTION'),
    'UNHANDLED_REJECTION',
  );
});

test('server shutdown and fatal handlers cannot log raw error messages', async () => {
  const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('const closed = await closeRuntimeResources(privateDataBroker, service.database);'), true);
  assert.equal(source.includes('if (!closed.ok)'), true);
  assert.equal(source.includes("event: 'shutdown_failed'"), true);
  assert.equal(source.includes('process.exit(closed.exitCode)'), true);
  assert.equal(source.includes('process.exit(0)'), false);
  assert.equal(source.includes('await privateDataBroker.close().catch'), false);
  assert.equal(source.includes('error.message'), false);
  assert.equal(source.includes("safeErrorCode(error, 'UNHANDLED_REJECTION')"), true);
  assert.equal(source.includes("safeErrorCode(error, 'UNCAUGHT_EXCEPTION')"), true);
});
