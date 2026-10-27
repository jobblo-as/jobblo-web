import React, { useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronRight, Eye, MapPin, X, Zap } from 'lucide-react-native';
import { TC, tc } from '../../../theme/colors';
import { useAuthStore } from '../../../store/authStore';
import { MEMBERSHIP_ENABLED } from '../../../config/features';
import { useCreateJobMutation, useUpdateJobMutation } from '../../../hooks/useCreateJob';
import { validateCreateJobStep } from '../../../utils/createJobValidation';
import { DURATION_OPTIONS, EQUIPMENT_OPTIONS, questionsFor } from '../details';
import { editChanges, type PostJobStep } from '../flow';
import { totalPrice } from '../price';
import { usePostJobStore } from '../store';
import { DATE_LOCALE, t } from '../i18n';

/** English for the shared (Norwegian) validator's messages, by field. */
const PROBLEM_EN: Record<string, string> = {
  title: 'The title must be 5–70 characters.',
  description: 'The description must be 20–2000 characters.',
  categories: 'Choose a category.',
  address: 'Choose the address from the suggestions.',
  coordinates: 'Choose the address from the suggestions.',
  fromDate: 'Choose a start date from today or later.',
  toDate: 'The end date cannot be before the start date.',
  durationValue: 'Choose how long the job takes.',
  price: 'Enter a price above 0 kr.',
};

const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;
const dateLabel = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return y
    ? new Date(y, m - 1, d).toLocaleDateString(DATE_LOCALE, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
};

function errorMessage(error: unknown) {
  const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response
    ?.data;
  return data?.error || data?.message || null;
}

/**
 * FINN step 8 + 9: every answer on one page, tap a row to change it, problems listed at the
 * bottom; then preview (the job as applicants see it) and publish.
 */
