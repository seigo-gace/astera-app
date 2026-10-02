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
  revisionId?: string;
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

const VALID_SCOPES = new Set<string>(['system', 'user']);
const VALID_DOMAINS = new Set<string>([
  'runtime', 'auth', 'account', 'security', 'conversation', 'job', 'result', 'project',
  'file', 'storage', 'billing', 'credit', 'plan', 'share', 'template', 'notification',
  'privacy', 'developer_api', 'integration', 'reconciliation',
]);
const VALID_SEVERITIES = new Set<string>(['trace', 'debug', 'info', 'warn', 'error']);
const VALID_ENVELOPE_KEYS = new Set<string>([
  'schema', 'eventId', 'occurredAt', 'scope', 'domain', 'event', 'severity',
  'correlationId', 'source', 'state', 'errorClass', 'refs', 'attributes',
]);
const VALID_REF_KEYS = new Set<string>([
  'tenantRef', 'userRef', 'conversationId', 'turnId', 'jobId', 'resultId', 'revisionId',
  'projectId', 'fileId', 'operationId',
]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const SAFE_OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const FORBIDDEN_ATTRIBUTE_KEY = /(?:password|passwd|secret|token|authorization|cookie|session|otp|cvv|card|private[_-]?payload|raw[_-]?prompt|raw[_-]?file|dek|api[_-]?key)/i;
const NO_ATTRIBUTES = [] as const;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_REF_LENGTH = 512;
const MAX_ATTRIBUTE_COUNT = 32;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;
const MAX_ATTRIBUTE_STRING_LENGTH = 512;

function requiredText(value: unknown, name: string, max = MAX_IDENTIFIER_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`APP_EVENT_${name}_REQUIRED`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`APP_EVENT_${name}_REQUIRED`);
  if (trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`APP_EVENT_${name}_INVALID`);
  }
  return trimmed;
}

function requiredOpaque(value: unknown, name: string, max = MAX_IDENTIFIER_LENGTH): string {
  const token = requiredText(value, name, max);
  if (!SAFE_OPAQUE.test(token)) throw new Error(`APP_EVENT_${name}_INVALID`);
  return token;
}

function optionalToken(value: unknown, name: string): void {
  if (value === undefined) return;
  const token = requiredText(value, name, 128);
  if (!SAFE_TOKEN.test(token)) throw new Error(`APP_EVENT_${name}_INVALID`);
}

function validateRefs(value: unknown): AppEventRef | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('APP_EVENT_REFS_INVALID');
  }
  const refs = value as Record<string, unknown>;
  for (const [key, refValue] of Object.entries(refs)) {
    if (!VALID_REF_KEYS.has(key)) throw new Error(`APP_EVENT_REF_NOT_ALLOWED:${key}`);
    if (refValue === undefined) continue;
    requiredOpaque(refValue, `REF_${key.toUpperCase()}`, MAX_REF_LENGTH);
  }
  return refs as AppEventRef;
}

function validateAttributes(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('APP_EVENT_ATTRIBUTES_INVALID');
  }
  const attributes = value as Record<string, unknown>;
  const entries = Object.entries(attributes);
  if (entries.length > MAX_ATTRIBUTE_COUNT) throw new Error('APP_EVENT_ATTRIBUTES_TOO_MANY');
  for (const [key, attributeValue] of entries) {
    if (!key || key.length > MAX_ATTRIBUTE_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(key)) {
      throw new Error(`APP_EVENT_ATTRIBUTE_KEY_INVALID:${key}`);
    }
    if (FORBIDDEN_ATTRIBUTE_KEY.test(key)) {
      throw new Error(`APP_EVENT_FORBIDDEN_ATTRIBUTE:${key}`);
    }
    if (
      attributeValue !== null
      && typeof attributeValue !== 'string'
      && typeof attributeValue !== 'number'
      && typeof attributeValue !== 'boolean'
    ) {
      throw new Error(`APP_EVENT_ATTRIBUTE_VALUE_INVALID:${key}`);
    }
    if (typeof attributeValue === 'number' && !Number.isFinite(attributeValue)) {
      throw new Error(`APP_EVENT_ATTRIBUTE_VALUE_INVALID:${key}`);
    }
    if (
      typeof attributeValue === 'string'
      && (attributeValue.length > MAX_ATTRIBUTE_STRING_LENGTH || /[\u0000-\u001f\u007f]/.test(attributeValue))
    ) {
      throw new Error(`APP_EVENT_ATTRIBUTE_VALUE_INVALID:${key}`);
    }
  }
  return attributes as Record<string, string | number | boolean | null>;
}

