import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PrivateDataBroker, type PrivateDataVault } from './private-data-broker.js';
import { PrivateObjectCryptoSession } from './private-object-crypto.js';

class FakeVault implements PrivateDataVault {
  readonly master = randomBytes(32);

  async sealJson(value: unknown): Promise<{ ciphertext: string; iv: string }> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, iv);
    const plain = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    try { return { ciphertext: encrypted.toString('base64'), iv: iv.toString('base64') }; }
    finally { plain.fill(0); encrypted.fill(0); iv.fill(0); }
  }

  async unsealJson<T>(payload: { ciphertext: string; iv: string }): Promise<T> {
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

test('private broker wipes every decrypted chunk before readObject returns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'astera-private-memory-'));
  const vault = new FakeVault();
  const broker = new PrivateDataBroker(
    { privateDataTmpDir: root, privateUploadMaxBytes: 32 * 1024 * 1024 },
    vault,
    { requireTmpfs: false, cleanupIntervalMs: 0 },
  );
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 4096, 0x61);
  const captured: Uint8Array[] = [];
  const originalOpenChunk = PrivateObjectCryptoSession.prototype.openChunk;
  PrivateObjectCryptoSession.prototype.openChunk = async function (
    this: PrivateObjectCryptoSession,
    manifest: Parameters<typeof originalOpenChunk>[0],
    sealed: Parameters<typeof originalOpenChunk>[1],
  ): Promise<Uint8Array> {
    const plain = await originalOpenChunk.call(this, manifest, sealed);
    captured.push(plain);
    return plain;
  };

  let restored: Uint8Array | null = null;
  try {
    await broker.ready();
    const created = await broker.createObject({
      tenantId: 'tenant-memory',
      userId: 'user-memory',
      name: 'memory.txt',
      contentType: 'text/plain',
      bytes,
    });
    restored = await broker.readObject(created.objectId, 'tenant-memory', 'user-memory');
    assert.equal(captured.length, 2, 'multi-chunk read must exercise every decrypted chunk');
    assert.equal(Buffer.from(restored).equals(bytes), true);
    for (const plain of captured) {
      assert.deepEqual(plain, new Uint8Array(plain.byteLength), 'decrypted chunk must be zeroized before readObject returns');
    }
  } finally {
    PrivateObjectCryptoSession.prototype.openChunk = originalOpenChunk;
    restored?.fill(0);
    bytes.fill(0);
    await broker.close().catch(() => undefined);
    vault.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('private broker source contract forbids plaintext concat and return-copy patterns', async () => {
  const source = await readFile(new URL('../src/private-data-broker.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('Buffer.concat(plains.map'), false);
  assert.equal(source.includes('return new Uint8Array(combined)'), false);
  assert.equal(source.includes("new Uint8Array(Buffer.from(value, 'base64'))"), false);
  assert.equal(source.includes("const bytes = Buffer.from(value, 'base64');"), true);
  assert.equal(source.includes("Buffer.from(material.raw).toString('base64')"), false);
  assert.equal(source.includes("Buffer.from(material.raw.buffer, material.raw.byteOffset, material.raw.byteLength).toString('base64')"), true);
  assert.equal(source.includes('const combined = new Uint8Array(manifest.sizeBytes)'), true);
  assert.equal(source.includes('if (plain) wipePrivateBytes(plain)'), true);
  assert.equal(source.includes('if (!transferred) wipePrivateBytes(combined)'), true);
});
