import apiClient from '../api/client';
import type { CreateJobImage } from './createJob.service';

/**
 * Renovation planner ("Oppussingskalkulator"), backend routes/renovation.js and
 * POST /api/ai/renovation-facts. Same types as the web (frontend features/renovation).
 */

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

export async function getRenovationCatalogue(): Promise<Catalogue> {
  return (await apiClient.get<Catalogue>('/renovation/catalogue')).data;
}

export async function postRenovationEstimate(plan: PlanRequest): Promise<Estimate> {
  return (await apiClient.post<Estimate>('/renovation/estimate', plan)).data;
}

export type FactsInput = {
  text: string;
  prospectus?: CreateJobImage | null;
  images?: CreateJobImage[];
};

/**
 * AI: facts from the listing text, the prospectus PDF and/or up to 5 photos (signed in only).
 * Files go as multipart, text alone as JSON.
 */
export async function postRenovationFacts({
  text,
  prospectus,
  images = [],
}: FactsInput): Promise<HomeFacts> {
  if (!prospectus && images.length === 0)
    return (await apiClient.post<{ facts: HomeFacts }>('/ai/renovation-facts', { text })).data
      .facts;
  const form = new FormData();
  if (text) form.append('text', text);
  if (prospectus) form.append('prospectus', prospectus as unknown as Blob);
  images.forEach((photo) => form.append('images', photo as unknown as Blob));
  const { data } = await apiClient.post<{ facts: HomeFacts }>('/ai/renovation-facts', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // A prospectus and photos take the AI a while to read.
    timeout: 120_000,
  });
  return data.facts;
}

const planPath = (id: string) => `/renovation/plans/${encodeURIComponent(id)}`;

export async function listRenovationPlans(): Promise<SavedPlanSummary[]> {
  return (await apiClient.get<{ plans: SavedPlanSummary[] }>('/renovation/plans')).data.plans;
}

export async function getRenovationPlan(id: string): Promise<SavedPlan> {
  return (await apiClient.get<{ plan: SavedPlan }>(planPath(id))).data.plan;
}

/** Creates when `id` is null. */
export async function saveRenovationPlan(
  id: string | null,
  body: SavedPlanBody
): Promise<SavedPlan> {
  const response = id
    ? await apiClient.put<{ plan: SavedPlan }>(planPath(id), body)
    : await apiClient.post<{ plan: SavedPlan }>('/renovation/plans', body);
  return response.data.plan;
}

export async function deleteRenovationPlan(id: string): Promise<void> {
  await apiClient.delete(planPath(id));
}

export async function shareRenovationPlan(id: string): Promise<string> {
  return (await apiClient.post<{ shareId: string }>(`${planPath(id)}/share`)).data.shareId;
}

export async function unshareRenovationPlan(id: string): Promise<void> {
  await apiClient.delete(`${planPath(id)}/share`);
}
