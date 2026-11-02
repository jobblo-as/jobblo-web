import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react-native';
import { TC, tc } from '../../theme/colors';
import { deleteJobDraft, getJobDraft, listJobDrafts } from '../../services/jobDrafts.service';
import { fromDraftData } from './draft';
import { DRAFTS_KEY } from './draftSync';
import { usePostJobStore } from './store';
import { DATE_LOCALE, t } from './i18n';

/** "Dine utkast" (as on the web): server drafts, newest first. Tapping one continues it. */
export function DraftsList({ suggested }: { suggested: 'private' | 'business' }) {
  const queryClient = useQueryClient();
  const openDraft = usePostJobStore((s) => s.openDraft);
  const [opening, setOpening] = useState<string | null>(null);
  const { data: drafts = [] } = useQuery({ queryKey: DRAFTS_KEY, queryFn: listJobDrafts });
  const remove = useMutation({
    mutationFn: deleteJobDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DRAFTS_KEY }),
    onError: () => Alert.alert(t('Kunne ikke slette utkastet.', 'Could not delete the draft.')),
  });
  if (drafts.length === 0) return null;

  const open = async (id: string) => {
    if (opening) return;
    setOpening(id);
    try {
      const draft = fromDraftData(await getJobDraft(id));
      openDraft(id, {
        ...draft,
        values: { ...draft.values, customerType: draft.values.customerType || suggested },
      });
    } catch {
      Alert.alert(t('Fant ikke utkastet.', 'Could not find the draft.'));
      void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    } finally {
      setOpening(null);
    }
  };

  return (
    <View className="mt-6">
      <Text className="text-[0.9375rem] font-bold text-ink">{t('Dine utkast', 'Your drafts')}</Text>
      <View className="mt-2 rounded-2xl border border-line bg-surface">
        {drafts.map((d, i) => {
          const title = d.title || t('Uten tittel', 'Untitled');
          return (
            <View
              key={d._id}
              className={`flex-row items-center gap-3 px-4 py-3 ${i ? 'border-t border-line' : ''}`}
            >
              <Pressable
                onPress={() => void open(d._id)}
                accessibilityRole="button"
                accessibilityLabel={`${t('Fortsett utkastet', 'Continue the draft')} ${title}`}
                className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
              >
                {opening === d._id ? (
                  <ActivityIndicator size="small" color={TC.brandText} />
                ) : (
                  <FileText size={18} color={TC.brandText} />
                )}
                <View className="min-w-0 flex-1">
                  <Text className="text-[0.9375rem] font-semibold text-ink" numberOfLines={1}>
                    {title}
                  </Text>
                  <Text className="mt-0.5 text-[0.8125rem] text-muted">
                    {t('Sist endret', 'Last edited')}{' '}
                    {new Date(d.updatedAt).toLocaleString(DATE_LOCALE, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => remove.mutate(d._id)}
                disabled={remove.isPending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('Slett utkastet', 'Delete the draft')} ${title}`}
                className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
              >
                <Trash2 size={17} color={tc('#B4544A', 'danger')} />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
