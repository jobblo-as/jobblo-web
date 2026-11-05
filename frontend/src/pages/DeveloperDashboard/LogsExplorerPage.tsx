import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileJson,
  Filter,
  Layers,
  Radio,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { dateTime, downloadCsv, num } from '@/lib/devFormat';
import { useDevLogs, useUrlFilters } from '../../features/developer/hooks';
import type { LogLevel, LogRow } from '../../api/developer';
import {
  EmptyState,
  ErrorState,
  JsonView,
  Mono,
  PageHeader,
  RangeSelect,
  RefreshButton,
  Section,
} from '../../components/developer/kit';
import { TimeSeriesChart } from '../../components/developer/TimeSeriesChart';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Checkbox } from '../../components/developer/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/developer/ui/popover';

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-muted-foreground bg-muted',
  info: 'text-sky-700 bg-sky-50',
  warn: 'text-amber-700 bg-amber-50',
  error: 'text-red-700 bg-red-50',
  fatal: 'text-white bg-red-600',
};
const ALL_SERVICES = ['api', 'audit', 'auth', 'scheduler', 'webhook', 'subscription', 'delivery'];
const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
const ENTITY_FILTERS = [
  { key: 'traceId', label: 'Trace / request ID' },
  { key: 'userId', label: 'User ID' },
  { key: 'orderId', label: 'Job (order) ID' },
  { key: 'paymentId', label: 'Payment ID (pi_…)' },
] as const;
type EntityKey = (typeof ENTITY_FILTERS)[number]['key'];

/** One click to the views people open most. */
const PRESETS: { label: string; set: Record<string, string> }[] = [
  { label: 'Errors', set: { levels: 'error,fatal', services: '' } },
  { label: 'Auth', set: { services: 'auth', levels: '' } },
  { label: 'Payments', set: { services: 'webhook,subscription', levels: '' } },
  { label: 'Scheduler', set: { services: 'scheduler', levels: '' } },
  { label: 'Deliveries', set: { services: 'delivery', levels: '' } },
];
const CLEARED = {
  q: '',
  services: '',
  levels: '',
  traceId: '',
  userId: '',
  orderId: '',
  paymentId: '',
  from: '',
  to: '',
};
const CONTEXT_MS = 2 * 60_000;
const FRESH_MS = 4000;

/** Same message with other ids / numbers in it: "Order 64f… failed (3)" → "Order # failed (#)". */
const shapeOf = (r: LogRow) =>
  `${r.level}|${r.service}|${r.message.replace(/[0-9a-f]{12,}|\d+/gi, '#')}`;

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          p
        )
      )}
    </>
  );
}

