import { useState, useEffect } from 'react';
import { Edit, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  getPlans,
  updatePlan,
  getConfigs,
  updateConfig,
  initializeConfigs,
} from '../../features/plans/api';
import { AdminDataTable, AdminPageHeader, AdminStatusBadge } from '../../components/admin';
import type { ColumnDef } from '../../components/admin/AdminDataTable';
import { Section, StatusBadge } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/developer/ui/card';
import { Button } from '../../components/developer/ui/button';
import { Checkbox } from '../../components/developer/ui/checkbox';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Separator } from '../../components/developer/ui/separator';
import { Skeleton } from '../../components/developer/ui/skeleton';
import { Switch } from '../../components/developer/ui/switch';
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

interface PlanEntitlements {
  freeContact: number;
  perContactPrice: number;
  ContactUnlock: number;
  maxJobsValue?: number;
  maxContact: number;
  radius: number;
  visibilityLevel: number;
  locationPrecision: string;
  hasBadge: boolean;
  hasAnalytics: boolean;
}

interface Plan {
  _id: string;
  name: string;
  price: number;
  type: 'private' | 'business';
  isActive: boolean;
  featuresText: string[];
  entitlements: PlanEntitlements;
}

interface GlobalConfig {
  _id: string;
  key: string;
  value: boolean;
  description?: string;
}

interface PlanForm {
  name: string;
  price: string;
  type: 'private' | 'business';
  isActive: boolean;
  freeContact: string;
  perContactPrice: string;
  ContactUnlock: string;
  maxJobsValue: string;
  maxContact: string;
  radius: string;
  visibilityLevel: string;
  locationPrecision: string;
  hasBadge: boolean;
  hasAnalytics: boolean;
  featuresText: string[];
}

function ConfigToggle({
  config,
  onToggle,
}: {
  config: GlobalConfig;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{config.key.replace(/_/g, ' ')}</p>
        {config.description && (
          <p className="text-xs text-muted-foreground">{config.description}</p>
        )}
      </div>
      <Switch
        checked={!!config.value}
        onCheckedChange={() => onToggle(config.key, !config.value)}
        aria-label={`${config.key.replace(/_/g, ' ')}: ${config.value ? 'På' : 'Av'}`}
      />
    </div>
  );
}

const NO_PLANS: Plan[] = [];
const NO_CONFIGS: GlobalConfig[] = [];

