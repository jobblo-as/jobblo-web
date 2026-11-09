import './styles/App.css';
import { BugReportHost } from './features/bugReport/BugReportDialog';
import './styles/Jobblo.css';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './components/layout/header/Header.tsx';
import { ScrollToTop } from './components/shared/ScrollToTop.tsx';
import { CookieBanner } from './components/shared/CookieBanner.tsx';
import { useAuth } from './features/auth/hook/useAuth.ts';
import { useOrderApprovalSocket } from './features/notifications/hooks';
import { NotificationRealtime } from './features/notifications/NotificationRealtime';
import { useUserStore } from './stores/userStore';
import { Toaster } from 'react-hot-toast';
import { lazy, Suspense } from 'react';
import { useMaintenanceStatus } from './hooks/useMaintenanceStatus';

// Below the fold (min-h-screen keeps it there), so it loads after the page, not with it.
const Footer = lazy(() => import('./components/layout/footer/Footer.tsx'));

export default function App() {
  useAuth(); // proactive token refresh
  const user = useUserStore((state) => state.user);
  const location = useLocation();

  // Listen for order approvals globally
  useOrderApprovalSocket(user?._id);

  const isMessagesPage = location.pathname.startsWith('/messages');

  // The auth screens are their own full-viewport layout with their own branding.
  // Rendering the site header and footer around them stacked three full-height
  // regions on top of each other, which is what forced the login page to scroll.
  const isAuthPage = ['/login', '/register', '/forgot-password'].includes(location.pathname);

  // Vedlikeholdsmodus for the whole site: users see the message; staff, sign-in and the
  // admin/developer consoles stay usable (the API enforces the same in services/maintenance.js).
  const { siteOff } = useMaintenanceStatus();
  const isStaff = user?.role === 'superAdmin' || user?.role === 'developer';
  const siteClosed =
    Boolean(siteOff) &&
    !isStaff &&
    !isAuthPage &&
    !/^\/(dashboard|developer)(\/|$)/.test(location.pathname);

  return (
    <>
      {/* Toasts were `#333` on white at a 12 px radius — a neutral grey that appears
          nowhere else on the site, in a shape that matches nothing either. They are the
          brand's near-black green now, with the pill radius the rest of the UI uses, and
          success/error keep their own icon colour so the two read apart at a glance
          rather than relying on the words alone. */}
      <Toaster
        position="bottom-center"
        gutter={10}
        toastOptions={{
          duration: 4000,
          style: {
            background: '#122A1C',
            color: '#FFFFFF',
            zIndex: 99999,
            borderRadius: '9999px',
            padding: '10px 18px',
            fontSize: '0.875rem',
            fontWeight: 500,
            lineHeight: 1.5,
            maxWidth: '30rem',
            boxShadow: '0 12px 32px rgba(11, 11, 11, 0.22)',
          },
          success: {
            iconTheme: { primary: '#8FBF9A', secondary: '#122A1C' },
          },
          error: {
            duration: 5000,
            iconTheme: { primary: '#E8A8A0', secondary: '#122A1C' },
          },
          loading: {
            iconTheme: { primary: '#8FBF9A', secondary: '#122A1C' },
          },
        }}
      />
      {/* All notification socket handling — sound, toast, system notification, cache
          updates, reconnect and foreground recovery — lives here and is mounted exactly
          once. It renders nothing. */}
      <NotificationRealtime />
      {/* "Rapporter en feil" from the footer, the menu or settings, on the page you are on. */}
      <BugReportHost />
      <ScrollToTop />
      <CookieBanner />
      {!isAuthPage && <Header />}
      {/* At least one screen tall, so the footer starts below the fold. Without it the footer
          sat right under a redirect, the session check or a short skeleton, then jumped down
          when the page arrived — the main source of layout shift (CLS 0.2–1.8 per load). */}
      <div className={isMessagesPage || isAuthPage ? undefined : 'min-h-screen'}>
        {siteClosed ? (
          <main
            role="status"
            className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center"
          >
            <h1 className="text-2xl font-bold text-[#0B0B0B]">Vedlikehold</h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-[#3F5A46]">{siteOff}</p>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
      {!isMessagesPage && !isAuthPage && (
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
      )}
    </>
  );
}