function MultiToggle({
  label,
  all,
  value,
  onChange,
}: {
  label: string;
  all: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="bg-card">
          <Filter /> {label}
          {value.length > 0 && (
            <span className="rounded-sm bg-primary/10 px-1 text-[10px] text-primary">
              {value.length}
            </span>
          )}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-2">
        <div className="space-y-1">
          {all.map((item) => (
            <Label
              key={item}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-normal capitalize hover:bg-muted"
            >
              <Checkbox
                checked={value.includes(item)}
                onCheckedChange={(c) =>
                  onChange(c ? [...value, item] : value.filter((v) => v !== item))
                }
              />
              {item}
            </Label>
          ))}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Action({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-sm border bg-card px-1.5 py-0.5 font-mono text-primary hover:bg-accent"
    >
      {children}
    </button>
  );
}

function LogLine({
  row,
  open,
  q,
  fresh,
  count,
  onToggle,
  onFilter,
  onContext,
}: {
  row: LogRow;
  open: boolean;
  q: string;
  fresh: boolean;
  /** Grouped view: how many events share this one's shape. */
  count?: number;
  onToggle: () => void;
  onFilter: (key: EntityKey | 'q', value: string) => void;
  onContext: (at: string) => void;
}) {
  const ip = typeof row.data?.ip === 'string' ? row.data.ip : null;
  const orderId = typeof row.data?.orderId === 'string' ? row.data.orderId : null;
  const copy = () =>
    navigator.clipboard
      ?.writeText(JSON.stringify(row, null, 2))
      .then(() => toast.success('Event copied as JSON'))
      .catch(() => toast.error('Could not copy'));
  return (
    <li
      className={cn(
        'border-b transition-colors duration-1000 last:border-b-0',
        open && 'bg-muted/30',
        fresh && 'bg-emerald-50'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[1rem_10.5rem_3.5rem_6rem_1fr_auto] items-start gap-3 px-3 py-1.5 text-left font-mono text-xs hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground" />
        )}
        <span className="whitespace-nowrap text-muted-foreground">{dateTime(row.at)}</span>
        <span
          className={cn(
            'rounded-sm px-1 text-center text-[10px] font-semibold uppercase',
            LEVEL_STYLE[row.level]
          )}
        >
          {row.level}
        </span>
        <span className="truncate text-muted-foreground">{row.service}</span>
        <span className={cn('truncate text-foreground', open && 'whitespace-normal break-all')}>
          <Highlight text={row.message} q={q} />
        </span>
        {count && count > 1 ? (
          <span className="rounded-sm bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            ×{num(count)}
          </span>
        ) : (
          <span />
        )}
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-10">
          <div className="flex flex-wrap gap-2 text-xs">
            {row.traceId && (
              <Action
                onClick={() => onFilter('traceId', row.traceId!)}
                title="Show correlated events"
              >
                trace {row.traceId}
              </Action>
            )}
            {row.userId && (
              <Action
                onClick={() => onFilter('userId', row.userId!)}
                title="Only this user's events"
              >
                user {row.userId}
              </Action>
            )}
            {orderId && (
              <Action onClick={() => onFilter('orderId', orderId)} title="Only this job's events">
                job {orderId}
              </Action>
            )}
            {ip && (
              <>
                <Action onClick={() => onFilter('q', ip)} title="Search this IP">
                  ip {ip}
                </Action>
                <Link
                  to={`/developer/ips/${encodeURIComponent(ip)}`}
                  className="inline-flex items-center rounded-sm border bg-card px-1.5 py-0.5 font-mono text-primary hover:bg-accent"
                >
                  IP page →
                </Link>
              </>
            )}
            <Action onClick={() => onContext(row.at)} title="Everything ±2 minutes around this">
              <Clock className="size-3" /> ±2 min context
            </Action>
            <Action onClick={copy} title="Copy the event">
              <Copy className="size-3" /> copy JSON
            </Action>
            <Mono>{row.id}</Mono>
          </div>
          <JsonView value={row.data} />
        </div>
      )}
    </li>
  );
}

