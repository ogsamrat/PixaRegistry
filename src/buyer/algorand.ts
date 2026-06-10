// =============================================================================
// Algorand testnet BuyerAdapter — settles x402 "exact" payments with USDC.
//
// Built on the official @x402 client stack: the ExactAvmScheme constructs an
// atomic transaction group (optional facilitator fee-payer txn + the signed
// ASA transfer) and the x402HTTPClient encodes it into the v2
// `PAYMENT-SIGNATURE` header. Fee pooling means the buyer pays zero ALGO fees
// when the seller's facilitator sponsors the group.
//
// Signing goes through SigningWallet.rawSigner so both classic (25-word) and
// Pera HD (24-word BIP39 / ARC-52) wallets work — HD keys are not plain
// ed25519 seeds, so toClientAvmSigner() cannot be used here.
// =============================================================================

import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID, type ClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { Network, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import {
  bytesForSigning,
  decodeTransaction,
  encodeSignedTransaction,
} from '@algorandfoundation/algokit-utils/transact';
import type { BuyerAdapter } from '../verify/probe.js';
import type { ServiceRecord } from '../types.js';
import type { X402Accept } from '../util/x402.js';
import { walletFromMnemonic, type SigningWallet } from './wallet.js';

// Probes spend real (testnet) funds against third-party endpoints, so cap how
// much a single challenge can ask for. Override with PIXA_BUYER_MAX_ATOMIC.
const DEFAULT_MAX_ATOMIC = 100_000n; // 0.1 USDC (6 decimals)

function spendCap(): bigint {
  const raw = process.env.PIXA_BUYER_MAX_ATOMIC?.trim();
  if (raw) {
    try {
      return BigInt(raw);
    } catch {
      /* fall through to default */
    }
  }
  return DEFAULT_MAX_ATOMIC;
}

/** Wraps a SigningWallet as the wallet interface the x402 client expects. */
function toAvmSigner(wallet: SigningWallet): ClientAvmSigner {
  return {
    address: wallet.address,
    signTransactions(txns: Uint8Array[], indexesToSign?: number[]): Promise<(Uint8Array | null)[]> {
      return Promise.all(
        txns.map(async (bytes, i) => {
          if (indexesToSign && !indexesToSign.includes(i)) return null;
          const txn = decodeTransaction(bytes);
          const sig = await wallet.rawSigner(bytesForSigning.transaction(txn));
          return encodeSignedTransaction({ txn, sig });
        }),
      );
    },
  };
}

export function createAlgorandTestnetBuyer(mnemonic: string): BuyerAdapter {
  // Key derivation is async (HD wallets), so initialize lazily on first pay().
  let httpClient: Promise<x402HTTPClient> | undefined;
  function getHttp(): Promise<x402HTTPClient> {
    httpClient ??= (async () => {
      const wallet = await walletFromMnemonic(mnemonic);
      const client = new x402Client().register(
        ALGORAND_TESTNET_CAIP2 as Network,
        new ExactAvmScheme(toAvmSigner(wallet)),
      );
      return new x402HTTPClient(client);
    })();
    return httpClient;
  }

  const maxAtomic = spendCap();

  return {
    id: 'algorand-testnet-exact',

    canPay(accept: X402Accept): boolean {
      if (accept.network !== ALGORAND_TESTNET_CAIP2) return false;
      if ((accept.scheme ?? 'exact').toLowerCase() !== 'exact') return false;
      // Only settle the asset this wallet actually holds (testnet USDC).
      if (accept.asset && accept.asset !== USDC_TESTNET_ASA_ID) return false;
      if (!accept.payTo || !accept.amount) return false;
      try {
        const amount = BigInt(accept.amount);
        return amount > 0n && amount <= maxAtomic;
      } catch {
        return false;
      }
    },

    async pay(service: ServiceRecord, accept: X402Accept): Promise<string> {
      const requirements: PaymentRequirements = {
        scheme: accept.scheme ?? 'exact',
        network: accept.network as Network,
        asset: accept.asset ?? USDC_TESTNET_ASA_ID,
        amount: accept.amount ?? '0',
        payTo: accept.payTo ?? '',
        maxTimeoutSeconds: accept.maxTimeoutSeconds ?? 300,
        extra: accept.extra ?? {},
      };
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
        resource: { url: service.resourceUrl },
        accepts: [requirements],
      };
      const http = await getHttp();
      const payload = await http.createPaymentPayload(paymentRequired);
      const headers = http.encodePaymentSignatureHeader(payload);
      const header =
        headers['PAYMENT-SIGNATURE'] ?? headers['payment-signature'] ?? headers['X-PAYMENT'] ?? headers['x-payment'];
      if (!header) throw new Error('x402 client produced no payment header');
      return header;
    },
  };
}
