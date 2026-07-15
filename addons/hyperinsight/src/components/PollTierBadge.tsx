import { Tooltip } from './Tooltip';

// §9.2 asked to replace hardcoded gray wrappers with the injected theme
// vars. This file's grays are deliberately left as fixed values: they're a
// categorical tier legend (hot/active/warm/cold/dormant/unknown), the same
// kind of fixed-palette status-color system as a green/amber/red badge set
// — not page chrome that should track the addon's theme. Swapping only the
// gray entries to theme vars while hot/warm/cold stay fixed green/amber/slate
// would make the legend inconsistent with itself; Tooltip.tsx (an actual
// chrome surface) got the theme-var treatment instead.

interface PollTierBadgeProps {
  tier: string | null;
}

interface TierConfig {
  label: string;
  className: string;
  tooltip: string;
}

const tierMap: Record<string, TierConfig> = {
  hot: {
    label: 'Hot',
    className: 'bg-green-400 text-gray-900',
    tooltip: 'Hot tier — probed every 5 minutes',
  },
  active: {
    label: 'Active',
    className: 'bg-green-600 text-white',
    tooltip: 'Active tier — probed every 15 minutes',
  },
  warm: {
    label: 'Warm',
    className: 'bg-amber-500 text-gray-900',
    tooltip: 'Warm tier — probed every hour',
  },
  cold: {
    label: 'Cold',
    className: 'bg-slate-500 text-white',
    tooltip: 'Cold tier — probed every 4 hours',
  },
  dormant: {
    label: 'Dormant',
    className: 'bg-gray-600 text-gray-300',
    tooltip: 'Dormant — probed every 24 hours (existence check only)',
  },
};

const unknownConfig: TierConfig = {
  label: '—',
  className: 'bg-gray-700 text-gray-400',
  tooltip: '',
};

export function PollTierBadge({ tier }: PollTierBadgeProps) {
  const config = (tier && tierMap[tier]) || unknownConfig;
  const pill = (
    <span
      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${config.className}`}
    >
      {config.label}
    </span>
  );

  if (!config.tooltip) return pill;

  return <Tooltip content={config.tooltip}>{pill}</Tooltip>;
}
