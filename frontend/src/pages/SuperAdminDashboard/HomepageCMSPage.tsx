import { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { useHomepageContent, useUpdateHomepageContent } from '../../hooks/admin/content';
import { AdminPageHeader, AdminLoadingSkeleton, AdminErrorState } from '../../components/admin';
import { Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Textarea } from '../../components/developer/ui/textarea';
import { toast } from 'react-hot-toast';

/** Content fields are untyped JSON; a missing one edits as empty. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export default function HomepageCMSPage() {
  const { data: content, isLoading, isError, refetch } = useHomepageContent();
  const updateMutation = useUpdateHomepageContent();

  const [form, setForm] = useState({
    heroTitle: '',
    heroSubtitle: '',
    heroDescription: '',
    ctaText: '',
    ctaUrl: '',
    featuredCategories: '',
    announcementBanner: '',
  });

  useEffect(() => {
    if (content) {
      setForm({
        heroTitle: text(content.heroTitle),
        heroSubtitle: text(content.heroSubtitle),
        heroDescription: text(content.heroDescription),
        ctaText: text(content.ctaText),
        ctaUrl: text(content.ctaUrl),
        featuredCategories: Array.isArray(content.featuredCategories)
          ? content.featuredCategories.map((c: unknown) => JSON.stringify(c)).join('\n')
          : typeof content.featuredCategories === 'string'
            ? content.featuredCategories
            : '',
        announcementBanner: text(content.announcementBanner),
      });
    }
  }, [content]);

  const handleChange =
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let featuredCategories: unknown[] = [];
      if (form.featuredCategories.trim()) {
        featuredCategories = form.featuredCategories
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });
      }

      await updateMutation.mutateAsync({
        heroTitle: form.heroTitle,
        heroSubtitle: form.heroSubtitle,
        heroDescription: form.heroDescription,
        ctaText: form.ctaText,
        ctaUrl: form.ctaUrl,
        featuredCategories,
        announcementBanner: form.announcementBanner,
      });
      toast.success('Hjemmesideinnhold oppdatert.');
    } catch {
      toast.error('Kunne ikke oppdatere hjemmesideinnhold.');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Hjemmeside CMS"
          description="Administrer innholdet på offentlige hjemmeside"
        />
        <AdminLoadingSkeleton rows={8} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Hjemmeside CMS"
          description="Administrer innholdet på offentlige hjemmeside"
        />
        <AdminErrorState onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Hjemmeside CMS"
        description="Administrer innholdet på offentlige hjemmeside"
        actions={
          <Button variant="outline" size="sm" className="bg-card" onClick={() => refetch()}>
            <RefreshCw />
            Oppdater
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        <Section title="Hero-seksjon" contentClassName="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cms-hero-title">Hero-tittel</Label>
            <Input
              id="cms-hero-title"
              value={form.heroTitle}
              onChange={handleChange('heroTitle')}
              placeholder="F.eks. Finn din neste jobb"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cms-hero-subtitle">Hero-underrubrikk</Label>
            <Input
              id="cms-hero-subtitle"
              value={form.heroSubtitle}
              onChange={handleChange('heroSubtitle')}
              placeholder="F.eks. Utforsk tusenvis av stillinger"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cms-hero-description">Hero-beskrivelse</Label>
            <Textarea
              id="cms-hero-description"
              value={form.heroDescription}
              onChange={handleChange('heroDescription')}
              placeholder="F.eks. Bli med i dag og oppdag mulighetene"
              rows={3}
            />
          </div>
        </Section>

        <Section title="CTA (Call to Action)" contentClassName="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cms-cta-text">CTA-tekst</Label>
            <Input
              id="cms-cta-text"
              value={form.ctaText}
              onChange={handleChange('ctaText')}
              placeholder="F.eks. Se ledige stillinger"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cms-cta-url">CTA-lenke</Label>
            <Input
              id="cms-cta-url"
              value={form.ctaUrl}
              onChange={handleChange('ctaUrl')}
              placeholder="F.eks. /jobs"
            />
          </div>
        </Section>

        <Section
          title="Fremhevede kategorier"
          description="Hver linje må være gyldig JSON. Én kategori per linje."
        >
          <div className="space-y-1.5">
            <Label htmlFor="cms-categories">Kategorier (én JSON per linje)</Label>
            <Textarea
              id="cms-categories"
              value={form.featuredCategories}
              onChange={handleChange('featuredCategories')}
              placeholder='{"name":"Design","slug":"design","count":42}'
              rows={4}
              className="font-mono"
            />
          </div>
        </Section>

        <Section title="Kunngjøringsbanner">
          <div className="space-y-1.5">
            <Label htmlFor="cms-banner">Bannertekst</Label>
            <Input
              id="cms-banner"
              value={form.announcementBanner}
              onChange={handleChange('announcementBanner')}
              placeholder="F.eks. Ny funksjon: Søk med AI!"
            />
          </div>
        </Section>

        <Button type="submit" size="sm" disabled={updateMutation.isPending}>
          <Save />
          {updateMutation.isPending ? 'Lagrer...' : 'Lagre innhold'}
        </Button>
      </form>
    </div>
  );
}
