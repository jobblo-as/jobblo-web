import * as AppleAuthentication from 'expo-apple-authentication';
import apiClient from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { fetchProfileWithToken, isUsableAuthToken } from '@/services/auth.service';
import { createPkcePair, sha256 } from '@/utils/pkce';

/**
 * Native Sign in with Apple (iOS). No browser and no deep link: iOS hands the identity token
 * straight to this call, the backend verifies it (POST /api/auth/apple/native) and answers with
 * an access token, which is then signed in exactly like a Google/Vipps return — verified against
 * /auth/profile first, then authStore.login.
 *
 * The nonce: Apple gets sha256(raw) and embeds it in the signed token; the backend gets raw and
 * checks the hash, so a token lifted from elsewhere is useless without the raw value. The raw
 * nonce is a PKCE verifier (pkce.ts): already a CSPRNG string, so no second random source.
 */

/** Lower-case hex SHA-256 of an ASCII string — the form Apple's `nonce` claim carries. */
export function appleNonceHash(raw: string): string {
  return Array.from(sha256(Uint8Array.from(raw, (ch) => ch.charCodeAt(0))), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export function createAppleNonce(): { raw: string; hashed: string } {
  const raw = createPkcePair().verifier;
  return { raw, hashed: appleNonceHash(raw) };
}

export type AppleSignInResult =
  { status: 'signed-in' } | { status: 'cancelled' } | { status: 'failed'; message: string };

const GENERIC_FAILURE = 'Apple-innloggingen mislyktes. Prøv igjen.';

function serverMessage(error: unknown): string | null {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data
    ?.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  // Never switch a signed-in phone into another account (same rule as security review H1).
  if (useAuthStore.getState().isAuthenticated) {
    return { status: 'failed', message: 'Du er allerede logget inn.' };
  }

  const nonce = createAppleNonce();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonce.hashed,
    });
  } catch (error) {
    if ((error as { code?: string })?.code === 'ERR_REQUEST_CANCELED')
      return { status: 'cancelled' };
    return { status: 'failed', message: GENERIC_FAILURE };
  }
  if (!credential.identityToken) return { status: 'failed', message: GENERIC_FAILURE };

  try {
    const response = await apiClient.post<{ accessToken?: string }>(
      '/auth/apple/native',
      {
        identityToken: credential.identityToken,
        rawNonce: nonce.raw,
        // Apple shares the name on the first sign-in only; the backend uses it for a new account.
        fullName: credential.fullName
          ? {
              givenName: credential.fullName.givenName ?? undefined,
              familyName: credential.fullName.familyName ?? undefined,
            }
          : undefined,
      },
      // Same as the OAuth code exchange: no stored token, a refusal never refreshes or signs out,
      // and the refresh cookie set here lands in the app's cookie store.
      { _callerSuppliedAuth: true, withCredentials: true }
    );
    const token = response.data?.accessToken;
    if (!isUsableAuthToken(token)) return { status: 'failed', message: GENERIC_FAILURE };

    const user = await fetchProfileWithToken(token);
    await useAuthStore.getState().login(token, user);
    return { status: 'signed-in' };
  } catch (error) {
    return { status: 'failed', message: serverMessage(error) ?? GENERIC_FAILURE };
  }
}
