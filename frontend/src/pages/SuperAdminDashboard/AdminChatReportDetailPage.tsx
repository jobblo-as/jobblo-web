import { useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, UserCheck, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  fetchAdminChatReportById,
  assignChatReport,
  addChatReportInternalNote,
  sendChatReportOfficialMessage,
  resolveChatReport,
  dismissChatReport,
  reopenChatReport,
} from '../../api/admin/chats';
import {
  AdminStatusBadge,
  AdminLoadingSkeleton,
  AdminErrorState,
  AdminPageHeader,
} from '../../components/admin';
import { KeyValue, Mono, Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/developer/ui/dialog';

const RESOLVE_OUTCOMES = [
  { label: 'Ingen overtredelse', value: 'no_violation' },
  { label: 'Advarsel utstedt', value: 'warning_issued' },
  { label: 'Innholdsbrudd', value: 'content_violation' },
  { label: 'Bruker begrenset', value: 'user_restricted' },
  { label: 'Bruker suspendert', value: 'user_suspended' },
  { label: 'Chat begrenset', value: 'chat_restricted' },
  { label: 'SafePay-tvist åpnet', value: 'safepay_dispute_opened' },
  { label: 'Betalingsgjennomgang kreves', value: 'payment_review_required' },
  { label: 'Svindel eskalert', value: 'fraud_escalated' },
  { label: 'Løst mellom brukerne', value: 'resolved_between_users' },
  { label: 'Annet', value: 'other' },
];

export default function AdminChatReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState('');
  const [msgText, setMsgText] = useState('');
  const [msgRecipient, setMsgRecipient] = useState<'reporter' | 'reported_user'>('reporter');
  const [resolveOutcome, setResolveOutcome] = useState('');
  const [resolveReason, setResolveReason] = useState('');
  const [dismissReason, setDismissReason] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);

  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-chat-report-detail', reportId],
    queryFn: () => fetchAdminChatReportById(reportId!),
    enabled: !!reportId,
    staleTime: 30_000,
  });

  const inv = () => qc.invalidateQueries({ queryKey: ['admin-chat-report-detail', reportId] });

  const assignMut = useMutation({
    mutationFn: () => assignChatReport(reportId!),
    onSuccess: () => {
      toast.success('Rapport tildelt.');
      inv();
    },
  });
  const noteMut = useMutation({
    mutationFn: (note: string) => addChatReportInternalNote(reportId!, note),
    onSuccess: () => {
      toast.success('Notat lagret.');
      setNoteText('');
      inv();
    },
  });
  const msgMut = useMutation({
    mutationFn: () => sendChatReportOfficialMessage(reportId!, msgRecipient, msgText),
    onSuccess: () => {
      toast.success('Melding sendt.');
      setMsgText('');
      inv();
    },
  });
  const resolveMut = useMutation({
    mutationFn: () =>
      resolveChatReport(reportId!, { outcome: resolveOutcome, reason: resolveReason }),
    onSuccess: () => {
      toast.success('Rapport løst.');
      setShowResolve(false);
      inv();
    },
  });
  const dismissMut = useMutation({
    mutationFn: () => dismissChatReport(reportId!, dismissReason),
    onSuccess: () => {
      toast.success('Rapport avvist.');
      setShowDismiss(false);
      inv();
    },
  });
  const reopenMut = useMutation({
    mutationFn: () => reopenChatReport(reportId!),
    onSuccess: () => {
      toast.success('Rapport gjenåpnet.');
      inv();
    },
  });

  if (isLoading)
    return (
      <div className="space-y-4">
        <AdminLoadingSkeleton rows={4} />
        <AdminLoadingSkeleton rows={6} />
      </div>
    );
  if (isError || !report) return <AdminErrorState onRetry={refetch} title="Rapport ikke funnet" />;

  const chatId = typeof report.chatId === 'object' ? report.chatId?._id : report.chatId;
  const isActive = !['resolved', 'dismissed', 'closed'].includes(report.status);
  const isClosed = ['resolved', 'dismissed', 'closed'].includes(report.status);

  const person = (u?: { name: string; email: string } | null) =>
    u ? (
      <div>
        <p className="text-sm font-medium text-foreground">{u.name}</p>
        <p className="text-xs text-muted-foreground">{u.email}</p>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">–</p>
    );

  const details: [string, ReactNode][] = [
    ['Rapport-ID', <Mono key="id">{report._id}</Mono>],
    ['Status', <AdminStatusBadge key="st" status={report.status} />],
    [
      'Prioritet',
      <span key="p" className="capitalize">
        {report.priority}
      </span>,
    ],
  ];
  if (report.assignedAdminId) details.push(['Tildelt', report.assignedAdminId.name]);
  details.push(['Type', report.reportType.replace(/_/g, ' ')], ['Omfang', report.scope]);
  if (report.messageId) details.push(['Meldings-ID', <Mono key="m">{report.messageId}</Mono>]);
  details.push(
    ['Beskrivelse', report.description],
    ['Opprettet', new Date(report.createdAt).toLocaleString('nb-NO')]
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={`Rapport: ${report.title}`}
        description={`${report.reportType.replace(/_/g, ' ')} · ${report.scope}`}
        actions={
          <>
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to="/dashboard/chat-reports">
                <ArrowLeft /> Tilbake til rapporter
              </Link>
            </Button>
            {chatId && (
              <Button variant="outline" size="sm" className="bg-card" asChild>
                <Link
                  to={`/dashboard/chat-review?chatId=${chatId}&reportId=${report._id}&source=report`}
                >
                  <MessageSquare /> Gjennomgå chat
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left */}
        <div className="space-y-4 lg:col-span-2">
          <Section title="Rapportdetaljer">
            <KeyValue items={details} />
          </Section>

          {/* Evidence */}
          {report.evidence && report.evidence.length > 0 && (
            <Section title={`Bevis (${report.evidence.length})`}>
              <ul className="divide-y rounded-md border">
                {report.evidence.map((e) => (
                  <li key={e._id} className="flex items-center gap-3 px-3 py-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{e.fileType ?? 'Fil'}</p>
                      {e.description && (
                        <p className="text-xs text-muted-foreground">{e.description}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="xs" asChild>
                      <a href={e.fileUrl} target="_blank" rel="noopener noreferrer">
                        Åpne <ExternalLink />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Official messages */}
          {report.officialMessages && report.officialMessages.length > 0 && (
            <Section title="Offisielle meldinger">
              <ul className="divide-y rounded-md border">
                {report.officialMessages.map((m) => (
                  <li key={m._id} className="px-3 py-2.5">
                    <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Fra: {m.senderId?.name ?? '–'} → Til: {m.recipientId?.name ?? '–'}
                      </span>
                      <time>{new Date(m.createdAt).toLocaleString('nb-NO')}</time>
                    </div>
                    <p className="text-sm text-foreground">{m.message}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Timeline */}
          {report.timeline && report.timeline.length > 0 && (
            <Section title="Tidslinje">
              <ol className="relative space-y-3 border-l pl-5">
                {[...report.timeline].reverse().map((t) => (
                  <li key={t._id} className="relative">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-muted-foreground/50 ring-4 ring-muted" />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium text-foreground first-letter:uppercase">
                        {t.action.replace(/_/g, ' ')}
                      </span>
                      <time className="text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString('nb-NO')}
                      </time>
                    </div>
                    {(t.actorId || t.description) && (
                      <div className="text-xs text-muted-foreground">
                        {t.actorId && <span>av {t.actorId.name} </span>}
                        {t.description}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Internal notes (admin-only) */}
          <Section title="Interne notater (kun admin)">
            {report.internalNotes && report.internalNotes.length > 0 && (
              <ul className="mb-4 divide-y rounded-md border">
                {report.internalNotes.map((n) => (
                  <li key={n._id} className="px-3 py-2.5">
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>{n.adminId?.name ?? '–'}</span>
                      <time>{new Date(n.createdAt).toLocaleString('nb-NO')}</time>
                    </div>
                    <p className="text-sm text-foreground">{n.note}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Textarea
                rows={2}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Legg til internt notat (kun synlig for admins)…"
              />
              <Button
                size="sm"
                onClick={() => noteMut.mutate(noteText)}
                disabled={noteText.trim().length < 3 || noteMut.isPending}
              >
                {noteMut.isPending && <Loader2 className="animate-spin" />} Lagre notat
              </Button>
            </div>
          </Section>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Section title="Deltakere">
            <div className="divide-y">
              <div className="space-y-1 pb-3">
                <p className="text-xs text-muted-foreground">Rapportert av</p>
                {person(report.reportedBy)}
              </div>
              <div className="space-y-1 pt-3">
                <p className="text-xs text-muted-foreground">Rapportert bruker</p>
                {person(report.reportedUser)}
              </div>
            </div>
          </Section>

          <Section title="Send offisiell melding">
            <div className="space-y-2">
              <Select
                value={msgRecipient}
                onValueChange={(v) => setMsgRecipient(v as 'reporter' | 'reported_user')}
              >
                <SelectTrigger className="w-full" aria-label="Mottaker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reporter">Til: Reporter</SelectItem>
                  <SelectItem value="reported_user">Til: Rapportert bruker</SelectItem>
                </SelectContent>
              </Select>
              <Textarea
                rows={2}
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Melding…"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => msgMut.mutate()}
                disabled={msgText.trim().length < 3 || msgMut.isPending}
              >
                {msgMut.isPending && <Loader2 className="animate-spin" />} Send melding
              </Button>
            </div>
          </Section>

          <Section title="Handlinger">
            <div className="space-y-2">
              {isActive && !report.assignedAdminId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full bg-card"
                  onClick={() => assignMut.mutate()}
                  disabled={assignMut.isPending}
                >
                  <UserCheck /> Ta sak
                </Button>
              )}
              {isActive && (
                <>
                  <Button size="sm" className="w-full" onClick={() => setShowResolve(true)}>
                    Løs rapport
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowDismiss(true)}
                  >
                    Avvis rapport
                  </Button>
                </>
              )}
              {isClosed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full bg-card"
                  onClick={() => reopenMut.mutate()}
                  disabled={reopenMut.isPending}
                >
                  {reopenMut.isPending && <Loader2 className="animate-spin" />} Gjenåpne
                </Button>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Resolve dialog */}
      <Dialog open={showResolve} onOpenChange={setShowResolve}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Løs rapport</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="resolve-outcome">Utfall *</Label>
              <Select value={resolveOutcome} onValueChange={setResolveOutcome}>
                <SelectTrigger id="resolve-outcome" className="w-full">
                  <SelectValue placeholder="Velg utfall" />
                </SelectTrigger>
                <SelectContent>
                  {RESOLVE_OUTCOMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resolve-reason">Begrunnelse *</Label>
              <Textarea
                id="resolve-reason"
                rows={3}
                value={resolveReason}
                onChange={(e) => setResolveReason(e.target.value)}
                placeholder="Forklar beslutningen…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolve(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => resolveMut.mutate()}
              disabled={!resolveOutcome || !resolveReason.trim() || resolveMut.isPending}
            >
              {resolveMut.isPending && <Loader2 className="animate-spin" />} Bekreft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismiss dialog */}
      <Dialog open={showDismiss} onOpenChange={setShowDismiss}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Avvis rapport</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-reason">Begrunnelse *</Label>
            <Textarea
              id="dismiss-reason"
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Forklar avvisningen…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDismiss(false)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={() => dismissMut.mutate()}
              disabled={!dismissReason.trim() || dismissMut.isPending}
            >
              {dismissMut.isPending && <Loader2 className="animate-spin" />} Avvis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
