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

test('provisioning client follows current TGserver staged control lifecycle but never activates a route', async () => {
  const seen: SeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    const path = new URL(url).pathname;
    if (path === '/v1/control/tenants') return json({ tenant_id: 'app-service', state: 'PROVISIONING' }, 201);
    if (path === '/v1/control/tenants/app-service/activate') return json({ tenant_id: 'app-service', state: 'ACTIVE' });
    if (path === '/v1/control/namespaces') return json({ tenant_id: 'app-service', namespace_id: 'ns-user-opaque', state: 'PROVISIONING' }, 201);
    if (path === '/v1/control/namespaces/activate') return json({ tenant_id: 'app-service', namespace_id: 'ns-user-opaque', state: 'ACTIVE' });
    if (path === '/v1/control/entitlements') return json({ entitlement_id: 'ent-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', capability: 'object.write', state: 'PROVISIONING' }, 201);
    if (path === '/v1/control/entitlements/ent-1/activate') return json({ entitlement_id: 'ent-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', capability: 'object.write', state: 'ACTIVE' });
    if (path === '/v1/control/routes') return json({ route_id: 'route-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', route_key: 'route-opaque', state: 'READ_ONLY', active_generation: 0 }, 201);
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
  await client.activateTenant('app-service');
  await client.registerNamespace({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' });
  await client.activateNamespace({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' });
  await client.registerEntitlement({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', capability: 'object.write', entitlementId: 'ent-1' });
  await client.activateEntitlement('ent-1');
  const route = await client.registerRoute({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', routeKey: 'route-opaque', poolKey: 'app-pool', routeId: 'route-1' });
  const issued = await client.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' });

  assert.equal(route.state, 'READ_ONLY');
  assert.equal(issued.token, 'one-time-object-token');
  assert.deepEqual(seen.map((request) => new URL(request.url).pathname), [
    '/v1/control/tenants',
    '/v1/control/tenants/app-service/activate',
    '/v1/control/namespaces',
    '/v1/control/namespaces/activate',
    '/v1/control/entitlements',
    '/v1/control/entitlements/ent-1/activate',
    '/v1/control/routes',
    '/v1/control/credentials',
  ]);
  for (const request of seen) {
    assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer control-token');
    assert.equal(request.init?.method, 'POST');
  }
  assert.equal(seen.some((request) => new URL(request.url).pathname.includes('/routes/route-1/activate')), false);
  assert.deepEqual(JSON.parse(String(seen[4]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    capability: 'object.write',
    entitlement_id: 'ent-1',
  });
  assert.deepEqual(JSON.parse(String(seen[6]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    route_key: 'route-opaque',
    pool_key: 'app-pool',
    route_id: 'route-1',
  });
  assert.deepEqual(JSON.parse(String(seen[7]?.init?.body)), {
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    scopes: ['object:read', 'object:write'],
  });
});

test('provisioning replay accepts already-active prerequisites but keeps route activation unavailable', async () => {
  const client = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/control/tenants') return json({ tenant_id: 'app-service', state: 'ACTIVE' }, 201);
    if (path === '/v1/control/namespaces') return json({ tenant_id: 'app-service', namespace_id: 'ns-user-opaque', state: 'ACTIVE' }, 201);
    if (path === '/v1/control/entitlements') return json({ entitlement_id: 'ent-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', capability: 'object.write', state: 'ACTIVE' }, 201);
    return json({ route_id: 'route-1', tenant_id: 'app-service', namespace_id: 'ns-user-opaque', route_key: 'route-opaque', state: 'READ_ONLY', active_generation: 0 }, 201);
  });
  assert.equal((await client.registerTenant('app-service')).state, 'ACTIVE');
  assert.equal((await client.registerNamespace({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' })).state, 'ACTIVE');
  assert.equal((await client.registerEntitlement({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', capability: 'object.write', entitlementId: 'ent-1' })).state, 'ACTIVE');
  assert.equal((await client.registerRoute({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', routeKey: 'route-opaque', poolKey: 'app-pool', routeId: 'route-1' })).state, 'READ_ONLY');
  assert.equal('activateRoute' in client, false);
  assert.equal('revokeCredential' in client, false);
});

test('registration responses fail closed on identity drift or an already-active route', async () => {
  const tenantMismatch = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => json({ tenant_id: 'wrong-service', state: 'PROVISIONING' }, 201));
  await assert.rejects(
    () => tenantMismatch.registerTenant('app-service'),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_TENANT_ID_MISMATCH',
  );

  const activeRoute = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => json({
    route_id: 'route-1',
    tenant_id: 'app-service',
    namespace_id: 'ns-user-opaque',
    route_key: 'route-opaque',
    state: 'ACTIVE',
  }, 201));
  await assert.rejects(
    () => activeRoute.registerRoute({
      tenantId: 'app-service',
      namespaceId: 'ns-user-opaque',
      routeKey: 'route-opaque',
      poolKey: 'app-pool',
      routeId: 'route-1',
    }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_ROUTE_NOT_READ_ONLY',
  );
});

test('entitlement capability is validated against the current TGserver grammar before HTTP', async () => {
  let called = false;
  const client = new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, async () => {
    called = true;
    return json({}, 500);
  });
  await assert.rejects(
    () => client.registerEntitlement({ tenantId: 'app-service', namespaceId: 'ns-user-opaque', capability: 'Object Storage' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError && error.code === 'TGS_CONTROL_ENTITLEMENT_CAPABILITY_INVALID' && error.status === 422,
  );
  assert.equal(called, false);
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
