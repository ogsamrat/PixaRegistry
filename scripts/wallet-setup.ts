// =============================================================================
// Wallet setup — prepares the buyer + seller Algorand testnet wallets for real
// paid probes. For each wallet it checks the USDC (ASA 10458941) opt-in and,
// if missing, sends the 0-amount self-transfer that opts the account in.
//
// Run:  npm.cmd run wallets      (requires PIXA_BUYER_MNEMONIC and
//                                 PIXA_SELLER_MNEMONIC in .env)
//
// After opt-in, fund the BUYER with testnet USDC at https://faucet.circle.com
// (select "Algorand Testnet") — without the opt-in the faucet transfer cannot
// land, which is why earlier faucet attempts showed no balance.
// =============================================================================

import 'dotenv/config';
import { AlgorandClient } from '@algorandfoundation/algokit-utils/algorand-client';
import { generateAddressWithSigners } from '@algorandfoundation/algokit-utils/transact';
import { walletFromMnemonic } from '../src/buyer/wallet.js';

const USDC_ASA = 10458941n;
const ALGOD_URL = 'https://testnet-api.algonode.cloud';
const FAUCET_URL = 'https://faucet.circle.com';

interface AlgodAsset {
  'asset-id': number;
  amount: number;
}
interface AlgodAccount {
  amount: number; // µALGO
  assets?: AlgodAsset[];
}

async function fetchAccount(addr: string): Promise<AlgodAccount | null> {
  const res = await fetch(`${ALGOD_URL}/v2/accounts/${addr}`);
  if (res.status === 404) return null; // account never funded
  if (!res.ok) throw new Error(`algod returned ${res.status} for ${addr}`);
  return (await res.json()) as AlgodAccount;
}

/** USDC balance in µUSDC, or null when the account is not opted in. */
function usdcBalance(info: AlgodAccount | null): bigint | null {
  const asset = info?.assets?.find((a) => a['asset-id'] === Number(USDC_ASA));
  return asset ? BigInt(asset.amount) : null;
}

function fmtAlgo(microAlgo: number): string {
  return `${(microAlgo / 1e6).toFixed(6)} ALGO`;
}
function fmtUsdc(atomic: bigint): string {
  return `${(Number(atomic) / 1e6).toFixed(6)} USDC`;
}

async function setupWallet(
  algorand: AlgorandClient,
  label: string,
  mnemonic: string,
): Promise<{ addr: string; usdc: bigint | null }> {
  const wallet = await walletFromMnemonic(mnemonic);
  const addr = wallet.address;
  const { signer } = generateAddressWithSigners({
    ed25519Pubkey: wallet.ed25519Pubkey,
    rawEd25519Signer: wallet.rawSigner,
  });
  algorand.account.setSigner(addr, signer);
  console.log(`\n── ${label} ─ ${addr}`);

  const info = await fetchAccount(addr);
  if (!info) {
    console.log('   ✗ account has no ALGO — fund it at https://bank.testnet.algorand.network first');
    return { addr, usdc: null };
  }
  console.log(`   ALGO balance: ${fmtAlgo(info.amount)}`);

  let usdc = usdcBalance(info);
  if (usdc === null) {
    console.log(`   USDC (ASA ${USDC_ASA}): not opted in — sending opt-in transaction…`);
    const result = await algorand.send.assetOptIn({ sender: addr, assetId: USDC_ASA });
    console.log(`   ✓ opt-in confirmed (txid ${result.txIds[0]})`);
    usdc = usdcBalance(await fetchAccount(addr));
  }
  console.log(`   USDC balance: ${usdc === null ? 'opt-in pending' : fmtUsdc(usdc)}`);
  return { addr, usdc };
}

async function main(): Promise<void> {
  const buyerMnemonic = process.env.PIXA_BUYER_MNEMONIC?.trim();
  const sellerMnemonic = process.env.PIXA_SELLER_MNEMONIC?.trim();
  if (!buyerMnemonic || !sellerMnemonic) {
    console.error('Set PIXA_BUYER_MNEMONIC and PIXA_SELLER_MNEMONIC in .env (see .env.example).');
    process.exit(1);
  }

  console.log('PIXA wallet setup — Algorand testnet, USDC ASA', USDC_ASA.toString());
  const algorand = AlgorandClient.testNet();

  const buyer = await setupWallet(algorand, 'Buyer ', buyerMnemonic);
  const seller = await setupWallet(algorand, 'Seller', sellerMnemonic);

  console.log('\n── Summary ──────────────────────────────────────────────');
  const ready = buyer.usdc !== null && buyer.usdc > 0n;
  if (!ready) {
    console.log(`   Buyer needs testnet USDC. Fund it at ${FAUCET_URL}`);
    console.log(`     network: Algorand Testnet`);
    console.log(`     address: ${buyer.addr}`);
    console.log('   Then re-run `npm.cmd run wallets` to confirm, and `npm.cmd run e2e`.');
  } else {
    console.log(`   Buyer is funded (${fmtUsdc(buyer.usdc!)}) — ready for paid probes.`);
    console.log('   Next: `npm.cmd run seller` (terminal 1) then `npm.cmd run e2e` (terminal 2).');
  }
  console.log(`   Seller opt-in: ${seller.usdc === null ? 'MISSING' : 'ok'} (${seller.addr})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('wallet-setup failed:', err);
  process.exit(1);
});
