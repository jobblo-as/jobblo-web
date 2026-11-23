import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Camera, Sparkles } from 'lucide-react-native';
import { TC } from '../../theme/colors';
import { getPhotoSuggestions } from '../../services/ai.service';
import { t } from './i18n';

/**
 * "Jobs without photos" task 2, on the review step of a listing without photos: why photos
 * help, and (on request) the AI's suggestions for what to photograph, now that the title and
 * description are written. Photos stay optional. Same as the web's PhotoTips.
 */
export function PhotoTips({
  title,
  description,
  category,
  onAddPhotos,
}: {
  title: string;
  description: string;
  category: string;
  onAddPhotos: () => void;
}) {
  const suggest = useMutation({ mutationFn: getPhotoSuggestions });
  const enough = (title + description).trim().length >= 5;

  return (
    <View className="mt-3 rounded-xl bg-surface-2 p-4">
      <View className="flex-row items-start gap-2">
        <Camera size={16} color={TC.brandText} />
        <Text className="flex-1 text-[0.875rem] font-semibold text-brand-text">
          {t(
            'Oppdrag med bilder får flere og mer presise svar.',
            'Jobs with photos get more and more precise answers.'
          )}
        </Text>
      </View>

      {suggest.data?.length ? (
        <View className="mt-3 gap-1.5" accessibilityLabel={t('Forslag til bilder', 'Photo ideas')}>
          {suggest.data.map((line) => (
            <View key={line} className="flex-row items-start gap-2">
              <Sparkles size={13} color={TC.brandText} style={{ marginTop: 3 }} />
              <Text className="flex-1 text-[0.875rem] leading-5 text-ink-2">{line}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {!suggest.data?.length && enough ? (
          <Pressable
            onPress={() => suggest.mutate({ title, description, category: category || undefined })}
            disabled={suggest.isPending}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 active:opacity-70"
          >
            {suggest.isPending ? (
              <ActivityIndicator size="small" color={TC.brandText} />
            ) : (
              <Sparkles size={14} color={TC.brandText} />
            )}
            <Text className="text-[0.875rem] font-semibold text-brand-text">
              {t('Hva bør jeg ta bilde av?', 'What should I photograph?')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onAddPhotos}
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 active:opacity-70"
        >
          <Camera size={14} color="#FFFFFF" />
          <Text className="text-[0.875rem] font-semibold text-white">
            {t('Legg til bilder', 'Add photos')}
          </Text>
        </Pressable>
      </View>
      {suggest.isError ? (
        <Text className="mt-2 text-[0.8125rem] text-danger">
          {t('Fikk ikke forslag akkurat nå.', 'Could not get ideas right now.')}
        </Text>
      ) : null}
    </View>
  );
}
