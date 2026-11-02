/**
 * "Dine utkast" in the web's shape (frontend useCreateJobForm `JobDraft`), so a draft started
 * on the phone opens on the web and the other way round. Pure, so the check can run it.
 */
import {
  emptyJobValues,
  type CreateJobFormValues,
  type CreateJobImage,
} from '../../services/createJob.service';

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const PAYMENT = ['Fastpris', 'Timepris', 'Anbud'] as const;
const UNITS = ['minutes', 'hours', 'days'] as const;
const EQUIPMENT = ['utstyrfri', 'delvis utstyr', 'trengs utstyr'] as const;
const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** What the server stores. `photoUrls`: each photo's uri → its URL stored with the draft. */
export function toDraftData(input: {
  values: CreateJobFormValues;
  summary: string;
  photos: CreateJobImage[];
  photoUrls: Record<string, string>;
}) {
  const { values: v, summary, photos, photoUrls } = input;
  const [lat, lng] = v.coordinates;
  const located = !(lat === 0 && lng === 0);
  return {
    title: v.title,
    description: v.description,
    // The web form holds one category as a string.
    categories: v.categories[0] ?? '',
    address: v.address,
    city: v.city,
    postalCode: v.postalCode,
    countyCode: v.countyCode,
    municipalityCode: v.municipalityCode,
    areaCode: v.areaCode,
    latitude: located ? lat : null,
    longitude: located ? lng : null,
    phone: v.contactPhone,
    email: v.contactEmail,
    price: v.price,
    hourlyRate: v.hourlyRate,
    paymentType: v.paymentType,
    durationValue: v.durationValue,
    durationUnit: v.durationUnit,
    fromDate: v.fromDate,
    toDate: v.toDate,
    maxApplicants: v.maxApplicants,
    equipment: v.equipment,
    tags: v.tags,
    checklistItems: v.checklist,
    smartFillPrompt: summary,
    // Photos already on the server, in the order shown (the web reads the values).
    draftImageUrls: Object.fromEntries(
      photos.filter((p) => photoUrls[p.uri]).map((p) => [p.uri, photoUrls[p.uri]])
    ),
    // App-only; the web ignores them.
    customerType: v.customerType,
    jobType: v.jobType ?? '',
  };
}

/** A stored draft (from either platform) back into the flow's state. */
export function fromDraftData(data: Record<string, unknown>) {
  const empty = emptyJobValues();
  const lat = num(data.latitude);
  const lng = num(data.longitude);
  const category = Array.isArray(data.categories) ? str(data.categories[0]) : str(data.categories);
  const checklist = Array.isArray(data.checklistItems)
    ? data.checklistItems
        .filter((i): i is { id: unknown; text: unknown } => Boolean(i) && typeof i === 'object')
        .map((i, n) => ({ id: str(i.id) || `c${n}`, text: str(i.text) }))
        .filter((i) => i.text)
    : [];
  const urls = Object.values(
    data.draftImageUrls && typeof data.draftImageUrls === 'object' ? data.draftImageUrls : {}
  ).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u));
  const values: CreateJobFormValues = {
    ...empty,
    title: str(data.title),
    description: str(data.description),
    categories: category ? [category] : [],
    address: str(data.address),
    city: str(data.city),
    postalCode: str(data.postalCode),
    countyCode: str(data.countyCode),
    municipalityCode: str(data.municipalityCode),
    areaCode: str(data.areaCode),
    coordinates: lat !== null && lng !== null ? [lat, lng] : empty.coordinates,
    contactPhone: str(data.phone),
    contactEmail: str(data.email),
    price: str(data.price),
    hourlyRate: str(data.hourlyRate),
    paymentType: pick(PAYMENT, data.paymentType, empty.paymentType),
    durationValue: str(data.durationValue),
    durationUnit: pick(UNITS, data.durationUnit, empty.durationUnit),
    fromDate: str(data.fromDate),
    toDate: str(data.toDate),
    maxApplicants: str(data.maxApplicants) || empty.maxApplicants,
    equipment: pick(EQUIPMENT, data.equipment, empty.equipment),
    tags: Array.isArray(data.tags) ? data.tags.map(str).filter(Boolean) : [],
    checklist,
    // '' for a web draft: the flow then uses the account's kind.
    customerType: pick(['private', 'business', ''] as const, data.customerType, ''),
    jobType: str(data.jobType),
  };
  return {
    values,
    summary: str(data.smartFillPrompt),
    photos: urls.map((uri) => ({ uri, name: '', type: '' })),
    photoUrls: Object.fromEntries(urls.map((u) => [u, u])),
  };
}

/** Worth saving: something the user wrote. */
export const draftWorthSaving = (values: CreateJobFormValues, summary: string) =>
  Boolean(values.title.trim() || values.description.trim() || summary.trim());
