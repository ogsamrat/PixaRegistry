// =============================================================================
// Mnemonic → signing wallet. Supports both Algorand wallet formats:
//
//   • 25 words — classic Algorand (algo25) mnemonic; the words encode the
//     ed25519 seed directly.
//   • 24 words — BIP39 phrase from an HD wallet (Pera's newer wallets).
//     Keys follow ARC-52: BIP44 path m/44'/283'/account'/0/keyIndex with
//     Peikert BIP32-Ed25519 derivation. We use account 0 / keyIndex 0 — the
//     wallet's primary address as shown in Pera.
//
// HD keys are NOT plain ed25519 seeds, so callers must sign through
// `rawSigner` rather than exporting a raw secret key.
// =============================================================================

import { Buffer } from 'node:buffer';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';
import { ed25519Generator, type RawEd25519Signer } from '@algorandfoundation/algokit-utils/crypto';
import { encodeAddress } from '@algorandfoundation/algokit-utils/common';
import { BIP32DerivationType, KeyContext, XHDWalletAPI, fromSeed } from '@algorandfoundation/xhd-wallet-api';

export interface SigningWallet {
  address: string;
  ed25519Pubkey: Uint8Array;
  /** Signs domain-prefixed bytes (e.g. "TX" + msgpack) with the account key. */
  rawSigner: RawEd25519Signer;
}

export async function walletFromMnemonic(mnemonic: string): Promise<SigningWallet> {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length === 25) return algo25Wallet(words.join(' '));
  if (words.length === 24) return hdWallet(words.join(' '));
  throw new Error(
    `Unsupported mnemonic length ${words.length}: need 25 words (classic Algorand) or 24 words (BIP39 HD wallet).`,
  );
}

function algo25Wallet(mnemonic: string): SigningWallet {
  const seed = seedFromMnemonic(mnemonic);
  const { ed25519Pubkey, rawEd25519Signer } = ed25519Generator(seed);
  return { address: encodeAddress(ed25519Pubkey), ed25519Pubkey, rawSigner: rawEd25519Signer };
}

async function hdWallet(mnemonic: string): Promise<SigningWallet> {
  // BIP39 seed (empty passphrase): PBKDF2-HMAC-SHA512(phrase, "mnemonic", 2048 rounds, 64 bytes).
  const seed = pbkdf2(sha512, mnemonic.normalize('NFKD'), 'mnemonic'.normalize('NFKD'), { c: 2048, dkLen: 64 });
  const rootKey = fromSeed(Buffer.from(seed));
  const api = new XHDWalletAPI();
  const account = 0;
  const keyIndex = 0;
  const derivation = BIP32DerivationType.Peikert;
  const ed25519Pubkey = await api.keyGen(rootKey, KeyContext.Address, account, keyIndex, derivation);
  return {
    address: encodeAddress(ed25519Pubkey),
    ed25519Pubkey,
    rawSigner: (bytes) => api.signAlgoTransaction(rootKey, KeyContext.Address, account, keyIndex, bytes, derivation),
  };
}
