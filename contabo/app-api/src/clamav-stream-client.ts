import { Socket } from 'node:net';

const CLAMAV_CHUNK_BYTES = 64 * 1024;
const CLAMAV_RESPONSE_LIMIT_BYTES = 8 * 1024;

export class FileSecurityPipelineError extends Error {
  constructor(
    public readonly code: 'MALWARE_DETECTED' | 'PRIVATE_PIPELINE_UNAVAILABLE',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'FileSecurityPipelineError';
  }
}

export type ClamAvStreamClientConfig = Readonly<{
  host: string;
  port: number;
  timeoutMs: number;
}>;

function unavailable(message: string): FileSecurityPipelineError {
  return new FileSecurityPipelineError('PRIVATE_PIPELINE_UNAVAILABLE', message, true);
}

function parseClamAvResponse(raw: string): void {
  const response = raw.replace(/\0+$/g, '').trim();
  if (/^stream:\s+OK$/i.test(response)) return;
  if (/^stream:\s+.+\s+FOUND$/i.test(response)) {
    throw new FileSecurityPipelineError('MALWARE_DETECTED', 'Malware scan rejected the supplied file.', false);
  }
  throw unavailable('Malware scanner returned an invalid or error response.');
}

export class ClamAvStreamClient {
  constructor(private readonly config: ClamAvStreamClientConfig) {}

  async scan(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (!this.config.host.trim() || !Number.isSafeInteger(this.config.port) || this.config.port < 1 || this.config.port > 65_535) {
      throw unavailable('Malware scanner is not configured.');
    }
    if (!Number.isSafeInteger(this.config.timeoutMs) || this.config.timeoutMs < 1) {
      throw unavailable('Malware scanner timeout is invalid.');
    }
    if (signal?.aborted) throw unavailable('Malware scan was cancelled.');

    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      let responseBytes = 0;
      const response: Buffer[] = [];
      const timeout = setTimeout(() => finish(unavailable('Malware scanner timed out.')), this.config.timeoutMs);
      timeout.unref?.();

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        socket.removeAllListeners();
        socket.destroy();
      };
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(unavailable('Malware scan was cancelled.'));
      signal?.addEventListener('abort', onAbort, { once: true });

      socket.once('error', () => finish(unavailable('Malware scanner connection failed.')));
      socket.on('data', (chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > CLAMAV_RESPONSE_LIMIT_BYTES) {
          finish(unavailable('Malware scanner response exceeded the safe limit.'));
          return;
        }
        response.push(Buffer.from(chunk));
      });
      socket.once('end', () => {
        try {
          parseClamAvResponse(Buffer.concat(response, responseBytes).toString('utf8'));
          finish();
        } catch (error) {
          finish(error);
        }
      });
      socket.connect(this.config.port, this.config.host, () => {
        socket.write(Buffer.from('zINSTREAM\0', 'ascii'));
        for (let offset = 0; offset < bytes.byteLength; offset += CLAMAV_CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + CLAMAV_CHUNK_BYTES));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.byteLength, 0);
          socket.write(length);
          socket.write(chunk);
        }
        const end = Buffer.alloc(4);
        end.writeUInt32BE(0, 0);
        socket.end(end);
      });
    });
  }
}
