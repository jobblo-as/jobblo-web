import React, { useCallback, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CheckCircle2, ChevronLeft, X } from 'lucide-react-native';
import { TC } from '../../theme/colors';
import { useAuthStore } from '../../store/authStore';
import { NyAnnonseSheet } from '../../components/create-job/NyAnnonseSheet';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Button } from '../../components/ui/Button';
import { GlassButton } from '../../components/ui/GlassButton';
import { STEP_TITLES, previousStep, progress } from './flow';
import { usePostJobStore } from './store';
import { t } from './i18n';
import { CameraStep } from './steps/CameraStep';
import { PhotoGridStep } from './steps/PhotoGridStep';
import { CategoryStep } from './steps/CategoryStep';
import { DetailsStep } from './steps/DetailsStep';
import { TextStep } from './steps/TextStep';
import { PriceStep } from './steps/PriceStep';
import { PlaceStep } from './steps/PlaceStep';
import { ReviewStep } from './steps/ReviewStep';
import { AiConsentSheet } from './AiConsentSheet';
import { useAiConsent } from './aiConsent';

const SCREENS = {
  photoGrid: PhotoGridStep,
  category: CategoryStep,
  details: DetailsStep,
  text: TextStep,
  price: PriceStep,
  place: PlaceStep,
};

/**
 * "Legg ut oppdrag" as one question per screen (FINN Torget flow). Lives inside the create-job
 * tab, so no new routes: the step is state, back is the header arrow, Android's back button
 * and a swipe from the left edge.
 */
