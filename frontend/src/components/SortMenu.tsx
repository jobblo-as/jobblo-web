import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check } from 'lucide-react';
import { CARD } from '../theme/brand';

export type SortOption = { label: string; value: string };

/**
 * The search page's sort button and menu, shared with the home page: one look for "Sorter"
 * everywhere. Closes on a pick, a click outside or Escape.
 */
export function SortMenu({
  options,
  value,
  onChange,
}: {
  options: readonly SortOption[];
  value: string;
  onChange: (option: SortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sorter: ${current?.label ?? ''}`}
        className="flex h-12 items-center gap-2 rounded-full border border-[#E6E7E1] bg-white px-4 text-[0.875rem] font-semibold text-[#0B0B0B] transition-colors hover:border-[#2E6641]/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/15"
      >
        <ArrowUpDown size={16} strokeWidth={2} className="text-[#2E6641]" />
        <span className="hidden md:inline">{current?.label}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Sorter"
          className={`${CARD} absolute right-0 z-100 mt-2 w-60 overflow-hidden p-1.5 shadow-[0_18px_48px_rgba(11,11,11,0.12)]`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-[0.875rem] transition-colors ${
                value === option.value
                  ? 'bg-[#EAF1E9] font-semibold text-[#2E6641]'
                  : 'text-[#0B0B0B] hover:bg-[#F4F6F0]'
              }`}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={15} strokeWidth={2.6} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
