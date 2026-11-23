import { ArrowRight, CircleCheck, FileText, ImageIcon, TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../../components/Ui/alert-dialog';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../theme/brand';
import { kr } from './styles';

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
 * After "Legg ut som oppdrag": what was saved, as a short list, instead of a toast that was
 * gone before it was read. Each draft with its price type and photos; problems (a draft or a
 * photo that did not save) said plainly. The user goes to the drafts when ready.
 */
export function DraftsSavedDialog({
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
    <AlertDialog
      open={Boolean(result && drafts.length)}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent className="max-w-md gap-0 rounded-3xl border-[#E6E7E1] p-0 sm:max-w-md">
        <div className="p-6 pb-4 sm:p-7 sm:pb-5">
          <span className="flex size-12 items-center justify-center rounded-full bg-[#EAF1E9] text-[#2E6641]">
            <CircleCheck size={26} strokeWidth={2} />
          </span>
          <AlertDialogTitle className="mt-4 text-[1.375rem] font-bold leading-tight tracking-[-0.03em] text-[#0B0B0B]">
            {drafts.length === 1
              ? '1 oppdrag er lagret som utkast'
              : `${drafts.length} oppdrag er lagret som utkast`}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-1.5 text-[0.9375rem] leading-relaxed text-[#63665F]">
            Se over hvert oppdrag, legg til sted og tid, og publiser når du er klar. Du finner dem
            under «Dine utkast».
          </AlertDialogDescription>
        </div>

        <ul className="mx-6 divide-y divide-[#E6E7E1] rounded-2xl border border-[#E6E7E1] sm:mx-7">
          {drafts.map((draft) => (
            <li key={draft.id} className="flex items-start gap-3 px-4 py-3">
              <FileText size={18} className="mt-0.5 shrink-0 text-[#2E6641]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold text-[#0B0B0B]">
                  {draft.title}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-[#63665F]">
                  {draft.paymentType === 'Anbud'
                    ? `Anbud · antatt budsjett ${kr(draft.price)}`
                    : `Fastpris · ${kr(draft.price)}`}
                </p>
              </div>
              {draft.photos > 0 && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F6F7F2] px-2 py-0.5 text-[0.75rem] font-medium text-[#63665F]">
                  <ImageIcon size={12} aria-hidden="true" />
                  {draft.photos}
                </span>
              )}
            </li>
          ))}
        </ul>

        {(partial || (result?.photoFailures ?? 0) > 0) && (
          <div className="mx-6 mt-3 space-y-1 rounded-2xl bg-[#FDF1D6] p-3 text-[0.8125rem] text-[#7A4B0A] sm:mx-7">
            {partial && (
              <p className="flex gap-2">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                {drafts.length} av {result?.total} ble lagret. {result?.error} Prøv igjen for
                resten.
              </p>
            )}
            {(result?.photoFailures ?? 0) > 0 && (
              <p className="flex gap-2">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                {result?.photoFailures} bilde(r) kunne ikke legges ved. Legg dem til i oppdraget.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 p-6 sm:flex-row sm:justify-end sm:p-7">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            Bli her
          </button>
          <button type="button" onClick={onOpenDrafts} className={PRIMARY_BUTTON}>
            Gå til utkastene <ArrowRight size={16} />
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
