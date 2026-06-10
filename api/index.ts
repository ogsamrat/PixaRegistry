// =============================================================================
// Vercel serverless entry point.
//
// vercel.json rewrites /api/* to this function; @hono/node-server/vercel
// preserves the original path so Hono's /api-mounted routes match exactly as
// they do locally. (Do NOT use `hono/vercel` — that adapter targets the
// Edge/Web runtime and breaks on Node.)
//
// The wrapper restores the SQLite DB from Vercel Blob before the first query
// of each cold start and mirrors it back after every mutating request.
// =============================================================================

import { handle } from '@hono/node-server/vercel';
import { Hono } from 'hono';
import { app } from '../src/api/server.js';
import { registerBuyersFromEnv } from '../src/buyer/register.js';
import { persistDb, restoreDb, syncForWrite } from '../src/db/blob-persist.js';

export const runtime = 'nodejs';

registerBuyersFromEnv();

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const vercelApp = new Hono();
vercelApp.use(async (c, next) => {
  // Writes first re-sync to the newest snapshot so a stale warm instance
  // can't silently revert mutations persisted by other instances.
  if (MUTATING.has(c.req.method)) await syncForWrite();
  else await restoreDb();
  await next();
  if (MUTATING.has(c.req.method)) await persistDb();
});
vercelApp.route('/', app);

export default handle(vercelApp);
