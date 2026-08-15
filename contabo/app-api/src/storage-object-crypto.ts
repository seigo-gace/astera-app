import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ALGORITHM = 'AES-256-GCM';
const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const WRAP_VERSION = 1;
const AAD_VERSION = 'astera-storage-object-v1';

export type VaultEnvelope = Readonly<{ ciphertext: string; iv: string }>;
export type StorageVaultLike = {
  sealJson(value: unknown): Promise<VaultEnvelope>;
  unsealJson<T>(payload: VaultEnvelope): Promise<T>;
};
export type StorageEncryptionMetadata = Readonly<{
  encryptionProfile: typeof ALGORITHM;
  wrappedDek: VaultEnvelope;
  contentIvBase64: string;
}>;
export type StorageEncryptionResult = Readonly<{
  plaintextSha256: string;
  authTagBase64: string;
}>;
export class StorageObjectCryptoError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'StorageObjectCryptoError'; }
}
function requireObjectId(value: string): string { const normalized=value.trim(); if(!normalized) throw new StorageObjectCryptoError('STORAGE_OBJECT_ID_REQUIRED','Storage Object ID is required.'); return normalized; }
function aad(objectId: string): Buffer { return Buffer.from(JSON.stringify([AAD_VERSION, requireObjectId(objectId)]),'utf8'); }
function decodeBase64(value: string, expectedBytes: number, code: string): Buffer { const bytes=Buffer.from(value,'base64'); if(bytes.byteLength!==expectedBytes) { bytes.fill(0); throw new StorageObjectCryptoError(code,code); } return bytes; }
function secureHexEqual(left:string,right:string):boolean { if(!/^[0-9a-f]{64}$/.test(left)||!/^[0-9a-f]{64}$/.test(right)) return false; const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex'); let diff=0; for(let i=0;i<a.length;i+=1) diff|=a[i]^b[i]; return diff===0; }

export async function createStorageEncryptedUpload(
  objectIdValue: string,
  plaintext: ReadableStream<Uint8Array>,
  vault: StorageVaultLike,
): Promise<{ stream: ReadableStream<Uint8Array>; metadata: StorageEncryptionMetadata; completion: Promise<StorageEncryptionResult> }> {
  const objectId=requireObjectId(objectIdValue);
  const rawDek=randomBytes(DEK_BYTES);
  let wrappedDek:VaultEnvelope;
  try {
    wrappedDek=await vault.sealJson({version:WRAP_VERSION,object_id:objectId,algorithm:ALGORITHM,dek_base64:rawDek.toString('base64')});
  } catch(error) { rawDek.fill(0); throw error; }
  const iv=randomBytes(IV_BYTES);
  const cipher=createCipheriv('aes-256-gcm',rawDek,iv,{authTagLength:TAG_BYTES});
  cipher.setAAD(aad(objectId));
  rawDek.fill(0);
  const hash=createHash('sha256');
  const hasher=new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk);}});
  const output=new PassThrough();
  const source=Readable.fromWeb(plaintext as never);
  const completion=pipeline(source,hasher,cipher,output).then<StorageEncryptionResult>(()=>({plaintextSha256:hash.digest('hex'),authTagBase64:cipher.getAuthTag().toString('base64')})).catch((error)=>{throw new StorageObjectCryptoError('STORAGE_ENCRYPT_STREAM_FAILED',error instanceof Error?error.message:'Storage encryption stream failed.');});
  return {
    stream: Readable.toWeb(output) as ReadableStream<Uint8Array>,
    metadata:{encryptionProfile:ALGORITHM,wrappedDek,contentIvBase64:iv.toString('base64')},
    completion,
  };
}

type WrappedDekPayload={version:number;object_id:string;algorithm:string;dek_base64:string};
export async function decryptStorageObjectToFile(input:{
  objectId:string;
  encryptedBody:ReadableStream<Uint8Array>;
  outputPath:string;
  wrappedDek:VaultEnvelope;
  contentIvBase64:string;
  authTagBase64:string;
  expectedSha256:string;
  expectedPlaintextBytes:number;
  vault:StorageVaultLike;
}):Promise<{plaintextSha256:string;plaintextBytesznumber}>{
  const objectId=requireObjectId(input.objectId);
  const payload=await input.vault.unsealJson<WrappedDekPayload>(input.wrappedDek);
  if(payload.version!==WRAP_VERSION||payload.object_id!==objectId||payload.algorithm!==ALGORITHM) throw new StorageObjectCryptoError('STORAGE_WRAPPED_DEK_BINDING_MISMATCH','Wrapped DEK does not match Storage Object.');
  const rawDek=decodeBase64(payload.dek_base64,DEK_BYTES,'STORAGE_WRAPPED_DEK_INVALID');
  const iv=decodeBase64(input.contentIvBase64,IV_BYTES,'STORAGE_CONTENT_IV_INVALID');
  const tag=decodeBase64(input.authTagBase64,TAG_BYTES,'STORAGE_AUTH_TAG_INVALID');
  const decipher=createDecipheriv('aes-256-gcm',rawDek,iv,{authTagLength:TAG_BYTES});
  rawDek.fill(0);iv.fill(0);
  decipher.setAAD(aad(objectId));decipher.setAuthTag(tag);tag.fill(0);
  const hash=createHash('sha256');let plaintextBytes=0;
  const hasher=new Transform({transform(chunk,_encoding,callback){plaintextBytes+=Buffer.byteLength(chunk);hash.update(chunk);callback(null,chunk);}});
  try {
    await pipeline(Readable.fromWeb(input.encryptedBody as never),decipher,hasher,createWriteStream(input.outputPath,{flags:'wx', mode:0o600}));
  } catch(error) {
    await rm(input.outputPath,{force:true}).catch(()=>undefined);
    throw new StorageObjectCryptoError('STORAGE_GCM_AUTH_FAILED',error instanceof Error?error.message:'Storage object authentication failed.');
  }
  const plaintextSha256=hash.digest('hex');
  if(plaintextBytes!==input.expectedPlaintextBytes){await rm(input.outputPath,{force:true}).catch(()=>undefined);throw new StorageObjectCryptoError('STORAGE_PLAINTEXT_SIZE_MISMATCH','Decrypted size does not match metadata.');}
  if(!secureHexEqual(plaintextSha256,input.expectedSha256)){await rm(input.outputPath,{force:true}).catch(()=>undefined);throw new StorageObjectCryptoError('STORAGE_SHA256_MISMATCH','Decrypted checksum does not match metadata.');}
  return {plaintextSha256,plaintextBytes};
}
export const storageObjectCryptoContract=Object.freeze({algorithm:ALGORITHM,dekBytes:DEK_BYTES,ivBytes:IV_BYTES,authTagBytes:TAG_BYTES,aadVersion:AAD_VERSION});
