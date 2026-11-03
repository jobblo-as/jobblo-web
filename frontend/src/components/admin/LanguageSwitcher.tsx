import { useTranslate } from '../../i18n/useTranslate';
import { locales, localeLabels } from '../../i18n/types';
import type { SupportedLocale } from '../../i18n/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../developer/ui/select';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslate();

  return (
    <Select value={locale} onValueChange={(v) => setLocale(v as SupportedLocale)}>
      <SelectTrigger size="sm" className="w-28 bg-card" aria-label={t('language.bytt_sprak')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {localeLabels[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
