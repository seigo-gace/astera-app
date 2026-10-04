import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createFullApp } from './full-app.js';
import { TgServerObservedAsteraRuntimeService } from './tgserver-runtime-service.js';
import { TgServerLogSink } from './tgserver-zero-log.js';

const config = loadConfig();
const tgServerTimeout = Number.parseInt(process.env.TGSERVER_LOG_TIMEOUT_MS ?? '', 10);
const tgServerLogSink = new TgServerLogSink({
  url: process.env.TGSERVER_LOG_URL ?? null,
  timeoutMs: Number.isFinite(tgServerTimeout) && tgServerTimeout > 0 ? tgServerTimeout : 1500,
});
tgServerLogSink.start();

const service = new TgServerObservedAsteraRuntimeService(config, tgServerLogSink);
const { app } = createFullApp(config, service);

await service.database.ready();
await service.recover();

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: '0.0.0.0',
});

console.log(JSON.stringify({
  level: 'info',
  event: 'astera_app_api_started',
  port: config.port,
  process_origin: new URL(config.processOrigin).origin,
}));
tgServerLogSink.log({ level: 'info', event: 'astera_app_api_started' });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
  tgServerLogSink.log({ level: 'info', event: 'shutdown_started', signal });
  const force = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout', signal }));
    tgServerLogSink.log({ level: 'error', event: 'shutdown_timeout', signal });
    void tgServerLogSink.flush().finally(() => process.exit(1));
  }, config.shutdownTimeoutMs);
  force.unref();
  server.close(async () => {
    for (const controller of service.active.values()) controller.abort('server_shutdown');
    await service.database.close().catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'database_close_failed', error: error instanceof Error ? error.message : String(error) }));
      tgServerLogSink.log({ level: 'error', event: 'database_close_failed', code: 'DATABASE_CLOSE_FAILED' });
    });
    clearTimeout(force);
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_completed', signal }));
    tgServerLogSink.log({ level: 'info', event: 'shutdown_completed', signal });
    tgServerLogSink.stop();
    await tgServerLogSink.flush();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error(JSON.stringify({ level: 'error', event: 'unhandled_rejection', error: error instanceof Error ? error.message : String(error) }));
  tgServerLogSink.log({ level: 'error', event: 'unhandled_rejection', code: 'UNHANDLED_REJECTION' });
});
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', error: error.message }));
  tgServerLogSink.log({ level: 'error', event: 'uncaught_exception', code: 'UNCAUGHT_EXCEPTION' });
  void shutdown('uncaughtException');
});
