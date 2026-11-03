import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, FileText, ExternalLink } from 'lucide-react';
import {
  useDisputeById,
  useAssignDispute,
  useResolveDispute,
  useReopenDispute,
  useAddInternalNote,
} from '../../hooks/admin/safepay';
import {
  AdminStatusBadge,
  AdminLoadingSkeleton,
  AdminErrorState,
  AdminPageHeader,
} from '../../components/admin';
import type { Dispute, DisputeOutcome } from '../../types/admin/safepay';
import { toast } from 'react-hot-toast';
import { KeyValue, Section, StatusBadge } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Card, CardContent } from '../../components/developer/ui/card';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Textarea } from '../../components/developer/ui/textarea';
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

const OUTCOME_OPTIONS: { label: string; value: DisputeOutcome }[] = [
  { label: 'Frigi til tilbyder', value: 'release_to_provider' },
  { label: 'Full refusjon til kunde', value: 'full_refund_to_customer' },
  { label: 'Delvis refusjon', value: 'partial_refund' },
  { label: 'Del betaling', value: 'split_payment' },
  { label: 'Avbryt uten betaling', value: 'cancel_without_payment' },
  { label: 'Ingen handling', value: 'no_action' },
];

type KV = [string, React.ReactNode];
const rows = (items: (KV | false | null | undefined | '')[]) => items.filter(Boolean) as KV[];

