import { TIER_COLORS, type TrustTier } from '../lib/api';

export default function TierBadge({ tier, className = '' }: { tier: TrustTier; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium ${TIER_COLORS[tier]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tier}
    </span>
  );
}
