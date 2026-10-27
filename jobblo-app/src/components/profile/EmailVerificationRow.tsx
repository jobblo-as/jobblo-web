import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Mail, MailCheck } from 'lucide-react-native';
import { confirmEmailCode, sendEmailCode } from '@/services/auth.service';
import { TC, tc } from '@/theme/colors';
import { BottomSheet } from '@/components/ui/BottomSheet';

function errorText(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response
    ?.data;
  const text =
    typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : '';
  return text.trim() || fallback;
}

/**
 * The profile's "E-post" row: confirmed, or "ikke bekreftet" with a button that opens a popup
 * (sends a code, 6-digit field, "Bekreft"). Nothing waits for it: a confirmed address is what
 * gets the account back if access is lost. Deliberately NOT BankID: no "Verifisert", no badge.
 */
export function EmailVerificationRow({
  email,
  emailVerified,
  onVerified,
}: {
  email?: string;
  emailVerified?: boolean;
  /** Refetch the profile so the row flips. */
  onVerified: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (emailVerified !== false) {
    return (
      <View className="mt-4 flex-row items-center gap-3 rounded-3xl bg-surface p-4">
        <MailCheck size={20} color={TC.brandText} />
        <View className="flex-1">
          <Text className="text-[1.0625rem] font-semibold text-ink">E-post</Text>
          <Text className="mt-0.5 text-[0.875rem] text-muted">E-post bekreftet</Text>
        </View>
      </View>
    );
  }

  const send = async () => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const data = await sendEmailCode();
      setSent(data.message || `Vi har sendt en kode til ${email ?? 'e-posten din'}.`);
    } catch (err) {
      setError(errorText(err, 'Kunne ikke sende koden. Prøv igjen.'));
    } finally {
      setSending(false);
    }
  };

  const confirm = async () => {
    if (code.length !== 6 || confirming) return;
    setConfirming(true);
    setError('');
    try {
      await confirmEmailCode(code);
      setOpen(false);
      await onVerified();
    } catch (err) {
      setError(errorText(err, 'Ugyldig eller utløpt kode.'));
    } finally {
      setConfirming(false);
    }
  };

  const openSheet = () => {
    setOpen(true);
    setCode('');
    setError('');
    // Opening the popup is the request for a code: one tap fewer.
    if (!sent) void send();
  };

  return (
    <View className="mt-4 rounded-3xl border border-[#E8C9A0] bg-[#FDF6EC] p-5 dark:border-line dark:bg-surface">
      <View className="flex-row items-center gap-2">
        <Mail size={18} color={tc('#9A5B13', 'warn')} />
        <Text className="text-[1.0625rem] font-semibold text-ink">E-post</Text>
      </View>
      <Text className="mt-1.5 text-[0.9375rem] leading-6 text-muted">
        E-posten din er ikke bekreftet. Bekreft den, så kan du få tilbake kontoen hvis du mister
        tilgangen.
      </Text>
      <Pressable
        onPress={openSheet}
        accessibilityRole="button"
        className="mt-3 h-12 items-center justify-center rounded-full bg-brand active:opacity-90"
      >
        <Text className="text-[1.0625rem] font-semibold text-white">Bekreft e-post</Text>
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Bekreft e-post"
        dismissable={!confirming}
      >
        <Text accessibilityLiveRegion="polite" className="text-[0.9375rem] leading-6 text-muted">
          {sending && !sent
            ? 'Sender kode …'
            : sent || `Vi sender en kode til ${email ?? 'e-posten din'}.`}
        </Text>
        <TextInput
          value={code}
          onChangeText={(value) => {
            setCode(value.replace(/\D/g, '').slice(0, 6));
            setError('');
          }}
          onSubmitEditing={() => void confirm()}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          editable={!confirming}
          placeholder="6-sifret kode"
          placeholderTextColor={TC.placeholder}
          accessibilityLabel="Bekreftelseskode for e-post"
          className="mt-4 h-12 rounded-xl border border-line bg-surface px-4 text-center text-[1.125rem] tracking-[0.3em] text-ink"
        />
        {error ? (
          <Text
            accessibilityRole="alert"
            className="mt-3 text-[0.875rem] text-[#B0453B] dark:text-danger"
          >
            {error}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void confirm()}
          disabled={code.length !== 6 || confirming}
          accessibilityRole="button"
          accessibilityState={{ disabled: code.length !== 6 || confirming, busy: confirming }}
          className={`mt-4 h-12 items-center justify-center rounded-full bg-brand ${code.length !== 6 || confirming ? 'opacity-60' : 'active:opacity-90'}`}
        >
          <Text className="text-[1.0625rem] font-semibold text-white">
            {confirming ? 'Bekrefter…' : 'Bekreft'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void send()}
          disabled={sending}
          accessibilityRole="button"
          accessibilityState={{ disabled: sending, busy: sending }}
          className={`mt-3 h-12 items-center justify-center rounded-full border border-line bg-surface ${sending ? 'opacity-60' : 'active:opacity-90'}`}
        >
          <Text className="text-[1.0625rem] font-semibold text-ink">
            {sending ? 'Sender…' : 'Send ny kode'}
          </Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}
