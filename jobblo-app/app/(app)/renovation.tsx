import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Calculator,
  ExternalLink,
  FileUp,
  ImagePlus,
  Link2,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { Chip } from '../../src/components/ui/Chip';
import { Field } from '../../src/components/ui/Field';
import { Select } from '../../src/components/ui/Select';
import { ErrorState } from '../../src/components/ui/ErrorState';
import { TC, tc } from '../../src/theme/colors';
import { queryKeys } from '../../src/queryKeys';
import type { CreateJobImage } from '../../src/services/createJob.service';
import { saveJobDraft, uploadJobDraftImage } from '../../src/services/jobDrafts.service';
import {
  deleteRenovationPlan,
  getRenovationCatalogue,
  getRenovationPlan,
  listRenovationPlans,
  postRenovationEstimate,
  postRenovationFacts,
  saveRenovationPlan,
  shareRenovationPlan,
  unshareRenovationPlan,
  type AreaKey,
  type Estimate,
  type Quality,
  type SavedPlanBody,
} from '../../src/services/renovation.service';
import { DRAFTS_KEY } from '../../src/features/post-job/draftSync';
import {
  EMPTY_PLAN,
  finnCodeOf,
  fromSavedPlan,
  range,
  selectedAreas,
  toPlanRequest,
  toSavedPlanBody,
  withFacts,
  type AreaChoice,
  type PlanState,
} from '../../src/features/renovation/planState';
import { photosForArea, toJobDrafts } from '../../src/features/renovation/toJobDrafts';
import { EstimateView, NotesList, NumberField, Step } from '../../src/features/renovation/parts';
import {
  DraftsSavedSheet,
  type DraftsResult,
  type SavedDraft,
} from '../../src/features/renovation/DraftsSavedSheet';

/**
 * Renovation planner ("Oppussingskalkulator"), the app version of the web page
 * frontend/src/pages/RenovationPlannerPage. Describe the home (listing text, prospectus PDF or
 * photos read by AI, or typed in), pick areas, scope and quality, and get a price range per
 * area. The plan can be saved ("Mine planer"), shared as a web link, and turned into one job
 * draft per area ("Dine utkast" on the Legg ut tab).
 *
 * FINN pages are not fetched (their terms restrict automated collection): the FINN field only
 * opens the listing so the user can copy its text.
 */

/** A listing photo and the area whose job it goes on ('' = the whole home: every job). */
type PhotoItem = { image: CreateJobImage; area: AreaKey | '' };

const MAX_TEXT = 7000; // the AI route refuses bodies over 8 000 characters
const MAX_PHOTOS = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// Photos are also stored with the job drafts, whose upload takes 8 MB per photo.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'https://jobblo.no').replace(/\/$/, '');

const shareUrl = (shareId: string) =>
  `${WEB_URL}/oppussingskalkulator/delt/${encodeURIComponent(shareId)}`;

/** The backend answers `{ error }` or `{ message }`; read both. */
function errorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response
    ?.data;
  return data?.error || data?.message || fallback;
}

