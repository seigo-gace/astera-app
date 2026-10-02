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
