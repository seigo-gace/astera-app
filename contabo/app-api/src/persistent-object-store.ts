export type PersistentObjectProtocol = 'tgs-legacy-v15' | 'tgs-native-v1';

export type LegacyTelegramObjectLocator = {
  kind: 'tgs-legacy-v15';
  topicId: number;
  messageId: number;
  telegramFileId: string;
};

export type NativeLogicalObjectLocator = {
  kind: 'tgs-native-v1';
  objectId: string;
  operationId?: string;
};

export type PersistentObjectLocator = LegacyTelegramObjectLocator | NativeLogicalObjectLocator;

export type PersistentObjectPutInput = {
  objectId: string;
  ownerId: string;
  fileName: string;
  fileSize: number;
  body: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
};

export type PersistentObjectPutResult = {
  objectId: string;
  protocol: PersistentObjectProtocol;
  locator: PersistentObjectLocator;
  fileSize: number;
  status: string;
  waitedInQueue?: boolean;
};

export type PersistentObjectReadInput = {
  objectId: string;
  ownerId: string;
  locator: PersistentObjectLocator;
  fileName: string;
  signal?: AbortSignal;
};

export type PersistentObjectDeleteInput = {
  objectId: string;
  ownerId: string;
  locator: PersistentObjectLocator;
  signal?: AbortSignal;
};

/**
 * App-owned persistent binary boundary.
 *
 * The caller owns Astera User/Project/Folder/File semantics. Implementations own
 * only the provider protocol translation. Raw Telegram locator fields are allowed
 * exclusively for the legacy v1.5 compatibility variant; Native v1 callers use
 * logical object identity and never choose Telegram group/topic/message placement.
 */
export interface PersistentObjectStore {
  readonly configured: boolean;
  put(input: PersistentObjectPutInput): Promise<PersistentObjectPutResult>;
  read(input: PersistentObjectReadInput): Promise<Response>;
  delete(input: PersistentObjectDeleteInput): Promise<void>;
}

export function requireLegacyLocator(locator: PersistentObjectLocator): LegacyTelegramObjectLocator {
  if (locator.kind !== 'tgs-legacy-v15') {
    throw new Error('PERSISTENT_OBJECT_LEGACY_LOCATOR_REQUIRED');
  }
  return locator;
}
