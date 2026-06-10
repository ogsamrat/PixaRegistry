// =============================================================================
// End-to-end proof of the full agent flow on Algorand testnet:
//
//   discover (submit) -> inspect -> verify -> PAID probe with REAL on-chain
//   USDC settlement -> independent confirmation via the AlgoNode indexer.
//
// Prereqs:
//   1. `npm.cmd run wallets`  — both wallets opted into USDC ASA 10458941
//   2. Buyer funded with testnet USDC via https://faucet.circle.com
//   3. `npm.cmd run seller`   — test seller running on port 4910
//
// Run:  npm.cmd run e2e
// =============================================================================

import 'dotenv/config';
import { registerBuyersFromEnv } from '../src/buyer/register.js';
import { walletFromMnemonic } from '../src/buyer/wallet.js';
import { getDbPath } from '../src/db/client.js';
import { submitService, reverify } from '../src/registry/service.js';

const USDC_ASA = 10458941;
const PRICE_ATOMIC = 1000n; // $0.001
const SELLER_PORT = Number(process.env.PIXA_TEST_SELLER_PORT ?? 4910);
const SELLER_URL = `http://localhost:${SELLER_PORT}`;
const RESOURCE_URL = `${SELLER_URL}/weather/current`;
const ALGOD_URL = 'https://testnet-api.algonode.cloud';
const INDEXER_URL = 'https://testnet-idx.algonode.cloud';

