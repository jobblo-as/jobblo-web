import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Briefcase,
  CheckCircle2,
  Circle,
  Flag,
  Heart,
  MapPin,
  Megaphone,
  Pencil,
  PlayCircle,
  Send,
  Star,
  UserCheck,
  Wallet,
  XCircle,
  Zap,
} from 'lucide-react';
import { dateTime } from '@/lib/devFormat';
import {
  fetchServiceActivity,
  type ActivityPerson,
  type ServiceActivity,
} from '../../api/admin/details';
import { EmptyState, ErrorState, Section, StatusBadge } from '../../components/developer/kit';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { cn } from '@/lib/utils';

/** Admin → Tjenester → one job: who applied, who got it, when it was paid and paid out. */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUS: Record<string, [string, Tone]> = {
  pending: ['Venter', 'warning'],
  accepted: ['Akseptert', 'success'],
  declined: ['Avslått', 'neutral'],
  withdrawn: ['Trukket', 'neutral'],
  in_progress: ['Pågår', 'info'],
  completed: ['Fullført', 'success'],
  cancelled: ['Kansellert', 'danger'],
  awaiting_payment: ['Venter på betaling', 'warning'],
  paid: ['Betalt', 'success'],
  ready_for_review: ['Til godkjenning', 'info'],
  disputed: ['Tvist', 'danger'],
  unpaid: ['Ikke betalt', 'warning'],
  partially_refunded: ['Delvis refundert', 'warning'],
  refunded: ['Refundert', 'neutral'],
  open: ['Åpen', 'success'],
  closed: ['Lukket', 'neutral'],
  consumed: ['Brukt', 'success'],
  expired: ['Utløpt', 'neutral'],
  transferred: ['Utbetalt', 'success'],
  released_internal: ['Frigitt', 'info'],
  processing: ['Behandles', 'info'],
  failed: ['Feilet', 'danger'],
  resolved: ['Løst', 'success'],
};
const Status = ({ s }: { s?: string | null }) => {
  const [label, tone] = (s && STATUS[s]) || [s || '—', 'neutral' as Tone];
  return <StatusBadge status={s} label={label} tone={tone} />;
};

const kr = (v?: number | null) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : `${Math.round(v).toLocaleString('nb-NO')} kr`;
const fullName = (p: ActivityPerson) =>
  p ? [p.name, p.lastName].filter(Boolean).join(' ') || p.email || 'Ukjent' : 'Slettet bruker';
