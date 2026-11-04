import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, LayoutGrid, Rocket, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { useRoadmapFeatures } from '../../features/roadMap/hooks/useRoadmap';
import type { RoadmapFeature } from '../../features/roadMap/types/roadmap';
import { CARD, CONTAINER, DISPLAY, MICRO_LABEL, PILL_SECONDARY } from '../../theme/brand';

type Status = RoadmapFeature['status'];
type Filter = 'all' | Status;

const STATUS: Record<Status, { label: string; badge: string; dot: string }> = {
  planned: { label: 'Planlagt', badge: 'bg-[#F2F3EE] text-[#63665F]', dot: 'bg-[#9B9E96]' },
  'in-progress': {
    label: 'Pågår',
    badge: 'bg-[#EAF1E9] text-[#2E6641]',
    dot: 'bg-[#2E6641] animate-pulse',
  },
  completed: { label: 'Lansert', badge: 'bg-[#2E6641] text-white', dot: 'bg-white' },
};

const TAG: Record<RoadmapFeature['tag'], { label: string; Icon: typeof Rocket }> = {
  feature: { label: 'Ny funksjon', Icon: Sparkles },
  improvement: { label: 'Forbedring', Icon: LayoutGrid },
  bugfix: { label: 'Feilretting', Icon: Wrench },
  security: { label: 'Sikkerhet', Icon: ShieldCheck },
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'in-progress', label: 'Pågår' },
  { key: 'planned', label: 'Planlagt' },
  { key: 'completed', label: 'Lansert' },
];

const EMPTY_TEXT: Record<Filter, string> = {
  all: 'Veikartet er tomt akkurat nå. Nye funksjoner dukker opp her så snart vi begynner på dem.',
  'in-progress': 'Ingenting er under arbeid akkurat nå.',
  planned: 'Ingenting er planlagt akkurat nå.',
  completed: 'Ingenting er lansert herfra ennå.',
};

const monthYear = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' }) : null;

const FeatureCard = ({ feature }: { feature: RoadmapFeature }) => {
  const status = STATUS[feature.status] ?? STATUS.planned;
  const tag = TAG[feature.tag] ?? TAG.feature;
  const done = feature.status === 'completed';
  const when = monthYear(feature.releaseDate);
  const progress = Math.min(100, Math.max(0, Math.round(feature.progress ?? 0)));

  return (
    <article className={`${CARD} flex flex-col p-6 sm:p-7`}>
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-semibold ${status.badge}`}
        >
          {done ? (
            <Check size={13} strokeWidth={2.6} aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className={`size-1.5 rounded-full ${status.dot}`} />
          )}
          {status.label}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-semibold text-[#9B9E96]">
          <tag.Icon size={13} strokeWidth={2.2} aria-hidden="true" />
          {tag.label}
        </span>
      </div>

      <h2 className="mt-5 text-[1.1875rem] font-bold leading-snug tracking-[-0.02em] text-[#0B0B0B]">
        {feature.title}
      </h2>
      <p className="mt-2 line-clamp-3 text-[0.9375rem] leading-relaxed text-[#63665F]">
        {feature.description}
      </p>

      <div className="mt-auto pt-6">
        {done ? (
          <p className="text-[0.8125rem] font-semibold text-[#2E6641]">
            {when ? `Lansert ${when}` : 'Lansert'}
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-[0.8125rem] font-semibold">
              <span className="text-[#63665F]">{when ? `Ventet ${when}` : 'Fremdrift'}</span>
              <span className="tabular-nums text-[#0B0B0B]">{progress} %</span>
            </div>
            <div
              role="progressbar"
              aria-label={`${feature.title}: ${progress} % ferdig`}
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF0E9]"
            >
              <div
                className="h-full rounded-full bg-[#2E6641] transition-[width] duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}
      </div>
    </article>
  );
};

const UpcomingFeatures: React.FC = () => {
  const navigate = useNavigate();
  const { data: features = [], isLoading: loading } = useRoadmapFeatures();
  const [filter, setFilter] = useState<Filter>('all');

  const count = (key: Filter) =>
    key === 'all' ? features.length : features.filter((f) => f.status === key).length;
  const filteredFeatures =
    filter === 'all' ? features : features.filter((f) => f.status === filter);

  return (
    <div className="min-h-screen bg-[#EFF0EA]">
      <div className={`${CONTAINER} pb-24 pt-10 sm:pt-16`}>
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className={MICRO_LABEL}>Veikart</p>
            <h1 className={`${DISPLAY} mt-4 text-[#0B0B0B]`}>
              Det vi bygger <span className="text-[#2E6641]">nå.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-[#63665F]">
              Nye funksjoner, forbedringer og sikkerhetsoppdateringer i Jobblo — og hvor langt vi
              har kommet med dem.
            </p>
          </div>

          {/* The three counts at a glance. */}
          {features.length > 0 && (
            <dl className={`${CARD} grid grid-cols-3 divide-x divide-[#E6E7E1] lg:min-w-96`}>
              {(['in-progress', 'planned', 'completed'] as Status[]).map((key) => (
                <div key={key} className="px-5 py-4">
                  <dt className={MICRO_LABEL}>{STATUS[key].label}</dt>
                  <dd className="mt-1 text-[1.75rem] font-bold tabular-nums tracking-[-0.03em] text-[#0B0B0B]">
                    {count(key)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="no-scrollbar -mx-5 mt-10 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTERS.map(({ key, label }) => {
            const on = filter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(key)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[0.875rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/15 ${
                  on
                    ? 'border-[#2E6641] bg-[#2E6641] text-white'
                    : 'border-[#E6E7E1] bg-white text-[#63665F] hover:border-[#2E6641]/45 hover:text-[#2E6641]'
                }`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 text-[0.75rem] tabular-nums ${
                    on ? 'bg-white/20' : 'bg-[#F2F3EE] text-[#9B9E96]'
                  }`}
                >
                  {count(key)}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── List ────────────────────────────────────────────────────────── */}
        <div className="mt-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`${CARD} h-60 animate-pulse bg-white/70`} />
              ))}
            </div>
          ) : filteredFeatures.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredFeatures.map((feature) => (
                <FeatureCard key={feature._id} feature={feature} />
              ))}
            </div>
          ) : (
            <div className={`${CARD} px-6 py-16 text-center sm:py-20`}>
              <span
                aria-hidden="true"
                className="mx-auto flex size-28 items-center justify-center rounded-full bg-[#2E6641]/5"
              >
                <span className="flex size-20 items-center justify-center rounded-full bg-[#2E6641]/10">
                  <span className="flex size-13 items-center justify-center rounded-full bg-white text-[#2E6641] shadow-[0_10px_24px_rgba(11,11,11,0.10)]">
                    <Rocket size={24} strokeWidth={2} />
                  </span>
                </span>
              </span>
              <h2 className="mt-6 text-[1.5rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">
                {filter === 'all' ? 'Mer er på vei' : 'Ingenting her ennå'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-[#63665F]">
                {EMPTY_TEXT[filter]}
              </p>
              {filter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`${PILL_SECONDARY} mt-7`}
                >
                  Vis alle
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className={`${PILL_SECONDARY} mt-7`}
                >
                  Til forsiden
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpcomingFeatures;
