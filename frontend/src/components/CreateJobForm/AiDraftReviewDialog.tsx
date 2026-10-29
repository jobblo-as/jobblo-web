import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Sparkles, X } from 'lucide-react';
import type { AiDraftKey, AiDraftRow } from '../../utils/aiFillSummary';

/**
 * Review an AI suggestion before it touches the form: one row per suggested field, ticked
 * unless it would replace something the user typed. Only "Bruk valgte" writes anything.
 */
export function AiDraftReviewDialog({
  rows,
  onApply,
}: {
  rows: AiDraftRow[];
  onApply: (keys: AiDraftKey[]) => void;
}) {
  const [picked, setPicked] = useState<Set<AiDraftKey>>(new Set());
  useEffect(() => {
    setPicked(new Set(rows.filter((r) => !r.overwrites).map((r) => r.key)));
  }, [rows]);

  const toggle = (key: AiDraftKey) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Dialog.Root open={rows.length > 0} onOpenChange={(open) => !open && onApply([])}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          aria-describedby="ai-draft-desc"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[34rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl bg-white p-6 shadow-xl outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="flex items-center gap-2 text-[1.0625rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">
              <Sparkles size={17} className="text-[#2E6641]" /> Forslag til utkast
            </Dialog.Title>
            <Dialog.Close
              aria-label="Lukk"
              className="-m-1 rounded-lg p-1 text-[#63665F] hover:bg-[#F2F3EE]"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <p id="ai-draft-desc" className="mt-1 text-[0.875rem] leading-relaxed text-[#63665F]">
            Velg hva du vil bruke. Pris og tid er estimater, og alt kan endres etterpå.
          </p>

          <ul className="mt-4 -mx-2 flex-1 space-y-1 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.key}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-[#FAFBF7]">
                  <input
                    type="checkbox"
                    checked={picked.has(row.key)}
                    onChange={() => toggle(row.key)}
                    className="mt-0.5 size-4.5 shrink-0 accent-[#2E6641]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-semibold text-[#0B0B0B]">
                      {row.label}
                      {row.overwrites && (
                        <span className="font-normal text-[#9A5B13]">
                          {' '}
                          · erstatter det du har skrevet
                        </span>
                      )}
                    </span>
                    {/* The checklist is shown whole: a clipped list would hide steps that get added. */}
                    <span
                      className={`mt-0.5 block whitespace-pre-line break-words text-[0.875rem] leading-relaxed text-[#63665F] ${row.key === 'checklist' ? '' : 'line-clamp-4'}`}
                    >
                      {row.value}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onApply([])}
              className="h-11 rounded-full px-5 text-[0.9375rem] font-medium text-[#63665F] hover:text-[#0B0B0B]"
            >
              Forkast
            </button>
            <button
              type="button"
              onClick={() => onApply([...picked])}
              disabled={picked.size === 0}
              className="h-11 rounded-full bg-[#2E6641] px-6 text-[0.9375rem] font-semibold text-white hover:bg-[#255335] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Bruk valgte ({picked.size})
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