const initials = (p: ActivityPerson) =>
  fullName(p)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function Person({ p, sub }: { p: ActivityPerson; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar>
        <AvatarImage src={p?.avatarUrl} alt="" />
        <AvatarFallback>{initials(p)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        {p ? (
          <Link
            to={`/dashboard/users/${p._id}`}
            className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
          >
            {fullName(p)}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Slettet bruker</span>
        )}
        <p className="truncate text-xs text-muted-foreground">{sub ?? p?.email}</p>
      </div>
    </div>
  );
}

/** Lagt ut → forespørsler → tildelt → betalt → fullført → utbetalt, with the date of each. */
function Journey({ data }: { data: ServiceActivity }) {
  const first = (dates: (string | undefined | null)[]) =>
    dates.filter(Boolean).sort()[0] as string | undefined;
  const steps: { label: string; at?: string; icon: ReactNode }[] = [
    { label: 'Lagt ut', at: data.service.createdAt, icon: <Megaphone /> },
    {
      label: 'Forespørsel',
      at: first(data.requests.map((r) => r.createdAt)),
      icon: <Send />,
    },
    { label: 'Tildelt', at: first(data.orders.map((o) => o.createdAt)), icon: <UserCheck /> },
    {
      label: 'Betalt',
      at: first(data.orders.map((o) => o.paymentConfirmedAt)),
      icon: <Banknote />,
    },
    {
      label: 'Fullført',
      at: first(data.orders.map((o) => o.completedAt)),
      icon: <CheckCircle2 />,
    },
    {
      label: 'Utbetalt',
      at: first(data.payouts.map((p) => p.transferCompletedAt)),
      icon: <Wallet />,
    },
  ];
  const reached = steps.reduce((n, s, i) => (s.at ? i : n), 0);
  return (
    <ol className="grid grid-cols-3 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-6">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center text-center">
          {i > 0 && (
            <span
              className={cn(
                'absolute top-4 right-1/2 hidden h-0.5 w-full -translate-x-4 sm:block',
                i <= reached ? 'bg-emerald-500' : 'bg-border'
              )}
            />
          )}
          <span
            className={cn(
              'relative z-10 flex size-8 items-center justify-center rounded-full border-2 [&_svg]:size-4',
              s.at
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-border bg-card text-muted-foreground'
            )}
          >
            {s.icon}
          </span>
          <span className={cn('mt-2 text-xs font-medium', !s.at && 'text-muted-foreground')}>
            {s.label}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {s.at ? dateTime(s.at) : 'Ikke ennå'}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg leading-tight font-semibold tabular-nums">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

const TIMELINE_ICON: Record<string, [ReactNode, string]> = {
  created: [<Megaphone key="i" />, 'bg-sky-500'],
  request: [<Send key="i" />, 'bg-indigo-500'],
  withdrawn: [<XCircle key="i" />, 'bg-zinc-400'],
  order: [<UserCheck key="i" />, 'bg-violet-500'],
  paid: [<Banknote key="i" />, 'bg-emerald-500'],
  started: [<PlayCircle key="i" />, 'bg-sky-500'],
  review: [<Circle key="i" />, 'bg-amber-500'],
  completed: [<CheckCircle2 key="i" />, 'bg-emerald-600'],
  payout: [<Wallet key="i" />, 'bg-emerald-700'],
  urgent: [<Zap key="i" />, 'bg-amber-500'],
  extra_contact: [<Send key="i" />, 'bg-amber-500'],
  dispute: [<AlertTriangle key="i" />, 'bg-red-500'],
  review_given: [<Star key="i" />, 'bg-yellow-500'],
  report: [<Flag key="i" />, 'bg-red-500'],
};

export default function ServiceDetailPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'service-activity', id],
    queryFn: () => fetchServiceActivity(id),
    enabled: Boolean(id),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );

  const { service: s, stats } = data;
  const payoutFor = (orderId: string) => data.payouts.find((p) => p.orderId === orderId);
  const urgentBought = data.urgent.some((u) => u.paidAt);
  const purchases = [
    ...data.urgent.map((u) => ({
      id: u._id,
      what: 'Hast',
      who: s.userId,
      status: u.status,
      amount: u.amountMinor / 100,
      at: u.paidAt,
    })),
    ...data.extraContacts.map((x) => ({
      id: x._id,
      what: 'Ekstra kontakt',
      who: x.userId,
      status: x.status,
      amount: x.amountMinor / 100,
      at: x.paidAt,
    })),
  ];
  const paidTotal = data.orders
    .filter((o) => o.paymentConfirmedAt || o.paymentStatus === 'paid')
    .reduce((n, o) => n + (o.agreedPrice ?? o.price ?? 0), 0);
  const fees = data.payouts.reduce((n, p) => n + (p.platformFee || 0), 0);
  const paidOut = data.payouts
    .filter((p) => p.status === 'transferred')
    .reduce((n, p) => n + (p.netProviderAmount || 0), 0);
  const priceText =
    s.paymentType === 'Timepris' && s.hourlyRate ? `${kr(s.hourlyRate)} / t` : kr(s.price);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/services">
            <ArrowLeft /> Tjenester
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="bg-card" asChild>
          <Link to={`/dashboard/services/${s._id}/edit`}>
            <Pencil /> Rediger
          </Link>
        </Button>
      </div>

      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        {s.images?.[0] ? (
          <img
            src={s.images[0]}
            alt=""
            className="size-24 shrink-0 rounded-lg border object-cover"
          />
        ) : (
          <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Briefcase className="size-7" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{s.title}</h1>
            <Status s={s.status} />
            {s.urgent || urgentBought ? (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <Zap /> Hast
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.categories?.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
            {s.paymentType ? <Badge variant="secondary">{s.paymentType}</Badge> : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {[s.location?.address, s.location?.city].filter(Boolean).join(', ') || 'Ukjent sted'}
            </span>
            <span>Lagt ut {dateTime(s.createdAt)}</span>
            {s.updatedAt ? <span>Endret {dateTime(s.updatedAt)}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t pt-3 sm:items-end sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
          <div className="sm:text-right">
            <p className="text-xs text-muted-foreground">Pris</p>
            <p className="text-2xl font-semibold tabular-nums">{priceText}</p>
          </div>
          <Person p={s.userId} sub="Oppdragsgiver" />
        </div>
      </div>

      <Journey data={data} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Send />}
          label="Forespørsler"
          value={stats.requests}
          hint={`${stats.pending} venter · ${stats.accepted} aksept. · ${stats.declined} avslått`}
        />
        <Stat icon={<UserCheck />} label="Tildelt" value={stats.orders} />
        <Stat icon={<Banknote />} label="Betalt totalt" value={kr(paidTotal)} />
        <Stat icon={<Heart />} label="Favoritt" value={stats.favorites} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={`Forespørsler (${data.requests.length})`}>
            {data.requests.length ? (
              <ul className="divide-y">
                {data.requests.map((r) => (
                  <li key={r._id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <Person p={r.providerId} />
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Status s={r.withdrawnAt ? 'withdrawn' : r.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {dateTime(r.createdAt)}
                        </span>
                      </div>
                    </div>
                    {r.message ? (
                      <p className="ml-10 rounded-lg rounded-tl-none bg-muted/60 px-3 py-2 text-sm">
                        {r.message}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen har sendt forespørsel ennå" icon={<Send />} />
            )}
          </Section>

          <Section title={`Tildelt og betaling (${data.orders.length})`}>
            {data.orders.length ? (
              <div className="space-y-3">
                {data.orders.map((o) => {
                  const po = payoutFor(o._id);
                  const price = o.agreedPrice ?? o.price;
                  return (
                    <div key={o._id} className="rounded-lg border p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Person p={o.providerId} sub="Utfører" />
                        <div className="flex items-center gap-2">
                          <Status s={o.status} />
                          <Button variant="outline" size="xs" asChild>
                            <Link to={`/dashboard/orders/${o._id}`}>
                              Ordre <ArrowUpRight />
                            </Link>
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        {[
                          ['Kunde betalte', kr(price), o.paymentStatus],
                          ['Jobblo gebyr', po ? kr(po.platformFee) : '—', null],
                          ['Utfører får', po ? kr(po.netProviderAmount) : '—', po?.status],
                        ].map(([label, value, st]) => (
                          <div key={label} className="rounded-md bg-muted/50 px-2 py-2">
                            <p className="text-[11px] text-muted-foreground">{label}</p>
                            <p className="font-semibold tabular-nums">{value}</p>
                            {st ? (
                              <div className="mt-1 flex justify-center">
                                <Status s={st} />
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                        {[
                          ['Tildelt', o.createdAt],
                          ['Betalt', o.paymentConfirmedAt],
                          ['Fullført', o.completedAt],
                          ['Utbetalt', po?.transferCompletedAt],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="tabular-nums">{v ? dateTime(v) : '—'}</dd>
                          </div>
                        ))}
                      </dl>
                      {o.cancellationReason || po?.failureReason ? (
                        <p className="mt-2 text-xs text-destructive">
                          {o.cancellationReason || po?.failureReason}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Ikke tildelt noen ennå" icon={<UserCheck />} />
            )}
          </Section>

          {data.reviews.length ? (
            <Section title={`Vurderinger (${data.reviews.length})`}>
              <ul className="divide-y">
                {data.reviews.map((r) => (
                  <li key={r._id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <Person
                        p={r.reviewerId}
                        sub={`Om ${r.revieweeRole === 'poster' ? 'oppdragsgiver' : 'utfører'}`}
                      />
                      <span
                        className="flex shrink-0 text-amber-500"
                        aria-label={`${r.rating} av 5`}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={cn('size-4', n <= r.rating ? 'fill-current' : 'opacity-30')}
                          />
                        ))}
                      </span>
                    </div>
                    {r.comment ? <p className="ml-10 text-sm">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="space-y-5">
          <Section title="Penger">
            <dl className="space-y-2 text-sm">
              {[
                ['Betalt av kunde', kr(paidTotal)],
                ['Jobblo gebyr', kr(fees)],
                ['Utbetalt til utfører', kr(paidOut)],
                ['Andre kjøp', kr(purchases.filter((p) => p.at).reduce((n, p) => n + p.amount, 0))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {purchases.length ? (
              <ul className="mt-3 space-y-2 border-t pt-3">
                {purchases.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <Zap className="size-3.5 text-amber-500" />
                      {p.what}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{kr(p.amount)}</span>
                      <Status s={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          {data.disputes.length || data.reports.length ? (
            <Section title="Tvister og rapporter">
              <ul className="space-y-2 text-sm">
                {data.disputes.map((d) => (
                  <li key={d._id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/dashboard/disputes/${d._id}`}
                      className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline"
                    >
                      <AlertTriangle className="size-3.5 shrink-0 text-red-500" />
                      <span className="truncate">{d.title}</span>
                    </Link>
                    <Status s={d.status} />
                  </li>
                ))}
                {data.reports.map((r) => (
                  <li key={r._id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/dashboard/job-reports/${r._id}`}
                      className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline"
                    >
                      <Flag className="size-3.5 shrink-0 text-red-500" />
                      <span className="truncate">
                        {r.reportType} — {fullName(r.reportedBy)}
                      </span>
                    </Link>
                    <Status s={r.status} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Tidslinje">
            <ol className="space-y-4">
              {data.timeline.map((e, i) => {
                const [icon, color] = TIMELINE_ICON[e.kind] ?? [<Circle key="i" />, 'bg-zinc-400'];
                return (
                  <li key={i} className="relative flex gap-3">
                    {i < data.timeline.length - 1 && (
                      <span className="absolute top-7 bottom-[-14px] left-[13px] w-px bg-border" />
                    )}
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-white [&_svg]:size-3.5',
                        color
                      )}
                    >
                      {icon}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm leading-snug">{e.text}</p>
                      <p className="text-[11px] text-muted-foreground">{dateTime(e.at)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
