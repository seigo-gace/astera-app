import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createFullApp } from './full-app.js';
import { closeRuntimeResources } from './server-shutdown.js';

const config = loadConfig();
const { app, service, privateDataBroker } = createFullApp(config);

await privateDataBroker.ready();
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
  private_broker: 'ready',
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
    const closed = await closeRuntimeResources(privateDataBroker, service.database);
    for (const failure of closed.failures) {
      console.error(JSON.stringify({ level: 'error', ...failure }));
    }
    clearTimeout(force);
    if (!closed.ok) {
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', signal, failure_count: closed.failures.length }));
      process.exit(closed.exitCode);
      return;
    }
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_completed', signal }));
    process.exit(closed.exitCode);
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
