import type {
  AreaKey,
  HomeFacts,
  PlanRequest,
  Quality,
  SavedPlan,
  SavedPlanBody,
  Scope,
} from '../../services/renovation.service';

/**
 * The planner's form state, as strings the inputs edit (port of the web's
 * frontend/src/features/renovation/planState.ts). The app keeps it in screen state: the
 * screen sits in the signed-in tabs, so there is no login detour to survive.
 */
export type AreaChoice = { scope: Scope; quality?: Quality };

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
  areas: Partial<Record<AreaKey, AreaChoice>>;
  quality: Quality;
  budget: string;
};

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
 * A saved plan back into form state. `own` keeps its id and share link; a plan that is not
 * the user's becomes a new, unsaved plan of their own.
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

/** The AI's facts merged into the form: known numbers replace, outdated areas get selected. */
export const withFacts = (state: PlanState, facts: HomeFacts): PlanState => {
  const keep = (value: number | null, current: string) =>
    value === null ? current : String(value);
  return {
    ...state,
    sizeM2: keep(facts.sizeM2, state.sizeM2),
    rooms: keep(facts.rooms, state.rooms),
    bathrooms: keep(facts.bathrooms, state.bathrooms),
    yearBuilt: keep(facts.yearBuilt, state.yearBuilt),
    homeType: facts.homeType ?? state.homeType,
    notes: facts.standardNotes,
    areas: {
      ...state.areas,
      ...Object.fromEntries(
        facts.outdatedAreas.map((k) => [k, state.areas[k] ?? { scope: 'surface' as Scope }])
      ),
    },
  };
};

/** "412345678", "finnkode=412345678" or a FINN URL → the code; '' when there is none. */
export const finnCodeOf = (value: string) =>
  (value.match(/(?:finnkode=|\/)(\d{6,12})(?:\D|$)/) || value.match(/^\s*(\d{6,12})\s*$/))?.[1] ??
  '';

/** Formatting shared by the planner screen. */
export const kr = (value: number) => `${value.toLocaleString('nb-NO')} kr`;
export const range = (low: number, high: number) =>
  low === high ? kr(low) : `${low.toLocaleString('nb-NO')}–${kr(high)}`;
export const weeks = ([min, max]: [number, number]) =>
  min === max ? `ca. ${min} uke${min === 1 ? '' : 'r'}` : `ca. ${min}–${max} uker`;
