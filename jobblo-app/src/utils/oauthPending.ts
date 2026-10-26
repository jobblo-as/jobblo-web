/**
 * When may a `jobblo://oauth-success?token=…` link sign someone in?
 *
 * Any app or web page can open that link, so on its own it proves nothing: a link carrying
 * an attacker's token used to switch the phone into the attacker's account, and everything
 * the victim then typed (addresses, messages) went to them (security review H1). It is only
 * accepted when THIS app started a Google/Vipps sign-in a short while ago, and never while
 * someone is already signed in.
 *
 * Pure so `oauthPending.check.mjs` can run it under plain Node.
 */
export const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;

export type OAuthLinkDecision = 'accept' | 'already-signed-in' | 'not-started';

export function decideOAuthLink(
  pendingSince: number | null | undefined,
  isAuthenticated: boolean,
  now: number = Date.now()
): OAuthLinkDecision {
  if (isAuthenticated) return 'already-signed-in';
  const since = Number(pendingSince) || 0;
  if (since <= 0 || since > now || now - since > OAUTH_PENDING_TTL_MS) return 'not-started';
  return 'accept';
}