let step = 0;
function banner(msg: string): void {
  step += 1;
  console.log(`\n[${step}] ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`    ✓ ${msg}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buyerAddressFromEnv(): Promise<string> {
  const mnemonic = process.env.PIXA_BUYER_MNEMONIC?.trim();
  if (!mnemonic) {
    console.error('PIXA_BUYER_MNEMONIC is not set — copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return (await walletFromMnemonic(mnemonic)).address;
}

async function usdcBalance(addr: string): Promise<bigint | null> {
  const res = await fetch(`${ALGOD_URL}/v2/accounts/${addr}`);
  if (!res.ok) throw new Error(`algod returned ${res.status} for ${addr}`);
  const info = (await res.json()) as { assets?: { 'asset-id': number; amount: number }[] };
  const asset = info.assets?.find((a) => a['asset-id'] === USDC_ASA);
  return asset ? BigInt(asset.amount) : null;
}

interface IndexerAxfer {
  'asset-id': number;
  amount: number;
  receiver: string;
}
interface IndexerTxn {
  'confirmed-round'?: number;
  sender: string;
  'asset-transfer-transaction'?: IndexerAxfer;
}

async function waitForIndexer(txid: string): Promise<IndexerTxn> {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const res = await fetch(`${INDEXER_URL}/v2/transactions/${txid}`);
    if (res.ok) {
      const body = (await res.json()) as { transaction: IndexerTxn };
      return body.transaction;
    }
    if (res.status !== 404) throw new Error(`indexer returned ${res.status} for ${txid}`);
    console.log(`    … indexer has not seen ${txid} yet (attempt ${attempt}/15)`);
    await sleep(3000);
  }
  throw new Error(`indexer never confirmed txid ${txid}`);
}

async function main(): Promise<void> {
  process.env.PIXA_ALLOW_PRIVATE ??= '1'; // the test seller lives on localhost

  console.log('PIXA end-to-end paid verification — Algorand testnet');
  console.log(`    registry DB: ${getDbPath()}`);

  banner(`Test seller is up at ${SELLER_URL}`);
  let health: { payTo: string; network: string };
  try {
    const res = await fetch(`${SELLER_URL}/health`);
    assert(res.ok, `GET /health -> ${res.status}`);
    health = (await res.json()) as typeof health;
  } catch (err) {
    console.error(`    ✗ test seller unreachable — start it with \`npm.cmd run seller\` (${err})`);
    process.exit(1);
  }
  console.log(`    payTo ${health.payTo} on ${health.network}`);

  banner('Buyer wallet holds testnet USDC');
  const buyerAddr = await buyerAddressFromEnv();
  const balance = await usdcBalance(buyerAddr);
  if (balance === null || balance < PRICE_ATOMIC) {
    console.error(
      balance === null
        ? `    ✗ buyer ${buyerAddr} is not opted into USDC — run \`npm.cmd run wallets\` first`
        : `    ✗ buyer ${buyerAddr} holds only ${balance} µUSDC (< ${PRICE_ATOMIC})`,
    );
    console.error('      Fund it at https://faucet.circle.com (network: Algorand Testnet), then retry.');
    process.exit(1);
  }
  console.log(`    ✓ buyer ${buyerAddr}`);
  console.log(`    ✓ balance ${(Number(balance) / 1e6).toFixed(6)} USDC`);

  banner('Register the Algorand testnet buyer adapter');
  registerBuyersFromEnv();
  console.log('    ✓ buyer adapter registered from PIXA_BUYER_MNEMONIC');

  banner(`Submit the weather endpoint (${RESOURCE_URL})`);
  const submitted = await submitService(
    {
      resourceUrl: RESOURCE_URL,
      name: 'PIXA Test — Current Weather',
      description:
        'Local x402 test seller: current weather (city, tempC, conditions) for ?city=. $0.001 USDC per call, settled on Algorand testnet via the GoPlausible facilitator.',
      category: 'weather',
      tags: ['weather', 'test', 'x402', 'algorand-testnet'],
      method: 'GET',
      outputSchema: {
        type: 'object',
        required: ['city', 'tempC', 'conditions'],
        properties: {
          city: { type: 'string' },
          tempC: { type: 'number' },
          conditions: { type: 'string' },
          humidityPct: { type: 'number' },
          observedAt: { type: 'string', format: 'date-time' },
        },
      },
      exampleResponse: {
        city: 'Pune',
        tempC: 27,
        conditions: 'partly cloudy',
        humidityPct: 58,
        observedAt: '2026-06-08T12:00:00.000Z',
      },
      paymentScheme: 'exact',
      paymentNetworks: ['algorand-testnet'],
      priceAtomic: PRICE_ATOMIC.toString(),
      priceDisplay: '$0.001',
      token: 'USDC',
      payTo: health.payTo,
      facilitator: 'https://facilitator.goplausible.xyz',
    },
    { verify: false },
  );
  const serviceId = submitted.service.serviceId;
  console.log(`    ✓ stored as ${serviceId}`);

  banner('Verify with a REAL paid probe (USDC settles on-chain)');
  const summary = await reverify(serviceId, { paid: true });
  assert(summary, 'verification ran');
  for (const probe of summary.probes) {
    console.log(`    probe ${probe.kind.padEnd(6)} ok=${probe.ok}${probe.statusCode ? ` status=${probe.statusCode}` : ''}`);
  }
  const paidProbe = summary.probes.find((p) => p.kind === 'paid');
  assert(paidProbe, 'paid probe ran');
  assert(paidProbe.ok, 'paid probe succeeded (2xx after payment)');
  assert(!paidProbe.detail?.skipped, 'paid probe was not skipped');
  const txid = paidProbe.detail?.txid;
  assert(typeof txid === 'string' && txid.length > 0, `settlement txid captured: ${String(txid)}`);

  banner('Independently confirm settlement on the AlgoNode indexer');
  const txn = await waitForIndexer(txid as string);
  const axfer = txn['asset-transfer-transaction'];
  assert(txn['confirmed-round'], `confirmed in round ${txn['confirmed-round']}`);
  assert(axfer, 'transaction is an ASA transfer');
  assert(axfer['asset-id'] === USDC_ASA, `asset is USDC (ASA ${USDC_ASA})`);
  assert(BigInt(axfer.amount) === PRICE_ATOMIC, `amount is ${PRICE_ATOMIC} µUSDC ($0.001)`);
  assert(axfer.receiver === health.payTo, `receiver is the seller ${health.payTo}`);

  banner('Trust report reflects the paid verification');
  const scores = summary.scores;
  console.log(
    `    operational=${scores.operational} schema=${scores.schema} domain=${scores.domain} reliability=${scores.reliability}`,
  );
  assert(scores.labels.includes('Payment Verified'), 'label "Payment Verified" granted');
  assert(scores.labels.includes('Gating Verified'), 'label "Gating Verified" granted');
  assert(scores.tier === 'verified', `tier is "verified" (got "${scores.tier}")`);

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(' E2E PASSED — discover → inspect → verify → paid call settled');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  service   ${serviceId}`);
  console.log(`  status    ${summary.status} / tier ${scores.tier}`);
  console.log(`  labels    ${scores.labels.join(', ')}`);
  console.log(`  txid      ${txid}`);
  console.log(`  explorer  https://lora.algokit.io/testnet/transaction/${txid}`);
  console.log(`\n  Spot checks:`);
  console.log(`    npx tsx src/cli.ts inspect ${serviceId}`);
  console.log(`    npx tsx src/cli.ts verify ${serviceId} --paid`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
