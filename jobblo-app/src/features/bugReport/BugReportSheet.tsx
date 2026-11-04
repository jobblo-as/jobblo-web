import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Bug, ImagePlus, Link2, X } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { TC } from '../../theme/colors';
import { sendBugReport, type BugScreenshot } from '../../services/bugReport.service';
import { useBugReport } from './store';

const MAX_SHOTS = 3;
const MIN_MESSAGE = 10;

/**
 * "Rapporter en feil" (as on the web): what happened, up to 3 screenshots from the gallery,
 * and — added by itself — the screen it is about, the device and the app version. Lands in the
 * developer dashboard (Tickets, "Bug reports").
 */
export function BugReportSheet({
  visible,
  onClose,
  pageUrl,
}: {
  visible: boolean;
  onClose: () => void;
  pageUrl: string | null;
}) {
  const [message, setMessage] = useState('');
  const [shots, setShots] = useState<BugScreenshot[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const close = () => {
    if (sending) return;
    setError('');
    setSent(false);
    onClose();
  };

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_SHOTS - shots.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    setShots((prev) =>
      [
        ...prev,
        ...result.assets.map((a, i) => ({
          uri: a.uri,
          name: a.fileName ?? `skjermbilde-${Date.now()}-${i}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        })),
      ].slice(0, MAX_SHOTS)
    );
  };

  const submit = async () => {
    if (message.trim().length < MIN_MESSAGE) {
      setError(`Beskriv feilen med minst ${MIN_MESSAGE} tegn.`);
      return;
    }
    setSending(true);
    setError('');
    try {
      await sendBugReport({ message: message.trim(), pageUrl, screenshots: shots });
      setMessage('');
      setShots([]);
      setSent(true);
    } catch (e) {
      const status = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(status || 'Kunne ikke sende rapporten. Prøv igjen.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      {/* Padding on both platforms: Android runs edge-to-edge, so the window does not resize. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end bg-[#0B0B0B]/60">
        <Pressable className="flex-1" onPress={close} accessibilityLabel="Lukk" />
        <View className="max-h-[90%] rounded-t-3xl bg-surface pb-8">
          <View className="flex-row items-start gap-3 border-b border-line px-5 py-4">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-tint">
              <Bug size={19} color={TC.brandText} />
            </View>
            <View className="min-w-0 flex-1">
              <Text accessibilityRole="header" className="text-[1.125rem] font-bold text-ink">
                Rapporter en feil
              </Text>
              <Text className="mt-0.5 text-[0.875rem] leading-5 text-muted">
                Fortell hva som skjedde. Skjermen du kom fra legges ved automatisk.
              </Text>
            </View>
            <Pressable
              onPress={close}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Lukk"
            >
              <X size={20} color={TC.muted} />
            </Pressable>
          </View>

          {sent ? (
            <View className="items-center px-5 pt-8">
              <Text className="text-center text-[1.125rem] font-bold text-ink">Takk!</Text>
              <Text className="mt-2 text-center text-[0.9375rem] leading-6 text-muted">
                Feilen er sendt til utviklerne. Vi ser på den så snart vi kan.
              </Text>
              <View className="mt-6 w-full">
                <Button label="Ok" onPress={close} />
              </View>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, gap: 18 }}
            >
              <View className="flex-row items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5">
                <Link2 size={14} color={TC.brandText} />
                <Text className="flex-1 text-[0.8125rem] text-muted" numberOfLines={1}>
                  Skjerm: <Text className="font-semibold text-ink">{pageUrl || 'ukjent'}</Text>
                </Text>
              </View>

              <View>
                <Text className="text-[0.875rem] font-semibold text-ink">Hva skjedde?</Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={5000}
                  textAlignVertical="top"
                  placeholder="F.eks. «Jeg trykket på Send søknad, men ingenting skjedde.»"
                  placeholderTextColor={TC.placeholder}
                  className="mt-1.5 min-h-28 rounded-xl border border-line bg-page px-3.5 py-3 text-[0.9375rem] text-ink"
                />
              </View>

              <View>
                <Text className="text-[0.875rem] font-semibold text-ink">
                  Skjermbilder <Text className="font-normal text-muted">(valgfritt, inntil 3)</Text>
                </Text>
                <View className="mt-2 flex-row flex-wrap gap-2.5">
                  {shots.map((s, i) => (
                    <View key={s.uri}>
                      <Image source={{ uri: s.uri }} className="h-20 w-20 rounded-xl" />
                      <Pressable
                        onPress={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                        accessibilityRole="button"
                        accessibilityLabel={`Fjern skjermbilde ${i + 1}`}
                        hitSlop={6}
                        className="absolute -right-2 -top-2 h-6 w-6 items-center justify-center rounded-full bg-ink"
                      >
                        <X size={13} color={TC.page} />
                      </Pressable>
                    </View>
                  ))}
                  {shots.length < MAX_SHOTS ? (
                    <Pressable
                      onPress={() => void pick()}
                      accessibilityRole="button"
                      accessibilityLabel="Legg til skjermbilde"
                      className="h-20 w-20 items-center justify-center gap-1 rounded-xl border border-dashed border-line"
                    >
                      <ImagePlus size={18} color={TC.muted} />
                      <Text className="text-[0.75rem] text-muted">Legg til</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {error ? (
                <Text accessibilityRole="alert" className="text-[0.875rem] font-medium text-danger">
                  {error}
                </Text>
              ) : null}

              <Button
                label={sending ? 'Sender…' : 'Send rapport'}
                onPress={() => void submit()}
                disabled={sending}
              />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Mounted once in the signed-in layout: the sheet for Innstillinger → "Rapporter en feil". */
export function BugReportHost() {
  const { open, lastScreen, closeBugReport } = useBugReport();
  return <BugReportSheet visible={open} onClose={closeBugReport} pageUrl={lastScreen} />;
}
