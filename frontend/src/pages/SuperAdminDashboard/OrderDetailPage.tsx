import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bell,
  Briefcase,
  CheckCircle2,
  Eye,
  Mail,
  MessageSquare,
  Phone,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { dateTime } from '@/lib/devFormat';
import { cn } from '@/lib/utils';
import { fetchOrderDetail } from '../../api/admin/details';
import {
  EmptyState,
  ErrorState,
  IssueList,
  Section,
  StatusBadge,
} from '../../components/developer/kit';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';

/** Admin → Ordrer → one order: the parties, the money, the journey, and anything wrong with it. */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUS: Record<string, [string, Tone]> = {
  pending: ['Venter', 'warning'],
  accepted: ['Akseptert', 'success'],
  declined: ['Avslått', 'neutral'],
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
  succeeded: ['Vellykket', 'success'],
  failed: ['Feilet', 'danger'],
  transferred: ['Utbetalt', 'success'],
  released_internal: ['Frigitt', 'info'],
  processing: ['Behandles', 'info'],
  reconciliation_required: ['Må avstemmes', 'danger'],
  payment_received: ['Betaling mottatt', 'success'],
  waiting_connect: ['Venter på Connect', 'warning'],
  refund_pending: ['Refusjon venter', 'warning'],
  refund_failed: ['Refusjon feilet', 'danger'],
  automatically_cancelled: ['Auto-kansellert', 'danger'],
  resolved: ['Løst', 'success'],
};
const Status = ({ s }: { s?: unknown }) => {
  const key = s === null || s === undefined || s === '' ? null : String(s);
  const [label, tone] = (key && STATUS[key]) || [key?.replace(/_/g, ' ') || '—', 'neutral'];
  return <StatusBadge status={key} label={label} tone={tone as Tone} />;
};

/** The diagnostics timeline is shared with the developer console (English); say it in Norwegian here. */
const EVENT_NO: Record<string, string> = {
  'Order created': 'Ordre opprettet',
  'Checkout session created': 'Betalingsside åpnet',
  'Payment confirmed': 'Betaling bekreftet',
  'Work started': 'Arbeidet startet',
  'Ready for review': 'Levert til godkjenning',
  Completed: 'Fullført',
  'Refund started': 'Refusjon startet',
  'Refund completed': 'Refusjon fullført',
  'Refund failed': 'Refusjon feilet',
  'Transfer initiated': 'Overføring startet',
  'Transfer completed': 'Utbetalt til tilbyder',
  'Transfer failed': 'Utbetaling feilet',
};
const translate = (t: string) =>
  EVENT_NO[t] ??
  t.replace(/^Payout created/, 'Utbetaling opprettet').replace(/^Dispute opened/, 'Tvist åpnet');
const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-zinc-400',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

const kr = (v: unknown, minor = false) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '—';
  return `${Math.round(minor ? n / 100 : n).toLocaleString('nb-NO')} kr`;
};
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const initials = (name?: string) =>
  (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

type PartyPerson = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
} | null;

