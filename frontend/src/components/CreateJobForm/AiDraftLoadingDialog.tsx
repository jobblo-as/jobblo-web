import { useEffect, useMemo } from 'react';
import { Dialog } from 'radix-ui';
import { Sparkles } from 'lucide-react';

const ORBIT = 'motion-safe:animate-[spin_9s_linear_infinite]';
// Each photo turns back as fast as the ring turns, so it stays upright while it circles.
const UPRIGHT = 'motion-safe:animate-[spin_9s_linear_infinite_reverse]';

/**
 * While "Foreslå et utkast" runs (FINN's "Lager utkast"): the user's own photos circle the
 * text, so the wait shows what the AI is looking at. "Avbryt" stops the request.
 */
export function AiDraftLoadingDialog({
  open,
  photos,
  onCancel,
}: {
  open: boolean;
  photos: File[];
  onCancel: () => void;
}) {
  const urls = useMemo(
    () => (open ? photos.slice(0, 3).map((file) => URL.createObjectURL(file)) : []),
    [open, photos]
  );
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          aria-describedby="ai-loading-desc"
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[24rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-3xl bg-white p-6 shadow-xl outline-none"
        >
          <Dialog.Title className="self-start text-[1.0625rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">
            Lager utkast
          </Dialog.Title>

          <div className="relative my-6 size-52">
            <div className="absolute inset-6 rounded-full bg-[#EAF1E9]/60" />
            <div className={`absolute inset-0 ${ORBIT}`}>
              {(urls.length ? urls : [null]).map((url, i, all) => {
                const angle = (i / all.length) * 2 * Math.PI - Math.PI / 2;
                return (
                  <div
                    key={url ?? 'icon'}
                    className="absolute size-14"
                    style={{
                      left: `calc(50% + ${Math.cos(angle) * 80}px - 1.75rem)`,
                      top: `calc(50% + ${Math.sin(angle) * 80}px - 1.75rem)`,
                    }}
                  >
                    <div
                      className={`size-full overflow-hidden rounded-2xl bg-white shadow-md ring-2 ring-white ${UPRIGHT}`}
                    >
                      {url ? (
                        <img src={url} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[#2E6641]">
                          <Sparkles size={22} />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
              <p className="text-[0.9375rem] font-semibold text-[#0B0B0B]">Lager utkastet ditt</p>
              <p
                id="ai-loading-desc"
                aria-live="polite"
                className="mt-1 text-[0.8125rem] text-[#63665F]"
              >
                {urls.length ? 'Ser på bildene…' : 'Leser beskrivelsen…'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center rounded-full border border-[#E6E7E1] px-5 text-[0.875rem] font-medium text-[#0B0B0B] transition-colors hover:border-[#2E6641]/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/15"
          >
            Avbryt
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
