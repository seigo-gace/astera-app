import type {
  PersistentObjectDeleteInput,
  PersistentObjectPutInput,
  PersistentObjectPutResult,
  PersistentObjectReadInput,
  PersistentObjectStore,
} from './persistent-object-store.js';
import { requireLegacyLocator } from './persistent-object-store.js';

export type TgserverLegacyV15ClientLike = {
  readonly configured: boolean;
  upload(input: {
    objectId: string;
    userId: string;
    fileName: string;
    fileSize: number;
    body: ReadableStream<Uint8Array>;
    signal?: AbortSignal;
  }): Promise<{
    file_id: string;
    topic_id: number;
    message_id: number;
    telegram_file_id: string;
    file_size: number;
    status: string;
    waited_in_queue?: boolean;
  }>;
  download(input: {
    userId: string;
    topicId: number;
    messageId: number;
    telegramFileId: string;
    fileName: string;
    signal?: AbortSignal;
  }): Promise<Response>;
  delete(input: {
    userId: string;
    topicId: number;
    messageId: number;
    telegramFileId: string;
    signal?: AbortSignal;
  }): Promise<void>;
};

/**
 * Compatibility adapter for the current TGserver v1.5 user-storage API.
 *
 * This is the only new App-side boundary that should understand topic/message/file
 * locators. vNext integrations must implement PersistentObjectStore using logical
 * object identity instead of reusing this physical locator contract.
 */
export class TgserverLegacyV15ObjectStore implements PersistentObjectStore {
  constructor(private readonly client: TgserverLegacyV15ClientLike) {}

  get configured(): boolean {
    return this.client.configured;
  }

  async put(input: PersistentObjectPutInput): Promise<PersistentObjectPutResult> {
    const stored = await this.client.upload({
      objectId: input.objectId,
      userId: input.ownerId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      body: input.body,
      signal: input.signal,
    });
    return {
      objectId: input.objectId,
      protocol: 'tgs-legacy-v15',
      locator: {
        kind: 'tgs-legacy-v15',
        topicId: stored.topic_id,
        messageId: stored.message_id,
        telegramFileId: stored.telegram_file_id,
      },
      fileSize: stored.file_size,
      status: stored.status,
      waitedInQueue: stored.waited_in_queue,
    };
  }

  read(input: PersistentObjectReadInput): Promise<Response> {
    const locator = requireLegacyLocator(input.locator);
    return this.client.download({
      userId: input.ownerId,
      topicId: locator.topicId,
      messageId: locator.messageId,
      telegramFileId: locator.telegramFileId,
      fileName: input.fileName,
      signal: input.signal,
    });
  }

  async delete(input: PersistentObjectDeleteInput): Promise<void> {
    const locator = requireLegacyLocator(input.locator);
    await this.client.delete({
      userId: input.ownerId,
      topicId: locator.topicId,
      messageId: locator.messageId,
      telegramFileId: locator.telegramFileId,
      signal: input.signal,
    });
  }
}
