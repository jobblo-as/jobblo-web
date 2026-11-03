import { useState, useMemo } from 'react';
import { Loader2, Save, Settings, RefreshCw } from 'lucide-react';
import { useAllConfigs, useUpdateConfig } from '../../hooks/admin/content';
import { AdminPageHeader, AdminLoadingSkeleton, AdminErrorState } from '../../components/admin';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../../components/developer/ui/dialog';
import { Input } from '../../components/developer/ui/input';
import { Textarea } from '../../components/developer/ui/textarea';
import { Button } from '../../components/developer/ui/button';
import { Label } from '../../components/developer/ui/label';
import { Badge } from '../../components/developer/ui/badge';
import { EmptyState, Mono, Section } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';
import { toast } from 'react-hot-toast';

interface ConfigEntry {
  key: string;
  value: unknown;
  description?: string;
}

const CONNECT_DEADLINE_KEY = 'SAFEPAY_CONNECT_ONBOARDING_DEADLINE_DAYS';

function getValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizeConfigs(data: Record<string, unknown> | undefined): ConfigEntry[] {
  if (!data) return [];
  return Object.entries(data).map(([key, val]) => {
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      'value' in (val as Record<string, unknown>)
    ) {
      const obj = val as { value: unknown; description?: string };
      return { key, value: obj.value, description: obj.description };
    }
    return { key, value: val, description: undefined };
  });
}

