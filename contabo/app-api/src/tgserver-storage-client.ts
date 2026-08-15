import type { RuntimeConfig } from './config.js';

export class TgserverStorageError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = 'TgserverStorageError';
  }
}

type UploadResult = {
  file_id: string;
  topic_id: number;
  message_id: number;
  file_size: number;
  status: string;
  waited_in_queue?: boolean;
};

export class TgserverStorageClient {
  constructor(private readonly config: RuntimeConfig) {}

  get configured(): boolean {
    return Boolean(this.config.tgserverStorageOrigin && this.config.tgserverStorageToken);
  }

  private url(path: string): string {
    if (!this.config.tgserverStorageOrigin || !this.config.tgserverStorageToken) {
      throw new TgserverStorageError('TGS_STORAGE_NOT_CONFIGURED', 503);
    }
    return new URL(path, `${this.config.tgserverStorageOrigin}/`).toString();
  }

  private async request(path: string, init: RequestInit & { duplex?: 'half' }, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('tgs_storage_timeout'), this.config.tgserverStorageTimeoutMs);
    const onAbort = () => controller.abort(signal?.reason || 'client_cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${this.config.tgserverStorageToken}`);
      const response = await fetch(this.url(path), { ...init, headers, signal: controller.signal });
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => null) as { code?: string } | null;
        throw new TgserverStorageError(payload?.code || `TGS_STORAGE_HTTP_${response.status}`, response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof TgserverStorageError) throw error;
      if (controller.signal.aborted) throw new TgserverStorageError('TGS_STORAGE_TIMEOUT', 504);
      throw new TgserverStorageError('TGS_STORAGE_UNAVAILABLE', 502);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async upload(input: {
    objectId: string;
    userId: string;
    fileName: string;
    fileSize: number;
    body: ReadableStream<Uint8Array>;
    signal?: AbortSignal;
  }): Promise<UploadResult> {
    const response = await this.request(`/internal/storage/files/${encodeURIComponent(input.objectId)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(input.fileSize),
        'x-astera-user-id': input.userId,
        'x-astera-file-name': encodeURIComponent(input.fileName),
        'x-astera-file-size': String(input.fileSize),
        'x-astera-private-mode': '0',
      },
      body: input.body,
      duplex: 'half',
    }, input.signal);
    return await response.json() as UploadResult;
  }

  async download(input: {
    userId: string;
    topicId: number;
    messageId: number;
    fileName: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const query = new URLSearchParams({ user_id: input.userId, topic_id: String(input.topicId), file_name: input.fileName });
    return this.request(`/internal/storage/files/${input.messageId}?${query.toString()}`, { method: 'GET' }, input.signal);
  }

  async delete(input: { userId: string; topicId: number; messageId: number; signal?: AbortSignal }): Promise<void> {
    await this.request(`/internal/storage/files/${input.messageId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: input.userId, topic_id: input.topicId }),
    }, input.signal);
  }
}
