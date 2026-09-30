import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PrivateDataBroker, PrivateDataBrokerError, privateDataPolicy, type PrivateDataVault } from './private-data-broker.js';

class FakeVault implements PrivateDataVault {
  readonly master = randomBytes(32);
  sealCalls = 0;
  unsealCalls = 0;
  failSeal = false;

  async sealJson(value: unknown): Promise<{ ciphertext: string; iv: string }> {
    this.sealCalls += 1;
    if (this.failSeal) throw Object.assign(new Error('vault wrap failed'), { code: 'LIBRAL_VAULT_UNAVAILABLE' });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, iv);
    const plain = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    try { return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64') }; }
    finally { plain.fill(0); encrypted.fill(0); iv.fill(0); }
  }

  async unsealJson<T>(payload: { ciphertext: string; iv: string }): Promise<T> {
    this.unsealCalls += 1;
    const iv = Buffer.from(payload.iv, 'base64');
    const encrypted = Buffer.from(payload.ciphertext, 'base64');
    const tag = encrypted.subarray(encrypted.byteLength - 16);
    const body = encrypted.subarray(0, encrypted.byteLength - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.master, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    try { return JSON.parse(plain.toString('utf8')) as T; }
    finally { plain.fill(0); encrypted.fill(0); iv.fill(0); }
  }

  close(): void { this.master.fill(0); }
}

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-broker-'));
  const vault = new FakeVault();
  let now = Date.now();
  const broker = new PrivateDataBroker({ privateDataTmpDir: root, privateUploadMaxBytes: 32 * 1024 * 1024 }, vault, { requireTmpfs: false, cleanupIntervalMs: 0, now: () => now });
  await broker.ready();
  return {
    root, vault, broker, now: () => now,
    advance(ms: number) { now += ms; },
    async dispose() { await broker.close().catch(() => undefined); vault.close(); await rm(root, { recursive: true, force: true }); },
  };
}

test('private broker encrypts locally, wraps only the object DEK in Vault, roundtrips, and destroys the temporary object', async () => {
  const env = await sandbox();
  try {
    const canary = 'PRIVATE-CANARY-PLAINTEXT-MUST-NOT-REMAIN';
    const bytes = Buffer.from(`${canary}\n${'x'.repeat(128 * 1024)}`, 'utf8');
    const created = await env.broker.createObject({ tenantId: 'tenant-1', userId: 'user-1', name: 'evidence.txt', contentType: 'text/plain', bytes });
    assert.match(created.storageKey, /^private:/);
    assert.equal(env.vault.sealCalls, 1, 'Vault must wrap one DEK, not each file chunk');
    const objectDir = join(env.root, created.objectId);
    const files = await readdir(objectDir);
    assert.ok(files.includes('0.agcm'));
    const sealed = await readFile(join(objectDir, '0.agcm'));
    assert.equal(sealed.includes(Buffer.from(canary)), false);
    const manifest = await readFile(join(objectDir, 'manifest.json'), 'utf8');
    assert.equal(manifest.includes(canary), false);
    assert.equal(manifest.includes('keyRef'), false);
    assert.equal(manifest.includes('wrappedDek'), true);
    const restored = await env.broker.readObject(created.objectId, 'tenant-1', 'user-1');
    assert.equal(Buffer.from(restored).equals(bytes), true);
    assert.equal(env.vault.unsealCalls, 1);
    restored.fill(0);
    await env.broker.destroyObject(created.objectId, 'tenant-1', 'user-1');
    await assert.rejects(readFile(join(objectDir, 'manifest.json')), /ENOENT/);
    bytes.fill(0);
  } finally { await env.dispose(); }
});

test('private broker refuses cross-owner reads without exposing object existence', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('owner-bound-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-1', userId: 'user-1', name: 'owner.txt', contentType: 'text/plain', bytes });
    await assert.rejects(env.broker.readObject(created.objectId, 'tenant-1', 'user-2'), (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_NOT_FOUND' && error.status === 404);
    bytes.fill(0);
  } finally { await env.dispose(); }
});

