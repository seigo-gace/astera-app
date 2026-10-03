import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TgserverNativeV1ProvisioningClient,
  TgserverNativeV1ProvisioningError,
} from './tgserver-native-v1-provisioning-client.js';

function client(fetchImpl: typeof fetch) {
  return new TgserverNativeV1ProvisioningClient({
    origin: 'http://tgserver-vnext:8080',
    controlToken: 'control-token',
    timeoutMs: 5000,
  }, fetchImpl);
}

test('credential transport failure is explicitly ambiguous and must not be blindly retried', async () => {
  const provisioning = client(async () => {
    throw new Error('connection_lost_after_send');
  });
  await assert.rejects(
    () => provisioning.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError
      && error.code === 'TGS_CONTROL_CREDENTIAL_ISSUE_AMBIGUOUS'
      && error.mayHaveCommitted === true,
  );
});

test('successful HTTP with unusable credential evidence is also marked may-have-committed', async () => {
  const provisioning = client(async () => new Response(JSON.stringify({
    token: 'token',
    credential: {
      credential_id: 'cred-1',
      tenant_id: 'wrong-tenant',
      namespace_id: 'ns-user-opaque',
      scopes: ['object:read', 'object:write'],
      state: 'ACTIVE',
    },
  }), { status: 201, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    () => provisioning.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError
      && error.code === 'TGS_CONTROL_CREDENTIAL_IDENTITY_MISMATCH'
      && error.mayHaveCommitted === true,
  );
});

test('definite control rejection remains non-ambiguous', async () => {
  const provisioning = client(async () => new Response(JSON.stringify({
    status: 'rejected',
    code: 'CONTROL_FORBIDDEN',
  }), { status: 403, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    () => provisioning.issueObjectCredential({ tenantId: 'app-service', namespaceId: 'ns-user-opaque' }),
    (error: unknown) => error instanceof TgserverNativeV1ProvisioningError
      && error.code === 'CONTROL_FORBIDDEN'
      && error.mayHaveCommitted === false,
  );
});
