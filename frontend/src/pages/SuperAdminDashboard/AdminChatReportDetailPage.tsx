import { useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Flag,
  Gavel,
  Loader2,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  fetchAdminChatReportById,
  assignChatReport,
  addChatReportInternalNote,
  sendChatReportOfficialMessage,
  resolveChatReport,
  dismissChatReport,
  reopenChatReport,
  updateChatReportPriority,
  CHAT_REPORT_OUTCOME_LABELS,
  CHAT_REPORT_PRIORITY_LABELS,
  type AdminChatReportItem,
} from '../../api/admin/chats';
import { EmptyState, ErrorState, Section } from '../../components/developer/kit';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/developer/ui/avatar';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Textarea } from '../../components/developer/ui/textarea';
import { Label } from '../../components/developer/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/developer/ui/dialog';
import { dateTime } from '@/lib/devFormat';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { Priority, ReportStatus, ReportType } from './reportBadges';

const CLOSED = ['resolved', 'dismissed', 'closed'];

/** Timeline actions as Norwegian sentences. */
const ACTION: Record<string, string> = {
  created: 'Rapport mottatt',
  assigned: 'Saken ble tatt',
  priority_changed: 'Prioritet endret',
  internal_note_added: 'Internt notat',
  official_message_sent: 'Offisiell melding sendt',
  information_requested_from_reporter: 'Ba rapportør om mer informasjon',
  information_requested_from_reported_user: 'Ba rapportert bruker om mer informasjon',
  resolved: 'Løst',
  dismissed: 'Avvist',
  reopened: 'Gjenåpnet',
  safepay_dispute_opened: 'SafePay-tvist åpnet',
};
const actionLabel = (a: string) =>
  ACTION[a] ??
  (a.startsWith('status_changed_to_')
    ? `Status: ${a.replace('status_changed_to_', '').replace(/_/g, ' ')}`
    : a.replace(/_/g, ' '));
const actionDot = (a: string) =>
  a === 'resolved'
    ? 'bg-emerald-500'
    : a === 'dismissed'
      ? 'bg-zinc-400'
      : a === 'reopened' || a.includes('dispute')
        ? 'bg-red-500'
        : a === 'assigned'
          ? 'bg-sky-500'
          : 'bg-muted-foreground/50';

/** A populated ref ({ _id, ... }) or a bare id → the id. */
const refId = (v: unknown): string | undefined =>
  v && typeof v === 'object' ? (v as { _id?: string })._id : (v as string | undefined) || undefined;

type Person = AdminChatReportItem['reportedBy'] & { accountStatus?: string; verified?: boolean };