export default function GlobalSettingsPage() {
  const { data, isLoading, isError, refetch } = useAllConfigs();
  const updateMutation = useUpdateConfig();

  const [editingConfig, setEditingConfig] = useState<ConfigEntry | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const configs = useMemo(
    () => normalizeConfigs(data as Record<string, unknown> | undefined),
    [data]
  );
  const connectDeadline = configs.find((entry) => entry.key === CONNECT_DEADLINE_KEY);
  const visibleConfigs = configs.filter((entry) => entry.key !== CONNECT_DEADLINE_KEY);

  const handleOpenEdit = (entry: ConfigEntry) => {
    setEditingConfig(entry);
    setEditValue(formatDisplayValue(entry.value));
    setEditDescription(entry.description ?? '');
  };

  const handleCloseEdit = () => {
    setEditingConfig(null);
    setEditValue('');
    setEditDescription('');
  };

  const handleSave = async () => {
    if (!editingConfig) return;
    setSaving(true);
    try {
      const originalValue = editingConfig.value;
      let parsedValue: unknown = editValue;

      if (typeof originalValue === 'number') {
        parsedValue = Number(editValue);
        if (isNaN(parsedValue as number)) {
          toast.error('Verdien må være et gyldig tall.');
          setSaving(false);
          return;
        }
      } else if (typeof originalValue === 'boolean') {
        if (editValue.toLowerCase() === 'true') parsedValue = true;
        else if (editValue.toLowerCase() === 'false') parsedValue = false;
        else {
          toast.error('Verdien må være "true" eller "false".');
          setSaving(false);
          return;
        }
      } else if (originalValue !== null && typeof originalValue === 'object') {
        try {
          parsedValue = JSON.parse(editValue);
        } catch {
          toast.error('Ugyldig JSON-format for objektverdien.');
          setSaving(false);
          return;
        }
      }

      await updateMutation.mutateAsync({
        key: editingConfig.key,
        value: parsedValue,
        ...(editDescription !== editingConfig.description ? { description: editDescription } : {}),
      });
      handleCloseEdit();
    } catch {
      toast.error('Kunne ikke lagre konfigurasjonen.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<ConfigEntry>[] = [
    { key: 'key', header: 'Nøkkel', cell: (entry) => <Mono>{entry.key}</Mono> },
    {
      key: 'value',
      header: 'Verdi',
      className: 'max-w-[260px]',
      cell: (entry) => (
        <span
          className="block truncate font-mono text-xs text-muted-foreground"
          title={formatDisplayValue(entry.value)}
        >
          {formatDisplayValue(entry.value)}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (entry) => <Badge variant="outline">{getValueType(entry.value)}</Badge>,
    },
    {
      key: 'description',
      header: 'Beskrivelse',
      className: 'max-w-[200px]',
      cell: (entry) => (
        <span className="block truncate text-muted-foreground">{entry.description ?? '–'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Handlinger',
      align: 'right',
      cell: (entry) => (
        <Button variant="outline" size="xs" onClick={() => handleOpenEdit(entry)}>
          Rediger
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Globale innstillinger"
          description="Administrer systeminnstillinger og konfigurasjon"
        />
        <AdminLoadingSkeleton rows={8} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Globale innstillinger"
          description="Administrer systeminnstillinger og konfigurasjon"
        />
        <AdminErrorState onRetry={refetch} />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Globale innstillinger"
          description="Administrer systeminnstillinger og konfigurasjon"
          actions={
            <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
              <RefreshCw />
              Oppdater
            </Button>
          }
        />
        <Section title="Globale innstillinger">
          <EmptyState
            icon={<Settings />}
            title="Ingen innstillinger"
            description="Det er ingen konfigurasjonsinnstillinger tilgjengelig."
          />
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Globale innstillinger"
        description="Administrer systeminnstillinger og konfigurasjon"
        actions={
          <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
            <RefreshCw />
            Oppdater
          </Button>
        }
      />

      {connectDeadline && (
        <Section
          title="SafePay"
          description="Frist for at utføreren starter oppdraget etter bekreftet betaling. Startes det ikke i tide, kanselleres oppdraget og kunden får full refusjon automatisk. Hver dag tilsvarer 24 timer."
          action={
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => handleOpenEdit(connectDeadline)}
            >
              Endre frist
            </Button>
          }
        >
          <p className="text-sm font-medium text-foreground">
            Nåværende frist: {formatDisplayValue(connectDeadline.value)} dager
          </p>
        </Section>
      )}

      <Section title="Konfigurasjon" description={`${visibleConfigs.length} innstillinger totalt`}>
        <DataTable columns={columns} rows={visibleConfigs} rowKey={(entry) => entry.key} />
      </Section>

      <Dialog
        open={!!editingConfig}
        onOpenChange={(open) => {
          if (!open) handleCloseEdit();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rediger innstilling</DialogTitle>
            <DialogDescription>
              Oppdater verdien og beskrivelsen for denne konfigurasjonsnøkkelen.
            </DialogDescription>
          </DialogHeader>

          {editingConfig && (
            <div className="space-y-4 py-2">
              <div>
                <Label className="mb-1.5">Nøkkel</Label>
                <Input value={editingConfig.key} disabled className="font-mono" />
              </div>

              <div>
                <Label className="mb-1.5">
                  Verdi
                  <span className="text-xs font-normal text-muted-foreground">
                    ({getValueType(editingConfig.value)})
                  </span>
                </Label>
                {typeof editingConfig.value === 'object' &&
                editingConfig.value !== null &&
                !Array.isArray(editingConfig.value) ? (
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={5}
                    className="font-mono text-sm"
                    placeholder="Angi JSON-verdi..."
                  />
                ) : (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="Angi verdi..."
                    type={editingConfig.key === CONNECT_DEADLINE_KEY ? 'number' : 'text'}
                    min={editingConfig.key === CONNECT_DEADLINE_KEY ? 1 : undefined}
                    max={editingConfig.key === CONNECT_DEADLINE_KEY ? 30 : undefined}
                    step={editingConfig.key === CONNECT_DEADLINE_KEY ? 1 : undefined}
                  />
                )}
              </div>

              <div>
                <Label className="mb-1.5">Beskrivelse</Label>
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Kort beskrivelse av innstillingen..."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={saving}>
                Avbryt
              </Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? 'Lagrer...' : 'Lagre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
