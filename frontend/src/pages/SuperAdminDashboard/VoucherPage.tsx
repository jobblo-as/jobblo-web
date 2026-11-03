import { useState } from 'react';
import { Plus, Ban, Ticket, Percent, InfinityIcon, Calendar, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { createPromotionCode, deactivatePromotionCode, fetchPromotionCodes } from '../../api/admin';
import {
  AdminDataTable,
  AdminStatusBadge,
  AdminConfirmDialog,
  AdminPageHeader,
  AdminStatCard,
} from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { StatusBadge } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Checkbox } from '../../components/developer/ui/checkbox';
import { Input } from '../../components/developer/ui/input';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Voucher {
  _id: string;
  name: string;
  code: string;
  amount: number;
  type: 'percentage' | 'fixed';
  usageLimit: number;
  targetPlanType: 'all' | 'private' | 'business';
  active: boolean;
  activeDate: string;
  expiresDate: string | null;
  usedBy: string[];
  source?: 'legacy' | 'stripe';
  stripeMode?: 'test' | 'live' | null;
  duration?: 'once' | 'forever' | 'repeating' | null;
  durationInMonths?: number | null;
  redemptions?: number;
  maxRedemptions?: number;
}

interface VoucherForm {
  name: string;
  code: string;
  amount: string;
  type: 'percentage' | 'fixed';
  usageLimit: string;
  targetPlanType: 'all' | 'private' | 'business';
  active: boolean;
  activeDate: string;
  expiresDate: string;
  duration: 'once' | 'forever' | 'repeating';
  durationInMonths: string;
}

const emptyForm: VoucherForm = {
  name: '',
  code: '',
  amount: '',
  type: 'percentage',
  usageLimit: '0',
  targetPlanType: 'all',
  active: true,
  activeDate: '',
  expiresDate: '',
  duration: 'once',
  durationInMonths: '',
};

