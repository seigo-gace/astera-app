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

/**
 * Validates the App-owned event boundary before any external persistence.
 *
 * This is deliberately stricter than a generic logger: arbitrary payload bodies,
 * credentials and raw private content have no field in the contract. The TGserver
 * adapter may add transport metadata, but must not weaken this gate.
 */
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
