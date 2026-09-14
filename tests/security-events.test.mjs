import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blocksLastLoginMethodRemoval,
  countLoginMethods,
  fetchSecurityEventsForUser,
  insertSecurityEvent,
  sanitizeSecurityEventMetadata,
  tenantIdForUser,
} from '../functions/_security-events.ts';

test('sanitizeSecurityEventMetadata keeps allowlisted keys only', () => {
  const metadata = sanitizeSecurityEventMetadata({
    provider: 'google',
    method: 'oauth',
    unknown_key: 'drop-me',
    reason: 'ok',
  });
  assert.deepEqual(metadata, {
    provider: 'google',
    method: 'oauth',
    reason: 'ok',
  });
});

test('sanitizeSecurityEventMetadata drops sensitive key names', () => {
  const metadata = sanitizeSecurityEventMetadata({
    password: 'secret',
    access_token: 'abc',
    api_secret: 'xyz',
    credential_id: 'cred',
    backup_codes: '111',
    provider: 'github',
  });
  assert.deepEqual(metadata, { provider: 'github' });
});

test('insertSecurityEvent stores sanitized metadata', async () => {
  const inserts = [];
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          inserts.push({ query, values: this.values });
          return { success: true };
        },
      };
    },
  };
  const headers = new Headers({ 'User-Agent': 'test-agent', 'CF-Connecting-IP': '203.0.113.10' });
  await insertSecurityEvent({
    db,
    userId: 'user-a',
    tenantId: tenantIdForUser('user-a'),
    eventType: 'sign_in_email',
    correlationId: 'corr-1',
    headers,
    metadata: { provider: 'email', password: 'must-not-store' },
  });
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].query, /INSERT INTO account_security_events/);
  const metadataJson = inserts[0].values[7];
  assert.equal(metadataJson.includes('password'), false);
  assert.equal(metadataJson.includes('must-not-store'), false);
  assert.match(metadataJson, /"provider":"email"/);
});

test('insertSecurityEvent swallows missing table errors', async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error('D1_ERROR: no such table: account_security_events');
        },
      };
    },
  };
  await assert.doesNotReject(() => insertSecurityEvent({
    db,
    userId: 'user-a',
    tenantId: tenantIdForUser('user-a'),
    eventType: 'sign_out',
    correlationId: 'corr-2',
    headers: new Headers(),
  }));
});

test('countLoginMethods aggregates credential oauth and passkeys', async () => {
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          this.query = query;
          this.values = values;
          return this;
        },
        async first() {
          if (this.query.includes('SELECT id FROM "account"')) {
            return { id: 'cred-1' };
          }
          if (this.query.includes('SELECT COUNT(*) AS count FROM "account"')) {
            return { count: 2 };
          }
          if (this.query.includes('FROM passkey')) {
            return { count: 1 };
          }
          return null;
        },
      };
    },
  };
  const counts = await countLoginMethods(db, 'user-a');
  assert.deepEqual(counts, {
    credential: true,
    oauth: 2,
    passkeys: 1,
    total: 4,
  });
});

test('blocksLastLoginMethodRemoval rejects final login method', () => {
  assert.equal(blocksLastLoginMethodRemoval({ credential: true, oauth: 0, passkeys: 0, total: 1 }), true);
  assert.equal(blocksLastLoginMethodRemoval({ credential: true, oauth: 1, passkeys: 0, total: 2 }), false);
});

test('fetchSecurityEventsForUser scopes events to tenant and user', async () => {
  const rows = [
    {
      id: 'evt-a',
      event_type: 'sign_in_email',
      actor_ip: '203.0.113.1',
      user_agent: 'agent-a',
      correlation_id: 'c-a',
      metadata_json: '{}',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  const db = {
    prepare(query) {
      return {
        bind(tenantId, userId, limit) {
          this.tenantId = tenantId;
          this.userId = userId;
          this.limit = limit;
          return this;
        },
        async all() {
          if (this.userId === 'user-a' && this.tenantId === tenantIdForUser('user-a')) {
            return { results: rows };
          }
          return { results: [] };
        },
      };
    },
  };
  const forA = await fetchSecurityEventsForUser(db, tenantIdForUser('user-a'), 'user-a');
  const forB = await fetchSecurityEventsForUser(db, tenantIdForUser('user-b'), 'user-b');
  assert.equal(forA.length, 1);
  assert.equal(forB.length, 0);
});
