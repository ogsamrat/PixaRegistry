// HTTP API entry point.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './api/server.js';
import { getDb, getDbPath } from './db/client.js';
import { registerBuyersFromEnv } from './buyer/register.js';

const PORT = Number(process.env.PORT ?? 4055);

getDb(); // ensure tables exist
registerBuyersFromEnv();

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n[pixa-registry] 🛰  PIXA Registry API ready`);
  console.log(`[pixa-registry]   URL: http://localhost:${PORT}`);
  console.log(`[pixa-registry]   DB:  ${getDbPath()}`);
  console.log(`[pixa-registry]   Try: curl http://localhost:${PORT}/search?q=producthunt\n`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[pixa-registry] ✖ Port ${PORT} is already in use — another instance is probably running.`);
    console.error(`[pixa-registry]   Stop it, or start on a different port:`);
    console.error(`[pixa-registry]   PORT=${PORT + 1} npm run start:api\n`);
  } else {
    console.error('[pixa-registry] server error:', err);
  }
  process.exit(1);
});
