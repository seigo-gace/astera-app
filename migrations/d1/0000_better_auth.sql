-- Better Auth core + Passkey + Two-Factor schema for Cloudflare D1.
-- Apply before Astera application tables in 0001_identity_billing_credit.sql.
-- Column names follow Better Auth's default Kysely/D1 schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0 CHECK ("emailVerified" IN (0, 1)),
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "twoFactorEnabled" INTEGER NOT NULL DEFAULT 0 CHECK ("twoFactorEnabled" IN (0, 1))
);

CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "session_token_idx" ON "session" ("token");
CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session" ("expiresAt");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE,
  UNIQUE ("providerId", "accountId")
);

CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "account_provider_account_idx" ON "account" ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS "verification_expiresAt_idx" ON "verification" ("expiresAt");

CREATE TABLE IF NOT EXISTS "passkey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialID" TEXT NOT NULL UNIQUE,
  "counter" INTEGER NOT NULL DEFAULT 0 CHECK ("counter" >= 0),
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL DEFAULT 0 CHECK ("backedUp" IN (0, 1)),
  "transports" TEXT,
  "createdAt" INTEGER,
  "aaguid" TEXT,
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("userId");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey" ("credentialID");

CREATE TABLE IF NOT EXISTS "twoFactor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "verified" INTEGER NOT NULL DEFAULT 0 CHECK ("verified" IN (0, 1)),
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0 CHECK ("failedVerificationCount" >= 0),
  "lockedUntil" INTEGER,
  FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor" ("userId");
