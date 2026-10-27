import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, USERS } from './helpers/app.js';

/** Sign-up, login (+ the admin 2FA gate), logout and switching account, on a mocked API. */

test.describe.configure({ timeout: 120_000 });

const store = (page) =>
  page.evaluate(() => {
    const { user, isAuthenticated } = window.__jobbloUserStore.getState();
    return { id: user?._id ?? null, isAuthenticated };
  });

test('sign-up: two steps, validation, then signed in on /home straight away (no e-mail step)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const newUser = {
    _id: '64a0000000000000000000aa',
    name: 'Kari',
    lastName: 'Nordmann',
    email: 'kari@example.test',
    role: 'user',
    emailVerified: false,
  };
  const { calls, state } = await mockApi(page, {
    routes: {
      // Like the backend: registering signs in at once; the e-mail is confirmed on the profile.
      'POST /api/auth/register': ({ state: s }) => {
        s.session = newUser;
        return { status: 201, json: { user: newUser, accessToken: `at-${newUser._id}` } };
      },
    },
  });
  await page.goto('/register');
  await page.getByRole('button', { name: 'Fortsett', exact: true }).click();
  await expect(page.getByText('Vennligst skriv inn fornavn')).toBeVisible();
  await page.getByPlaceholder('Ola').fill('Kari');
  await page.getByPlaceholder('Nordmann', { exact: true }).fill('Nordmann');
  await page.getByRole('button', { name: 'Fortsett', exact: true }).click();

  await page.getByPlaceholder('deg@eksempel.no').fill('kari@example.test');
  await page.getByPlaceholder('Velg et passord').fill('weak');
  await page.getByPlaceholder('Skriv passordet på nytt').fill('weak');
  await page.getByRole('button', { name: 'Opprett konto' }).click();
  await expect(page.getByText(/Passordet må være minst 8 tegn/)).toBeVisible();
  await expect(page.getByText('Du må godta Brukervilkårene for å opprette konto.')).toBeVisible();
  expect(calls.some((c) => c.pathname === '/api/auth/register')).toBe(false);

  await page.getByPlaceholder('Velg et passord').fill('Passord123');
  await page.getByPlaceholder('Skriv passordet på nytt').fill('Passord123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Opprett konto' }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(async () => (await store(page)).id).toBe(newUser._id);
  await expect(page.getByRole('heading', { name: 'Bekreft e-post' })).toHaveCount(0);
  expect(calls.find((c) => c.pathname === '/api/auth/register').body).toMatchObject({
    name: 'Kari',
    lastName: 'Nordmann',
    email: 'kari@example.test',
    password: 'Passord123',
    role: 'user',
    acceptedTerms: true,
  });
  expect(calls.some((c) => c.pathname === '/api/auth/verify-email')).toBe(false);
  expect(state.session).toBe(newUser);
  expect(errors).toEqual([]);
});

test('login on an unconfirmed account signs in normally (no e-mail step)', async ({ page }) => {
  const newUser = {
    _id: '64a0000000000000000000ab',
    name: 'Ola',
    email: 'ola@example.test',
    role: 'user',
    emailVerified: false,
  };
  const { calls } = await mockApi(page, {
    routes: {
      'POST /api/auth/login': ({ state: s }) => {
        s.session = newUser;
        return { user: newUser, accessToken: `at-${newUser._id}` };
      },
    },
  });
  await page.goto('/login');
  await login(page, newUser.email);
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(async () => (await store(page)).id).toBe(newUser._id);
  expect(
    calls.some(
      (c) =>
        c.pathname === '/api/auth/verify-email' || c.pathname === '/api/auth/resend-verification'
    )
  ).toBe(false);
});

