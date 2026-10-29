import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateFullJobListing, type AISmartFillContext } from '../api/aiAPI';
import { useTranslate } from '../i18n/useTranslate';
import { useUserStore } from '../stores/userStore';
import { usePaymentCalculation } from './usePaymentCalculation';
import { useForm } from './useForm';
import { JOB_LIMITS, jobValidationSchema, type JobFormValues } from '../validations/jobValidations';
import { saveFormData, loadFormData, clearFormData } from '../utils/indexedDB';
import {
  deleteJobDraft,
  getJobDraft,
  saveJobDraft,
  uploadJobDraftImage,
} from '../api/jobDraftsAPI';
import { getErrorMessage, errorBody } from '../utils/getErrorMessage';
import {
  summariseAiFill,
  clampMessage,
  draftRows,
  type AiDraft,
  type AiDraftKey,
} from '../utils/aiFillSummary';
import { scrollToFirstError } from '../utils/scrollToError';
import { phoneDigits } from '../utils/norwegianFormat';

/** Two pages: the job itself, then place, time and price (checklist and contact folded in). */
const LAST_STEP = 2;

/**
 * The four keys `validateStep` writes that are not fields of `JobFormValues` — they are held
 * in their own state (images, the map pin, fylke, kommune) but reported through the same
 * error channel so the UI has one thing to read and `scrollToFirstError` one thing to find.
 */
type JobFormErrors = Partial<
  Record<keyof JobFormValues | 'images' | 'coordinates' | 'countyCode' | 'municipalityCode', string>
>;

/** The schema keyed by every form field, so a field without rules (phone) reads as undefined. */
const fieldRules: Partial<
  Record<keyof JobFormValues, { test: (values: JobFormValues) => boolean; message: string }[]>
> = jobValidationSchema;

/** What the save effect below writes to IndexedDB, read back on mount. */
type JobDraft = Partial<
  JobFormValues & {
    urgent: boolean;
    maxApplicants: string | number;
    equipment: string;
    countyCode: string;
    municipalityCode: string;
    areaCode: string;
    postalCode: string;
    latitude: number | null;
    longitude: number | null;
    durationUnit: string;
    hourlyRate: string;
    paymentType: string;
    tags: string[];
    currentStep: number;
    currentImages: string[];
    imagesToDelete: string[];
    showSmartFillInput: boolean;
    smartFillPrompt: string;
    /** The "Dine utkast" copy on the server this local draft mirrors. */
    serverDraftId: string | null;
    checklistItems: { id: string; text: string }[];
    /** New photos already uploaded with the server draft: file signature → URL. */
    draftImageUrls: Record<string, string>;
  }
>;

/** A photo's identity that survives the IndexedDB round trip (File objects do not). */
const fileSig = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

interface InitialData {
  title?: string;
  description?: string;
  price?: string | number;
  address?: string;
  city?: string;
  countyCode?: string;
  municipalityCode?: string;
  areaCode?: string;
  postalCode?: string;
  categories?: string | string[];
  urgent?: boolean;
  equipment?: string;
  fromDate?: string;
  toDate?: string;
  durationValue?: string | number;
  durationUnit?: string;
  paymentType?: string;
  hourlyRate?: string | number;
  maxApplicants?: string | number;
  phone?: string;
  email?: string;
  images?: string[];
  latitude?: number;
  longitude?: number;
}

