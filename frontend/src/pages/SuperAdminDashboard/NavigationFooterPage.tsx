import { useState, useEffect } from 'react';
import { Save, RefreshCw, Mail, Copyright } from 'lucide-react';
import {
  useNavigation,
  useUpdateNavigation,
  useFooter,
  useUpdateFooter,
} from '../../hooks/admin/content';
import { AdminPageHeader, AdminLoadingSkeleton, AdminErrorState } from '../../components/admin';
import { toast } from 'react-hot-toast';
import { Section } from '../../components/developer/kit';
import { Button } from '../../components/developer/ui/button';
import { Input } from '../../components/developer/ui/input';
import { Label } from '../../components/developer/ui/label';
import { Textarea } from '../../components/developer/ui/textarea';

const parseLines = (str: string): { label: string; url: string }[] =>
  str
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [label = '', url = ''] = line.split('|').map((s) => s.trim());
      return { label, url };
    });

const formatLines = (items: { label?: string; url?: string }[]): string =>
  items?.map((i) => `${i.label || ''} | ${i.url || ''}`).join('\n') || '';

export default function NavigationFooterPage() {
  const {
    data: navData,
    isLoading: navLoading,
    isError: navError,
    refetch: refetchNav,
  } = useNavigation();
  const {
    data: footerData,
    isLoading: footerLoading,
    isError: footerError,
    refetch: refetchFooter,
  } = useFooter();
  const updateNavMutation = useUpdateNavigation();
  const updateFooterMutation = useUpdateFooter();

  const [navForm, setNavForm] = useState({
    headerLinks: '',
    footerLinks: '',
    socialLinks: '',
  });

  const [footerForm, setFooterForm] = useState({
    contactEmail: '',
    supportEmail: '',
    copyrightText: '',
    aboutText: '',
  });

  useEffect(() => {
    if (navData) {
      setNavForm({
        headerLinks: formatLines((navData.headerLinks as { label?: string; url?: string }[]) ?? []),
        footerLinks: formatLines((navData.footerLinks as { label?: string; url?: string }[]) ?? []),
        socialLinks: formatLines((navData.socialLinks as { label?: string; url?: string }[]) ?? []),
      });
    }
  }, [navData]);

  useEffect(() => {
    if (footerData) {
      setFooterForm({
        contactEmail: (footerData.contactEmail as string) ?? '',
        supportEmail: (footerData.supportEmail as string) ?? '',
        copyrightText: (footerData.copyrightText as string) ?? '',
        aboutText: (footerData.aboutText as string) ?? '',
      });
    }
  }, [footerData]);

  const handleNavChange = (field: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNavForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleFooterChange =
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFooterForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSaveNav = async () => {
    try {
      await updateNavMutation.mutateAsync({
        headerLinks: parseLines(navForm.headerLinks),
        footerLinks: parseLines(navForm.footerLinks),
        socialLinks: parseLines(navForm.socialLinks),
      });
      toast.success('Navigasjon oppdatert.');
    } catch {
      toast.error('Kunne ikke oppdatere navigasjon.');
    }
  };

  const handleSaveFooter = async () => {
    try {
      await updateFooterMutation.mutateAsync({
        contactEmail: footerForm.contactEmail,
        supportEmail: footerForm.supportEmail,
        copyrightText: footerForm.copyrightText,
        aboutText: footerForm.aboutText,
      });
      toast.success('Footer oppdatert.');
    } catch {
      toast.error('Kunne ikke oppdatere footer.');
    }
  };

  const isLoading = navLoading || footerLoading;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Navigasjon & Footer"
          description="Administrer navigasjonslenker og footer-innhold"
        />
        <AdminLoadingSkeleton rows={8} />
      </div>
    );
  }

  if (navError || footerError) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title="Navigasjon & Footer"
          description="Administrer navigasjonslenker og footer-innhold"
        />
        <AdminErrorState
          onRetry={() => {
            refetchNav();
            refetchFooter();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Navigasjon & Footer"
        description="Administrer navigasjonslenker og footer-innhold"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="bg-card"
            onClick={() => {
              refetchNav();
              refetchFooter();
            }}
          >
            <RefreshCw />
            Oppdater
          </Button>
        }
      />

      <Section
        title="Navigasjon"
        contentClassName="space-y-4"
        action={
          <Button size="sm" onClick={handleSaveNav} disabled={updateNavMutation.isPending}>
            <Save />
            {updateNavMutation.isPending ? 'Lagrer...' : 'Lagre navigasjon'}
          </Button>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="nav-header-links">Header-lenker (én per linje: Tittel | /url)</Label>
          <Textarea
            id="nav-header-links"
            value={navForm.headerLinks}
            onChange={handleNavChange('headerLinks')}
            placeholder="Stillinger | /jobs&#10;Tjenester | /services&#10;Om oss | /about"
            rows={4}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nav-footer-links">Footer-lenker (én per linje: Tittel | /url)</Label>
          <Textarea
            id="nav-footer-links"
            value={navForm.footerLinks}
            onChange={handleNavChange('footerLinks')}
            placeholder="Personvern | /privacy&#10;Vilkår | /terms&#10;Kontakt | /contact"
            rows={4}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nav-social-links">
            Sosiale medier (én per linje: Platform | https://...)
          </Label>
          <Textarea
            id="nav-social-links"
            value={navForm.socialLinks}
            onChange={handleNavChange('socialLinks')}
            placeholder="Facebook | https://facebook.com/..."
            rows={3}
            className="font-mono"
          />
        </div>
      </Section>

      <Section
        title="Footer"
        contentClassName="space-y-4"
        action={
          <Button size="sm" onClick={handleSaveFooter} disabled={updateFooterMutation.isPending}>
            <Save />
            {updateFooterMutation.isPending ? 'Lagrer...' : 'Lagre footer'}
          </Button>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="footer-contact-email">Kontakt-e-post</Label>
          <div className="relative">
            <Mail className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="footer-contact-email"
              value={footerForm.contactEmail}
              onChange={handleFooterChange('contactEmail')}
              placeholder="kontakt@example.no"
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="footer-support-email">Support-e-post</Label>
          <div className="relative">
            <Mail className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="footer-support-email"
              value={footerForm.supportEmail}
              onChange={handleFooterChange('supportEmail')}
              placeholder="support@example.no"
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="footer-copyright">Copyright-tekst</Label>
          <div className="relative">
            <Copyright className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="footer-copyright"
              value={footerForm.copyrightText}
              onChange={handleFooterChange('copyrightText')}
              placeholder="© 2026 Jobblo. Alle rettigheter reservert."
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="footer-about">Om-tekst</Label>
          <Textarea
            id="footer-about"
            value={footerForm.aboutText}
            onChange={handleFooterChange('aboutText')}
            placeholder="Jobblo er Norges ledende jobbplattform..."
            rows={4}
          />
        </div>
      </Section>
    </div>
  );
}
