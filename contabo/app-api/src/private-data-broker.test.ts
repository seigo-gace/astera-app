import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PrivateDataBroker, PrivateDataBrokerError, privateDataPolicy, type PrivateDataVault } from './private-data-broker.js';

class FakeVault implements PrivateDataVault {
  readonly keys = new Map<string, Buffer>();
  readonly removed: string[] = [];
  readonly expiries: number[] = [];
  private sequence = 0;

  async storeSecret(input: { value: Uint8Array; allowedConsumers: string[]; expiresAt?: number }): Promise<string> {
    assert.deepEqual(input.allowedConsumers, ['astera-private-broker']);
    assert.equal(input.value.byteLength, 32);
    assert.ok(input.expiresAt && input.expiresAt > Date.now());
    const id = `private-test-${++this.sequence}`;
    this.keys.set(id, Buffer.from(input.value));
    this.expiries.push(input.expiresAt!);
    return id;
  }

  async sealBytes(input: { keyRef: string; consumer: string; value: Uint8Array }): Promise<{ ciphertext: string; iv: string }> {
    assert.equal(input.consumer, 'astera-private-broker');
    const key = this.keys.get(input.keyRef);
    if (!key) throw Object.assign(new Error('missing key'), { code: 'VAULT_SECRET_NOT_FOUND' });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(input.value), cipher.final(), cipher.getAuthTag()]);
    try {
      return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64') };
    } finally {
      iv.fill(0);
      ciphertext.fill(0);
    }
  }

  async unsealBytes(input: { keyRef: string; consumer: string; ciphertext: string; iv: string }): Promise<Uint8Array> {
    assert.equal(input.consumer, 'astera-private-broker');
    const key = this.keys.get(input.keyRef);
    if (!key) throw Object.assign(new Error('missing key'), { code: 'VAULT_SECRET_NOT_FOUND' });
    const iv = Buffer.from(input.iv, 'base64');
    const encrypted = Buffer.from(input.ciphertext, 'base64');
    const tag = encrypted.subarray(encrypted.byteLength - 16);
    const body = encrypted.subarray(0, encrypted.byteLength - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    iv.fill(0);
    encrypted.fill(0);
    return plaintext;
  }

  async removeSecret(input: { secretId: string; consumer: string }): Promise<void> {
    assert.equal(input.consumer, 'astera-private-broker');
    this.keys.get(input.secretId)?.fill(0);
    this.keys.delete(input.secretId);
    this.removed.push(input.secretId);
  }
}

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-broker-'));
  const vault = new FakeVault();
  let now = Date.now();
  const broker = new PrivateDataBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 32 * 1024 * 1024 },
    vault,
    { requireTmpfs: false, cleanupIntervalMs: 0, now: () => now },
  );
  await broker.ready();
  return {
    root,
    vault,
    broker,
    now: () => now,
    advance(ms: number) { now += ms; },
    async dispose() {
      await broker.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('private broker encrypts bytes on disk, reads them back, and destroys key plus object', async () => {
  const env = await sandbox();
  try {
    const canary = 'PRIVATE-CANARY-PLAINTEXT-MUST-NOT-REMAIN';
    const bytes = Buffer.from(`${canary}\n${'x'.repeat(128 * 1024)}`, 'utf8');
    const created = await env.broker.createObject({ tenantId: 'tenant-1', userId: 'user-1', name: 'evidence.txt', contentType: 'text/plain', bytes });
    assert.match(created.storageKey, /^private:/);
    assert.equal(created.sizeBytes, bytes.byteLength);
    assert.equal(env.vault.keys.size, 1);

    const objectDir = join(env.root, created.objectId);
    assert.ok((await readdir(objectDir)).includes('0.agcm'));
    const sealed = await readFile(join(objectDir, '0.agcm'));
    assert.equal(sealed.includes(Buffer.from(canary)), false, 'plaintext canary must not appear in encrypted chunk');
    const manifest = await readFile(join(objectDir, 'manifest.json'), 'utf8');
    assert.equal(manifest.includes(canary), false, 'plaintext canary must not appear in manifest');

    const restored = await env.broker.readObject(created.objectId, 'tenant-1', 'user-1');
    assert.equal(Buffer.from(restored).equals(bytes), true);
    restored.fill(0);
    await env.broker.destroyObject(created.objectId, 'tenant-1', 'user-1');
    assert.equal(env.vault.keys.size, 0);
    assert.equal(env.vault.removed.length, 1);
    await assert.rejects(readFile(join(objectDir, 'manifest.json')), /ENOENT/);
    bytes.fill(0);
  } finally {
    await env.dispose();
  }
});

test('private broker refuses cross-owner reads without exposing object existence', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('owner-bound-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-1', userId: 'user-1', name: 'owner.txt', contentType: 'text/plain', bytes });
    await assert.rejects(
      env.broker.readObject(created.objectId, 'tenant-1', 'user-2'),
      (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_NOT_FOUND' && error.status === 404,
    );
    bytes.fill(0);
  } finally {
    await env.dispose();
  }
});

