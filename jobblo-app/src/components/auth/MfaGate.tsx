import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { TC, tc } from '../../theme/colors';

type MfaStatus = { required: boolean; enabled: boolean; verified: boolean };

/**
 * Superadmin and developer accounts must enter their authenticator code on each new session
 * (backend/middleware/auth.js answers every other call with 403 MFA_REQUIRED until then). The
 * app had no such screen, so those accounts got 403 everywhere. Same rules as the web's MfaGate:
 * code or backup code here; first-time set-up (QR code) happens on the website.
 */
export default function MfaGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const status = useQuery({
    queryKey: ['mfa-status'],
    queryFn: async () => (await apiClient.get<MfaStatus>('/auth/mfa')).data,
    staleTime: Infinity,
    retry: 1,
  });
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');

  const verify = useMutation({
    mutationFn: async (value: string) =>
      (await apiClient.post('/auth/mfa/verify', useBackup ? { backupCode: value } : { code: value })).data,
    onSuccess: async () => {
      queryClient.setQueryData<MfaStatus>(['mfa-status'], { required: true, enabled: true, verified: true });
      // Everything that came back 403 before the code: fetch it again.
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'mfa-status' });
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
      setCode('');
      setError(data?.message || 'Ingen nettforbindelse. Prøv igjen.');
    },
  });

  const s = status.data;
  if (s && (!s.required || s.verified)) return <>{children}</>;

  const submit = (value: string) => {
    if (verify.isPending) return;
    if (!useBackup && !/^\d{6}$/.test(value)) return setError('Skriv inn alle 6 siffer');
    if (useBackup && value.trim().length < 6) return setError('Skriv inn backupkoden');
    setError('');
    verify.mutate(value.trim());
  };

  return (
    <SafeAreaView className="flex-1 bg-page">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
          <View className="mb-5 h-12 w-12 items-center justify-center rounded-full bg-[#F0F1EB] dark:bg-surface-2">
            <ShieldCheck size={22} color={TC.ink} />
          </View>

          {status.isPending ? (
            <ActivityIndicator accessibilityLabel="Laster" color={TC.ink} />
          ) : status.isError ? (
            <>
              <Text accessibilityRole="header" className="text-[26px] font-bold text-ink">Kunne ikke laste</Text>
              <Text className="mt-2 text-[15px] leading-6 text-muted">Sjekk nettforbindelsen og prøv igjen.</Text>
              <Pressable onPress={() => status.refetch()} accessibilityRole="button" className="mt-6 items-center rounded-xl bg-brand py-3.5">
                <Text className="text-sm font-bold text-white">Prøv igjen</Text>
              </Pressable>
            </>
          ) : !s?.enabled ? (
            <>
              <Text accessibilityRole="header" className="text-[26px] font-bold text-ink">Totrinnsbekreftelse kreves</Text>
              <Text className="mt-2 text-[15px] leading-6 text-muted">
                Denne kontoen må sette opp en autentiseringsapp før den kan brukes. Logg inn på jobblo.no på en
                datamaskin for å sette den opp, og kom tilbake hit etterpå.
              </Text>
              <Pressable onPress={() => status.refetch()} accessibilityRole="button" className="mt-6 items-center rounded-xl bg-brand py-3.5">
                <Text className="text-sm font-bold text-white">Jeg har satt den opp</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" className="text-[26px] font-bold text-ink">Totrinnsbekreftelse</Text>
              <Text className="mt-2 text-[15px] leading-6 text-muted">
                {useBackup ? 'Skriv inn en av backupkodene dine.' : 'Skriv inn den 6-sifrede koden fra autentiseringsappen din.'}
              </Text>
              <TextInput
                value={code}
                onChangeText={(value) => {
                  const next = useBackup ? value : value.replace(/\D/g, '').slice(0, 6);
                  setCode(next);
                  setError('');
                  if (!useBackup && next.length === 6) submit(next);
                }}
                accessibilityLabel={useBackup ? 'Backupkode' : 'Kode fra autentiseringsappen'}
                keyboardType={useBackup ? 'default' : 'number-pad'}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={useBackup ? 32 : 6}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                editable={!verify.isPending}
                className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3.5 text-center text-[20px] font-semibold tracking-[0.3em] text-ink"
              />
              {error ? (
                <Text accessibilityRole="alert" className="mt-3 text-[13px] text-[#B4544A] dark:text-danger">
                  {error}
                </Text>
              ) : null}
              <Pressable
                onPress={() => submit(code)}
                disabled={verify.isPending}
                accessibilityRole="button"
                className="mt-5 items-center rounded-xl bg-brand py-3.5"
              >
                <Text className="text-sm font-bold text-white">{verify.isPending ? 'Bekrefter…' : 'Bekreft'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setUseBackup((v) => !v);
                  setCode('');
                  setError('');
                }}
                accessibilityRole="button"
                className="mt-4 items-center"
              >
                <Text className="text-[13px] font-medium text-muted">
                  {useBackup ? 'Bruk kode fra appen i stedet' : 'Bruk en backupkode'}
                </Text>
              </Pressable>
            </>
          )}

          <Pressable onPress={() => logout()} accessibilityRole="button" className="mt-8 items-center">
            <Text className="text-[13px] font-medium" style={{ color: tc('#63665F', 'muted') }}>Logg ut</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
