# Astera App -> Webhook Gateway provisioning

## Boundary

Multi-tenant/customer ownership remains in Astera App and its Cloudflare control plane.

Webhook Gateway does not receive or interpret `tenantId`, workspace plans, browser sessions or customer billing state.

The App control plane should generate opaque IDs after authorizing the signed-in user, then call the protected Contabo App API. The Contabo API uses a separate Gateway provisioning credential.

```text
Signed-in user
  -> Astera frontend/control plane
  -> customer + workspace + plan authorization
  -> protected api.asterav8.jp /api/webhook/config/*
  -> WEBHOOK_GATEWAY_PROVISION_TOKEN (server only)
  -> http://127.0.0.1:7373/internal/config/*
  -> encrypted Gateway managed configuration
```

## Separate Gateway credentials

```env
WEBHOOK_GATEWAY_INTERNAL_ORIGIN=http://127.0.0.1:7373
WEBHOOK_GATEWAY_INTERNAL_TOKEN=<event API token>
WEBHOOK_GATEWAY_PROVISION_TOKEN=<managed config token>
WEBHOOK_GATEWAY_TIMEOUT_MS=15000
```

The event token and provisioning token must be different.

If `WEBHOOK_GATEWAY_PROVISION_TOKEN` is blank, existing App/Event functionality remains available and only `/api/webhook/config/*` fails closed.

Never expose either token in `VITE_*`, browser JavaScript, LocalStorage, client logs or user-facing error payloads.

## Protected App API routes

```text
GET /api/webhook/config/sources
PUT /api/webhook/config/sources/:id

GET /api/webhook/config/destinations
PUT /api/webhook/config/destinations/:id

GET /api/webhook/config/routes
PUT /api/webhook/config/routes/:id
```

These routes sit behind the existing `/api/*` App API service-token middleware. They are not a replacement for customer/workspace authorization: Cloudflare/App control-plane code must authorize the user before invoking them.

## Opaque IDs

The control plane should generate IDs such as:

```text
src_<random>
dst_<random>
route_<random>
```

Do not encode a customer email, workspace name, tenant name or other personal/business identifier into the Gateway ID. Mapping an opaque Gateway ID back to a customer/workspace belongs in Astera App storage.

## Secrets

Provider secrets, secondary rotation secrets, outbound signing secrets and destination secret headers are accepted only through the protected provisioning path.

They are not persisted by Astera frontend code. The Gateway encrypts them in its PostgreSQL managed configuration tables and never returns their values from list/update responses.

When editing a Source/Destination, omit a Secret field to preserve the currently encrypted secret. Use an explicit `null` only for fields that support clearing (secondary Source secret, Destination signing secret, Destination secret headers).

## Customer destination restriction

Managed/customer Destination URLs must be public HTTP(S) targets. The Gateway rejects localhost, private, reserved and non-routable targets and repeats DNS/IP validation at delivery time.

Internal Astera/TGServer private targets stay in deployment-owned static Gateway configuration and are not customer-managed.

## Cursor deployment handoff

After repository validation:

1. set Gateway `MANAGED_CONFIG_ENABLED=true`;
2. create a unique `MANAGED_CONFIG_API_TOKEN`;
3. create a random 32-byte `MANAGED_CONFIG_ENCRYPTION_KEY`;
4. place the same provisioning token in App API `WEBHOOK_GATEWAY_PROVISION_TOKEN`;
5. use `http://127.0.0.1:7373` from App API when both services are on the same VPS;
6. do not expose `/internal/config/*` through the public Cloudflare hostname;
7. verify an authorized App control-plane request can create a Destination, Source and Route;
8. verify an unauthenticated browser request cannot reach the protected App API route;
9. verify Gateway list responses contain only secret-presence metadata, never secret values.
