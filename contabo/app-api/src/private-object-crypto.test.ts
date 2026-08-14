import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrivateObjectDekMaterial,
  privateObjectCryptoContract,
  PrivateObjectCryptoError,
  PrivateObjectCryptoSession,
  wipePrivateBytes,
} from './private-object-crypto.js';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function nonceHex(sealed: Uint8Array): string {
  return Buffer.from(sealed.slice(0, privateObjectCryptoContract.nonceBytes)).toString('hex');
}

test('Private Object DEK is 256-bit, non-extractable, and wipeable', async () => {
  const material = await createPrivateObjectDekMaterial();
  assert.equal(material.raw.byteLength, 32);
  assert.equal(material.key.extractable, false);
  assert.equal(material.key.algorithm.name, 'AES-GCM');
  assert.equal((material.key.algorithm as AesKeyAlgorithm).length, 256);
  assert.deepEqual([...material.key.usages].sort(), ['decrypt', 'encrypt']);
  assert.ok(material.raw.some((value) => value !== 0));
  wipePrivateBytes(material.raw);
  assert.ok(material.raw.every((value) => value === 0));
});

test('Private chunk round-trips Japanese, emoji, and binary bytes', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-roundtrip', material.key);
    const payload = new Uint8Array([...utf8('日本語の本文🌌'), 0, 255, 17, 128]);
    const sealed = await session.sealChunk(0, payload);
    const opened = await session.openChunk(sealed.manifest, sealed.sealed);
    assert.deepEqual(opened, payload);
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('Manifest exposes only Order, Chunk Hash, and GCM Tag', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-manifest', material.key);
    const sealed = await session.sealChunk(7, utf8('manifest'));
    assert.deepEqual(Object.keys(sealed.manifest).sort(), ['hashSha256', 'order', 'tagBase64']);
    assert.equal(sealed.manifest.order, 7);
    assert.match(sealed.manifest.hashSha256, /^[0-9a-f]{64}$/);
    assert.equal(Buffer.from(sealed.manifest.tagBase64, 'base64').byteLength, privateObjectCryptoContract.tagBytes);
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('Multiple chunks never reuse a nonce inside one object session', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-nonce', material.key);
    const nonces = new Set<string>();
    for (let order = 0; order < 256; order += 1) {
      const sealed = await session.sealChunk(order, utf8(`chunk-${order}`));
      const nonce = nonceHex(sealed.sealed);
      assert.equal(nonces.has(nonce), false);
      nonces.add(nonce);
    }
    assert.equal(nonces.size, 256);
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('Duplicate chunk order is rejected', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-order', material.key);
    await session.sealChunk(0, utf8('first'));
    await assert.rejects(
      () => session.sealChunk(0, utf8('duplicate')),
      (error: unknown) => error instanceof PrivateObjectCryptoError && error.code === 'PRIVATE_CHUNK_ORDER_DUPLICATED',
    );
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('Encrypted chunk tampering is rejected by SHA-256 before decrypt', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-hash', material.key);
    const sealed = await session.sealChunk(0, utf8('protected'));
    const tampered = sealed.sealed.slice();
    const changedIndex = privateObjectCryptoContract.nonceBytes;
    tampered[changedIndex] = (tampered[changedIndex] ?? 0) ^ 0x01;
    await assert.rejects(
      () => session.openChunk(sealed.manifest, tampered),
      (error: unknown) => error instanceof PrivateObjectCryptoError && error.code === 'PRIVATE_CHUNK_HASH_MISMATCH',
    );
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('Manifest tag tampering is rejected even when encrypted bytes are unchanged', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const session = new PrivateObjectCryptoSession('object-tag', material.key);
    const sealed = await session.sealChunk(0, utf8('protected'));
    const tag = Buffer.from(sealed.manifest.tagBase64, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0x01;
    const badManifest = { ...sealed.manifest, tagBase64: tag.toString('base64') };
    await assert.rejects(
      () => session.openChunk(badManifest, sealed.sealed),
      (error: unknown) => error instanceof PrivateObjectCryptoError && error.code === 'PRIVATE_CHUNK_TAG_MISMATCH',
    );
  } finally {
    wipePrivateBytes(material.raw);
  }
});

test('AAD binds encrypted chunks to object identity and order', async () => {
  const material = await createPrivateObjectDekMaterial();
  try {
    const source = new PrivateObjectCryptoSession('object-a', material.key);
    const otherObject = new PrivateObjectCryptoSession('object-b', material.key);
    const sealed = await source.sealChunk(3, utf8('bound'));
    await assert.rejects(
      () => otherObject.openChunk(sealed.manifest, sealed.sealed),
      (error: unknown) => error instanceof PrivateObjectCryptoError && error.code === 'PRIVATE_CHUNK_DECRYPT_FAILED',
    );
    await assert.rejects(
      () => source.openChunk({ ...sealed.manifest, order: 4 }, sealed.sealed),
      (error: unknown) => error instanceof PrivateObjectCryptoError && error.code === 'PRIVATE_CHUNK_DECRYPT_FAILED',
    );
  } finally {
    wipePrivateBytes(material.raw);
  }
});
