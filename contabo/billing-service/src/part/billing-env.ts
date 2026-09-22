import type { AsteraProjectionClient } from '../feature/astera-projection.js';
import type { LibralVaultClient } from '../feature/libral-vault.js';

export type D1Result<T> = { results?: T[]; success?: boolean; error?: string; meta?: Record<string, unknown> };
export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  run: () => Promise<D1Result<Record<string, unknown>>>;
};
export type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<Array<D1Result<Record<string, unknown>>>>;
};

export type BillingServiceEnv = {
  PORT?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_APPLICATION_ID?: string;
  SQUARE_ENVIRONMENT?: string;
  SQUARE_VERSION?: string;
  SQUARE_WEBHOOK_NOTIFICATION_URL?: string;
  APP_PUBLIC_ORIGIN?: string;
  BILLING_APP_SECRET?: string;
  BILLING_APP_SECRET_FILE?: string;
  BILLING_PROJECTION_SECRET?: string;
  BILLING_PROJECTION_SECRET_FILE?: string;
  ASTERA_PROJECTION_API_URL?: string;
  LIBRAL_VAULT_INTERNAL_ORIGIN?: string;
  LIBRAL_VAULT_INTERNAL_TOKEN?: string;
  VAULT_SQUARE_ACCESS_SECRET_ID?: string;
  VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID?: string;
  /** @deprecated Runtime billing must not use D1; tests may inject memory D1 only. */
  ASTERA_DB?: D1Database;
  vault?: LibralVaultClient | null;
  projection?: AsteraProjectionClient | null;
};

export class FunctionHttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'FunctionHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class D1LiveWriteBlockedError extends Error {
  code = 'D1_LIVE_WRITE_BLOCKED';

  constructor(message = 'Live D1 write blocked') {
    super(message);
    this.name = 'D1LiveWriteBlockedError';
  }
}

export type SessionUser = {
  id: string;
  email: string;
  emailVerified?: boolean;
  name?: string | null;
};

export type UserProfileRow = {
  user_id: string;
  tenant_id: string;
  nickname: string;
  account_status: string;
  ui_language: string;
  created_at: string;
  updated_at: string;
};

export type CreditRow = {
  id: string;
  tenant_id: string;
  available_balance: number;
  reserved_balance: number;
  version: number;
  updated_at: string;
};

export type BillingActorProjection = {
  user: SessionUser;
  profile: UserProfileRow;
  credit: CreditRow;
};

export function requestCorrelationId(headers: Headers): string {
  return headers.get('X-Request-ID')?.trim() || crypto.randomUUID();
}

export function functionErrorResponse(error: unknown, requestId: string): Response {
  const normalized = error instanceof FunctionHttpError
    ? error
    : new FunctionHttpError(500, 'INTERNAL_SERVER_ERROR', '処理を完了できませんでした。', error instanceof Error ? error.message : String(error));
  return Response.json({
    error: {
      code: normalized.code,
      message: normalized.message,
      correlation_id: requestId,
      retryable: normalized.status >= 500,
      details: normalized.details,
    },
  }, {
    status: normalized.status,
    headers: { 'Cache-Control': 'no-store', 'X-Correlation-ID': requestId },
  });
}
