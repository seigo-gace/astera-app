import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createFullApp } from './full-app.js';

const config = loadConfig();
const { app, service } = createFullApp(config);

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

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
  const force = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout', signal }));
    process.exit(1);
  }, config.shutdownTimeoutMs);
  force.unref();
  server.close(async () => {
    for (const controller of service.active.values()) controller.abort('server_shutdown');
    await service.database.close().catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'database_close_failed', error: error instanceof Error ? error.message : String(error) }));
    });
    clearTimeout(force);
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_completed', signal }));
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error(JSON.stringify({ level: 'error', event: 'unhandled_rejection', error: error instanceof Error ? error.message : String(error) }));
});
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', error: error.message }));
  void shutdown('uncaughtException');
});
