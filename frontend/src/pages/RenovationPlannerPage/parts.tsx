import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  Hammer,
  Package,
  TriangleAlert,
  X,
} from 'lucide-react';
import { CARD, CHIP, MICRO_LABEL } from '../../theme/brand';
import type {
  AreaKey,
  Catalogue,
  Estimate,
  HomeFacts,
} from '../../features/renovation/renovationAPI';
import { FIELD_LABEL, INPUT, kr, range, weeks, type AreaChoice, type PhotoItem } from './styles';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/Ui/select';

/** Pieces shared by the planner page and the read-only shared-plan page. */

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} p-5 sm:p-7`} aria-labelledby={`step-${n}`}>
      <p className={MICRO_LABEL}>Steg {n}</p>
      <h2
        id={`step-${n}`}
        className="mt-1.5 text-[1.25rem] font-semibold tracking-[-0.02em] text-[#0B0B0B]"
      >
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <span className="relative mt-1.5 block">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d\s.,]/g, ''))}
          className={`${INPUT} ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[0.8125rem] text-[#9B9E96]">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

// Radix refuses an empty item value; '' (no choice) travels as this instead.
const NONE = '__none';

/**
 * The site's dropdown (shadcn Select, as on Mine annonser and the applicants page), with
 * '' allowed as a value for 'no choice' (Velg boligtype, Kvalitet som resten, Hele boligen).
 */
export function PlannerSelect({
  value,
  onChange,
  options,
  emptyLabel,
  ariaLabel,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  emptyLabel: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? '' : next)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={`h-11 rounded-full border-[#E6E7E1] bg-white px-4 text-[0.875rem] font-medium text-[#0B0B0B] focus:ring-[#2E6641]/20 ${className}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-2xl">
        <SelectItem value={NONE}>{emptyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One listing photo: thumbnail, which area's job it goes on, remove. */
const ROUND_BUTTON =
  'flex size-8 items-center justify-center rounded-full text-[#63665F] transition-colors hover:bg-[#F4F6F0] hover:text-[#0B0B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/30 disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * One listing photo as a tile, the same tile as the job form's photos (ImageUpload): the
 * photo with a remove button, left/right to order it, and under it which room's job it goes
 * on. The first one leads that job's photos.
 */
export function PhotoTile({
  photo,
  index,
  count,
  areas,
  onArea,
  onRemove,
  onMove,
}: {
  photo: PhotoItem;
  index: number;
  count: number;
  areas: Catalogue['areas'];
  onArea: (area: PhotoItem['area']) => void;
  onRemove: () => void;
  onMove: (step: -1 | 1) => void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(photo.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo.file]);
  const n = index + 1;

  return (
    <li className="w-36 shrink-0">
      <div className="relative size-36 overflow-hidden rounded-xl border border-[#E6E7E1] bg-white">
        {preview && <img src={preview} alt={`Bilde ${n}`} className="size-full object-cover" />}
        <button
          type="button"
          aria-label={`Fjern ${photo.file.name}`}
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-white/95 text-[#0B0B0B] shadow-sm transition-colors hover:bg-[#FCF4F3] hover:text-[#B0453B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/30"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Flytt bilde ${n} til venstre`}
          className={ROUND_BUTTON}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          aria-label={`Flytt bilde ${n} til høyre`}
          className={ROUND_BUTTON}
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <PlannerSelect
        ariaLabel={`Rom for ${photo.file.name}`}
        value={photo.area}
        onChange={(value) => onArea(value as PhotoItem['area'])}
        emptyLabel="Hele boligen"
        options={areas.map((area) => ({ value: area.key, label: area.label }))}
        className="mt-1 h-9 w-full px-3 text-[0.8125rem]"
      />
    </li>
  );
}

