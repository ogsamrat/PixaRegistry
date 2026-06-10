import { Link } from 'react-router-dom';
import type { AgentResultCard } from '../lib/api';
import { shortNetwork } from '../lib/api';
import TierBadge from './TierBadge';

export default function ServiceCard({ card, index = 0 }: { card: AgentResultCard; index?: number }) {
  return (
    <Link
      to={`/service/${encodeURIComponent(card.serviceId)}`}
      className="rise group flex flex-col rounded-xl border border-edge bg-panel p-5 transition-colors hover:border-edge-2 hover:bg-panel-2"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-snow transition-colors group-hover:text-accent">{card.name}</h3>
        <TierBadge tier={card.trustTier} />
      </div>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-fog">{card.shortDescription}</p>
      <p className="mt-3 truncate font-mono text-xs text-fog/70">
        <span className="mr-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-accent">{card.method}</span>
        {card.resourceUrl}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {card.priceDisplay && (
          <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent">
            {card.priceDisplay}
          </span>
        )}
        {card.paymentNetworks.slice(0, 2).map((n) => (
          <span key={n} className="rounded-md border border-edge bg-panel-2 px-2 py-0.5 font-mono text-xs text-fog">
            {shortNetwork(n)}
          </span>
        ))}
        {card.labels.slice(0, 2).map((l) => (
          <span key={l} className="rounded-md border border-tier-verified/30 bg-tier-verified/10 px-2 py-0.5 text-xs text-tier-verified">
            {l}
          </span>
        ))}
      </div>
    </Link>
  );
}
