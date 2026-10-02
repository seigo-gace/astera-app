import assert from 'node:assert/strict';
import test from 'node:test';
import { appEventRouteIntent, validateAppEvent, type AppEventEnvelope } from './app-event-contract.js';

function base(scope: 'system' | 'user'): AppEventEnvelope {
  return {
    schema: 'astera.app.event.v1',
    eventId: 'evt-1',
    occurredAt: '2026-10-02T09:20:00Z',
    scope,
    domain: 'job',
    event: 'JOB_COMPLETED',
    severity: 'info',
    correlationId: 'corr-1',
    source: 'app-api',
    refs: scope === 'user' ? { userRef: 'opaque-user-1', jobId: 'job-1' } : { jobId: 'job-1' },
  };
}

test('system events route to the system stream and never carry a user owner', () => {
  assert.deepEqual(appEventRouteIntent(base('system')), {
    namespace: 'astera-app',
    streamKey: 'system',
    class: 'job.info',
  });
});

test('user events require an opaque user reference and route to the user stream', () => {
  assert.deepEqual(appEventRouteIntent(base('user')), {
    namespace: 'astera-app',
    streamKey: 'user',
    class: 'job.info',
    ownerKey: 'opaque-user-1',
  });

  const event = base('user');
  event.refs = { jobId: 'job-1' };
  assert.throws(() => validateAppEvent(event), /APP_EVENT_USER_REF_REQUIRED/);
});

test('system events fail closed if a user reference is attached', () => {
  const event = base('system');
  event.refs = { userRef: 'must-not-leak' };
  assert.throws(() => validateAppEvent(event), /APP_EVENT_SYSTEM_USER_REF_FORBIDDEN/);
});

test('forbidden secret and private-payload attribute keys are rejected', () => {
  for (const key of ['authorization', 'access_token', 'password', 'otp', 'card_number', 'private_payload', 'raw_prompt', 'dek']) {
    const event = base('user');
    event.attributes = { [key]: 'x' };
    assert.throws(() => validateAppEvent(event), /APP_EVENT_FORBIDDEN_ATTRIBUTE/);
  }
});

test('runtime validation rejects malformed schema, time, scope, domain and severity', () => {
  const schema = base('user');
  (schema as unknown as { schema: string }).schema = 'astera.app.event.v0';
  assert.throws(() => validateAppEvent(schema), /APP_EVENT_SCHEMA_INVALID/);

  const time = base('user');
  time.occurredAt = 'not-a-time';
  assert.throws(() => validateAppEvent(time), /APP_EVENT_OCCURRED_AT_INVALID/);

  const scope = base('user');
  (scope as unknown as { scope: string }).scope = 'tenant';
  assert.throws(() => validateAppEvent(scope), /APP_EVENT_SCOPE_INVALID/);

  const domain = base('user');
  (domain as unknown as { domain: string }).domain = 'unknown';
  assert.throws(() => validateAppEvent(domain), /APP_EVENT_DOMAIN_INVALID/);

  const severity = base('user');
  (severity as unknown as { severity: string }).severity = 'fatal';
  assert.throws(() => validateAppEvent(severity), /APP_EVENT_SEVERITY_INVALID/);
});

test('runtime validation rejects unknown/non-string refs and non-primitive attributes', () => {
  const unknownRef = base('user');
  (unknownRef as unknown as { refs: Record<string, unknown> }).refs = {
    userRef: 'opaque-user-1', jobId: 'job-1', rawUser: 'x',
  };
  assert.throws(() => validateAppEvent(unknownRef), /APP_EVENT_REF_NOT_ALLOWED:rawUser/);

  const objectRef = base('user');
  (objectRef as unknown as { refs: Record<string, unknown> }).refs = {
    userRef: { id: 'raw' }, jobId: 'job-1',
  };
  assert.throws(() => validateAppEvent(objectRef), /APP_EVENT_REF_USERREF_REQUIRED/);

  const objectAttribute = base('user');
  (objectAttribute as unknown as { attributes: Record<string, unknown> }).attributes = {
    note: { body: 'payload' },
  };
  assert.throws(() => validateAppEvent(objectAttribute), /APP_EVENT_ATTRIBUTE_VALUE_INVALID:note/);
});

test('token-like fields reject free-form payload strings', () => {
  const event = base('user');
  event.state = 'completed with raw user text';
  assert.throws(() => validateAppEvent(event), /APP_EVENT_STATE_INVALID/);
});
