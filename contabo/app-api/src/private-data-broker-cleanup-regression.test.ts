import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PrivateDataBroker, privateDataPolicy, type PrivateDataVault } from './private-data-broker.js';

class FakeVault implements PrivateDataVault {
  async sealJson(_value: unknown): Promise<{ ciphertext: string; iv: string }> {
    return { ciphertext: 'wrapped-dek', iv: 'wrapped-iv' };
  }

  async unsealJson<T>(_payload: { ciphertext: string; iv: string }): Promise<T> {
    throw new Error('not used by cleanup regression');
  }
}

class CleanupFailureBroker extends PrivateDataBroker {
  failObjectId = '';
  readonly attempts: string[] = [];

  override async destroyObject(objectId: string, tenantId?: string, userId?: string): Promise<void> {
    this.attempts.push(objectId);
    if (objectId === this.failObjectId) {
      throw Object.assign(new Error('cleanup failed'), { code: 'PRIVATE_OBJECT_CLEANUP_FAILED' });
    }
    await super.destroyObject(objectId, tenantId, userId);
  }
}

test('expired cleanup surfaces failure, continues later objects, and retries the failed object', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-cleanup-'));
  let now = Date.now();
  const broker = new CleanupFailureBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 1024 * 1024 },
    new FakeVault(),
    { requireTmpfs: false, cleanupIntervalMs: 0, now: () => now },
  );
  const firstBytes = Buffer.from('first-expired-private-object');
  const secondBytes = Buffer.from('second-expired-private-object');

  try {
    await broker.ready();
    const first = await broker.createObject({ tenantId: 'tenant-cleanup', userId: 'user-cleanup', name: 'first.txt', contentType: 'text/plain', bytes: firstBytes });
    const second = await broker.createObject({ tenantId: 'tenant-cleanup', userId: 'user-cleanup', name: 'second.txt', contentType: 'text/plain', bytes: secondBytes });
    broker.failObjectId = first.objectId;
    now += privateDataPolicy.absoluteTtlSeconds * 1000 + 1;

    await assert.rejects(
      broker.cleanupExpired(),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'PRIVATE_OBJECT_CLEANUP_FAILED',
    );
    assert.equal(broker.attempts.includes(first.objectId), true, 'failed expired object must be attempted');
    assert.equal(broker.attempts.includes(second.objectId), true, 'later expired objects must still be attempted');
    await readFile(join(root, first.objectId, 'manifest.json'));
    await assert.rejects(readFile(join(root, second.objectId, 'manifest.json')), /ENOENT/);

    broker.failObjectId = '';
    assert.equal(await broker.cleanupExpired(), 1, 'failed expired object must remain retryable');
    await assert.rejects(readFile(join(root, first.objectId, 'manifest.json')), /ENOENT/);
  } finally {
    broker.failObjectId = '';
    firstBytes.fill(0);
    secondBytes.fill(0);
    await broker.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('periodic cleanup source contract reports failures instead of silently swallowing them', async () => {
  const source = await readFile(new URL('../src/private-data-broker.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('this.cleanupExpired().catch(() => undefined)'), false);
  assert.equal(source.includes("event: 'private_broker_cleanup_failed'"), true);
  assert.equal(source.includes("code: errorCode(error) || 'PRIVATE_OBJECT_CLEANUP_FAILED'"), true);
});
