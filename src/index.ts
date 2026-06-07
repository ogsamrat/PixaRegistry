// HTTP API entry point.
import { serve } from '@hono/node-server';
import { app } from './api/server.js';
import { getDb, getDbPath } from './db/client.js';

const PORT = Number(process.env.PORT ?? 4055);

getDb(); // ensure tables exist

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n[pixa-registry] 🛰  PIXA Registry API ready`);
  console.log(`[pixa-registry]   URL: http://localhost:${PORT}`);
  console.log(`[pixa-registry]   DB:  ${getDbPath()}`);
  console.log(`[pixa-registry]   Try: curl http://localhost:${PORT}/search?q=producthunt\n`);
});
