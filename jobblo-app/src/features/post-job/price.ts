/** Price rules for the post-job flow. Pure, so the check can run them. */
import type { CreateJobFormValues } from '../../services/createJob.service';
import { t } from './i18n';

type PriceValues = Pick<CreateJobFormValues, 'paymentType' | 'price' | 'hourlyRate' | 'durationValue' | 'durationUnit'>;

/** What applicants see: Timepris = rate × hours (a day = 8 h), as buildJobFormData sends it. */
export function totalPrice(v: PriceValues): number {
  if (v.paymentType !== 'Timepris') return Number(v.price) || 0;
  const d = Number(v.durationValue) || 0;
  const hours = v.durationUnit === 'days' ? d * 8 : v.durationUnit === 'minutes' ? d / 60 : d;
  return (Number(v.hourlyRate) || 0) * hours;
}

/** '' when the price step may continue; otherwise what is wrong (same limits as createJobValidation). */
export function priceProblem(v: PriceValues): string {
  const timepris = v.paymentType === 'Timepris';
  const amount = Number(timepris ? v.hourlyRate : v.price) || 0;
  if (amount <= 0)
    return timepris
      ? t('Oppgi en timepris over 0 kr.', 'Enter an hourly rate above 0 kr.')
      : v.paymentType === 'Anbud'
        ? t('Oppgi et antatt budsjett over 0 kr.', 'Enter an estimated budget above 0 kr.')
        : t('Oppgi en pris over 0 kr.', 'Enter a price above 0 kr.');
  if (amount > 1_000_000) return t('Beløpet kan ikke være over 1 000 000 kr.', 'The amount cannot be over 1 000 000 kr.');
  if (!(Number(v.durationValue) > 0)) return t('Velg hvor lang tid du tror det tar.', 'Choose how long you think it will take.');
  return '';
}
