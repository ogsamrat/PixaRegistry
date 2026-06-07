// =============================================================================
// Network registry — the multichain compatibility layer.
//
// PIXA is deliberately NOT locked to one facilitator/chain. This table is the
// source of truth for which networks exist, how they are paid, and how a wallet
// or the PIXA Hub can settle on them.
// =============================================================================

import type { ChainFamily, NetworkInfo, WalletCompatibility } from '../types.js';

// Algorand genesis-hash CAIP-2 ids (match the pixa-api seller project).
export const ALGORAND_TESTNET_CAIP2 = 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
export const ALGORAND_MAINNET_CAIP2 = 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qkit8=';

export const NETWORKS: NetworkInfo[] = [
  {
    id: ALGORAND_TESTNET_CAIP2,
    slug: 'algorand-testnet',
    family: 'algorand',
    displayName: 'Algorand Testnet',
    isTestnet: true,
    defaultAsset: '10458941', // USDC (testnet ASA)
    hubPayable: true,
    directlyPayable: true,
    cdpOnly: false,
  },
  {
    id: ALGORAND_MAINNET_CAIP2,
    slug: 'algorand-mainnet',
    family: 'algorand',
    displayName: 'Algorand Mainnet',
    isTestnet: false,
    defaultAsset: '31566704', // USDC (mainnet ASA)
    hubPayable: true,
    directlyPayable: true,
    cdpOnly: false,
  },
  {
    id: 'eip155:8453',
    slug: 'base',
    family: 'evm',
    displayName: 'Base',
    isTestnet: false,
    defaultAsset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    hubPayable: true,
    directlyPayable: true,
    cdpOnly: true,
  },
  {
    id: 'eip155:84532',
    slug: 'base-sepolia',
    family: 'evm',
    displayName: 'Base Sepolia',
    isTestnet: true,
    defaultAsset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    hubPayable: true,
    directlyPayable: true,
    cdpOnly: true,
  },
  {
    id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // mainnet-beta genesis (truncated form used as slug anchor)
    slug: 'solana',
    family: 'solana',
    displayName: 'Solana Mainnet',
    isTestnet: false,
    hubPayable: true,
    directlyPayable: false,
    cdpOnly: false,
  },
  {
    id: 'stellar:pubnet',
    slug: 'stellar',
    family: 'stellar',
    displayName: 'Stellar Pubnet',
    isTestnet: false,
    hubPayable: true,
    directlyPayable: false,
    cdpOnly: false,
  },
];

const BY_SLUG = new Map(NETWORKS.map((n) => [n.slug.toLowerCase(), n]));
const BY_ID = new Map(NETWORKS.map((n) => [n.id.toLowerCase(), n]));

/** Resolve a slug, CAIP-2 id, or display name to a NetworkInfo (best effort). */
export function resolveNetwork(input: string): NetworkInfo | undefined {
  if (!input) return undefined;
  const key = input.trim().toLowerCase();
  return (
    BY_ID.get(key) ??
    BY_SLUG.get(key) ??
    NETWORKS.find((n) => n.displayName.toLowerCase() === key) ??
    // tolerate "algorand:..." family prefixes that aren't an exact match
    NETWORKS.find((n) => n.id.toLowerCase() === key || key.startsWith(n.family + ':'))
  );
}

/** Canonical id for a network input; returns the input unchanged if unknown. */
export function canonicalNetworkId(input: string): string {
  return resolveNetwork(input)?.id ?? input.trim();
}

export function networkFamily(input: string): ChainFamily {
  return resolveNetwork(input)?.family ?? 'other';
}

/**
 * Decide how the given set of networks can be paid given the current wallet mode.
 * walletMode reflects what the *caller's* wallet/hub supports.
 */
export function walletCompatibilityFor(
  networkIds: string[],
  walletMode: { algorand: boolean; hub: boolean; cdp: boolean } = { algorand: true, hub: true, cdp: false },
): WalletCompatibility {
  const infos = networkIds.map(resolveNetwork).filter((n): n is NetworkInfo => !!n);
  if (infos.length === 0) return 'unsupported';

  const anyAlgorand = infos.some((n) => n.family === 'algorand');
  if (anyAlgorand && walletMode.algorand) {
    // Algorand-native: payable directly by an Algorand wallet.
    return 'algorand-native';
  }
  const anyDirect = infos.some((n) => n.directlyPayable && !n.cdpOnly);
  if (anyDirect) return 'directly-payable';

  const anyHub = infos.some((n) => n.hubPayable);
  if (anyHub && walletMode.hub) return 'hub-payable';

  const allCdp = infos.every((n) => n.cdpOnly);
  if (allCdp) return walletMode.cdp ? 'directly-payable' : 'cdp-only';

  return 'unsupported';
}

export function listNetworks(): NetworkInfo[] {
  return [...NETWORKS];
}
