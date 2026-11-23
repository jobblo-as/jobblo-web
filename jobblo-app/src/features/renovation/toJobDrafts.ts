import type { Estimate, HomeFacts } from '../../services/renovation.service';

/**
 * "Legg ut som oppdrag": one job draft ("Dine utkast") per area of the estimate. Port of the
 * web's frontend/src/features/renovation/toJobDrafts.ts; drafts use the web shape, so the
 * app's post-job flow (draft.ts fromDraftData) and the web both open them.
 *
 * Certified work (and anything above the job price limit) is a quote request ("Anbud"); the
 * form needs an expected budget for that, so it gets the low end of the estimate.
 */

const CATEGORY = 'Oppussing';
const PRICE_MAX = 1_000_000; // JOB_LIMITS.PRICE_MAX
const QUALITY_NO = { budget: 'budsjett', standard: 'standard', good: 'god', premium: 'premium' };

const kr = (value: number) => value.toLocaleString('nb-NO');
const roundThousand = (value: number) => Math.round(value / 1000) * 1000;

export type RenovationJobDraft = {
  title: string;
  description: string;
  categories: string;
  paymentType: 'Fastpris' | 'Anbud';
  price: string;
  currentStep: number;
};

export function toJobDrafts(
  estimate: Estimate,
  notes: HomeFacts['standardNotes'] = []
): RenovationJobDraft[] {
  return estimate.areas.map((line) => {
    const mid = roundThousand((line.low + line.high) / 2);
    const quote = line.quote || mid > PRICE_MAX;
    const scope = line.scope === 'full' ? 'Total oppussing' : 'Overflateoppussing';
    const amount = line.unit ? ` (${line.quantity} ${line.unit})` : '';
    const areaNotes = notes.filter((n) => n.area === line.key).map((n) => `- ${n.text}`);

    const description = [
      `${scope} av ${line.label.toLowerCase()}${amount}. ${line.includes}`,
      `Ønsket kvalitet: ${QUALITY_NO[line.quality]}.`,
      areaNotes.length ? `Om dagens standard:\n${areaNotes.join('\n')}` : '',
      line.certified.length
        ? `Krever sertifisert fagperson (${line.certified.join(', ')}). Jeg ber om anbud.`
        : '',
      `Anslag fra Jobblos oppussingskalkulator: ${kr(line.low)}–${kr(line.high)} kr ` +
        `(arbeid ca. ${kr(line.labour.low)}–${kr(line.labour.high)} kr, materialer ca. ` +
        `${kr(line.materials.low)}–${kr(line.materials.high)} kr). ${estimate.disclaimer}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      title: `${scope} av ${line.label.toLowerCase()}`,
      description,
      categories: CATEGORY,
      paymentType: quote ? 'Anbud' : 'Fastpris',
      price: String(Math.min(PRICE_MAX, quote ? line.low : mid)),
      currentStep: 1,
    };
  });
}

/** Photos on one job: a job takes 6 (the job form's limit). */
export const MAX_JOB_PHOTOS = 6;

/**
 * The listing photos for one area's job: the ones tagged with that area, then the ones tagged
 * for the whole home (area ''), so the provider sees the rooms the job is about.
 */
export const photosForArea = <T extends { area: string }>(photos: T[], area: string): T[] =>
  [...photos.filter((p) => p.area === area), ...photos.filter((p) => !p.area)].slice(
    0,
    MAX_JOB_PHOTOS
  );