export default function VoucherPage() {
  const qc = useQueryClient();
  const [page] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Voucher | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Voucher | null>(null);
  const [form, setForm] = useState<VoucherForm>(emptyForm);
  const [formError, setFormError] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-coupons', page],
    queryFn: () => fetchPromotionCodes<Voucher>(),
    staleTime: 30_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivatePromotionCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coupons'] });
      toast.success('Rabattkode deaktivert.');
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      toast.error(err.response?.data?.error || 'Kunne ikke deaktivere rabattkoden.'),
  });

  const saveMutation = useMutation({
    mutationFn: async (values: VoucherForm) => {
      const payload = {
        ...values,
        code: values.code.toUpperCase(),
        amount: parseFloat(values.amount),
        usageLimit: parseInt(values.usageLimit, 10) || 0,
      };
      if (editTarget)
        throw new Error('Stripe-rabattkoder kan ikke redigeres. Deaktiver og opprett en ny kode.');
      await createPromotionCode(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coupons'] });
      toast.success('Stripe-rabattkode opprettet.');
      setCreateOpen(false);
      setEditTarget(null);
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      toast.error(err?.response?.data?.error || 'Operasjon feilet.'),
  });

  const getStatus = (v: Voucher): 'active' | 'inactive' | 'expired' => {
    if (!v.active) return 'inactive';
    return v.expiresDate && new Date(v.expiresDate) < new Date() ? 'expired' : 'active';
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditTarget(null);
    setFormError('');
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim() || !form.amount) {
      setFormError('Navn, kode og beløp er påkrevd.');
      return;
    }
    await saveMutation.mutateAsync(form);
    setForm(emptyForm);
  };

  const vouchers = data?.vouchers ?? [];

  const columns: ColumnDef<Voucher>[] = [
    {
      key: 'name',
      header: 'Navn',
      render: (v) => <span className="text-sm font-medium text-foreground">{v.name}</span>,
    },
    {
      key: 'code',
      header: 'Kode',
      render: (v) => <span className="font-mono text-xs text-muted-foreground">{v.code}</span>,
    },
    {
      key: 'usage',
      header: 'Bruk',
      render: (v) => (
        <span className="text-sm tabular-nums text-foreground">
          {v.redemptions ?? v.usedBy?.length ?? 0} /{' '}
          {(v.maxRedemptions ?? v.usageLimit) || (
            <InfinityIcon size={14} className="inline text-muted-foreground" />
          )}
        </span>
      ),
    },
    {
      key: 'discount',
      header: 'Rabatt',
      render: (v) => (
        <Badge variant="outline" className="tabular-nums">
          <Percent />
          {v.amount}
          {v.type === 'percentage' ? '%' : ' NOK'}
        </Badge>
      ),
    },
    {
      key: 'target',
      header: 'Kilde / modus',
      render: (v) => (
        <StatusBadge
          status={v.source === 'stripe' ? (v.stripeMode === 'test' ? 'test' : 'live') : 'legacy'}
          tone={v.source === 'stripe' ? (v.stripeMode === 'test' ? 'info' : 'success') : 'neutral'}
          label={
            v.source === 'stripe'
              ? `Stripe · ${v.stripeMode === 'test' ? 'SANDBOX' : 'LIVE'}`
              : 'Legacy'
          }
        />
      ),
    },
    {
      key: 'duration',
      header: 'Varighet',
      render: (v) => (
        <span className="text-xs text-muted-foreground">
          {v.duration === 'repeating' ? `${v.durationInMonths} måneder` : v.duration || '–'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (v) => <AdminStatusBadge status={getStatus(v)} />,
    },
    {
      key: 'dates',
      header: 'Periode',
      render: (v) => (
        <div className="text-xs text-muted-foreground">
          <span>{v.activeDate ? new Date(v.activeDate).toLocaleDateString('nb-NO') : '–'}</span>
          <span className="mx-1">→</span>
          <span>{v.expiresDate ? new Date(v.expiresDate).toLocaleDateString('nb-NO') : '–'}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (v) => (
        <div className="flex items-center gap-1.5">
          {v.source === 'stripe' && v.active ? (
            <Button variant="destructive" size="xs" onClick={() => setDeleteTarget(v)}>
              <Ban /> Deaktiver
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const isFormOpen = createOpen || !!editTarget;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Kuponger"
        description={`Stripe-rabattkoder for medlemskap · ${data?.mode === 'test' ? 'SANDBOX' : data?.mode === 'live' ? 'LIVE' : 'Stripe-modus ukjent'}`}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus /> Ny kupong
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { title: 'Totale kuponger', value: vouchers.length, icon: <Ticket /> },
          {
            title: 'Aktive',
            value: vouchers.filter((v) => getStatus(v) === 'active').length,
            icon: <Ticket />,
          },
          {
            title: 'Utløpt',
            value: vouchers.filter((v) => getStatus(v) === 'expired' || getStatus(v) === 'inactive')
              .length,
            icon: <Calendar />,
          },
        ].map((s) => (
          <AdminStatCard key={s.title} title={s.title} value={s.value} icon={s.icon} />
        ))}
      </div>

      <AdminDataTable
        columns={columns}
        data={vouchers}
        keyExtractor={(v) => v._id}
        loading={isLoading}
        error={isError}
        onRetry={refetch}
        emptyTitle="Ingen kuponger"
        emptyDescription="Opprett den første rabattkupongen."
      />

      {/* Create / Edit dialog */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Rediger: ${editTarget.name}` : 'Ny kupong'}</DialogTitle>
          </DialogHeader>

          {formError && (
            <p className="rounded-md border border-red-200/70 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-name">Navn *</Label>
              <Input
                id="v-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-code">Kode *</Label>
              <Input
                id="v-code"
                type="text"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-type">Type *</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as 'percentage' | 'fixed' }))}
              >
                <SelectTrigger id="v-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Prosent (%)</SelectItem>
                  <SelectItem value="fixed">Fast beløp (NOK)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-amount">Beløp *</Label>
              <Input
                id="v-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Målgruppe</Label>
              <p className="flex h-8 items-center rounded-lg border bg-muted/50 px-2.5 text-sm text-muted-foreground">
                Alle medlemsplaner
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-usage">Bruksgrense (0 = ubegrenset)</Label>
              <Input
                id="v-usage"
                type="number"
                min="0"
                value={form.usageLimit}
                onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-duration">Varighet *</Label>
              <Select
                value={form.duration}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, duration: v as VoucherForm['duration'] }))
                }
              >
                <SelectTrigger id="v-duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Én gang</SelectItem>
                  <SelectItem value="forever">For alltid</SelectItem>
                  <SelectItem value="repeating">Gjentakende</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.duration === 'repeating' ? (
              <div className="space-y-1.5">
                <Label htmlFor="v-months">Antall måneder *</Label>
                <Input
                  id="v-months"
                  type="number"
                  min="1"
                  step="1"
                  value={form.durationInMonths}
                  onChange={(e) => setForm((f) => ({ ...f, durationInMonths: e.target.value }))}
                />
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-expires">Utløper *</Label>
            <Input
              id="v-expires"
              type="date"
              value={form.expiresDate}
              onChange={(e) => setForm((f) => ({ ...f, expiresDate: e.target.value }))}
            />
          </div>

          <Label>
            <Checkbox
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v === true }))}
            />
            Aktiv
          </Label>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditTarget(null);
              }}
            >
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="animate-spin" />}
              {editTarget ? 'Oppdater' : 'Opprett'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminConfirmDialog
        title="Deaktiver rabattkode?"
        description={`"${deleteTarget?.name}" kan ikke brukes i nye Stripe Checkout-sesjoner.`}
        confirmText="Deaktiver"
        cancelText="Avbryt"
        variant="destructive"
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.source === 'stripe')
            await deactivateMutation.mutateAsync(deleteTarget._id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
