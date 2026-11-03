import { useState } from 'react';
import { Save, RefreshCw, Megaphone } from 'lucide-react';
import { useAnnouncements, useUpdateAnnouncement } from '../../hooks/admin/content';
import {
  AdminPageHeader,
  AdminLoadingSkeleton,
  AdminErrorState,
  AdminEmptyState,
} from '../../components/admin';
import { toast } from 'react-hot-toast';
import { Mono, Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Switch } from '../../components/developer/ui/switch';
import { Textarea } from '../../components/developer/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/developer/ui/select';

interface Announcement {
  key: string;
  text: string;
  type: string;
  active: boolean;
  linkUrl?: string;
}

export default function AnnouncementsPage() {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Announcement>>>({});

  const { data: announcements, isLoading, isError, refetch } = useAnnouncements();
  const updateMutation = useUpdateAnnouncement();

  const handleChange = (key: string, field: keyof Announcement, value: string | boolean) => {
    setEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleSave = async (announcement: Announcement) => {
    const key = announcement.key;
    const edit = edits[key];
    if (!edit) return;

    setSavingKey(key);
    try {
      const payload = { ...announcement, ...edit };
      await updateMutation.mutateAsync(payload as unknown as Record<string, unknown>);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success('Kunngjøring lagret.');
    } catch {
      toast.error('Kunne ikke lagre kunngjøring.');
    } finally {
      setSavingKey(null);
    }
  };

  const announcementList = (announcements as unknown as Announcement[]) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Kunngjøringer"
          description="Administrer systemmeldinger og varsler"
        />
        <AdminLoadingSkeleton rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Kunngjøringer"
          description="Administrer systemmeldinger og varsler"
        />
        <AdminErrorState onRetry={refetch} />
      </div>
    );
  }

  if (!announcementList.length) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Kunngjøringer"
          description="Administrer systemmeldinger og varsler"
        />
        <AdminEmptyState
          title="Ingen kunngjøringer"
          description="Det er ingen kunngjøringer opprettet ennå."
          icon={<Megaphone size={32} />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Kunngjøringer"
        description="Administrer systemmeldinger og varsler"
        actions={
          <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
            <RefreshCw />
            Oppdater
          </Button>
        }
      />

      <div className="grid gap-4">
        {announcementList.map((announcement) => {
          const key = announcement.key;
          const edit = edits[key] ?? {};
          const text = edit.text ?? announcement.text;
          const type = edit.type ?? announcement.type;
          const active = edit.active ?? announcement.active;
          const linkUrl = edit.linkUrl ?? announcement.linkUrl ?? '';
          const isSaving = savingKey === key;
          const hasChanges = key in edits;

          return (
            <Section
              key={key}
              title={<Mono className="select-all">{key}</Mono>}
              contentClassName="space-y-4"
              action={
                <Button
                  size="sm"
                  onClick={() => handleSave(announcement)}
                  disabled={!hasChanges || isSaving}
                >
                  <Save />
                  {isSaving ? 'Lagrer...' : 'Lagre'}
                </Button>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor={`${key}-text`}>Melding</Label>
                <Textarea
                  id={`${key}-text`}
                  value={text as string}
                  onChange={(e) => handleChange(key, 'text', e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`${key}-type`}>Type</Label>
                  <Select
                    value={type as string}
                    onValueChange={(value) => handleChange(key, 'type', value)}
                  >
                    <SelectTrigger id={`${key}-type`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Advarsel</SelectItem>
                      <SelectItem value="success">Suksess</SelectItem>
                      <SelectItem value="error">Feil</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`${key}-active`}>Aktiv</Label>
                  <div className="flex h-8 items-center">
                    <Switch
                      id={`${key}-active`}
                      checked={active as boolean}
                      onCheckedChange={(checked) => handleChange(key, 'active', checked)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${key}-link`}>Lenke-URL</Label>
                <Input
                  id={`${key}-link`}
                  type="text"
                  value={linkUrl as string}
                  onChange={(e) => handleChange(key, 'linkUrl', e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
