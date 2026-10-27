import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { queryKeys } from '@/queryKeys';
import { exchangeOAuthCode, fetchProfileWithToken } from '@/services/auth.service';
import { oauthErrorMessage } from '@/utils/oauthErrors';
import { decideOAuthLink } from '@/utils/oauthPending';
import {
  clearOAuthPending,
  getOAuthPendingSince,
  getOAuthVerifier,
} from '@/utils/oauthAuthSession';

/**
 * Turning a finished Google or Vipps trip into a signed-in session — exactly once.
 *
 * Two independent observers can see the same return, and on different platforms different
 * ones do. On iOS the callback is delivered to ASWebAuthenticationSession, so the login
 * screen's `runOAuthSession` is the only thing that sees it. On Android the app receives a
 * real deep link, so expo-router also routes to app/(auth)/oauth-success.tsx and that screen
 * sees it too. Both call `completeOAuthSignIn`, and it is single-flight per code: the second
 * caller joins the first one's promise instead of firing a second profile request and a
 * second `authStore.login`.
 *
 * Nothing here navigates. `app/(auth)/_layout.tsx` redirects to `/(app)` the moment
 * `isAuthenticated` flips, from whichever screen the person is actually looking at.
 */

/** The `?error=` vocabulary the backend emits: lower snake_case. */
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** The server's one-time code: 32 random bytes, base64url (backend/utils/oauthReturn.js). */
const ONE_TIME_CODE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The link carries a one-time code, never a token (security review P6): any Android app can
 * register `jobblo://` and receive it, and the code is useless without this app's PKCE
 * verifier. A `?token=` link (what the server sends builds that predate PKCE) is refused:
 * this build always sends a challenge, so a token link can only be someone else's.
 */
export type OAuthReturnParams = {
  code?: string | string[] | null;
  error?: string | string[] | null;
};

export type ParsedOAuthReturn =
  | { kind: 'success'; code: string }
  | { kind: 'error'; code: string }
  /** Neither a usable one-time code nor a known error code — mangled, or a token link. */
  | { kind: 'unusable' };

/** expo-router hands repeated query keys over as arrays; take the first. */
function first(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : '';
  return typeof value === 'string' ? value.trim() : '';
}

export function parseOAuthParams(params: OAuthReturnParams): ParsedOAuthReturn {
  const oneTime = first(params.code);
  const code = first(params.error);
  // A code is only ever acted on when the server sent no error alongside it, and only when it
  // has the right shape. Never fabricate a session out of a malformed link.
  if (!code && ONE_TIME_CODE.test(oneTime)) return { kind: 'success', code: oneTime };
  if (ERROR_CODE.test(code)) return { kind: 'error', code };
  return { kind: 'unusable' };
}

/**
 * Same thing from a raw deep link, for the caller that holds the URL rather than router
 * params. Parsed by hand: React Native's `URLSearchParams` polyfill throws on `get`, and the
 * fragment is dropped first so nothing after a `#` can supply a false match.
 */
