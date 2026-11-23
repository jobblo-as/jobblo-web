import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Calculator,
  Copy,
  ExternalLink,
  FileUp,
  ImagePlus,
  Link2,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  CARD,
  CONTAINER,
  HEADING,
  MICRO_LABEL,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SUBHEADING,
  TEXT_LINK,
} from '../../theme/brand';
import { useUserStore } from '../../stores/userStore';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { saveJobDraft, uploadJobDraftImage } from '../../api/jobDraftsAPI';
import {
  useRenovationCatalogue,
  useRenovationEstimate,
  useRenovationFacts,
  useRenovationPlanActions,
  useRenovationPlans,
} from '../../features/renovation/hooks';
import { photosForArea, toJobDrafts } from '../../features/renovation/toJobDrafts';
import {
  EMPTY_PLAN,
  fromSavedPlan,
  loadPlanState,
  selectedAreas,
  storePlanState,
  toPlanRequest,
  toSavedPlanBody,
  type PlanState,
} from '../../features/renovation/planState';
import {
  finnCodeOf,
  getRenovationPlan,
  type AreaKey,
  type Estimate,
  type Quality,
} from '../../features/renovation/renovationAPI';
import { EstimateView, NotesList, NumberField, PhotoTile, PlannerSelect, Step } from './parts';
import { DraftsSavedDialog, type DraftsResult, type SavedDraft } from './DraftsSavedDialog';
import { FIELD_LABEL, INPUT, chipClass, range, type AreaChoice, type PhotoItem } from './styles';

/**
 * Renovation planner ("Oppussingskalkulator", Jobblo-Renovation-planner.pdf).
 *
 * The user describes the home (listing text, prospectus PDF or photos read by AI, or typed
 * in), picks areas, scope and quality, and gets a price range per area from the backend
 * pricing config. The plan can be saved ("Mine planer"), shared as a read-only link, and
 * turned into one job draft per area ("Dine utkast").
 *
 * FINN pages are not fetched until FINN allows it (their terms restrict automated
 * collection): the FINN field only opens the listing so the user can copy its text.
 */

const MAX_TEXT = 7000; // the AI route refuses bodies over 8 000 characters
const MAX_PHOTOS = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// Photos are also stored with the job drafts, whose upload takes 8 MB per photo.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PLANNER_PATH = '/oppussingskalkulator';

const shareUrl = (shareId: string) =>
  `${window.location.origin}${PLANNER_PATH}/delt/${encodeURIComponent(shareId)}`;

