import { Pool } from 'pg';
import type { Db } from './types';
import { SCHEMA } from './schema';

let pool: Pool | null = null;
let migrated: Promise<void> | null = null;

export function dbUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_URL || env.POSTGRES_URL || '';
}

export function makePool(url: string): Pool {
  return new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
}

/** The app's one database connection pool. Throws when no database is connected yet. */
export function getDb(): Db {
  const url = dbUrl();
  if (!url) throw new Error('no-database');
  if (!pool) pool = makePool(url);
  return pool as unknown as Db;
}

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}

/** Creates the tables once per server start. A failed attempt is retried on the next request. */
export function ensureMigrated(db: Db): Promise<void> {
  if (!migrated) {
    migrated = migrate(db).catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}

/**
 * Text that Postgres will accept. Trimming text to a length can slice an emoji in half, and Postgres refuses
 * half an emoji (and the null character) inside JSON. Halves become the "unknown character" mark; nulls go.
 */
export function safeText(s: string): string {
  return s.replace(/\u0000/g, '').toWellFormed();
}

/** JSON for a database parameter, with every string inside made safe. Use this, never bare JSON.stringify. */
export function jsonParam(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'string' ? safeText(v) : v));
}

export async function kvGet<T>(db: Db, key: string): Promise<T | null> {
  const r = await db.query<{ value: T }>('select value from kv where key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

export async function kvSet(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into kv (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, jsonParam(value)],
  );
}
