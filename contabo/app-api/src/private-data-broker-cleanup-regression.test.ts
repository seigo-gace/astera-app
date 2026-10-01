import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

class FailingVault implements PrivateDataVault {
  async sealJson(_value: unknown): Promise<{ ciphertext: string; iv: string }> {
    throw Object.assign(new Error('vault unavailable'), { code: 'VAULT_UNAVAILABLE' });
  }

  async unsealJson<T>(_payload: { ciphertext: string; iv: string }): Promise<T> {
    throw new Error('not used by create cleanup regression');
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

class CreateCleanupFailureBroker extends PrivateDataBroker {
  failRemoval = true;
  failedObjectId = '';
  readonly removalAttempts: string[] = [];

  protected override async removeObjectDirectory(objectId: string): Promise<void> {
    this.removalAttempts.push(objectId);
    if (this.failRemoval) {
      this.failedObjectId = objectId;
      throw Object.assign(new Error('directory cleanup failed'), { code: 'EACCES' });
    }
    await super.removeObjectDirectory(objectId);
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

test('creation cleanup failure becomes authoritative and the orphan remains retryable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-create-cleanup-'));
  const broker = new CreateCleanupFailureBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 1024 * 1024 },
    new FailingVault(),
    { requireTmpfs: false, cleanupIntervalMs: 0 },
  );
  const bytes = Buffer.from('private-create-cleanup-regression');

  try {
    await broker.ready();
    await assert.rejects(
      broker.createObject({ tenantId: 'tenant-cleanup', userId: 'user-cleanup', name: 'create.txt', contentType: 'text/plain', bytes }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'PRIVATE_OBJECT_CLEANUP_FAILED',
    );
    assert.match(broker.failedObjectId, /^[0-9a-f-]{36}$/i);
    assert.equal((await readdir(root)).includes(broker.failedObjectId), true, 'failed create directory must remain visible until cleanup succeeds');

    broker.failRemoval = false;
    assert.equal(await broker.cleanupExpired(), 0, 'unregistered orphan cleanup must not inflate registered-object removal count');
    assert.equal((await readdir(root)).includes(broker.failedObjectId), false, 'pending create orphan must be removed on retry');
    assert.equal(await broker.cleanupExpired(), 0, 'resolved orphan must not be retried again');
  } finally {
    broker.failRemoval = false;
    bytes.fill(0);
    await broker.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('startup recovery cleanup failure blocks runtime readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-recovery-cleanup-failure-'));
  const broker = new CreateCleanupFailureBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 1024 * 1024 },
    new FakeVault(),
    { requireTmpfs: false, cleanupIntervalMs: 0 },
  );
  const objectId = '33333333-3333-4333-8333-333333333333';

  try {
    await mkdir(join(root, objectId), { recursive: true, mode: 0o700 });
    broker.failRemoval = true;
    await assert.rejects(
      broker.ready(),
      /directory cleanup failed/,
    );
    assert.equal((await readdir(root)).includes(objectId), true, 'recovery cleanup failure must prevent readiness and leave evidence for operator recovery');
  } finally {
    broker.failRemoval = false;
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
