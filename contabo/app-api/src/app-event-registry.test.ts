import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppEventEnvelope, AppEventRef } from './app-event-contract.js';
import {
  APP_EVENT_REGISTRY,
  registeredAppEventId,
  validateRegisteredAppEvent,
  type AppEventRefKey,
  type RegisteredAppEventName,
} from './app-event-registry.js';

const REF_VALUE: Record<AppEventRefKey, string> = {
  tenantRef: 'opaque-tenant-1',
  userRef: 'opaque-user-1',
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  jobId: 'job-1',
  resultId: 'result:job-1',
  revisionId: 'revision-2',
  projectId: 'project-1',
  fileId: 'file-1',
  operationId: 'operation-1',
};

function event(name: RegisteredAppEventName): AppEventEnvelope {
  const definition = APP_EVENT_REGISTRY[name];
  const refs: AppEventRef = {};
  for (const ref of definition.requiredRefs) refs[ref] = REF_VALUE[ref];
  return {
    schema: 'astera.app.event.v1',
    eventId: registeredAppEventId(name, refs),
    occurredAt: '2026-10-02T11:20:00Z',
    scope: definition.scope,
    domain: definition.domain,
    event: name,
    severity: 'info',
    correlationId: 'corr-1',
    source: 'app-api',
    refs,
  };
}

test('all registered mutation events validate with deterministic mutation identities', () => {
  for (const name of Object.keys(APP_EVENT_REGISTRY) as RegisteredAppEventName[]) {
    const input = event(name);
    assert.equal(input.eventId, registeredAppEventId(name, input.refs ?? {}), name);
    assert.doesNotThrow(() => validateRegisteredAppEvent(input), name);
  }
});

test('unknown event names fail closed', () => {
  const input = event('JOB_ACCEPTED');
  input.event = 'JOB_MAGIC_SUCCESS';
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_NOT_REGISTERED/);
});

test('registered event domain cannot be changed by the caller', () => {
  const input = event('RESULT_REVISED');
  input.domain = 'job';
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_DOMAIN_MISMATCH/);
});

test('registered user event cannot be converted into a system event', () => {
  const input = event('STORAGE_OBJECT_STORED');
  input.scope = 'system';
  if (input.refs) delete input.refs.userRef;
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_SCOPE_MISMATCH/);
});

test('required correlation references fail closed when absent', () => {
  const input = event('RESULT_CREATED');
  if (input.refs) delete input.refs.resultId;
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_REQUIRED_REF_MISSING:RESULT_CREATED:resultId/);
});

test('result revision events require the exact revision identity', () => {
  const input = event('RESULT_REVISED');
  if (input.refs) delete input.refs.revisionId;
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_REQUIRED_REF_MISSING:RESULT_REVISED:revisionId/);
});

test('repeatable lifecycle events require a unique operation identity', () => {
  for (const name of [
    'RESULT_DELETION_SCHEDULED',
    'RESULT_RESTORED',
    'STORAGE_OBJECT_DELETION_SCHEDULED',
    'STORAGE_OBJECT_RESTORED',
  ] as const) {
    const input = event(name);
    if (input.refs) delete input.refs.operationId;
    assert.throws(
      () => validateRegisteredAppEvent(input),
      new RegExp(`APP_EVENT_REQUIRED_REF_MISSING:${name}:operationId`),
      name,
    );
  }
});

test('event id cannot be changed independently of the registered mutation identity', () => {
  const input = event('JOB_COMPLETED');
  input.eventId = 'app-event:JOB_COMPLETED:another-job';
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_IDENTITY_MISMATCH:JOB_COMPLETED/);
});

test('safe-looking arbitrary attributes are rejected unless the registry explicitly allows them', () => {
  const input = event('JOB_COMPLETED');
  input.attributes = { note: 'must not carry arbitrary payload' };
  assert.throws(() => validateRegisteredAppEvent(input), /APP_EVENT_ATTRIBUTE_NOT_ALLOWED:JOB_COMPLETED:note/);
});

test('registry identity selectors match mutation occurrence semantics', () => {
  assert.equal(APP_EVENT_REGISTRY.JOB_COMPLETED.identityRef, 'jobId');
  assert.equal(APP_EVENT_REGISTRY.RESULT_REVISED.identityRef, 'revisionId');
  assert.equal(APP_EVENT_REGISTRY.RESULT_DELETION_SCHEDULED.identityRef, 'operationId');
  assert.equal(APP_EVENT_REGISTRY.STORAGE_OBJECT_RESTORED.identityRef, 'operationId');
});

test('current registry keeps transient upload and persistent storage events separate', () => {
  assert.equal(APP_EVENT_REGISTRY.FILE_UPLOAD_READY.domain, 'file');
  assert.equal(APP_EVENT_REGISTRY.STORAGE_OBJECT_STORED.domain, 'storage');
  assert.deepEqual(APP_EVENT_REGISTRY.FILE_UPLOAD_READY.requiredRefs, ['userRef', 'fileId']);
  assert.deepEqual(APP_EVENT_REGISTRY.STORAGE_OBJECT_STORED.requiredRefs, ['userRef', 'fileId']);
  assert.deepEqual(APP_EVENT_REGISTRY.FILE_UPLOAD_READY.allowedAttributes, []);
  assert.deepEqual(APP_EVENT_REGISTRY.STORAGE_OBJECT_STORED.allowedAttributes, []);
});