export function parseOAuthReturnUrl(url: string): ParsedOAuthReturn {
  const route = (url ?? '').split('#')[0] ?? '';
  const at = route.indexOf('?');
  const params: OAuthReturnParams = {};
  if (at !== -1) {
    for (const pair of route.slice(at + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
      let key = rawKey;
      let value = rawValue;
      try {
        key = decodeURIComponent(rawKey);
        value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      } catch {
        // Malformed percent-encoding: keep the raw value and let validation reject it.
      }
      if (key === 'code' || key === 'error') params[key] = value;
    }
  }
  return parseOAuthParams(params);
}

export type OAuthCompletion = { status: 'signed-in' } | { status: 'failed'; message: string };

/**
 * One entry per code, at module scope so it survives a screen unmounting mid-flight.
 *
 * Successful entries are kept: a late second observer joining an already-resolved promise is
 * the whole point, and evicting would let it run the sign-in a second time — a second
 * `/auth/profile` request and a second `authStore.login`, which clears the session before
 * re-creating it. Failures are evicted too, but a code is single use, so a failed exchange
 * also closes the pending window and the person starts again. A kept success is re-checked against the store below, because the link
 * that produced it can be tapped again after a sign-out.
 */
const completions = new Map<string, Promise<OAuthCompletion>>();

const GENERIC_FAILURE = 'Innloggingen mislyktes. Prøv igjen.';

/**
 * Redeem the code with this app's PKCE verifier, verify the token with the server, then create
 * the session. This is the ONLY place a mobile OAuth sign-in becomes real.
 *
 * The code arrives in a deep link, so it is a claim until the exchange accepts it with the
 * verifier only this app holds and `/auth/profile` answers with the account it belongs to.
 * The user object is that answer — never a JWT payload decoded locally.
 */
export async function completeOAuthSignIn(
  input: ParsedOAuthReturn | string
): Promise<OAuthCompletion> {
  const parsed = typeof input === 'string' ? parseOAuthReturnUrl(input) : input;

  // The provider said no, or the link is mangled: this attempt is over, so it must not leave
  // the pending window open for another link to use.
  if (parsed.kind === 'error') {
    await clearOAuthPending();
    return { status: 'failed', message: oauthErrorMessage(parsed.code) ?? GENERIC_FAILURE };
  }
  if (parsed.kind === 'unusable') {
    await clearOAuthPending();
    return { status: 'failed', message: GENERIC_FAILURE };
  }

  const existing = completions.get(parsed.code);
  if (existing) {
    const result = await existing;
    /**
     * A resolved success is only still true while a session actually exists. The bridge page
     * can outlive the one it created — it stays in the browser's recents, inviting a tap on
     * "Åpne Jobblo" long after a sign-out — and handing back the old promise then would report
     * a session that is gone, leaving the arrival screen waiting for a redirect that never
     * comes. Re-run instead, and let the server say whether the code is still good.
     */
    if (result.status === 'failed' || useAuthStore.getState().isAuthenticated) {
      return result;
    }
    completions.delete(parsed.code);
  }

  // Registered before any await, so a second delivery of the same link always joins this one.
  const run = (async (): Promise<OAuthCompletion> => {
    // Only a sign-in this app started, and never over an existing session: anyone can open a
    // jobblo://oauth-success link, and one carrying their own token used to switch the phone
    // into their account (security review H1).
    const decision = decideOAuthLink(
      await getOAuthPendingSince(),
      useAuthStore.getState().isAuthenticated
    );
    if (decision !== 'accept') {
      return {
        status: 'failed' as const,
        message:
          decision === 'already-signed-in'
            ? 'Du er allerede logget inn.'
            : 'Innloggingen ble ikke startet fra appen. Start innloggingen på nytt.',
      };
    }
    const verifier = await getOAuthVerifier();
    if (!verifier) throw new Error('No PKCE verifier for this sign-in');
    const token = await exchangeOAuthCode(parsed.code, verifier);
    const user = await fetchProfileWithToken(token);
    await useAuthStore.getState().login(token, user);
    await clearOAuthPending();
    return { status: 'signed-in' as const };
  })().catch(async () => {
    // The server consumes a code on any exchange attempt, so this sign-in is over.
    completions.delete(parsed.code);
    await clearOAuthPending();
    return { status: 'failed' as const, message: GENERIC_FAILURE };
  });

  completions.set(parsed.code, run);
  return run;
}

/**
 * Runs the completion for a screen and reports where it got to.
 *
 * The query cache is seeded here rather than inside `completeOAuthSignIn` because a
 * `QueryClient` only exists inside the provider tree, while the completion itself has to be
 * callable from a plain async function. Seeding twice is harmless — it is the same object
 * under the same key — and skipping it entirely would leave the first profile read to refetch
 * something the app already has.
 */
export function useOAuthLoginCompletion(params: OAuthReturnParams) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<'working' | 'signed-in' | 'failed'>('working');
  const [message, setMessage] = useState<string | null>(null);

  const code = first(params.code);
  const errorCode = first(params.error);

  useEffect(() => {
    let active = true;

    void completeOAuthSignIn(parseOAuthParams({ code, error: errorCode })).then((result) => {
      if (!active) return;
      if (result.status === 'signed-in') {
        const user = useAuthStore.getState().user;
        if (user) queryClient.setQueryData(queryKeys.auth.profile, user);
        setState('signed-in');
        setMessage(null);
        return;
      }
      setState('failed');
      setMessage(result.message);
    });

    return () => {
      active = false;
    };
  }, [code, errorCode, queryClient]);

  return { state, message } as const;
}
