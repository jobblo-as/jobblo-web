import React from 'react';
import { Text, View } from 'react-native';
import { CircleCheck, FileText, ImageIcon, TriangleAlert } from 'lucide-react-native';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { TC } from '../../theme/colors';
import { kr } from './planState';

export type SavedDraft = {
  id: string;
  title: string;
  paymentType: 'Fastpris' | 'Anbud';
  price: number;
  photos: number;
};

export type DraftsResult = {
  drafts: SavedDraft[];
  /** Areas in the plan; more than drafts.length when saving stopped part way. */
  total: number;
  photoFailures: number;
  error: string | null;
};

/**
 * After "Legg ut som oppdrag": what was saved, as a short list in a sheet, instead of a
 * system alert. Each draft with its price type and photos; problems said plainly. Same as
 * the web's DraftsSavedDialog.
 */
export function DraftsSavedSheet({
  result,
  onOpenDrafts,
  onClose,
}: {
  result: DraftsResult | null;
  onOpenDrafts: () => void;
  onClose: () => void;
}) {
  const drafts = result?.drafts ?? [];
  const partial = result ? drafts.length < result.total : false;

  return (
    <BottomSheet
      visible={Boolean(result && drafts.length)}
      onClose={onClose}
      title="Lagret som utkast"
      footer={
        <View className="gap-2">
          <Button label="Gå til utkastene" onPress={onOpenDrafts} />
          <Button variant="secondary" label="Bli her" onPress={onClose} />
        </View>
      }
    >
      <View className="items-center">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-tint">
          <CircleCheck size={26} color={TC.brandText} />
        </View>
        <Text className="mt-3 text-center text-[1.25rem] font-bold text-ink">
          {drafts.length === 1
            ? '1 oppdrag er lagret som utkast'
            : `${drafts.length} oppdrag er lagret som utkast`}
        </Text>
        <Text className="mt-1 text-center text-[0.9375rem] leading-6 text-muted">
          Se over hvert oppdrag, legg til sted og tid, og publiser når du er klar.
        </Text>
      </View>

      <View className="mt-4 overflow-hidden rounded-2xl border border-line">
        {drafts.map((draft, i) => (
          <View
            key={draft.id}
            className={`flex-row items-start gap-3 px-4 py-3 ${i ? 'border-t border-line' : ''}`}
          >
            <FileText size={18} color={TC.brandText} style={{ marginTop: 2 }} />
            <View className="min-w-0 flex-1">
              <Text className="text-[0.9375rem] font-semibold text-ink" numberOfLines={1}>
                {draft.title}
              </Text>
              <Text className="mt-0.5 text-[0.8125rem] text-muted">
                {draft.paymentType === 'Anbud'
                  ? `Anbud · antatt budsjett ${kr(draft.price)}`
                  : `Fastpris · ${kr(draft.price)}`}
              </Text>
            </View>
            {draft.photos > 0 ? (
              <View className="flex-row items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
                <ImageIcon size={12} color={TC.inkMuted} />
                <Text className="text-[0.8125rem] text-muted">{draft.photos}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {partial || (result?.photoFailures ?? 0) > 0 ? (
        <View className="mt-3 gap-1 rounded-2xl bg-[#FDF1D6] p-3">
          {partial ? (
            <View className="flex-row gap-2">
              <TriangleAlert size={15} color="#7A4B0A" style={{ marginTop: 2 }} />
              <Text className="flex-1 text-[0.8125rem] text-[#7A4B0A]">
                {drafts.length} av {result?.total} ble lagret. {result?.error} Prøv igjen for
                resten.
              </Text>
            </View>
          ) : null}
          {(result?.photoFailures ?? 0) > 0 ? (
            <View className="flex-row gap-2">
              <TriangleAlert size={15} color="#7A4B0A" style={{ marginTop: 2 }} />
              <Text className="flex-1 text-[0.8125rem] text-[#7A4B0A]">
                {result?.photoFailures} bilde(r) kunne ikke legges ved. Legg dem til i oppdraget.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}
