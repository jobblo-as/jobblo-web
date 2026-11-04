import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';
import { Bug, ImagePlus, Link2, Loader2, X } from 'lucide-react';
import { createBugReport } from '../../api/supportAPI';
import { useUserStore } from '../../stores/userStore';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { PILL_PRIMARY, PILL_SECONDARY } from '../../theme/brand';
import { useBugReport } from './store';

const MAX_SHOTS = 3;
const MAX_BYTES = 8 * 1024 * 1024; // the server's upload limit (middleware/upload.js)
const MIN_MESSAGE = 10;

/**
 * "Rapporter en feil", on the page it was opened from: what happened, screenshots the user
 * picks (up to 3), and — added by itself — the page URL, the screen size and, from an error
 * screen, the error reference. Lands in the developer dashboard (Tickets, type "Feil").
 */
export function BugReportDialog({
  open,
  onClose,
  errorRef = null,
}: {
  open: boolean;
  onClose: () => void;
  errorRef?: string | null;
}) {
  const user = useUserStore((s) => s.user);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [shots, setShots] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // The page it was opened on, captured once per opening.
  useEffect(() => {
    if (!open) return;
    setPageUrl(window.location.href);
    setError('');
  }, [open]);

  const previews = useMemo(() => shots.map((f) => URL.createObjectURL(f)), [shots]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  if (!open) return null;

  const close = () => {
    if (sending) return;
    onClose();
  };

  const addShots = (files: FileList | null) => {
    setError('');
    const picked = Array.from(files ?? []);
    const images = picked.filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    if (images.length < picked.length) setError('Bare bilder (PNG, JPG eller WEBP).');
    if (images.some((f) => f.size > MAX_BYTES)) {
      setError('Et bilde kan være maks 8 MB.');
      return;
    }
    setShots((prev) => [...prev, ...images].slice(0, MAX_SHOTS));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (message.trim().length < MIN_MESSAGE) {
      setError(`Beskriv feilen med minst ${MIN_MESSAGE} tegn.`);
      return;
    }
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Oppgi e-postadressen din, så vi kan svare.');
      return;
    }
    const form = new FormData();
    form.append('kind', 'bug');
    form.append('message', message.trim());
    form.append('pageUrl', pageUrl);
    form.append('platform', 'web');
    form.append('screen', `${window.innerWidth}x${window.innerHeight}`);
    if (errorRef) form.append('errorRef', errorRef);
    if (!user) form.append('email', email.trim());
    shots.forEach((f) => form.append('screenshots', f));
    setSending(true);
    setError('');
    try {
      await createBugReport(form);
      toast.success('Takk! Feilen er sendt til utviklerne.');
      setMessage('');
      setShots([]);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Kunne ikke sende rapporten. Prøv igjen.'));
    } finally {
      setSending(false);
    }
  };

  const path = pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        onSubmit={submit}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-[#E6E7E1] px-6 py-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#EAF1E9] text-[#2E6641]">
            <Bug size={19} strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="bug-report-title" className="text-[1.125rem] font-bold text-[#0B0B0B]">
              Rapporter en feil
            </h2>
            <p className="mt-0.5 text-[0.875rem] text-[#63665F]">
              Fortell hva som skjedde. Siden du er på legges ved automatisk.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Lukk"
            autoFocus
            className="rounded-full p-1.5 text-[#9B9E96] transition-colors hover:bg-[#F2F3EE]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <p className="flex items-center gap-2 rounded-xl bg-[#F4F6F0] px-3.5 py-2.5 text-[0.8125rem] text-[#63665F]">
            <Link2 size={14} className="shrink-0 text-[#2E6641]" aria-hidden="true" />
            <span className="min-w-0 truncate" title={pageUrl}>
              Side: <span className="font-semibold text-[#0B0B0B]">{path}</span>
            </span>
          </p>
          {errorRef && (
            <p className="text-[0.8125rem] text-[#63665F]">
              Feilreferanse: <span className="font-mono font-semibold">{errorRef}</span>
            </p>
          )}

          <label className="block">
            <span className="text-[0.875rem] font-semibold text-[#0B0B0B]">Hva skjedde?</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="F.eks. «Jeg trykket på Send søknad, men ingenting skjedde.»"
              className="mt-1.5 w-full resize-y rounded-xl border border-[#E6E7E1] px-4 py-3 text-[0.9375rem] outline-none transition-colors focus:border-[#2E6641]/45 focus:ring-4 focus:ring-[#2E6641]/10"
            />
          </label>

          {!user && (
            <label className="block">
              <span className="text-[0.875rem] font-semibold text-[#0B0B0B]">E-post</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="din@epost.no"
                className="mt-1.5 w-full rounded-xl border border-[#E6E7E1] px-4 py-3 text-[0.9375rem] outline-none focus:border-[#2E6641]/45 focus:ring-4 focus:ring-[#2E6641]/10"
              />
            </label>
          )}

          <div>
            <p className="text-[0.875rem] font-semibold text-[#0B0B0B]">
              Skjermbilder <span className="font-normal text-[#9B9E96]">(valgfritt, inntil 3)</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              {shots.map((file, i) => (
                <div key={`${file.name}-${i}`} className="relative">
                  <img
                    src={previews[i]}
                    alt={`Skjermbilde ${i + 1}`}
                    className="size-20 rounded-xl border border-[#E6E7E1] object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Fjern skjermbilde ${i + 1}`}
                    className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-[#0B0B0B] text-white"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {shots.length < MAX_SHOTS && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#C9CCC2] text-[0.75rem] font-medium text-[#63665F] transition-colors hover:border-[#2E6641]/45 hover:text-[#2E6641]"
                >
                  <ImagePlus size={18} aria-hidden="true" />
                  Legg til
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              aria-label="Velg skjermbilder"
              onChange={(e) => {
                addShots(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {error && (
            <p role="alert" className="text-[0.875rem] font-medium text-red-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2.5 border-t border-[#E6E7E1] px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} className={PILL_SECONDARY}>
            Avbryt
          </button>
          <button
            type="submit"
            disabled={sending}
            className={`${PILL_PRIMARY} disabled:opacity-60`}
          >
            {sending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {sending ? 'Sender…' : 'Send rapport'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Mounted once in App: the dialog for every "Rapporter en feil" link. */
export function BugReportHost() {
  const { open, errorRef, closeBugReport } = useBugReport();
  return <BugReportDialog open={open} onClose={closeBugReport} errorRef={errorRef} />;
}
