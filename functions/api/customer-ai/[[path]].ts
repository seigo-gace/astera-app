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

async function proxyRespond(context: PagesContext): Promise<Response> {
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ detail: 'content_type_must_be_application_json' }, 415);
  }

  const body = await context.request.arrayBuffer();
  if (body.byteLength === 0) return json({ detail: 'request_body_required' }, 400);
  if (body.byteLength > MAX_REQUEST_BYTES) return json({ detail: 'message_too_large' }, 413);

  const response = await fetch(`${upstreamBase(context.env)}/respond`, {
    method: 'POST',
    headers: upstreamHeaders(context.env, true),
    body,
    redirect: 'error',
  });
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
