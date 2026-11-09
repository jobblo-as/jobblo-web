import { useMemo, useState } from 'react';
import { Flag, Loader2, Plus, RefreshCw, Save, Search, Settings, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { ConfigEntry } from '../../api/admin/content';
import { useAllConfigs, useDeleteConfig, useUpdateConfig } from '../../hooks/admin/content';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/developer/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';
import { Input } from '../../components/developer/ui/input';
import { Textarea } from '../../components/developer/ui/textarea';
import { Button } from '../../components/developer/ui/button';
import { Label } from '../../components/developer/ui/label';
import { Badge } from '../../components/developer/ui/badge';
import { EmptyState, Mono, Section } from '../../components/developer/kit';
import { DataTable, type Column } from '../../components/developer/DataTable';

const CONNECT_DEADLINE_KEY = 'SAFEPAY_CONNECT_ONBOARDING_DEADLINE_DAYS';
const KEY_RE = /^[A-Za-z0-9_.-]{2,80}$/;
const FLAG_RE = /^(feature_|flag_)/i;

type ValueType = 'text' | 'number' | 'boolean' | 'json';
const TYPE_LABEL: Record<ValueType, string> = {
  text: 'Tekst',
  number: 'Tall',
  boolean: 'Av / på (true / false)',
  json: 'JSON (objekt eller liste)',
};

const typeOf = (value: unknown): ValueType =>
  typeof value === 'number'
    ? 'number'
    : typeof value === 'boolean'
      ? 'boolean'
      : value !== null && typeof value === 'object'
        ? 'json'
        : 'text';

const display = (value: unknown): string =>
  value === null || value === undefined
    ? '–'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

/** Text from the form → a typed value, or an error to show. */
function parseValue(raw: string, type: ValueType): { value?: unknown; error?: string } {
  if (type === 'number') {
    const n = Number(raw);
    return raw.trim() === '' || Number.isNaN(n)
      ? { error: 'Verdien må være et tall.' }
      : { value: n };
  }
  if (type === 'boolean') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'Velg av eller på.' };
  }
  if (type === 'json') {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { error: 'Ugyldig JSON.' };
    }
  }
  return { value: raw };
}

interface Draft {
  mode: 'create' | 'edit';
  key: string;
  type: ValueType;
  value: string;
  description: string;
  original?: ConfigEntry;
}

