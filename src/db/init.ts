// Initialize the database (create tables) and report. Safe to run repeatedly.
import { getDb, getDbPath } from './client.js';

getDb();
console.log(`[pixa-registry] DB initialized at ${getDbPath()}`);
