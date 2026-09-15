import { spawnSync } from 'node:child_process';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const USER_ID = 'test-account';
const EMAIL = 'test@astera.local';
const NAME = 'Test Account';
const PASSWORD = process.env.ASTERA_TEST_ACCOUNT_PASSWORD?.trim() || 'TestAccount-2026!';
const ACCOUNT_ROW_ID = 'credential-test-account';

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(command) {
  const args = ['wrangler', 'd1', 'execute', 'ASTERA_DB', '--local', '--command', command];
  const result = spawnSync('npx', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: process.env.CI ?? '1',
      WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS ?? 'false',
    },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed (${result.status ?? 'unknown'}): ${output || command}`);
  }
  return output;
}

const now = Date.now();
const passwordHash = await hashPassword(PASSWORD);
const hashOk = await verifyPassword({ hash: passwordHash, password: PASSWORD });
if (!hashOk) {
  throw new Error('seed-test-account: generated password hash failed local verification');
}

const tenantId = `personal:${USER_ID}`;
const creditId = `credit:${tenantId}`;
const isoNow = new Date(now).toISOString();

const statements = [
  `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled")
   VALUES (${sqlLiteral(USER_ID)}, ${sqlLiteral(NAME)}, ${sqlLiteral(EMAIL)}, 1, ${now}, ${now}, 0)
   ON CONFLICT("id") DO UPDATE SET
     "name" = excluded."name",
     "email" = excluded."email",
     "emailVerified" = 1,
     "updatedAt" = excluded."updatedAt";`,
  `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
   VALUES (${sqlLiteral(ACCOUNT_ROW_ID)}, ${sqlLiteral(USER_ID)}, 'credential', ${sqlLiteral(USER_ID)}, ${sqlLiteral(passwordHash)}, ${now}, ${now})
   ON CONFLICT("providerId", "accountId") DO UPDATE SET
     "userId" = excluded."userId",
     "password" = excluded."password",
     "updatedAt" = excluded."updatedAt";`,
  `INSERT INTO tenants (id, kind, display_name, created_at, updated_at)
   VALUES (${sqlLiteral(tenantId)}, 'personal', ${sqlLiteral(NAME)}, ${sqlLiteral(isoNow)}, ${sqlLiteral(isoNow)})
   ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at;`,
  `INSERT INTO user_profiles (user_id, tenant_id, nickname, account_status, ui_language, created_at, updated_at)
   VALUES (${sqlLiteral(USER_ID)}, ${sqlLiteral(tenantId)}, ${sqlLiteral(NAME)}, 'active', 'ja-JP', ${sqlLiteral(isoNow)}, ${sqlLiteral(isoNow)})
   ON CONFLICT(user_id) DO UPDATE SET
     tenant_id = excluded.tenant_id,
     nickname = excluded.nickname,
     account_status = 'active',
     updated_at = excluded.updated_at;`,
  `INSERT INTO credit_accounts (id, tenant_id, available_balance, reserved_balance, version, updated_at)
   VALUES (${sqlLiteral(creditId)}, ${sqlLiteral(tenantId)}, 0, 0, 0, ${sqlLiteral(isoNow)})
   ON CONFLICT(tenant_id) DO NOTHING;`,
];

for (const statement of statements) {
  runWrangler(statement.replace(/\s+/g, ' ').trim());
}

const verifyUser = runWrangler(
  `SELECT id, email, emailVerified FROM "user" WHERE id = ${sqlLiteral(USER_ID)} LIMIT 1;`,
);
if (!verifyUser.includes(USER_ID) || !verifyUser.includes(EMAIL)) {
  throw new Error(`seed-test-account: user row missing after seed:\n${verifyUser}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      user_id: USER_ID,
      email: EMAIL,
      emailVerified: true,
      account_status: 'active',
    },
    null,
    2,
  ),
);
