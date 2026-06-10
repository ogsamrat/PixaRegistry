// =============================================================================
// CLI — the builder/ops surface (secondary per spec).
//
//   pixa init                         create the database
//   pixa seed                         load sample listings
//   pixa submit <url> [flags]         register + verify a listing
//   pixa list [--q ..] [filters]      list listings
//   pixa search <query...> [filters]  ranked search (agent cards)
//   pixa inspect <id> [--json]        full detail
//   pixa verify <id|--all> [--paid]   re-run verification
//   pixa networks                     supported networks
//   pixa stats                        registry counts
//   pixa serve [--port N]             start the HTTP API
//   pixa mcp                          start the MCP (stdio) server
// =============================================================================

import 'dotenv/config';
import type { SearchFilters } from './types.js';
import { getDbPath } from './db/client.js';
import { registerBuyersFromEnv } from './buyer/register.js';
import { listNetworks } from './config/networks.js';
import { search } from './search/search.js';
import {
  getServiceDetail,
  listServices,
  removeService,
  reverify,
  submitService,
} from './registry/service.js';
import { verifyAll } from './verify/runner.js';

interface ParsedArgs {
  cmd: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [cmd = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('--')) {
      let key = t.slice(2);
      let val: string | true;
      if (key.includes('=')) {
        const idx = key.indexOf('=');
        val = key.slice(idx + 1);
        key = key.slice(0, idx);
      } else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
        val = rest[++i];
      } else {
        val = true;
      }
      flags[key] = val;
    } else {
      positionals.push(t);
    }
  }
  return { cmd, positionals, flags };
}

