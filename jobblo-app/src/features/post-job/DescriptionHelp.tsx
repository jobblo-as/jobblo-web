import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { MessageCircleQuestion, Plus } from 'lucide-react-native';
import { TC, tc } from '../../theme/colors';
import { getDescriptionQuestions } from '../../services/ai.service';
import { appendAnswers, isShortDescription } from './descriptionRules';
import { t } from './i18n';

/**
 * "Jobs without photos" task 3, under the description on the text step: a very short
 * description gets the offer of a few follow-up questions from the AI (what needs doing,
 * size, where, when, materials). The answers are added to the description as short lines.
 * Nothing is sent until the user asks; the parent shows it only with the AI helper on.
 */
export function DescriptionHelp({
  title,
  description,
  category,
  onChange,
}: {
  title: string;
  description: string;
  category: string;
  onChange: (description: string) => void;
}) {
  const ask = useMutation({ mutationFn: getDescriptionQuestions });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = ask.data ?? [];

  if (!description.trim() || (!questions.length && !isShortDescription(description))) return null;

  const add = () => {
    onChange(
      appendAnswers(
        description,
        questions.map((q) => ({ label: q.label, answer: answers[q.question] ?? '' }))
      )
    );
    setAnswers({});
    ask.reset();
  };

  return (
    <View className="mt-3 rounded-xl bg-surface-2 p-4">
      <View className="flex-row items-start gap-2">
        <MessageCircleQuestion size={16} color={TC.brandText} />
        <Text className="flex-1 text-[0.875rem] font-semibold text-ink">
          {t(
            'Beskrivelsen er kort. Svar på noen spørsmål, så får du flere og bedre svar.',
            'The description is short. Answer a few questions to get more and better answers.'
          )}
        </Text>
      </View>

      {questions.length ? (
        <View className="mt-3 gap-3">
          {questions.map((q) => (
            <View key={q.question}>
              <Text className="text-[0.875rem] text-ink-2">{q.question}</Text>
              <TextInput
                value={answers[q.question] ?? ''}
                onChangeText={(value) =>
                  setAnswers((current) => ({ ...current, [q.question]: value.slice(0, 200) }))
                }
                accessibilityLabel={q.question}
                placeholderTextColor={tc('#9B9E96', 'placeholder')}
                className="mt-1 h-11 rounded-lg border border-line bg-surface px-3 text-[1rem] text-ink"
              />
            </View>
          ))}
          <Pressable
            onPress={add}
            disabled={!Object.values(answers).some((a) => a.trim())}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 self-start rounded-full bg-brand px-4 py-2 active:opacity-70 disabled:opacity-50"
          >
            <Plus size={14} color="#FFFFFF" />
            <Text className="text-[0.875rem] font-semibold text-white">
              {t('Legg til i beskrivelsen', 'Add to the description')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => ask.mutate({ title, description, category: category || undefined })}
          disabled={ask.isPending}
          accessibilityRole="button"
          className="mt-3 flex-row items-center gap-1.5 self-start rounded-full border border-line bg-surface px-3.5 py-2 active:opacity-70"
        >
          {ask.isPending ? <ActivityIndicator size="small" color={TC.brandText} /> : null}
          <Text className="text-[0.875rem] font-semibold text-brand-text">
            {t('Still meg spørsmål', 'Ask me questions')}
          </Text>
        </Pressable>
      )}
      {ask.isError ? (
        <Text className="mt-2 text-[0.8125rem] text-danger">
          {t('Fikk ikke spørsmål akkurat nå.', 'Could not get questions right now.')}
        </Text>
      ) : null}
    </View>
  );
}