test('private broker upload idle TTL removes a sealed object that never reaches runtime', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('idle-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-idle', userId: 'user-idle', name: 'idle.txt', contentType: 'text/plain', bytes });
    const manifestPath = join(env.root, created.objectId, 'manifest.json');
    env.advance(privateDataPolicy.uploadIdleTtlSeconds * 1000 - 1);
    assert.equal(await env.broker.cleanupExpired(), 0);
    await readFile(manifestPath);
    env.advance(2);
    assert.equal(await env.broker.cleanupExpired(), 1);
    await assert.rejects(readFile(manifestPath), /ENOENT/);
    bytes.fill(0);
  } finally { await env.dispose(); }
});

test('private broker absolute TTL cleanup removes ciphertext and wrapped DEK together', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('ttl-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-ttl', userId: 'user-ttl', name: 'ttl.txt', contentType: 'text/plain', bytes });
    env.advance(privateDataPolicy.absoluteTtlSeconds * 1000 + 1);
    assert.equal(await env.broker.cleanupExpired(), 1);
    await assert.rejects(env.broker.readObject(created.objectId, 'tenant-ttl', 'user-ttl'), (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_NOT_FOUND');
    await assert.rejects(readFile(join(env.root, created.objectId, 'manifest.json')), /ENOENT/);
    bytes.fill(0);
  } finally { await env.dispose(); }
});

test('correct owner can explicitly destroy an expired object while cross-owner destroy remains hidden', async () => {
  const env = await sandbox();
  try {
    const bytes = Buffer.from('expired-owner-destroy-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-expired', userId: 'user-expired', name: 'expired.txt', contentType: 'text/plain', bytes });
    const manifestPath = join(env.root, created.objectId, 'manifest.json');
    env.advance(privateDataPolicy.absoluteTtlSeconds * 1000 + 1);
    await assert.rejects(
      env.broker.readObject(created.objectId, 'tenant-expired', 'user-expired'),
      (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_EXPIRED' && error.status === 410,
    );
    await assert.rejects(
      env.broker.destroyObject(created.objectId, 'tenant-expired', 'other-user'),
      (error: unknown) => error instanceof PrivateDataBrokerError && error.code === 'PRIVATE_OBJECT_NOT_FOUND' && error.status === 404,
    );
    await env.broker.destroyObject(created.objectId, 'tenant-expired', 'user-expired');
    await assert.rejects(readFile(manifestPath), /ENOENT/);
    bytes.fill(0);
  } finally { await env.dispose(); }
});

test('private broker startup recovery cleans an expired recovered object', async () => {
  const env = await sandbox();
  let recovered: PrivateDataBroker | null = null;
  try {
    const bytes = Buffer.from('recovery-expired-private-file');
    const created = await env.broker.createObject({ tenantId: 'tenant-recovery', userId: 'user-recovery', name: 'recovery.txt', contentType: 'text/plain', bytes });
    env.advance(privateDataPolicy.absoluteTtlSeconds * 1000 + 1);
    recovered = new PrivateDataBroker({ privateDataTmpDir: env.root, privateUploadMaxBytes: 32 * 1024 * 1024 }, env.vault, { requireTmpfs: false, cleanupIntervalMs: 0, now: env.now });
    await recovered.ready();
    await assert.rejects(readFile(join(env.root, created.objectId, 'manifest.json')), /ENOENT/);
    bytes.fill(0);
  } finally { await recovered?.close().catch(() => undefined); await env.dispose(); }
});

test('private broker removes temporary state when Vault DEK wrapping fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-broker-wrap-fail-'));
  const vault = new FakeVault();
  vault.failSeal = true;
  const broker = new PrivateDataBroker({ privateDataTmpDir: root, privateUploadMaxBytes: 20 * 1024 * 1024 }, vault, { requireTmpfs: false, cleanupIntervalMs: 0 });
  await broker.ready();
  try {
    const bytes = Buffer.from('wrap-fail-private-file');
    await assert.rejects(broker.createObject({ tenantId: 'tenant', userId: 'user', name: 'wrap-fail.txt', contentType: 'text/plain', bytes }), /vault wrap failed/);
    assert.deepEqual(await readdir(root), []);
    bytes.fill(0);
  } finally { await broker.close().catch(() => undefined); vault.close(); await rm(root, { recursive: true, force: true }); }
});