export function ReviewStep({ onSaved }: { onSaved: () => void }) {
  // For the preview Modal: an iOS Modal's own SafeAreaView gets no insets (see CameraStep).
  const insets = useSafeAreaInsets();
  const { values, photos, answers, update, goTo, setPublished, editId, existingImages } =
    usePostJobStore();
  const user = useAuthStore((s) => s.user);
  const createMutation = useCreateJobMutation();
  const updateMutation = useUpdateJobMutation();
  const saving = createMutation.isPending || updateMutation.isPending;
  const [preview, setPreview] = useState(false);
  const { width } = useWindowDimensions();
  const paid = typeof user?.subscription === 'string' && user.subscription !== 'Standard';

  const category = values.categories[0] ?? '';
  const detailTags = questionsFor(category)
    .map((q) => answers[q.key])
    .filter(Boolean) as string[];
  const duration =
    DURATION_OPTIONS.find((d) => d.value === values.durationValue && d.unit === values.durationUnit)
      ?.label ??
    (values.durationValue
      ? `${values.durationValue} ${values.durationUnit === 'days' ? t('dager', 'days') : values.durationUnit === 'minutes' ? 'min' : t('timer', 'hours')}`
      : '');
  const equipment = EQUIPMENT_OPTIONS.find((e) => e.value === values.equipment)?.label ?? '';
  const total = totalPrice(values);
  const priceText =
    values.paymentType === 'Timepris'
      ? `${kr(Number(values.hourlyRate) || 0)}${t('/t', '/h')} · ≈ ${kr(total)}`
      : `${kr(total)}${values.paymentType === 'Anbud' ? t(' (antatt budsjett)', ' (estimated budget)') : ''}`;

  // The same rules the old form and the server use.
  const input = { values, imageCount: photos.length, phone: '', displayedPrice: total };
  const problems: { text: string; step: PostJobStep }[] = [
    ...Object.entries(validateCreateJobStep(2, input)).map(([key, text]) => ({
      text: t(text as string, PROBLEM_EN[key] ?? (text as string)),
      step: (key === 'categories' ? 'category' : 'text') as PostJobStep,
    })),
    ...Object.entries(validateCreateJobStep(3, input)).map(([key, text]) => ({
      text: t(text as string, PROBLEM_EN[key] ?? (text as string)),
      step: (key === 'price' || key === 'durationValue' ? 'price' : 'place') as PostJobStep,
    })),
  ];

  const rows: { label: string; value: string; step: PostJobStep }[] = [
    { label: t('Kategori', 'Category'), value: category, step: 'category' },
    {
      label: t('Detaljer', 'Details'),
      value: [...detailTags, duration, equipment].filter(Boolean).join(' · '),
      step: 'details',
    },
    { label: t('Tittel', 'Title'), value: values.title, step: 'text' },
    { label: t('Beskrivelse', 'Description'), value: values.description, step: 'text' },
    { label: t('Pris', 'Price'), value: priceText, step: 'price' },
    {
      label: t('Sted', 'Place'),
      value: values.address
        ? `${values.address}, ${[values.postalCode, values.city].filter(Boolean).join(' ')}`
        : '',
      step: 'place',
    },
    {
      label: t('Når', 'When'),
      value: values.fromDate
        ? `${dateLabel(values.fromDate)}${values.toDate ? ` – ${dateLabel(values.toDate)}` : t(' · fleksibel', ' · flexible')}`
        : '',
      step: 'place',
    },
  ];

  const publish = () => {
    if (problems.length || saving) return;
    const job = {
      ...values,
      tags: [...new Set([...values.tags, ...detailTags])],
      urgent: values.urgent && paid,
    };
    if (editId) {
      const { upload, imagesToDelete } = editChanges(photos, existingImages);
      updateMutation.mutate(
        { serviceId: editId, values: job, images: upload, imagesToDelete },
        {
          onSuccess: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
              () => undefined
            );
            onSaved();
          },
          onError: (error) =>
            Alert.alert(
              t('Kunne ikke lagre', 'Could not save'),
              errorMessage(error) ??
                t(
                  'Prøv igjen. Endringene dine er tatt vare på.',
                  'Try again. Your changes are kept.'
                )
            ),
        }
      );
      return;
    }
    createMutation.mutate(
      { values: job, images: photos },
      {
        onSuccess: (created) => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined
          );
          setPublished(created._id);
        },
        onError: (error) =>
          Alert.alert(
            t('Kunne ikke publisere', 'Could not publish'),
            errorMessage(error) ??
              t('Prøv igjen. Svarene dine er tatt vare på.', 'Try again. Your answers are kept.')
          ),
      }
    );
  };

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">
          {editId
            ? t('Rediger annonsen', 'Edit your listing')
            : t('Se over annonsen', 'Review your listing')}
        </Text>
        <Text className="mt-1 text-[0.9375rem] leading-6 text-muted">
          {t('Trykk på en linje for å endre den.', 'Tap a row to change it.')}
        </Text>

        <Pressable
          onPress={() => goTo(photos.length ? 'photoGrid' : 'photos')}
          accessibilityRole="button"
          accessibilityLabel={`${t('Bilder', 'Photos')}: ${photos.length}. ${t('Endre', 'Change')}`}
          className="mt-4"
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
            scrollEnabled={photos.length > 3}
          >
            {photos.map((p, i) => (
              <Image
                key={p.uri}
                source={{ uri: p.uri }}
                style={{ width: 88, height: 88, borderRadius: 10 }}
                accessibilityLabel={`${t('Bilde', 'Photo')} ${i + 1}`}
              />
            ))}
            <View className="h-[88px] w-[88px] items-center justify-center rounded-[10px] border border-dashed border-line bg-surface">
              <Text className="text-center text-[0.8125rem] font-semibold text-brand-text">
                {photos.length
                  ? t('Endre bilder', 'Change photos')
                  : t('Legg til bilder', 'Add photos')}
              </Text>
            </View>
          </ScrollView>
        </Pressable>

        <View className="mt-4 overflow-hidden rounded-xl bg-surface">
          {rows.map((row, i) => (
            <Pressable
              key={row.label}
              onPress={() => goTo(row.step)}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}: ${row.value || t('mangler', 'missing')}. ${t('Endre', 'Change')}`}
              className={`flex-row items-center gap-3 px-4 py-3 active:bg-surface-2 ${i ? 'border-t border-line' : ''}`}
            >
              <View className="flex-1">
                <Text className="text-[0.8125rem] text-muted">{row.label}</Text>
                <Text
                  className={`mt-0.5 text-[1.0625rem] ${row.value ? 'text-ink' : 'text-danger'}`}
                  numberOfLines={i === 3 ? 3 : 2}
                >
                  {row.value || t('Mangler', 'Missing')}
                </Text>
              </View>
              <ChevronRight size={18} color={tc('#9B9E96', 'subtle')} />
            </Pressable>
          ))}
        </View>

        {/* Haster is a paid-plan feature. Where plans cannot be bought in the app (iOS, and builds with
            membership off: App Store 3.1.1) a free account is not shown a feature it cannot buy here. */}
        {paid || MEMBERSHIP_ENABLED ? (
          <Pressable
            onPress={() =>
              paid
                ? update({ urgent: !values.urgent })
                : Alert.alert(
                    t('Haster', 'Urgent'),
                    t(
                      'Haster er kun tilgjengelig for betalte abonnementer.',
                      'Urgent is only available on paid plans.'
                    )
                  )
            }
            className="mt-4 flex-row items-center gap-3 rounded-xl border border-line bg-surface p-3"
          >
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-warn-tint">
              <Zap size={16} color="#B7791F" />
            </View>
            <View className="flex-1">
              <Text className="text-[0.9375rem] font-semibold text-ink">
                {t('Haster oppdraget?', 'Is the job urgent?')}
              </Text>
              <Text className="text-[0.8125rem] text-muted">
                {paid
                  ? t(
                      'Merkes med «Haster» og løftes høyere i søket.',
                      'Marked as urgent and shown higher in search.'
                    )
                  : t('For betalte abonnementer.', 'For paid plans.')}
              </Text>
            </View>
            <Switch
              value={values.urgent && paid}
              onValueChange={(v) =>
                paid
                  ? update({ urgent: v })
                  : Alert.alert(
                      t('Haster', 'Urgent'),
                      t(
                        'Haster er kun tilgjengelig for betalte abonnementer.',
                        'Urgent is only available on paid plans.'
                      )
                    )
              }
              trackColor={{ true: TC.brandText, false: '#D9DBD3' }}
            />
          </Pressable>
        ) : null}

        {problems.length ? (
          <View className="mt-5 rounded-xl border border-danger-line bg-danger-tint p-4">
            <Text className="text-[0.9375rem] font-semibold text-danger">
              {editId
                ? t('Rett opp før du lagrer:', 'Fix before you save:')
                : t('Rett opp før du publiserer:', 'Fix before you publish:')}
            </Text>
            {problems.map((p) => (
              <Pressable
                key={p.text}
                onPress={() => goTo(p.step)}
                accessibilityRole="button"
                className="mt-2"
              >
                <Text className="text-[0.9375rem] leading-6 text-danger underline">• {p.text}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View className="flex-row gap-2 border-t border-line bg-page px-4 py-3">
        <Pressable
          onPress={() => setPreview(true)}
          accessibilityRole="button"
          className="h-12 flex-row items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4"
        >
          <Eye size={16} color={TC.ink} />
          <Text className="text-[0.9375rem] font-semibold text-ink">
            {t('Forhåndsvis', 'Preview')}
          </Text>
        </Pressable>
        <Pressable
          onPress={publish}
          disabled={Boolean(problems.length) || saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(problems.length) || saving }}
          className={`h-12 flex-1 items-center justify-center rounded-full bg-brand ${problems.length || saving ? 'opacity-50' : ''}`}
        >
          <Text className="text-[0.9375rem] font-semibold text-white">
            {editId
              ? saving
                ? t('Lagrer…', 'Saving…')
                : t('Lagre endringer', 'Save changes')
              : saving
                ? t('Publiserer…', 'Publishing…')
                : t('Publiser oppdraget', 'Publish job')}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={preview}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreview(false)}
      >
        <View
          className="flex-1 bg-page"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="h-12 flex-row items-center px-2">
            <Pressable
              onPress={() => setPreview(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('Lukk forhåndsvisning', 'Close preview')}
              className="h-11 w-11 items-center justify-center"
            >
              <X size={22} color={TC.ink} />
            </Pressable>
            <Text className="flex-1 text-center text-[1.0625rem] font-semibold text-ink">
              {t('Forhåndsvisning', 'Preview')}
            </Text>
            <View className="w-11" />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
            {photos.length ? (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {photos.map((p) => (
                  <Image
                    key={p.uri}
                    source={{ uri: p.uri }}
                    style={{ width, height: Math.round(width * 0.72) }}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            ) : null}
            <View className="px-4 pt-4">
              {values.urgent && paid ? (
                <View className="mb-2 self-start rounded-full bg-warn-tint px-2.5 py-1">
                  <Text className="text-[0.8125rem] font-semibold text-ink">
                    {t('Haster', 'Urgent')}
                  </Text>
                </View>
              ) : null}
              <Text className="text-[1.5rem] font-bold leading-tight text-ink">
                {values.title || t('Tittel mangler', 'Title missing')}
              </Text>
              <Text className="mt-2 text-[1.25rem] font-bold text-ink">
                {values.paymentType === 'Timepris'
                  ? `${kr(Number(values.hourlyRate) || 0)}${t('/t', '/h')}`
                  : kr(total)}
              </Text>
              <Text className="text-[0.875rem] text-muted">
                {values.paymentType === 'Anbud'
                  ? t('Anbud · antatt budsjett', 'Quotes · estimated budget')
                  : values.paymentType === 'Timepris'
                    ? t('Timepris', 'Hourly')
                    : t('Fastpris', 'Fixed price')}
              </Text>
              <View className="mt-4 h-12 items-center justify-center rounded-full bg-brand opacity-60">
                <Text className="text-[0.9375rem] font-semibold text-white">
                  {t('Søk på oppdraget', 'Apply for the job')}
                </Text>
              </View>
              <View className="mt-5 gap-1.5">
                {[
                  [t('Kategori', 'Category'), category],
                  [t('Tid', 'Time'), duration],
                  [t('Utstyr', 'Equipment'), equipment],
                  [t('Når', 'When'), rows[6].value],
                ].map(([k, v]) =>
                  v ? (
                    <View key={k} className="flex-row">
                      <Text className="w-24 text-[0.9375rem] text-muted">{k}</Text>
                      <Text className="flex-1 text-[0.9375rem] text-ink">{v}</Text>
                    </View>
                  ) : null
                )}
              </View>
              <Text className="mt-6 text-[1.125rem] font-bold text-ink">
                {t('Beskrivelse', 'Description')}
              </Text>
              <Text className="mt-2 text-[1.0625rem] leading-6 text-ink">
                {values.description || '—'}
              </Text>
              {detailTags.length ? (
                <View className="mt-4 flex-row flex-wrap gap-2">
                  {detailTags.map((t) => (
                    <View key={t} className="rounded-full bg-surface-2 px-3 py-1">
                      <Text className="text-[0.8125rem] text-ink">{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {values.city ? (
                <View className="mt-5 flex-row items-center gap-1.5">
                  <MapPin size={16} color={tc('#63665F', 'muted')} />
                  <Text className="text-[0.9375rem] text-muted">{values.city}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
