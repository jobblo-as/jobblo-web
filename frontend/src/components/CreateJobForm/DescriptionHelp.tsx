import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, MessageCircleQuestion, Plus } from 'lucide-react';
import { getDescriptionQuestions } from '../../api/aiAPI';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { appendAnswers, isShortDescription } from '../../utils/descriptionHelp';

/**
 * "Jobs without photos" task 3: a very short description ("Noen som er flinke med
 * speilglass?") gets the offer of a few follow-up questions from the AI — what needs doing,
 * size, where, when, materials. The answers are added to the description as short lines; the
 * user can still edit everything. Nothing is sent until they ask.
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
  const questions = ask.data?.questions ?? [];

  // Only for a description that has started but says too little.
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
    <div className="mt-3 rounded-2xl border border-[#E6E7E1] bg-[#F6F7F2] p-4">
      <p className="flex items-start gap-2 text-[0.875rem] font-semibold text-[#0B0B0B]">
        <MessageCircleQuestion size={16} className="mt-0.5 shrink-0 text-[#2E6641]" />
        Beskrivelsen er kort. Svar på noen spørsmål, så får du flere og bedre svar.
      </p>

      {questions.length ? (
        <div className="mt-3 space-y-3">
          {questions.map((q) => (
            <label key={q.question} className="block">
              <span className="text-[0.8125rem] font-medium text-[#3F423C]">{q.question}</span>
              <input
                value={answers[q.question] ?? ''}
                onChange={(e) =>
                  setAnswers((current) => ({
                    ...current,
                    [q.question]: e.target.value.slice(0, 200),
                  }))
                }
                className="mt-1 h-10 w-full rounded-xl border border-[#E6E7E1] bg-white px-3 text-[0.875rem] text-[#0B0B0B] outline-none focus:border-[#2E6641]/45 focus:ring-4 focus:ring-[#2E6641]/12"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={add}
            disabled={!Object.values(answers).some((a) => a.trim())}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#2E6641] px-4 py-2 text-[0.8125rem] font-semibold text-white transition hover:bg-[#255335] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} /> Legg til i beskrivelsen
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ask.mutate({ title, description, category: category || undefined })}
          disabled={ask.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#E6E7E1] bg-white px-3.5 py-1.5 text-[0.8125rem] font-semibold text-[#2E6641] transition-colors hover:border-[#2E6641]/45 disabled:opacity-50"
        >
          {ask.isPending && <Loader2 size={14} className="animate-spin" />}
          Still meg spørsmål
        </button>
      )}
      {ask.isError && (
        <p className="mt-2 text-[0.75rem] text-[#B4453A]">
          {getErrorMessage(ask.error, 'Fikk ikke spørsmål akkurat nå.')}
        </p>
      )}
    </div>
  );
}