export function NotesList({ notes }: { notes: HomeFacts['standardNotes'] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-4 space-y-1.5 rounded-2xl bg-[#F6F7F2] p-4 text-[0.875rem] text-[#3F423C]">
      {notes.map((note, i) => (
        <li key={i} className="flex gap-2">
          <FileText size={15} className="mt-0.5 shrink-0 text-[#9B9E96]" />
          {note.text}
        </li>
      ))}
    </ul>
  );
}

const BUDGET_TONE = {
  within: { box: 'bg-[#E3F4E6] text-[#14532D]', Icon: CircleCheck },
  borderline: { box: 'bg-[#FDF1D6] text-[#7A4B0A]', Icon: TriangleAlert },
  over: { box: 'bg-[#FDE4DF] text-[#8A1C12]', Icon: CircleAlert },
} as const;

/**
 * The budget against the estimate: a status line in the status's colour, and a bar where the
 * estimate is a band (low to high) and the budget a marker, on one scale.
 */
function BudgetMeter({
  budget,
  total,
  text,
}: {
  budget: NonNullable<Estimate['budget']>;
  total: Estimate['total'];
  text: string;
}) {
  const { box, Icon } = BUDGET_TONE[budget.status];
  const max = Math.max(total.high, budget.amount) * 1.1 || 1;
  const pct = (value: number) => `${Math.min(100, (value / max) * 100)}%`;

  return (
    <div className="relative mt-5 rounded-2xl bg-white p-4 sm:p-5">
      <p
        className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[0.875rem] font-semibold ${box}`}
      >
        <Icon size={18} className="mt-px shrink-0" aria-hidden="true" />
        {text}
      </p>
      <div className="mt-5" aria-hidden="true">
        <div className="relative h-2.5 rounded-full bg-[#EDEEE8]">
          <div
            className="absolute inset-y-0 rounded-full bg-[#2E6641]/70"
            style={{ left: pct(total.low), width: `calc(${pct(total.high)} - ${pct(total.low)})` }}
          />
          <div
            className="absolute -inset-y-1.5 w-0.5 rounded-full bg-[#0B0B0B]"
            style={{ left: pct(budget.amount) }}
          />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[0.75rem] text-[#63665F]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-[#2E6641]/70" /> Estimat
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-[#0B0B0B]" /> Budsjett {kr(budget.amount)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The estimate: total, budget, savings, one card per area and the disclaimer. `onApply` is
 * left out on the shared page (a visitor cannot change someone else's plan); `children` is
 * the action area under it (save, share, post as jobs).
 */
export function EstimateView({
  estimate,
  onApply,
  children,
}: {
  estimate: Estimate;
  onApply?: (key: AreaKey, change: Partial<AreaChoice>) => void;
  children?: ReactNode;
}) {
  const { total, budget } = estimate;
  const budgetText =
    budget &&
    {
      within: `Innenfor budsjettet på ${kr(budget.amount)}.`,
      borderline: `Budsjettet på ${kr(budget.amount)} kan holde, men det blir stramt.`,
      over: `Over budsjettet på ${kr(budget.amount)} med ca. ${kr(budget.overBy)}.`,
    }[budget.status];

  const areaCount = estimate.areas.length;
  const stats = [
    { label: 'Arbeid', value: range(total.labour.low, total.labour.high), Icon: Hammer },
    { label: 'Materialer', value: range(total.materials.low, total.materials.high), Icon: Package },
    { label: 'Tid', value: weeks(total.weeks), Icon: Clock },
  ];

  return (
    <section id="estimate" className="mt-10 scroll-mt-24" aria-labelledby="estimate-heading">
      <div className="relative overflow-hidden rounded-3xl bg-[#2E6641] p-6 text-white sm:p-8">
        {/* One soft light in the corner, as on the landing hero. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.14),rgba(255,255,255,0)_70%)]"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-white/65">
            Estimat
          </p>
          <span className="rounded-full bg-white/12 px-3 py-1 text-[0.75rem] font-medium text-white/85">
            {areaCount} {areaCount === 1 ? 'område' : 'områder'} · inkl. mva.
          </span>
        </div>
        <h2
          id="estimate-heading"
          className="relative mt-3 text-[clamp(1.625rem,4.5vw,2.25rem)] font-bold leading-tight tracking-[-0.02em] tabular-nums"
        >
          {/* Spaced dash: "90 000 – 120 000 kr" reads as two amounts, not one long number. */}
          {total.low === total.high
            ? kr(total.low)
            : `${total.low.toLocaleString('nb-NO')} – ${kr(total.high)}`}
        </h2>

        <dl className="relative mt-6 grid gap-px overflow-hidden rounded-2xl bg-white/15 sm:grid-cols-3">
          {stats.map(({ label, value, Icon }) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 bg-[#2E6641] p-4 sm:block sm:bg-[#2A5E3C]"
            >
              <dt className="flex items-center gap-1.5 text-[0.75rem] font-medium text-white/65">
                <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                {label}
              </dt>
              <dd className="text-[0.9375rem] font-semibold tabular-nums sm:mt-1.5">{value}</dd>
            </div>
          ))}
        </dl>

        {budget && budgetText && <BudgetMeter budget={budget} total={total} text={budgetText} />}
      </div>

      {budget && budget.suggestions.length > 0 && (
        <div className={`${CARD} mt-4 p-5 sm:p-6`}>
          <h3 className="font-semibold text-[#0B0B0B]">Slik kan du spare</h3>
          <ul className="mt-3 space-y-2">
            {budget.suggestions.map((s) => (
              <li
                key={`${s.key}-${s.change.scope ?? s.change.quality}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-[0.875rem] text-[#3F423C]">{s.text}</span>
                {onApply && (
                  <button type="button" className={CHIP} onClick={() => onApply(s.key, s.change)}>
                    Bruk
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {estimate.areas.map((line) => (
          <li key={line.key} className={`${CARD} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[1.0625rem] font-semibold text-[#0B0B0B]">
                {line.label}{' '}
                <span className="font-normal text-[#63665F]">
                  · {line.scope === 'full' ? 'Total' : 'Overflate'}
                  {line.unit ? ` · ${line.quantity} ${line.unit}` : ''}
                </span>
              </h3>
              <span className="font-bold tabular-nums text-[#0B0B0B]">
                {range(line.low, line.high)}
              </span>
            </div>
            <p className="mt-1.5 text-[0.8125rem] text-[#63665F]">
              Arbeid {range(line.labour.low, line.labour.high)} · Materialer{' '}
              {range(line.materials.low, line.materials.high)}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem]">
              <span className="inline-flex items-center gap-1.5 text-[#63665F]">
                <Clock size={14} /> {weeks(line.weeks)}
              </span>
              {line.certified.length > 0 && (
                <span className="inline-flex items-center gap-1.5 font-medium text-[#9A6213]">
                  <BadgeCheck size={14} /> Krever sertifisert fagperson: {line.certified.join(', ')}
                </span>
              )}
              {line.quote && (
                <span className="font-medium text-[#2E6641]">Legges ut som anbud</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[0.8125rem] italic text-[#63665F]">{estimate.disclaimer}</p>
      {children}
    </section>
  );
}
