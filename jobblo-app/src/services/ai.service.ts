import apiClient from '../api/client';

/** Up to 3 active category names, best first, from up to 3 photos and/or a short text. */
export async function suggestCategories(
  photos: { uri: string; name: string; type: string }[],
  text = ''
): Promise<string[]> {
  const formData = new FormData();
  for (const photo of photos.slice(0, 3)) formData.append('images', photo as unknown as Blob);
  if (text.trim()) formData.append('text', text.trim());
  const response = await apiClient.post<{
    success: boolean;
    suggestions?: string[];
    error?: string;
  }>('/ai/suggest-categories', formData);
  if (!response.data.success) throw new Error(response.data.error ?? 'Kunne ikke foreslå kategori');
  return response.data.suggestions ?? [];
}

export interface ListingDraft {
  title: string;
  description: string;
  category?: string;
  paymentType?: 'Timepris' | 'Fastpris' | 'Anbud';
  hourlyRate?: number;
  suggestedPrice?: number;
  priceMin?: number;
  priceMax?: number;
  duration?: { value: number; unit: 'minutes' | 'hours' | 'days' };
  /** "Prisen er et anslag …", plus what is included, "be om anbud" or "Basert på 25 …". */
  pricingReasoning?: string;
  /** Anbud with no table price (bathroom): show no figure. */
  priceHidden?: boolean;
  /** The pricing job type, saved on the job. */
  jobType?: string;
  /** The evening/weekend rate is already in the price (the user wrote "lørdag", "kveld"…). */
  eveningWeekend?: boolean;
}

/**
 * Title + description (and a price/time estimate) from the photos and what the user told us:
 * the post-job flow's "Generer tittel og beskrivelse". Up to 3 photos ride along.
 */
export async function writeListing(
  photos: { uri: string; name: string; type: string }[],
  prompt: string,
  context: {
    category?: string;
    equipment?: string;
    urgent?: boolean;
    duration?: { value: string; unit: string };
    lang?: 'no' | 'en';
  }
): Promise<ListingDraft> {
  const body = new FormData();
  for (const photo of photos.slice(0, 3)) body.append('images', photo as unknown as Blob);
  body.append('prompt', prompt);
  body.append('lang', context.lang ?? 'no');
  if (context.category) body.append('existingCategory', context.category);
  if (context.equipment) body.append('existingEquipment', context.equipment);
  if (context.urgent) body.append('existingUrgent', 'true');
  if (context.duration?.value) body.append('existingDuration', JSON.stringify(context.duration));
  const response = await apiClient.post<{ success: boolean; data?: ListingDraft; error?: string }>(
    '/ai/generate-full-listing',
    body
  );
  if (!response.data.success || !response.data.data)
    throw new Error(response.data.error ?? 'Kunne ikke skrive annonsen');
  return response.data.data;
}

export interface PriceStats {
  count: number;
  low: number | null;
  median: number | null;
  high: number | null;
  scope: 'county' | 'country';
}

/** What 20+ completed similar jobs were agreed for (25th / 50th / 75th percentile). */
export async function getPriceStats(
  category: string,
  countyCode?: string,
  jobType?: string
): Promise<PriceStats> {
  const response = await apiClient.get<PriceStats>('/services/price-stats', {
    params: { category, countyCode: countyCode || undefined, jobType: jobType || undefined },
  });
  return response.data;
}

export interface PhotoHint {
  hint: string;
  /** What the photo shows, as plain facts: feeds the title/description. */
  seen: string;
  /** 'blurry' | 'dark': ask for a retake. 'unclear': the photo does not show a job. */
  quality: 'ok' | 'blurry' | 'dark' | 'unclear';
}

/** The camera's AI helper: what the AI sees in this photo and what to photograph next. */
export async function getPhotoHint(
  photo: { uri: string; name: string; type: string },
  count: number,
  lang: 'no' | 'en',
  /** What the earlier photos showed and the advice already given: so the helper does not repeat itself. */
  earlier: { seen: string[]; hints: string[] } = { seen: [], hints: [] }
): Promise<PhotoHint> {
  const body = new FormData();
  body.append('image', photo as unknown as Blob);
  body.append('count', String(count));
  body.append('lang', lang);
  if (earlier.seen.length) body.append('previousSeen', JSON.stringify(earlier.seen));
  if (earlier.hints.length) body.append('previousHints', JSON.stringify(earlier.hints));
  const response = await apiClient.post<{
    success: boolean;
    hint?: string;
    seen?: string;
    quality?: PhotoHint['quality'];
    error?: string;
  }>('/ai/photo-hint', body, { timeout: 20_000 });
  if (!response.data.success || !response.data.hint)
    throw new Error(response.data.error ?? 'No hint');
  return {
    hint: response.data.hint,
    seen: response.data.seen ?? '',
    quality: response.data.quality ?? 'ok',
  };
}
