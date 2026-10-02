import type {
  PersistentObjectDeleteInput,
  PersistentObjectPutInput,
  PersistentObjectPutResult,
  PersistentObjectReadInput,
  PersistentObjectStore,
} from './persistent-object-store.js';
import {
  TgserverNativeV1Error,
  type TgserverNativeV1DeleteResult,
  type TgserverNativeV1RegisterResult,
  type TgserverNativeV1WriteResult,
} from './tgserver-native-v1-client.js';

export interface TgserverNativeV1ClientLike {
  readonly configured: boolean;
  register(input: {
    objectKey: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1RegisterResult>;
  write(input: {
    objectId: string;
    fileSize: number;
    body: ReadableStream<Uint8Array>;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1WriteResult>;
  read(input: {
    objectId: string;
    signal?: AbortSignal;
  }): Promise<Response>;
  remove(input: {
    objectId: string;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TgserverNativeV1DeleteResult>;
}

function appObjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('PERSISTENT_OBJECT_ID_INVALID');
  }
  return normalized;
}

function key(operation: 'register' | 'write' | 'delete', objectId: string): string {
  return `astera-object:${operation}:${appObjectId(objectId)}`;
}

function nativeObjectId(input: PersistentObjectReadInput | PersistentObjectDeleteInput): string {
  if (input.locator.kind !== 'tgs-native-v1') {
    throw new Error('PERSISTENT_OBJECT_NATIVE_LOCATOR_REQUIRED');
  }
  return input.locator.objectId;
}

/**
 * Native TGserver v1 adapter for the App-owned persistent object boundary.
 *
 * The scoped TGserver credential owns tenant/namespace identity. ownerId is
 * intentionally never translated into route/topic/group data here. TGserver owns
 * logical route resolution and every physical Telegram placement decision.
 *
 * This class is intentionally not wired into the current runtime yet. It becomes
 * selectable only after the isolated TGserver vNext runtime and App cutover gate
 * are approved.
 */
export class TgserverNativeV1ObjectStore implements PersistentObjectStore {
  constructor(private readonly client: TgserverNativeV1ClientLike) {}

  get configured(): boolean {
    return this.client.configured;
  }

  async put(input: PersistentObjectPutInput): Promise<PersistentObjectPutResult> {
    const logicalId = appObjectId(input.objectId);
    const registerInput: Parameters<TgserverNativeV1ClientLike['register']>[0] = {
      objectKey: logicalId,
      idempotencyKey: key('register', logicalId),
    };
    if (input.signal) registerInput.signal = input.signal;
    const registered = await this.client.register(registerInput);

    const writeInput: Parameters<TgserverNativeV1ClientLike['write']>[0] = {
      objectId: registered.objectId,
      fileSize: input.fileSize,
      body: input.body,
      idempotencyKey: key('write', logicalId),
    };
    if (input.signal) writeInput.signal = input.signal;
    const written = await this.client.write(writeInput);
    if (written.objectId !== registered.objectId) {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_ID_MISMATCH', 502);
    }
    if (written.status === 'reconciliation_required') {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_RECONCILIATION_REQUIRED', 202);
    }
    if (written.status === 'retryable_failure') {
      throw new TgserverNativeV1Error(
        written.code || 'TGS_NATIVE_OBJECT_RETRYABLE_FAILURE',
        written.retryAfterMs === undefined ? 503 : 429,
        written.retryAfterMs,
      );
    }
    if (written.logicalBytes !== undefined && written.logicalBytes !== input.fileSize) {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_SIZE_MISMATCH', 502);
    }

    return {
      objectId: logicalId,
      protocol: 'tgs-native-v1',
      locator: { kind: 'tgs-native-v1', objectId: registered.objectId },
      fileSize: written.logicalBytes ?? input.fileSize,
      status: written.status,
    };
  }

  read(input: PersistentObjectReadInput): Promise<Response> {
    const request: Parameters<TgserverNativeV1ClientLike['read']>[0] = {
      objectId: nativeObjectId(input),
    };
    if (input.signal) request.signal = input.signal;
    return this.client.read(request);
  }

  async delete(input: PersistentObjectDeleteInput): Promise<void> {
    const result = await this.client.remove({
      objectId: nativeObjectId(input),
      idempotencyKey: key('delete', input.objectId),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (result.status !== 'deleted') {
      throw new TgserverNativeV1Error('TGS_NATIVE_OBJECT_DELETE_PENDING', 202);
    }
  }
}