export function PostJobFlow() {
  const isFocused = useIsFocused();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { step, photos, values, summary, publishedId, editId, update, back, reset, goTo } =
    usePostJobStore();
  const customerType = values.customerType;
  const setCustomerType = (type: 'private' | 'business') => update({ customerType: type });
  const [confirmClose, setConfirmClose] = useState(false);
  /** Leaving the tab: every sheet and the camera hide first (see exit). */
  const [leaving, setLeaving] = useState(false);
  const consent = useAiConsent();
  // The AI question comes before the first photo; the camera waits for the answer.
  const atCamera = isFocused && !leaving && Boolean(customerType) && step === 'photos';
  const canGoBack = editId ? step !== 'review' : previousStep(step, photos.length) !== null;
  const suggested = user?.role === 'company' ? 'business' : 'private';

  // Android back: previous step; on the first step the system handles it (leaves the tab).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () =>
        usePostJobStore.getState().back()
      );
      return () => sub.remove();
    }, [])
  );

  const swipeBack = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(20)
    .failOffsetY([-20, 20])
    .onEnd((event) => {
      if (event.translationX > 60) back();
    });

  const hasAnswers = photos.length > 0 || values.categories.length > 0 || Boolean(summary.trim());
  /**
   * Leave "Legg ut" for the screen before it (Home when there is none), then start clean. Resetting
   * in place re-opened the "Ny annonse" sheet on the still-focused tab, whose close opened the
   * camera again: the flow could not be left. The modals hide first, because iOS drops a
   * navigation started while a Modal is up; the reset waits until the tab is out of sight.
   */
  const exit = () => {
    setLeaving(true);
    setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/(app)');
      setTimeout(() => {
        reset();
        setLeaving(false);
      }, 400);
    }, 350);
  };
  const close = () => (hasAnswers ? setConfirmClose(true) : exit());
  // Leaving an edit: drop ?editId first, or create-job would load the job again on the next visit.
  const leaveEdit = (go: () => void) => {
    const id = editId;
    router.setParams({ editId: '' });
    if (id) go();
    setTimeout(reset, 600);
  };
  const cancelEdit = () => leaveEdit(() => router.back());
  const saved = () =>
    leaveEdit(() => router.push({ pathname: '/(app)/jobs/[id]', params: { id: editId ?? '' } }));

  if (publishedId) {
    // Navigate first, clear the flow after: resetting first re-opened the "Ny annonse" sheet (a
    // Modal) on this still-focused tab, and on iOS a navigation started while a Modal is being
    // presented is dropped, so "Se oppdraget" did not open the job.
    const done = (go: () => void) => {
      go();
      setTimeout(reset, 600);
    };
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <View className="flex-1 justify-center px-5">
          <View className="items-center rounded-2xl bg-surface px-6 py-10">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-tint">
              <CheckCircle2 size={34} color={TC.brandText} />
            </View>
            <Text className="mt-5 text-center text-[1.5rem] font-bold text-ink">
              {t('Oppdraget er publisert', 'Your job is published')}
            </Text>
            <Text className="mt-2 text-center text-[1.0625rem] leading-6 text-ink-2">
              {t(
                'Oppdraget er nå synlig for andre. Du får varsel når noen søker.',
                'Your job is now visible to others. You will be notified when someone applies.'
              )}
            </Text>
            <View className="mt-7 w-full gap-3">
              <Button
                label={t('Se oppdraget', 'View the job')}
                fullWidth
                onPress={() =>
                  done(() =>
                    router.push({ pathname: '/(app)/jobs/[id]', params: { id: publishedId } })
                  )
                }
              />
              <Button
                label={t('Til forsiden', 'Go to home')}
                variant="secondary"
                fullWidth
                onPress={() => done(() => router.replace('/(app)'))}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  const Screen = step === 'photos' || step === 'review' ? null : SCREENS[step];

  return (
    // No bottom edge: the tab bar below already reserves the home-indicator inset.
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      <View className="border-b border-line bg-page">
        {/* Back and X as round glass buttons, the same as on the job page. */}
        <View className="h-14 flex-row items-center gap-2 px-3">
          <View className="w-10">
            {canGoBack ? (
              <GlassButton label={t('Tilbake', 'Back')} onPress={back}>
                <ChevronLeft size={22} color={TC.ink} />
              </GlassButton>
            ) : null}
          </View>
          <Text
            className="flex-1 text-center text-[1.0625rem] font-semibold text-ink"
            numberOfLines={1}
          >
            {editId && step === 'review' ? t('Rediger annonse', 'Edit listing') : STEP_TITLES[step]}
          </Text>
          <View className="w-10">
            <GlassButton
              label={
                editId
                  ? t('Avbryt redigering', 'Cancel editing')
                  : t('Avbryt annonsen', 'Cancel the listing')
              }
              onPress={close}
            >
              <X size={20} color={TC.ink} />
            </GlassButton>
          </View>
        </View>
        <View
          className="h-1 bg-surface-2"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress(step) * 100) }}
        >
          <View className="h-1 bg-brand" style={{ width: `${progress(step) * 100}%` }} />
        </View>
      </View>

      {/* iOS does not shrink the screen for the keyboard (Android does): without this it covered the
          description, price and address fields and the "Continue" button of every step. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 'photos' is the full-screen camera below. */}
        {Screen ? <Screen /> : null}
        {step === 'review' ? <ReviewStep onSaved={saved} /> : null}
      </KeyboardAvoidingView>

      {canGoBack ? (
        <GestureDetector gesture={swipeBack}>
          <View className="absolute bottom-20 left-0 top-16 w-5" />
        </GestureDetector>
      ) : null}

      {/* Opens straight after the job type is chosen, like FINN; covers the tab bar. */}
      {/* Camera closed with no photos: mid-way (or editing) it goes back to the summary, not a wipe. */}
      <AiConsentSheet visible={atCamera && consent.loaded && consent.value === null} />
      <CameraStep
        visible={atCamera && consent.value !== null}
        onCancel={editId || values.categories.length ? () => goTo('review') : exit}
      />

      <NyAnnonseSheet
        visible={isFocused && !leaving && !customerType}
        suggested={suggested}
        onSelect={setCustomerType}
        // Closing without a choice = not posting now: leave the tab (FINN does the same).
        onClose={exit}
      />

      <ConfirmDialog
        visible={confirmClose}
        title={
          editId
            ? t('Forkaste endringene?', 'Discard your changes?')
            : t('Avbryte annonsen?', 'Cancel the listing?')
        }
        message={
          editId
            ? t('Annonsen blir som den var.', 'The listing stays as it was.')
            : t('Bildene og svarene dine blir slettet.', 'Your photos and answers will be deleted.')
        }
        confirmLabel={editId ? t('Forkast', 'Discard') : t('Avbryt annonsen', 'Cancel listing')}
        cancelLabel={t('Fortsett å redigere', 'Keep editing')}
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          if (editId) cancelEdit();
          else exit();
        }}
        onClose={() => setConfirmClose(false)}
      />
    </SafeAreaView>
  );
}
