import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { ArrowLeft, ArrowRight, Camera, ImagePlus, Star, Trash2, X } from 'lucide-react-native';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { TC, tc } from '../../../theme/colors';
import { MAX_PHOTOS } from '../flow';
import { usePostJobStore } from '../store';
import { usePhotoPicker } from '../usePhotoPicker';
import { StepFooter } from '../StepFooter';
import { t } from '../i18n';

const GAP = 10;

/**
 * FINN step 3: the photos in a numbered grid, remove with X, add more from camera or library.
 * Tap a photo to make it the cover or move it. ponytail: tap-to-move instead of drag-to-reorder;
 * drag needs a sortable grid on reanimated + gesture-handler (both installed) if testers ask.
 */
export function PhotoGridStep() {
  const photos = usePostJobStore((s) => s.photos);
  const photoQuality = usePostJobStore((s) => s.photoQuality);
  const removePhoto = usePostJobStore((s) => s.removePhoto);
  const movePhoto = usePostJobStore((s) => s.movePhoto);
  const next = usePostJobStore((s) => s.next);
  const goTo = usePostJobStore((s) => s.goTo);
  const { fromLibrary, room } = usePhotoPicker();
  const [selected, setSelected] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - 32 - GAP * 2) / 3);

  const close = () => setSelected(null);
  const act = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <View className="flex-1">
      {/* Bottom room for the floating glass button. */}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">{t('Legg til bilder', 'Add photos')}</Text>
        <Text className="mt-1 text-[0.9375rem] leading-6 text-muted">
          {photos.length < MAX_PHOTOS
            ? t('Flott! Flere bilder gjør det lettere for fagfolk å gi et godt tilbud.', 'Great! More photos make it easier for pros to give a good offer.')
            : t('Du har lagt til maks antall bilder.', 'You have added the maximum number of photos.')}
        </Text>

        <View className="mt-5 flex-row flex-wrap" style={{ gap: GAP }}>
          {photos.map((photo, index) => (
            <Pressable
              key={photo.uri}
              onPress={() => setSelected(index)}
              accessibilityRole="button"
              accessibilityLabel={`${t('Bilde', 'Photo')} ${index + 1}${index === 0 ? t(', forsidebilde', ', cover photo') : ''}. ${t('Trykk for valg.', 'Tap for options.')}`}
              style={{ width: tile, height: tile }}
              className="overflow-hidden rounded-xl bg-surface-2"
            >
              <Image source={{ uri: photo.uri }} style={{ width: tile, height: tile }} resizeMode="cover" />
              <View className="absolute bottom-1.5 left-1.5 h-6 min-w-6 items-center justify-center rounded-full bg-black/60 px-1.5">
                <Text className="text-[0.8125rem] font-semibold text-white">{index + 1}</Text>
              </View>
              {/* The camera AI helper asked for a retake: this photo is left out of the title/description. */}
              {photoQuality[photo.uri] === 'blurry' || photoQuality[photo.uri] === 'dark' ? (
                <View className="absolute bottom-1.5 right-1.5 rounded-full bg-[#FCD34D] px-2 py-0.5">
                  <Text className="text-[0.8125rem] font-semibold text-black">{t('Nytt bilde?', 'Retake?')}</Text>
                </View>
              ) : null}
              {index === 0 ? (
                <View className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5">
                  <Text className="text-[0.8125rem] font-semibold text-white">{t('Forside', 'Cover')}</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => removePhoto(index)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('Fjern bilde', 'Remove photo')} ${index + 1}`}
                className="absolute right-1.5 top-1.5 h-7 w-7 items-center justify-center rounded-full bg-black/60"
              >
                <X size={15} color="#FFFFFF" />
              </Pressable>
            </Pressable>
          ))}

          {room > 0 ? (
            <>
              <Pressable
                onPress={() => void fromLibrary()}
                accessibilityRole="button"
                accessibilityLabel={t('Legg til fra biblioteket', 'Add from the library')}
                style={{ width: tile, height: tile }}
                className="items-center justify-center rounded-xl border border-dashed border-line bg-surface active:bg-surface-2"
              >
                <ImagePlus size={24} color={TC.brandText} />
                <Text className="mt-1 text-[0.8125rem] font-medium text-muted">{t('Bibliotek', 'Library')}</Text>
              </Pressable>
              <Pressable
                onPress={() => goTo('photos')}
                accessibilityRole="button"
                accessibilityLabel={t('Ta et nytt bilde', 'Take a new photo')}
                style={{ width: tile, height: tile }}
                className="items-center justify-center rounded-xl border border-dashed border-line bg-surface active:bg-surface-2"
              >
                <Camera size={24} color={TC.brandText} />
                <Text className="mt-1 text-[0.8125rem] font-medium text-muted">{t('Kamera', 'Camera')}</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <Text className="mt-4 text-[0.8125rem] leading-5 text-muted">
          {photos.length} {t('av', 'of')} {MAX_PHOTOS} {t('bilder', 'photos')} · {t('Trykk på et bilde for å gjøre det til forsidebilde eller flytte det.', 'Tap a photo to make it the cover or move it.')}
        </Text>
      </ScrollView>

      <StepFooter glass label={t('Fortsett', 'Continue')} onPress={next} disabled={photos.length === 0} />

      <BottomSheet visible={selected !== null} onClose={close} title={selected !== null ? `${t('Bilde', 'Photo')} ${selected + 1}` : ''}>
        {selected !== null ? (
          <View className="gap-1">
            {selected > 0 ? (
              <SheetAction icon={<Star size={20} color={TC.ink} />} label={t('Bruk som forsidebilde', 'Use as cover photo')} onPress={() => act(() => movePhoto(selected, 0))} />
            ) : null}
            {selected > 0 ? (
              <SheetAction icon={<ArrowLeft size={20} color={TC.ink} />} label={t('Flytt frem', 'Move earlier')} onPress={() => act(() => movePhoto(selected, selected - 1))} />
            ) : null}
            {selected < photos.length - 1 ? (
              <SheetAction icon={<ArrowRight size={20} color={TC.ink} />} label={t('Flytt bak', 'Move later')} onPress={() => act(() => movePhoto(selected, selected + 1))} />
            ) : null}
            <SheetAction
              icon={<Trash2 size={20} color={tc('#B42318', 'danger')} />}
              label={t('Fjern bildet', 'Remove photo')}
              danger
              onPress={() => act(() => removePhoto(selected))}
            />
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function SheetAction({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="h-14 flex-row items-center gap-3 rounded-xl px-2 active:bg-surface-2">
      {icon}
      <Text className={`text-[1.0625rem] font-medium ${danger ? 'text-danger' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}