export default function DisputeDetailPage() {
  const { disputeId } = useParams<{ disputeId: string }>();
  const { data: dispute, isLoading, isError, refetch } = useDisputeById(disputeId ?? '');

  const [noteText, setNoteText] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState<DisputeOutcome | ''>('');
  const [resolveReason, setResolveReason] = useState('');
  const [resolveCustomer, setResolveCustomer] = useState('');
  const [resolveProvider, setResolveProvider] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);

  const assignMut = useAssignDispute();
  const noteMut = useAddInternalNote();
  const resolveMut = useResolveDispute();
  const reopenMut = useReopenDispute();

  if (isLoading)
    return (
      <div className="space-y-4">
        <AdminLoadingSkeleton rows={3} />
        <AdminLoadingSkeleton rows={6} />
      </div>
    );
  if (isError || !dispute)
    return (
      <AdminErrorState
        onRetry={refetch}
        title="Tvist ikke funnet"
        description="Tvisten finnes ikke eller tilgang er nektet."
      />
    );

  const d = dispute as Dispute;
  const orderId = typeof d.orderId === 'object' ? d.orderId?._id : d.orderId;
  const isActive = [
    'open',
    'under_review',
    'waiting_for_customer',
    'waiting_for_provider',
    'evidence_submitted',
  ].includes(d.status);
  const isResolved = ['resolved', 'closed', 'cancelled'].includes(d.status);

  const party = (p: unknown, role?: string) =>
    p && typeof p === 'object' ? (
      <div>
        <p className="text-sm font-medium text-foreground">
          {(p as { name?: string }).name ?? '–'}
        </p>
        <p className="text-xs text-muted-foreground">{(p as { email?: string }).email ?? ''}</p>
        {role && <p className="text-xs text-muted-foreground capitalize">{role}</p>}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">–</p>
    );

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/disputes">
            <ArrowLeft /> Tilbake til tvister
          </Link>
        </Button>
      </div>

      <AdminPageHeader
        title={d.title}
        description={`${d.reasonCategory?.replace(/_/g, ' ')} · Opprettet ${new Date(d.openedAt ?? d.createdAt).toLocaleDateString('nb-NO')}`}
        actions={
          orderId ? (
            <Button variant="outline" size="sm" className="bg-card" asChild>
              <Link to={`/dashboard/safepay/${orderId}`}>
                <ExternalLink /> Se kontrakt
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Status bar */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Status:</span>
            <AdminStatusBadge status={d.status} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Prioritet:</span>
            <StatusBadge status={d.priority} />
          </div>
          {d.assignedAdminId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tildelt:</span>
              <span className="text-xs text-foreground">
                {(d.assignedAdminId as { name?: string }).name ?? '–'}
              </span>
            </div>
          )}
          {!d.assignedAdminId && isActive && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto bg-card"
              onClick={() => assignMut.mutate(d._id)}
              disabled={assignMut.isPending}
            >
              {assignMut.isPending && <Loader2 className="animate-spin" />} Ta sak
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left */}
        <div className="space-y-4 lg:col-span-2">
          <Section title="Tvistdetaljer">
            <KeyValue
              items={rows([
                ['Tvist-ID', <span className="font-mono text-xs">{d._id}</span>],
                ['Årsak', d.reasonCategory?.replace(/_/g, ' ')],
                [
                  'Beskrivelse',
                  <span className="whitespace-pre-wrap leading-relaxed">{d.description}</span>,
                ],
                ['Åpnet', new Date(d.openedAt ?? d.createdAt).toLocaleString('nb-NO')],
                d.closedAt && ['Lukket', new Date(d.closedAt).toLocaleString('nb-NO')],
                [
                  'Ordre-ID',
                  orderId ? (
                    <Link
                      to={`/dashboard/safepay/${orderId}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {String(orderId).slice(-8).toUpperCase()}
                    </Link>
                  ) : undefined,
                ],
              ])}
            />
          </Section>

          {/* Messages */}
          {d.messages && d.messages.length > 0 && (
            <Section title={`Meldinger (${d.messages.length})`}>
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {d.messages
                  .filter((m) => !m.isInternal)
                  .map((m) => (
                    <div
                      key={m._id}
                      className={`rounded-md border p-3 text-sm ${m.senderRole === 'admin' ? 'border-sky-200/70 bg-sky-50' : 'bg-muted/40'}`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground capitalize">
                          {m.senderRole}
                        </span>
                        <time className="text-xs text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString('nb-NO')}
                        </time>
                      </div>
                      <p className="leading-relaxed text-foreground">{m.message}</p>
                      {m.attachments?.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <FileText className="size-3" /> Vedlegg {i + 1}{' '}
                          <ExternalLink className="size-3" />
                        </a>
                      ))}
                    </div>
                  ))}
              </div>
            </Section>
          )}

          {/* Internal notes — admin only */}
          <Section title="Interne notater (kun admin)">
            <div className="space-y-2">
              {d.messages
                ?.filter((m) => m.isInternal)
                .map((m) => (
                  <div
                    key={m._id}
                    className="rounded-md border border-amber-200/70 bg-amber-50 p-3"
                  >
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span className="font-medium">
                        {(m.senderId as { name?: string })?.name ?? 'Admin'}
                      </span>
                      <time>{new Date(m.createdAt).toLocaleString('nb-NO')}</time>
                    </div>
                    <p className="text-sm text-foreground">{m.message}</p>
                  </div>
                ))}
              <Textarea
                rows={2}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Legg til internt notat…"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (!noteText.trim()) return;
                  noteMut.mutate({ id: d._id, note: noteText.trim() });
                  setNoteText('');
                }}
                disabled={!noteText.trim() || noteMut.isPending}
              >
                {noteMut.isPending && <Loader2 className="animate-spin" />} Lagre notat
              </Button>
            </div>
          </Section>

          {/* Timeline */}
          {d.timeline && d.timeline.length > 0 && (
            <Section title="Tidslinje">
              <ol className="relative space-y-3 border-l pl-5">
                {[...d.timeline].reverse().map((t, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-muted-foreground/50 ring-4 ring-muted" />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium text-foreground first-letter:uppercase">
                        {t.action.replace(/_/g, ' ')}
                      </span>
                      <time className="text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString('nb-NO')}
                      </time>
                    </div>
                    {t.note && <p className="text-xs text-muted-foreground">{t.note}</p>}
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Section title="Parter">
            <KeyValue
              items={[
                ['Åpnet av', party(d.openedBy, d.openedByRole)],
                ['Åpnet mot', party(d.openedAgainst)],
              ]}
            />
          </Section>

          {d.resolution?.outcome && (
            <Section title="Løsning">
              <KeyValue
                items={rows([
                  ['Utfall', d.resolution.outcome.replace(/_/g, ' ')],
                  ['Begrunnelse', d.resolution.reason],
                  d.resolution.resolvedBy &&
                    typeof d.resolution.resolvedBy === 'object' && [
                      'Løst av',
                      (d.resolution.resolvedBy as { name?: string }).name,
                    ],
                  d.resolution.resolvedAt && [
                    'Løst dato',
                    new Date(d.resolution.resolvedAt).toLocaleString('nb-NO'),
                  ],
                  d.resolution.stripeRefundId && [
                    'Stripe refusjon',
                    <span className="font-mono text-xs">{d.resolution.stripeRefundId}</span>,
                  ],
                ])}
              />
            </Section>
          )}

          <Section title="Handlinger">
            <div className="space-y-2">
              {isActive && (
                <Button size="sm" className="w-full" onClick={() => setShowResolve(true)}>
                  Løs tvist
                </Button>
              )}
              {isResolved && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full bg-card"
                  onClick={() => setShowReopen(true)}
                >
                  Gjenåpne
                </Button>
              )}
            </div>
          </Section>

          {/* Evidence */}
          {d.evidence && d.evidence.length > 0 && (
            <Section title={`Bevis (${d.evidence.length})`}>
              {d.evidence.map((e) => (
                <a
                  key={e._id}
                  href={e.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-1.5 flex items-center gap-2 text-xs text-primary hover:underline"
                >
                  <FileText className="size-3" /> {e.fileType ?? 'Fil'}{' '}
                  <ExternalLink className="size-3" />
                </a>
              ))}
            </Section>
          )}
        </div>
      </div>

      {/* Resolve dialog */}
      <Dialog open={showResolve} onOpenChange={setShowResolve}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Løs tvist: {d.title}</DialogTitle>
            <DialogDescription>
              Alle handlinger logges og varsler berørte parter. Stripe-refusjoner behandles i
              sanntid.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="resolve-outcome">Utfall *</Label>
            <Select
              value={resolveOutcome}
              onValueChange={(v) => setResolveOutcome(v as DisputeOutcome)}
            >
              <SelectTrigger id="resolve-outcome" className="w-full">
                <SelectValue placeholder="Velg utfall" />
              </SelectTrigger>
              <SelectContent>
                {OUTCOME_OPTIONS.map((o) => (
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
          {['partial_refund', 'split_payment'].includes(resolveOutcome) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="resolve-customer">Kundebeløp (NOK)</Label>
                <Input
                  id="resolve-customer"
                  type="number"
                  min="0"
                  value={resolveCustomer}
                  onChange={(e) => setResolveCustomer(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resolve-provider">Tilbyderbeløp (NOK)</Label>
                <Input
                  id="resolve-provider"
                  type="number"
                  min="0"
                  value={resolveProvider}
                  onChange={(e) => setResolveProvider(e.target.value)}
                />
              </div>
            </div>
          )}
          <p className="rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            For refusjoner: Stripe API kalles umiddelbart. Dette kan ikke angres.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolve(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => {
                if (!resolveOutcome || !resolveReason.trim()) {
                  toast.error('Fyll ut utfall og begrunnelse.');
                  return;
                }
                resolveMut.mutate({
                  id: d._id,
                  payload: {
                    outcome: resolveOutcome,
                    reason: resolveReason.trim(),
                    customerAmount: resolveCustomer ? parseFloat(resolveCustomer) : 0,
                    providerAmount: resolveProvider ? parseFloat(resolveProvider) : 0,
                  },
                });
                setShowResolve(false);
              }}
              disabled={resolveMut.isPending || !resolveOutcome || !resolveReason.trim()}
            >
              {resolveMut.isPending && <Loader2 className="animate-spin" />} Bekreft løsning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={showReopen} onOpenChange={setShowReopen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gjenåpne tvist?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">Årsak *</Label>
            <Textarea
              id="reopen-reason"
              rows={2}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Skriv årsaken til gjenåpning…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReopen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => {
                if (!reopenReason.trim()) return;
                reopenMut.mutate({ id: d._id, reason: reopenReason.trim() });
                setShowReopen(false);
              }}
              disabled={!reopenReason.trim() || reopenMut.isPending}
            >
              {reopenMut.isPending && <Loader2 className="animate-spin" />} Gjenåpne
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
