// One-shot: mirror the local SQLite DB to the Vercel Blob store so production
// cold starts restore from it. Token comes from .env.vercel (created with
// `npx vercel env pull .env.vercel`) or the environment.
import { config } from 'dotenv';
config();
config({ path: '.env.vercel' });

const { persistDb } = await import('../src/db/blob-persist.js');
const { getDbPath } = await import('../src/db/client.js');

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN missing — run: npx vercel env pull .env.vercel');
  process.exit(1);
}

console.log(`[push-db] uploading ${getDbPath()} to Vercel Blob…`);
await persistDb();
console.log('[push-db] done');
