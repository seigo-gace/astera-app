export type AppEventScope = 'system' | 'user';

export type AppEventDomain =
  | 'runtime'
  | 'auth'
  | 'account'
  | 'security'
  | 'conversation'
  | 'job'
  | 'result'
  | 'project'
  | 'file'
  | 'storage'
  | 'billing'
  | 'credit'
  | 'plan'
  | 'share'
  | 'template'
  | 'notification'
  | 'privacy'
  | 'developer_api'
  | 'integration'
  | 'reconciliation';

export type AppEventSeverity = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type AppEventRef = {
  tenantRef?: string;
  userRef?: string;
  conversationId?: string;
  turnId?: string;
  jobId?: string;
  resultId?: string;
  projectId?: string;
  fileId?: string;
  operationId?: string;
};

export type AppEventEnvelope = {
  schema: 'astera.app.event.v1';
  eventId: string;
  occurredAt: string;
  scope: AppEventScope;
  domain: AppEventDomain;
  event: string;
  severity: AppEventSeverity;
  correlationId: string;
  source: string;
  state?: string;
  errorClass?: string;
  refs?: AppEventRef;
  attributes?: Record<string, string | number | boolean | null>;
};

const FORBIDDEN_ATTRIBUTE_KEY = /(?:password|passwd|secret|token|authorization|cookie|session|otp|cvv|card|private[_-]?payload|raw[_-]?prompt|raw[_-]?file|dek|api[_-]?key)/i;

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`APP_EVENT_${name}_REQUIRED`);
  return trimmed;
}

export function validateAppEvent(input: AppEventEnvelope): AppEventEnvelope {
  nonEmpty(input.eventId, 'EVENT_ID');
  nonEmpty(input.occurredAt, 'OCCURRED_AT');
  nonEmpty(input.event, 'NAME');
  nonEmpty(input.correlationId, 'CORRELATION_ID');
  nonEmpty(input.source, 'SOURCE');

  if (input.scope === 'user' && !input.refs?.userRef) {
    throw new Error('APP_EVENT_USER_REF_REQUIRED');
  }
  if (input.scope === 'system' && input.refs?.userRef) {
    throw new Error('APP_EVENT_SYSTEM_USER_REF_FORBIDDEN');
  }

  for (const key of Object.keys(input.attributes ?? {})) {
    if (FORBIDDEN_ATTRIBUTE_KEY.test(key)) {
      throw new Error(`APP_EVENT_FORBIDDEN_ATTRIBUTE:${key}`);
    }
  }
  return input;
}

export function appEventRouteIntent(event: AppEventEnvelope): {
  namespace: string;
  streamKey: string;
  class: string;
  ownerKey?: string;
} {
  validateAppEvent(event);
  if (event.scope === 'system') {
    return {
      namespace: 'astera-app',
      streamKey: 'system',
      class: `${event.domain}.${event.severity}`,
    };
  }
  const ownerKey = event.refs?.userRef;
  if (!ownerKey) throw new Error('APP_EVENT_USER_REF_REQUIRED');
  return {
    namespace: 'astera-app',
    streamKey: 'user',
    class: `${event.domain}.${event.severity}`,
    ownerKey,
  };
}

export type AppEventRefKey = keyof AppEventRef;

export type AppEventRegistryEntry = Readonly<{
  domain: AppEventDomain;
  scope: AppEventScope;
  delivery: 'durable_outbox';
  requiredRefs: readonly AppEventRefKey[];
}>;

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

export type AppEventOutboxState =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'retry_wait'
  | 'dead_letter';