function Party({
  role,
  person,
  badges,
}: {
  role: string;
  person: PartyPerson;
  badges?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border bg-card p-4">
      <Avatar size="lg">
        <AvatarImage src={person?.avatarUrl} alt="" />
        <AvatarFallback>{initials(person?.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {role}
        </p>
        {person ? (
          <>
            <Link
              to={`/dashboard/users/${person._id}`}
              className="block truncate font-semibold text-foreground hover:text-primary hover:underline"
            >
              {person.name}
            </Link>
            {person.email && (
              <a
                href={`mailto:${person.email}`}
                className="flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:underline"
              >
                <Mail className="size-3.5 shrink-0" /> {person.email}
              </a>
            )}
            {person.phone && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="size-3.5 shrink-0" /> {person.phone}
              </p>
            )}
            {badges}
          </>
        ) : (
          <p className="text-muted-foreground">Ikke tilknyttet</p>
        )}
      </div>
    </div>
  );
}

/** Label/value rows; empty values are skipped. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return <p className="text-sm text-muted-foreground">Ingen data.</p>;
  return (
    <dl className="space-y-2 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right wrap-break-word">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const Mono = ({ v }: { v: unknown }) =>
  str(v) ? <span className="font-mono text-xs">{str(v)}</span> : null;

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'order-detail', id],
    queryFn: () => fetchOrderDetail(id),
    enabled: Boolean(id),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );

  const o = data.order;
  const p = data.payment;
  const po = data.payout;
  const sp = data.safePay;
  const spAmounts = (sp?.amounts ?? {}) as Record<string, number>;
  const critical = data.issues.filter(
    (i) => i.severity === 'critical' || i.severity === 'high'
  ).length;

  const customerPaid = o.checkoutAmountMinor
    ? kr(o.checkoutAmountMinor, true)
    : spAmounts.totalCustomer !== undefined
      ? kr(spAmounts.totalCustomer)
      : p
        ? kr(p.amount)
        : '—';
  const fee = po ? kr(po.platformFee) : spAmounts.fee !== undefined ? kr(spAmounts.fee) : '—';
  const net = po
    ? kr(po.netProviderAmount)
    : spAmounts.netProvider !== undefined
      ? kr(spAmounts.netProvider)
      : '—';

  const steps: { label: string; at: string | null; icon: ReactNode }[] = [
    { label: 'Opprettet', at: str(o.createdAt), icon: <Sparkles /> },
    {
      label: 'Betalt',
      at: str(o.paymentConfirmedAt) ?? (o.paymentStatus === 'paid' ? str(p?.createdAt) : null),
      icon: <Banknote />,
    },
    { label: 'Startet', at: str(o.startedAt), icon: <PlayCircle /> },
    { label: 'Til godkjenning', at: str(o.readyForReviewAt), icon: <Eye /> },
    { label: 'Fullført', at: str(o.completedAt), icon: <CheckCircle2 /> },
    { label: 'Utbetalt', at: str(po?.transferCompletedAt), icon: <Wallet /> },
  ];
  const reached = steps.reduce((n, s, i) => (s.at ? i : n), 0);
  const cancelled = o.status === 'cancelled' || o.status === 'disputed';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/orders">
            <ArrowLeft /> Ordrer
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {o.service && (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={`/dashboard/services/${o.service._id}`}>
                <Briefcase /> Oppdrag
              </Link>
            </Button>
          )}
          {o.chatId && (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={`/dashboard/chats/${o.chatId}`}>
                <MessageSquare /> Chat
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" className="bg-card" asChild>
            <Link to={`/dashboard/safepay/${o._id}`}>
              <ShieldCheck /> SafePay
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="bg-card" asChild>
            <Link to={`/developer/jobs?id=${o._id}`}>
              Teknisk <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{o.service?.title || 'Ordre'}</h1>
            <Status s={o.status} />
            <Status s={o.paymentStatus} />
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">#{o._id}</span>
            <span>Opprettet {dateTime(o.createdAt)}</span>
            {str(o.updatedAt) && <span>Oppdatert {dateTime(str(o.updatedAt))}</span>}
          </p>
          {o.cancellationReason ? (
            <p className="text-sm text-destructive">Årsak: {o.cancellationReason}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-5 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
          <div className="sm:text-right">
            <p className="text-xs text-muted-foreground">Avtalt pris</p>
            <p className="text-2xl font-semibold tabular-nums">{kr(o.agreedPrice)}</p>
          </div>
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              critical
                ? 'bg-red-500/10 text-red-600'
                : data.issues.length
                  ? 'bg-amber-500/10 text-amber-700'
                  : 'bg-emerald-500/10 text-emerald-700'
            )}
          >
            {data.issues.length ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {data.issues.length ? `${data.issues.length} avvik` : 'Alt OK'}
          </div>
        </div>
      </div>

      {/* Journey */}
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
                  : cancelled && i === reached + 1
                    ? 'border-red-400 bg-card text-red-500'
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

      {/* Parties */}
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        <Party role="Kunde" person={o.customer} />
        <ArrowRight className="hidden size-5 shrink-0 text-muted-foreground md:block" />
        <Party
          role="Tilbyder"
          person={o.provider}
          badges={
            o.provider && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant={o.provider.connectAccount ? 'secondary' : 'destructive'}>
                  {o.provider.connectAccount ? 'Stripe Connect' : 'Ingen Connect-konto'}
                </Badge>
                <Badge variant={o.provider.payoutEnabled ? 'secondary' : 'destructive'}>
                  {o.provider.payoutEnabled ? 'Utbetaling aktiv' : 'Utbetaling ikke aktiv'}
                </Badge>
              </div>
            )
          }
        />
      </div>

      {/* Money */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ['Kunde betalte', customerPaid, o.paymentStatus, <Banknote key="i" />],
            ['Jobblo gebyr', fee, null, <Sparkles key="i" />],
            ['Tilbyder får', net, po?.status, <Wallet key="i" />],
          ] as [string, string, unknown, ReactNode][]
        ).map(([label, value, st, icon]) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-5">
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </div>
            {st ? <Status s={st} /> : null}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Betaling">
              {p ? (
                <Facts
                  rows={[
                    ['Status', <Status key="s" s={p.status} />],
                    ['Beløp', kr(p.amount)],
                    [
                      'Refusjon',
                      str(p.refundStatus) && str(p.refundStatus) !== 'none' ? (
                        <Status key="r" s={p.refundStatus} />
                      ) : null,
                    ],
                    ['SafePay', sp ? <Status key="sp" s={sp.status} /> : null],
                    ['Registrert', dateTime(str(p.createdAt))],
                    ['PaymentIntent', <Mono key="pi" v={p.stripePaymentIntentId} />],
                    [
                      'Refusjons-ID',
                      str(p.stripeRefundId) && <Mono key="ri" v={p.stripeRefundId} />,
                    ],
                  ]}
                />
              ) : (
                <EmptyState
                  title="Ingen betaling"
                  description="Kunden har ikke betalt for denne ordren."
                  icon={<Banknote />}
                />
              )}
            </Section>
            <Section title="Utbetaling">
              {po ? (
                <Facts
                  rows={[
                    ['Status', <Status key="s" s={po.status} />],
                    ['Brutto', kr(po.grossAmount)],
                    ['Gebyr', kr(po.platformFee)],
                    ['Netto til tilbyder', kr(po.netProviderAmount)],
                    ['Kilde', str(po.releaseSource)?.replace(/_/g, ' ') ?? null],
                    [
                      'Fullført',
                      str(po.transferCompletedAt) && dateTime(str(po.transferCompletedAt)),
                    ],
                    [
                      'Overføring',
                      str(po.stripeTransferId) && <Mono key="t" v={po.stripeTransferId} />,
                    ],
                    [
                      'Feil',
                      (str(po.failureReason) || str(po.failureCode)) && (
                        <span key="f" className="text-destructive">
                          {str(po.failureReason) || str(po.failureCode)}
                        </span>
                      ),
                    ],
                  ]}
                />
              ) : (
                <EmptyState title="Ingen utbetaling ennå" icon={<Wallet />} />
              )}
            </Section>
          </div>

          {data.disputes.length > 0 && (
            <Section title={`Tvister (${data.disputes.length})`}>
              <ul className="divide-y">
                {data.disputes.map((d) => (
                  <li
                    key={String(d._id)}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <Link
                      to={`/dashboard/disputes/${String(d._id)}`}
                      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <AlertTriangle className="size-3.5 shrink-0 text-red-500" />
                      <span className="truncate">{str(d.title) || 'Tvist'}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <Status s={d.status} />
                      <span className="text-xs text-muted-foreground">
                        {dateTime(str(d.openedAt))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Helsesjekk"
            description="Avvik mellom ordre, betaling, SafePay og utbetaling."
          >
            <IssueList issues={data.issues} empty="Ingen avvik — ordren er konsistent." />
          </Section>

          <Section title={`Varsler sendt (${data.notifications.length})`}>
            {data.notifications.length ? (
              <ul className="space-y-2">
                {data.notifications.map((n) => (
                  <li key={n._id} className="flex gap-3 rounded-lg border p-2.5 text-sm">
                    <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p>{n.content}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {n.type} · {dateTime(n.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ingen varsler.</p>
            )}
          </Section>
        </div>

        <Section title="Tidslinje">
          {data.timeline.length ? (
            <ol className="space-y-4">
              {[...data.timeline].reverse().map((e, i, all) => (
                <li key={i} className="relative flex gap-3">
                  {i < all.length - 1 && (
                    <span className="absolute top-4 bottom-[-18px] left-[5px] w-px bg-border" />
                  )}
                  <span
                    className={cn(
                      'relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card',
                      TONE_DOT[(e.tone as Tone) || 'neutral']
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug font-medium first-letter:uppercase">
                      {translate(e.title)}
                    </p>
                    {e.detail ? (
                      <p className="text-xs break-all text-muted-foreground">{e.detail}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">{dateTime(e.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Ingen hendelser.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
