import type { PersistentObjectLocator } from './persistent-object-store.js';
import { StorageApiError } from './storage-api-types.js';

export type StorageTgserverProfile = 'legacy_v15' | 'native_v1';

function required(value: string | null | undefined, code: string): string {
  const normalized = value?.trim() || '';
  if (!normalized) throw new StorageApiError(422, code, `${code} is required.`);
  return normalized;
}

function positiveInteger(
  value: string | null | undefined,
  requiredCode: string,
  invalidCode: string,
): number {
  const parsed = Number(required(value, requiredCode));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorageApiError(422, invalidCode, `${invalidCode} is invalid.`);
  }
  return parsed;
}

export function storageBinaryReferenceFields(locator: PersistentObjectLocator): Record<string, string> {
  if (locator.kind === 'tgs-legacy-v15') {
    return {
      tgs_profile: 'legacy_v15',
      topic_id: String(locator.topicId),
      message_id: String(locator.messageId),
      telegram_file_id: locator.telegramFileId,
    };
  }

  const objectId = locator.objectId.trim();
  if (!objectId) throw new StorageApiError(502, 'TGS_NATIVE_OBJECT_REF_MISSING', 'TGserver logical object reference is missing.');
  const fields: Record<string, string> = {
    tgs_profile: 'native_v1',
    tgs_object_ref: objectId,
  };
  const operationId = locator.operationId?.trim();
  if (operationId) fields.tgs_operation_id = operationId;
  return fields;
}

export function storagePersistentLocatorFromHeaders(headers: Headers): PersistentObjectLocator {
  const profile = (headers.get('x-astera-tgs-profile')?.trim() || 'legacy_v15') as StorageTgserverProfile;
  if (profile === 'legacy_v15') {
    return {
      kind: 'tgs-legacy-v15',
      topicId: positiveInteger(headers.get('x-astera-topic-id'), 'STORAGE_TOPIC_ID_REQUIRED', 'STORAGE_TOPIC_ID_INVALID'),
      messageId: positiveInteger(headers.get('x-astera-message-id'), 'STORAGE_MESSAGE_ID_REQUIRED', 'STORAGE_MESSAGE_ID_INVALID'),
      telegramFileId: required(headers.get('x-astera-telegram-file-id'), 'STORAGE_TELEGRAM_FILE_ID_REQUIRED'),
    };
  }
  if (profile === 'native_v1') {
    const locator: PersistentObjectLocator = {
      kind: 'tgs-native-v1',
      objectId: required(headers.get('x-astera-tgs-object-ref'), 'STORAGE_TGS_OBJECT_REF_REQUIRED'),
    };
    const operationId = headers.get('x-astera-tgs-operation-id')?.trim();
    if (operationId && locator.kind === 'tgs-native-v1') locator.operationId = operationId;
    return locator;
  }
  throw new StorageApiError(422, 'STORAGE_TGS_PROFILE_INVALID', 'TGserver storage profile is invalid.');
}
