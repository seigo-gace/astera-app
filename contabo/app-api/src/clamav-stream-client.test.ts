import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import test from 'node:test';
import { ClamAvStreamClient } from './clamav-stream-client.js';

async function withMockClamd(
  response: string,
  run: (port: number, received: () => Buffer) => Promise<void>,
): Promise<void> {
  const chunks: Buffer[] = [];
  const server: Server = createServer((socket) => {
    let pending = Buffer.alloc(0);
    let commandRead = false;
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (true) {
        if (!commandRead) {
          const marker = pending.indexOf(0);
          if (marker < 0) return;
          const command = pending.subarray(0, marker + 1).toString('ascii');
          assert.equal(command, 'zINSTREAM\0');
          pending = pending.subarray(marker + 1);
          commandRead = true;
        }
        if (pending.byteLength < 4) return;
        const size = pending.readUInt32BE(0);
        if (size === 0) {
          pending = pending.subarray(4);
          socket.end(response);
          return;
        }
        if (pending.byteLength < 4 + size) return;
        chunks.push(Buffer.from(pending.subarray(4, 4 + size)));
        pending = pending.subarray(4 + size);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock clamd address unavailable');
  try {
    await run(address.port, () => Buffer.concat(chunks));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('ClamAV INSTREAM sends bytes without a file path and accepts OK', async () => {
  const payload = Buffer.concat([Buffer.alloc(70_000, 0x41), Buffer.from('private-tail')]);
  await withMockClamd('stream: OK\0', async (port, received) => {
    const client = new ClamAvStreamClient({ host: '127.0.0.1', port, timeoutMs: 2_000 });
    await client.scan(payload);
    assert.deepEqual(received(), payload);
  });
});

test('ClamAV FOUND fails closed as MALWARE_DETECTED', async () => {
  await withMockClamd('stream: Eicar-Signature FOUND\0', async (port) => {
    const client = new ClamAvStreamClient({ host: '127.0.0.1', port, timeoutMs: 2_000 });
    await assert.rejects(
      client.scan(Buffer.from('test-body')),
      (error: unknown) => (error as { code?: string }).code === 'MALWARE_DETECTED' && (error as { retryable?: boolean }).retryable === false,
    );
  });
});

test('ClamAV error response fails closed as retryable PRIVATE_PIPELINE_UNAVAILABLE', async () => {
  await withMockClamd('stream: size limit exceeded. ERROR\0', async (port) => {
    const client = new ClamAvStreamClient({ host: '127.0.0.1', port, timeoutMs: 2_000 });
    await assert.rejects(
      client.scan(Buffer.from('test-body')),
      (error: unknown) => (error as { code?: string }).code === 'PRIVATE_PIPELINE_UNAVAILABLE' && (error as { retryable?: boolean }).retryable === true,
    );
  });
});

test('missing scanner configuration fails closed before any scan', async () => {
  const client = new ClamAvStreamClient({ host: '', port: 3310, timeoutMs: 2_000 });
  await assert.rejects(
    client.scan(Buffer.from('test-body')),
    (error: unknown) => (error as { code?: string }).code === 'PRIVATE_PIPELINE_UNAVAILABLE',
  );
});
