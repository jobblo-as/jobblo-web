/**
 * One short line describing what the AI filled in.
 *
 * There are two AI paths on the job form — the per-field buttons inside
 * `BasicInformation`, and smart-fill in `useCreateJobForm` — and each used to write its own
 * confirmation. The smart-fill one read as a paragraph: the list of fields, "Priser er
 * estimater — rediger fritt.", and then the model's whole pricing rationale in parentheses.
 * Inside a toast capped at 30rem that renders as a five-line slab sitting over the form for
 * six seconds.
 *
 * A confirmation should say what changed and get out of the way. The rationale is worth
 * reading, but next to the price it explains — not in a toast that vanishes on a timer.
 */

const FIELD_LABELS: Record<string, string> = {
  title: 'tittel',
  description: 'beskrivelse',
  categories: 'kategori',
  price: 'pris',
  duration: 'varighet',
  hourlyRate: 'timepris',
  tags: 'ferdigheter',
};

/**
 * Names the fields while there are few enough to name, counts them once there are not.
 * "AI fylte ut tittel, beskrivelse, kategori, pris, varighet" is a list nobody reads; at
 * that point "AI fylte ut 5 felter" carries the same information in a glance.
 */
export const summariseAiFill = (flags: Record<string, boolean | undefined>): string => {
  const filled = Object.keys(FIELD_LABELS).filter((key) => flags[key]);
  if (filled.length === 0) return 'Ingen nye forslag';
  if (filled.length === 1) return `AI fylte ut ${FIELD_LABELS[filled[0]]}`;
  if (filled.length === 2) return `AI fylte ut ${filled.map((f) => FIELD_LABELS[f]).join(' og ')}`;
  return `AI fylte ut ${filled.length} felter`;
};

/** Server messages are not written for a toast; keep them to one line. */
export const clampMessage = (message: string, max = 90): string =>
  message.length > max ? `${message.slice(0, max - 1).trimEnd()}…` : message;

/** An AI suggestion before review: every field optional, nothing applied yet. */
export type AiDraft = {
  title?: string;
  description?: string;
  categories?: string;
  duration?: { value: number | string; unit: 'minutes' | 'hours' | 'days' };
  price?: number;
  hourlyRate?: number;
  paymentType?: 'Timepris' | 'Fastpris' | 'Anbud';
  tags?: string[];
  remote?: boolean;
  pricingReasoning?: string;
};
export type AiDraftKey =
  | 'title'
  | 'description'
  | 'categories'
  | 'duration'
  | 'price'
  | 'hourlyRate'
  | 'paymentType'
  | 'tags';
export type AiDraftRow = { key: AiDraftKey; label: string; value: string; overwrites: boolean };

const UNIT: Record<string, string> = { minutes: 'minutter', hours: 'timer', days: 'dager' };
const kr = (n: number) => `${n.toLocaleString('nb-NO')} kr`;

/**
 * The review popup's rows, in form order. `has` says which fields already hold the user's
 * own text: those rows start unticked, so a suggestion never silently replaces what was typed.
 */
export const draftRows = (d: AiDraft, has: Record<AiDraftKey, boolean>): AiDraftRow[] => {
  const rows: [AiDraftKey, string, string | undefined][] = [
    ['title', 'Tittel', d.title],
    ['description', 'Beskrivelse', d.description],
    ['categories', 'Kategori', d.categories],
    ['paymentType', 'Pristype', d.paymentType],
    ['price', 'Pris (estimat)', d.price ? kr(d.price) : undefined],
    ['hourlyRate', 'Timepris (estimat)', d.hourlyRate ? `${kr(d.hourlyRate)}/t` : undefined],
    [
      'duration',
      'Varighet',
      d.duration ? `${d.duration.value} ${UNIT[d.duration.unit] ?? 'timer'}` : undefined,
    ],
    ['tags', 'Ferdigheter', d.tags?.join(', ')],
  ];
  return rows
    .filter(([, , value]) => value)
    .map(([key, label, value]) => ({ key, label, value: value!, overwrites: has[key] }));
};
