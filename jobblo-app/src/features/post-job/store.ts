import { create } from 'zustand';
import { emptyJobValues, type CreateJobFormValues, type CreateJobImage } from '../../services/createJob.service';
import { addPhotos, movePhoto, nextStep, previousStep, type PhotoQuality, type PostJobStep } from './flow';

/** The AI's price/time estimate from the title step, shown on the price step when there is no market data. */
export interface AiEstimate {
  paymentType?: 'Timepris' | 'Fastpris' | 'Anbud';
  suggestedPrice?: number;
  priceMin?: number;
  priceMax?: number;
  hourlyRate?: number;
}

interface PostJobState {
  /** The job as the old form and the API know it (createJob.service). */
  values: CreateJobFormValues;
  photos: CreateJobImage[];
  /** What the job is, in the user's words: the AI's input when there are no photos. */
  summary: string;
  /** Answers on the "Detaljer" screen, by question key (details.ts). */
  answers: Record<string, string>;
  ai: AiEstimate | null;
  /** The camera AI helper's notes, by photo uri: what each photo shows (feeds the title/description). */
  photoNotes: Record<string, string>;
  /** The AI helper's verdict per photo uri (retake asked = 'blurry' / 'dark'). */
  photoQuality: Record<string, PhotoQuality>;
  step: PostJobStep;
  /** Set after publish: the success screen shows. */
  publishedId: string | null;
  /** Editing a published job ("Rediger"): its id, and the photo URLs it had when opened. */
  editId: string | null;
  existingImages: string[];
  update: (patch: Partial<CreateJobFormValues>) => void;
  setSummary: (summary: string) => void;
  setAnswer: (key: string, value: string) => void;
  setAi: (ai: AiEstimate | null) => void;
  setPhotoNote: (uri: string, note: string) => void;
  setPhotoQuality: (uri: string, quality: PhotoQuality) => void;
  setPublished: (id: string | null) => void;
  addPhotos: (photos: CreateJobImage[]) => void;
  removePhoto: (index: number) => void;
  movePhoto: (from: number, to: number) => void;
  goTo: (step: PostJobStep) => void;
  next: () => void;
  /** false when already on the first screen. */
  back: () => boolean;
  reset: () => void;
  /** Opens a published job on the summary screen, its photos as remote URLs. */
  startEdit: (id: string, values: CreateJobFormValues, images: string[]) => void;
  /** A new listing put aside by "Rediger"; back once the edit is saved or cancelled (reset). */
  stash: Answers | null;
}

const fresh = () => ({
  values: emptyJobValues(),
  photos: [] as CreateJobImage[],
  summary: '',
  answers: {} as Record<string, string>,
  ai: null as AiEstimate | null,
  photoNotes: {} as Record<string, string>,
  photoQuality: {} as Record<string, PhotoQuality>,
  step: 'photos' as PostJobStep,
  publishedId: null as string | null,
  editId: null as string | null,
  existingImages: [] as string[],
});

type Answers = ReturnType<typeof fresh>;
const answersOf = (s: Answers): Answers => Object.fromEntries(Object.keys(fresh()).map((k) => [k, s[k as keyof Answers]])) as Answers;
const started = (s: Answers) => Boolean(s.photos.length || s.values.categories.length || s.summary.trim() || s.values.title.trim());

/** The answers so far. Kept while the user moves between tabs; reset after publish or discard. */
export const usePostJobStore = create<PostJobState>((set, get) => ({
  ...fresh(),
  stash: null,
  update: (patch) => set((s) => ({ values: { ...s.values, ...patch } })),
  setSummary: (summary) => set({ summary }),
  setAnswer: (key, value) => set((s) => ({ answers: { ...s.answers, [key]: value } })),
  setAi: (ai) => set({ ai }),
  setPhotoNote: (uri, note) => set((s) => ({ photoNotes: { ...s.photoNotes, [uri]: note } })),
  setPhotoQuality: (uri, quality) => set((s) => ({ photoQuality: { ...s.photoQuality, [uri]: quality } })),
  setPublished: (publishedId) => set({ publishedId }),
  addPhotos: (photos) => set((s) => ({ photos: addPhotos(s.photos, photos) })),
  removePhoto: (index) => set((s) => ({ photos: s.photos.filter((_, i) => i !== index) })),
  movePhoto: (from, to) => set((s) => ({ photos: movePhoto(s.photos, from, to) })),
  goTo: (step) => set({ step }),
  // Editing: every screen is reached from the summary and returns to it (photos → arrange first).
  next: () => {
    const { step, photos, editId } = get();
    const to = editId && step !== 'photos' ? 'review' : nextStep(step, photos.length);
    if (to) set({ step: to });
  },
  back: () => {
    const { step, photos, editId } = get();
    const to = editId ? (step === 'review' ? null : 'review') : previousStep(step, photos.length);
    if (!to) return false;
    set({ step: to });
    return true;
  },
  // Leaving an edit brings back the new listing it put aside; otherwise a clean start.
  reset: () => set((s) => (s.editId && s.stash ? { ...s.stash, stash: null } : { ...fresh(), stash: s.editId ? null : s.stash })),
  startEdit: (editId, values, images) =>
    set((s) => ({
      ...fresh(),
      stash: !s.editId && started(s) ? answersOf(s) : s.stash,
      editId,
      values,
      existingImages: images,
      photos: images.map((uri) => ({ uri, name: '', type: '' })),
      step: 'review',
    })),
}));