const isTrue = (v: string | true | undefined): boolean => v === true || v === 'true' || v === '1';
const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function collectFilters(flags: Record<string, string | true>): SearchFilters {
  const f: SearchFilters = {};
  if (str(flags.network)) f.network = str(flags.network);
  if (str(flags.family)) f.family = str(flags.family) as SearchFilters['family'];
  if (str(flags.scheme)) f.scheme = str(flags.scheme) as SearchFilters['scheme'];
  if (flags.testnet !== undefined) f.testnet = isTrue(flags.testnet);
  if (flags.mainnet !== undefined) f.mainnet = isTrue(flags.mainnet);
  if (str(flags.category)) f.category = str(flags.category);
  if (str(flags.minTrust)) f.minTrust = str(flags.minTrust) as SearchFilters['minTrust'];
  if (flags['include-broken'] !== undefined) f.includeBroken = isTrue(flags['include-broken']);
  return f;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

function printCards(results: ReturnType<typeof search>): void {
  if (results.length === 0) {
    console.log('(no results)');
    return;
  }
  console.log(pad('TIER', 12) + pad('NAME', 28) + pad('PRICE', 14) + pad('NETWORKS', 22) + 'ID');
  for (const r of results) {
    const c = r.card;
    console.log(
      pad(c.trustTier, 12) +
        pad(c.name, 28) +
        pad(c.priceDisplay ?? '—', 14) +
        pad(c.paymentNetworks.join(',') || '—', 22) +
        c.serviceId,
    );
  }
  console.log(`\n${results.length} result(s).`);
}

async function main(): Promise<void> {
  const { cmd, positionals, flags } = parseArgs(process.argv.slice(2));
  registerBuyersFromEnv();

  switch (cmd) {
    case 'init': {
      const { getDb } = await import('./db/client.js');
      getDb();
      console.log(`DB initialized at ${getDbPath()}`);
      break;
    }

    case 'seed': {
      await import('./seed.js'); // runs the seeder
      break;
    }

    case 'submit': {
      const url = positionals[0];
      if (!url) {
        console.error('usage: pixa submit <url> [--name .. --desc .. --category .. --tags a,b --method GET --networks algorand-testnet,base --price-atomic 1000 --token USDC --pay-to ADDR --scheme exact --no-verify]');
        process.exit(1);
      }
      const result = await submitService(
        {
          resourceUrl: url,
          name: str(flags.name),
          description: str(flags.desc) ?? str(flags.description),
          category: str(flags.category),
          tags: str(flags.tags)?.split(',').map((t) => t.trim()).filter(Boolean),
          method: str(flags.method) as never,
          paymentNetworks: str(flags.networks)?.split(',').map((t) => t.trim()).filter(Boolean),
          priceAtomic: str(flags['price-atomic']),
          priceDisplay: str(flags.price),
          token: str(flags.token),
          payTo: str(flags['pay-to']),
          paymentScheme: str(flags.scheme) as never,
          facilitator: str(flags.facilitator),
        },
        { verify: !isTrue(flags['no-verify']) },
      );
      console.log(`${result.created ? 'Created' : 'Updated'}: ${result.service.serviceId}`);
      if (result.verification) {
        console.log(`  status: ${result.verification.status}  tier: ${result.verification.scores.tier}`);
        if (result.verification.warnings.length) console.log(`  warnings: ${result.verification.warnings.join(' | ')}`);
      }
      break;
    }

    case 'list': {
      const results = search({ q: str(flags.q), filters: collectFilters(flags), limit: Number(str(flags.limit) ?? 50) });
      if (isTrue(flags.json)) console.log(JSON.stringify(results, null, 2));
      else printCards(results);
      break;
    }

    case 'search': {
      const q = positionals.join(' ');
      const results = search({ q, filters: collectFilters(flags), limit: Number(str(flags.limit) ?? 20) });
      if (isTrue(flags.json)) console.log(JSON.stringify(results, null, 2));
      else {
        console.log(`Search: "${q}"`);
        printCards(results);
      }
      break;
    }

    case 'inspect': {
      const id = positionals[0];
      const detail = id ? getServiceDetail(id) : undefined;
      if (!detail) {
        console.error(`not found: ${id ?? '(no id)'}`);
        process.exit(1);
      }
      if (isTrue(flags.json)) {
        console.log(JSON.stringify(detail, null, 2));
        break;
      }
      const s = detail.service;
      console.log(`${s.name}  [${s.serviceId}]`);
      console.log(`  ${s.method} ${s.resourceUrl}`);
      console.log(`  ${s.description || '(no description)'}`);
      console.log(`  category: ${s.category ?? '—'}  tags: ${s.tags.join(', ') || '—'}`);
      console.log(`  price: ${s.priceDisplay ?? '—'}  networks: ${s.paymentNetworks.join(', ') || '—'}`);
      console.log(`  wallet: ${s.walletCompatibility}  status: ${s.status}  tier: ${s.scores.tier}`);
      console.log(`  labels: ${s.scores.labels.join(', ') || '—'}`);
      console.log(`  scores: op=${s.scores.operational.toFixed(2)} schema=${s.scores.schema.toFixed(2)} reliability=${s.scores.reliability.toFixed(2)} uptime=${s.scores.uptime.toFixed(2)}`);
      console.log(`  recent probes:`);
      for (const p of detail.probeRuns.slice(0, 6)) {
        console.log(`    ${p.at}  ${pad(p.kind, 7)} ${p.ok ? 'ok ' : 'FAIL'} ${p.statusCode ?? ''} ${p.diagnostics.map((d) => d.code).join(',')}`);
      }
      break;
    }

    case 'verify': {
      if (isTrue(flags.all)) {
        const summaries = await verifyAll({ paid: isTrue(flags.paid) });
        for (const s of summaries) console.log(`  ${pad(s.service.name, 30)} ${pad(s.status, 9)} ${s.scores.tier}`);
        console.log(`\nVerified ${summaries.length} service(s).`);
        break;
      }
      const id = positionals[0];
      const summary = id ? await reverify(id, { paid: isTrue(flags.paid) }) : undefined;
      if (!summary) {
        console.error(`not found: ${id ?? '(no id)'}`);
        process.exit(1);
      }
      console.log(`${id}: status=${summary.status} tier=${summary.scores.tier}`);
      for (const p of summary.probes) console.log(`  ${pad(p.kind, 7)} ${p.ok ? 'ok ' : 'FAIL'} ${p.diagnostics.map((d) => `${d.code}(${d.severity})`).join(', ')}`);
      break;
    }

    case 'delete':
    case 'remove': {
      const id = positionals[0];
      if (!id) {
        console.error('usage: pixa delete <id>');
        process.exit(1);
      }
      console.log(removeService(id) ? `deleted ${id}` : `not found: ${id}`);
      break;
    }

    case 'networks': {
      console.log(pad('SLUG', 20) + pad('FAMILY', 10) + pad('NET', 9) + pad('WALLET', 26) + 'ID');
      for (const n of listNetworks()) {
        const w = `direct=${n.directlyPayable} hub=${n.hubPayable} cdp=${n.cdpOnly}`;
        console.log(pad(n.slug, 20) + pad(n.family, 10) + pad(n.isTestnet ? 'testnet' : 'mainnet', 9) + pad(w, 26) + n.id);
      }
      break;
    }

    case 'stats': {
      const all = listServices();
      const byStatus: Record<string, number> = {};
      const byTier: Record<string, number> = {};
      for (const s of all) {
        byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
        byTier[s.scores.tier] = (byTier[s.scores.tier] ?? 0) + 1;
      }
      console.log(`total: ${all.length}`);
      console.log(`status: ${JSON.stringify(byStatus)}`);
      console.log(`tier:   ${JSON.stringify(byTier)}`);
      break;
    }

    case 'serve': {
      const { serve } = await import('@hono/node-server');
      const { app } = await import('./api/server.js');
      const port = Number(str(flags.port) ?? process.env.PORT ?? 4055);
      const server = serve({ fetch: app.fetch, port }, () => console.log(`PIXA Registry API on http://localhost:${port}`));
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`port ${port} is already in use — another instance is probably running (try --port ${port + 1})`);
        } else {
          console.error('server error:', err);
        }
        process.exit(1);
      });
      break;
    }

    case 'mcp': {
      const { startMcp } = await import('./mcp/server.js');
      await startMcp(); // starts the stdio server
      break;
    }

    case 'help':
    default: {
      console.log(`PIXA Registry CLI

  pixa init                         create the database
  pixa seed                         load sample listings
  pixa submit <url> [flags]         register + verify a listing
  pixa list [--q ..] [filters]      list listings
  pixa search <query...> [filters]  ranked search
  pixa inspect <id> [--json]        full detail
  pixa verify <id|--all> [--paid]   re-run verification
  pixa delete <id>                  remove a listing
  pixa networks                     supported networks
  pixa stats                        registry counts
  pixa serve [--port N]             start the HTTP API
  pixa mcp                          start the MCP (stdio) server

  filters: --network --family --scheme --testnet --mainnet --category --minTrust --include-broken
  DB: ${getDbPath()}`);
      break;
    }
  }
}

main().catch((err) => {
  console.error('error:', err);
  process.exit(1);
});
