import apiClient from '../api/client';

export type CurrentProfile = {
  _id?: string;
  name?: string;
  lastName?: string;
  /**
   * The account's login e-mail, returned by GET /auth/profile because `email` is
   * part of the backend OWN_USER_SELECT projection. Whether it is confirmed is
   * `emailVerified`; `verified` and `identityVerified` below are unrelated flags
   * (admin trust and BankID respectively).
   */
  email?: string;
  /** E-mail confirmed with a mailed code or a provider (legacy accounts: true). Never BankID. */
  emailVerified?: boolean;
  companyName?: string;
  role?: string;
  avatarUrl?: string;
  verified?: boolean;
  identityVerified?: boolean;
  bio?: string;
  skills?: string[];
  availabilityText?: string;
  locations?: string[];
  address?: string;
  postNumber?: string;
  postSted?: string | { city?: string };
  /**
   * Free-text country on the user profile (backend `User.country` is a plain
   * `String` with no enum and no ISO-code constraint), returned by
   * GET /auth/profile because `country` is part of the backend OWN_USER_SELECT
   * projection. This is the profile's own country — unrelated to a job's
   * location fields (address/city/coordinates/countyCode/municipalityCode).
   */
  country?: string;
  /**
   * Free-text phone number on the user profile (backend `User.phone` is a plain
   * `String` with `trim: true`). Returned by GET /auth/profile because `phone`
   * is part of the backend OWN_USER_SELECT projection.
   */
  phone?: string;
  orgNumber?: string;
  website?: string;
  averageRating?: number;
  reviewCount?: number;
  completedJobs?: number;
  postedJobsCount?: number;
  responseRate?: number;
  averageResponseTime?: number;
  repeatCustomersCount?: number;
  createdAt?: string;
  [key: string]: unknown;
};

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const response = await apiClient.get<CurrentProfile>('/auth/profile');
  return response.data;
}

export type ProfileUpdate = Partial<{
  name: string;
  lastName: string;
  /**
   * Login identifier. Backend `User.email` is `unique`, `required`, `lowercase`
   * and `trim`-ed, and `authController.login` looks the account up by it, so it
   * must always be sent already normalized (`trim().toLowerCase()`). It is
   * present in normal-user `allowedUpdates` in updateUser; a collision surfaces
   * as 409 `E-postadressen er allerede i bruk.` via sendMongoError.
   */
  email: string;
  /** Required by updateUser whenever `email` actually changes (403 CURRENT_PASSWORD_REQUIRED). */
  currentPassword: string;
  bio: string;
  skills: string[];
  availabilityText: string;
  address: string;
  postNumber: string;
  postSted: string;
  /** Accepted by backend updateUser's `allowedUpdates`; stored as free text. */
  country: string;
  /**
   * Free-text phone number on the user profile (backend `User.phone` is a plain
   * `String` with `trim: true` and a `set` hook that converts empty strings to
   * `undefined`). Present in normal-user `allowedUpdates` of `updateUser`.
   */
  phone: string;
  companyName: string;
  orgNumber: string;
  website: string;
}>;

export async function updateCurrentProfile(
  userId: string,
  data: ProfileUpdate | FormData
): Promise<CurrentProfile> {
  const response = await apiClient.put<CurrentProfile>(`/users/${userId}`, data);
  return response.data;
}

// The backend requires the current password to delete your own account (accounts without a
// password - Google/Apple/Vipps - need a login from the last 10 minutes instead).
export async function deleteCurrentUser(
  userId: string,
  currentPassword?: string
): Promise<{ message: string }> {
  const response = await apiClient.delete<{ message: string }>(`/users/${userId}`, {
    data: currentPassword ? { currentPassword } : {},
  });
  return response.data;
}