export type AppEventOutboxRecord = {
  id: string;
  eventId: string;
  idempotencyKey: string;
  event: AppEventEnvelope;
  state: AppEventOutboxState;
  attempt: number;
  nextRetryAt?: string;
  leaseExpiresAt?: string;
  tgsOperationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppEventOutboxClaim = Readonly<{
  id: string;
  eventId: string;
  attempt: number;
  leaseExpiresAt: string;
}>;

const ALLOWED_TRANSITIONS: Readonly<Record<AppEventOutboxState, readonly AppEventOutboxState[]>> = {
  pending: ['sending', 'dead_letter'],
  sending: ['delivered', 'retry_wait', 'dead_letter'],
  retry_wait: ['sending', 'dead_letter'],
  delivered: [],
  dead_letter: [],
};

function instant(value: string | undefined, code: string): number {
  if (!value?.trim()) throw new Error(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateOutboxRecord(record: AppEventOutboxRecord): AppEventOutboxRecord {
  validateRegisteredAppEvent(record.event);
  if (!record.id.trim()) throw new Error('APP_EVENT_OUTBOX_ID_REQUIRED');
  if (!record.eventId.trim()) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_REQUIRED');
  if (record.eventId !== record.event.eventId) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_MISMATCH');
  if (!record.idempotencyKey.trim()) throw new Error('APP_EVENT_OUTBOX_IDEMPOTENCY_KEY_REQUIRED');
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) throw new Error('APP_EVENT_OUTBOX_ATTEMPT_INVALID');

  const createdAt = instant(record.createdAt, 'APP_EVENT_OUTBOX_CREATED_AT_INVALID');
  const updatedAt = instant(record.updatedAt, 'APP_EVENT_OUTBOX_UPDATED_AT_INVALID');
  if (updatedAt < createdAt) throw new Error('APP_EVENT_OUTBOX_TIME_REGRESSION');

  if (record.state === 'retry_wait') {
    const nextRetryAt = instant(record.nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
    if (nextRetryAt <= updatedAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
  } else if (record.nextRetryAt) {
    throw new Error('APP_EVENT_OUTBOX_RETRY_AT_FORBIDDEN');
  }

  if (record.state === 'sending') {
    const leaseExpiresAt = instant(record.leaseExpiresAt, 'APP_EVENT_OUTBOX_LEASE_REQUIRED');
    if (leaseExpiresAt <= updatedAt) throw new Error('APP_EVENT_OUTBOX_LEASE_INVALID');
    if (record.attempt < 1) throw new Error('APP_EVENT_OUTBOX_SENDING_ATTEMPT_INVALID');
  } else if (record.leaseExpiresAt) {
    throw new Error('APP_EVENT_OUTBOX_LEASE_FORBIDDEN');
  }

  return record;
}

export function assertOutboxTransition(from: AppEventOutboxState, to: AppEventOutboxState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`APP_EVENT_OUTBOX_TRANSITION_FORBIDDEN:${from}->${to}`);
  }
}

export function transitionOutbox(
  record: AppEventOutboxRecord,
  next: AppEventOutboxState,
  now: string,
  options: { nextRetryAt?: string; leaseExpiresAt?: string; tgsOperationId?: string } = {},
): AppEventOutboxRecord {
  validateOutboxRecord(record);
  assertOutboxTransition(record.state, next);
  const transitionAt = instant(now, 'APP_EVENT_OUTBOX_UPDATED_AT_INVALID');
  if (transitionAt < Date.parse(record.updatedAt)) throw new Error('APP_EVENT_OUTBOX_TIME_REGRESSION');

  const transitioned: AppEventOutboxRecord = {
    ...record,
    state: next,
    attempt: next === 'sending' ? record.attempt + 1 : record.attempt,
    updatedAt: now,
  };

  delete transitioned.nextRetryAt;
  delete transitioned.leaseExpiresAt;

  if (next === 'retry_wait') {
    const nextRetryAt = instant(options.nextRetryAt, 'APP_EVENT_OUTBOX_RETRY_AT_REQUIRED');
    if (nextRetryAt <= transitionAt) throw new Error('APP_EVENT_OUTBOX_RETRY_AT_INVALID');
    transitioned.nextRetryAt = options.nextRetryAt!;
  }

  if (next === 'sending') {
    const leaseExpiresAt = instant(options.leaseExpiresAt, 'APP_EVENT_OUTBOX_LEASE_REQUIRED');
    if (leaseExpiresAt <= transitionAt) throw new Error('APP_EVENT_OUTBOX_LEASE_INVALID');
    transitioned.leaseExpiresAt = options.leaseExpiresAt!;
  }

  if (options.tgsOperationId) transitioned.tgsOperationId = options.tgsOperationId;

  return validateOutboxRecord(transitioned);
}

export function outboxClaim(record: AppEventOutboxRecord): AppEventOutboxClaim {
  validateOutboxRecord(record);
  if (record.state !== 'sending' || !record.leaseExpiresAt) throw new Error('APP_EVENT_OUTBOX_NOT_CLAIMED');
  return {
    id: record.id,
    eventId: record.eventId,
    attempt: record.attempt,
    leaseExpiresAt: record.leaseExpiresAt,
  };
}

export function assertActiveOutboxClaim(
  record: AppEventOutboxRecord,
  claim: AppEventOutboxClaim,
  now: string,
): void {
  validateOutboxRecord(record);
  if (
    record.state !== 'sending'
    || record.id !== claim.id
    || record.eventId !== claim.eventId
    || record.attempt !== claim.attempt
    || record.leaseExpiresAt !== claim.leaseExpiresAt
  ) {
    throw new Error('APP_EVENT_OUTBOX_CLAIM_STALE');
  }
  const checkedAt = instant(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
  if (Date.parse(claim.leaseExpiresAt) <= checkedAt) throw new Error('APP_EVENT_OUTBOX_CLAIM_EXPIRED');
}

export function isSendingLeaseExpired(record: AppEventOutboxRecord, now: string): boolean {
  validateOutboxRecord(record);
  if (record.state !== 'sending' || !record.leaseExpiresAt) return false;
  return Date.parse(record.leaseExpiresAt) <= instant(now, 'APP_EVENT_OUTBOX_CLAIM_TIME_INVALID');
}

export function recoverExpiredSendingOutbox(
  record: AppEventOutboxRecord,
  now: string,
  nextRetryAt: string,
): AppEventOutboxRecord {
  validateOutboxRecord(record);
  if (record.state !== 'sending') throw new Error('APP_EVENT_OUTBOX_RECOVERY_STATE_INVALID');
  if (!isSendingLeaseExpired(record, now)) throw new Error('APP_EVENT_OUTBOX_LEASE_NOT_EXPIRED');
  return transitionOutbox(record, 'retry_wait', now, { nextRetryAt });
}