/** Super Admin: every GlobalConfig setting — create, edit, delete (all audited). */
export default function GlobalSettingsPage() {
  const { data, isLoading, isError, refetch } = useAllConfigs();
  const save = useUpdateConfig();
  const remove = useDeleteConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<ConfigEntry | null>(null);
  const [q, setQ] = useState('');

  const configs = useMemo(() => data ?? [], [data]);
  const connectDeadline = configs.find((e) => e.key === CONNECT_DEADLINE_KEY);
  const visible = configs.filter(
    (e) =>
      e.key !== CONNECT_DEADLINE_KEY &&
      (!q ||
        e.key.toLowerCase().includes(q.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(q.toLowerCase()))
  );

  const openCreate = (flag = false) =>
    setDraft({
      mode: 'create',
      key: flag ? 'feature_' : '',
      type: flag ? 'boolean' : 'text',
      value: flag ? 'false' : '',
      description: '',
    });
  const openEdit = (entry: ConfigEntry) =>
    setDraft({
      mode: 'edit',
      key: entry.key,
      type: typeOf(entry.value),
      value:
        typeOf(entry.value) === 'json'
          ? JSON.stringify(entry.value, null, 2)
          : display(entry.value),
      description: entry.description ?? '',
      original: entry,
    });

  const keyError =
    draft?.mode === 'create' && draft.key && !KEY_RE.test(draft.key)
      ? 'Bare bokstaver, tall og _ . - (2–80 tegn).'
      : '';

  const submit = async () => {
    if (!draft) return;
    if (draft.mode === 'create' && !KEY_RE.test(draft.key)) {
      toast.error('Ugyldig nøkkel.');
      return;
    }
    const parsed = parseValue(draft.value, draft.type);
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }
    const description =
      draft.mode === 'create' || draft.description !== (draft.original?.description ?? '')
        ? draft.description
        : undefined;
    try {
      await save.mutateAsync({
        key: draft.key,
        value: parsed.value,
        description,
        create: draft.mode === 'create',
      });
      setDraft(null);
    } catch {
      /* the hook shows the server's message */
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.key);
      setDeleting(null);
    } catch {
      /* toast from the hook */
    }
  };

  const columns: Column<ConfigEntry>[] = [
    {
      key: 'key',
      header: 'Nøkkel',
      cell: (e) => (
        <span className="flex items-center gap-1.5">
          <Mono>{e.key}</Mono>
          {FLAG_RE.test(e.key) ? (
            <Badge variant="outline" className="gap-1">
              <Flag className="size-3" /> Flagg
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Verdi',
      className: 'max-w-[260px]',
      cell: (e) => (
        <span
          className="block truncate font-mono text-xs text-muted-foreground"
          title={display(e.value)}
        >
          {display(e.value)}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (e) => <Badge variant="outline">{typeOf(e.value)}</Badge>,
    },
    {
      key: 'description',
      header: 'Beskrivelse',
      className: 'max-w-[220px]',
      cell: (e) => (
        <span className="block truncate text-muted-foreground" title={e.description || undefined}>
          {e.description || '–'}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Endret',
      cell: (e) =>
        e.updatedAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(e.updatedAt).toLocaleString('nb-NO', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
        ) : (
          '–'
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <span className="inline-flex gap-1.5">
          <Button variant="outline" size="xs" onClick={() => openEdit(e)}>
            Rediger
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Slett ${e.key}`}
            onClick={() => setDeleting(e)}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </span>
      ),
    },
  ];

  const header = (
    <AdminPageHeader
      title="Globale innstillinger"
      description="Systeminnstillinger (GlobalConfig). Nøkler som begynner med feature_ eller flag_ er feature flags. Hemmeligheter hører hjemme i miljøvariabler, ikke her."
      actions={
        <>
          <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
            <RefreshCw />
            Oppdater
          </Button>
          <Button variant="outline" size="sm" className="bg-card" onClick={() => openCreate(true)}>
            <Flag />
            Nytt flagg
          </Button>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus />
            Ny innstilling
          </Button>
        </>
      }
    />
  );

  if (isLoading)
    return (
      <div className="space-y-5">
        {header}
        <AdminLoadingSkeleton rows={8} />
      </div>
    );
  if (isError)
    return (
      <div className="space-y-5">
        {header}
        <AdminErrorState onRetry={refetch} />
      </div>
    );

  return (
    <div className="space-y-5">
      {header}

      {connectDeadline && (
        <Section
          title="SafePay"
          description="Frist for at utføreren starter oppdraget etter bekreftet betaling. Startes det ikke i tide, kanselleres oppdraget og kunden får full refusjon automatisk. Hver dag tilsvarer 24 timer."
          action={
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={() => openEdit(connectDeadline)}
            >
              Endre frist
            </Button>
          }
        >
          <p className="text-sm font-medium text-foreground">
            Nåværende frist: {display(connectDeadline.value)} dager
          </p>
        </Section>
      )}

      <Section
        title="Konfigurasjon"
        description={`${visible.length} av ${configs.length - (connectDeadline ? 1 : 0)} innstillinger`}
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk nøkkel eller beskrivelse"
              className="h-8 w-60 pl-8"
              aria-label="Søk i innstillinger"
            />
          </div>
        }
      >
        {configs.length === 0 ? (
          <EmptyState
            icon={<Settings />}
            title="Ingen innstillinger ennå"
            description="Opprett den første med «Ny innstilling»."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(e) => e.key}
            emptyTitle="Ingen treff"
            emptyDescription="Ingen innstilling matcher søket."
          />
        )}
      </Section>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {draft?.mode === 'create' ? 'Ny innstilling' : 'Rediger innstilling'}
            </DialogTitle>
            <DialogDescription>
              {draft?.mode === 'create'
                ? 'En feature flag er en nøkkel som begynner med feature_ eller flag_ og har verdien av / på. Den slås av og på fra utviklerkonsollet.'
                : 'Oppdater verdien og beskrivelsen. Endringen logges.'}
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="config-key" className="mb-1.5">
                  Nøkkel
                </Label>
                <Input
                  id="config-key"
                  value={draft.key}
                  disabled={draft.mode === 'edit'}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value.trim() })}
                  placeholder="f.eks. feature_new_checkout"
                  className="font-mono"
                  aria-invalid={keyError ? true : undefined}
                />
                {keyError ? <p className="mt-1 text-xs text-destructive">{keyError}</p> : null}
              </div>

              <div>
                <Label htmlFor="config-type" className="mb-1.5">
                  Type
                </Label>
                <Select
                  value={draft.type}
                  disabled={draft.mode === 'edit'}
                  onValueChange={(t) =>
                    setDraft({
                      ...draft,
                      type: t as ValueType,
                      value: t === 'boolean' ? 'false' : '',
                    })
                  }
                >
                  <SelectTrigger id="config-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as ValueType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="config-value" className="mb-1.5">
                  Verdi
                </Label>
                {draft.type === 'boolean' ? (
                  <Select
                    value={draft.value}
                    onValueChange={(v) => setDraft({ ...draft, value: v })}
                  >
                    <SelectTrigger id="config-value" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Av (false)</SelectItem>
                      <SelectItem value="true">På (true)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : draft.type === 'json' ? (
                  <Textarea
                    id="config-value"
                    value={draft.value}
                    onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                    rows={6}
                    className="font-mono text-sm"
                    placeholder='{"eksempel": true}'
                  />
                ) : (
                  <Input
                    id="config-value"
                    value={draft.value}
                    onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                    type={draft.type === 'number' ? 'number' : 'text'}
                    {...(draft.key === CONNECT_DEADLINE_KEY ? { min: 1, max: 30, step: 1 } : {})}
                    placeholder="Angi verdi..."
                  />
                )}
              </div>

              <div>
                <Label htmlFor="config-description" className="mb-1.5">
                  Beskrivelse
                </Label>
                <Input
                  id="config-description"
                  value={draft.description}
                  maxLength={300}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Hva styrer denne innstillingen?"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                Avbryt
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={save.isPending || Boolean(keyError) || !draft?.key}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {save.isPending ? 'Lagrer...' : draft?.mode === 'create' ? 'Opprett' : 'Lagre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette {deleting?.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              Koden som leser denne nøkkelen faller tilbake til standardverdien sin. Slettingen
              logges og kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending ? 'Sletter…' : 'Slett'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
