import { useUserStore } from '../../stores/userStore.ts';
import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '../Loading/PageLoader';

/**
 * Shown while the page-load bootstrap asks the server who is signed in. The same sprout
 * loader as a lazy route (PageLoader), so a protected page shows one loader, not a plain
 * "Laster …" line and then the sprout.
 */
export function AuthPending() {
  return <PageLoader />;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuth = useUserStore((state) => state.isAuthenticated);
  const authReady = useUserStore((state) => state.authReady);
  const location = useLocation();

  // Auth is in memory only and restored from the refresh cookie on load; deciding
  // before that finishes would bounce a signed-in user to /login on every reload.
  if (!authReady) return <AuthPending />;

  if (!isAuth) {
    // Redirect rather than open a modal. The modal's "Avbryt" called navigate(-1),
    // which does nothing on a cold deep link (email link, pasted URL, new tab)
    // because there is no history entry — the user was left staring at a page with
    // only a header and a footer and no way forward.
    //
    // `from` is read back by useAuth after login so the user lands where they were
    // actually going. Send the full path so query strings (?session_id=...) survive.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
