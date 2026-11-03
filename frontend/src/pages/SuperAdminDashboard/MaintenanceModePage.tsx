import { useState, useEffect } from 'react';
import { Loader2, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { useMaintenanceMode, useToggleMaintenanceMode } from '../../hooks/admin/content';
import { AdminPageHeader, AdminLoadingSkeleton, AdminErrorState } from '../../components/admin';
import { toast } from 'react-hot-toast';
import { Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Label } from '../../components/developer/ui/label';
import { Switch } from '../../components/developer/ui/switch';
import { Textarea } from '../../components/developer/ui/textarea';

export default function MaintenanceModePage() {
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError, refetch } = useMaintenanceMode();
  const toggleMutation = useToggleMaintenanceMode();

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setMessage(data.message ?? '');
    }
  }, [data]);

  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    if (!newEnabled) {
      setMessage('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await toggleMutation.mutateAsync({ enabled, message: enabled ? message : undefined });
      toast.success(
        enabled ? 'Vedlikeholdsmodus er aktivert.' : 'Vedlikeholdsmodus er deaktivert.'
      );
    } catch {
      toast.error('Kunne ikke oppdatere vedlikeholdsmodus.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Vedlikeholdsmodus"
          description="Sett plattformen i vedlikeholdsmodus"
        />
        <AdminLoadingSkeleton rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Vedlikeholdsmodus"
          description="Sett plattformen i vedlikeholdsmodus"
        />
        <AdminErrorState onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Vedlikeholdsmodus"
        description="Sett plattformen i vedlikeholdsmodus"
        actions={
          <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
            <RefreshCw />
            Oppdater
          </Button>
        }
      />

      {enabled && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200/70 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Vedlikeholdsmodus er aktiv</p>
            <p className="mt-0.5 text-xs">
              Plattformen er utilgjengelig for vanlige brukere. Den angitte meldingen vises på
              allmenningssiden.
            </p>
          </div>
        </div>
      )}

      <Section
        title="Aktiver vedlikeholdsmodus"
        description="Slå på for å hindre brukertilgang mens du gjør endringer"
        action={
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            className="data-checked:bg-red-600"
            aria-label={enabled ? 'Deaktiver vedlikeholdsmodus' : 'Aktiver vedlikeholdsmodus'}
          />
        }
      >
        <div className="space-y-4">
          {enabled && (
            <div className="space-y-1.5">
              <Label htmlFor="maintenance-message">Vedlikeholdsmelding</Label>
              <Textarea
                id="maintenance-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Skriv inn en melding som vises for brukerne..."
              />
              <p className="text-xs text-muted-foreground">
                Denne meldingen vises på innloggingssiden når vedlikeholdsmodus er aktiv.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? 'Lagrer...' : 'Lagre'}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