test('private broker absolute TTL cleanup revokes the Vault key and removes ciphertext', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('ttl-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-ttl', userId: 'user-ttl', name: 'ttl.txt', contentType: 'text/plain', bytes });
    env.advance(privateDataPolicy.absoluteTtlSeconds * 1000 + 1);
    assert.equal(await env.broker.cleanupExpired(), 1);
    assert.equal(env.vault.keys.size, 0);
    await assert.rejects(
      env.broker.readObject(created.objectId, 'tenant-ttl', 'user-ttl'),
      (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_NOT_FOUND',
    );
    bytes.fill(0);
  } finally {
    await env.dispose();
  }
});

test('private broker startup recovery cleans an expired recovered object', async () => {
  const env = await sandbox();
  let recovered: PrivateDataBroker | null = null;
  try {
    const bytes = Buffer.from('recovery-expired-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-recovery', userId: 'user-recovery', name: 'recovery.txt', contentType: 'text/plain', bytes });
    env.advance(privateDataPolicy.absoluteTtlSeconds * 1000 + 1);
    recovered = new PrivateDataBroker(
      { privateDataTmpDir: env.root, privateUploadMaxBytes: 32 * 1024 * 1024 },
      env.vault,
      { requireTmpfs: false, cleanupIntervalMs: 0, now: env.now },
    );
    await recovered.ready();
    assert.equal(env.vault.keys.size, 0);
    assert.ok(env.vault.removed.length >= 1);
    await assert.rejects(readFile(join(env.root, created.objectId, 'manifest.json')), /ENOENT/);
    bytes.fill(0);
  } finally {
    await recovered?.close().catch(() => undefined);
    await env.dispose();
  }
});

test('private broker removes the object directory when Vault key creation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-broker-key-fail-'));
  const vault = new FakeVault();
  vault.storeSecret = async () => { throw Object.assign(new Error('key store failed'), { code: 'LIBRAL_VAULT_UNAVAILABLE' }); };
  const broker = new PrivateDataBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 20 * 1024 * 1024 },
    vault,
    { requireTmpfs: false, cleanupIntervalMs: 0 },
  );
  await broker.ready();
  try {
    const bytes = Buffer.from('key-store-fail-private-file');
    await assert.rejects(broker.createObject({ tenantId: 'tenant', userId: 'user', name: 'key-fail.txt', contentType: 'text/plain', bytes }), /key store failed/);
    assert.deepEqual(await readdir(root), []);
    bytes.fill(0);
  } finally {
    await broker.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('private broker cleans partial filesystem state when Vault seal fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-broker-fail-'));
  const vault = new FakeVault();
  const originalSeal = vault.sealBytes.bind(vault);
  let calls = 0;
  vault.sealBytes = async (input) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('seal failed'), { code: 'LIBRAL_VAULT_UNAVAILABLE' });
    return originalSeal(input);
  };
  const broker = new PrivateDataBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 20 * 1024 * 1024 },
    vault,
    { requireTmpfs: false, cleanupIntervalMs: 0 },
  );
  await broker.ready();
  try {
    const bytes = Buffer.from('fail-closed-private-file');
    await assert.rejects(broker.createObject({ tenantId: 'tenant', userId: 'user', name: 'fail.txt', contentType: 'text/plain', bytes }), /seal failed/);
    assert.equal(vault.keys.size, 0);
    assert.deepEqual(await readdir(root), []);
    bytes.fill(0);
  } finally {
    await broker.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
