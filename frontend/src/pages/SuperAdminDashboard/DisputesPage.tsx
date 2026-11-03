import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Shield, Clock, Users, CheckCircle2, Loader2 } from 'lucide-react';
import {
  useAdminDisputes,
  useDisputesSummary,
  useAssignDispute,
  useResolveDispute,
  useReopenDispute,
} from '../../hooks/admin/safepay';
import type { Dispute, DisputeStatus, DisputeOutcome } from '../../types/admin/safepay';
import {
  AdminDataTable,
  AdminFilterSelect,
  AdminStatusBadge,
  AdminPageHeader,
  AdminStatCard,
  AdminStatCardSkeleton,
  AdminConfirmDialog,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatusBadge } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
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

const STATUS_OPTIONS: { label: string; value: DisputeStatus }[] = [
  { label: 'Åpen', value: 'open' },
  { label: 'Under behandling', value: 'under_review' },
  { label: 'Venter kunde', value: 'waiting_for_customer' },
  { label: 'Venter tilbyder', value: 'waiting_for_provider' },
  { label: 'Bevis innlevert', value: 'evidence_submitted' },
  { label: 'Løst', value: 'resolved' },
  { label: 'Lukket', value: 'closed' },
];

const PRIORITY_OPTIONS = [
  { label: 'Lav', value: 'low' },
  { label: 'Middels', value: 'medium' },
  { label: 'Høy', value: 'high' },
  { label: 'Kritisk', value: 'critical' },
];

const OUTCOME_OPTIONS: { label: string; value: DisputeOutcome }[] = [
  { label: 'Frigi til tilbyder', value: 'release_to_provider' },
  { label: 'Full refusjon til kunde', value: 'full_refund_to_customer' },
  { label: 'Delvis refusjon', value: 'partial_refund' },
  { label: 'Del betaling', value: 'split_payment' },
  { label: 'Avbryt uten betaling', value: 'cancel_without_payment' },
  { label: 'Ingen handling', value: 'no_action' },
];

interface ResolveForm {
  outcome: DisputeOutcome | '';
  reason: string;
  customerAmount: string;
  providerAmount: string;
}

