import { LayoutGrid, List } from 'lucide-react';
import type { ListingView } from './listingView';

/** Grid / list switch beside "Nyeste først" (same pill as the SortMenu next to it). */
export function ViewToggle({
  value,
  onChange,
  className = 'flex',
}: {
  value: ListingView;
  onChange: (view: ListingView) => void;
  /** Display classes: where it shows (the page puts it in the bar or under the title). */
  className?: string;
}) {
  const options = [
    { view: 'grid' as const, label: 'Vis som rutenett', Icon: LayoutGrid },
    { view: 'list' as const, label: 'Vis som liste', Icon: List },
  ];
  return (
    <div
      role="group"
      aria-label="Visning"
      className={`${className} h-12 shrink-0 items-center gap-1 rounded-full border border-[#E6E7E1] bg-white p-1`}
    >
      {options.map(({ view, label, Icon }) => (
        <button
          key={view}
          type="button"
          aria-label={label}
          aria-pressed={value === view}
          title={label}
          onClick={() => onChange(view)}
          className={`flex size-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/15 ${
            value === view ? 'bg-[#EAF1E9] text-[#2E6641]' : 'text-[#9B9E96] hover:text-[#0B0B0B]'
          }`}
        >
          <Icon size={17} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