function PersonCard({ title, p, note }: { title: string; p: Person | null; note?: ReactNode }) {
  const initials = (p?.name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <Section title={title}>
      {p ? (
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10">
              <AvatarImage src={p.avatarUrl} alt="" />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <Link
                to={`/dashboard/users/${p._id}`}
                className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {p.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{p.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {p.accountStatus && p.accountStatus !== 'active' && (
              <Badge variant="outline" className="border-red-200 text-red-700">
                {p.accountStatus}
              </Badge>
            )}
            {p.verified && (
              <Badge variant="outline" className="border-emerald-200 text-emerald-700">
                Verifisert
              </Badge>
            )}
            {note}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bruker slettet</p>
      )}
    </Section>
  );
}

export default function AdminChatReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState('');
  const [msgText, setMsgText] = useState('');
  const [msgRecipient, setMsgRecipient] = useState<'reporter' | 'reported_user'>('reporter');
  const [dialog, setDialog] = useState<'resolve' | 'dismiss' | 'reopen' | null>(null);
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');

  const {
    data: report,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin-chat-report-detail', reportId],
    queryFn: () => fetchAdminChatReportById(reportId!),
    enabled: !!reportId,
    staleTime: 30_000,
  });

  const inv = () => {
    qc.invalidateQueries({ queryKey: ['admin-chat-report-detail', reportId] });
    qc.invalidateQueries({ queryKey: ['admin-chat-reports'] });
  };
  const fail = (fallback: string) => (e: unknown) => toast.error(getErrorMessage(e, fallback));

  const assignMut = useMutation({
    mutationFn: () => assignChatReport(reportId!),
    onSuccess: () => {
      toast.success('Saken er din.');
      inv();
    },
    onError: fail('Tildeling mislyktes.'),
  });
  const priorityMut = useMutation({
    mutationFn: (p: string) => updateChatReportPriority(reportId!, p),
    onSuccess: () => {
      toast.success('Prioritet oppdatert.');
      inv();
    },
    onError: fail('Kunne ikke endre prioritet.'),
  });
  const noteMut = useMutation({
    mutationFn: () => addChatReportInternalNote(reportId!, noteText.trim()),
    onSuccess: () => {
      toast.success('Notat lagret.');
      setNoteText('');
      inv();
    },
    onError: fail('Kunne ikke lagre notatet.'),
  });
  const msgMut = useMutation({
    mutationFn: () => sendChatReportOfficialMessage(reportId!, msgRecipient, msgText.trim()),
    onSuccess: () => {
      toast.success('Melding sendt. Brukeren får et varsel.');
      setMsgText('');
      inv();
    },
    onError: fail('Kunne ikke sende meldingen.'),
  });
  const decideMut = useMutation({
    mutationFn: () =>
      dialog === 'resolve'
        ? resolveChatReport(reportId!, { outcome, reason: reason.trim() })
        : dialog === 'dismiss'
          ? dismissChatReport(reportId!, reason.trim())
          : reopenChatReport(reportId!, reason.trim()),
    onSuccess: () => {
      toast.success(
        dialog === 'resolve'
          ? 'Rapport løst.'
          : dialog === 'dismiss'
            ? 'Rapport avvist.'
            : 'Rapport gjenåpnet.'
      );
      setDialog(null);
      setReason('');
      setOutcome('');
      inv();
    },
    onError: fail('Kunne ikke oppdatere rapporten.'),
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  if (isError || !report) return <ErrorState error={error} onRetry={refetch} />;

  const chatId = refId(report.chatId);
  const isClosed = CLOSED.includes(report.status);
  const r = report as typeof report & {
    serviceId?: { _id: string; title: string; price?: number; status?: string } | null;
    safePayOrderId?: unknown;
    orderId?: unknown;
    disputeId?: { _id: string; status: string } | null;
  };
  const orderId = refId(r.safePayOrderId) ?? refId(r.orderId);
  const reviewLink = chatId
    ? `/dashboard/chat-review?chatId=${chatId}&reportId=${report._id}&source=report`
    : null;

  const steps = [
    { label: 'Mottatt', sub: dateTime(report.createdAt), done: true, icon: <Flag /> },
    {
      label: 'Tatt av admin',
      sub: report.assignedAdminId?.name ?? 'Ikke tildelt',
      done: Boolean(report.assignedAdminId) || report.status !== 'open',
      icon: <UserCheck />,
    },
    {
      label: report.status === 'dismissed' ? 'Avvist' : 'Avgjort',
      sub: isClosed ? dateTime(report.resolution?.resolvedAt ?? report.updatedAt) : 'Ikke ennå',
      done: isClosed,
      icon: report.status === 'dismissed' ? <XCircle /> : <CheckCircle2 />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/chat-reports">
            <ArrowLeft /> Chatrapporter
          </Link>
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {reviewLink && (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={reviewLink}>
                <MessageSquare /> Les chatten
              </Link>
            </Button>
          )}
          {!report.assignedAdminId && !isClosed && (
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => assignMut.mutate()}
              disabled={assignMut.isPending}
            >
              <UserCheck /> Ta saken
            </Button>
          )}
          {isClosed ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => setDialog('reopen')}
            >
              <RotateCcw /> Gjenåpne
            </Button>
          ) : (
            <>
              <Button variant="destructive" size="sm" onClick={() => setDialog('dismiss')}>
                <XCircle /> Avvis
              </Button>
              <Button size="sm" onClick={() => setDialog('resolve')}>
                <CheckCircle2 /> Løs
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Hero */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40">
            {report.scope === 'message' ? (
              <MessageSquare className="size-5" aria-hidden="true" />
            ) : (
              <Flag className="size-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ReportType type={report.reportType} chat />
              <Priority p={report.priority} />
              <ReportStatus s={report.status} />
              <Badge variant="outline">
                {report.scope === 'message' ? 'Én melding' : 'Hele chatten'}
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              {report.title}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Mottatt {dateTime(report.createdAt)} · #{report._id.slice(-8).toUpperCase()}
            </p>
          </div>
        </div>
        <figure className="mt-4 rounded-xl bg-muted/60 p-4">
          <blockquote className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {report.description}
          </blockquote>
          <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>— {report.reportedBy?.name ?? 'Slettet bruker'}</span>
            {report.scope === 'message' && reviewLink && (
              <Link to={reviewLink} className="font-medium text-primary hover:underline">
                Se den rapporterte meldingen →
              </Link>
            )}
          </figcaption>
        </figure>
      </section>

      {/* Progress */}
      <ol className="grid grid-cols-3 rounded-xl border bg-card p-4">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span
                className={cn(
                  'absolute top-4 right-1/2 h-0.5 w-full -translate-x-4',
                  s.done ? 'bg-emerald-500' : 'bg-border'
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex size-8 items-center justify-center rounded-full border-2 [&_svg]:size-4',
                s.done
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-border bg-card text-muted-foreground'
              )}
            >
              {s.icon}
            </span>
            <span className={cn('mt-2 text-xs font-medium', !s.done && 'text-muted-foreground')}>
              {s.label}
            </span>
            <span className="max-w-full truncate px-1 text-[11px] text-muted-foreground">
              {s.sub}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {report.evidence?.length > 0 && (
            <Section title={`Bevis (${report.evidence.length})`}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {report.evidence.map((e) => (
                  <li key={e._id}>
                    <a
                      href={e.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      {/^image\//.test(e.fileType ?? '') ? (
                        <img src={e.fileUrl} alt="" className="size-10 rounded object-cover" />
                      ) : (
                        <FileText className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{e.description || 'Vedlegg'}</span>
                        <span className="text-xs text-muted-foreground">{e.fileType ?? 'Fil'}</span>
                      </span>
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Meldinger til brukerne"
            description="Brukeren får et varsel og kan lese meldingen."
          >
            {report.officialMessages?.length > 0 && (
              <ul className="mb-4 space-y-2">
                {report.officialMessages.map((m) => (
                  <li key={m._id} className="rounded-lg bg-primary/5 p-3">
                    <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {m.senderId?.name ?? 'Admin'} → {m.recipientId?.name ?? '–'}
                      </span>
                      <time>{dateTime(m.createdAt)}</time>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-foreground">{m.message}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Mottaker">
                {(
                  [
                    [
                      'reporter',
                      `Rapportør${report.reportedBy ? ` (${report.reportedBy.name})` : ''}`,
                    ],
                    [
                      'reported_user',
                      `Rapportert${report.reportedUser ? ` (${report.reportedUser.name})` : ''}`,
                    ],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={msgRecipient === v}
                    onClick={() => setMsgRecipient(v)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-xs font-medium',
                      msgRecipient === v
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Textarea
                rows={3}
                value={msgText}
                maxLength={2000}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Skriv en melding…"
                aria-label="Melding til bruker"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => msgMut.mutate()}
                  disabled={msgText.trim().length < 3 || msgMut.isPending}
                >
                  {msgMut.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send melding
                </Button>
              </div>
            </div>
          </Section>

          <Section
            title={
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden="true" /> Interne notater
              </span>
            }
            description="Kun synlig for admins."
          >
            {report.internalNotes?.length > 0 && (
              <ul className="mb-4 space-y-2">
                {report.internalNotes.map((n) => (
                  <li
                    key={n._id}
                    className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20"
                  >
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>{n.adminId?.name ?? '–'}</span>
                      <time>{dateTime(n.createdAt)}</time>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-foreground">{n.note}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={noteText}
                maxLength={2000}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Legg til et internt notat…"
                aria-label="Internt notat"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => noteMut.mutate()}
                  disabled={noteText.trim().length < 3 || noteMut.isPending}
                >
                  {noteMut.isPending && <Loader2 className="animate-spin" />} Lagre notat
                </Button>
              </div>
            </div>
          </Section>

          <Section title="Tidslinje">
            {report.timeline?.length ? (
              <ol className="relative space-y-4 border-l pl-5">
                {[...report.timeline].reverse().map((t) => (
                  <li key={t._id} className="relative">
                    <span
                      className={cn(
                        'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card',
                        actionDot(t.action)
                      )}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium text-foreground">
                        {actionLabel(t.action)}
                      </span>
                      <time className="text-xs text-muted-foreground">{dateTime(t.createdAt)}</time>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.actorId && <span>{t.actorId.name} · </span>}
                      {t.description}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="Ingen hendelser ennå" />
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <PersonCard title="Rapportert bruker" p={report.reportedUser as Person} />
          <PersonCard title="Rapportert av" p={report.reportedBy as Person} />

          <Section title="Saksbehandling">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Saksbehandler</span>
                <span className={cn(!report.assignedAdminId && 'text-amber-600')}>
                  {report.assignedAdminId?.name ?? 'Ikke tildelt'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="priority" className="font-normal text-muted-foreground">
                  Prioritet
                </Label>
                <Select
                  value={report.priority}
                  onValueChange={(v) => priorityMut.mutate(v)}
                  disabled={priorityMut.isPending || isClosed}
                >
                  <SelectTrigger id="priority" size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHAT_REPORT_PRIORITY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          <Section title="Knyttet til">
            <ul className="space-y-2 text-sm">
              {r.serviceId && typeof r.serviceId === 'object' && (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Oppdrag</span>
                  <Link
                    to={`/dashboard/services/${r.serviceId._id}`}
                    className="truncate text-primary hover:underline"
                  >
                    {r.serviceId.title}
                  </Link>
                </li>
              )}
              {orderId && (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Ordre</span>
                  <Link
                    to={`/dashboard/orders/${orderId}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    #{orderId.slice(-8).toUpperCase()} <ArrowUpRight className="inline size-3" />
                  </Link>
                </li>
              )}
              {r.disputeId && (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Tvist</span>
                  <Link
                    to={`/dashboard/disputes/${r.disputeId._id}`}
                    className="text-primary hover:underline"
                  >
                    <ReportStatus s={r.disputeId.status} />
                  </Link>
                </li>
              )}
              {chatId && (
                <li className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Chat</span>
                  <Link to={reviewLink!} className="font-mono text-xs text-primary hover:underline">
                    #{chatId.slice(-8).toUpperCase()}
                  </Link>
                </li>
              )}
            </ul>
          </Section>

          <Section title="Avgjørelse">
            {isClosed && report.resolution ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Gavel className="size-4 text-muted-foreground" aria-hidden="true" />
                  <ReportStatus s={report.status} />
                  <Badge variant="outline">
                    {CHAT_REPORT_OUTCOME_LABELS[report.resolution.outcome] ??
                      report.resolution.outcome}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.resolution.resolvedBy?.name ?? 'Ukjent'} ·{' '}
                  {dateTime(report.resolution.resolvedAt)}
                </p>
                <p className="rounded-lg bg-muted/60 p-3 whitespace-pre-wrap">
                  {report.resolution.reason}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ikke avgjort ennå.</p>
            )}
          </Section>
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'resolve'
                ? 'Løs rapporten'
                : dialog === 'dismiss'
                  ? 'Avvis rapporten'
                  : 'Gjenåpne rapporten'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'resolve'
                ? 'Velg utfall og forklar hva som ble gjort.'
                : dialog === 'dismiss'
                  ? 'Ingen brudd funnet. Forklar hvorfor.'
                  : 'Saken går tilbake til behandling. Forklar hvorfor.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog === 'resolve' && (
              <div className="space-y-1.5">
                <Label htmlFor="resolve-outcome">Utfall *</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger id="resolve-outcome" className="w-full">
                    <SelectValue placeholder="Velg utfall" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHAT_REPORT_OUTCOME_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="decision-reason">Begrunnelse *</Label>
              <Textarea
                id="decision-reason"
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Skriv begrunnelsen…"
              />
              <p className="text-right text-[11px] text-muted-foreground">{reason.length}/1000</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Avbryt
            </Button>
            <Button
              variant={dialog === 'dismiss' ? 'destructive' : 'default'}
              onClick={() => decideMut.mutate()}
              disabled={!reason.trim() || (dialog === 'resolve' && !outcome) || decideMut.isPending}
            >
              {decideMut.isPending && <Loader2 className="animate-spin" />}
              {dialog === 'resolve' ? 'Løs' : dialog === 'dismiss' ? 'Avvis' : 'Gjenåpne'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