test('sign-up shows the server error and stays on the form', async ({ page }) => {
  await mockApi(page, {
    routes: {
      'POST /api/auth/register': () => ({
        status: 400,
        json: { error: 'E-post er allerede registrert' },
      }),
    },
  });
  await page.goto('/register');
  await page.getByPlaceholder('Ola').fill('Kari');
  await page.getByPlaceholder('Nordmann', { exact: true }).fill('Nordmann');
  await page.getByRole('button', { name: 'Fortsett', exact: true }).click();
  await page.getByPlaceholder('deg@eksempel.no').fill('taken@example.test');
  await page.getByPlaceholder('Velg et passord').fill('Passord123');
  await page.getByPlaceholder('Skriv passordet på nytt').fill('Passord123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Opprett konto' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-post er allerede registrert' })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});

async function login(page, email, password = 'Passord123') {
  await page.getByPlaceholder('deg@eksempel.no').fill(email);
  await page.getByPlaceholder('Ditt passord').fill(password);
  await page.locator('form button[type="submit"]').click();
}

const loginRoute = {
  'POST /api/auth/login': ({ body, state }) => {
    const u = Object.values(USERS).find((x) => x.email === body?.email);
    if (!u || body.password !== 'Passord123')
      return { status: 401, json: { error: 'Feil e-post eller passord' } };
    state.session = u;
    return { user: u, accessToken: `at-${u._id}` };
  },
};

test('login: wrong password shows an error, right one returns to the page the user wanted', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockApi(page, { routes: loginRoute });
  await page.goto('/favorites');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, USERS.user.email, 'wrong');
  await expect(page.getByText('Feil e-post eller passord').first()).toBeVisible();
  expect((await store(page)).isAuthenticated).toBe(false);

  await login(page, USERS.user.email);
  await expect(page).toHaveURL(/\/favorites$/);
  expect((await store(page)).id).toBe(USERS.user._id);
  expect(errors).toEqual([]);
});

test('admin login is held at the authenticator gate until the code is right', async ({ page }) => {
  const verify = [];
  await mockApi(page, {
    mfaVerified: false,
    routes: {
      ...loginRoute,
      'POST /api/auth/mfa/verify': ({ body, state }) => {
        verify.push(body);
        if (body?.code !== '123456')
          return { status: 400, json: { message: 'That code is not right — try again.' } };
        state.mfa.verified = true;
        return { ok: true };
      },
      // Like the backend: admin data only after the code.
      '~* ^/api/admin/': ({ state }) =>
        state.mfa.verified
          ? { success: true, data: [] }
          : { status: 403, json: { code: 'MFA_REQUIRED' } },
    },
  });
  await page.goto('/login');
  await login(page, USERS.superAdmin.email);
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/dashboard');
  await expect(page.getByText('Two-factor sign-in')).toBeVisible();
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not right — try again.');
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Two-factor sign-in')).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(verify).toEqual([{ code: '000000' }, { code: '123456' }]);
});

test('logout from the profile menu; the next account sees none of the previous data', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { calls, state } = await mockApi(page, { as: 'user', routes: loginRoute });
  await page.goto('/profile');
  await expect(page.getByText(USERS.user.name).first()).toBeVisible();
  await page.getByRole('button', { name: 'Flere valg' }).click();
  await page.getByRole('menuitem', { name: 'Logg ut' }).click();
  await page.getByRole('button', { name: 'Ja, logg ut' }).click();
  await expect(page).toHaveURL(/\/$/); // logging out from the profile lands on the front page
  expect(calls.some((c) => c.pathname === '/api/auth/logout')).toBe(true);
  expect(state.session).toBe(null);
  expect(await store(page)).toEqual({ id: null, isAuthenticated: false });

  await page.goto('/login');
  await login(page, USERS.provider.email);
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/profile');
  await expect(page.getByText(USERS.provider.name).first()).toBeVisible();
  await expect(page.getByText(USERS.user.name)).toHaveCount(0);
  // Every authenticated call after the switch carries the new account's token.
  const after = calls.slice(calls.findLastIndex((c) => c.pathname === '/api/auth/login'));
  expect(after.some((c) => c.pathname === '/api/auth/profile')).toBe(true);
  expect(errors).toEqual([]);
});

test('forgot password: the email step asks the server for a code', async ({ page }) => {
  const { calls } = await mockApi(page, {
    routes: { 'POST /api/auth/forgot-password': () => ({ message: 'sent' }) },
  });
  await page.goto('/forgot-password');
  await page.getByPlaceholder('deg@eksempel.no').fill(USERS.user.email);
  await page.getByRole('button', { name: 'Send kode' }).click();
  await expect.poll(() => calls.some((c) => c.pathname === '/api/auth/forgot-password')).toBe(true);
  expect(calls.find((c) => c.pathname === '/api/auth/forgot-password').body).toEqual({
    email: USERS.user.email,
  });
});
