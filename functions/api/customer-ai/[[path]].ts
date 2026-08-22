type CustomerAIEnv = {
  CUSTOMER_AI_UPSTREAM?: string;
  CUSTOMER_AI_HF_TOKEN?: string;
};

type PagesContext = {
  request: Request;
  env: CustomerAIEnv;
};

const MAX_REQUEST_BYTES = 64 * 1024;
const API_PREFIX = '/api/customer-ai';
const HF_SPACE_HOST = 'g-ace-astera-customerai.hf.space';
const HF_SPACE_RESTART_URL = 'https://huggingface.co/api/spaces/G-ACE/astera-customerAI/restart';
const PAUSED_RETRY_DELAY_MS = 5000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Astera-Customer-AI-Transport': 'server-env',
    },
  });
}

function upstreamBase(env: CustomerAIEnv): string {
  const value = String(env.CUSTOMER_AI_UPSTREAM || '').trim().replace(/\/$/, '');
  if (!value) throw new Error('customer_ai_upstream_not_configured');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('customer_ai_upstream_invalid');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('customer_ai_upstream_invalid');
  }

  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

function upstreamHeaders(env: CustomerAIEnv, contentType = false): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (contentType) headers.set('Content-Type', 'application/json');
  const token = String(env.CUSTOMER_AI_HF_TOKEN || '').trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function hfToken(env: CustomerAIEnv): string {
  return String(env.CUSTOMER_AI_HF_TOKEN || '').trim();
}

function isRestartableHfSpace(env: CustomerAIEnv): boolean {
  try {
    return new URL(upstreamBase(env)).hostname === HF_SPACE_HOST;
  } catch {
    return false;
  }
}

async function readResponseSnippet(response: Response, maxBytes = 4096): Promise<string> {
  const buffer = await response.clone().arrayBuffer();
  return new TextDecoder().decode(buffer.slice(0, maxBytes)).toLowerCase();
}

function isPausedUpstream(status: number, bodyText: string): boolean {
  return status === 503 && bodyText.includes('space is paused');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartKnownHfSpace(token: string): Promise<boolean> {
  const response = await fetch(HF_SPACE_RESTART_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    redirect: 'error',
  });
  return response.ok;
}

async function forward(upstream: Response): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Astera-Customer-AI-Transport': 'server-env',
  });
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}

async function fetchUpstreamRespond(env: CustomerAIEnv, body: ArrayBuffer): Promise<Response> {
  return fetch(`${upstreamBase(env)}/respond`, {
    method: 'POST',
    headers: upstreamHeaders(env, true),
    body,
    redirect: 'error',
  });
}

async function proxyRespond(context: PagesContext): Promise<Response> {
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ detail: 'content_type_must_be_application_json' }, 415);
  }

  const body = await context.request.arrayBuffer();
  if (body.byteLength === 0) return json({ detail: 'request_body_required' }, 400);
  if (body.byteLength > MAX_REQUEST_BYTES) return json({ detail: 'message_too_large' }, 413);

  let response = await fetchUpstreamRespond(context.env, body);
  const token = hfToken(context.env);

  if (token && isRestartableHfSpace(context.env)) {
    const snippet = await readResponseSnippet(response);
    if (isPausedUpstream(response.status, snippet)) {
      const restarted = await restartKnownHfSpace(token);
      if (restarted) {
        await sleep(PAUSED_RETRY_DELAY_MS);
        response = await fetchUpstreamRespond(context.env, body);
      }
    }
  }

  return forward(response);
}

async function proxyDeleteSession(context: PagesContext, pathname: string): Promise<Response> {
  const prefix = `${API_PREFIX}/sessions/`;
  const rawSessionId = pathname.slice(prefix.length);

  let sessionId = '';
  try {
    sessionId = decodeURIComponent(rawSessionId);
  } catch {
    return json({ detail: 'invalid_session_id' }, 400);
  }

  if (!sessionId || sessionId.length > 160 || sessionId.includes('/')) {
    return json({ detail: 'invalid_session_id' }, 400);
  }

  const response = await fetch(`${upstreamBase(context.env)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: upstreamHeaders(context.env),
    redirect: 'error',
  });
  return forward(response);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);

  try {
    if (context.request.method === 'POST' && url.pathname === `${API_PREFIX}/respond`) {
      return await proxyRespond(context);
    }

    if (context.request.method === 'DELETE' && url.pathname.startsWith(`${API_PREFIX}/sessions/`)) {
      return await proxyDeleteSession(context, url.pathname);
    }

    return json({ detail: 'not_found' }, 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'customer_ai_upstream_unavailable';
    if (code === 'customer_ai_upstream_not_configured' || code === 'customer_ai_upstream_invalid') {
      return json({ detail: code }, 503);
    }
    return json({ detail: 'customer_ai_upstream_unavailable' }, 502);
  }
}
