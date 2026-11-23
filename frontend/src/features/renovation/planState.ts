import type {
  AreaKey,
  HomeFacts,
  PlanRequest,
  Quality,
  SavedPlan,
  SavedPlanBody,
  Scope,
} from './renovationAPI';

/**
 * The planner's form state, as strings the inputs edit. Kept in sessionStorage so the plan
 * survives the login detour (and "Lag din egen plan" from a shared plan lands in it).
 */
export type PlanState = {
  /** The saved plan this form edits ("Mine planer"); null for a new one. */
  planId: string | null;
  shareId: string | null;
  title: string;
  finnInput: string;
  listingText: string;
  sizeM2: string;
  rooms: string;
  bathrooms: string;
  yearBuilt: string;
  /** Leilighet, enebolig …: read from the listing or picked; shown and saved, not priced. */
  homeType: string;
  notes: HomeFacts['standardNotes'];
  areas: Partial<Record<AreaKey, { scope: Scope; quality?: Quality }>>;
  quality: Quality;
  budget: string;
};

export const PLAN_STORAGE_KEY = 'jobblo-renovation-plan';

export const EMPTY_PLAN: PlanState = {
  planId: null,
  shareId: null,
  title: '',
  finnInput: '',
  listingText: '',
  sizeM2: '',
  rooms: '',
  bathrooms: '',
  yearBuilt: '',
  homeType: '',
  notes: [],
  areas: {},
  quality: 'standard',
  budget: '',
};

export const loadPlanState = (): PlanState => {
  try {
    const raw = sessionStorage.getItem(PLAN_STORAGE_KEY);
    return raw ? { ...EMPTY_PLAN, ...JSON.parse(raw) } : EMPTY_PLAN;
  } catch {
    return EMPTY_PLAN;
  }
};

export const storePlanState = (state: PlanState) => {
  try {
    sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: the planner still works, it just forgets on reload */
  }
};

const toNumber = (value: string) => {
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? n : undefined;
};

export const selectedAreas = (state: PlanState) =>
  (Object.keys(state.areas) as AreaKey[]).filter((key) => state.areas[key]);

export const toPlanRequest = (state: PlanState): PlanRequest => ({
  facts: {
    sizeM2: toNumber(state.sizeM2),
    rooms: toNumber(state.rooms),
    bathrooms: toNumber(state.bathrooms),
  },
  quality: state.quality,
  areas: selectedAreas(state).map((key) => ({ key, ...state.areas[key]! })),
  budget: toNumber(state.budget),
});

export const toSavedPlanBody = (state: PlanState): SavedPlanBody => {
  const request = toPlanRequest(state);
  return {
    ...request,
    title: state.title.trim() || 'Min oppussingsplan',
    facts: {
      ...request.facts,
      yearBuilt: toNumber(state.yearBuilt),
      homeType: state.homeType || undefined,
    },
    notes: state.notes,
    finnCode: state.finnInput,
  };
};

/**
 * A saved (or shared) plan back into form state. `own` keeps its id and share link; a
 * shared plan copied by a visitor becomes a new, unsaved plan of their own.
 */
export const fromSavedPlan = (saved: SavedPlan, own: boolean): PlanState => ({
  ...EMPTY_PLAN,
  planId: own ? (saved._id ?? null) : null,
  shareId: own ? (saved.shareId ?? null) : null,
  title: saved.title,
  finnInput: saved.finnCode ?? '',
  sizeM2: String(saved.plan.facts.sizeM2),
  rooms: String(saved.plan.facts.rooms),
  bathrooms: String(saved.plan.facts.bathrooms),
  yearBuilt: saved.yearBuilt ? String(saved.yearBuilt) : '',
  homeType: saved.homeType ?? '',
  notes: saved.notes,
  quality: saved.plan.quality,
  budget: saved.plan.budget ? String(saved.plan.budget) : '',
  areas: Object.fromEntries(
    saved.plan.areas.map((a) => [
      a.key,
      { scope: a.scope, ...(a.quality !== saved.plan.quality ? { quality: a.quality } : {}) },
    ])
  ),
});