export const useCreateJobForm = (
  userId: string,
  initialData?: InitialData,
  isEditMode = false,
  onSubmit?: (formData: FormData) => void | Promise<unknown>
) => {
  const [currentStep, setCurrentStep] = useState(1);

  // Using the shared useForm hook for validation flow
  const {
    values,
    errors,
    handleChange: handleFormChange,
    setValues,
    setErrors,
    setMultipleValues,
  } = useForm<JobFormValues>(
    {
      title: initialData?.title || '',
      description: initialData?.description || '',
      categories: initialData?.categories || '',
      address: initialData?.address || '',
      city: initialData?.city || '',
      phone: initialData?.phone || '',
      email: initialData?.email || '',
      price: initialData?.price || '',
      durationValue: initialData?.durationValue || '',
      fromDate: initialData?.fromDate || '',
      toDate: initialData?.toDate || '',
    },
    jobValidationSchema
  );

  // Individual states that are not part of the primary validation schema or need special handling
  const [equipment, setEquipment] = useState(initialData?.equipment || '');
  const [countyCode, setCountyCodeState] = useState(initialData?.countyCode || '');
  const [municipalityCode, setMunicipalityCodeState] = useState(
    initialData?.municipalityCode || ''
  );
  const [areaCode, setAreaCode] = useState(initialData?.areaCode || '');
  const [postalCode, setPostalCode] = useState(initialData?.postalCode || '');
  const [coordinates, setCoordinatesState] = useState<[number, number] | null>(() =>
    initialData?.latitude != null && initialData?.longitude != null
      ? [initialData.latitude, initialData.longitude]
      : null
  );

  /**
   * Fylke, kommune and the map pin live outside the validation schema, so `useForm` — which
   * clears a field's error as soon as it changes — never sees them fixed. Without this their
   * errors would stay red after the person had already put them right, and the scroll would
   * keep sending them back to a field with nothing wrong with it.
   */
  const clearFieldError = useCallback(
    (field: string) => {
      setErrors((prev) => {
        if (!prev[field as keyof JobFormValues]) return prev;
        const next = { ...prev };
        delete next[field as keyof JobFormValues];
        return next;
      });
    },
    [setErrors]
  );

  const setCountyCode = useCallback(
    (value: string) => {
      setCountyCodeState(value);
      if (value) clearFieldError('countyCode');
    },
    [clearFieldError]
  );

  const setMunicipalityCode = useCallback(
    (value: string) => {
      setMunicipalityCodeState(value);
      if (value) clearFieldError('municipalityCode');
    },
    [clearFieldError]
  );

  const setCoordinates = useCallback(
    (value: [number, number] | null) => {
      setCoordinatesState(value);
      if (value) clearFieldError('coordinates');
    },
    [clearFieldError]
  );
  const durationValue = values.durationValue;
  const fromDate = values.fromDate;
  const toDate = values.toDate;

  const setDurationValue = useCallback(
    (val: string) => handleFormChange('durationValue', val),
    [handleFormChange]
  );
  const setFromDate = useCallback(
    (val: string) => handleFormChange('fromDate', val),
    [handleFormChange]
  );
  const setToDate = useCallback(
    (val: string) => handleFormChange('toDate', val),
    [handleFormChange]
  );

  const [durationUnit, setDurationUnit] = useState(initialData?.durationUnit || 'minutes');

  const [maxApplicants, setMaxApplicants] = useState<string | number>(
    initialData?.maxApplicants || 0
  );

  const {
    price,
    setPrice,
    hourlyRate,
    setHourlyRate,
    paymentType,
    setPaymentType,
    urgent,
    setUrgent,
  } = usePaymentCalculation((durationValue ?? '').toString(), durationUnit, initialData);

  // Sync price from usePaymentCalculation to useForm
  useEffect(() => {
    handleFormChange('price', price);
  }, [price, handleFormChange]);

  const [tags, setTags] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [currentImages, setCurrentImages] = useState<string[]>(initialData?.images || []);
  const [imagesToDelete, setImagesToDelete] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isGeneratingFullListing, setIsGeneratingFullListing] = useState(false);
  const smartFillMutation = useMutation({
    mutationFn: ({
      prompt,
      ctx,
      images,
    }: {
      prompt: string;
      ctx: AISmartFillContext;
      images: File[];
    }) => generateFullJobListing(prompt, ctx, images, aiAbort.current?.signal),
  });
  // Hast paid on "Nesten ferdig" before publishing: sent with the job, the server checks it.
  const [urgentPurchaseId, setUrgentPurchaseId] = useState<string | null>(null);
  // "Avbryt" in the loading dialog: stops the request, so no late answer reaches the form.
  const aiAbort = useRef<AbortController | null>(null);
  const cancelAiSmartFill = () => aiAbort.current?.abort();
  const [smartFillSuggestionFlags, setSmartFillSuggestionFlags] = useState<{
    title?: boolean;
    description?: boolean;
    price?: boolean;
    duration?: boolean;
    hourlyRate?: boolean;
    categories?: boolean;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [smartFillPrompt, setSmartFillPrompt] = useState('');
  const [showSmartFillInput, setShowSmartFillInput] = useState(false);
  /** Smart-fill's pricing rationale, rendered under the price field rather than in a toast. */
  const [smartFillPricingNote, setSmartFillPricingNote] = useState('');
  const [checklistItems, setChecklistItems] = useState<{ id: string; text: string }[]>([]);
  const queryClient = useQueryClient();
  const serverDraftId = useRef<string | null>(null);
  const serverSync = useRef<Promise<unknown>>(Promise.resolve());
  const serverSyncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** An AI suggestion waiting in the review popup; nothing reaches the form until it is applied. */
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);

  // Flag to prevent save effect from running before load completes
  const [isLoaded, setIsLoaded] = useState(false);

  const currentUser = useUserStore((state) => state.user);
  const { locale } = useTranslate();

  // Category-based checklist suggestions
  const getCategorySuggestions = (category: string): string[] => {
    const suggestions: Record<string, string[]> = {
      Rengjøring: ['Støvsuge', 'Vaske gulv', 'Rengjøre bad', 'Tørke støv'],
      Hagearbeid: ['Klippe plen', 'Luke ugress', 'Rydde løv', 'Trimme hekk'],
      Flyttehjelp: ['Pakke bokser', 'Bære møbler', 'Montere møbler', 'Rydde gammel bolig'],
      Snømåking: ['Måke innkjørsel', 'Strø grus/salt', 'Rydde trapper'],
    };
    return suggestions[category] || [];
  };

  // Auto-update checklist when category changes (only if checklist is empty)
  useEffect(() => {
    const category = Array.isArray(values.categories) ? values.categories[0] : values.categories;
    if (category && checklistItems.length === 0) {
      const suggestions = getCategorySuggestions(category);
      if (suggestions.length > 0) {
        setChecklistItems(
          suggestions.map((text) => ({
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            text,
          }))
        );
      }
    }
  }, [values.categories]);

  // Wrappers to maintain compatibility with existing components
  const setTitle = useCallback((val: string) => handleFormChange('title', val), [handleFormChange]);
  const setDescription = useCallback(
    (val: string) => handleFormChange('description', val),
    [handleFormChange]
  );
  const setAddress = useCallback(
    (val: string) => handleFormChange('address', val),
    [handleFormChange]
  );
  const setCity = useCallback((val: string) => handleFormChange('city', val), [handleFormChange]);
  const setCategories = useCallback(
    (val: string | string[]) => handleFormChange('categories', val),
    [handleFormChange]
  );
  const setPhone = useCallback((val: string) => handleFormChange('phone', val), [handleFormChange]);
  const setEmail = useCallback((val: string) => handleFormChange('email', val), [handleFormChange]);

  /**
   * Images sit outside the validation schema, so `useForm` never cleared their error the way
   * it does for a text field the moment you type in it. `validateStep` only ever merges into
   * `errors`, so once "Vennligst last opp minst ett bilde" was set it stayed set — the card
   * kept its red border after the photo was added, and the scroll kept sending the person
   * back to a field with nothing wrong with it.
   */
  const handleImagesChange = useCallback(
    (files: File[]) => {
      setSelectedImages(files);
      if (files.length > 0) clearFieldError('images');
    },
    [clearFieldError]
  );

  const handleImageSelection = (files: File[]) => handleImagesChange(files);

  // "Bilder": one list of saved photos (id = URL) and new files (id per File), in the order
  // the owner chose. Kept here so it survives switching steps.
  // ponytail: the order is not in the autosaved draft; a reload keeps the photos in upload
  // order. Add it to the draft payload if that matters.
  const fileKeys = useRef(new WeakMap<File, { id: string; url: string }>());
  const fileKey = (file: File) => {
    let key = fileKeys.current.get(file);
    if (!key) {
      key = { id: `new-${Math.random().toString(36).slice(2)}`, url: URL.createObjectURL(file) };
      fileKeys.current.set(file, key);
    }
    return key;
  };
  const [imageOrder, setImageOrder] = useState<string[]>([]);
  // Photos already stored with the server draft ("Dine utkast"), so they follow the draft to
  // other devices and are not uploaded twice when the job is published.
  const [draftImageUrls, setDraftImageUrls] = useState<Record<string, string>>({});
  // The same map, current inside the queued sync: a sync queued before an upload finished must
  // not upload that photo a second time.
  const draftUrlsRef = useRef<Record<string, string>>({});
  draftUrlsRef.current = { ...draftUrlsRef.current, ...draftImageUrls };
  const imageItems = useMemo(() => {
    const all = [
      ...currentImages.map((url) => ({ id: url, url, file: undefined as File | undefined })),
      ...selectedImages.map((file) => ({ ...fileKey(file), file })),
    ];
    const rank = (id: string) => {
      const i = imageOrder.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return all
      .map((item, i) => ({ item, i }))
      .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.i - b.i)
      .map(({ item }) => item);
  }, [currentImages, selectedImages, imageOrder]);
  const moveImage = (id: string, step: -1 | 1) => {
    const ids = imageItems.map((item) => item.id);
    const i = ids.indexOf(id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setImageOrder(ids);
  };

  /** "Foreslå et utkast": the text, the first 3 new photos, or both, in one AI call. */
  const handleAiSmartFill = async () => {
    // The first 3 new photos as the owner ordered them.
    const images = imageItems.flatMap((item) => (item.file ? [item.file] : [])).slice(0, 3);
    if (!images.length && smartFillPrompt.trim().length < 5) {
      toast.error('Legg til bilder eller beskriv oppdraget (min. 5 tegn).');
      return;
    }

    setIsGeneratingFullListing(true);
    aiAbort.current = new AbortController();
    try {
      const response = await smartFillMutation.mutateAsync({
        prompt: smartFillPrompt.trim(),
        images,
        ctx: {
          lang: locale,
          existingTitle: values.title || undefined,
          existingDescription: values.description || undefined,
          existingCategory:
            (typeof values.categories === 'string'
              ? values.categories
              : Array.isArray(values.categories)
                ? values.categories[0]
                : undefined) || undefined,
          existingPaymentType: paymentType as 'Timepris' | 'Fastpris' | 'Anbud',
          existingDuration: durationValue
            ? {
                value: durationValue,
                unit: (durationUnit as 'minutes' | 'hours' | 'days') || 'minutes',
              }
            : undefined,
          existingCity: values.city || undefined,
          existingCounty: countyCode || undefined,
          existingEquipment: equipment || undefined,
          existingUrgent: urgent,
        },
      });

      if (response.success) {
        const d = response.data;
        // Price: priceRange.min is the Anbud budget floor; otherwise the suggested price.
        const price = d.priceRange ? d.priceRange.min : (d.suggestedPrice ?? d.estimatedPrice);
        setAiDraft({
          title: d.title,
          description: d.description,
          categories: d.category?.trim(),
          duration: d.duration?.value ? d.duration : undefined,
          price: typeof price === 'number' && price > 0 ? price : undefined,
          hourlyRate: d.hourlyRate,
          // Only offered while the type is still the untouched default.
          paymentType:
            d.paymentType &&
            d.paymentType !== 'Fastpris' &&
            paymentType === 'Fastpris' &&
            initialData?.paymentType == null
              ? d.paymentType
              : undefined,
          tags: Array.isArray(d.skills) && d.skills.length ? d.skills : undefined,
          checklist: d.checklist?.length ? d.checklist : undefined,
          remote: d.locationRelevance === 'remote',
          pricingReasoning: d.pricingReasoning,
        });
        setShowSmartFillInput(false);
        setSmartFillPrompt('');
      }
    } catch (err) {
      if (aiAbort.current?.signal.aborted) return; // cancelled by the user: nothing to report
      console.error('SMART FILL ERROR:', err);
      const errorMessage =
        errorBody(err)?.error || errorBody(err)?.message || 'Kunne ikke generere jobbinformasjon.';
      const validationErrors = errorBody<{ validationErrors?: string[] }>(err)?.validationErrors;
      const details = validationErrors?.length
        ? ` (${validationErrors.slice(0, 2).join(', ')})`
        : '';
      toast.error(clampMessage(errorMessage + details));
    } finally {
      setIsGeneratingFullListing(false);
    }
  };

  /** What the popup lists: one row per suggested field, `overwrites` when it replaces typed text. */
  const aiDraftRows = useMemo(
    () =>
      aiDraft
        ? draftRows(aiDraft, {
            title: values.title.trim().length > 0,
            description: values.description.trim().length > 0,
            categories: Array.isArray(values.categories)
              ? values.categories.length > 0
              : !!String(values.categories ?? '').trim(),
            duration: Number(durationValue) > 0,
            price: Number(values.price) > 0,
            hourlyRate: Number(hourlyRate) > 0,
            paymentType: false,
            tags: tags.length > 0,
            // The category's template is not the user's own text; anything else is.
            checklist: checklistItems.some(
              (item) =>
                !getCategorySuggestions(
                  String(
                    (Array.isArray(values.categories) ? values.categories[0] : values.categories) ??
                      ''
                  )
                ).includes(item.text)
            ),
          })
        : [],
    [
      aiDraft,
      values.title,
      values.description,
      values.categories,
      values.price,
      durationValue,
      hourlyRate,
      tags,
      checklistItems,
    ]
  );

  /** Writes only the ticked rows of the reviewed draft into the form. */
  const applyAiDraft = (keys: AiDraftKey[]) => {
    const d = aiDraft;
    setAiDraft(null);
    if (!d || keys.length === 0) return;
    const pick = new Set(keys);
    const flags: typeof smartFillSuggestionFlags = { ...smartFillSuggestionFlags };
    if (pick.has('title') && d.title) {
      setTitle(d.title);
      flags.title = true;
    }
    if (pick.has('description') && d.description) {
      setDescription(d.description);
      flags.description = true;
    }
    if (pick.has('categories') && d.categories) {
      setCategories(d.categories);
      flags.categories = true;
    }
    if (pick.has('duration') && d.duration) {
      setDurationValue(String(d.duration.value));
      setDurationUnit(d.duration.unit || 'minutes');
      flags.duration = true;
    }
    if (pick.has('price') && d.price) {
      setPrice(String(d.price));
      setSmartFillPricingNote(d.pricingReasoning || '');
      flags.price = true;
    }
    if (pick.has('hourlyRate') && d.hourlyRate) {
      setHourlyRate(String(d.hourlyRate));
      flags.hourlyRate = true;
    }
    if (pick.has('paymentType') && d.paymentType) setPaymentType(d.paymentType);
    if (pick.has('tags') && d.tags) setTags(d.tags);
    if (pick.has('checklist') && d.checklist)
      setChecklistItems(
        d.checklist.map((text) => ({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          text,
        }))
      );
    if (d.remote && !values.city) setCity('Fjernarbeid / Remote');
    setSmartFillSuggestionFlags(flags);
    toast.success(summariseAiFill(flags), { duration: 3000 });
  };

  // Persistence - Load data on mount (run only once)
  useEffect(() => {
    const loadData = async () => {
      // In edit mode or when initialData is provided, skip loading draft
      if (initialData) {
        setIsLoaded(true);
        return;
      }

      try {
        // `?utkast=<id>` opens a server draft ("Dine utkast"); otherwise the local one.
        const utkast = new URLSearchParams(window.location.search).get('utkast');
        const { data, images } = utkast
          ? {
              data: await getJobDraft<JobDraft>(utkast).catch(() => {
                toast.error('Fant ikke utkastet.');
                return null;
              }),
              images: [] as File[],
            }
          : await loadFormData<JobDraft>(currentUser?._id);
        serverDraftId.current = (utkast && data ? utkast : data?.serverDraftId) || null;
        if (data) {
          setValues({
            title: data.title || '',
            description: data.description || '',
            categories: data.categories || '',
            address: data.address || '',
            city: data.city || '',
            phone: data.phone || '',
            email: data.email || '',
            price: data.price || '',
            durationValue: data.durationValue || '',
            fromDate: data.fromDate || '',
            toDate: data.toDate || '',
          });
          setUrgent(data.urgent || false);
          setMaxApplicants(data.maxApplicants || 0);
          setEquipment(data.equipment || '');
          setCountyCode(data.countyCode || '');
          setMunicipalityCode(data.municipalityCode || '');
          setAreaCode(data.areaCode || '');
          setPostalCode(data.postalCode || '');
          if (data.latitude != null && data.longitude != null) {
            setCoordinates([data.latitude, data.longitude]);
          }
          setDurationUnit(data.durationUnit || 'minutes');
          setHourlyRate(data.hourlyRate || '');
          setPaymentType(data.paymentType || 'Fastpris');
          setTags(data.tags || []);
          setCurrentStep(Math.min(data.currentStep || 1, LAST_STEP));
          // Opened from "Dine utkast": the photos are the ones stored with that draft.
          const stored = utkast ? Object.values(data.draftImageUrls || {}) : [];
          setCurrentImages([...new Set([...(data.currentImages || []), ...stored])]);
          setDraftImageUrls(data.draftImageUrls || {});
          setImagesToDelete(data.imagesToDelete || []);
          setShowSmartFillInput(data.showSmartFillInput || false);
          setSmartFillPrompt(data.smartFillPrompt || '');
          setChecklistItems(data.checklistItems || []);

          if (images && images.length > 0) {
            setSelectedImages(images);
          }
        }
      } catch (err) {
        console.error('Error loading form data:', err);
      } finally {
        // Always mark as loaded so save effect can start
        setIsLoaded(true);
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // A new job starts with the profile's phone and e-mail (once, after the draft loaded), so
  // nobody types them again; clearing a field afterwards keeps it empty.
  const contactPrefilled = useRef(false);
  useEffect(() => {
    if (!isLoaded || isEditMode || contactPrefilled.current || !currentUser) return;
    contactPrefilled.current = true;
    const fill: Partial<JobFormValues> = {};
    if (!values.phone && currentUser.phone) fill.phone = phoneDigits(currentUser.phone);
    if (!values.email && currentUser.email) fill.email = currentUser.email;
    if (Object.keys(fill).length) setMultipleValues(fill);
  }, [isLoaded, isEditMode, currentUser, values.phone, values.email, setMultipleValues]);

  // Persistence - Save data whenever it changes (only after initial load)
  useEffect(() => {
    if (!isLoaded) return; // Don't save until draft has been loaded
    if (isEditMode) return; // Edit mode never uses the draft — don't overwrite it

    const saveData = async () => {
      try {
        const dataToSave = {
          ...values,
          urgent,
          maxApplicants,
          equipment,
          countyCode,
          municipalityCode,
          areaCode,
          postalCode,
          latitude: coordinates?.[0] ?? null,
          longitude: coordinates?.[1] ?? null,
          fromDate,
          toDate,
          durationValue,
          durationUnit,
          hourlyRate,
          paymentType,
          tags,
          currentStep,
          currentImages,
          imagesToDelete,
          showSmartFillInput,
          smartFillPrompt,
          checklistItems,
          draftImageUrls,
        };
        await saveFormData(
          { ...dataToSave, serverDraftId: serverDraftId.current },
          selectedImages,
          currentUser?._id
        );
        // Nothing worth listing yet → no server draft. Photos not yet uploaded stay local.
        if (!values.title.trim() && !values.description.trim()) return;
        serverSyncTimer.current = setTimeout(() => {
          // One request at a time, so two quick edits never create two drafts.
          serverSync.current = serverSync.current.then(async () => {
            try {
              const created = !serverDraftId.current;
              serverDraftId.current = await saveJobDraft(serverDraftId.current, dataToSave);
              if (created) queryClient.invalidateQueries({ queryKey: ['job-drafts'] });
              // New photos go up with the draft, once each; the saved map is the record.
              for (const file of selectedImages) {
                const sig = fileSig(file);
                if (draftUrlsRef.current[sig]) continue;
                const url = await uploadJobDraftImage(serverDraftId.current, file);
                draftUrlsRef.current = { ...draftUrlsRef.current, [sig]: url };
                setDraftImageUrls((prev) => ({ ...prev, [sig]: url }));
              }
            } catch (err) {
              // Deleted elsewhere: the next edit starts a new one. Anything else: try next edit.
              if ((err as { response?: { status?: number } })?.response?.status === 404)
                serverDraftId.current = null;
            }
          });
        }, 1500);
      } catch (err) {
        console.error('Error saving form data:', err);
      }
    };
    saveData();
    return () => clearTimeout(serverSyncTimer.current);
  }, [
    isLoaded,
    values,
    urgent,
    equipment,
    countyCode,
    municipalityCode,
    areaCode,
    postalCode,
    fromDate,
    toDate,
    durationValue,
    durationUnit,
    hourlyRate,
    paymentType,
    tags,
    currentStep,
    selectedImages,
    currentImages,
    imagesToDelete,
    showSmartFillInput,
    smartFillPrompt,
    maxApplicants,
    checklistItems,
    coordinates,
    draftImageUrls,
  ]);
  const validateStep = (step: number) => {
    const currentErrors: Partial<Record<keyof JobFormValues, string>> = {};
    // `images`, `coordinates`, `countyCode` and `municipalityCode` are validated here but
    // are not fields of JobFormValues — they live in their own state. Same object, wider
    // key type, so they can be reported through the one error channel the UI reads.
    const extraErrors = currentErrors as Record<string, string>;
    let isValid = true;

    if (step === 1) {
      // Validate Step 1 fields
      const fieldsToValidate: (keyof JobFormValues)[] = ['title', 'description', 'categories'];
      fieldsToValidate.forEach((field) => {
        const rules = fieldRules[field];
        if (rules) {
          for (const rule of rules) {
            if (!rule.test(values)) {
              currentErrors[field] = rule.message;
              isValid = false;
              break;
            }
          }
        }
      });
    } else if (step === 2) {
      // Validate Step 2 fields
      const fieldsToValidate: (keyof JobFormValues)[] = [
        'address',
        'city',
        'price',
        'durationValue',
        'fromDate',
        'toDate',
      ];
      fieldsToValidate.forEach((field) => {
        const rules = fieldRules[field];
        if (rules) {
          for (const rule of rules) {
            if (!rule.test(values)) {
              if (field === 'price') {
                const priceNumber = Number(values.price);
                if (Number.isFinite(priceNumber) && priceNumber > JOB_LIMITS.PRICE_MAX) {
                  currentErrors[field] = rule.message;
                } else if (paymentType === 'Anbud') {
                  currentErrors[field] =
                    'Vennligst oppgi et antatt budsjett større enn 0 kr for anbudet';
                } else if (paymentType === 'Timepris') {
                  currentErrors[field] = 'Vennligst oppgi en timepris større enn 0 kr';
                } else {
                  currentErrors[field] = 'Vennligst oppgi en fastpris større enn 0 kr';
                }
              } else {
                currentErrors[field] = rule.message;
              }
              isValid = false;
              break;
            }
          }
        }
      });

      // A typed address alone is not enough — the location must be confirmed
      // on the map (click pin / drag marker / geolocation), otherwise the job
      // silently posts with default coordinates. Coordinates live outside the
      // validation schema, so enforce the requirement here.
      //
      // These three used to fail silently: `isValid` went false and the toast named the
      // field, but nothing on the page turned red, so there was no target to scroll to and
      // nothing to look at once you got there. They write a message now like any other field.
      if (!coordinates) {
        extraErrors.coordinates =
          'Bekreft hvor oppdraget er — velg en adresse fra forslagene eller klikk i kartet.';
        isValid = false;
      }

      // Fylke and Kommune are marked required in the UI but sit outside the
      // schema too. Without them the job never matches the location filter
      // (serviceController.getAllServices), so it is invisible to the people
      // searching in that area.
      if (!countyCode) {
        extraErrors.countyCode = 'Velg fylke.';
        isValid = false;
      }
      if (!municipalityCode) {
        extraErrors.municipalityCode = 'Velg kommune.';
        isValid = false;
      }
      if (paymentType === 'Timepris') {
        const hourlyRateNumber = Number(hourlyRate);
        if (!Number.isFinite(hourlyRateNumber) || hourlyRateNumber <= 0) {
          extraErrors.price = 'Vennligst oppgi en timepris større enn 0 kr';
          isValid = false;
        } else if (hourlyRateNumber > JOB_LIMITS.PRICE_MAX) {
          extraErrors.price = 'Timepris kan ikke overstige 1000000 kr.';
          isValid = false;
        }
      }
    } else if (step === 4) {
      // Validate Step 4 fields (Contact Information)
      const fieldsToValidate: (keyof JobFormValues)[] = ['email', 'phone'];
      fieldsToValidate.forEach((field) => {
        const rules = fieldRules[field];
        if (rules) {
          for (const rule of rules) {
            if (!rule.test(values)) {
              currentErrors[field] = rule.message;
              isValid = false;
              break;
            }
          }
        }
      });
    }

    setErrors((prev) => ({ ...prev, ...currentErrors }));
    return isValid;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, LAST_STEP));
      return;
    }
    reportMissing(currentStep);
  };

  /** Toast naming what is missing on `step`, and scroll to it. */
  const reportMissing = (step: number) => {
    // The toast names what is missing; this takes them to it. Without it the page sits
    // still, and on a step several screens tall the empty field is usually off screen.
    scrollToFirstError();

    // Build a friendlier error message that names the missing/invalid fields
    // so the user knows what to fix instead of just "please fill in everything".
    // We re-run a quick check directly against the current state because
    // `setErrors` inside validateStep is async and the closure here still
    // holds the previous error snapshot.
    const labels: Record<string, string> = {
      title: 'tittel',
      description: 'beskrivelse',
      categories: 'kategori',
      address: 'adresse',
      city: 'by/sted',
      price: 'budsjett',
      durationValue: 'forventet varighet',
      fromDate: 'startdato',
      toDate: 'sluttdato',
      email: 'e-post',
      phone: 'telefon',
      countyCode: 'fylke',
      municipalityCode: 'kommune',
    };

    const missing: string[] = [];

    // Re-check fields with their validation rules to know exactly which ones failed.
    if (step === 1) {
      const titleLength = String(values.title ?? '').trim().length;
      if (titleLength < JOB_LIMITS.TITLE_MIN || titleLength > JOB_LIMITS.TITLE_MAX)
        missing.push(labels.title);
      const descriptionLength = String(values.description ?? '').trim().length;
      if (
        descriptionLength < JOB_LIMITS.DESCRIPTION_MIN ||
        descriptionLength > JOB_LIMITS.DESCRIPTION_MAX
      )
        missing.push(labels.description);
      const catOk = Array.isArray(values.categories)
        ? values.categories.length > 0
        : !!values.categories && String(values.categories).trim() !== '';
      if (!catOk) missing.push(labels.categories);
    } else if (step === 2) {
      if (!values.address) missing.push(labels.address);
      if (!values.city) missing.push(labels.city);
      const priceVal = values.price;
      const priceNumber = Number(priceVal);
      if (
        !priceVal ||
        (typeof priceVal === 'string' && priceVal.trim() === '') ||
        !Number.isFinite(priceNumber) ||
        priceNumber <= 0 ||
        priceNumber > JOB_LIMITS.PRICE_MAX
      ) {
        if (paymentType === 'Anbud') {
          missing.push('antatt budsjett for anbud');
        } else if (paymentType === 'Timepris') {
          missing.push('timepris');
        } else {
          missing.push('fastpris');
        }
      }
      const durVal = values.durationValue;
      const durationNumber = Number(durVal);
      if (
        !durVal ||
        (typeof durVal === 'string' && durVal.trim() === '') ||
        !Number.isFinite(durationNumber) ||
        durationNumber <= 0 ||
        durationNumber > JOB_LIMITS.DURATION_MAX
      )
        missing.push(labels.durationValue);
      // Dates are optional ("la feltene stå tomme"): only a malformed or reversed one is named.
      if (values.fromDate && Number.isNaN(new Date(values.fromDate).getTime()))
        missing.push(labels.fromDate);
      if (values.toDate && Number.isNaN(new Date(values.toDate).getTime())) {
        missing.push(labels.toDate);
      } else if (
        values.fromDate &&
        values.toDate &&
        new Date(values.toDate) < new Date(values.fromDate)
      ) {
        missing.push('gyldig sluttdato (kan ikke være før startdato)');
      }
      if (!countyCode) missing.push(labels.countyCode);
      if (!municipalityCode) missing.push(labels.municipalityCode);
      if (paymentType === 'Timepris') {
        const hourlyRateNumber = Number(hourlyRate);
        if (
          !hourlyRate ||
          (typeof hourlyRate === 'string' && hourlyRate.trim() === '') ||
          !Number.isFinite(hourlyRateNumber) ||
          hourlyRateNumber <= 0 ||
          hourlyRateNumber > JOB_LIMITS.PRICE_MAX
        )
          missing.push('timepris');
      }
      if (!coordinates) missing.push('lokasjon på kartet');
      // Contact is a folded section of this page: optional, only a malformed e-mail blocks.
      if (values.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(values.email).trim())) missing.push(labels.email);
      }
    }

    if (missing.length > 0) {
      const list =
        missing.length === 1
          ? missing[0]
          : missing.length === 2
            ? `${missing[0]} og ${missing[1]}`
            : `${missing.slice(0, -1).join(', ')} og ${missing[missing.length - 1]}`;
      toast.error(`Vennligst fyll ut: ${list}.`);
    } else {
      toast.error('Vennligst fyll ut alle påkrevde felt riktig.');
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  /** The whole form, not just the step in front of you; sends the user to the first problem. */
  const validateAll = () => {
    // `loadFormData` restores `currentStep`, so a draft can reopen on the last page with an
    // empty title on the first. `find` stops at the first failing step, the one to go back to.
    // validateStep(4) is the contact rules, which live on page 2 now.
    const failed = [1, 2, 4].find((step) => !validateStep(step));

    if (failed) {
      const page = Math.min(failed, LAST_STEP);
      if (currentStep !== page) setCurrentStep(page);
      // Sending them back a step is not enough on its own — the step opens at the top and the
      // field is usually below the fold, and on the frame this runs the new step has not
      // rendered yet. `scrollToFirstError` keeps looking across a few frames for exactly this.
      if (page === 2 && !coordinates) {
        toast.error('Bekreft hvor oppdraget skal utføres på kartet før du publiserer.');
        scrollToFirstError();
      } else {
        reportMissing(page);
      }
      return false;
    }
    return true;
  };

  const handleFinalSubmit = async () => {
    // Defensive guard: if we're somehow already submitting, ignore the click
    // (prevents double-submission and any "stuck loading" state from a previous
    // failed run that didn't reach `finally`).
    if (isSubmitting) return;
    if (!validateAll()) return;

    // Narrowing for TypeScript — step 2 above already refuses to pass without a pin, and
    // publishing without one used to fall back to Oslo city centre, putting the job in the
    // wrong place with no warning at all.
    if (!coordinates) return;

    if (!onSubmit) {
      toast.error('Kunne ikke sende skjemaet. Prøv igjen.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();

      formData.append('title', values.title);
      formData.append('description', values.description);
      formData.append('price', values.price.toString());
      if (hourlyRate) formData.append('hourlyRate', hourlyRate.toString());
      formData.append('urgent', urgent.toString());
      formData.append('maxApplicants', maxApplicants.toString());
      formData.append('equipment', equipment);
      formData.append('paymentType', paymentType);
      // Stored as contactPhone/contactEmail — the Service schema has no `phone`
      // or `email` path, so the old names were dropped by Mongoose strict mode
      // and everything typed in the contact step was thrown away.
      formData.append('contactPhone', values.phone ?? '');
      formData.append('contactEmail', values.email ?? '');

      if (fromDate) formData.append('fromDate', fromDate);
      if (toDate) formData.append('toDate', toDate);

      formData.append('location[address]', values.address);
      formData.append('location[city]', values.city);
      formData.append('location[type]', 'Point');
      formData.append('location[coordinates][0]', coordinates[1].toString()); // lng
      formData.append('location[coordinates][1]', coordinates[0].toString()); // lat
      if (countyCode) formData.append('countyCode', countyCode);
      if (municipalityCode) formData.append('municipalityCode', municipalityCode);
      if (areaCode) formData.append('areaCode', areaCode);
      if (/^\d{4}$/.test(postalCode)) formData.append('location[postalCode]', postalCode);

      if (values.categories) {
        const catArray = Array.isArray(values.categories) ? values.categories : [values.categories];
        catArray.forEach((cat) => formData.append('categories', cat));
      }

      tags.forEach((tag) => formData.append('tags', tag));

      if (durationValue) {
        formData.append('duration[value]', durationValue.toString());
        formData.append('duration[unit]', durationUnit);
      }

      // New files in the chosen order; `imageOrder` places them among the saved ones.
      let added = 0;
      const order = imageItems.map((item) => {
        if (!item.file) return item.url;
        // Already stored with the draft: the server takes it from there, no second upload.
        const stored = !isEditMode && draftImageUrls[fileSig(item.file)];
        if (stored) return stored;
        formData.append('images', item.file);
        return `new:${added++}`;
      });
      formData.append('imageOrder', JSON.stringify(order));
      if (!isEditMode && serverDraftId.current) formData.append('draftId', serverDraftId.current);
      if (urgent && urgentPurchaseId) formData.append('urgentPurchaseId', urgentPurchaseId);

      imagesToDelete.forEach((url) => {
        formData.append('imagesToDelete', url);
      });

      if (checklistItems.length > 0) {
        formData.append('checklist', JSON.stringify(checklistItems));
      }

      if (!isEditMode && userId) {
        formData.append('userId', userId);
      }

      await onSubmit(formData);
      // Clear the draft only after a successful POST, best-effort. Awaiting it
      // first would let an IndexedDB hang/failure block the request and leave
      // the Publish button stuck in a loading state forever.
      // Edit mode never loads the draft, so clearing it here would throw away an
      // unrelated half-written job the user has in progress.
      if (!isEditMode) clearFormData().catch(() => {});
      if (!isEditMode && serverDraftId.current) {
        clearTimeout(serverSyncTimer.current);
        const id = serverDraftId.current;
        serverDraftId.current = null;
        serverSync.current = serverSync.current.then(() => deleteJobDraft(id)).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['job-drafts'] });
      }
    } catch (error) {
      // The draft is deliberately left intact here — this catch is the failed
      // publish path, and it is the only copy of what the user typed.
      console.error('Submission error:', error);
      toast.error(
        getErrorMessage(error, 'Det oppstod en feil ved sending av oppdraget. Prøv igjen.')
      );
    } finally {
      // Always reset — even if the onSubmit promise never resolves or a
      // previous run crashed before reaching its own finally.
      setIsSubmitting(false);
    }
  };

  const handleExistingImageRemove = (url: string) => {
    setCurrentImages((prev) => prev.filter((img) => img !== url));
    setImagesToDelete((prev) => [...prev, url]);
  };

  const handleCancel = async () => {
    await clearFormData();
    window.location.reload();
  };

  const previewJobData = useMemo(() => {
    const previewImages = imageItems.map((item) => item.url);

    return {
      title: values.title,
      description: values.description,
      price: values.price ? parseInt(values.price.toString()) : 0,
      hourlyRate: hourlyRate ? parseInt(hourlyRate.toString()) : 0,
      images: previewImages,
      tags:
        tags.length > 0
          ? tags
          : values.categories
            ? Array.isArray(values.categories)
              ? values.categories
              : [values.categories]
            : [],
      location: {
        address: values.address,
        city: values.city,
        coordinates: (coordinates ? [coordinates[1], coordinates[0]] : [10.7461, 59.9127]) as [
          number,
          number,
        ],
      },
      duration: {
        value: durationValue ? parseInt(durationValue.toString()) : 0,
        unit: durationUnit,
      },
      fromDate,
      toDate,
      createdAt: new Date().toISOString(),
      userId: {
        _id: currentUser?._id || 'preview',
        name: currentUser?.name || 'Ditt navn',
        avatarUrl:
          currentUser?.avatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default',
        verified: currentUser?.verified || false,
        averageRating: currentUser?.averageRating || 5.0,
      },
    };
  }, [
    values,
    hourlyRate,
    imageItems,
    tags,
    durationValue,
    durationUnit,
    fromDate,
    toDate,
    currentUser,
    coordinates,
  ]);

  return {
    currentStep,
    setCurrentStep,
    title: values.title,
    setTitle,
    description: values.description,
    setDescription,
    address: values.address,
    setAddress,
    city: values.city,
    setCity,
    countyCode,
    setCountyCode,
    municipalityCode,
    setMunicipalityCode,
    areaCode,
    setAreaCode,
    postalCode,
    setPostalCode,
    coordinates,
    setCoordinates,
    categories: values.categories,
    setCategories,
    equipment,
    setEquipment,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    durationValue,
    setDurationValue,
    durationUnit,
    setDurationUnit,
    price: values.price,
    setPrice,
    hourlyRate,
    setHourlyRate,
    paymentType,
    setPaymentType,
    urgent,
    setUrgent,
    maxApplicants,
    setMaxApplicants,
    phone: values.phone,
    setPhone,
    email: values.email,
    setEmail,
    tags,
    setTags,
    selectedImages,
    // The wrapper, not the raw setter — it also clears the "last opp minst ett bilde" error.
    setSelectedImages: handleImagesChange,
    handleImageSelection,
    currentImages,
    setCurrentImages,
    imagesToDelete,
    setImagesToDelete,
    showPreview,
    setShowPreview,
    isGeneratingFullListing,
    isSubmitting,
    smartFillPrompt,
    setSmartFillPrompt,
    showSmartFillInput,
    setShowSmartFillInput,
    smartFillPricingNote,
    setSmartFillPricingNote,
    handleAiSmartFill,
    cancelAiSmartFill,
    urgentPurchaseId,
    setUrgentPurchaseId,
    aiDraftRows,
    applyAiDraft,
    handleNext,
    handleBack,
    handleFinalSubmit,
    validateAll,
    handleExistingImageRemove,
    imageItems,
    moveImage,
    handleCancel,
    previewJobData,
    currentUser,
    /**
     * `useForm` types its errors as `{ [K in keyof JobFormValues]?: string }`, but
     * `validateStep` also reports on `images`, `coordinates`, `countyCode` and
     * `municipalityCode` — four things validated here that live in their own state rather
     * than in the schema. Consumers read those keys and TypeScript rejected every one of
     * them; the return type says what the object actually contains.
     */
    errors: errors as JobFormErrors,
    checklistItems,
    setChecklistItems,
  };
};
