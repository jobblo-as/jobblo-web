import React from 'react';
import { Text, View } from 'react-native';
import { BadgeCheck, Clock, FileText } from 'lucide-react-native';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Field } from '../../components/ui/Field';
import { TC, tc } from '../../theme/colors';
import type { AreaKey, Estimate, HomeFacts } from '../../services/renovation.service';
import { range, weeks, kr, type AreaChoice } from './planState';

/** Pieces of the renovation planner screen (as frontend RenovationPlannerPage/parts.tsx). */

export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Steg {n}
      </Text>
      <Text accessibilityRole="header" className="mt-1 text-[1.125rem] font-semibold text-ink">
        {title}
      </Text>
      <View className="mt-4">{children}</View>
    </Card>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  className?: string;
}) {
  return (
    <Field
      label={label}
      value={value}
      suffix={suffix}
      keyboardType="numeric"
      maxLength={12}
      onChangeText={(text) => onChange(text.replace(/[^\d\s.,]/g, ''))}
      className={className}
    />
  );
}

export function NotesList({ notes }: { notes: HomeFacts['standardNotes'] }) {
  if (!notes.length) return null;
  return (
    <View className="mt-4 gap-1.5 rounded-2xl bg-surface-2 p-4">
      {notes.map((note, i) => (
        <View key={i} className="flex-row gap-2">
          <FileText size={15} color={TC.inkFaint} style={{ marginTop: 2 }} />
          <Text className="min-w-0 flex-1 text-[0.875rem] leading-5 text-ink-2">{note.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** The estimate: total, budget, savings, one card per area and the disclaimer. */
export function EstimateView({
  estimate,
  onApply,
}: {
  estimate: Estimate;
  onApply: (key: AreaKey, change: Partial<AreaChoice>) => void;
}) {
  const { total, budget } = estimate;
  const budgetText =
    budget &&
    {
      within: `Innenfor budsjettet på ${kr(budget.amount)}.`,
      borderline: `Budsjettet på ${kr(budget.amount)} kan holde, men det blir stramt.`,
      over: `Over budsjettet på ${kr(budget.amount)} med ca. ${kr(budget.overBy)}.`,
    }[budget.status];

  return (
    <View>
      <View className="rounded-3xl bg-brand p-6">
        <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.16em] text-white/70">
          Estimat
        </Text>
        <Text accessibilityRole="header" className="mt-2 text-[1.75rem] font-bold text-white">
          {range(total.low, total.high)}
        </Text>
        <Text className="mt-2 text-[0.875rem] leading-5 text-white/85">
          Arbeid {range(total.labour.low, total.labour.high)} · Materialer{' '}
          {range(total.materials.low, total.materials.high)} · {weeks(total.weeks)}
        </Text>
        {budgetText ? (
          <Text className="mt-4 text-[0.9375rem] font-semibold text-white">{budgetText}</Text>
        ) : null}
      </View>

      {budget && budget.suggestions.length > 0 ? (
        <Card className="mt-4 p-5">
          <Text className="text-[0.9375rem] font-semibold text-ink">Slik kan du spare</Text>
          <View className="mt-3 gap-3">
            {budget.suggestions.map((s) => (
              <View
                key={`${s.key}-${s.change.scope ?? s.change.quality}`}
                className="flex-row items-center gap-3"
              >
                <Text className="min-w-0 flex-1 text-[0.875rem] leading-5 text-ink-2">
                  {s.text}
                </Text>
                <Chip label="Bruk" onPress={() => onApply(s.key, s.change)} />
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <View className="mt-4 gap-3">
        {estimate.areas.map((line) => (
          <Card key={line.key} className="p-5">
            <Text className="text-[1rem] font-semibold text-ink">
              {line.label}
              <Text className="font-normal text-muted">
                {' '}
                · {line.scope === 'full' ? 'Total' : 'Overflate'}
                {line.unit ? ` · ${line.quantity} ${line.unit}` : ''}
              </Text>
            </Text>
            <Text className="mt-1 text-[1rem] font-bold tabular-nums text-ink">
              {range(line.low, line.high)}
            </Text>
            <Text className="mt-1.5 text-[0.8125rem] leading-5 text-muted">
              Arbeid {range(line.labour.low, line.labour.high)} · Materialer{' '}
              {range(line.materials.low, line.materials.high)}
            </Text>
            <View className="mt-3 gap-1.5">
              <View className="flex-row items-center gap-1.5">
                <Clock size={14} color={TC.inkMuted} />
                <Text className="text-[0.8125rem] text-muted">{weeks(line.weeks)}</Text>
              </View>
              {line.certified.length > 0 ? (
                <View className="flex-row items-start gap-1.5">
                  <BadgeCheck size={14} color={tc('#9A6213', 'orange')} style={{ marginTop: 2 }} />
                  <Text className="min-w-0 flex-1 text-[0.8125rem] font-medium text-warn">
                    Krever sertifisert fagperson: {line.certified.join(', ')}
                  </Text>
                </View>
              ) : null}
              {line.quote ? (
                <Text className="text-[0.8125rem] font-medium text-brand-text">
                  Legges ut som anbud
                </Text>
              ) : null}
            </View>
          </Card>
        ))}
      </View>

      <Text className="mt-4 text-[0.8125rem] italic leading-5 text-muted">
        {estimate.disclaimer}
      </Text>
    </View>
  );
}
