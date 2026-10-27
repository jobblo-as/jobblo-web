import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react-native';
import { TC, tc } from '../../../theme/colors';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useCategories } from '../../../hooks/useCategories';
import { suggestCategories } from '../../../services/ai.service';
import { usePostJobStore } from '../store';
import { isLocalPhoto } from '../flow';
import { useAiConsent } from '../aiConsent';
import { StepFooter } from '../StepFooter';
import { t } from '../i18n';

/**
 * FINN step 4: AI suggests 3 categories from the photos (or, without photos, from a short
 * text); the user taps one, or "Velg en annen kategori" for the full list.
 */
export function CategoryStep() {
  const photos = usePostJobStore((s) => s.photos);
  const category = usePostJobStore((s) => s.values.categories[0] ?? '');
  const update = usePostJobStore((s) => s.update);
  // The detail questions depend on the category: answers to another category's questions go.
  const setCategory = (name: string) => {
    if (name !== category) usePostJobStore.setState({ answers: {} });
    update({ categories: [name] });
  };
  const summary = usePostJobStore((s) => s.summary);
  const setSummary = usePostJobStore((s) => s.setSummary);
  const next = usePostJobStore((s) => s.next);
  const categoriesQuery = useCategories();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Without photos the text is sent when asked, not on every keystroke.
  const [askedText, setAskedText] = useState(photos.length ? '' : summary.trim());

  const aiOn = useAiConsent((s) => s.value === true);
  const sendPhotos = photos.filter(isLocalPhoto).slice(0, 3);
  const suggestionsQuery = useQuery({
    queryKey: ['post-job', 'categories', sendPhotos.map((p) => p.uri), askedText],
    queryFn: () => suggestCategories(sendPhotos, askedText),
    enabled: aiOn && (sendPhotos.length > 0 || askedText.length > 0),
    staleTime: Infinity, // same photos/text, same answer: going back and forth costs no AI call
    retry: false,
  });

  const allNames = useMemo(
    () => (categoriesQuery.data?.categories ?? []).map((c) => c.name),
    [categoriesQuery.data]
  );
  const suggestions = suggestionsQuery.data ?? [];
  // A category picked from the full list shows on top, so the choice is visible.
  const rows =
    category && !suggestions.includes(category) ? [category, ...suggestions] : suggestions;
  const filtered = allNames.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <View className="flex-1">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">
          {t('Hva slags jobb er det?', 'What kind of job is it?')}
        </Text>

        {photos.length === 0 && aiOn ? (
          <View className="mt-4">
            <Text className="text-[0.9375rem] leading-6 text-muted">
              {t(
                'Beskriv kort hva som skal gjøres, så foreslår vi en kategori.',
                'Briefly describe what needs doing, and we will suggest a category.'
              )}
            </Text>
            <TextInput
              value={summary}
              onChangeText={setSummary}
              placeholder={t(
                'F.eks. male to vegger i stua',
                'E.g. paint two walls in the living room'
              )}
              placeholderTextColor={tc('#9B9E96', 'placeholder')}
              multiline
              maxLength={300}
              accessibilityLabel={t('Kort beskrivelse av jobben', 'Short description of the job')}
              className="mt-3 min-h-[88px] rounded-xl border border-line bg-surface px-4 py-3 text-[1.0625rem] leading-6 text-ink"
              style={{ textAlignVertical: 'top' }}
            />
            <Pressable
              onPress={() => setAskedText(summary.trim())}
              disabled={summary.trim().length < 3 || summary.trim() === askedText}
              accessibilityRole="button"
              className={`mt-3 h-11 flex-row items-center justify-center gap-2 self-start rounded-full bg-tint px-4 ${summary.trim().length < 3 || summary.trim() === askedText ? 'opacity-50' : ''}`}
            >
              <Sparkles size={16} color={TC.brandText} />
              <Text className="text-[0.875rem] font-semibold text-brand-text">
                {t('Foreslå kategori', 'Suggest category')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {suggestionsQuery.isFetching ? (
          <View className="mt-6 flex-row items-center gap-3">
            <ActivityIndicator color={TC.brandText} />
            <Text className="text-[0.9375rem] text-muted">
              {photos.length
                ? t('AI ser på bildene…', 'AI is looking at the photos…')
                : t('AI leser beskrivelsen…', 'AI is reading the description…')}
            </Text>
          </View>
        ) : null}

        {suggestionsQuery.isError ? (
          <Text className="mt-6 text-[0.9375rem] leading-6 text-muted">
            {t(
              'Vi fikk ikke hentet forslag akkurat nå. Velg kategori selv nedenfor.',
              'We could not get suggestions right now. Choose a category yourself below.'
            )}
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <View className="mt-6">
            <Text className="mb-2 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
              {t('Forslag', 'Suggestions')}
            </Text>
            <View className="gap-2">
              {rows.map((name) => {
                const selected = name === category;
                return (
                  <Pressable
                    key={name}
                    onPress={() => setCategory(name)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className={`h-14 flex-row items-center gap-3 rounded-xl border px-4 ${selected ? 'border-brand bg-tint' : 'border-line bg-surface'}`}
                  >
                    <View
                      className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-brand bg-brand' : 'border-line'}`}
                    >
                      {selected ? <View className="h-2 w-2 rounded-full bg-white" /> : null}
                    </View>
                    <Text className="flex-1 text-[1.0625rem] font-medium text-ink">{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : suggestionsQuery.isSuccess && !suggestionsQuery.isFetching ? (
          <Text className="mt-6 text-[0.9375rem] leading-6 text-muted">
            {t(
              'Ingen forslag passet. Velg kategori selv nedenfor.',
              'No suggestion fitted. Choose a category yourself below.'
            )}
          </Text>
        ) : null}

        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          className="mt-5 h-11 items-center justify-center"
        >
          <Text className="text-[0.9375rem] font-semibold text-brand-text">
            {t('Velg en annen kategori', 'Choose another category')}
          </Text>
        </Pressable>
      </ScrollView>

      <StepFooter label={t('Fortsett', 'Continue')} onPress={next} disabled={!category} />

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('Alle kategorier', 'All categories')}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('Søk i kategorier', 'Search categories')}
          showClear
        />
        <View className="mt-3">
          {categoriesQuery.isLoading ? <ActivityIndicator color={TC.brandText} /> : null}
          {filtered.map((name) => (
            <Pressable
              key={name}
              onPress={() => {
                setCategory(name);
                setPickerOpen(false);
                setSearch('');
              }}
              accessibilityRole="button"
              className="h-12 flex-row items-center justify-between rounded-lg px-2 active:bg-surface-2"
            >
              <Text className="text-[1.0625rem] text-ink">{name}</Text>
              {name === category ? <Check size={18} color={TC.brandText} /> : null}
            </Pressable>
          ))}
          {!categoriesQuery.isLoading && filtered.length === 0 ? (
            <Text className="py-3 text-[0.9375rem] text-muted">
              {t('Fant ingen kategori med det navnet.', 'No category with that name.')}
            </Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}
