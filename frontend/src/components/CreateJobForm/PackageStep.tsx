import { Check, CheckCircle2, Loader2, ShieldCheck, Zap } from 'lucide-react';
import { CARD } from '../../theme/brand';

// ponytail: mirrors URGENT_PRICE_NOK in backend/services/urgentPurchase.js (the server charges
// its own value; this is only the label).
const URGENT_PRICE_NOK = 39;

const PACKAGES = [
  {
    urgent: false,
    name: 'Standard',
    price: 'Gratis',
    points: ['Synlig i søk og på kartet', 'Søkere kan kontakte deg'],
  },
  {
    urgent: true,
    name: 'Hast',
    price: `${URGENT_PRICE_NOK} kr`,
    points: [
      'Alt i Standard',
      'Merket «Haster» på oppdraget',
      'Vises når noen filtrerer på «Haster»',
    ],
  },
];

/**
 * "Nesten ferdig": the last screen of a new job. SafePay explained, then the package:
 * Standard is free; Hast is paid on Stripe first, Stripe returns here, and only then is the
 * job published (the server checks the payment before marking it «Haster»).
 */
export function PackageStep(props: PackageProps) {
  return (
    <div className="space-y-5">
      <SafePayNote />
      <PackageCards {...props} />
    </div>
  );
}

interface PackageProps {
  urgent: boolean;
  setUrgent: (urgent: boolean) => void;
  /** Hast: pay on Stripe first; Stripe returns here. The bar's publish waits for it. */
  onPay: () => void;
  /** On the way to Stripe, or confirming the payment after coming back. */
  paying: boolean;
  /** Stripe confirmed the 39 kr: publishing now marks the job «Haster». */
  paid: boolean;
}

// The same three stages as the landing page's SafePayExplainer: the actual escrow behaviour.
const SAFEPAY_STAGES = [
  'Når du velger en tilbyder, betaler du til SafePay. Pengene holdes trygt.',
  'Tilbyderen gjør jobben og markerer den som ferdig.',
  'Du godkjenner, og først da utbetales pengene. Er noe galt, kan du åpne en tvist.',
];

/** SafePay before publishing (FINN's "Fiks ferdig" screen). Info only: every hire uses it. */
function SafePayNote() {
  return (
    <section aria-labelledby="safepay-heading" className={`${CARD} p-5 md:p-6`}>
      <h2
        id="safepay-heading"
        className="flex items-center gap-2 text-lg font-bold md:text-xl text-[#0B0B0B]"
      >
        <ShieldCheck size={20} className="text-[#2E6641]" /> Trygg betaling med SafePay
      </h2>
      <p className="mt-1 text-[0.875rem] text-[#63665F]">
        Det koster ingenting å publisere. Du betaler først når du velger en tilbyder.
      </p>
      <ol className="mt-4 space-y-2.5">
        {SAFEPAY_STAGES.map((text, i) => (
          <li key={text} className="flex items-start gap-3 text-[0.875rem] text-[#0B0B0B]">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#F4F8F3] text-[0.8125rem] font-semibold text-[#2E6641]">
              {i + 1}
            </span>
            {text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PackageCards({ urgent, setUrgent, onPay, paying, paid }: PackageProps) {
  return (
    <section aria-labelledby="package-heading" className={`${CARD} p-5 md:p-6`}>
      <h2 id="package-heading" className="text-lg font-bold md:text-xl text-[#0B0B0B]">
        Nesten ferdig!
      </h2>
      <p className="mt-1 text-[0.875rem] text-[#63665F]">Velg pakken som passer for oppdraget.</p>

      <div role="radiogroup" aria-label="Pakke" className="mt-5 grid gap-3 sm:grid-cols-2">
        {PACKAGES.map((p) => {
          const picked = urgent === p.urgent;
          return (
            <label
              key={p.name}
              className={`flex cursor-pointer flex-col rounded-2xl border-2 p-4 transition-colors ${
                picked
                  ? 'border-[#2E6641] bg-[#F4F8F3]'
                  : 'border-[#E6E7E1] bg-white hover:border-[#2E6641]/45'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-[#0B0B0B]">
                  {p.urgent && <Zap size={15} className="text-[#2E6641]" />}
                  {p.name}
                </span>
                <input
                  type="radio"
                  name="package"
                  checked={picked}
                  onChange={() => setUrgent(p.urgent)}
                  // Paid for: switching to Standard would throw the 39 kr away.
                  disabled={paid && !p.urgent}
                  className="size-4.5 accent-[#2E6641]"
                />
              </span>
              <span className="mt-2 text-[1.5rem] font-bold tracking-[-0.03em] text-[#0B0B0B]">
                {p.price}
              </span>
              <ul className="mt-3 space-y-1.5">
                {p.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-1.5 text-[0.8125rem] text-[#63665F]"
                  >
                    <Check size={14} className="mt-0.5 shrink-0 text-[#2E6641]" />
                    {point}
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-[#E6E7E1] pt-4">
        <span className="text-[0.9375rem] font-semibold text-[#0B0B0B]">Totalt</span>
        <span className="text-[1.125rem] font-bold tabular-nums text-[#0B0B0B]">
          {urgent ? `${URGENT_PRICE_NOK} kr` : '0 kr'}
        </span>
      </div>
      {urgent && paid && (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 rounded-2xl bg-[#F4F8F3] p-3 text-[0.875rem] font-medium text-[#2E6641]"
        >
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          Betalingen er fullført ({URGENT_PRICE_NOK} kr). Publiser oppdraget, så merkes det
          «Haster».
        </p>
      )}
      {urgent && !paid && (
        <>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-[#63665F]">
            Du betaler med kort hos Stripe og kommer tilbake hit. Deretter publiserer du oppdraget.
          </p>
          <button
            type="button"
            onClick={onPay}
            disabled={paying}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#2E6641] px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#255335] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paying ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {paying ? 'Vent litt…' : `Betal ${URGENT_PRICE_NOK} kr`}
          </button>
        </>
      )}
    </section>
  );
}
