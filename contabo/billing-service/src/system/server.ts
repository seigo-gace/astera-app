import http from 'node:http';
import type { BillingServiceEnv } from '../part/billing-env.js';
import { createAsteraProjectionClientFromEnv } from '../feature/astera-projection.js';
import { createLibralVaultClientFromEnv } from '../feature/libral-vault.js';
import { handleSquareIngress, handleSquareWebhook } from './handlers-ingress.js';
import { handleBillingCheckoutIntents } from './handlers-billing-checkout.js';
import { handleStorageCheckoutIntents } from './handlers-storage-checkout.js';
import { handleBillingStatus } from './handlers-billing-status.js';
import { handleEnsureGrants } from './handlers-ensure-grants.js';
import { handlePlanSubscription, handlePublicBillingConfig } from './handlers-plan-subscription.js';
import { withResolvedBillingSecrets } from '../part/load-billing-secrets.js';

function loadEnv(): BillingServiceEnv {
  const resolved = withResolvedBillingSecrets(process.env);
  const projection = createAsteraProjectionClientFromEnv(resolved);
  if (!projection) {
    console.error(JSON.stringify({ event: 'billing_projection_required', code: 'PROJECTION_UNAVAILABLE' }));
  }
  return {
    ...resolved,
    vault: createLibralVaultClientFromEnv(process.env),
    projection,
  };
}

function nodeRequestToWeb(request: http.IncomingMessage, body: Buffer): Request {
  const host = request.headers.host ?? '127.0.0.1';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else headers.set(key, value);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = body.length ? body.toString('utf8') : undefined;
  }
  return new Request(url, init);
}

async function sendResponse(nodeResponse: http.ServerResponse, response: Response): Promise<void> {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  nodeResponse.end(buffer);
}

function matchPath(pathname: string, pattern: string): string | null {
  if (pattern.endsWith('/:intent')) {
    const prefix = pattern.slice(0, -':intent'.length);
    if (pathname.startsWith(prefix)) {
      const intent = pathname.slice(prefix.length);
      if (intent && !intent.includes('/')) return intent;
    }
    return null;
  }
  return pathname === pattern ? '' : null;
}

/** Strip /billing prefix when routed via Cloudflare Tunnel at api.asterav8.jp/billing */
function stripBillingPrefix(pathname: string): string {
  if (pathname === '/billing') return '/healthz';
  if (pathname.startsWith('/billing/')) return pathname.slice('/billing'.length);
  return pathname;
}

export function createServer(env: BillingServiceEnv): http.Server {
  return http.createServer((nodeRequest, nodeResponse) => {
    const chunks: Buffer[] = [];
    nodeRequest.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    nodeRequest.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const webRequest = nodeRequestToWeb(nodeRequest, body);
        const rawPathname = new URL(webRequest.url).pathname;
        const pathname = stripBillingPrefix(rawPathname);

        try {
          if (webRequest.method === 'GET' && pathname === '/healthz') {
            await sendResponse(nodeResponse, new Response('ok', { status: 200 }));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/webhooks/square') {
            await sendResponse(nodeResponse, await handleSquareWebhook(webRequest, env));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/ingress/square-payments') {
            await sendResponse(nodeResponse, await handleSquareIngress(webRequest, env));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/api/billing/checkout-intents') {
            await sendResponse(nodeResponse, await handleBillingCheckoutIntents(webRequest, env));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/api/billing/plan-subscriptions') {
            await sendResponse(nodeResponse, await handlePlanSubscription(webRequest, env));
            return;
          }
          if (webRequest.method === 'GET' && pathname === '/api/billing/public-config') {
            await sendResponse(nodeResponse, await handlePublicBillingConfig(webRequest, env));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/api/billing/ensure-grants') {
            await sendResponse(nodeResponse, await handleEnsureGrants(webRequest, env));
            return;
          }
          if (webRequest.method === 'POST' && pathname === '/api/storage/checkout-intents') {
            await sendResponse(nodeResponse, await handleStorageCheckoutIntents(webRequest, env));
            return;
          }
          const intent = matchPath(pathname, '/api/billing/status/:intent');
          if (webRequest.method === 'GET' && intent !== null) {
            await sendResponse(nodeResponse, await handleBillingStatus(webRequest, env, intent));
            return;
          }
          await sendResponse(nodeResponse, Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }));
        } catch (error) {
          await sendResponse(nodeResponse, Response.json(
            { error: { code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : String(error) } },
            { status: 500 },
          ));
        }
      })();
    });
  });
}

export function startServer(env = loadEnv()): http.Server {
  const port = Number(env.PORT?.trim() || '8788');
  const listenHost = process.env.BILLING_LISTEN_HOST?.trim();
  const server = createServer(env);
  const onListen = () => {
    console.log(JSON.stringify({ event: 'billing_api_listening', port, bind: listenHost || 'default' }));
  };
  if (listenHost) server.listen(port, listenHost, onListen);
  else server.listen(port, onListen);
  return server;
}

startServer();
