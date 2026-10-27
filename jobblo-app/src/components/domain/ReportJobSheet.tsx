import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { jobsService } from '../../services/jobs.service';
import { TC, tc } from '../../theme/colors';

// Same types and labels as the web's ReportJobModal (backend JobReport.VALID_REPORT_TYPES).
const REASONS = [
  { value: 'fake_job', label: 'Falsk annonse' },
  { value: 'scam_or_fraud', label: 'Svindel' },
  { value: 'spam', label: 'Spam' },
  { value: 'duplicate', label: 'Duplikat' },
  { value: 'inappropriate_content', label: 'Upassende innhold' },
  { value: 'wrong_category', label: 'Feil kategori' },
  { value: 'misleading_info', label: 'Villedende informasjon' },
  { value: 'expired_job', label: 'Utløpt annonse' },
  { value: 'payment_issue', label: 'Betalingsproblem' },
  { value: 'other', label: 'Annet' },
];

function serverError(error: unknown) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null;
}

/** "Rapporter oppdraget" (FINN: "Rapporter svindel/regelbrudd"): reason + a short description. */
export function ReportJobSheet({
  visible,
  serviceId,
  onClose,
}: {
  visible: boolean;
  serviceId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const report = useMutation({
    mutationFn: () => jobsService.reportJob(serviceId, reason, description.trim()),
  });

  const close = () => {
    onClose();
    // Next time it opens empty, unless a report is on its way.
    if (!report.isPending) {
      setReason('');
      setDescription('');
      report.reset();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={close} title="Rapporter oppdraget">
      {report.isSuccess ? (
        <View className="items-center py-6">
          <CheckCircle2 size={36} color={TC.brandText} />
          <Text className="mt-3 text-center text-[1.0625rem] font-semibold text-ink">
            Takk – rapporten er sendt
          </Text>
          <Text className="mt-1 text-center text-[0.9375rem] leading-6 text-muted">
            Jobblo ser på annonsen så snart som mulig.
          </Text>
        </View>
      ) : (
        <View>
          <Text className="mb-2 text-[0.9375rem] text-muted">Hva er galt med annonsen?</Text>
          <View className="flex-row flex-wrap gap-2">
            {REASONS.map((r) => {
              const selected = r.value === reason;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setReason(r.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`h-9 justify-center rounded-full border px-3 ${selected ? 'border-brand bg-tint' : 'border-line bg-surface'}`}
                >
                  <Text
                    className={`text-[0.875rem] ${selected ? 'font-semibold text-brand-text' : 'text-ink'}`}
                  >
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Beskriv kort hva som er galt"
            placeholderTextColor={tc('#9B9E96', 'placeholder')}
            multiline
            maxLength={1000}
            accessibilityLabel="Beskrivelse av problemet"
            className="mt-4 min-h-[96px] rounded-xl border border-line bg-surface px-4 py-3 text-[1.0625rem] leading-6 text-ink"
            style={{ textAlignVertical: 'top' }}
          />
          {report.isError ? (
            <Text className="mt-2 text-[0.875rem] font-medium text-danger">
              {serverError(report.error) ?? 'Kunne ikke sende rapporten. Prøv igjen.'}
            </Text>
          ) : null}
          <Pressable
            onPress={() => report.mutate()}
            disabled={!reason || !description.trim() || report.isPending}
            accessibilityRole="button"
            className={`mt-4 h-12 items-center justify-center rounded-full bg-brand ${!reason || !description.trim() || report.isPending ? 'opacity-50' : ''}`}
          >
            {report.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-[0.9375rem] font-semibold text-white">Send rapport</Text>
            )}
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}
