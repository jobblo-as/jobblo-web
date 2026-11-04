import React, { useEffect, useRef } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { formatPhone, isValidPhone, phoneDigits } from '../../utils/norwegianFormat';

interface ContactInformationProps {
  phone: string;
  setPhone: (val: string) => void;
  email: string;
  setEmail: (val: string) => void;
  errors?: Partial<Record<string, string>>;
  /** A new job needs the phone; editing an old one does not (it may predate the rule). */
  phoneRequired?: boolean;
}

export const ContactInformation: React.FC<ContactInformationProps> = ({
  phone,
  setPhone,
  email,
  setEmail,
  errors,
  phoneRequired = true,
}) => {
  // Required. The form's own check (errors.phone, on publish) catches an empty field; while
  // typing, complain only once eight digits are in and still cannot be a Norwegian number.
  const phoneError =
    errors?.phone ||
    (phone.length >= 8 && !isValidPhone(phone) ? 'Et norsk nummer har åtte siffer.' : '');
  const showPhoneError = !!phoneError;

  // `open` below only applies when its value changes: if the section was closed by hand while
  // the phone was empty, a later "Legg til telefonnummeret ditt" left the field hidden and
  // the toast pointed at nothing. A new error opens it here, so scrollToFirstError can reach it.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if ((errors?.phone || errors?.email) && detailsRef.current) detailsRef.current.open = true;
    // On `errors` itself: every validation run sets a new object, so a second press of
    // "Gå videre" reopens it even when the message is the same.
  }, [errors]);

  return (
    // Folded when the profile filled it in. Open when the phone is missing (nothing to fill
    // from) or an error points into it — publish must never point at a hidden field.
    <details
      ref={detailsRef}
      open={(phoneRequired && !phone) || !!errors?.email || !!errors?.phone || undefined}
      className="group box-card-custom p-4 md:p-6 rounded-[14px]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 group-open:mb-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h2 className="font-bold text-lg md:text-xl">Kontaktinformasjon</h2>
          <span className="block truncate text-xs text-gray-500 md:text-sm">
            {[phone && formatPhone(phone), email].filter(Boolean).join(' · ') ||
              (phoneRequired ? 'Telefonnummer mangler' : 'Ikke oppgitt')}
          </span>
        </span>
        <ChevronDown
          size={18}
          className="ml-auto shrink-0 text-[#63665F] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="space-y-2">
          <label
            htmlFor="job-phone"
            className="text-xs md:text-sm font-bold text-gray-700 uppercase tracking-wider"
          >
            Telefonnummer {phoneRequired && <span className="text-red-500">*</span>}
          </label>
          {/*
              Was `type="number"`, which is wrong for a phone number in every way that
              matters: a number spinner appears beside it, scrolling the wheel over the
              focused field silently changes the value, `e`, `+` and `-` are accepted
              because they are legal in a JS number literal, and any leading zero is
              dropped. It is a `tel` field now, and the digits are grouped as they are
              typed — `412 34 567` for mobile, `22 12 34 56` for landline.

              State stays as bare digits; only the display is masked. Storing "412 34 567"
              would mean the same number is written three ways across the database.
            */}
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 select-none text-[0.9375rem] text-[#9B9E96] md:left-6">
              +47
            </span>
            <input
              id="job-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={formatPhone(phone)}
              onChange={(e) => setPhone(phoneDigits(e.target.value))}
              placeholder="412 34 567"
              aria-invalid={showPhoneError || undefined}
              aria-required={phoneRequired || undefined}
              aria-describedby={showPhoneError ? 'job-phone-error' : undefined}
              className={`w-full rounded-xl border bg-white py-3 pl-14 pr-4 outline-none transition-all md:py-4 md:pl-18 md:pr-6 ${
                showPhoneError
                  ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5'
                  : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'
              }`}
            />
          </div>
          {showPhoneError && (
            <p
              id="job-phone-error"
              className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-red-500 animate-in fade-in slide-in-from-top-1 md:text-xs"
            >
              <AlertCircle size={12} /> {phoneError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label
            htmlFor="job-email"
            className="text-xs md:text-sm font-bold text-gray-700 uppercase tracking-wider"
          >
            E-post
          </label>
          <input
            id="job-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="din@epost.no"
            className={`w-full px-4 md:px-6 py-3 md:py-4 rounded-xl border bg-white outline-none transition-all
                ${errors?.email ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5' : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'}`}
          />
          {errors?.email && (
            <p className="mt-1 text-red-500 text-[10px] md:text-xs font-bold flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
              <AlertCircle size={12} /> {errors.email}
            </p>
          )}
        </div>
      </div>
    </details>
  );
};
