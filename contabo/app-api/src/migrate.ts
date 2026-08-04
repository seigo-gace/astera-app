import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL_NOT_CONFIGURED');
const migrationsDir = resolve(process.env.MIGRATIONS_DIR?.trim() || '/app/migrations');
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  application_name: 'astera-app-api-migrate',
});
const client = await pool.connect();

try {
  await client.query(`SELECT pg_advisory_lock(hashtext('astera-app-api-migrations'))`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const filename of files) {
    const sql = await readFile(resolve(migrationsDir, filename), 'utf8');
    const checksumBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
    const checksum = [...new Uint8Array(checksumBuffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
    const existing = await client.query<{ checksum: string }>(`SELECT checksum FROM schema_migrations WHERE filename = $1`, [filename]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
      console.log(JSON.stringify({ level: 'info', event: 'migration_already_applied', filename }));
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)`, [filename, checksum]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ level: 'info', event: 'migration_applied', filename, checksum }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query(`SELECT pg_advisory_unlock(hashtext('astera-app-api-migrations'))`).catch(() => undefined);
  client.release();
  await pool.end();
}
