import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { Loader2, Mail, MailCheck, X } from 'lucide-react';
import OtpInput from '../Auth/OtpInput.tsx';
import { confirmEmailCode, sendEmailCode } from '../../features/auth/Api';
import { useUserStore } from '../../stores/userStore';
import { getErrorMessage } from '../../utils/getErrorMessage';
import type { User } from '../../types/userTypes';

/**
 * The profile's "E-post" row: confirmed, or "ikke bekreftet" with a button that opens a popup
 * (send a code, type it). Nothing is locked while unconfirmed: a confirmed address is what
 * gets the account back if access is lost.
 *
 * Deliberately NOT BankID: no "Verifisert" wording and no badge — that is
 * IdentityVerificationCard (`identityVerified`), shown as its own section.
 * Owner only; mounted at two breakpoints like IdentityVerificationCard.
 */
const BUTTON =
  'flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[0.875rem] font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/20 disabled:cursor-not-allowed disabled:opacity-60';

export function EmailVerificationCard({
  user,
  isOwnProfile,
  className = '',
}: {
  user?: User | null;
  isOwnProfile: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const fetchProfile = useUserStore((state) => state.fetchProfile);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const latest = useRef('');

  if (!isOwnProfile || !user) return null;

  if (user.emailVerified !== false) {
    return (
      <section data-testid="email-verification-card" className={`rounded-3xl border border-[#E6E7E1] bg-white p-5 ${className}`}>
        <div className="flex items-start gap-3">
          <MailCheck size={20} strokeWidth={2.2} className="mt-0.5 shrink-0 text-[#2E6641]" />
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">E-post</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#63665F]">E-post bekreftet</p>
          </div>
        </div>
      </section>
    );
  }

  const send = async () => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const data = await sendEmailCode();
      setSent(data.message || `Vi har sendt en kode til ${user.email}.`);
    } catch (err) {
      setError(getErrorMessage(err, 'Kunne ikke sende koden. Prøv igjen.'));
    } finally {
      setSending(false);
    }
  };

  const confirm = async (value = code) => {
    if (value.length < 6 || confirming) return;
    setConfirming(true);
    setError('');
    try {
      await confirmEmailCode(value);
      setOpen(false);
      // The profile (store + the profile page's query) now says emailVerified: true.
      await Promise.all([fetchProfile?.(), queryClient.invalidateQueries({ queryKey: ['userProfile'] })]);
    } catch (err) {
      setError(getErrorMessage(err, 'Ugyldig eller utløpt kode.'));
    } finally {
      setConfirming(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setCode('');
    setError('');
    // Opening the popup is the request for a code: one tap fewer.
    if (!sent) void send();
  };

  return (
    <section data-testid="email-verification-card" className={`rounded-3xl border border-[#E8C9A0] bg-[#FDF6EC] p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <Mail size={20} strokeWidth={2.2} className="mt-0.5 shrink-0 text-[#9A5B13]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">E-post</h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#63665F]">
            E-posten din er ikke bekreftet. Bekreft den, så kan du få tilbake kontoen hvis du mister tilgangen.
          </p>

          <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Trigger asChild>
              <button type="button" className={`${BUTTON} mt-3 w-full bg-[#2E6641] text-white hover:bg-[#255335]`}>
                Bekreft e-post
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
              <Dialog.Content
                aria-describedby="email-verify-desc"
                className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-6 shadow-xl outline-none"
              >
                <div className="flex items-start justify-between gap-3">
                  <Dialog.Title className="text-[1.0625rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">Bekreft e-post</Dialog.Title>
                  <Dialog.Close aria-label="Lukk" className="-m-1 rounded-lg p-1 text-[#63665F] hover:bg-[#F2F3EE]">
                    <X size={18} />
                  </Dialog.Close>
                </div>
                <p id="email-verify-desc" role="status" className="mt-2 text-[0.875rem] leading-relaxed text-[#63665F]">
                  {sending && !sent ? 'Sender kode …' : sent || `Vi sender en kode til ${user.email}.`}
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirm();
                  }}
                  noValidate
                  className="mt-5 flex flex-col gap-4"
                >
                  <div role="group" aria-label="Bekreftelseskode for e-post">
                    <OtpInput
                      value={code}
                      onChange={(value) => {
                        latest.current = value;
                        setCode(value);
                        setError('');
                      }}
                      onComplete={() => void confirm(latest.current)}
                      disabled={confirming}
                    />
                  </div>

                  {error && (
                    <p role="alert" className="rounded-xl bg-[#FCF4F3] px-3 py-2 text-[0.8125rem] leading-snug text-[#B0453B]">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={code.length < 6 || confirming}
                    aria-busy={confirming}
                    className={`${BUTTON} bg-[#2E6641] text-white hover:bg-[#255335]`}
                  >
                    {confirming && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
                    {confirming ? 'Bekrefter…' : 'Bekreft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending}
                    aria-busy={sending}
                    className={`${BUTTON} border border-[#E6E7E1] bg-white text-[#0B0B0B] hover:bg-[#FAFBF7]`}
                  >
                    {sending && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
                    Send ny kode
                  </button>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </section>
  );
}
