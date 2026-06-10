// =============================================================================
// SQLite connection (better-sqlite3 + Drizzle).
//
// The DB file lives at $PIXA_DB or ./data/pixa.db. Tables are created idempotently
// on first connect, so `npm run seed` / starting the API "just works" with no
// migration step. A single shared connection is reused across the process.
// =============================================================================

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(here, '../../data/pixa.db');

export type DB = BetterSQLite3Database<typeof schema>;

let _db: DB | null = null;
let _raw: Database.Database | null = null;

export function getDbPath(): string {
  const env = process.env.PIXA_DB?.trim();
  if (!env) {
    // Serverless: only /tmp is writable; blob-persist mirrors it across starts.
    if (process.env.VERCEL) return '/tmp/pixa.db';
    return DEFAULT_DB_PATH;
  }
  if (env === ':memory:') return env; // resolve() would mangle the sentinel into a file path
  return resolve(env);
}

export function getDb(): DB {
  if (_db) return _db;

  const dbPath = getDbPath();
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000'); // wait, don't throw SQLITE_BUSY, under WAL contention
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(schema.CREATE_TABLES_SQL);

  _raw = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

/** Direct access to the underlying better-sqlite3 handle (rarely needed). */
export function getRawDb(): Database.Database {
  if (!_raw) getDb();
  return _raw!;
}

export function closeDb(): void {
  if (_raw) {
    _raw.close();
    _raw = null;
    _db = null;
  }
}
