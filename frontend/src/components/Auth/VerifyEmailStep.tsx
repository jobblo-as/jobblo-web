import { useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import OtpInput from './OtpInput.tsx';
import OtpCountdown from './OtpCountdown.tsx';
import { PRIMARY_BUTTON } from './authStyles.ts';
import { useAuth } from '../../features/auth/hook/useAuth.ts';
import { getErrorMessage } from '../../utils/getErrorMessage.ts';

interface Props {
  email: string;
  /** The password just typed: the account is confirmed with it, so nobody else's survives. */
  password: string;
  onBack: () => void;
}

/**
 * "Bekreft e-post": the 6-digit code mailed at sign-up (or after a login refused with
 * EMAIL_NOT_VERIFIED). A right code signs the user in, like registration used to.
 */
export default function VerifyEmailStep({ email, password, onBack }: Props) {
  const { verifyEmail, isVerifyingEmail, resendVerification, isResendingVerification } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [countdownKey, setCountdownKey] = useState(0);
  const latest = useRef('');

  const submit = (value = code) => {
    if (value.length < 6 || isVerifyingEmail) return;
    setError('');
    verifyEmail(
      { email, code: value, password },
      { onError: (err: unknown) => setError(getErrorMessage(err, 'Ugyldig eller utløpt kode.')) }
    );
  };

  return (
    <div>
      <h1 className="text-[1.625rem] font-bold leading-tight tracking-[-0.025em] text-jb-ink">
        Bekreft e-post
      </h1>
      <p id="verify-email-help" className="mt-1.5 text-[0.875rem] leading-relaxed text-jb-ink-muted">
        Vi har sendt en 6-sifret kode til <span className="font-semibold text-jb-ink">{email}</span>.
        Skriv den inn for å fullføre.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
        className="mt-7 flex flex-col gap-5"
      >
        <div role="group" aria-label="Bekreftelseskode" aria-describedby="verify-email-help">
          <OtpInput
            value={code}
            onChange={(value) => {
              latest.current = value;
              setCode(value);
              setError('');
            }}
            // Last digit typed or a full code pasted. Called right after onChange, before
            // the state update lands, hence the ref.
            onComplete={() => submit(latest.current)}
            disabled={isVerifyingEmail}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-[#FCF4F3] px-3.5 py-2.5 text-[0.8125rem] leading-snug text-[#B0453B]"
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={code.length < 6 || isVerifyingEmail} className={PRIMARY_BUTTON}>
          {isVerifyingEmail && <Loader2 size={16} className="animate-spin" />}
          {isVerifyingEmail ? 'Bekrefter…' : 'Bekreft'}
        </button>

        <OtpCountdown
          key={countdownKey}
          seconds={60}
          isSending={isResendingVerification}
          onResend={() =>
            resendVerification(email, { onSuccess: () => setCountdownKey((k) => k + 1) })
          }
        />

        <button
          type="button"
          onClick={onBack}
          className="mx-auto flex items-center gap-1.5 rounded text-[0.8125rem] font-medium text-jb-ink-muted transition-colors hover:text-jb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/25"
        >
          <ArrowLeft size={14} />
          Tilbake
        </button>
      </form>
    </div>
  );
}
