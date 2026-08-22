const CUSTOMER_AI_UPSTREAM = 'https://g-ace-astera-customerai.hf.space';
const MAX_REQUEST_BYTES = 64 * 1024;

type PagesContext = { request: Request };

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Astera-Customer-AI-Transport': 'server-proxy',
    },
  });
}

function forwardedResponse(upstream: Response, body: ArrayBuffer): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Astera-Customer-AI-Transport': 'server-proxy',
  });
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  return new Response(body, { status: upstream.status, headers });
}

async function proxyRespond(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ detail: 'content_type_must_be_application_json' }, 415);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ detail: 'request_body_required' }, 400);
  if (body.byteLength > MAX_REQUEST_BYTES) return json({ detail: 'message_too_large' }, 413);

  const upstream = await fetch(`${CUSTOMER_AI_UPSTREAM}/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });
  return forwardedResponse(upstream, await upstream.arrayBuffer());
}

async function proxyDeleteSession(pathname: string): Promise<Response> {
  const prefix = '/api/customer-ai/sessions/';
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

  const upstream = await fetch(`${CUSTOMER_AI_UPSTREAM}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  return forwardedResponse(upstream, await upstream.arrayBuffer());
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  try {
    if (request.method === 'POST' && url.pathname === '/api/customer-ai/respond') {
      return await proxyRespond(request);
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/customer-ai/sessions/')) {
      return await proxyDeleteSession(url.pathname);
    }
    return json({ detail: 'not_found' }, 404);
  } catch {
    return json({ detail: 'customer_ai_upstream_unavailable' }, 502);
  }
}
