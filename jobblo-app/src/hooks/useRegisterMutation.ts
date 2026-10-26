import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useRegistrationStore } from '@/store/registrationStore';
import {
  registerUser,
  verifyEmail,
  type RegisterRequest,
  type RegisterResponse,
  type LoginResponse,
} from '@/services/auth.service';
import { queryKeys } from '@/queryKeys';

/**
 * Register mutation. Signs nobody in: the server mails a code, and useVerifyEmailMutation
 * finishes sign-up with it.
 * Navigation after success is handled by the calling screen —
 * hooks must not call useRouter() and navigate themselves because the
 * hook may be instantiated before the navigation context is ready.
 */
export function useRegisterMutation() {
  return useMutation<RegisterResponse, Error, RegisterRequest>({ mutationFn: registerUser });
}

/** The mailed code (sign-up, or a login refused with EMAIL_NOT_VERIFIED): signs in like login. */
export function useVerifyEmailMutation() {
  const queryClient = useQueryClient();

  return useMutation<LoginResponse, Error, { email: string; code: string; password: string }>({
    mutationFn: verifyEmail,
    onSuccess: async (data) => {
      // Awaited like login: the screen navigates into (app) right after, and the token must
      // already be in storage for the first authenticated request.
      await useAuthStore.getState().login(data.accessToken, data.user);
      queryClient.setQueryData(queryKeys.auth.profile, data.user);
      // The form lives in a module-level store; without this the next visit to /register
      // (e.g. after logout on a shared phone) opens pre-filled with this user's password.
      useRegistrationStore.getState().reset();
    },
  });
}
