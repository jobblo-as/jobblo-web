import mainLink from '../../api/mainURLs';

/** Renovation planner ("Oppussingskalkulator"). Rates live in the backend pricing config. */

export type Scope = 'surface' | 'full';
export type Quality = 'budget' | 'standard' | 'good' | 'premium';
export type AreaKey = 'bathroom' | 'kitchen' | 'rooms' | 'hallway' | 'windows' | 'exterior';

export type Catalogue = {
  areas: { key: AreaKey; label: string; surface: string; full: string }[];
  qualities: { key: Quality; label: string }[];
  scopes: { key: Scope; label: string }[];
  homeTypes: { key: string; label: string }[];
  defaults: { sizeM2: number; rooms: number; bathrooms: number };
  disclaimer: string;
};

export type HomeFacts = {
  sizeM2: number | null;
  rooms: number | null;
  bathrooms: number | null;
  yearBuilt: number | null;
  homeType: string | null;
  standardNotes: { area: AreaKey; text: string }[];
  outdatedAreas: AreaKey[];
  /** One per uploaded photo, in order: the area it shows, or null (whole home / unsure). */
  photoAreas: (AreaKey | null)[];
};

export type PlanArea = { key: AreaKey; scope: Scope; quality?: Quality };

export type PlanRequest = {
  facts: { sizeM2?: number; rooms?: number; bathrooms?: number };
  quality: Quality;
  areas: PlanArea[];
  budget?: number;
};

type Range = { low: number; high: number };

export type EstimateLine = Range & {
  key: AreaKey;
  label: string;
  scope: Scope;
  quality: Quality;
  quantity: number;
  unit: string;
  includes: string;
  labour: Range;
  materials: Range;
  weeks: [number, number];
  certified: string[];
  quote: boolean;
};

export type Estimate = {
  facts: { sizeM2: number; rooms: number; bathrooms: number };
  quality: Quality;
  areas: EstimateLine[];
  total: Range & { labour: Range; materials: Range; weeks: [number, number] };
  budget: null | {
    amount: number;
    status: 'within' | 'borderline' | 'over';
    overBy: number;
    suggestions: {
      key: AreaKey;
      change: { scope?: Scope; quality?: Quality };
      saving: number;
      text: string;
    }[];
  };
  disclaimer: string;
};

export const getRenovationCatalogue = async (): Promise<Catalogue> =>
  (await mainLink.get('/api/renovation/catalogue')).data;

export const postRenovationEstimate = async (plan: PlanRequest): Promise<Estimate> =>
  (await mainLink.post('/api/renovation/estimate', plan)).data;

export type FactsInput = { text: string; prospectus?: File | null; images?: File[] };

/**
 * AI: facts from the listing text, the prospectus PDF and/or up to 5 photos. Needs a
 * signed-in user (it is a paid AI call). Files go as multipart, text alone as JSON.
 */
export const postRenovationFacts = async ({
  text,
  prospectus,
  images = [],
}: FactsInput): Promise<HomeFacts> => {
  if (!prospectus && images.length === 0)
    return (await mainLink.post('/api/ai/renovation-facts', { text })).data.facts;
  const form = new FormData();
  if (text) form.append('text', text);
  if (prospectus) form.append('prospectus', prospectus);
  images.forEach((file) => form.append('images', file));
  return (await mainLink.post('/api/ai/renovation-facts', form)).data.facts;
};

/** What a saved plan stores: the request plus title, year, notes and FINN code. */
export type SavedPlanBody = PlanRequest & {
  title: string;
  facts: PlanRequest['facts'] & { yearBuilt?: number; homeType?: string };
  notes: HomeFacts['standardNotes'];
  finnCode?: string;
};

export type SavedPlan = {
  _id?: string;
  shareId?: string | null;
  title: string;
  plan: {
    facts: { sizeM2: number; rooms: number; bathrooms: number };
    quality: Quality;
    areas: { key: AreaKey; scope: Scope; quality: Quality }[];
    budget?: number;
  };
  yearBuilt: number | null;
  homeType: string | null;
  notes: HomeFacts['standardNotes'];
  finnCode: string | null;
  updatedAt: string;
  /** Recomputed at today's rates; null if the plan has an area the config no longer has. */
  estimate: Estimate | null;
};

export type SavedPlanSummary = {
  _id: string;
  title: string;
  updatedAt: string;
  shareId: string | null;
  total: { low: number; high: number } | null;
};

const planPath = (id: string) => `/api/renovation/plans/${encodeURIComponent(id)}`;

export const listRenovationPlans = async (): Promise<SavedPlanSummary[]> =>
  (await mainLink.get('/api/renovation/plans')).data.plans;

export const getRenovationPlan = async (id: string): Promise<SavedPlan> =>
  (await mainLink.get(planPath(id))).data.plan;

/** Creates when `id` is null. */
export const saveRenovationPlan = async (
  id: string | null,
  body: SavedPlanBody
): Promise<SavedPlan> =>
  id
    ? (await mainLink.put(planPath(id), body)).data.plan
    : (await mainLink.post('/api/renovation/plans', body)).data.plan;

export const deleteRenovationPlan = async (id: string): Promise<void> => {
  await mainLink.delete(planPath(id));
};

export const shareRenovationPlan = async (id: string): Promise<string> =>
  (await mainLink.post(`${planPath(id)}/share`)).data.shareId;

export const unshareRenovationPlan = async (id: string): Promise<void> => {
  await mainLink.delete(`${planPath(id)}/share`);
};

export const getSharedRenovationPlan = async (shareId: string): Promise<SavedPlan> =>
  (await mainLink.get(`/api/renovation/shared/${encodeURIComponent(shareId)}`)).data.plan;

/** "412345678", "finnkode=412345678" or a FINN URL → the code; '' when there is none. */
export const finnCodeOf = (value: string) =>
  (value.match(/(?:finnkode=|\/)(\d{6,12})(?:\D|$)/) || value.match(/^\s*(\d{6,12})\s*$/))?.[1] ??
  '';
