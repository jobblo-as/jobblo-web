export type Jobs = {
  _id: string;
  userId: string | null;
  title: string;
  description: string;
  price: number;
  hourlyRate?: number;
  location: {
    type: string;
    coordinates: number[];
    address: string;
    city: string;
  };
  duration: {
    value?: number;
    unit: 'minutes' | 'hours' | 'days';
  };
  categories: string[];
  images: string[];
  urgent: boolean;
  promoted?: boolean;
  favCount?: number;
  /**
   * Mirrors the `status` enum on `backend/models/Service.js`. It was typed as
   * `'open' | 'closed'` — two of the eleven values the server can actually send — so any
   * code that checked for a completed or cancelled job was reported as an impossible
   * comparison and had to be cast away.
   */
  status:
    | 'open'
    | 'closed'
    | 'awaiting_payment'
    | 'paid'
    | 'in_progress'
    | 'completed'
    | 'pending'
    | 'waiting_for_approval'
    | 'cancelled'
    | 'expired'
    | 'draft';
  tags: string[];
  maxApplicants?: number;
  currentApplicants?: number;
  isLimitReached?: boolean;
  equipment: 'utstyrfri' | 'delvis utstyr' | 'trengs utstyr';
  createdAt: string;
  updatedAt: string;
  timeEntries?: {
    userId: string;
    hours: number;
    date: string;
    note: string;
    _id: string;
    createdAt: string;
    updatedAt: string;
  }[];
};

/** The stored `equipment` values in words (same labels as the app, jobblo-app/src/types/Jobs.ts). */
export const EQUIPMENT_LABELS: Record<Jobs['equipment'], string> = {
  utstyrfri: 'Ingen utstyr nødvendig',
  'delvis utstyr': 'Noe utstyr trengs',
  'trengs utstyr': 'Utstyr må medbringes',
};

/** Label for a stored equipment value; an unknown value is shown as is, a missing one as null. */
export const equipmentLabel = (value?: string | null): string | null =>
  value ? (EQUIPMENT_LABELS as Record<string, string>)[value] || value : null;

const DURATION_UNITS: Record<string, [string, string]> = {
  minutes: ['minutt', 'minutter'],
  minutter: ['minutt', 'minutter'],
  hours: ['time', 'timer'],
  timer: ['time', 'timer'],
  days: ['dag', 'dager'],
  dager: ['dag', 'dager'],
};

/**
 * "3 timer", "1 dag". The job page printed the stored unit, so listings read "3 hours".
 * The schema also accepts the Norwegian unit names, and an unset unit means hours (its default).
 */
export function formatDuration(duration?: { value?: number; unit?: string } | null): string | null {
  if (!duration?.value) return null;
  const [one, many] = DURATION_UNITS[duration.unit || 'hours'] ?? DURATION_UNITS.hours;
  return `${duration.value} ${duration.value === 1 ? one : many}`;
}