export default function DisputesPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  // Action state
  const [resolveTarget, setResolveTarget] = useState<Dispute | null>(null);
  const [resolveForm, setResolveForm] = useState<ResolveForm>({
    outcome: '',
    reason: '',
    customerAmount: '',
    providerAmount: '',
  });
  const [reopenTarget, setReopenTarget] = useState<Dispute | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const { data, isLoading, isError, refetch } = useAdminDisputes({
    page,
    limit: 15,
    ...(statusFilter && { status: statusFilter }),
    ...(priorityFilter && { priority: priorityFilter }),
  });
  const { data: summary, isLoading: summaryLoading } = useDisputesSummary();

  const assignMutation = useAssignDispute();
  const resolveMutation = useResolveDispute();
  const reopenMutation = useReopenDispute();

  const handleResolve = async () => {
    if (!resolveTarget || !resolveForm.outcome || !resolveForm.reason.trim()) return;
    await resolveMutation.mutateAsync({
      id: resolveTarget._id,
      payload: {
        outcome: resolveForm.outcome,
        reason: resolveForm.reason.trim(),
        customerAmount: resolveForm.customerAmount ? parseFloat(resolveForm.customerAmount) : 0,
        providerAmount: resolveForm.providerAmount ? parseFloat(resolveForm.providerAmount) : 0,
      },
    });
    setResolveTarget(null);
    setResolveForm({ outcome: '', reason: '', customerAmount: '', providerAmount: '' });
  };

  const columns: ColumnDef<Dispute>[] = [
    {
      key: 'id',
      header: 'Tvist-ID',
      render: (d) => (
        <Link
          to={`/dashboard/disputes/${d._id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {d._id.slice(-8).toUpperCase()}
        </Link>
      ),
    },
    {
      key: 'order',
      header: 'Ordre',
      render: (d) => {
        const orderId = typeof d.orderId === 'object' ? d.orderId?._id : d.orderId;
        return orderId ? (
          <Link
            to={`/dashboard/safepay/${orderId}`}
            className="text-xs font-mono text-muted-foreground hover:underline"
          >
            {orderId.slice(-8).toUpperCase()}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'service',
      header: 'Tjeneste',
      render: (d) => (
        <span className="text-sm truncate max-w-[120px] block">{d.serviceId?.title ?? '–'}</span>
      ),
    },
    {
      key: 'openedBy',
      header: 'Åpnet av',
      render: (d) => (
        <div>
          <p className="text-sm text-foreground">{d.openedBy?.name ?? '–'}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {d.openedByRole ?? d.openedBy?.role ?? ''}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Årsak',
      render: (d) => (
        <span className="text-xs text-muted-foreground">{d.reasonCategory.replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Beløp',
      render: (d) => {
        const order = typeof d.orderId === 'object' ? d.orderId : null;
        return order?.agreedPrice != null ? (
          <span className="text-sm font-medium">
            {order.agreedPrice.toLocaleString('nb-NO')} NOK
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <AdminStatusBadge status={d.status} />,
    },
    {
      key: 'priority',
      header: 'Prioritet',
      render: (d) => <StatusBadge status={d.priority} />,
    },
    {
      key: 'assigned',
      header: 'Tildelt',
      render: (d) =>
        d.assignedAdminId ? (
          <span className="text-xs text-foreground">{d.assignedAdminId.name}</span>
        ) : (
          <span className="text-xs text-amber-700">Ikke tildelt</span>
        ),
    },
    {
      key: 'date',
      header: 'Åpnet',
      render: (d) =>
        new Date(d.openedAt).toLocaleDateString('nb-NO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (d) => {
        const isActive = [
          'open',
          'under_review',
          'waiting_for_customer',
          'waiting_for_provider',
          'evidence_submitted',
        ].includes(d.status);
        const isResolved = ['resolved', 'closed'].includes(d.status);
        return (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" className="bg-card" asChild>
              <Link to={`/dashboard/disputes/${d._id}`}>Se detaljer</Link>
            </Button>
            {isActive && !d.assignedAdminId && (
              <Button
                variant="outline"
                size="xs"
                className="bg-card"
                onClick={() => assignMutation.mutate(d._id)}
                disabled={assignMutation.isPending}
              >
                Ta sak
              </Button>
            )}
            {isActive && (
              <Button size="xs" onClick={() => setResolveTarget(d)}>
                Løs
              </Button>
            )}
            {isResolved && (
              <Button
                variant="outline"
                size="xs"
                className="bg-card"
                onClick={() => setReopenTarget(d)}
              >
                Gjenåpne
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Tvister"
        description="Administrer alle SafePay-tvister og løsninger"
      />

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {summaryLoading
          ? Array.from({ length: 6 }).map((_, i) => <AdminStatCardSkeleton key={i} />)
          : summary &&
            [
              { title: 'Åpne', value: summary.open, icon: <AlertTriangle size={16} /> },
              {
                title: 'Under behandling',
                value: summary.under_review,
                icon: <Shield size={16} />,
              },
              {
                title: 'Venter kunde',
                value: summary.waiting_for_customer,
                icon: <Clock size={16} />,
              },
              {
                title: 'Venter tilbyder',
                value: summary.waiting_for_provider,
                icon: <Clock size={16} />,
              },
              { title: 'Ikke tildelt', value: summary.unassigned, icon: <Users size={16} /> },
              {
                title: 'Løst denne måneden',
                value: summary.resolvedThisMonth,
                icon: <CheckCircle2 size={16} />,
              },
              {
                title: 'Høy/Kritisk prioritet',
                value: summary.high_priority,
                icon: <AlertTriangle size={16} />,
              },
            ].map((c) => (
              <AdminStatCard key={c.title} title={c.title} value={c.value} icon={c.icon} />
            ))}
      </section>

      <AdminDataTable
        columns={columns}
        data={data?.disputes ?? []}
        keyExtractor={(d) => d._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen tvister"
        emptyDescription="Det er ingen aktive tvister."
        pagination={data?.pagination}
        onPageChange={setPage}
        toolbar={
          <div className="flex flex-wrap gap-3 w-full">
            <AdminFilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Alle statuser"
            />
            <AdminFilterSelect
              value={priorityFilter}
              onChange={(v) => {
                setPriorityFilter(v);
                setPage(1);
              }}
              options={PRIORITY_OPTIONS}
              placeholder="Alle prioriteter"
            />
          </div>
        }
      />

      {/* Resolve dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Løs tvist: {resolveTarget?.title}</DialogTitle>
            <DialogDescription>
              Alle handlinger logges og varsler berørte parter. Stripe-refusjoner behandles i
              sanntid.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="resolve-outcome">Utfall *</Label>
            <Select
              value={resolveForm.outcome}
              onValueChange={(v) => setResolveForm((f) => ({ ...f, outcome: v as DisputeOutcome }))}
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
              value={resolveForm.reason}
              onChange={(e) => setResolveForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Forklar hvorfor du valgte dette utfallet..."
            />
          </div>

          {['partial_refund', 'split_payment'].includes(resolveForm.outcome) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="resolve-customer">Kundebeløp (NOK)</Label>
                <Input
                  id="resolve-customer"
                  type="number"
                  min="0"
                  value={resolveForm.customerAmount}
                  onChange={(e) =>
                    setResolveForm((f) => ({ ...f, customerAmount: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resolve-provider">Tilbyderbeløp (NOK)</Label>
                <Input
                  id="resolve-provider"
                  type="number"
                  min="0"
                  value={resolveForm.providerAmount}
                  onChange={(e) =>
                    setResolveForm((f) => ({ ...f, providerAmount: e.target.value }))
                  }
                />
              </div>
            </div>
          )}

          <p className="rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            For refusjoner: Stripe API kalles umiddelbart. Dette kan ikke angres.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>
              Avbryt
            </Button>
            <Button
              onClick={handleResolve}
              disabled={
                resolveMutation.isPending || !resolveForm.outcome || !resolveForm.reason.trim()
              }
            >
              {resolveMutation.isPending && <Loader2 className="animate-spin" />}
              Bekreft løsning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <AdminConfirmDialog
        title="Gjenåpne tvist?"
        description="Skriv årsaken til gjenåpning."
        confirmText="Gjenåpne"
        cancelText="Avbryt"
        isOpen={!!reopenTarget}
        onOpenChange={(open) => !open && setReopenTarget(null)}
        onConfirm={async () => {
          if (!reopenTarget || !reopenReason.trim()) return;
          await reopenMutation.mutateAsync({ id: reopenTarget._id, reason: reopenReason.trim() });
          setReopenTarget(null);
          setReopenReason('');
        }}
        trigger={undefined}
      >
        <Textarea
          aria-label="Årsak til gjenåpning"
          rows={3}
          value={reopenReason}
          onChange={(e) => setReopenReason(e.target.value)}
        />
      </AdminConfirmDialog>
    </div>
  );
}
