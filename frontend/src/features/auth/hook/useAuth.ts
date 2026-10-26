import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  userLogin,
  registerUser,
  getUserSessions,
  revokeSession,
  revokeAllOtherSessions,
  refreshToken,
  forgotPassword,
  verifyOtp,
  resetPassword,
  verifyEmail,
  resendVerification,
} from '../Api';
import { useUserStore } from '../../../stores/userStore';
import type { User } from '../../../types/userTypes';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/getErrorMessage';
import { safeLocalPath } from '../../../utils/safeLocalPath';

/** Login refused because the sign-up e-mail is not confirmed yet (a fresh code was mailed). */
export const isEmailNotVerified = (error: unknown) =>
  (error as { response?: { data?: { code?: string } } })?.response?.data?.code === 'EMAIL_NOT_VERIFIED';

export const useAuth = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { login: setStoreLogin, logout: setStoreLogout, isAuthenticated } = useUserStore();

  // Where the user was heading before ProtectedRoute bounced them here. Without
  // this, anyone following a shared job link, a notification or a checkout link
  // was sent to /home after logging in and lost what they were trying to do.
  // Only same-origin paths are honoured so a crafted state can't redirect off-site.
  const redirectAfterAuth = (fallback = '/home'): string => {
    return safeLocalPath((location.state as { from?: unknown } | null)?.from, fallback);
  };

  // Note: Don't auto-logout here during rehydration - let the interceptor handle token issues

  const loginMutation = useMutation({
    mutationFn: userLogin,
    onSuccess: (data) => {
      setStoreLogin(data.user, { accessToken: data.accessToken });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(`Velkommen tilbake, ${data.user.name}!`);
      navigate(redirectAfterAuth(data.user.role === 'developer' ? '/developer' : '/home'), { replace: true });
    },
    onError: (error: unknown) => {
      // getErrorMessage also handles the object-shaped envelope from the Express
      // error handler, which the old `data?.error` read would have passed to
      // toast.error as an object.
      if (isEmailNotVerified(error)) return; // LoginForm shows the "Bekreft e-post" step instead
      toast.error(getErrorMessage(error, 'Innlogging mislyktes. Sjekk e-post og passord.'));
    },
  });

  const finishSignUp = (data: { user: User; accessToken: string }) => {
    setStoreLogin(data.user, { accessToken: data.accessToken });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    toast.success('Registreringen er fullført!');
    navigate(redirectAfterAuth(), { replace: true });
  };

  const registerMutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (data) => {
      // The server mails a code and signs in only after POST /verify-email (RegisterForm).
      if (data?.verificationRequired) return;
      finishSignUp(data);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Registreringen mislyktes. Prøv igjen.'));
    },
  });

  // Errors are shown inline by VerifyEmailStep.
  const verifyEmailMutation = useMutation({ mutationFn: verifyEmail, onSuccess: finishSignUp });

  const resendVerificationMutation = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => toast.success('Vi har sendt en ny kode.'),
    onError: (error: unknown) => toast.error(getErrorMessage(error, 'Kunne ikke sende koden. Prøv igjen.')),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await setStoreLogout();
    },
    onSuccess: () => {
      queryClient.clear();
      toast.success('Du er nå logget ut.');
      navigate('/login');
    },
    onError: () => {
      // Still logout locally if server logout fails
      queryClient.clear();
      navigate('/login');
    },
  });

  // No ['profile'] query here: bootstrap() and login already put the profile in the store.
  // This query re-fetched it on every signed-in load, and App swapped the whole page for a
  // loader while it ran, remounting everything below it.

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: getUserSessions,
    enabled: isAuthenticated,
    retry: false,
  });

  const revokeSessionMutation = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Økten er logget ut.');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Kunne ikke logge ut økten.'));
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: revokeAllOtherSessions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Alle andre økter er logget ut.');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Kunne ikke logge ut de andre øktene.'));
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: (email: string) => forgotPassword(email),
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Kunne ikke sende koden. Prøv igjen.'));
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: ({ email, otp }: { email: string; otp: string }) => verifyOtp(email, otp),
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Ugyldig eller utløpt kode.'));
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ resetToken, password }: { resetToken: string; password: string }) =>
      resetPassword(resetToken, password),
    onSuccess: () => {
      toast.success('Passordet er oppdatert! Du kan nå logge inn.');
      navigate('/login');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Noe gikk galt. Start på nytt.'));
    },
  });

  // Proactive Token Refresh (Keep session alive)
  useQuery({
    queryKey: ['auth-refresh'],
    queryFn: async () => {
      try {
        const data = await refreshToken();
        useUserStore.getState().setTokens({ accessToken: data.accessToken });
        return data;
      } catch (error) {
        console.error('Proactive token refresh failed:', error);
        // Don't logout here - let the interceptor handle it on next API call
        throw error;
      }
    },
    refetchInterval: 1000 * 60 * 45, // Proactively refresh every 45 minutes
    // Login and the page-load bootstrap have just minted a token; without these the
    // query fired a second, back-to-back rotation the moment isAuthenticated flipped.
    initialData: null,
    staleTime: 1000 * 60 * 45,
    enabled: isAuthenticated,
    retry: 2,
  });

  return {
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    register: registerMutation.mutate,
    isRegistering: registerMutation.isPending,
    registerError: registerMutation.error,
    verifyEmail: verifyEmailMutation.mutate,
    isVerifyingEmail: verifyEmailMutation.isPending,
    resendVerification: resendVerificationMutation.mutate,
    isResendingVerification: resendVerificationMutation.isPending,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    sessions: sessionsQuery.data,
    isLoadingSessions: sessionsQuery.isLoading,
    revokeSession: revokeSessionMutation.mutate,
    revokeOthers: revokeOthersMutation.mutate,
    isRevokingOthers: revokeOthersMutation.isPending,
    forgotPassword: forgotPasswordMutation.mutate,
    isSendingResetEmail: forgotPasswordMutation.isPending,
    forgotPasswordSuccess: forgotPasswordMutation.isSuccess,
    verifyOtp: verifyOtpMutation.mutate,
    isVerifyingOtp: verifyOtpMutation.isPending,
    verifyOtpData: verifyOtpMutation.data,
    verifyOtpSuccess: verifyOtpMutation.isSuccess,
    resetPassword: resetPasswordMutation.mutate,
    isResettingPassword: resetPasswordMutation.isPending,
  };
};
