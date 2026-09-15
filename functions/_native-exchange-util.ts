import { resolveSafeReturnPath } from '#shared/safe-return-path-core';
import type { D1Database } from './_account-projection';

export type ExchangeD1Database = D1Database;

const EXCHANGE_IDENTIFIER_PREFIX = 'astera-native-exchange:';

export function safeReturnPath(rawValue: string | null | undefined, origin: string, fallback = '/app/new'): string {
  return resolveSafeReturnPath(rawValue, origin, fallback, { requireAppPrefix: true });
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function exchangeIdentifier(rawToken: string): Promise<string> {
  return sha256Hex(rawToken.trim()).then((hash) => `${EXCHANGE_IDENTIFIER_PREFIX}${hash}`);
}

export async function insertExchangeRecord(db: ExchangeD1Database, sessionToken: string, ttlMs = 90_000): Promise<string> {
  const raw = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const identifier = await exchangeIdentifier(raw);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  ).bind(crypto.randomUUID(), identifier, sessionToken, now + ttlMs, now).run();
  return raw;
}

export async function consumeExchangeRecord(db: ExchangeD1Database, rawToken: string): Promise<string | null> {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const identifier = await exchangeIdentifier(trimmed);
  const now = Date.now();
  const row = await db.prepare(
    `SELECT "id", "value", "expiresAt" FROM "verification" WHERE "identifier" = ?1 LIMIT 1`,
  ).bind(identifier).first<{ id: string; value: string; expiresAt: number }>();
  if (!row?.id || !row.value) return null;
  if (Number(row.expiresAt) <= now) {
    await db.prepare(
      `DELETE FROM "verification" WHERE "id" = ?1 AND "identifier" = ?2`,
    ).bind(row.id, identifier).run();
    return null;
  }
  const deleted = await db.prepare(
    `DELETE FROM "verification" WHERE "id" = ?1 AND "identifier" = ?2 AND "value" = ?3 AND "expiresAt" = ?4`,
  ).bind(row.id, identifier, row.value, row.expiresAt).run();
  const deletedChanges = Number(deleted.meta?.changes ?? 0);
  if (!deleted.success || deletedChanges < 1) return null;
  return row.value;
}
