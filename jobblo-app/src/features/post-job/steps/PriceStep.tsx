import React, { useEffect } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { tc } from '../../../theme/colors';
import { getPriceStats } from '../../../services/ai.service';
import type { PaymentType } from '../../../services/createJob.service';
import { DURATION_OPTIONS } from '../details';
import { usePostJobStore } from '../store';
import { StepFooter } from '../StepFooter';
import { t } from '../i18n';
import { priceProblem, totalPrice } from '../price';

const TYPES: { value: PaymentType; label: string; hint: string }[] = [
  {
    value: 'Fastpris',
    label: t('Fastpris', 'Fixed price'),
    hint: t('Én pris for hele jobben', 'One price for the whole job'),
  },
  { value: 'Timepris', label: t('Timepris', 'Hourly'), hint: t('Betal per time', 'Pay per hour') },
  {
    value: 'Anbud',
    label: t('Anbud', 'Quotes'),
    hint: t('Be om tilbud – oppgi et antatt budsjett', 'Ask for quotes – give an estimated budget'),
  },
];

const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;

/**
 * FINN step 7: price type first (Jobblo has three), then the amount, with low / median / high
 * from what similar jobs were agreed for; without enough of them, the AI's estimate.
 */
export function PriceStep() {
  const { values, ai, update, next } = usePostJobStore();
  const category = values.categories[0] ?? '';
  const timepris = values.paymentType === 'Timepris';
  const amount = timepris ? values.hourlyRate : values.price;
  const problem = priceProblem(values);

  // The AI's payment type once, while the user has typed no price.
  useEffect(() => {
    if (ai?.paymentType && !values.price && !values.hourlyRate)
      update({ paymentType: ai.paymentType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statsQuery = useQuery({
    queryKey: ['post-job', 'price-stats', category, values.countyCode],
    queryFn: () => getPriceStats(category, values.countyCode),
    enabled: Boolean(category),
    staleTime: 10 * 60 * 1000,
  });
  const stats = statsQuery.data;
  const market = !timepris && stats?.median != null;
  const chips: { label: string; value: number }[] = market
    ? [
        { label: t('Lav', 'Low'), value: stats!.low! },
        { label: t('Middels', 'Median'), value: stats!.median! },
        { label: t('Høy', 'High'), value: stats!.high! },
      ]
    : timepris
      ? ai?.hourlyRate
        ? [{ label: t('Forslag', 'Suggested'), value: ai.hourlyRate }]
        : []
      : [ai?.priceMin, ai?.suggestedPrice, ai?.priceMax]
          .map((v, i) => ({
            label: [t('Lav', 'Low'), t('Forslag', 'Suggested'), t('Høy', 'High')][i],
            value: v ?? 0,
          }))
          .filter((c) => c.value > 0);

  const setAmount = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 7);
    update(timepris ? { hourlyRate: digits } : { price: digits });
  };

  return (
    <View className="flex-1">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">
          {t('Pris', 'Price')}
        </Text>

        <View className="mt-4 flex-row rounded-xl bg-surface-2 p-1" accessibilityRole="radiogroup">
          {TYPES.map((pt) => {
            const selected = values.paymentType === pt.value;
            return (
              <Pressable
                key={pt.value}
                onPress={() => update({ paymentType: pt.value })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`h-10 flex-1 items-center justify-center rounded-lg ${selected ? 'bg-surface' : ''}`}
              >
                <Text
                  className={`text-[0.875rem] font-semibold ${selected ? 'text-ink' : 'text-muted'}`}
                >
                  {pt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="mt-2 text-[0.8125rem] text-muted">
          {TYPES.find((pt) => pt.value === values.paymentType)?.hint}
        </Text>

        <View className="mt-8 flex-row items-baseline justify-center">
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={tc('#9B9E96', 'placeholder')}
            accessibilityLabel={
              timepris
                ? t('Timepris i kroner', 'Hourly rate in kroner')
                : values.paymentType === 'Anbud'
                  ? t('Antatt budsjett i kroner', 'Estimated budget in kroner')
                  : t('Pris i kroner', 'Price in kroner')
            }
            className="min-w-[60px] text-center text-[2.75rem] font-bold text-ink"
          />
          <Text className="ml-2 text-[1.5rem] font-semibold text-ink">
            {timepris ? t('kr/t', 'kr/h') : 'kr'}
          </Text>
        </View>
        {timepris && totalPrice(values) > 0 ? (
          <Text className="mt-1 text-center text-[0.9375rem] text-muted">
            ≈ {kr(totalPrice(values))} {t('totalt', 'in total')}
          </Text>
        ) : null}
        {amount && problem ? (
          <Text className="mt-2 text-center text-[0.875rem] font-medium text-danger">
            {problem}
          </Text>
        ) : null}

        {chips.length ? (
          <View className="mt-6 items-center">
            <Text className="text-[0.8125rem] font-medium text-brand-text">
              {market
                ? `${t('Pris basert på', 'Price based on')} ${stats!.count} ${t('lignende oppdrag', 'similar jobs')}${stats!.scope === 'county' ? t(' i fylket', ' in your county') : ''}`
                : t('AI-estimat – ikke en markedspris', 'AI estimate – not a market price')}
            </Text>
            <View className="mt-2 flex-row flex-wrap justify-center gap-2">
              {chips.map((c) => (
                <Pressable
                  key={c.label}
                  onPress={() => setAmount(String(Math.round(c.value)))}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label}: ${kr(c.value)}`}
                  className="h-9 flex-row items-center gap-1 rounded-full border border-line bg-surface px-3 active:bg-surface-2"
                >
                  <Text className="text-[0.8125rem] text-muted">{c.label}:</Text>
                  <Text className="text-[0.875rem] font-semibold text-ink">{kr(c.value)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {!values.durationValue ? (
          <View className="mt-8">
            <Text className="text-[0.875rem] font-semibold text-ink">
              {t('Hvor lang tid tror du det tar?', 'How long do you think it will take?')}
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {DURATION_OPTIONS.map((d) => (
                <Pressable
                  key={d.label}
                  onPress={() => update({ durationValue: d.value, durationUnit: d.unit })}
                  accessibilityRole="button"
                  className="h-9 justify-center rounded-full border border-line bg-surface px-3 active:bg-surface-2"
                >
                  <Text className="text-[0.875rem] text-ink">{d.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <StepFooter label={t('Fortsett', 'Continue')} onPress={next} disabled={Boolean(problem)} />
    </View>
  );
}
