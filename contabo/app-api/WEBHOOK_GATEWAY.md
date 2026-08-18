# Astera App API -> Webhook Gateway

## Purpose

Astera App keeps customer/account/multi-tenant authorization outside the Webhook Gateway. The App control plane decides what a signed-in user may do, then the protected Contabo App API calls the tenant-agnostic Gateway as a trusted server.

```text
Browser / Astera App UI
  -> Cloudflare control plane
  -> account / workspace / plan authorization
  -> api.asterav8.jp protected App API
  -> WebhookGatewayClient
  -> http://127.0.0.1:7373/internal/*
  -> Webhook Gateway
```

The Gateway token must never be sent to the browser.

## App API routes

These routes are registered under the existing `/api/*` App API service-token middleware:

```text
POST /api/webhook/events
GET  /api/webhook/events?sourceId=<opaque-source>&limit=<1..200>
GET  /api/webhook/events/:gatewayEventId
```

They are not customer-authentication endpoints by themselves. The Cloudflare/App control plane must authenticate the customer and enforce workspace/plan ownership before calling them with `INTERNAL_SERVICE_TOKEN`.

`sourceId` remains an opaque identifier chosen/authorized by the App control plane. It is not interpreted as a tenant by the Gateway.

## Server environment

Preferred same-VPS configuration:

```env
WEBHOOK_GATEWAY_INTERNAL_ORIGIN=http://127.0.0.1:7373
WEBHOOK_GATEWAY_INTERNAL_TOKEN=<same value as Gateway INTERNAL_EVENT_API_TOKEN>
WEBHOOK_GATEWAY_TIMEOUT_MS=15000
```

If `WEBHOOK_GATEWAY_INTERNAL_ORIGIN` is blank, the existing Astera App remains operational and only the Webhook proxy routes fail closed with `WEBHOOK_GATEWAY_NOT_CONFIGURED`.

If an origin is configured, its token becomes mandatory at App API startup.

Do not create any `VITE_WEBHOOK_GATEWAY_TOKEN`, browser LocalStorage token or public JS environment variable for this secret.

## Error boundary

The App API deliberately distinguishes customer/request failures from Gateway server configuration failures:

- Gateway 400/404/413/422 are mapped as request/resource errors.
- Gateway 429 remains retryable rate limiting.
- Gateway 5xx/transport failures become App API 503.
- Gateway 401/403 become `WEBHOOK_GATEWAY_AUTHENTICATION_FAILED` with App API 503, because they indicate the server-to-server token/CIDR/Cloudflare configuration is wrong; they are not evidence that the signed-in customer is unauthorized.

## Payload boundary

Business payload is forwarded unchanged. Fields named `token`, `password`, `key`, `authorization`, etc. are legitimate business data and must not be silently redacted before Gateway persistence/delivery.

The Gateway status API returns metadata/delivery state only; it does not return stored business payloads.

## Cursor/server work

After both repository branches are validated and merged, Cursor should only need to:

1. deploy Webhook Gateway on the VPS;
2. deploy/update Contabo App API;
3. place the same high-entropy internal Gateway token in:
   - Webhook Gateway: `INTERNAL_EVENT_API_TOKEN`
   - Astera App API: `WEBHOOK_GATEWAY_INTERNAL_TOKEN`
4. set App API `WEBHOOK_GATEWAY_INTERNAL_ORIGIN=http://127.0.0.1:7373` when both are on the same VPS;
5. keep port 7373 host-loopback-only;
6. configure Cloudflare public `webhook.asterav8.jp` separately from `api.asterav8.jp`;
7. confirm Browser -> Cloudflare -> App API -> Gateway E2E without exposing the Gateway token.

## Not implemented here

This adapter intentionally does not add multi-tenancy to Webhook Gateway and does not invent a customer destination/source provisioning model. Customer-facing source/destination configuration must remain owned by the Astera control plane. If customer-created arbitrary destinations are required, the control plane needs a separate trusted provisioning contract rather than exposing Gateway Admin or raw destination URLs directly to the browser.