export function validateAppEvent(input: AppEventEnvelope): AppEventEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('APP_EVENT_ENVELOPE_INVALID');
  for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
    if (!VALID_ENVELOPE_KEYS.has(key)) throw new Error(`APP_EVENT_FIELD_NOT_ALLOWED:${key}`);
  }
  if ((input as { schema?: unknown }).schema !== 'astera.app.event.v1') throw new Error('APP_EVENT_SCHEMA_INVALID');

  requiredOpaque(input.eventId, 'EVENT_ID');
  const occurredAt = requiredText(input.occurredAt, 'OCCURRED_AT', 64);
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error('APP_EVENT_OCCURRED_AT_INVALID');
  if (!VALID_SCOPES.has(input.scope)) throw new Error('APP_EVENT_SCOPE_INVALID');
  if (!VALID_DOMAINS.has(input.domain)) throw new Error('APP_EVENT_DOMAIN_INVALID');
  const eventName = requiredText(input.event, 'NAME', 128);
  if (!SAFE_TOKEN.test(eventName)) throw new Error('APP_EVENT_NAME_INVALID');
  if (!VALID_SEVERITIES.has(input.severity)) throw new Error('APP_EVENT_SEVERITY_INVALID');
  requiredOpaque(input.correlationId, 'CORRELATION_ID');
  const source = requiredText(input.source, 'SOURCE', 128);
  if (!SAFE_TOKEN.test(source)) throw new Error('APP_EVENT_SOURCE_INVALID');
  optionalToken(input.state, 'STATE');
  optionalToken(input.errorClass, 'ERROR_CLASS');

  const refs = validateRefs(input.refs);
  validateAttributes(input.attributes);

  if (input.scope === 'user' && !refs?.userRef) {
    throw new Error('APP_EVENT_USER_REF_REQUIRED');
  }
  if (input.scope === 'system' && refs?.userRef) {
    throw new Error('APP_EVENT_SYSTEM_USER_REF_FORBIDDEN');
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
  allowedAttributes: readonly string[];
}>;

export const APP_EVENT_REGISTRY = {
  CONVERSATION_CREATED: {
    domain: 'conversation', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'conversationId'], allowedAttributes: NO_ATTRIBUTES,
  },
  CONVERSATION_TURN_STORED: {
    domain: 'conversation', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'conversationId', 'turnId', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  JOB_ACCEPTED: {
    domain: 'job', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  JOB_COMPLETED: {
    domain: 'job', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  JOB_PARTIALLY_COMPLETED: {
    domain: 'job', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  JOB_FAILED: {
    domain: 'job', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  JOB_CANCELLED: {
    domain: 'job', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId'], allowedAttributes: NO_ATTRIBUTES,
  },
  RESULT_CREATED: {
    domain: 'result', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'jobId', 'resultId'], allowedAttributes: NO_ATTRIBUTES,
  },
  RESULT_REVISED: {
    domain: 'result', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId', 'revisionId'], allowedAttributes: NO_ATTRIBUTES,
  },
  RESULT_DELETION_SCHEDULED: {
    domain: 'result', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId'], allowedAttributes: NO_ATTRIBUTES,
  },
  RESULT_RESTORED: {
    domain: 'result', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'resultId'], allowedAttributes: NO_ATTRIBUTES,
  },
  FILE_UPLOAD_READY: {
    domain: 'file', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'], allowedAttributes: NO_ATTRIBUTES,
  },
  STORAGE_OBJECT_STORED: {
    domain: 'storage', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'], allowedAttributes: NO_ATTRIBUTES,
  },
  STORAGE_OBJECT_DELETION_SCHEDULED: {
    domain: 'storage', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'], allowedAttributes: NO_ATTRIBUTES,
  },
  STORAGE_OBJECT_RESTORED: {
    domain: 'storage', scope: 'user', delivery: 'durable_outbox',
    requiredRefs: ['userRef', 'fileId'], allowedAttributes: NO_ATTRIBUTES,
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
  for (const key of Object.keys(event.attributes ?? {})) {
    if (!definition.allowedAttributes.includes(key)) {
      throw new Error(`APP_EVENT_ATTRIBUTE_NOT_ALLOWED:${event.event}:${key}`);
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
const VALID_OUTBOX_STATES = new Set<string>(Object.keys(ALLOWED_TRANSITIONS));

function instant(value: string | undefined, code: string): number {
  if (!value?.trim()) throw new Error(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

export function validateOutboxRecord(record: AppEventOutboxRecord): AppEventOutboxRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('APP_EVENT_OUTBOX_RECORD_INVALID');
  }
  validateRegisteredAppEvent(record.event);
  requiredText(record.id, 'OUTBOX_ID');
  requiredText(record.eventId, 'OUTBOX_EVENT_ID');
  if (record.eventId !== record.event.eventId) throw new Error('APP_EVENT_OUTBOX_EVENT_ID_MISMATCH');
  requiredText(record.idempotencyKey, 'OUTBOX_IDEMPOTENCY_KEY', 512);
  if (!VALID_OUTBOX_STATES.has(record.state)) throw new Error('APP_EVENT_OUTBOX_STATE_INVALID');
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) throw new Error('APP_EVENT_OUTBOX_ATTEMPT_INVALID');
  if (record.tgsOperationId !== undefined) requiredText(record.tgsOperationId, 'OUTBOX_TGS_OPERATION_ID', 512);

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
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
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
