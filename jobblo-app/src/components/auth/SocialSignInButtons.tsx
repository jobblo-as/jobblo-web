import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useColorScheme } from 'nativewind';
import { apiBaseUrl } from '@/api/client';
import { AppleMark, GoogleMark, VippsWordmark } from '@/components/auth/SocialAuthLogos';
import { APPLE_SIGNIN_MODE } from '@/config/features';
import { completeOAuthSignIn } from '@/hooks/useOAuthLoginCompletion';
import { signInWithApple } from '@/utils/appleSignIn';
import { runOAuthSession, type OAuthProvider } from '@/utils/oauthAuthSession';

const LABEL: Record<OAuthProvider, string> = {
  vipps: 'Fortsett med Vipps',
  google: 'Fortsett med Google',
  apple: 'Fortsett med Apple',
};

/**
 * Vipps first, in Vipps' own orange, then Google — the same order, artwork and colours as the
 * website's components/SocialAuthButtons/AuthButton.tsx. Apple (Android web flow) is black.
 *
 * The Vipps wordmark IS the brand name, so it replaces the word instead of sitting beside it:
 * the button reads "Fortsett med [Vipps]". Because that leaves the label without the provider
 * name in text, the accessible name is spelled out on the Pressable.
 */
function SocialButton({ provider, disabled, onPress }: { provider: OAuthProvider; disabled: boolean; onPress: () => void }) {
  const look =
    provider === 'vipps' ? 'bg-[#FF5B24]' : provider === 'apple' ? 'bg-black' : 'border border-line bg-surface';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={LABEL[provider]}
      className={`h-[46px] flex-row items-center justify-center gap-2.5 rounded-xl px-4 ${look} ${disabled ? 'opacity-60' : ''}`}
    >
      {provider === 'vipps' ? (
        <>
          <Text className="text-[15px] font-semibold text-white">Fortsett med</Text>
          <VippsWordmark />
        </>
      ) : provider === 'apple' ? (
        <>
          <AppleMark />
          <Text className="text-[15px] font-semibold text-white">{LABEL.apple}</Text>
        </>
      ) : (
        <>
          <GoogleMark />
          <Text className="text-[15px] font-semibold text-ink">{LABEL.google}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The social sign-in buttons for the login and register screens, one in-flight guard for all.
 *
 * Browser providers (Vipps, Google, Apple on Android): `runOAuthSession` reports only what it
 * saw of the browser trip; a returned URL is a claim, not a session. The URL goes to
 * `completeOAuthSignIn`, which redeems its one-time code and verifies the token against
 * `/auth/profile` before anybody is signed in. On iOS this is the ONLY observer of the return
 * (ASWebAuthenticationSession delivers it to the session); on Android the deep link also mounts
 * app/(auth)/oauth-success.tsx, and both join the same single-flight completion.
 *
 * Apple on iOS is the native sheet (utils/appleSignIn.ts): no browser trip.
 * Nothing here navigates. app/(auth)/_layout.tsx redirects to /(app) once the session exists.
 */
export default function SocialSignInButtons({
  appleOnly = false,
  onStart,
  onError,
}: {
  /** Register: only Apple (App Store guideline 4.8 pairs it with Google on login). */
  appleOnly?: boolean;
  /** Called when an attempt starts, e.g. to clear a stale password error. */
  onStart?: () => void;
  /** '' clears the message. */
  onError: (message: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  /** Which provider's attempt is in flight, so a second tap cannot start another. */
  const [busy, setBusy] = useState<OAuthProvider | null>(null);

  const attempt = async (provider: OAuthProvider, run: () => Promise<string>) => {
    if (busy) return;
    setBusy(provider);
    onError('');
    onStart?.();
    try {
      onError(await run());
    } finally {
      setBusy(null);
    }
  };

  const browser = (provider: OAuthProvider) =>
    attempt(provider, async () => {
      const session = await runOAuthSession(provider, apiBaseUrl);
      if (session.outcome === 'not_opened') return 'Vi klarte ikke å åpne innloggingsvinduet. Prøv igjen.';
      // The browser closed without a return URL. Never treat that as a sign-in.
      if (session.outcome === 'dismissed') return 'Innloggingen ble avbrutt.';
      const result = await completeOAuthSignIn(session.url);
      return result.status === 'failed' ? result.message : '';
    });

  const nativeApple = () =>
    attempt('apple', async () => {
      const result = await signInWithApple();
      return result.status === 'failed' ? result.message : '';
    });

  return (
    <>
      {appleOnly ? null : (
        <>
          <SocialButton provider="vipps" disabled={busy !== null} onPress={() => void browser('vipps')} />
          <SocialButton provider="google" disabled={busy !== null} onPress={() => void browser('google')} />
        </>
      )}
      {/* App Store guideline 4.8: Sign in with Apple wherever Google is offered on iOS. */}
      {APPLE_SIGNIN_MODE === 'native' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            colorScheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={12}
          style={{ height: 46, width: '100%', opacity: busy ? 0.6 : 1 }}
          onPress={() => void nativeApple()}
        />
      ) : APPLE_SIGNIN_MODE === 'web' ? (
        <SocialButton provider="apple" disabled={busy !== null} onPress={() => void browser('apple')} />
      ) : null}
    </>
  );
}
