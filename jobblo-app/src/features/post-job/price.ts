/** Price rules for the post-job flow. Pure, so the check can run them. */
import type { CreateJobFormValues } from '../../services/createJob.service';
import { t } from './i18n';

type PriceValues = Pick<
  CreateJobFormValues,
  'paymentType' | 'price' | 'hourlyRate' | 'durationValue' | 'durationUnit'
>;

/** What applicants see: Timepris = rate × hours (a day = 8 h), as buildJobFormData sends it. */
export function totalPrice(v: PriceValues): number {
  if (v.paymentType !== 'Timepris') return Number(v.price) || 0;
  const d = Number(v.durationValue) || 0;
  const hours = v.durationUnit === 'days' ? d * 8 : v.durationUnit === 'minutes' ? d / 60 : d;
  return (Number(v.hourlyRate) || 0) * hours;
}

/** The evening/weekend rate (backend jobblo-pricing-config.json eveningWeekendPercent).
 * ponytail: a copy of the server's number; serve it from the API if it changes often. */
export const WEEKEND_PERCENT = 20;

/** Every day from `fromDate` to `toDate` ('YYYY-MM-DD', toDate optional) is a Saturday or Sunday. */
export function weekendOnly(fromDate: string, toDate = ''): boolean {
  const day = (v: string) => {
    const [y, m, d] = v.split('-').map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
  };
  const from = fromDate ? day(fromDate) : null;
  const to = toDate ? day(toDate) : from;
  if (!from || !to || to < from || to.getTime() - from.getTime() > 2 * 86_400_000) return false;
  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() % 6 !== 0) return false;
  return true;
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
  if (amount > 1_000_000)
    return t('Beløpet kan ikke være over 1 000 000 kr.', 'The amount cannot be over 1 000 000 kr.');
  if (!(Number(v.durationValue) > 0))
    return t('Velg hvor lang tid du tror det tar.', 'Choose how long you think it will take.');
  return '';
}
