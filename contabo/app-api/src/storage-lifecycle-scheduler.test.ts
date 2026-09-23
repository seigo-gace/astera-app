import test from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeConfig } from './config.js';
import {
  StorageLifecycleScheduler,
  storageLifecycleSignature,
} from './storage-lifecycle-scheduler.js';

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    internalServiceToken: 'test-secret',
    storageLifecycleOrigin: 'https://staging.asterav8.jp',
    storageLifecycleIntervalMs: 300_000,
    storageLifecycleTimeoutMs: 5_000,
    ...overrides,
  } as RuntimeConfig;
}

test('Storage lifecycle signature uses the canonical timestamp/method/path payload', () => {
  assert.equal(
    storageLifecycleSignature('test-secret', '1790168400000'),
    'a2b467a71d299ba641c5fc5ff47adf3d164187c2b3a067ee242db61e5cdc17c8',
  );
});

test('Storage lifecycle scheduler sends only the signed internal request', async () => {
  let target = '';
  let timestamp = '';
  let signature = '';
  let authorization = '';
  const scheduler = new StorageLifecycleScheduler(
    config(),
    (async (input: string | URL | Request, init?: RequestInit) => {
      target = input instanceof Request ? input.url : String(input);
      const headers = new Headers(init?.headers);
      timestamp = headers.get('x-astera-lifecycle-timestamp') ?? '';
      signature = headers.get('x-astera-lifecycle-signature') ?? '';
      authorization = headers.get('authorization') ?? '';
      return new Response(JSON.stringify({
        status: 'ok',
        claimed: 1,
        purged: 1,
        finalized_from_receipt: 0,
        failed: 0,
        overdue_24h: 0,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
    () => 1790168400000,
  );

  const result = await scheduler.runOnce();
  assert.equal(target, 'https://staging.asterav8.jp/api/internal/storage/lifecycle');
  assert.equal(timestamp, '1790168400000');
  assert.equal(signature, 'a2b467a71d299ba641c5fc5ff47adf3d164187c2b3a067ee242db61e5cdc17c8');
  assert.equal(authorization, '');
  assert.equal(result.status, 'ok');
});

test('Storage lifecycle scheduler treats a partial lifecycle batch as failure so it is retried', async () => {
  const scheduler = new StorageLifecycleScheduler(
    config(),
    (async () => new Response(JSON.stringify({ status: 'partial', failed: 1 }), {
      status: 207,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
  );
  await assert.rejects(() => scheduler.runOnce(), /STORAGE_LIFECYCLE_PARTIAL_FAILED_1/);
});

test('Storage lifecycle scheduler fails closed when its Pages origin is not configured', async () => {
  const scheduler = new StorageLifecycleScheduler(config({ storageLifecycleOrigin: '' }));
  await assert.rejects(() => scheduler.runOnce(), /ASTERA_STORAGE_LIFECYCLE_ORIGIN_NOT_CONFIGURED/);
});
