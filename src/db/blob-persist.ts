// =============================================================================
// Vercel Blob persistence for the SQLite database.
//
// Serverless filesystems are ephemeral, so on Vercel the DB lives at
// /tmp/pixa.db and is mirrored to a Vercel Blob store:
//   - restoreDb(): on cold start, download the newest `pixa-db/<ts>.db` blob
//     into the local DB path before the first connection opens.
//   - persistDb(): after a mutating request, checkpoint the WAL and upload the
//     DB file under a fresh timestamped pathname (unique URLs sidestep CDN
//     caching entirely), then prune old snapshots.
//
// Without BLOB_READ_WRITE_TOKEN both functions are silent no-ops, so local dev
// and the CLI keep using the plain on-disk file.
// =============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closeDb, getDbPath, getRawDb } from './client.js';

const PREFIX = 'pixa-db/';
const KEEP_SNAPSHOTS = 5;
const PRUNE_MIN_AGE_MS = 10 * 60_000; // never prune snapshots younger than this

function enabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN && getDbPath() !== ':memory:';
}

let restored: Promise<void> | null = null;
/** Newest snapshot pathname this process has seen (restored from or uploaded). */
let lastSeenSnapshot: string | null = null;

/** Download the latest DB snapshot once per process (no-op when disabled). */
export function restoreDb(): Promise<void> {
  if (!restored) restored = doRestore();
  return restored;
}

async function doRestore(): Promise<void> {
  if (!enabled()) return;
  const dbPath = getDbPath();
  if (existsSync(dbPath)) return; // warm instance — already restored
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
    if (blobs.length === 0) return; // first boot ever — start empty
    const latest = blobs.reduce((a, b) => (a.pathname > b.pathname ? a : b));
    const res = await fetch(latest.url);
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, buf);
    lastSeenSnapshot = latest.pathname;
    console.log(`[blob-persist] restored ${latest.pathname} (${buf.length} bytes)`);
  } catch (err) {
    console.error('[blob-persist] restore failed (starting empty):', err);
  }
}

/**
 * Re-sync from the blob store before a WRITE: a warm instance may hold a DB
 * older than the newest snapshot (another instance persisted since we
 * restored), and persisting on top of stale data would silently revert those
 * mutations. Safe to swap the file here because better-sqlite3 is synchronous:
 * no statement is ever mid-flight while this async code runs.
 */
export async function syncForWrite(): Promise<void> {
  if (!enabled()) return;
  await restoreDb();
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
    if (blobs.length === 0) return;
    const latest = blobs.reduce((a, b) => (a.pathname > b.pathname ? a : b));
    if (latest.pathname === lastSeenSnapshot) return; // already current
    const res = await fetch(latest.url);
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    closeDb();
    writeFileSync(getDbPath(), buf);
    lastSeenSnapshot = latest.pathname;
    console.log(`[blob-persist] write-sync to ${latest.pathname} (${buf.length} bytes)`);
  } catch (err) {
    console.error('[blob-persist] write-sync failed (continuing with local state):', err);
  }
}

// Serialize + coalesce uploads: one in flight, at most one queued.
let inFlight: Promise<void> | null = null;
let queued = false;

/** Upload the current DB to the blob store (no-op when disabled). */
export async function persistDb(): Promise<void> {
  if (!enabled()) return;
  if (inFlight) {
    queued = true;
    return inFlight;
  }
  inFlight = doPersist().finally(() => {
    inFlight = null;
    if (queued) {
      queued = false;
      void persistDb();
    }
  });
  return inFlight;
}

async function doPersist(): Promise<void> {
  try {
    const { put, list, del } = await import('@vercel/blob');
    getRawDb().pragma('wal_checkpoint(TRUNCATE)');
    const buf = await readFile(getDbPath());
    const pathname = `${PREFIX}${Date.now()}.db`;
    await put(pathname, buf, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
    });
    lastSeenSnapshot = pathname;
    // Best-effort prune: keep the newest snapshots, never touch recent ones.
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
    const sorted = [...blobs].sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    const stale = sorted
      .slice(KEEP_SNAPSHOTS)
      .filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > PRUNE_MIN_AGE_MS);
    if (stale.length > 0) await del(stale.map((b) => b.url));
    console.log(`[blob-persist] saved ${pathname} (${buf.length} bytes)`);
  } catch (err) {
    console.error('[blob-persist] persist failed:', err);
  }
}