export default function LogsExplorerPage() {
  const [f, setF] = useUrlFilters({
    range: '24h',
    q: '',
    services: '',
    levels: '',
    traceId: '',
    userId: '',
    orderId: '',
    paymentId: '',
    from: '',
    to: '',
  });
  const [search, setSearch] = useState(f.q);
  useEffect(() => setSearch(f.q), [f.q]);
  const [before, setBefore] = useState<string | undefined>();
  const [pages, setPages] = useState<LogRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const services = f.services ? f.services.split(',') : [];
  const levels = f.levels ? f.levels.split(',') : [];
  const query = {
    range: f.range as '24h',
    from: f.from || undefined,
    to: f.to || undefined,
    q: f.q || undefined,
    services: f.services || undefined,
    levels: f.levels || undefined,
    traceId: f.traceId || undefined,
    userId: f.userId || undefined,
    orderId: f.orderId || undefined,
    paymentId: f.paymentId || undefined,
    limit: 150,
    before: live ? undefined : before,
  };
  const { data, isLoading, isFetching, error, refetch } = useDevLogs(query, { live });

  // "Load older" appends; any filter change starts over.
  const filterKey = JSON.stringify({ ...query, before: undefined });
  useEffect(() => {
    setBefore(undefined);
    setPages([]);
    seen.current = new Set();
  }, [filterKey]);
  useEffect(() => {
    if (!data) return;
    const logs = data.logs ?? [];
    // Live tail: rows not seen before flash for a moment.
    if (live && seen.current.size) {
      const added = logs.filter((l) => !seen.current.has(l.id)).map((l) => l.id);
      if (added.length) {
        setFresh(new Set(added));
        setTimeout(() => setFresh(new Set()), FRESH_MS);
      }
    }
    logs.forEach((l) => seen.current.add(l.id));
    setPages((prev) =>
      before && !live ? [...prev.filter((p) => !logs.some((l) => l.id === p.id)), ...logs] : logs
    );
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" focuses the search, Esc closes the open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName || '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const levelCounts = useMemo(() => {
    const c: Record<string, number> = {};
    pages.forEach((p) => (c[p.level] = (c[p.level] || 0) + 1));
    return c;
  }, [pages]);
  const serviceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    pages.forEach((p) => (c[p.service] = (c[p.service] || 0) + 1));
    return c;
  }, [pages]);

  // The loaded events over time, ~30 bars, by severity.
  const histogram = useMemo(() => {
    if (pages.length < 2) return { data: [], bucketMs: 60_000 };
    const times = pages.map((p) => new Date(p.at).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const bucketMs = Math.max(60_000, Math.ceil((max - min) / 30 / 60_000) * 60_000);
    const buckets = new Map<
      number,
      { t: string; errors: number; warnings: number; info: number }
    >();
    pages.forEach((p, i) => {
      const t = Math.floor(times[i] / bucketMs) * bucketMs;
      const b = buckets.get(t) || { t: new Date(t).toISOString(), errors: 0, warnings: 0, info: 0 };
      if (p.level === 'error' || p.level === 'fatal') b.errors += 1;
      else if (p.level === 'warn') b.warnings += 1;
      else b.info += 1;
      buckets.set(t, b);
    });
    return { data: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), bucketMs };
  }, [pages]);

  // Grouped view: one row per message shape, newest first, with its count.
  const groups = useMemo(() => {
    const m = new Map<string, { row: LogRow; count: number }>();
    pages.forEach((p) => {
      const k = shapeOf(p);
      const g = m.get(k);
      if (g) g.count += 1;
      else m.set(k, { row: p, count: 1 });
    });
    return [...m.values()];
  }, [pages]);

  const activeEntities = ENTITY_FILTERS.filter((e) => f[e.key]);
  const toggleList = (key: 'levels' | 'services', list: string[], item: string) =>
    setF({
      [key]: (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]).join(','),
    });
  const filterBy = (key: EntityKey | 'q', value: string) => setF({ [key]: value });
  const contextAt = (at: string) => {
    const t = new Date(at).getTime();
    setF({
      ...CLEARED,
      from: new Date(t - CONTEXT_MS).toISOString(),
      to: new Date(t + CONTEXT_MS).toISOString(),
    });
  };

  const download = (kind: 'csv' | 'json') => {
    if (kind === 'csv')
      return downloadCsv(
        `logs-${f.range}.csv`,
        pages.map((l) => ({
          at: l.at,
          level: l.level,
          service: l.service,
          message: l.message,
          traceId: l.traceId,
          userId: l.userId,
          data: l.data,
        }))
      );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pages, null, 2)], { type: 'application/json' })
    );
    Object.assign(document.createElement('a'), {
      href: url,
      download: `logs-${f.range}.json`,
    }).click();
    URL.revokeObjectURL(url);
  };

  const anyFilter = f.q || f.services || f.levels || f.from || activeEntities.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs Explorer"
        description="One searchable, redacted stream over API errors, audit, auth, scheduler, webhook, subscription and delivery logs."
        actions={
          <>
            <RangeSelect value={f.range} onChange={(range) => setF({ range, from: '', to: '' })} />
            <Button
              variant={live ? 'default' : 'outline'}
              size="sm"
              className={cn(!live && 'bg-card')}
              aria-pressed={live}
              onClick={() => setLive((v) => !v)}
              title="Fetch new events every 5 seconds"
            >
              <Radio className={cn(live && 'animate-pulse')} /> {live ? 'Live' : 'Live tail'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              disabled={!pages.length}
              onClick={() => download('csv')}
            >
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              disabled={!pages.length}
              onClick={() => download('json')}
            >
              <FileJson /> JSON
            </Button>
            <RefreshButton onClick={() => refetch()} spinning={isFetching} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-64 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setF({ q: search.trim() });
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages, codes, routes, IPs…  (press / )"
            className="bg-card pl-8"
            aria-label="Search logs"
          />
        </form>
        <MultiToggle
          label="Service"
          all={ALL_SERVICES}
          value={services}
          onChange={(v) => setF({ services: v.join(',') })}
        />
        <MultiToggle
          label="Level"
          all={ALL_LEVELS}
          value={levels}
          onChange={(v) => setF({ levels: v.join(',') })}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="bg-card">
              <Filter /> IDs{' '}
              {activeEntities.length > 0 && (
                <span className="rounded-sm bg-primary/10 px-1 text-[10px] text-primary">
                  {activeEntities.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                setF(
                  Object.fromEntries(
                    ENTITY_FILTERS.map((x) => [x.key, String(fd.get(x.key) || '').trim()])
                  )
                );
              }}
            >
              {ENTITY_FILTERS.map((x) => (
                <div key={x.key} className="space-y-1">
                  <Label htmlFor={`f-${x.key}`} className="text-xs text-muted-foreground">
                    {x.label}
                  </Label>
                  <Input
                    id={`f-${x.key}`}
                    name={x.key}
                    defaultValue={f[x.key]}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              ))}
              <Button type="submit" size="sm" className="w-full">
                Apply
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      {/* Presets, and the active filters as removable chips. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Quick:</span>
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant="outline"
            size="sm"
            className="h-7 bg-card text-xs"
            onClick={() => setF(p.set)}
          >
            {p.label}
          </Button>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setF(CLEARED)}>
            <X /> Clear all
          </Button>
        )}
        {f.from && f.to && (
          <span className="inline-flex items-center gap-1 rounded-sm border bg-card px-2 py-0.5">
            <Clock className="size-3" /> {dateTime(f.from)} – {dateTime(f.to)}
            <button
              type="button"
              onClick={() => setF({ from: '', to: '' })}
              aria-label="Clear time window"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        {activeEntities.map((e) => (
          <span
            key={e.key}
            className="inline-flex items-center gap-1 rounded-sm border bg-card px-2 py-0.5"
          >
            {e.label}: <span className="font-mono">{f[e.key]}</span>
            <button
              type="button"
              onClick={() => setF({ [e.key]: '' })}
              aria-label={`Clear ${e.label}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {pages.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Loaded events over time" className="lg:col-span-2">
            <TimeSeriesChart
              data={histogram.data}
              bucketMs={histogram.bucketMs}
              height={150}
              variant="bar"
              series={[
                { key: 'errors', label: 'Errors', color: 'var(--chart-5)' },
                { key: 'warnings', label: 'Warnings', color: 'var(--chart-4)' },
                { key: 'info', label: 'Info / debug', color: 'var(--chart-1)' },
              ]}
            />
          </Section>
          <Section title="Breakdown" description="Click to filter">
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {ALL_LEVELS.filter((l) => levelCounts[l]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={levels.includes(l)}
                    onClick={() => toggleList('levels', levels, l)}
                    className={cn(
                      'rounded-sm px-1.5 py-0.5 font-semibold uppercase',
                      LEVEL_STYLE[l],
                      levels.includes(l) && 'ring-2 ring-primary'
                    )}
                  >
                    {l} {num(levelCounts[l])}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(serviceCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([s, n]) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={services.includes(s)}
                      onClick={() => toggleList('services', services, s)}
                      className={cn(
                        'rounded-sm border bg-card px-1.5 py-0.5 font-mono',
                        services.includes(s) && 'ring-2 ring-primary'
                      )}
                    >
                      {s} {num(n)}
                    </button>
                  ))}
              </div>
            </div>
          </Section>
        </div>
      )}

      <Section
        title={f.traceId ? `Correlated timeline for ${f.traceId}` : 'Events'}
        description={`${pages.length} loaded${grouped ? ` · ${groups.length} distinct` : ''} · newest first · secrets and personal data are redacted`}
        action={
          <Button
            variant={grouped ? 'secondary' : 'outline'}
            size="sm"
            className={cn('h-7 text-xs', !grouped && 'bg-card')}
            aria-pressed={grouped}
            onClick={() => setGrouped((v) => !v)}
          >
            <Layers /> Group similar
          </Button>
        }
        contentClassName="px-0"
      >
        {isLoading && !pages.length ? (
          <div className="space-y-1 px-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : pages.length ? (
          <>
            <ul className="border-y">
              {(grouped ? groups : pages.map((row) => ({ row, count: 1 }))).map(
                ({ row, count }) => (
                  <LogLine
                    key={row.id}
                    row={row}
                    count={grouped ? count : undefined}
                    q={f.q}
                    fresh={fresh.has(row.id)}
                    open={open === row.id}
                    onToggle={() => setOpen(open === row.id ? null : row.id)}
                    onFilter={filterBy}
                    onContext={contextAt}
                  />
                )
              )}
            </ul>
            <div className="flex items-center justify-between px-4 pt-3 text-xs text-muted-foreground">
              <span>Not collected: {data?.unavailable?.join(', ')}</span>
              {data?.nextBefore && !live && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => setBefore(data.nextBefore!)}
                >
                  Load older
                </Button>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title="No log events match"
            description="Widen the time range or clear filters."
          />
        )}
      </Section>
    </div>
  );
}
