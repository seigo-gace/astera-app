import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TgserverNativeV1ProvisioningClient,
  TgserverNativeV1ProvisioningError,
} from './tgserver-native-v1-provisioning-client.js';

type SeenRequest = { url: string; init: RequestInit | undefined };

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('provisioning client exposes registration-only control calls with exact current TGserver v1 payloads', async () => {
  const seen: SeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/v1/control/tenants') return json({ tenant_id: 'app-service', state: 'REGISTERED' }, 201);
    if (path === '/v1/control/namespaces') return json({ tenant_id: 'app-service', namespace_id: 'ns-user-opaque', state: 'REGISTERED' }, 201);
    if (path === '/v1/control/entitlements') return json({ entitlement_id: 'ent-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', capability: 'object-storage', state: 'REGISTERED' }, 201);
    if (path === '/v1/control/routes') return json({ route_id: 'route-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', route_key: 'route-opaque', state: 'REGISTERED', active_generation: null }, 201);
    if (path === '/v1/control/credentials') return json({
      token: 'one-time-object-token',
      credential: {
        credential_id: 'cred-1',
        tenant_id: 'app-service',
        namespace_id: 'ns-user-opaque',
        scopes: ['object:read', 'object:write'],
        state: 'ACTIVE',
      },
    }, 201);
    return json({ status: 'failed', code: 'UNEXPECTED_REQUEST' }, 500);
  };

  const client = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, fetchImpl);

  await client.registerTenant('app-service');
  await client.registerNamespace({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' });
  await client.registerEntitlement({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', capability: 'object-storage', entitlementId: 'ent-1' });
  await client.registerRoute({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', routeKey: 'route-opaque', poolKey: 'app-pool', routeId: 'route-1' });
  const issued = await client.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' });

  assert.equal(issued.token, 'one-time-object-token');
  assert.deepEqual(seen.map((request) => new URL(request.url).pathname), [
    '/v1/control/tenants',
    '/v1/control/namespaces',
    '/v1/control/entitlements',
    '/v1/control/routes',
    '/v1/control/credentials',
  ]);
  for (const request of seen) {
    assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer control-token');
    assert.equal(request.init?.method, 'POST');
  }
  assert.deepEqual(JSON.parse(String(seen[0]?.init?.body)), { tenant_id: 'app-service' });
  assert.deepEqual(JSON.parse(String(seen[1]?.init?.body)), { tenant_id: 'app-service', namespace_id: 'ns-user-opaque' });
  assert.deepEqual(JSON.parse(String(seen[2]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    capability: 'object-storage',
    entitlement_id: 'ent-1',
  });
  assert.deepEqual(JSON.parse(String(seen[3]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    route_key: 'route-opaque',
    pool_key: 'app-pool',
    route_id: 'route-1',
  });
  assert.deepEqual(JSON.parse(String(seen[4]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    scopes: ['object:read', 'object:write'],
  });
});

test('provisioning client intentionally has no activation or credential-revoke surface', () => {
  const client = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  });
  assert.equal('activateTenant' in client, false);
  assert.equal('activateNamespace' in client, false);
  assert.equal('activateEntitlement' in client, false);
  assert.equal('activateRoute' in client, false);
  assert.equal('revokeCredential' in client, false);
});

test('object credential issuance fails closed if TGserver returns the wrong identity or scopes', async () => {
  const mismatchedIdentity = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => json({
    token: 'token',
    credential: {
      credential_id: 'cred-1',
      tenant_id: 'other-tenant',
      namespace_id: 'ns-user-opaque',
      scopes: ['object:read', 'object:write'],
      state: 'ACTIVE',
    },
  }, 201));
  await assert.rejects(
    () => mismatchedIdentity.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_CREDENTIAL_IDENTITY_MISMATCH',
  );

  const missingScope = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => json({
    token: 'token',
    credential: {
      credential_id: 'cred-1',
      tenant_id: 'app-service',
      namespace_id: 'ns-user-opaque',
      scopes: ['object:read'],
      state: 'ACTIVE',
    },
  }, 201));
  await assert.rejects(
    () => missingScope.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_CREDENTIAL_SCOPE_MISMATCH',
  );
});

test('provisioning client preserves TGserver control error code and rejects insecure remote origins', async () => {
  const client = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => json({ status: 'rejected', code: 'CONTROL_FORBIDDEN' }, 403));
  await assert.rejects(
    () => client.registerTenant('app-service'),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'CONTROL_FORBIDDEN' && error.status === 403,
  );
  assert.throws(
    () => new TgserverNativeV1ProvisioningClient({ origin: 'http://example.com', controlToken: 'x', timeoutMs: 5000 }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_ORIGIN_HTTPS_REQUIRED',
  );
});
