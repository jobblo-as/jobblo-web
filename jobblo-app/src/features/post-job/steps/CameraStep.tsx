import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Camera, ImageIcon, RotateCcw, Sparkles, X } from 'lucide-react-native';
import { getPhotoHint, type PhotoHint } from '../../../services/ai.service';
import { MAX_PHOTOS, cameraHint } from '../flow';
import { usePostJobStore } from '../store';
import { useAiConsent } from '../aiConsent';
import { usePhotoPicker } from '../usePhotoPicker';
import { LANG, t } from '../i18n';

// expo-camera zoom is 0..1 of each phone's own range: Android multiplies it by the max zoom ratio
// (and floors at 1x), iOS goes exponentially from 1x to the max. 0.25 ≈ 2x on a phone with an
// 8x (Android) or 16x (iPhone) maximum. ponytail: approximate per model; pinch gives exact control.
const ZOOM_2X = 0.25;
const PINCH_SPEED = 0.35;
const CAPTURE_TIMEOUT_MS = 8000;
const CORNER = 'absolute h-8 w-8 border-white/80';
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** A small JPEG for the AI helper: ~768 px wide is plenty at "low" detail and uploads in a moment. */
async function smallCopy(uri: string) {
  const image = await ImageManipulator.manipulate(uri).resize({ width: 768 }).renderAsync();
  const saved = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
  return { uri: saved.uri, name: 'hint.jpg', type: 'image/jpeg' };
}

interface CameraStepProps {
  visible: boolean;
  /** X / Android back with no photos taken: leave the flow. */
  onCancel: () => void;
}

/**
 * FINN step 2: the camera opens straight away, full screen. After each photo the AI helper looks
 * at it and says what to photograph next (or asks for a retake when it is blurry or dark).
 * Pinch or the 1x/2x chip to zoom; one tap on the shutter takes the photo. Photos stay optional.
 */
