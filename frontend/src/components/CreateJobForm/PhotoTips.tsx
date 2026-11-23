import { useMutation } from '@tanstack/react-query';
import { Camera, Loader2, Sparkles } from 'lucide-react';
import { getPhotoSuggestions } from '../../api/aiAPI';
import { getErrorMessage } from '../../utils/getErrorMessage';

/**
 * "Jobs without photos" task 2: a gentle push towards photos while posting. Photos stay
 * optional; this only says why they help, and (on request) asks the AI what to photograph
 * for this particular job.
 */
export function PhotoTips({
  title,
  description,
  category,
  hasPhotos,
}: {
  title: string;
  description: string;
  category: string;
  hasPhotos: boolean;
}) {
  const suggest = useMutation({ mutationFn: getPhotoSuggestions });
  const enough = (title + description).trim().length >= 5;

  return (
    <div className="mt-4 rounded-2xl bg-[#F6F7F2] p-4">
      {!hasPhotos && (
        <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-[#2E6641]">
          <Camera size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          Oppdrag med bilder får flere og mer presise svar.
        </p>
      )}

      {suggest.data ? (
        <ul className={`${hasPhotos ? '' : 'mt-3'} space-y-1.5`} aria-label="Forslag til bilder">
          {suggest.data.map((line) => (
            <li key={line} className="flex gap-2 text-[0.8125rem] text-[#3F423C]">
              <Sparkles size={13} className="mt-1 shrink-0 text-[#2E6641]" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => suggest.mutate({ title, description, category: category || undefined })}
          disabled={!enough || suggest.isPending}
          className={`${hasPhotos ? '' : 'mt-3'} inline-flex items-center gap-1.5 rounded-full border border-[#E6E7E1] bg-white px-3.5 py-1.5 text-[0.8125rem] font-semibold text-[#2E6641] transition-colors hover:border-[#2E6641]/45 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {suggest.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          Hva bør jeg ta bilde av?
        </button>
      )}
      {!enough && !suggest.data && (
        <p className="mt-1.5 text-[0.75rem] text-[#63665F]">
          Skriv tittel eller beskrivelse først, så får du forslag.
        </p>
      )}
      {suggest.isError && (
        <p className="mt-1.5 text-[0.75rem] text-[#B4453A]">
          {getErrorMessage(suggest.error, 'Fikk ikke forslag akkurat nå.')}
        </p>
      )}
    </div>
  );
}
