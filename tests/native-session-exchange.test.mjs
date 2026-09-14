import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeExchangeRecord, safeReturnPath } from '../functions/_native-exchange-util.ts';

const ORIGIN = 'https://app.example.test';

test('safeReturnPath rejects external and auth-group targets', () => {
  assert.equal(safeReturnPath('/app/projects', ORIGIN), '/app/projects');
  assert.equal(safeReturnPath('https://evil.example/phish', ORIGIN), '/app/new');
  assert.equal(safeReturnPath('/login', ORIGIN), '/app/new');
  assert.equal(safeReturnPath('//evil.example/path', ORIGIN), '/app/new');
});

test('safeReturnPath rejects encoded external URLs and non-app paths', () => {
  assert.equal(safeReturnPath(encodeURIComponent('https://evil.example/phish'), ORIGIN), '/app/new');
  assert.equal(safeReturnPath('/account/security', ORIGIN), '/app/new');
  assert.equal(safeReturnPath('/app/new?tab=1#focus', ORIGIN), '/app/new?tab=1#focus');
});

test('safeReturnPath rejects control characters', () => {
  assert.equal(safeReturnPath('/app/new\u0007', ORIGIN), '/app/new');
});

test('native session exchange JSON body must not expose session token fields', () => {
  const payload = {
    user: { id: 'user-1', email: 'user@example.test', emailVerified: true, name: null, twoFactorEnabled: false },
    account: { account_status: 'active', email: 'user@example.test', email_verified: true },
    emailVerified: true,
    requires_password_setup: false,
    twoFactorRedirect: false,
    auth_stage: 'authenticated',
  };
  const body = { data: payload, ...payload };
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('session-token-value'), false);
  assert.equal(Object.hasOwn(body, 'token'), false);
  assert.equal(Object.hasOwn(body.data ?? {}, 'token'), false);
});

test('consumeExchangeRecord is one-time and rejects expired tokens', async () => {
  const store = new Map();
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (query.includes('SELECT "id", "value", "expiresAt"')) {
            const identifier = this.values[0];
            return store.get(identifier) ?? null;
          }
          return null;
        },
        async run() {
          if (query.startsWith('INSERT INTO "verification"')) {
            const identifier = this.values[1];
            store.set(identifier, {
              id: this.values[0],
              value: this.values[2],
              expiresAt: this.values[3],
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (query.startsWith('DELETE FROM "verification"')) {
            const identifier = this.values[1];
            const row = store.get(identifier);
            if (!row) return { success: true, meta: { changes: 0 } };
            if (query.includes('"expiresAt"')) {
              if (row.expiresAt !== this.values[3] || row.value !== this.values[2]) {
                return { success: true, meta: { changes: 0 } };
              }
            }
            store.delete(identifier);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };

  const rawToken = 'exchange-token-1234567890';
  const identifierPrefix = 'astera-native-exchange:';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken.trim()));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const identifier = `${identifierPrefix}${hash}`;

  const now = Date.now();
  store.set(identifier, {
    id: 'verification-1',
    value: 'session-token-value',
    expiresAt: now + 60_000,
  });

  const first = await consumeExchangeRecord(db, rawToken);
  assert.equal(first, 'session-token-value');
  const second = await consumeExchangeRecord(db, rawToken);
  assert.equal(second, null);

  store.set(identifier, {
    id: 'verification-2',
    value: 'expired-session-token',
    expiresAt: now - 1,
  });
  const expired = await consumeExchangeRecord(db, rawToken);
  assert.equal(expired, null);
});
