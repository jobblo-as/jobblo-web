import mainLink from './mainURLs';

export interface AISmartFillContext {
  /**
   * UI locale from LanguageContext. The backend answers in this language.
   * When omitted the backend sniffs the prompt text instead, so this is an
   * override rather than a requirement.
   */
  lang?: 'no' | 'en';
  existingTitle?: string;
  existingDescription?: string;
  existingCategory?: string;
  existingPaymentType?: 'Timepris' | 'Fastpris' | 'Anbud';
  existingDuration?: { value: number | string; unit: 'minutes' | 'hours' | 'days' };
  existingCity?: string;
  existingCounty?: string;
  existingCountyCode?: string;
  existingEquipment?: string;
  existingUrgent?: boolean;
}

interface AIDuration {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
}

interface AIJobListingResponse {
  success: boolean;
  data: {
    title: string;
    description: string;
    category: string;
    skills: string[];
    /**
     * What the model chose to ASK about rather than invent. Empty when the
     * user's input was already complete enough.
     */
    openQuestions?: string[];
    /** Short steps for the job's checklist ("Sjekkliste"). */
    checklist?: string[];
    duration: AIDuration;
    locationRelevance: 'on-site' | 'remote';
    priceRange: { min: number; max: number };
    hourlyRate?: number;
    suggestedPrice?: number;
    priceMin?: number;
    priceMax?: number;
    estimatedPrice?: number;
    pricingReasoning?: string;
    paymentType: 'Timepris' | 'Fastpris' | 'Anbud';
    isEstimate: boolean;
  };
  error?: string;
  message?: string;
  validationErrors?: string[];
}

/**
 * "Foreslå et utkast": text, up to 3 photos, or both. With photos the request is multipart
 * (the server reads every field as text there).
 */
export const generateFullJobListing = async (
  prompt: string,
  ctx: AISmartFillContext = {},
  images: File[] = [],
  signal?: AbortSignal
): Promise<AIJobListingResponse> => {
  const fields = {
    prompt,
    lang: ctx.lang,
    existingTitle: ctx.existingTitle,
    existingDescription: ctx.existingDescription,
    existingCategory: ctx.existingCategory,
    existingPaymentType: ctx.existingPaymentType,
    existingDuration: ctx.existingDuration,
    existingCity: ctx.existingCity,
    existingCounty: ctx.existingCounty ?? ctx.existingCountyCode,
    existingEquipment: ctx.existingEquipment,
    existingUrgent: ctx.existingUrgent,
  };
  if (!images.length) {
    return (await mainLink.post('/api/ai/generate-full-listing', fields, { signal })).data;
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '')
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  images.slice(0, 3).forEach((file) => form.append('images', file));
  return (await mainLink.post('/api/ai/generate-full-listing', form, { signal })).data;
};