export default function RenovationPlannerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAuth = useUserStore((state) => state.isAuthenticated);
  const { data: catalogue, isLoading, isError } = useRenovationCatalogue();
  const { data: savedPlans = [] } = useRenovationPlans(isAuth);
  const factsMutation = useRenovationFacts();
  const estimateMutation = useRenovationEstimate();
  const actions = useRenovationPlanActions();
  const [plan, setPlan] = useState<PlanState>(loadPlanState);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [prospectus, setProspectus] = useState<File | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [posting, setPosting] = useState(false);
  const [draftsResult, setDraftsResult] = useState<DraftsResult | null>(null);

  useEffect(() => storePlanState(plan), [plan]);

  const login = () => navigate('/login', { state: { from: PLANNER_PATH } });

  const update = (patch: Partial<PlanState>) => {
    setPlan((current) => ({ ...current, ...patch }));
    setEstimate(null); // a changed plan makes the shown numbers stale
  };

  const selected = selectedAreas(plan);
  const allKeys = catalogue?.areas.map((a) => a.key) ?? [];
  const everything = allKeys.length > 0 && selected.length === allKeys.length;
  const finnCode = finnCodeOf(plan.finnInput);
  const canReadListing =
    plan.listingText.trim().length >= 20 || Boolean(prospectus) || photos.length > 0;

  const toggleArea = (key: AreaKey) =>
    update({
      areas: { ...plan.areas, [key]: plan.areas[key] ? undefined : { scope: 'surface' } },
    });
  const toggleEverything = () =>
    update({
      areas: everything
        ? {}
        : Object.fromEntries(allKeys.map((k) => [k, plan.areas[k] ?? { scope: 'surface' }])),
    });
  const setChoice = (key: AreaKey, patch: Partial<AreaChoice>) =>
    update({ areas: { ...plan.areas, [key]: { scope: 'surface', ...plan.areas[key], ...patch } } });

  const pickProspectus = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') return toast.error('Prospektet må være en PDF.');
    if (file.size > MAX_FILE_BYTES) return toast.error('Prospektet er for stort. Maks 15 MB.');
    setProspectus(file);
  };
  const pickPhotos = (files: FileList | null) => {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (picked.some((f) => f.size > MAX_PHOTO_BYTES))
      toast.error('Et bilde er for stort. Maks 8 MB.');
    const next = [
      ...photos,
      ...picked
        .filter((f) => f.size <= MAX_PHOTO_BYTES)
        .map((file) => ({ file, area: '' as const })),
    ];
    if (next.length > MAX_PHOTOS) toast.error(`Maks ${MAX_PHOTOS} bilder.`);
    setPhotos(next.slice(0, MAX_PHOTOS));
  };
  const movePhoto = (index: number, step: -1 | 1) =>
    setPhotos((current) => {
      const to = index + step;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  const setPhotoArea = (index: number, area: PhotoItem['area']) =>
    setPhotos((current) => current.map((p, i) => (i === index ? { ...p, area } : p)));

  const readListing = () => {
    if (!isAuth) return login();
    factsMutation.mutate(
      {
        text: plan.listingText.trim().slice(0, MAX_TEXT),
        prospectus,
        images: photos.map((p) => p.file),
      },
      {
        onSuccess: (facts) => {
          // Each photo goes on the job for the area the AI saw in it; the user can change it.
          setPhotos((current) =>
            current.map((p, i) => ({ ...p, area: facts.photoAreas?.[i] ?? p.area }))
          );
          const keep = (value: number | null, current: string) =>
            value === null ? current : String(value);
          update({
            sizeM2: keep(facts.sizeM2, plan.sizeM2),
            rooms: keep(facts.rooms, plan.rooms),
            bathrooms: keep(facts.bathrooms, plan.bathrooms),
            yearBuilt: keep(facts.yearBuilt, plan.yearBuilt),
            homeType: facts.homeType ?? plan.homeType,
            notes: facts.standardNotes,
            // Pre-select what the listing calls outdated; the user can still change it.
            areas: {
              ...plan.areas,
              ...Object.fromEntries(
                facts.outdatedAreas.map((k) => [k, plan.areas[k] ?? { scope: 'surface' }])
              ),
            },
          });
          toast.success('Sjekk fakta under og rett det som ikke stemmer.');
        },
        onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke lese annonsen.')),
      }
    );
  };

  const calculate = (state: PlanState = plan) =>
    estimateMutation.mutate(toPlanRequest(state), {
      onSuccess: (result) => {
        setEstimate(result);
        requestAnimationFrame(() =>
          document.getElementById('estimate')?.scrollIntoView({ behavior: 'smooth' })
        );
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke beregne estimatet.')),
    });

  const applySuggestion = (key: AreaKey, change: Partial<AreaChoice>) => {
    const next = { ...plan, areas: { ...plan.areas, [key]: { ...plan.areas[key]!, ...change } } };
    setPlan(next);
    calculate(next);
  };

  const savePlan = () => {
    if (!isAuth) return login();
    actions.save.mutate(
      { id: plan.planId, body: toSavedPlanBody(plan) },
      {
        onSuccess: (saved) => {
          setPlan((current) => ({
            ...current,
            planId: saved._id ?? null,
            shareId: saved.shareId ?? null,
            title: saved.title,
          }));
          toast.success('Planen er lagret under «Mine planer».');
        },
        onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke lagre planen.')),
      }
    );
  };

  const copyLink = async (shareId: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(shareId));
      toast.success('Lenken er kopiert.');
    } catch {
      toast('Kopier lenken under.');
    }
  };

  const sharePlan = () => {
    if (!plan.planId) return;
    actions.share.mutate(plan.planId, {
      onSuccess: (shareId) => {
        setPlan((current) => ({ ...current, shareId }));
        copyLink(shareId);
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke dele planen.')),
    });
  };

  const stopSharing = () => {
    if (!plan.planId) return;
    actions.unshare.mutate(plan.planId, {
      onSuccess: () => {
        setPlan((current) => ({ ...current, shareId: null }));
        toast.success('Lenken virker ikke lenger.');
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke slutte å dele.')),
    });
  };

  const openPlan = async (id: string) => {
    try {
      const saved = await getRenovationPlan(id);
      setPlan(fromSavedPlan(saved, true));
      setEstimate(saved.estimate);
      setProspectus(null);
      setPhotos([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(getErrorMessage(err, 'Kunne ikke åpne planen.'));
    }
  };

  const deletePlan = (id: string) =>
    actions.remove.mutate(id, {
      onSuccess: () => {
        if (plan.planId === id) setPlan((current) => ({ ...current, planId: null, shareId: null }));
        toast.success('Planen er slettet.');
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Kunne ikke slette planen.')),
    });

  const newPlan = () => {
    setPlan(EMPTY_PLAN);
    setEstimate(null);
    setProspectus(null);
    setPhotos([]);
  };

  const postAsJobs = async () => {
    if (!estimate) return;
    if (!isAuth) return login();
    setPosting(true);
    const saved: SavedDraft[] = [];
    let photoFailures = 0;
    let error: string | null = null;
    const drafts = toJobDrafts(estimate, plan.notes);
    try {
      for (const [i, draft] of drafts.entries()) {
        const id = await saveJobDraft(null, draft);
        const entry: SavedDraft = {
          id,
          title: draft.title,
          paymentType: draft.paymentType,
          price: Number(draft.price),
          photos: 0,
        };
        saved.push(entry); // listed even if its photos fail below: the draft exists
        // The listing photos for this area go with the job, so the provider sees them. They
        // are stored with the draft (as the job form does) and published from there.
        const draftImageUrls: Record<string, string> = {};
        for (const [n, photo] of photosForArea(photos, estimate.areas[i].key).entries()) {
          try {
            draftImageUrls[`plan-${n}`] = await uploadJobDraftImage(id, photo.file);
          } catch {
            photoFailures += 1;
          }
        }
        if (Object.keys(draftImageUrls).length) {
          await saveJobDraft(id, { ...draft, draftImageUrls });
          entry.photos = Object.keys(draftImageUrls).length;
        }
      }
    } catch (err) {
      error = getErrorMessage(err, 'Kunne ikke lagre utkastene.');
    } finally {
      setPosting(false);
    }
    if (!saved.length) {
      toast.error(error ?? 'Kunne ikke lagre utkastene.');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['job-drafts'] });
    // What was saved, in a dialog the user closes; they go to the drafts when ready.
    setDraftsResult({ drafts: saved, total: drafts.length, photoFailures, error });
  };

  if (isLoading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-[#2E6641]" aria-label="Laster" />
      </div>
    );
  if (isError || !catalogue)
    return (
      <div className={`${CONTAINER} py-16 text-center ${SUBHEADING}`}>
        Kalkulatoren er ikke tilgjengelig akkurat nå. Prøv igjen senere.
      </div>
    );

  return (
    <div className="bg-[#EFF0EA]">
      <div className={`${CONTAINER} max-w-200 py-10 sm:py-14`}>
        <p className={MICRO_LABEL}>Oppussingskalkulator</p>
        <h1 className={`mt-3 ${HEADING}`}>
          Hva koster <span className="text-[#2E6641]">oppussingen</span>?
        </h1>
        <p className={`mt-4 max-w-[52ch] ${SUBHEADING}`}>
          Beskriv boligen, velg hva du vil pusse opp, og få et prisanslag per rom. Planen kan
          lagres, deles og legges ut som oppdrag med ett trykk.
        </p>

        {isAuth && savedPlans.length > 0 && (
          <section className={`${CARD} mt-8 p-5 sm:p-6`} aria-labelledby="my-plans">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="my-plans" className="font-semibold text-[#0B0B0B]">
                Mine planer
              </h2>
              <button type="button" onClick={newPlan} className={TEXT_LINK}>
                Ny plan
              </button>
            </div>
            <ul className="mt-3 divide-y divide-[#E6E7E1]">
              {savedPlans.map((saved) => (
                <li key={saved._id} className="flex flex-wrap items-center gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => openPlan(saved._id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium text-[#0B0B0B]">
                      {saved.title}
                      {plan.planId === saved._id && (
                        <span className="ml-2 text-[0.75rem] text-[#2E6641]">(åpen)</span>
                      )}
                    </span>
                    <span className="text-[0.8125rem] text-[#63665F]">
                      {saved.total
                        ? range(saved.total.low, saved.total.high)
                        : 'Må beregnes på nytt'}
                      {saved.shareId ? ' · Delt' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Slett ${saved.title}`}
                    onClick={() => deletePlan(saved._id)}
                    className="flex size-9 items-center justify-center rounded-lg text-[#9B9E96] hover:bg-[#EDEEE8] hover:text-[#B42318]"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8 space-y-4">
          <Step n={1} title="Om boligen">
            <label className="block">
              <span className={FIELD_LABEL}>FINN-lenke eller FINN-kode (valgfritt)</span>
              <input
                value={plan.finnInput}
                onChange={(e) => update({ finnInput: e.target.value.slice(0, 300) })}
                placeholder="https://www.finn.no/... eller 412345678"
                className={`${INPUT} mt-1.5`}
              />
            </label>
            {finnCode && (
              <p className="mt-2 text-[0.8125rem] text-[#63665F]">
                <a
                  href={`https://www.finn.no/${finnCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${TEXT_LINK} inline-flex items-center gap-1`}
                >
                  Åpne annonsen på FINN <ExternalLink size={13} />
                </a>{' '}
                og kopier beskrivelsen inn under. Vi henter ikke innhold fra FINN selv.
              </p>
            )}

            <label className="mt-5 block">
              <span className={FIELD_LABEL}>Teksten fra boligannonsen (valgfritt)</span>
              <textarea
                value={plan.listingText}
                maxLength={MAX_TEXT}
                onChange={(e) => update({ listingText: e.target.value })}
                rows={5}
                placeholder="Kopier beskrivelsen fra FINN-annonsen eller prospektet og lim den inn her."
                className={`${INPUT} mt-1.5 h-auto py-3`}
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className={`${SECONDARY_BUTTON} cursor-pointer`}>
                <FileUp size={16} />
                {prospectus ? 'Bytt prospekt' : 'Last opp prospekt (PDF)'}
                <input
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    pickProspectus(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className={`${SECONDARY_BUTTON} cursor-pointer`}>
                <ImagePlus size={16} />
                Legg til bilder ({photos.length}/{MAX_PHOTOS})
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    pickPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {prospectus && (
              <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F6F7F2] py-1 pl-3 pr-1 text-[0.8125rem] text-[#3F423C]">
                <span className="truncate">{prospectus.name}</span>
                <button
                  type="button"
                  aria-label={`Fjern ${prospectus.name}`}
                  onClick={() => setProspectus(null)}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-[#E6E7E1]"
                >
                  <X size={13} />
                </button>
              </p>
            )}
            {photos.length > 0 && (
              <>
                {/* The job form's photo tiles, in a row; the order is the order on the jobs. */}
                <ol className="mt-4 flex flex-wrap gap-3" aria-label="Bilder i rekkefølge">
                  {photos.map((photo, i) => (
                    <PhotoTile
                      key={`${photo.file.name}-${photo.file.lastModified}-${i}`}
                      photo={photo}
                      index={i}
                      count={photos.length}
                      areas={catalogue.areas}
                      onArea={(area) => setPhotoArea(i, area)}
                      onRemove={() => setPhotos(photos.filter((_, n) => n !== i))}
                      onMove={(step) => movePhoto(i, step)}
                    />
                  ))}
                </ol>
                <p className="mt-2 text-[0.75rem] text-[#9B9E96]">
                  Bildene legges ved oppdraget for rommet de viser, så den som skal gjøre jobben ser
                  dem. «Hele boligen» legges ved alle oppdragene.
                </p>
              </>
            )}

            <button
              type="button"
              onClick={readListing}
              disabled={factsMutation.isPending || !canReadListing}
              className={`${PRIMARY_BUTTON} mt-4`}
            >
              {factsMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {isAuth ? 'Les annonsen med AI' : 'Logg inn for å la AI lese annonsen'}
            </button>
            {factsMutation.isPending && (prospectus || photos.length > 0) && (
              <p className="mt-2 text-[0.8125rem] text-[#63665F]">
                Prospekt og bilder tar litt tid å lese …
              </p>
            )}

            <p className="mt-6 text-[0.8125rem] text-[#63665F]">
              Eller fyll inn selv. Tomme felt får vanlige verdier ({catalogue.defaults.sizeM2} m²,{' '}
              {catalogue.defaults.rooms} rom, {catalogue.defaults.bathrooms} bad).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumberField
                label="Størrelse"
                suffix="m²"
                value={plan.sizeM2}
                onChange={(v) => update({ sizeM2: v })}
              />
              <NumberField
                label="Stuer og soverom"
                value={plan.rooms}
                onChange={(v) => update({ rooms: v })}
              />
              <NumberField
                label="Bad"
                value={plan.bathrooms}
                onChange={(v) => update({ bathrooms: v })}
              />
              <NumberField
                label="Byggeår"
                value={plan.yearBuilt}
                onChange={(v) => update({ yearBuilt: v })}
              />
            </div>
            <div className="mt-3 max-w-60">
              <span className={FIELD_LABEL}>Boligtype</span>
              <PlannerSelect
                ariaLabel="Boligtype"
                value={plan.homeType}
                onChange={(value) => update({ homeType: value })}
                emptyLabel="Velg boligtype"
                options={catalogue.homeTypes.map((type) => ({
                  value: type.key,
                  label: type.label,
                }))}
                className="mt-1.5"
              />
            </div>
            <NotesList notes={plan.notes} />
          </Step>

          <Step n={2} title="Hva vil du pusse opp?">
            <div className="flex flex-wrap gap-2">
              {catalogue.areas.map((area) => (
                <button
                  key={area.key}
                  type="button"
                  aria-pressed={Boolean(plan.areas[area.key])}
                  onClick={() => toggleArea(area.key)}
                  className={chipClass(Boolean(plan.areas[area.key]))}
                >
                  {area.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={everything}
                onClick={toggleEverything}
                className={`${chipClass(everything)} font-semibold`}
              >
                Alt
              </button>
            </div>
          </Step>

          {selected.length > 0 && (
            <Step n={3} title="Overflate eller total?">
              <ul className="divide-y divide-[#E6E7E1]">
                {catalogue.areas
                  .filter((area) => plan.areas[area.key])
                  .map((area) => {
                    const choice = plan.areas[area.key]!;
                    return (
                      <li key={area.key} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="font-semibold text-[#0B0B0B]">{area.label}</span>
                          <div className="flex flex-wrap gap-2">
                            {catalogue.scopes.map((scope) => (
                              <button
                                key={scope.key}
                                type="button"
                                aria-pressed={choice.scope === scope.key}
                                onClick={() => setChoice(area.key, { scope: scope.key })}
                                className={chipClass(choice.scope === scope.key)}
                              >
                                {scope.label}
                              </button>
                            ))}
                            <PlannerSelect
                              ariaLabel={`Kvalitet for ${area.label.toLowerCase()}`}
                              value={choice.quality ?? ''}
                              onChange={(value) =>
                                setChoice(area.key, {
                                  quality: (value || undefined) as Quality | undefined,
                                })
                              }
                              emptyLabel="Kvalitet som resten"
                              options={catalogue.qualities.map((q) => ({
                                value: q.key,
                                label: q.label,
                              }))}
                              className="h-9 w-auto min-w-44 text-[0.8125rem]"
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-[0.8125rem] text-[#63665F]">
                          {choice.scope === 'full' ? area.full : area.surface}
                        </p>
                      </li>
                    );
                  })}
              </ul>
            </Step>
          )}

          <Step n={selected.length > 0 ? 4 : 3} title="Kvalitet">
            <div className="flex flex-wrap gap-2">
              {catalogue.qualities.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  aria-pressed={plan.quality === q.key}
                  onClick={() => update({ quality: q.key })}
                  className={chipClass(plan.quality === q.key)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </Step>

          <Step n={selected.length > 0 ? 5 : 4} title="Budsjett (valgfritt)">
            <div className="max-w-60">
              <NumberField
                label="Hvor mye vil du bruke?"
                suffix="kr"
                value={plan.budget}
                onChange={(v) => update({ budget: v })}
              />
            </div>
          </Step>

          <button
            type="button"
            onClick={() => calculate()}
            disabled={selected.length === 0 || estimateMutation.isPending}
            className={`${PRIMARY_BUTTON} w-full`}
          >
            {estimateMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Calculator size={18} />
            )}
            {selected.length === 0 ? 'Velg minst ett område' : 'Beregn estimat'}
          </button>
        </div>

        {estimate && (
          <EstimateView estimate={estimate} onApply={applySuggestion}>
            <div className={`${CARD} mt-6 p-5 sm:p-6`}>
              <h3 className="font-semibold text-[#0B0B0B]">Lagre og del</h3>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 basis-60">
                  <span className={FIELD_LABEL}>Navn på planen</span>
                  <input
                    value={plan.title}
                    maxLength={120}
                    onChange={(e) => setPlan({ ...plan, title: e.target.value })}
                    placeholder="Min oppussingsplan"
                    className={`${INPUT} mt-1.5`}
                  />
                </label>
                <button
                  type="button"
                  onClick={savePlan}
                  disabled={actions.save.isPending}
                  className={SECONDARY_BUTTON}
                >
                  {actions.save.isPending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  {!isAuth
                    ? 'Logg inn for å lagre'
                    : plan.planId
                      ? 'Lagre endringer'
                      : 'Lagre plan'}
                </button>
                {plan.planId && !plan.shareId && (
                  <button
                    type="button"
                    onClick={sharePlan}
                    disabled={actions.share.isPending}
                    className={SECONDARY_BUTTON}
                  >
                    <Link2 size={16} /> Del plan
                  </button>
                )}
              </div>
              {plan.shareId && (
                <div className="mt-4 rounded-2xl bg-[#F6F7F2] p-4">
                  <p className="text-[0.8125rem] text-[#63665F]">
                    Alle med lenken kan se planen (ikke hvem du er):
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={shareUrl(plan.shareId)}
                      aria-label="Delingslenke"
                      onFocus={(e) => e.target.select()}
                      className={`${INPUT} min-w-0 flex-1 basis-60`}
                    />
                    <button
                      type="button"
                      onClick={() => copyLink(plan.shareId!)}
                      className={SECONDARY_BUTTON}
                    >
                      <Copy size={16} /> Kopier
                    </button>
                    <button type="button" onClick={stopSharing} className={TEXT_LINK}>
                      Slutt å dele
                    </button>
                  </div>
                </div>
              )}
              {plan.planId && (
                <p className="mt-3 text-[0.75rem] text-[#9B9E96]">
                  Endringer i planen må lagres før de vises i den delte lenken.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={postAsJobs}
              disabled={posting}
              className={`${PRIMARY_BUTTON} mt-6 w-full`}
            >
              {posting && <Loader2 size={18} className="animate-spin" />}
              {isAuth ? 'Legg ut som oppdrag' : 'Logg inn for å legge ut som oppdrag'}
            </button>
            <p className="mt-2 text-center text-[0.8125rem] text-[#63665F]">
              Ett utkast per område. Du ser over hvert oppdrag før det publiseres.
            </p>
          </EstimateView>
        )}
      </div>

      <DraftsSavedDialog
        result={draftsResult}
        onClose={() => setDraftsResult(null)}
        onOpenDrafts={() => {
          const first = draftsResult?.drafts[0]?.id;
          setDraftsResult(null);
          if (first) navigate(`/Publish-job?utkast=${first}`);
        }}
      />
    </div>
  );
}