export default function RenovationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const estimateY = useRef(0);
  const [scrollToEstimate, setScrollToEstimate] = useState(false);

  const catalogueQuery = useQuery({
    queryKey: queryKeys.renovation.catalogue,
    queryFn: getRenovationCatalogue,
    staleTime: 1000 * 60 * 60,
  });
  const { data: savedPlans = [] } = useQuery({
    queryKey: queryKeys.renovation.plans,
    queryFn: listRenovationPlans,
  });
  const onPlansChanged = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.renovation.plans });
  const factsMutation = useMutation({ mutationFn: postRenovationFacts });
  const estimateMutation = useMutation({ mutationFn: postRenovationEstimate });
  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SavedPlanBody }) =>
      saveRenovationPlan(id, body),
    onSuccess: onPlansChanged,
  });
  const removeMutation = useMutation({
    mutationFn: deleteRenovationPlan,
    onSuccess: onPlansChanged,
  });
  const shareMutation = useMutation({ mutationFn: shareRenovationPlan, onSuccess: onPlansChanged });
  const unshareMutation = useMutation({
    mutationFn: unshareRenovationPlan,
    onSuccess: onPlansChanged,
  });

  const [plan, setPlan] = useState<PlanState>(EMPTY_PLAN);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [prospectus, setProspectus] = useState<CreateJobImage | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [posting, setPosting] = useState(false);
  const [draftsResult, setDraftsResult] = useState<DraftsResult | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // After "Beregn estimat" the result is laid out first, then scrolled to.
  useEffect(() => {
    if (!scrollToEstimate || !estimate) return;
    setScrollToEstimate(false);
    const id = setTimeout(
      () => scrollRef.current?.scrollTo({ y: Math.max(0, estimateY.current - 12) }),
      50
    );
    return () => clearTimeout(id);
  }, [scrollToEstimate, estimate]);

  const update = (patch: Partial<PlanState>) => {
    setPlan((current) => ({ ...current, ...patch }));
    setEstimate(null); // a changed plan makes the shown numbers stale
  };

  const catalogue = catalogueQuery.data;
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

  const pickProspectus = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets.length) return;
    const file = result.assets[0];
    const type = file.mimeType || 'application/pdf';
    if (type !== 'application/pdf' && !/\.pdf$/i.test(file.name))
      return Alert.alert('Prospektet må være en PDF.');
    if ((file.size ?? 0) > MAX_FILE_BYTES)
      return Alert.alert('Prospektet er for stort. Maks 15 MB.');
    setProspectus({ uri: file.uri, name: file.name || 'prospekt.pdf', type: 'application/pdf' });
  };

  const pickPhotos = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return Alert.alert(`Maks ${MAX_PHOTOS} bilder.`);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;
    const tooBig = result.assets.some((a) => (a.fileSize ?? 0) > MAX_PHOTO_BYTES);
    if (tooBig) Alert.alert('Et bilde er for stort. Maks 8 MB.');
    const picked: PhotoItem[] = result.assets
      .filter((a) => (a.fileSize ?? 0) <= MAX_PHOTO_BYTES)
      .map((a, i) => ({
        image: {
          uri: a.uri,
          name: a.fileName ?? `bolig-${Date.now()}-${i}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        },
        area: '',
      }));
    const next = [...photos, ...picked];
    if (next.length > MAX_PHOTOS) Alert.alert(`Maks ${MAX_PHOTOS} bilder.`);
    setPhotos(next.slice(0, MAX_PHOTOS));
  };

  const readListing = () =>
    factsMutation.mutate(
      {
        text: plan.listingText.trim().slice(0, MAX_TEXT),
        prospectus,
        images: photos.map((p) => p.image),
      },
      {
        onSuccess: (facts) => {
          setPlan((current) => withFacts(current, facts));
          // Each photo goes on the job for the area the AI saw in it; the user can change it.
          setPhotos((current) =>
            current.map((p, i) => ({ ...p, area: facts.photoAreas?.[i] ?? p.area }))
          );
          setEstimate(null);
          Alert.alert('Annonsen er lest', 'Sjekk fakta under og rett det som ikke stemmer.');
        },
        onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke lese annonsen.')),
      }
    );

  const calculate = (state: PlanState = plan) =>
    estimateMutation.mutate(toPlanRequest(state), {
      onSuccess: (result) => {
        setEstimate(result);
        setScrollToEstimate(true);
      },
      onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke beregne estimatet.')),
    });

  const applySuggestion = (key: AreaKey, change: Partial<AreaChoice>) => {
    const current = plan.areas[key];
    if (!current) return;
    const next = { ...plan, areas: { ...plan.areas, [key]: { ...current, ...change } } };
    setPlan(next);
    calculate(next);
  };

  const savePlan = () =>
    saveMutation.mutate(
      { id: plan.planId, body: toSavedPlanBody(plan) },
      {
        onSuccess: (saved) => {
          setPlan((current) => ({
            ...current,
            planId: saved._id ?? null,
            shareId: saved.shareId ?? null,
            title: saved.title,
          }));
          Alert.alert('Planen er lagret under «Mine planer».');
        },
        onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke lagre planen.')),
      }
    );

  const openShareSheet = async (shareId: string) => {
    try {
      const url = shareUrl(shareId);
      await Share.share({ message: `${plan.title.trim() || 'Min oppussingsplan'}\n\n${url}`, url });
    } catch {
      // The sheet was dismissed or could not open; the link stays shown below.
    }
  };

  const sharePlan = () => {
    if (!plan.planId) return;
    shareMutation.mutate(plan.planId, {
      onSuccess: (shareId) => {
        setPlan((current) => ({ ...current, shareId }));
        void openShareSheet(shareId);
      },
      onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke dele planen.')),
    });
  };

  const stopSharing = () => {
    if (!plan.planId) return;
    unshareMutation.mutate(plan.planId, {
      onSuccess: () => {
        setPlan((current) => ({ ...current, shareId: null }));
        Alert.alert('Lenken virker ikke lenger.');
      },
      onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke slutte å dele.')),
    });
  };

  const openPlan = async (id: string) => {
    if (opening) return;
    setOpening(id);
    try {
      const saved = await getRenovationPlan(id);
      setPlan(fromSavedPlan(saved, true));
      setEstimate(saved.estimate);
      setProspectus(null);
      setPhotos([]);
      scrollRef.current?.scrollTo({ y: 0 });
    } catch (err) {
      Alert.alert(errorMessage(err, 'Kunne ikke åpne planen.'));
    } finally {
      setOpening(null);
    }
  };

  const deletePlan = (id: string, title: string) =>
    Alert.alert('Slette planen?', title, [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Slett',
        style: 'destructive',
        onPress: () =>
          removeMutation.mutate(id, {
            onSuccess: () => {
              setPlan((current) =>
                current.planId === id ? { ...current, planId: null, shareId: null } : current
              );
            },
            onError: (err) => Alert.alert(errorMessage(err, 'Kunne ikke slette planen.')),
          }),
      },
    ]);

  const newPlan = () => {
    setPlan(EMPTY_PLAN);
    setEstimate(null);
    setProspectus(null);
    setPhotos([]);
    scrollRef.current?.scrollTo({ y: 0 });
  };

  const postAsJobs = async () => {
    if (!estimate || posting) return;
    setPosting(true);
    const drafts = toJobDrafts(estimate, plan.notes);
    const saved: SavedDraft[] = [];
    let failure: unknown = null;
    let photoFailures = 0;
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
        // are stored with the draft (as the post-job flow does) and published from there.
        const draftImageUrls: Record<string, string> = {};
        for (const [n, photo] of photosForArea(photos, estimate.areas[i].key).entries()) {
          try {
            draftImageUrls[photo.image.uri || `plan-${n}`] = await uploadJobDraftImage(
              id,
              photo.image
            );
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
      failure = err;
    } finally {
      setPosting(false);
    }
    if (!saved.length) {
      Alert.alert(errorMessage(failure, 'Kunne ikke lagre utkastene.'));
      return;
    }
    void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    // What was saved, in a sheet; the user goes to the drafts when ready.
    setDraftsResult({
      drafts: saved,
      total: drafts.length,
      photoFailures,
      error: failure ? errorMessage(failure, 'Resten kunne ikke lagres.') : null,
    });
  };

  const screen = (child: React.ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      {child}
    </SafeAreaView>
  );

  if (catalogueQuery.isLoading)
    return screen(
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={TC.brandText} accessibilityLabel="Laster" />
      </View>
    );
  if (catalogueQuery.isError || !catalogue)
    return screen(
      <ErrorState
        title="Kalkulatoren er ikke tilgjengelig"
        message="Prøv igjen om litt."
        actionLabel="Prøv igjen"
        onAction={() => void catalogueQuery.refetch()}
      />
    );

  const stepOffset = selected.length > 0 ? 1 : 0;

  return screen(
    <KeyboardAvoidingView className="flex-1" behavior="padding">
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        // The tab layout already keeps room for the tab bar under this screen (sceneStyle
        // paddingBottom); 120 here on top of it left a big empty gap under the last button.
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
      >
        <ScreenHeader
          title="Oppussingskalkulator"
          subtitle="Beskriv boligen, velg hva du vil pusse opp, og få et prisanslag per rom. Planen kan lagres, deles og legges ut som oppdrag."
          icon={Calculator}
          backLabel="Tilbake"
        />

        {savedPlans.length > 0 ? (
          <Card className="mb-4 p-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text accessibilityRole="header" className="text-[0.9375rem] font-semibold text-ink">
                Mine planer
              </Text>
              <Pressable onPress={newPlan} hitSlop={8} accessibilityRole="button">
                <Text className="text-[0.875rem] font-semibold text-brand-text">Ny plan</Text>
              </Pressable>
            </View>
            <View className="mt-2">
              {savedPlans.map((saved, i) => (
                <View
                  key={saved._id}
                  className={`flex-row items-center gap-3 py-3 ${i ? 'border-t border-line' : ''}`}
                >
                  <Pressable
                    onPress={() => void openPlan(saved._id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Åpne ${saved.title}`}
                    className="min-w-0 flex-1 active:opacity-70"
                  >
                    <Text className="text-[0.9375rem] font-medium text-ink" numberOfLines={1}>
                      {saved.title}
                      {plan.planId === saved._id ? (
                        <Text className="text-[0.8125rem] text-brand-text"> (åpen)</Text>
                      ) : null}
                    </Text>
                    <Text className="mt-0.5 text-[0.8125rem] text-muted">
                      {saved.total
                        ? range(saved.total.low, saved.total.high)
                        : 'Må beregnes på nytt'}
                      {saved.shareId ? ' · Delt' : ''}
                    </Text>
                  </Pressable>
                  {opening === saved._id ? (
                    <ActivityIndicator size="small" color={TC.brandText} />
                  ) : null}
                  <Pressable
                    onPress={() => deletePlan(saved._id, saved.title)}
                    disabled={removeMutation.isPending}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Slett ${saved.title}`}
                    className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
                  >
                    <Trash2 size={17} color={tc('#B4544A', 'danger')} />
                  </Pressable>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <View className="gap-4">
          <Step n={1} title="Om boligen">
            <Field
              label="FINN-lenke eller FINN-kode (valgfritt)"
              value={plan.finnInput}
              onChangeText={(text) => update({ finnInput: text.slice(0, 300) })}
              placeholder="https://www.finn.no/... eller 412345678"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {finnCode ? (
              <View className="mt-2">
                <Pressable
                  onPress={() => void Linking.openURL(`https://www.finn.no/${finnCode}`)}
                  accessibilityRole="link"
                  className="flex-row items-center gap-1 self-start py-1 active:opacity-70"
                >
                  <Text className="text-[0.875rem] font-semibold text-brand-text">
                    Åpne annonsen på FINN
                  </Text>
                  <ExternalLink size={14} color={TC.brandText} />
                </Pressable>
                <Text className="text-[0.8125rem] leading-5 text-muted">
                  Kopier beskrivelsen inn under. Vi henter ikke innhold fra FINN selv.
                </Text>
              </View>
            ) : null}

            <Field
              className="mt-4"
              label="Teksten fra boligannonsen (valgfritt)"
              value={plan.listingText}
              onChangeText={(text) => update({ listingText: text })}
              maxLength={MAX_TEXT}
              showCount
              multiline
              placeholder="Kopier beskrivelsen fra FINN-annonsen eller prospektet og lim den inn her."
            />

            <View className="mt-4 flex-row flex-wrap gap-2">
              <Button
                variant="secondary"
                small
                label={prospectus ? 'Bytt prospekt' : 'Last opp prospekt (PDF)'}
                icon={<FileUp size={16} color={TC.ink} />}
                onPress={() => void pickProspectus()}
              />
              <Button
                variant="secondary"
                small
                label={`Legg til bilder (${photos.length}/${MAX_PHOTOS})`}
                icon={<ImagePlus size={16} color={TC.ink} />}
                onPress={() => void pickPhotos()}
              />
            </View>
            {prospectus ? (
              <View className="mt-3 max-w-full flex-row items-center gap-1.5 self-start rounded-full bg-surface-2 py-1 pl-3 pr-1">
                <Text className="shrink text-[0.8125rem] text-ink-2" numberOfLines={1}>
                  {prospectus.name}
                </Text>
                <Pressable
                  onPress={() => setProspectus(null)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Fjern ${prospectus.name}`}
                  className="h-6 w-6 items-center justify-center rounded-full active:bg-surface"
                >
                  <X size={13} color={TC.inkMuted} />
                </Pressable>
              </View>
            ) : null}
            {photos.length > 0 ? (
              <View className="mt-3 gap-2">
                {photos.map((photo, i) => (
                  <View
                    key={`${photo.image.uri}-${i}`}
                    className="flex-row items-center gap-3 rounded-2xl bg-surface-2 p-2"
                  >
                    <Image
                      source={{ uri: photo.image.uri }}
                      style={{ width: 48, height: 48, borderRadius: 12 }}
                      accessibilityIgnoresInvertColors
                    />
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="text-[0.8125rem] text-muted" numberOfLines={1}>
                        Legges ved oppdraget for
                      </Text>
                      <Select
                        value={photo.area}
                        placeholder="Hele boligen"
                        options={[
                          { label: 'Hele boligen', value: '' },
                          ...catalogue.areas.map((a) => ({ label: a.label, value: a.key })),
                        ]}
                        onValueChange={(value) =>
                          setPhotos((current) =>
                            current.map((p, n) =>
                              n === i ? { ...p, area: value as PhotoItem['area'] } : p
                            )
                          )
                        }
                      />
                    </View>
                    <Pressable
                      onPress={() => setPhotos(photos.filter((_, n) => n !== i))}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Fjern ${photo.image.name}`}
                      className="h-8 w-8 items-center justify-center rounded-full active:bg-surface"
                    >
                      <X size={14} color={TC.inkMuted} />
                    </Pressable>
                  </View>
                ))}
                <Text className="text-[0.8125rem] text-muted">
                  Bildene legges ved oppdraget for rommet de viser, så den som skal gjøre jobben ser
                  dem. «Hele boligen» legges ved alle oppdragene.
                </Text>
              </View>
            ) : null}

            <View className="mt-4">
              <Button
                label="Les annonsen med AI"
                icon={<Sparkles size={16} color="#FFFFFF" />}
                loading={factsMutation.isPending}
                disabled={!canReadListing}
                onPress={readListing}
              />
            </View>
            {factsMutation.isPending && (prospectus || photos.length > 0) ? (
              <Text className="mt-2 text-[0.8125rem] text-muted">
                Prospekt og bilder tar litt tid å lese …
              </Text>
            ) : null}

            <Text className="mt-6 text-[0.8125rem] leading-5 text-muted">
              Eller fyll inn selv. Tomme felt får vanlige verdier ({catalogue.defaults.sizeM2} m²,{' '}
              {catalogue.defaults.rooms} rom, {catalogue.defaults.bathrooms} bad).
            </Text>
            <View className="mt-3 flex-row gap-3">
              <NumberField
                className="flex-1"
                label="Størrelse"
                suffix="m²"
                value={plan.sizeM2}
                onChange={(v) => update({ sizeM2: v })}
              />
              <NumberField
                className="flex-1"
                label="Stuer og soverom"
                value={plan.rooms}
                onChange={(v) => update({ rooms: v })}
              />
            </View>
            <View className="mt-3 flex-row gap-3">
              <NumberField
                className="flex-1"
                label="Bad"
                value={plan.bathrooms}
                onChange={(v) => update({ bathrooms: v })}
              />
              <NumberField
                className="flex-1"
                label="Byggeår"
                value={plan.yearBuilt}
                onChange={(v) => update({ yearBuilt: v })}
              />
            </View>
            <View className="mt-3 gap-1.5">
              <Text className="text-[0.8125rem] font-semibold text-ink">Boligtype</Text>
              <Select
                variant="field"
                value={plan.homeType}
                placeholder="Velg boligtype"
                options={[
                  { label: 'Velg boligtype', value: '' },
                  ...catalogue.homeTypes.map((type) => ({ label: type.label, value: type.key })),
                ]}
                onValueChange={(value) => update({ homeType: value })}
              />
            </View>
            <NotesList notes={plan.notes} />
          </Step>

          <Step n={2} title="Hva vil du pusse opp?">
            <View className="flex-row flex-wrap gap-2">
              {catalogue.areas.map((area) => (
                <Chip
                  key={area.key}
                  label={area.label}
                  selected={Boolean(plan.areas[area.key])}
                  onPress={() => toggleArea(area.key)}
                />
              ))}
              <Chip label="Alt" selected={everything} onPress={toggleEverything} />
            </View>
          </Step>

          {selected.length > 0 ? (
            <Step n={3} title="Overflate eller total?">
              {catalogue.areas
                .filter((area) => plan.areas[area.key])
                .map((area, i) => {
                  const choice = plan.areas[area.key]!;
                  return (
                    <View key={area.key} className={i ? 'mt-4 border-t border-line pt-4' : ''}>
                      <Text className="text-[0.9375rem] font-semibold text-ink">{area.label}</Text>
                      <View className="mt-2 flex-row flex-wrap items-center gap-2">
                        {catalogue.scopes.map((scope) => (
                          <Chip
                            key={scope.key}
                            label={scope.label}
                            selected={choice.scope === scope.key}
                            onPress={() => setChoice(area.key, { scope: scope.key })}
                          />
                        ))}
                        <Select
                          value={choice.quality ?? ''}
                          placeholder="Kvalitet som resten"
                          options={[
                            { label: 'Kvalitet som resten', value: '' },
                            ...catalogue.qualities.map((q) => ({ label: q.label, value: q.key })),
                          ]}
                          onValueChange={(value) =>
                            setChoice(area.key, {
                              quality: (value || undefined) as Quality | undefined,
                            })
                          }
                        />
                      </View>
                      <Text className="mt-2 text-[0.8125rem] leading-5 text-muted">
                        {choice.scope === 'full' ? area.full : area.surface}
                      </Text>
                    </View>
                  );
                })}
            </Step>
          ) : null}

          <Step n={3 + stepOffset} title="Kvalitet">
            <View className="flex-row flex-wrap gap-2">
              {catalogue.qualities.map((q) => (
                <Chip
                  key={q.key}
                  label={q.label}
                  selected={plan.quality === q.key}
                  onPress={() => update({ quality: q.key })}
                />
              ))}
            </View>
          </Step>

          <Step n={4 + stepOffset} title="Budsjett (valgfritt)">
            <NumberField
              label="Hvor mye vil du bruke?"
              suffix="kr"
              value={plan.budget}
              onChange={(v) => update({ budget: v })}
            />
          </Step>

          <Button
            fullWidth
            label={selected.length === 0 ? 'Velg minst ett område' : 'Beregn estimat'}
            icon={<Calculator size={18} color="#FFFFFF" />}
            loading={estimateMutation.isPending}
            disabled={selected.length === 0}
            onPress={() => calculate()}
          />
        </View>

        {estimate ? (
          <View
            className="mt-8"
            onLayout={(event) => {
              estimateY.current = event.nativeEvent.layout.y;
            }}
          >
            <EstimateView estimate={estimate} onApply={applySuggestion} />

            <Card className="mt-6 p-5">
              <Text className="text-[0.9375rem] font-semibold text-ink">Lagre og del</Text>
              <Field
                className="mt-3"
                label="Navn på planen"
                value={plan.title}
                maxLength={120}
                onChangeText={(text) => setPlan((current) => ({ ...current, title: text }))}
                placeholder="Min oppussingsplan"
              />
              <View className="mt-3 flex-row flex-wrap gap-2">
                <Button
                  variant="secondary"
                  small
                  label={plan.planId ? 'Lagre endringer' : 'Lagre plan'}
                  icon={<Save size={16} color={TC.ink} />}
                  loading={saveMutation.isPending}
                  onPress={savePlan}
                />
                {plan.planId && !plan.shareId ? (
                  <Button
                    variant="secondary"
                    small
                    label="Del plan"
                    icon={<Link2 size={16} color={TC.ink} />}
                    loading={shareMutation.isPending}
                    onPress={sharePlan}
                  />
                ) : null}
              </View>
              {plan.shareId ? (
                <View className="mt-4 rounded-2xl bg-surface-2 p-4">
                  <Text className="text-[0.8125rem] leading-5 text-muted">
                    Alle med lenken kan se planen (ikke hvem du er):
                  </Text>
                  <Text selectable className="mt-2 text-[0.875rem] text-ink" numberOfLines={2}>
                    {shareUrl(plan.shareId)}
                  </Text>
                  <View className="mt-3 flex-row flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      small
                      label="Del lenken"
                      icon={<Link2 size={16} color={TC.ink} />}
                      onPress={() => void openShareSheet(plan.shareId!)}
                    />
                    <Button
                      variant="ghost"
                      small
                      label="Slutt å dele"
                      loading={unshareMutation.isPending}
                      onPress={stopSharing}
                    />
                  </View>
                </View>
              ) : null}
              {plan.planId ? (
                <Text className="mt-3 text-[0.8125rem] leading-5 text-muted">
                  Endringer i planen må lagres før de vises i den delte lenken.
                </Text>
              ) : null}
            </Card>

            <View className="mt-6">
              <Button
                fullWidth
                label="Legg ut som oppdrag"
                loading={posting}
                onPress={() => void postAsJobs()}
              />
            </View>
            <Text className="mt-2 text-center text-[0.8125rem] leading-5 text-muted">
              Ett utkast per område. Du ser over hvert oppdrag før det publiseres.
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <DraftsSavedSheet
        result={draftsResult}
        onClose={() => setDraftsResult(null)}
        onOpenDrafts={() => {
          setDraftsResult(null);
          router.push('/create-job');
        }}
      />
    </KeyboardAvoidingView>
  );
}
