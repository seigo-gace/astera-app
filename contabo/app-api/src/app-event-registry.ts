import {
  validateAppEvent,
  type AppEventDomain,
  type AppEventEnvelope,
  type AppEventRef,
  type AppEventScope,
} from './app-event-contract.js';

export type AppEventRefKey = keyof AppEventRef;

export type AppEventRegistryEntry = Readonly<{
  domain: AppEventDomain;
  scope: AppEventScope;
  delivery: 'durable_outbox';
  requiredRefs: readonly AppEventRefKey[];
}>;

/**
 * Closed event vocabulary for the currently audited App mutation paths.
 *
 * This is a transport-side source scaffold only. Runtime emission is intentionally
 * not wired here: Pages/D1 and Worker code need one shared contract authority before
 * Outbox repository integration. Private payload/content events are not registered.
 */
export const APP_EVENT_REGISTRY = {
  CONVERSATION_CREATED: {
    domain: 'conversation',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'conversationId'],
  },
  CONVERSATION_TURN_STORED: {
    domain: 'conversation',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'conversationId', 'turnId', 'jobId'],
  },
  JOB_ACCEPTED: {
    domain: 'job',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'],
  },
  JOB_COMPLETED: {
    domain: 'job',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'],
  },
  JOB_PARTIALLY_COMPLETED: {
    domain: 'job',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'],
  },
  JOB_FAILED: {
    domain: 'job',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'],
  },
  JOB_CANCELLED: {
    domain: 'job',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'],
  },
  RESULT_CREATED: {
    domain: 'result',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId', 'resultId'],
  },
  RESULT_REVISED: {
    domain: 'result',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId'],
  },
  RESULT_DELETION_SCHEDULED: {
    domain: 'result',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId'],
  },
  RESULT_RESTORED: {
    domain: 'result',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId'],
  },
  FILE_UPLOAD_READY: {
    domain: 'file',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'],
  },
  STORAGE_OBJECT_STORED: {
    domain: 'storage',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'],
  },
  STORAGE_OBJECT_DELETION_SCHEDULED: {
    domain: 'storage',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'],
  },
  STORAGE_OBJECT_RESTORED: {
    domain: 'storage',
    scope: 'user',
    delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'],
  },
} as const satisfies Readonly<Record<string, AppEventRegistryEntry>>;

export type RegisteredAppEventName = keyof typeof APP_EVENT_REGISTRY;

export function registeredAppEvent(name: string): AppEventRegistryEntry | undefined {
  return APP_EVENT_REGISTRY[name as RegisteredAppEventName];
}

export function validateRegisteredAppEvent(input: AppEventEnvelope): AppEventEnvelope {
  const event = validateAppEvent(input);
  const definition = registeredAppEvent(event.event);
  if (!definition) throw new Error(`APP_EVENT_NOT_REGISTERED:${event.event}`);
  if (definition.domain !== event.domain) {
    throw new Error(`APP_EVENT_DOMAIN_MISMATCH:${event.event}:${event.domain}`);
  }
  if (definition.scope !== event.scope) {
    throw new Error(`APP_EVENT_SCOPE_MISMATCH:${event.event}:${event.scope}`);
  }
  for (const ref of definition.requiredRefs) {
    const value = event.refs?.[ref];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`APP_EVENT_REQUIRED_REF_MISSING:${event.event}:${ref}`);
    }
  }
  return event;
}