export function CameraStep({ visible, onCancel }: CameraStepProps) {
  // Read here, under the app's SafeAreaProvider: inside an iOS Modal (its own native window) a
  // SafeAreaView got no insets, so the top bar sat under the notch and the photos under the home bar.
  const insets = useSafeAreaInsets();
  // Without consent no photo leaves the phone for the AI: the plain tips are shown instead.
  const aiOn = useAiConsent((s) => s.value === true);
  const photos = usePostJobStore((s) => s.photos);
  const addPhotos = usePostJobStore((s) => s.addPhotos);
  const removePhoto = usePostJobStore((s) => s.removePhoto);
  const setPhotoNote = usePostJobStore((s) => s.setPhotoNote);
  const setPhotoQuality = usePostJobStore((s) => s.setPhotoQuality);
  const photoNotes = usePostJobStore((s) => s.photoNotes);
  const next = usePostJobStore((s) => s.next);
  const { fromLibrary } = usePhotoPicker();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const full = photos.length >= MAX_PHOTOS;

  // AI helper: the answer for the latest photo. A newer photo makes an older answer stale.
  const [aiHint, setAiHint] = useState<(PhotoHint & { uri: string }) | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const latestRequest = useRef(0);
  // Advice given in this camera session, sent back so the AI does not repeat it.
  const hintsGiven = useRef<string[]>([]);

  // Zoom: pinch, or the 1x/2x chip. Focus is the camera's own continuous autofocus.
  const [zoom, setZoom] = useState(0);
  const pinchBase = useRef(0);

  // Start fresh each time the camera opens.
  useEffect(() => {
    if (visible) {
      setZoom(0);
      setAiHint(null);
      hintsGiven.current = [];
    }
  }, [visible]);

  const askAi = async (uri: string, count: number) => {
    const id = ++latestRequest.current;
    setHintLoading(true);
    const earlier = {
      seen: photos.map((p) => photoNotes[p.uri]).filter(Boolean),
      hints: hintsGiven.current.slice(-3),
    };
    try {
      const hint = await getPhotoHint(await smallCopy(uri), count, LANG, earlier);
      hintsGiven.current.push(hint.hint);
      // Remembered per photo: a photo the helper asked to retake is left out of the title/description.
      setPhotoQuality(uri, hint.quality);
      // Kept even if a newer photo came in: the title/description use what every photo shows.
      if (hint.seen && hint.quality !== 'blurry' && hint.quality !== 'dark')
        setPhotoNote(uri, hint.seen);
      if (id === latestRequest.current) setAiHint({ ...hint, uri });
    } catch (error) {
      // The scripted hint stays; the photo is kept either way.
      console.warn('[camera] AI helper unavailable:', error);
      if (id === latestRequest.current) setAiHint(null);
    } finally {
      if (id === latestRequest.current) setHintLoading(false);
    }
  };

  const close = () => (photos.length ? next() : onCancel());

  const add = (uri: string) => {
    addPhotos([{ uri, name: `jobb-${Date.now()}.jpg`, type: 'image/jpeg' }]);
    if (aiOn) void askAi(uri, Math.min(MAX_PHOTOS, photos.length + 1));
  };

  // Not gated on onCameraReady: inside a Modal (and in Expo Go on some phones) it never fires,
  // which left the shutter dead. A capture that fails or hangs opens the system camera instead,
  // so the user always gets the photo.
  const shoot = async () => {
    if (busy || full) return;
    setBusy(true);
    // Feedback on the tap itself, not when the file is saved a moment later.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      if (!camera.current) throw new Error('camera not mounted');
      const picture = await Promise.race([
        // Not skipProcessing: faster, but some Samsung/Sony phones then return rotated photos
        // and the full-size file (quality is ignored) can pass the 5 MB upload limit.
        camera.current.takePictureAsync({ quality: 0.85 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('takePictureAsync timed out')), CAPTURE_TIMEOUT_MS)
        ),
      ]);
      if (!picture?.uri) throw new Error('no uri');
      add(picture.uri);
    } catch (error) {
      console.warn('[camera] capture failed, opening the system camera:', error);
      try {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });
        if (!result.canceled && result.assets[0]) add(result.assets[0].uri);
      } catch {
        Alert.alert(
          t('Kunne ikke ta bildet', 'Could not take the photo'),
          t(
            'Prøv igjen, eller velg et bilde fra biblioteket.',
            'Try again, or choose a photo from the library.'
          )
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /** X on a thumbnail: drop that photo; its AI answer goes with it. */
  const removeAt = (index: number) => {
    const uri = photos[index]?.uri;
    removePhoto(index);
    if (uri && aiHint?.uri === uri) {
      latestRequest.current++;
      setAiHint(null);
      setHintLoading(false);
    }
  };

  /** The AI asked for it: drop that photo and take it again. */
  const retake = () => {
    const index = photos.findIndex((p) => p.uri === aiHint?.uri);
    if (index >= 0) removePhoto(index);
    latestRequest.current++;
    setAiHint(null);
    setHintLoading(false);
  };

  const upload = async () => {
    if (await fromLibrary()) next();
  };

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchBase.current = zoom;
    })
    .onUpdate((e) => setZoom(clamp(pinchBase.current + (e.scale - 1) * PINCH_SPEED)));

  const retakeAsked = Boolean(aiHint && (aiHint.quality === 'blurry' || aiHint.quality === 'dark'));
  const hintText = aiHint?.hint ?? cameraHint(photos.length);
  const zoomed = zoom >= 0.05;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={close}
    >
      {/* A Modal is its own native root: gesture-handler needs a root view inside it. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          className="flex-1 bg-black"
          style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }}
        >
          {/* White clock and battery on the black camera. */}
          <StatusBar style="light" />
          {/* Top: close, AI helper, skip / done */}
          <View className="flex-row items-center justify-between px-4 pt-2">
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                photos.length ? t('Lukk kameraet', 'Close the camera') : t('Avbryt', 'Cancel')
              }
              className="h-10 w-10 items-center justify-center rounded-full bg-white/15"
            >
              <X size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={next}
              hitSlop={8}
              accessibilityRole="button"
              className="h-10 justify-center rounded-full bg-white/15 px-4"
            >
              <Text className="text-[0.875rem] font-semibold text-white">
                {photos.length
                  ? `${t('Ferdig', 'Done')} (${photos.length})`
                  : t('Hopp over', 'Skip')}
              </Text>
            </Pressable>
          </View>
          <View className="min-h-[92px] px-4 pb-3 pt-3" accessibilityLiveRegion="polite">
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={16} color="#5EEAD4" />
              <Text className="text-[0.875rem] font-semibold text-[#5EEAD4]">
                {aiOn ? t('AI-hjelper', 'AI helper') : t('Tips', 'Tips')}
              </Text>
              {hintLoading ? (
                <ActivityIndicator size="small" color="#5EEAD4" style={{ marginLeft: 4 }} />
              ) : null}
            </View>
            <Text
              className={`mt-1 text-[1.0625rem] leading-6 ${retakeAsked ? 'text-[#FCD34D]' : 'text-white'}`}
            >
              {hintLoading ? t('Ser på bildet ditt…', 'Looking at your photo…') : hintText}
            </Text>
            {retakeAsked && !hintLoading ? (
              <Pressable
                onPress={retake}
                accessibilityRole="button"
                className="mt-2 h-9 flex-row items-center gap-1.5 self-start rounded-full bg-[#FCD34D] px-3"
              >
                <RotateCcw size={14} color="#000000" />
                <Text className="text-[0.8125rem] font-semibold text-black">
                  {t('Ta bildet på nytt', 'Retake photo')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Preview: pinch to zoom */}
          <View className="flex-1 overflow-hidden bg-neutral-900">
            {permission?.granted ? (
              <GestureDetector gesture={pinch}>
                <View style={{ flex: 1 }}>
                  <CameraView
                    ref={camera}
                    style={{ flex: 1 }}
                    facing="back"
                    zoom={zoom}
                    animateShutter
                  />
                  <View pointerEvents="none" className="absolute inset-6">
                    <View
                      className={`${CORNER} left-0 top-0 rounded-tl-lg border-l-2 border-t-2`}
                    />
                    <View
                      className={`${CORNER} right-0 top-0 rounded-tr-lg border-r-2 border-t-2`}
                    />
                    <View
                      className={`${CORNER} bottom-0 left-0 rounded-bl-lg border-b-2 border-l-2`}
                    />
                    <View
                      className={`${CORNER} bottom-0 right-0 rounded-br-lg border-b-2 border-r-2`}
                    />
                  </View>
                </View>
              </GestureDetector>
            ) : (
              <View className="flex-1 items-center justify-center px-8">
                <Camera size={36} color="#FFFFFF" />
                <Text className="mt-3 text-center text-[1.0625rem] font-semibold text-white">
                  {t('Jobblo trenger kameraet', 'Jobblo needs the camera')}
                </Text>
                <Text className="mt-1 text-center text-[0.9375rem] leading-6 text-white/70">
                  {t(
                    'Ta bilder av det som skal gjøres, så fyller AI ut resten av annonsen.',
                    'Take photos of what needs doing, and AI fills in the rest of the listing.'
                  )}
                </Text>
                {permission && !permission.canAskAgain ? (
                  <Pressable
                    onPress={() => void Linking.openSettings()}
                    accessibilityRole="button"
                    className="mt-5 h-11 justify-center rounded-full bg-white px-5"
                  >
                    <Text className="text-[0.9375rem] font-semibold text-black">
                      {t('Åpne innstillinger', 'Open settings')}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => void requestPermission()}
                    accessibilityRole="button"
                    className="mt-5 h-11 justify-center rounded-full bg-white px-5"
                  >
                    <Text className="text-[0.9375rem] font-semibold text-black">
                      {t('Gi tilgang til kameraet', 'Allow camera access')}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Controls: zoom, shutter, library */}
          <View className="flex-row items-center justify-between px-6 py-4">
            <Pressable
              onPress={() => setZoom(zoomed ? 0 : ZOOM_2X)}
              disabled={!permission?.granted}
              accessibilityRole="button"
              accessibilityLabel={
                zoomed
                  ? t('Zoom 2x, trykk for 1x', 'Zoom 2x, tap for 1x')
                  : t('Zoom 1x, trykk for 2x', 'Zoom 1x, tap for 2x')
              }
              // A fixed circle with one background, like the camera app's lens button.
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{ color: zoomed ? '#FCD34D' : '#FFFFFF', fontSize: 13, fontWeight: '700' }}
              >
                {zoomed ? '2x' : '1x'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void shoot()}
              disabled={busy || full || !permission?.granted}
              accessibilityRole="button"
              accessibilityLabel={t('Ta bilde', 'Take photo')}
              className={`h-[74px] w-[74px] items-center justify-center rounded-full border-4 border-white ${full ? 'opacity-40' : ''}`}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View className="h-[58px] w-[58px] rounded-full bg-white active:bg-white/70" />
              )}
            </Pressable>
            <Pressable
              onPress={() => void upload()}
              disabled={full}
              accessibilityRole="button"
              accessibilityLabel={t('Last opp fra biblioteket', 'Upload from the library')}
              className="h-11 items-center justify-center rounded-full bg-white/15 px-3"
            >
              <Text className="text-[0.8125rem] font-semibold text-white">
                {t('Last opp', 'Upload')}
              </Text>
            </Pressable>
          </View>

          {/* The photos so far, six slots */}
          <View className="flex-row justify-center gap-2 px-4 pb-2">
            {Array.from({ length: MAX_PHOTOS }, (_, i) => (
              <View key={i} className="h-12 w-12">
                <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-white/20 bg-white/10">
                  {photos[i] ? (
                    <Image
                      source={{ uri: photos[i].uri }}
                      style={{ width: 48, height: 48 }}
                      resizeMode="cover"
                      accessibilityLabel={`${t('Bilde', 'Photo')} ${i + 1}`}
                    />
                  ) : (
                    <ImageIcon size={16} color="rgba(255,255,255,0.4)" />
                  )}
                </View>
                {photos[i] ? (
                  <Pressable
                    onPress={() => removeAt(i)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('Fjern bilde', 'Remove photo')} ${i + 1}`}
                    style={{
                      position: 'absolute',
                      top: -7,
                      right: -7,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: '#FFFFFF',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={13} color="#000000" />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
