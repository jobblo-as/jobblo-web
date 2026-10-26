import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { useVerifyEmailMutation } from '@/hooks/useRegisterMutation';
import { resendVerification } from '@/services/auth.service';
import { TC, tc } from '../../theme/colors';

/**
 * "Bekreft e-post": the 6-digit code mailed at sign-up (or after a login refused with
 * EMAIL_NOT_VERIFIED). A right code signs the user in; `onVerified` then navigates.
 * `password` is the one just typed: the account is confirmed with it, so nobody else's survives.
 */
export default function VerifyEmailStep({
  email,
  password,
  onVerified,
  onBack,
}: {
  email: string;
  password: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const verifyMutation = useVerifyEmailMutation();
  const resendMutation = useMutation({ mutationFn: () => resendVerification(email) });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const submit = (value: string) => {
    if (!/^\d{6}$/.test(value) || verifyMutation.isPending) {
      if (!/^\d{6}$/.test(value)) setError('Skriv inn alle 6 siffer');
      return;
    }
    setError('');
    verifyMutation.mutate(
      { email, code: value, password },
      {
        onSuccess: onVerified,
        onError: (err: unknown) => {
          const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
          setError(data ? data.error || 'Ugyldig eller utløpt kode.' : 'Ingen nettforbindelse. Prøv igjen.');
        },
      }
    );
  };

  return (
    <>
      <Pressable onPress={onBack} accessibilityRole="button" className="mb-6 flex-row items-center gap-2">
        <ArrowLeft size={16} color={tc('#63665F', 'muted')} />
        <Text className="text-[13px] font-medium text-muted">Tilbake</Text>
      </Pressable>

      <View className="mb-5 h-12 w-12 items-center justify-center rounded-full bg-[#F0F1EB] dark:bg-surface-2">
        <ShieldCheck size={22} color={TC.ink} />
      </View>
      <Text accessibilityRole="header" className="text-[30px] font-bold leading-tight tracking-[-0.05em] text-ink">
        Bekreft e-post
      </Text>
      <Text className="mt-2 text-[15px] leading-6 text-muted">
        Vi har sendt en 6-sifret kode til <Text className="font-semibold text-ink">{email}</Text>. Skriv den inn
        for å fullføre.
      </Text>

      <View className="mt-6 gap-4">
        <TextInput
          value={code}
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            setError('');
            if (digits.length === 6) submit(digits);
          }}
          accessibilityLabel="Bekreftelseskode"
          accessibilityHint="Seks siffer fra e-posten"
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          placeholderTextColor={TC.placeholder}
          editable={!verifyMutation.isPending}
          className={`h-[52px] rounded-xl border bg-[#F5F6F1] dark:bg-surface-2 text-center text-[22px] font-semibold tracking-[0.4em] text-ink ${
            error ? 'border-danger-line bg-[#FCF5F4] dark:bg-danger-tint' : 'border-transparent'
          }`}
        />

        {error ? (
          <Text accessibilityLiveRegion="polite" className="text-[12px] text-[#B0453B] dark:text-danger">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={() => submit(code)}
          disabled={verifyMutation.isPending || code.length !== 6}
          accessibilityRole="button"
          className={`h-[46px] items-center justify-center rounded-xl bg-brand ${
            verifyMutation.isPending || code.length !== 6 ? 'opacity-80' : ''
          }`}
        >
          {verifyMutation.isPending ? (
            <Loader2 size={16} color="#FFFFFF" />
          ) : (
            <Text className="text-[15px] font-semibold text-white">Bekreft</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => resendMutation.mutate()}
          disabled={resendMutation.isPending}
          accessibilityRole="button"
          className="items-center"
        >
          <Text className="text-[14px] font-medium text-brand">
            {resendMutation.isPending ? 'Sender ny kode…' : resendMutation.isSuccess ? 'Ny kode sendt' : 'Send ny kode'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}
