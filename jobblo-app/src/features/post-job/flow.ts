/**
 * The "Legg ut oppdrag" flow, one question per screen (FINN Torget style):
 * photos → arrange photos → category → details → title/description → price → place → review.
 * Pure: the order and the photo rules live here so they can be checked without React.
 */

import { t } from './i18n';

export const STEPS = ['photos', 'photoGrid', 'category', 'details', 'text', 'price', 'place', 'review'] as const;
export type PostJobStep = (typeof STEPS)[number];

export const MAX_PHOTOS = 6;

/** Screen title per step (shown in the header). */
export const STEP_TITLES: Record<PostJobStep, string> = {
  photos: t('Bilder', 'Photos'),
  photoGrid: t('Legg til bilder', 'Add photos'),
  category: t('Kategori', 'Category'),
  details: t('Detaljer', 'Details'),
  text: t('Tittel og beskrivelse', 'Title and description'),
  price: t('Pris', 'Price'),
  place: t('Sted og tid', 'Place and time'),
  review: t('Se over', 'Review'),
};

/**
 * The camera's AI-helper line, by how many photos are taken (FINN: "whole item from the front",
 * then "at least five, different angles"). ponytail: scripted by count, not a look at the photo;
 * the photos are analysed by AI in the category step.
 */
export function cameraHint(photoCount: number): string {
  if (photoCount >= MAX_PHOTOS) return t('Maks antall bilder. Trykk «Ferdig» for å gå videre.', 'Maximum number of photos. Tap “Done” to continue.');
  if (photoCount === 0) return t('Ta et bilde av hele området som skal fikses – forfra!', 'Take a photo of the whole area that needs work – from the front!');
  if (photoCount === 1) return t('Bra! Ta et nærbilde av det som må gjøres.', 'Great! Now take a close-up of what needs to be done.');
  if (photoCount === MAX_PHOTOS - 1) return t('Ett bilde til, så har du fått med alt.', 'One more photo and you have it all.');
  return t('Ta flere bilder fra ulike vinkler – få med alt som er viktig for jobben.', 'Take more photos from different angles – include everything important for the job.');
}

/** What the camera AI helper said about a photo ('blurry' / 'dark' = it asked for a retake). */
export type PhotoQuality = 'ok' | 'blurry' | 'dark' | 'unclear';

/**
 * The photos the title/description may use: not the ones the AI helper asked to retake, so both
 * AI steps agree. Photos without a verdict (library uploads, helper offline) are used.
 */
/** A photo taken or picked now; an edited job's saved photos are https URLs on the server. */
export const isLocalPhoto = (photo: { uri: string }) => !/^https?:\/\//i.test(photo.uri);

export function photosForText<T extends { uri: string }>(photos: T[], quality: Record<string, PhotoQuality | undefined>) {
  // Saved photos can't be sent as files (the AI already wrote the text for them once).
  const local = photos.filter(isLocalPhoto);
  const use = local.filter((p) => quality[p.uri] !== 'blurry' && quality[p.uri] !== 'dark');
  return { use, skipped: local.length - use.length };
}

/**
 * Saving an edit: new photos are uploaded, saved ones the user removed are deleted.
 * ponytail: the server appends new photos after the kept ones, so re-ordering saved photos
 * is not saved; needs an `imageOrder` field on PUT /services/:id if that matters.
 */
export function editChanges<T extends { uri: string }>(photos: T[], existing: string[]) {
  const kept = new Set(photos.map((p) => p.uri));
  return { upload: photos.filter(isLocalPhoto), imagesToDelete: existing.filter((url) => !kept.has(url)) };
}

/** With no photos the arrange screen has nothing to show, so it is skipped both ways. */
export function nextStep(step: PostJobStep, photoCount: number): PostJobStep | null {
  if (step === 'photos') return photoCount > 0 ? 'photoGrid' : 'category';
  const i = STEPS.indexOf(step);
  return i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

export function previousStep(step: PostJobStep, photoCount: number): PostJobStep | null {
  if (step === 'category') return photoCount > 0 ? 'photoGrid' : 'photos';
  const i = STEPS.indexOf(step);
  return i > 0 ? STEPS[i - 1] : null;
}

/** 0..1 for the progress bar. */
export function progress(step: PostJobStep): number {
  return (STEPS.indexOf(step) + 1) / STEPS.length;
}

/** Adds up to the free slots, drops duplicates (same uri). */
export function addPhotos<T extends { uri: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((p) => p.uri));
  const fresh = incoming.filter((p) => !seen.has(p.uri) && seen.add(p.uri));
  return [...current, ...fresh].slice(0, MAX_PHOTOS);
}

/** Moves a photo to `to` (0 = the cover photo shown first on the job page). */
export function movePhoto<T>(photos: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= photos.length) return photos;
  const next = [...photos];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}
