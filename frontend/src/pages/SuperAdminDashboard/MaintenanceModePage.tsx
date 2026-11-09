import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Power, RefreshCw, Save } from 'lucide-react';
import type { MaintenanceState } from '../../api/admin/content';
import { useMaintenanceMode, useToggleMaintenanceMode } from '../../hooks/admin/content';
import { AdminPageHeader, AdminLoadingSkeleton, AdminErrorState } from '../../components/admin';
import { Section } from '../../components/developer/kit';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Switch } from '../../components/developer/ui/switch';
import { Textarea } from '../../components/developer/ui/textarea';

/**
 * Vedlikeholdsmodus: switch the whole site off, or one area at a time (payments, a sign-in
 * method, BankID, posting jobs, …). Staff keep access; Stripe webhooks keep working.
 */
export default function MaintenanceModePage() {
  const { data, isLoading, isError, refetch } = useMaintenanceMode();
  const save = useToggleMaintenanceMode();
  const [draft, setDraft] = useState<MaintenanceState | null>(null);

  useEffect(() => {
    if (data) setDraft(structuredClone(data.maintenanceMode));
  }, [data]);

  const changed = useMemo(
    () => Boolean(draft && data && JSON.stringify(draft) !== JSON.stringify(data.maintenanceMode)),
    [draft, data]
  );
  const areasOff = data ? data.areas.filter((a) => data.maintenanceMode.areas[a.key]?.enabled) : [];

  const setArea = (key: string, patch: Partial<{ enabled: boolean; message: string }>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            areas: {
              ...d.areas,
              [key]: { ...(d.areas[key] ?? { enabled: false, message: '' }), ...patch },
            },
          }
        : d
    );

  const submit = async () => {
    if (!draft) return;
    const turningSiteOff = draft.enabled && !data?.maintenanceMode.enabled;
    if (
      turningSiteOff &&
      !window.confirm(
        'Stenge hele siden for brukere? Administratorer og utviklere har fortsatt tilgang.'
      )
    )
      return;
    try {
      await save.mutateAsync({
        enabled: draft.enabled,
        message: draft.message,
        areas: draft.areas,
      });
    } catch {
      /* the hook shows the error */
    }
  };

  const header = (
    <AdminPageHeader
      title="Vedlikeholdsmodus"
      description="Steng hele siden, eller bare det som er under arbeid — resten fungerer som vanlig. Administratorer og utviklere har alltid tilgang, og Stripe-webhooks stoppes aldri."
      actions={
        <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
          <RefreshCw />
          Oppdater
        </Button>
      }
    />
  );

  if (isLoading)
    return (
      <div className="space-y-5">
        {header}
        <AdminLoadingSkeleton rows={6} />
      </div>
    );
  if (isError || !data || !draft)
    return (
      <div className="space-y-5">
        {header}
        <AdminErrorState onRetry={refetch} />
      </div>
    );

  return (
    <div className="space-y-5">
      {header}

      {data.maintenanceMode.enabled || areasOff.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {data.maintenanceMode.enabled ? <b>Hele siden er stengt for brukere. </b> : null}
            {areasOff.length ? `Stengt nå: ${areasOff.map((a) => a.label).join(', ')}.` : null}
          </span>
        </div>
      ) : null}

      <Section
        title="Hele siden"
        description="Alle brukere ser vedlikeholdsmeldingen. Innlogging, admin og utviklerkonsollet fungerer."
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor="site-switch" className="text-sm">
              {draft.enabled ? 'Stengt' : 'Åpen'}
            </Label>
            <Switch
              id="site-switch"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              aria-label="Steng hele siden"
            />
          </div>
        }
      >
        <Label htmlFor="site-message" className="mb-1.5">
          Melding til brukerne
        </Label>
        <Textarea
          id="site-message"
          rows={2}
          maxLength={500}
          value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
          placeholder={data.defaultMessage}
        />
      </Section>

      <Section
        title="Enkeltområder"
        description="Steng bare det som er under arbeid. Merket «Bare endringer» betyr at visning fortsatt fungerer."
      >
        <ul className="divide-y rounded-lg border">
          {data.areas.map((a) => {
            const area = draft.areas[a.key] ?? { enabled: false, message: '' };
            return (
              <li key={a.key} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <Power
                        className={`size-4 ${area.enabled ? 'text-amber-600' : 'text-muted-foreground'}`}
                      />
                      {a.label}
                      {a.writesOnly ? <Badge variant="outline">Bare endringer</Badge> : null}
                      {area.enabled ? <Badge variant="destructive">Stengt</Badge> : null}
                    </div>
                    {a.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={area.enabled}
                    onCheckedChange={(enabled) => setArea(a.key, { enabled })}
                    aria-label={`Steng ${a.label}`}
                  />
                </div>
                {area.enabled ? (
                  <Input
                    value={area.message}
                    maxLength={300}
                    onChange={(e) => setArea(a.key, { message: e.target.value })}
                    placeholder={data.defaultMessage}
                    aria-label={`Melding for ${a.label}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={!changed || save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          {save.isPending ? 'Lagrer…' : 'Lagre'}
        </Button>
        <Button
          variant="ghost"
          disabled={!changed || save.isPending}
          onClick={() => setDraft(structuredClone(data.maintenanceMode))}
        >
          Forkast
        </Button>
        <span className="text-xs text-muted-foreground">
          Gjelder innen 10 sekunder. Endringen logges.
        </span>
      </div>
    </div>
  );
}
