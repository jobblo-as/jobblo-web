import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ChevronRight, PartyPopper } from 'lucide-react-native';
import { TC, tc } from '../../../theme/colors';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { DURATION_OPTIONS, EQUIPMENT_OPTIONS, questionsFor } from '../details';
import { usePostJobStore } from '../store';
import { StepFooter } from '../StepFooter';
import { t } from '../i18n';

interface Row {
  key: string;
  label: string;
  value: string;
  options: string[];
  onPick: (option: string) => void;
}

/**
 * FINN step 5: details that depend on the category, each picked in a bottom sheet. All optional
 * ("Neste" skips); the answers feed the AI text and become tags on the job.
 */
export function DetailsStep() {
  const values = usePostJobStore((s) => s.values);
  const answers = usePostJobStore((s) => s.answers);
  const setAnswer = usePostJobStore((s) => s.setAnswer);
  const update = usePostJobStore((s) => s.update);
  const next = usePostJobStore((s) => s.next);
  const [open, setOpen] = useState<string | null>(null);
  const category = values.categories[0] ?? '';

  const durationLabel = DURATION_OPTIONS.find((d) => d.value === values.durationValue && d.unit === values.durationUnit)?.label ?? '';
  const rows: Row[] = [
    ...questionsFor(category).map((q) => ({ key: q.key, label: q.label, value: answers[q.key] ?? '', options: q.options, onPick: (o: string) => setAnswer(q.key, o) })),
    {
      key: 'duration',
      label: t('Hvor lang tid tror du det tar?', 'How long do you think it will take?'),
      value: durationLabel,
      options: DURATION_OPTIONS.map((d) => d.label),
      onPick: (o) => {
        const d = DURATION_OPTIONS.find((x) => x.label === o);
        if (d) update({ durationValue: d.value, durationUnit: d.unit });
      },
    },
    {
      key: 'equipment',
      label: t('Utstyr', 'Equipment'),
      // A blank job defaults to "utstyrfri"; it counts as answered only once picked here.
      value: answers.equipment ? (EQUIPMENT_OPTIONS.find((e) => e.value === values.equipment)?.label ?? '') : '',
      options: EQUIPMENT_OPTIONS.map((e) => e.label),
      onPick: (o) => {
        const e = EQUIPMENT_OPTIONS.find((x) => x.label === o);
        if (e) {
          update({ equipment: e.value });
          setAnswer('equipment', e.value);
        }
      },
    },
  ];
  const allDone = rows.every((r) => r.value);
  const current = rows.find((r) => r.key === open);

  return (
    <View className="flex-1">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">{t('Detaljer', 'Details')}</Text>
        <Text className="mt-1 text-[0.9375rem] leading-6 text-muted">{t('Fyll ut det du vet – da får du raskere svar fra riktige folk.', 'Fill in what you know – you will get faster answers from the right people.')}</Text>

        <View className="mt-5 gap-2">
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={() => setOpen(row.key)}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}${row.value ? `: ${row.value}` : ''}`}
              className="min-h-[60px] flex-row items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 active:bg-surface-2"
            >
              <View className="flex-1">
                <Text className={row.value ? 'text-[0.8125rem] text-muted' : 'text-[1.0625rem] text-ink'}>{row.value ? row.label : `${t('Legg til', 'Add')}: ${row.label.replace(/\?$/, '').toLowerCase()}`}</Text>
                {row.value ? <Text className="mt-0.5 text-[1.0625rem] font-medium text-ink">{row.value}</Text> : null}
              </View>
              <ChevronRight size={18} color={tc('#9B9E96', 'subtle')} />
            </Pressable>
          ))}
        </View>

        {allDone ? (
          <View className="mt-5 flex-row items-center gap-2 rounded-xl bg-tint px-4 py-3">
            <PartyPopper size={18} color={TC.brandText} />
            <Text className="flex-1 text-[0.9375rem] font-medium text-brand-text">{t('Bra jobba – du har fylt ut alle detaljene!', 'Well done – you have filled in all the details!')}</Text>
          </View>
        ) : null}
      </ScrollView>

      <StepFooter label={t('Neste', 'Next')} onPress={next} />

      <BottomSheet visible={Boolean(current)} onClose={() => setOpen(null)} title={current?.label ?? ''}>
        {current
          ? current.options.map((option) => (
              <Pressable
                key={option}
                onPress={() => {
                  current.onPick(option);
                  setOpen(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: option === current.value }}
                className="h-14 flex-row items-center justify-between rounded-lg px-2 active:bg-surface-2"
              >
                <Text className="text-[1.0625rem] text-ink">{option}</Text>
                {option === current.value ? <Check size={18} color={TC.brandText} /> : null}
              </Pressable>
            ))
          : null}
      </BottomSheet>
    </View>
  );
}
