import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MapPin, ShieldCheck, Zap } from 'lucide-react-native';
import type { Job } from '../types/Jobs';
import { jobPhotoUrl } from '../utils/categoryImage';
import { TC, tc } from '../theme/colors';
import { JobTextCover } from './JobTextCover';

/**
 * A job in Utforsk's list view (the grid/list toggle, "Jobs without photos" task 4). Text
 * first: title, the first lines of the description, then price, place and SafePay; the photo
 * (or the category's colour and icon) is a small thumbnail on the right. Same as the web's
 * JobListRow. Save is on the job page (the grid card keeps its heart).
 */
export function JobListRow({ job }: { job: Job }) {
  const router = useRouter();
  const url = jobPhotoUrl(job);
  const [failed, setFailed] = useState(false);
  const price = job.price ? job.price.toLocaleString('nb-NO') : 'Variabelt';
  const place = job.location?.city || job.location?.address || 'Norge';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(app)/jobs/[id]', params: { id: job._id } })}
      accessibilityRole="link"
      accessibilityLabel={job.title}
      className="flex-row gap-3 rounded-2xl border border-line bg-surface p-3.5 active:opacity-80"
    >
      <View className="min-w-0 flex-1">
        {job.urgent || job.promoted ? (
          <View className="mb-1.5 flex-row gap-1.5">
            {job.urgent ? (
              <View className="flex-row items-center gap-1 rounded-full bg-brand-deep px-2.5 py-1">
                <Zap size={11} color="#FFFFFF" fill="#FFFFFF" />
                <Text className="text-[0.8125rem] font-semibold text-white">Haster</Text>
              </View>
            ) : null}
            {job.promoted ? (
              <View className="rounded-full bg-brand px-2.5 py-1">
                <Text className="text-[0.8125rem] font-semibold text-white">Sponset</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text className="text-[1rem] font-semibold leading-tight text-ink" numberOfLines={2}>
          {job.title}
        </Text>
        {job.description ? (
          <Text className="mt-1 text-[0.875rem] leading-5 text-muted" numberOfLines={2}>
            {job.description}
          </Text>
        ) : null}
        <View className="mt-2 flex-row flex-wrap items-center gap-x-1.5">
          <Text className="text-[0.875rem] font-semibold text-ink">{price} kr</Text>
          <Text className="text-[0.8125rem] text-muted">·</Text>
          <View className="flex-row items-center gap-1">
            <MapPin size={13} color={tc('#63665F', 'muted')} strokeWidth={2} />
            <Text className="text-[0.8125rem] text-muted" numberOfLines={1}>
              {place}
            </Text>
          </View>
          <Text className="text-[0.8125rem] text-muted">·</Text>
          <View className="flex-row items-center gap-1">
            <ShieldCheck size={13} color={TC.brandText} strokeWidth={2.2} />
            <Text className="text-[0.8125rem] font-medium text-brand-text">SafePay</Text>
          </View>
        </View>
      </View>

      <View style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden' }}>
        {url && !failed ? (
          <Image
            source={{ uri: url }}
            style={{ width: 84, height: 84 }}
            resizeMode="cover"
            resizeMethod="resize"
            onError={() => setFailed(true)}
          />
        ) : (
          <JobTextCover job={job} iconOnly />
        )}
      </View>
    </Pressable>
  );
}