export default function PlansAdminPage() {
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<Plan | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<PlanForm>({
    name: '',
    price: '',
    type: 'private',
    isActive: true,
    freeContact: '',
    perContactPrice: '',
    ContactUnlock: '',
    maxJobsValue: '',
    maxContact: '',
    radius: '',
    visibilityLevel: '',
    locationPrecision: 'approximate',
    hasBadge: false,
    hasAnalytics: false,
    featuresText: [],
  });
  const [newFeature, setNewFeature] = useState('');

  const adminDataQuery = useQuery({
    queryKey: ['admin', 'plans-config'],
    queryFn: async () => {
      const [plansData, configsData] = await Promise.all([getPlans(), getConfigs()]);
      const plans: Plan[] = Array.isArray(plansData) ? plansData : (plansData?.plans ?? []);
      const configArr = Array.isArray(configsData) ? configsData : (configsData?.configs ?? []);
      if (
        configArr.length === 0 ||
        !configArr.some((c: GlobalConfig) => c.key === 'STRIPE_TEST_MODE')
      ) {
        await initializeConfigs();
        const newConfigs = await getConfigs();
        return {
          plans,
          configs: (Array.isArray(newConfigs)
            ? newConfigs
            : (newConfigs?.configs ?? [])) as GlobalConfig[],
        };
      }
      return { plans, configs: configArr as GlobalConfig[] };
    },
    retry: false,
  });
  const plans = adminDataQuery.data?.plans ?? NO_PLANS;
  const configs = adminDataQuery.data?.configs ?? NO_CONFIGS;
  const loading = adminDataQuery.isFetching;
  const fetchData = adminDataQuery.refetch;

  useEffect(() => {
    if (adminDataQuery.isError) toast.error('Kunne ikke hente data');
  }, [adminDataQuery.isError]);

  const updatePlanMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updatePlan>[1] }) =>
      updatePlan(id, data),
  });
  const updateConfigMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => updateConfig(key, value),
    // useConfigByKey readers (job detail, explore ads) cache under ['config', key].
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const openEdit = (plan: Plan) => {
    setEditTarget(plan);
    setForm({
      name: plan.name,
      price: String(plan.price),
      type: plan.type,
      isActive: plan.isActive,
      freeContact: String(plan.entitlements?.freeContact ?? 0),
      perContactPrice: String(plan.entitlements?.perContactPrice ?? 0),
      ContactUnlock: String(plan.entitlements?.ContactUnlock ?? 0),
      maxJobsValue: String(plan.entitlements?.maxJobsValue ?? ''),
      maxContact: String(plan.entitlements?.maxContact ?? 0),
      radius: String(plan.entitlements?.radius ?? 0),
      visibilityLevel: String(plan.entitlements?.visibilityLevel ?? 0),
      locationPrecision: plan.entitlements?.locationPrecision ?? 'approximate',
      hasBadge: plan.entitlements?.hasBadge ?? false,
      hasAnalytics: plan.entitlements?.hasAnalytics ?? false,
      featuresText: plan.featuresText ?? [],
    });
    setShowEdit(true);
  };

  const handleSavePlan = async () => {
    if (!editTarget || !form.name.trim()) {
      toast.error('Navn er påkrevd.');
      return;
    }
    try {
      const updatedPlan = {
        name: form.name.trim(),
        price: parseFloat(form.price) || 0,
        type: form.type,
        isActive: form.isActive,
        featuresText: form.featuresText.filter((f) => f.trim()),
        entitlements: {
          ...editTarget.entitlements,
          freeContact: parseInt(form.freeContact, 10) || 0,
          perContactPrice: parseFloat(form.perContactPrice) || 0,
          ContactUnlock: parseInt(form.ContactUnlock, 10) || 0,
          maxJobsValue: form.maxJobsValue.trim() === '' ? null : parseFloat(form.maxJobsValue),
          maxContact: parseInt(form.maxContact, 10) || 0,
          radius: parseInt(form.radius, 10) || 0,
          visibilityLevel: parseInt(form.visibilityLevel, 10) || 0,
          locationPrecision: form.locationPrecision,
          hasBadge: form.hasBadge,
          hasAnalytics: form.hasAnalytics,
        },
      };
      await updatePlanMutation.mutateAsync({ id: editTarget._id, data: updatedPlan });
      qc.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan oppdatert.');
      setShowEdit(false);
      fetchData();
    } catch (err) {
      // e.g. PLAN_FIELD_LOCKED: price/name/type/active are tied to Stripe and not editable here.
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Kunne ikke oppdatere plan.');
    }
  };

  const handleToggleConfig = async (key: string, value: boolean) => {
    try {
      await updateConfigMutation.mutateAsync({ key, value });
      toast.success('Innstilling oppdatert.');
      fetchData();
    } catch {
      toast.error('Kunne ikke oppdatere innstilling.');
    }
  };

  const stripeTestMode = configs.find((c) => c.key === 'STRIPE_TEST_MODE');

  const handleToggleStripeTestMode = async (value: boolean) => {
    try {
      await updateConfigMutation.mutateAsync({ key: 'STRIPE_TEST_MODE', value });
      toast.success(
        value
          ? 'Stripe testmodus aktivert. Test-nøkler er nå i bruk.'
          : 'Stripe testmodus deaktivert. Produksjons-nøkler er nå i bruk.'
      );
      fetchData();
    } catch {
      toast.error('Kunne ikke oppdatere Stripe-innstilling.');
    }
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setForm((f) => ({ ...f, featuresText: [...f.featuresText, newFeature.trim()] }));
      setNewFeature('');
    }
  };

  const removeFeature = (idx: number) => {
    setForm((f) => ({ ...f, featuresText: f.featuresText.filter((_, i) => i !== idx) }));
  };

  const columns: ColumnDef<Plan>[] = [
    {
      key: 'name',
      header: 'Plan',
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{p.name}</p>
            <AdminStatusBadge status={p.type} />
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Pris',
      render: (p) => <span className="tabular-nums text-foreground">{p.price} NOK</span>,
    },
    {
      key: 'contacts',
      header: 'Kontakter/mnd',
      render: (p) => (
        <span className="text-sm text-muted-foreground">{p.entitlements?.freeContact ?? 0}</span>
      ),
    },
    {
      key: 'visibility',
      header: 'Synlighet',
      render: (p) => <Badge variant="outline">Nivå {p.entitlements?.visibilityLevel ?? 0}</Badge>,
    },
    {
      key: 'badge',
      header: 'Merke',
      render: (p) => (
        <span
          className={`text-xs ${p.entitlements?.hasBadge ? 'text-emerald-600' : 'text-muted-foreground'}`}
        >
          {p.entitlements?.hasBadge ? 'Ja' : 'Nei'}
        </span>
      ),
    },
    {
      key: 'analytics',
      header: 'Analyse',
      render: (p) => (
        <span
          className={`text-xs ${p.entitlements?.hasAnalytics ? 'text-emerald-600' : 'text-muted-foreground'}`}
        >
          {p.entitlements?.hasAnalytics ? 'Ja' : 'Nei'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <AdminStatusBadge status={p.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: 'Handlinger',
      className: 'whitespace-nowrap',
      render: (p) => (
        <Button variant="outline" size="xs" className="bg-card" onClick={() => openEdit(p)}>
          <Edit /> Rediger
        </Button>
      ),
    },
  ];

  const numberFields: [keyof PlanForm, string, string, string?, string?][] = [
    ['freeContact', 'ep-contacts', 'Gratis kontakter/mnd'],
    ['radius', 'ep-radius', 'Søkeradius (km)'],
    ['perContactPrice', 'ep-extra-price', 'Ekstra kontakt (NOK)', '0.01'],
    ['ContactUnlock', 'ep-unlock', 'Tilgangsforsinkelse (min)'],
    ['maxJobsValue', 'ep-max-jobs', 'Maks jobbverdi (NOK)', '0.01'],
    ['maxContact', 'ep-max-contact', 'Maks kontakter'],
    ['visibilityLevel', 'ep-visibility', 'Synlighet (0-5)', undefined, '5'],
  ];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Abonnementer"
        description="Administrer prisplaner og globale funksjonsbrytere"
      />

      {/* Stripe Test Mode Toggle */}
      <Card className={stripeTestMode?.value ? 'bg-amber-50/40 ring-amber-200/70' : undefined}>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Stripe Testmodus</CardTitle>
          <CardDescription className="text-xs">
            {stripeTestMode?.value
              ? 'Aktiv: Betalinger bruker Stripe test-nøkler. Ingen ekte belastninger skjer.'
              : 'Inaktiv: Betalinger bruker produksjons-nøkler (ekte belastninger).'}
          </CardDescription>
          <CardAction className="flex items-center gap-3">
            <StatusBadge
              status={stripeTestMode?.value ? 'test' : 'live'}
              label={stripeTestMode?.value ? 'TEST' : 'LIVE'}
              tone={stripeTestMode?.value ? 'warning' : 'success'}
            />
            <Switch
              checked={!!stripeTestMode?.value}
              onCheckedChange={() => handleToggleStripeTestMode(!stripeTestMode?.value)}
              disabled={stripeTestMode === undefined}
              aria-label={`Stripe testmodus: ${stripeTestMode?.value ? 'På' : 'Av'}`}
            />
          </CardAction>
        </CardHeader>
      </Card>

      {/* Global Feature Toggles */}
      <Section title="Globale funksjonsbrytere">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen konfigurasjoner funnet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {configs
              .filter((config) => config.key !== 'STRIPE_TEST_MODE')
              .map((config) => (
                <ConfigToggle key={config.key} config={config} onToggle={handleToggleConfig} />
              ))}
          </div>
        )}
      </Section>

      {/* Plans table */}
      <AdminDataTable
        columns={columns}
        data={plans}
        keyExtractor={(p) => p._id}
        loading={loading}
        emptyTitle="Ingen planer"
        emptyDescription="Det finnes ingen abonnementsplaner ennå."
      />

      {/* Edit plan modal */}
      <Dialog open={showEdit && !!editTarget} onOpenChange={setShowEdit}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rediger: {editTarget?.name}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Navn *</Label>
              <Input
                id="ep-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-price">Pris (NOK) *</Label>
              <Input
                id="ep-price"
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-type">Type *</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as 'private' | 'business' }))}
              >
                <SelectTrigger id="ep-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Privat</SelectItem>
                  <SelectItem value="business">Bedrift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Label className="self-end pb-2">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v === true }))}
              />
              Aktiv
            </Label>
          </div>

          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground">Rettigheter og funksjoner</h4>
            <div className="grid grid-cols-2 gap-3">
              {numberFields.map(([key, id, label, step, max]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={id}>{label}</Label>
                  <Input
                    id={id}
                    type="number"
                    min="0"
                    max={max}
                    step={step}
                    value={form[key] as string}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="ep-location">Plasseringspresisjon</Label>
                <Select
                  value={form.locationPrecision}
                  onValueChange={(v) => setForm((f) => ({ ...f, locationPrecision: v }))}
                >
                  <SelectTrigger id="ep-location" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approximate">Omtrentlig</SelectItem>
                    <SelectItem value="exact">Nøyaktig</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <Label>
                <Checkbox
                  checked={form.hasBadge}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, hasBadge: v === true }))}
                />
                Verifisert merke
              </Label>
              <Label>
                <Checkbox
                  checked={form.hasAnalytics}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, hasAnalytics: v === true }))}
                />
                Analyse
              </Label>
            </div>
          </div>

          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Funksjoner (vises for brukere)</h4>
            {form.featuresText.map((feat, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  type="text"
                  value={feat}
                  onChange={(e) => {
                    const updated = [...form.featuresText];
                    updated[idx] = e.target.value;
                    setForm((f) => ({ ...f, featuresText: updated }));
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => removeFeature(idx)}
                  aria-label="Fjern funksjon"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addFeature();
                  }
                }}
                placeholder="Legg til funksjon…"
              />
              <Button variant="outline" className="bg-card" onClick={addFeature}>
                <Plus /> Legg til
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Avbryt
            </Button>
            <Button onClick={handleSavePlan}>Lagre endringer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
