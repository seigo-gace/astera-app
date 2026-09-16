import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAuth } from '../functions/_auth.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function mockAuthEnv() {
  const mockDb = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {},
        async first() {},
        async all() {},
      };
    },
  };
  return {
    ASTERA_DB: mockDb,
    BETTER_AUTH_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
    BETTER_AUTH_URL: 'https://app.example.test',
    AUTH_EMAIL_ENDPOINT: 'https://email.example/send',
    AUTH_EMAIL_TOKEN: 'token',
  };
}

test('createAuth configures minPasswordLength to 6', async () => {
  const auth = createAuth(mockAuthEnv());
  assert.equal(auth.options.emailAndPassword.minPasswordLength, 6);
  assert.equal(auth.options.emailAndPassword.maxPasswordLength, 128);
  await auth.$context.catch(() => {});
});

test('auth pages handler routes POST set-password through auth.api.setPassword', () => {
  const source = readFileSync(`${repoRoot}/functions/api/auth/[[path]].ts`, 'utf8');
  assert.match(source, /pathname === '\/api\/auth\/set-password' && context\.request\.method === 'POST'/);
  assert.match(source, /auth\.api\.setPassword\(\{/);
  assert.match(source, /asResponse: true/);
  assert.doesNotMatch(source, /auth\.api\.changePassword\(\{/);
});
