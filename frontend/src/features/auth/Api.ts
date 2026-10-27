import mainLink from '../../api/mainURLs';

export async function userLogin(credentials: { email: string; password: string }) {
  const res = await mainLink.post('/api/auth/login', credentials);
  return res.data;
}

export async function registerUser(userData: {
  name: string;
  email: string;
  password: string;
  acceptedTerms: boolean;
  lastName: string;
  role?: string;
  companyName?: string;
  orgNumber?: string;
}) {
  const res = await mainLink.post('/api/auth/register', userData);
  return res.data;
}

/** Signed in: mail a code to the account's own address (profile "E-post" row). */
export async function sendEmailCode() {
  const res = await mainLink.post<{ message: string }>('/api/auth/email/send-code');
  return res.data;
}

/** Signed in: confirm the address with that code. Sets only emailVerifiedAt. */
export async function confirmEmailCode(code: string) {
  const res = await mainLink.post<{ emailVerified: boolean }>('/api/auth/email/verify', { code });
  return res.data;
}

export async function logoutUser() {
  const res = await mainLink.post('/api/auth/logout');
  return res.data;
}

export async function refreshToken() {
  const res = await mainLink.post('/api/auth/refresh-token');
  return res.data;
}

export async function getUserSessions() {
  const res = await mainLink.get('/api/auth/sessions');
  return res.data;
}

export async function revokeSession(sessionId: string) {
  const res = await mainLink.delete(`/api/auth/sessions/${sessionId}`);
  return res.data;
}

export async function revokeAllOtherSessions() {
  const res = await mainLink.delete('/api/auth/sessions/revoke-others');
  return res.data;
}

export async function fetchProfile() {
  const res = await mainLink.get('/api/auth/profile');
  return res.data;
}

export async function forgotPassword(email: string) {
  const res = await mainLink.post('/api/auth/forgot-password', { email });
  return res.data;
}

export async function verifyOtp(email: string, otp: string) {
  const res = await mainLink.post('/api/auth/verify-otp', { email, otp });
  return res.data;
}

export async function resetPassword(resetToken: string, password: string) {
  const res = await mainLink.post('/api/auth/reset-password', { resetToken, password });
  return res.data;
}

export async function changePasswordSendOtp(currentPassword: string) {
  const res = await mainLink.post('/api/auth/change-password/send-otp', { currentPassword });
  return res.data;
}

export async function changePasswordVerifyOtp(otp: string, newPassword: string) {
  const res = await mainLink.post('/api/auth/change-password/verify-otp', { otp, newPassword });
  return res.data;
}
