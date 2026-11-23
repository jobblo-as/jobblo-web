import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { ArrowRight, Search, ShieldCheck } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCategories } from '../../hooks/useCategories';
import apiClient from '../../api/client';
import { TC, tc } from '../../theme/colors';
import { SERVICE_SHOWCASE, categoryPhoto } from '../../utils/categoryImage';
import { MIN_ACTIVE_JOBS_FOR_STATS } from '../../constants/stats';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'God morgen';
  if (hour >= 12 && hour < 18) return 'God ettermiddag';
  return 'God kveld';
}

export function HomeHero() {
  const router = useRouter();
  const narrow = useWindowDimensions().width < 360;
  const [query, setQuery] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const { data } = useCategories();
  const categories = data?.categories ?? [];

  const words = useMemo(
    () =>
      categories.length
        ? categories.slice(0, 6).map((cat: { name: string }) => cat.name.toLowerCase())
        : ['maling', 'flytting', 'hagearbeid', 'rørlegger', 'rengjøring'],
    [categories]
  );

  const { data: stats } = useQuery({
    queryKey: ['public-stats'],
    queryFn: async () => {
      const response = await apiClient.get('/public/stats');
      return response.data;
    },
    staleTime: 30_000,
    gcTime: 60_000,
  });

  const categoryShortcuts = categories.slice(0, 6);

  // Photo cards follow the backend's categories (admin order): the category's own image,
  // else the bundled photo for its name. A category with neither is left out rather than
  // shown with an unrelated photo. Until categories load, the bundled list.
  const showcase = useMemo(() => {
    const fromApi = categories
      .map((cat: { _id?: string; name: string; image?: string }) => ({
        key: cat._id ?? cat.name,
        name: cat.name,
        src: cat.image ? { uri: cat.image } : categoryPhoto(cat.name),
      }))
      .filter((card: { src?: unknown }) => card.src);
    return fromApi.length
      ? fromApi
      : SERVICE_SHOWCASE.map((service) => ({ key: service.name, ...service }));
  }, [categories]);

  return (
    <View style={{ backgroundColor: TC.page, paddingBottom: 10 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={{
              backgroundColor: TC.surface,
              borderWidth: 1,
              borderColor: TC.line,
              borderRadius: 999,
              paddingVertical: 10,
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: TC.ink, fontSize: 13, fontWeight: '700' }}>Logg inn</Text>
          </Pressable>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <Text
            style={{
              color: tc('#63665F', 'muted'),
              fontSize: 13,
              fontWeight: '700',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            Norges lokale jobbplattform
          </Text>
          {/* Small numbers make the platform look empty to a new visitor, so the counts show
              only from MIN_ACTIVE_JOBS_FOR_STATS active jobs; until then, the SafePay promise
              (same rule as the web hero). */}
          <Text
            style={{
              color: tc('#63665F', 'muted'),
              fontSize: 13,
              fontWeight: '700',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            {stats && (stats.jobs ?? 0) >= MIN_ACTIVE_JOBS_FOR_STATS
              ? `${stats.jobs} aktive oppdrag · ${stats.users ?? 0} brukere`
              : 'Trygg betaling med SafePay'}
          </Text>
        </View>

        <Text
          style={{
            color: TC.ink,
            fontSize: 42,
            fontWeight: '800',
            lineHeight: 44,
            letterSpacing: -1.4,
          }}
        >
          Jeg trenger hjelp til
        </Text>
        <Text
          style={{
            color: TC.brandText,
            fontSize: 42,
            fontWeight: '800',
            lineHeight: 44,
            letterSpacing: -1.4,
          }}
        >
          {words[wordIndex % words.length]}
        </Text>

        <Text
          style={{ marginTop: 14, color: tc('#63665F', 'muted'), fontSize: 16, lineHeight: 24 }}
        >
          Beskriv oppdraget, få tilbud fra folk i nærheten, og betal først når jobben er godkjent.{' '}
          <Text style={{ color: TC.brandText, fontWeight: '700' }}>Gratis å legge ut</Text> —{' '}
          <Text style={{ color: TC.brandText, fontWeight: '700' }}>
            3 % når jobben faktisk blir gjort
          </Text>
          .
        </Text>

        <View
          style={{
            marginTop: 18,
            flexDirection: 'row',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: TC.line,
            backgroundColor: TC.surface,
            borderRadius: 999,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 7,
          }}
        >
          <Search size={18} color={tc('#9B9E96', 'subtle')} style={{ marginRight: 8 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Hva gjelder det?"
            placeholderTextColor={TC.placeholder}
            // minWidth 0: the input may shrink, so the button stays inside the pill on a
            // 320 pt phone (it was pushed past the edge and its arrow cut off).
            style={{ flex: 1, minWidth: 0, fontSize: 15, color: TC.ink, paddingVertical: 10 }}
          />
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            style={{
              flexShrink: 0,
              backgroundColor: TC.brandDeep,
              borderRadius: 999,
              paddingHorizontal: narrow ? 14 : 18,
              paddingVertical: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Finn hjelp</Text>
            <ArrowRight size={16} color="#FFFFFF" />
          </Pressable>
        </View>

        {categoryShortcuts.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 16 }}
          >
            {categoryShortcuts.map((cat: { _id?: string; name: string }) => (
              <Pressable
                key={cat._id}
                onPress={() => router.push('/(auth)/register')}
                style={{
                  borderWidth: 1,
                  borderColor: TC.line,
                  backgroundColor: TC.surface,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: TC.ink, fontSize: 13, fontWeight: '600' }}>{cat.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={15} color={TC.brandText} />
          <Text style={{ color: TC.brandText, fontWeight: '700' }}>
            Betaling holdes trygt til du har godkjent
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 18, paddingHorizontal: 20 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12 }}
        >
          {showcase.map((service) => (
            <Pressable
              key={service.key}
              onPress={() => router.push('/(auth)/register')}
              style={{
                width: 150,
                height: 180,
                overflow: 'hidden',
                borderRadius: 22,
                borderWidth: 1,
                borderColor: TC.line,
                backgroundColor: TC.tint,
              }}
            >
              <Image
                source={service.src}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 60,
                  backgroundColor: 'rgba(11,11,11,0.56)',
                }}
              />
              <Text
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  right: 12,
                  color: '#FFFFFF',
                  fontWeight: '700',
                  fontSize: 14,
                }}
              >
                {service.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
