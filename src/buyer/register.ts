// =============================================================================
// Buyer registration — wires a real wallet into the paid-probe seam when one
// is configured. Without PIXA_BUYER_MNEMONIC the registry behaves exactly as
// before: paid probes report `skipped` instead of failing.
// =============================================================================

import { registerBuyer } from '../verify/probe.js';
import { createAlgorandTestnetBuyer } from './algorand.js';

export function registerBuyersFromEnv(): void {
  const mnemonic = process.env.PIXA_BUYER_MNEMONIC?.trim();
  if (!mnemonic) return;
  try {
    registerBuyer(createAlgorandTestnetBuyer(mnemonic));
  } catch (err) {
    // stderr only — the MCP server owns stdout for the protocol stream.
    console.error('[pixa-registry] failed to configure Algorand buyer:', err instanceof Error ? err.message : err);
  }
}
