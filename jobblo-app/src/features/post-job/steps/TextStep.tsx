import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react-native';
import { TC, tc } from '../../../theme/colors';
import { writeListing } from '../../../services/ai.service';
import { DURATION_OPTIONS, EQUIPMENT_OPTIONS, describeForAi } from '../details';
import { photosForText } from '../flow';
import { usePostJobStore } from '../store';
import { useAiConsent } from '../aiConsent';
import { StepFooter } from '../StepFooter';
import { LANG, t } from '../i18n';

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 2000;

/** Same limits as createJobValidation (step 1) and the server. */
export function textErrors(title: string, description: string) {
  const ti = title.trim();
  const de = description.trim();
  return {
    title: !ti ? t('Skriv en tittel.', 'Write a title.') : ti.length < 5 ? t('Tittelen må være minst 5 tegn.', 'The title must be at least 5 characters.') : '',
    description: !de ? t('Skriv en beskrivelse.', 'Write a description.') : de.length < 20 ? t('Beskrivelsen må være minst 20 tegn.', 'The description must be at least 20 characters.') : '',
  };
}

/**
 * FINN step 6: AI writes the title and description from the photos (and what the camera AI helper
 * saw in each), the category and the details; both stay editable. Fills itself in on arrival.
 */
export function TextStep() {
  const { values, photos, summary, answers, photoNotes, photoQuality, update, setAi, next } = usePostJobStore();
  // Same verdict as the camera AI helper: a photo it asked to retake is not written about.
  const { use: textPhotos, skipped } = photosForText(photos, photoQuality);
  const [showErrors, setShowErrors] = useState(false);
  const errors = textErrors(values.title, values.description);
  const hasText = Boolean(values.title.trim() || values.description.trim());
  const consent = useAiConsent();
  const aiOn = consent.value === true;

  const write = useMutation({
    mutationFn: () =>
      writeListing(
        textPhotos,
        describeForAi({
          summary,
          category: values.categories[0] ?? '',
          answers,
          durationLabel: DURATION_OPTIONS.find((d) => d.value === values.durationValue && d.unit === values.durationUnit)?.label,
          equipmentLabel: answers.equipment ? EQUIPMENT_OPTIONS.find((e) => e.value === values.equipment)?.label : undefined,
          photoCount: textPhotos.length,
          photoNotes: textPhotos.map((p) => photoNotes[p.uri]),
        }),
        {
          category: values.categories[0],
          equipment: values.equipment,
          urgent: values.urgent,
          duration: values.durationValue ? { value: values.durationValue, unit: values.durationUnit } : undefined,
          lang: LANG,
        }
      ),
    onSuccess: (draft) => {
      update({
        title: draft.title.slice(0, TITLE_MAX),
        description: draft.description.slice(0, DESCRIPTION_MAX),
        // The AI's time estimate only when the user gave none on the details screen.
        ...(!values.durationValue && draft.duration?.value ? { durationValue: String(draft.duration.value), durationUnit: draft.duration.unit } : {}),
      });
      setAi({ paymentType: draft.paymentType, suggestedPrice: draft.suggestedPrice, priceMin: draft.priceMin, priceMax: draft.priceMax, hourlyRate: draft.hourlyRate });
    },
  });

  // Auto-fill once, only when both fields are empty: never overwrites what the user wrote.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || hasText || !aiOn) return;
    autoStarted.current = true;
    write.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const proceed = () => {
    if (errors.title || errors.description) return setShowErrors(true);
    next();
  };

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">{t('Tittel og beskrivelse', 'Title and description')}</Text>

        {aiOn ? (
        <>
        <Pressable
          onPress={() => write.mutate()}
          disabled={write.isPending}
          accessibilityRole="button"
          className={`mt-4 flex-row items-center justify-center gap-2 rounded-full ${hasText ? 'h-11 self-start border border-line bg-surface px-4' : 'h-12 bg-brand'} ${write.isPending ? 'opacity-70' : ''}`}
        >
          {write.isPending ? (
            <ActivityIndicator color={hasText ? TC.brandText : '#FFFFFF'} />
          ) : hasText ? (
            <RefreshCw size={16} color={TC.brandText} />
          ) : (
            <Sparkles size={18} color="#FFFFFF" />
          )}
          <Text className={`font-semibold ${hasText ? 'text-[0.875rem] text-brand-text' : 'text-[0.9375rem] text-white'}`}>
            {write.isPending ? t('Skriver…', 'Writing…') : hasText ? t('Skriv på nytt med AI', 'Rewrite with AI') : t('Generer tittel og beskrivelse', 'Generate title and description')}
          </Text>
        </Pressable>
        <Text className="mt-2 text-[0.8125rem] leading-5 text-muted">
          {textPhotos.length ? t('AI bruker bildene, kategorien og detaljene dine.', 'AI uses your photos, category and details.') : t('AI bruker beskrivelsen, kategorien og detaljene dine.', 'AI uses your description, category and details.')} {t('Du kan endre alt.', 'You can change everything.')}
        </Text>
        {skipped ? (
          <Text className="mt-1 text-[0.8125rem] leading-5 text-[#B7791F]">
            {skipped === 1
              ? t('1 bilde ble ikke brukt fordi AI-hjelperen ba om et nytt.', '1 photo was not used because the AI helper asked for a new one.')
              : t(`${skipped} bilder ble ikke brukt fordi AI-hjelperen ba om nye.`, `${skipped} photos were not used because the AI helper asked for new ones.`)}
          </Text>
        ) : null}
        {write.isError ? (
          <Text className="mt-2 text-[0.875rem] font-medium text-danger">{t('AI fikk ikke skrevet annonsen akkurat nå. Skriv selv, eller prøv igjen.', 'AI could not write the listing right now. Write it yourself, or try again.')}</Text>
        ) : null}
        </>
        ) : (
          <Text className="mt-2 text-[0.9375rem] leading-6 text-muted">{t('Skriv en tittel og en beskrivelse av jobben.', 'Write a title and a description of the job.')}</Text>
        )}
        {/* Change the AI answer given before the camera (App Store 5.1.2(i)). */}
        <Pressable onPress={() => consent.set(!aiOn)} accessibilityRole="button" hitSlop={8} className="mt-2 self-start">
          <Text className="text-[0.8125rem] font-semibold text-brand-text underline">
            {aiOn
              ? t('Slå av AI-hjelperen', 'Turn the AI helper off')
              : t('Slå på AI-hjelperen (bildene og svarene sendes til OpenAI)', 'Turn the AI helper on (photos and answers are sent to OpenAI)')}
          </Text>
        </Pressable>

        <Text className="mt-6 text-[0.875rem] font-semibold text-ink">{t('Tittel', 'Title')}</Text>
        <TextInput
          value={values.title}
          onChangeText={(title) => update({ title: title.slice(0, TITLE_MAX) })}
          placeholder={t('F.eks. Male to vegger i stua', 'E.g. Paint two walls in the living room')}
          placeholderTextColor={tc('#9B9E96', 'placeholder')}
          maxLength={TITLE_MAX}
          accessibilityLabel={t('Tittel', 'Title')}
          className="mt-2 h-12 rounded-xl border border-line bg-surface px-4 text-[1.0625rem] text-ink"
        />
        <View className="mt-1 flex-row justify-between">
          <Text className="text-[0.8125rem] font-medium text-danger">{showErrors ? errors.title : ''}</Text>
          <Text className="text-[0.8125rem] text-muted">{values.title.length}/{TITLE_MAX}</Text>
        </View>

        <Text className="mt-4 text-[0.875rem] font-semibold text-ink">{t('Beskrivelse', 'Description')}</Text>
        <TextInput
          value={values.description}
          onChangeText={(description) => update({ description: description.slice(0, DESCRIPTION_MAX) })}
          placeholder={t('Hva skal gjøres, hvor stort er det, og er det noe fagfolk bør vite?', 'What needs doing, how big is it, and is there anything pros should know?')}
          placeholderTextColor={tc('#9B9E96', 'placeholder')}
          multiline
          maxLength={DESCRIPTION_MAX}
          accessibilityLabel={t('Beskrivelse', 'Description')}
          className="mt-2 min-h-[180px] rounded-xl border border-line bg-surface px-4 py-3 text-[1.0625rem] leading-6 text-ink"
          style={{ textAlignVertical: 'top' }}
        />
        <View className="mt-1 flex-row justify-between">
          <Text className="text-[0.8125rem] font-medium text-danger">{showErrors ? errors.description : ''}</Text>
          <Text className="text-[0.8125rem] text-muted">{values.description.length}/{DESCRIPTION_MAX}</Text>
        </View>
      </ScrollView>

      <StepFooter label={t('Fortsett', 'Continue')} onPress={proceed} />
    </View>
  );
}
