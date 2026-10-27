import { test } from '@playwright/test';
import { expect, mockApi, USERS } from './helpers/app.js';

/**
 * The profile's "E-post" section: an unconfirmed address is confirmed in a popup (opening it sends
 * a code, type it), separate from BankID — no "Verifisert" wording, no BankID badge, and nothing
 * (BankID included) waits for it.
 */

test.describe.configure({ timeout: 120_000 });

const unconfirmed = () => ({ ...USERS.user, emailVerified: false, identityVerified: false });

test('unconfirmed e-mail: the popup sends a code, a wrong code is refused, the right one confirms it', async ({
  page,
}) => {
  const { calls, state } = await mockApi(page, {
    as: unconfirmed(),
    routes: {
      'POST /api/auth/email/send-code': () => ({
        message: `Vi har sendt en kode til ${USERS.user.email}.`,
      }),
      'POST /api/auth/email/verify': ({ body, state: s }) => {
        if (body?.code !== '123456')
          return { status: 400, json: { error: 'Ugyldig eller utløpt kode' } };
        s.session = { ...s.session, emailVerified: true };
        return { emailVerified: true };
      },
    },
  });
  await page.goto('/profile');

  const card = page.getByTestId('email-verification-card').locator('visible=true');
  await expect(card.getByRole('heading', { name: 'E-post' })).toBeVisible();
  await expect(card.getByText(/E-posten din er ikke bekreftet/)).toBeVisible();
  // BankID stays its own section, is not held back, and shows no badge.
  const bankId = page.getByTestId('identity-verification-card').locator('visible=true');
  await expect(bankId.getByRole('heading', { name: 'BankID' })).toBeVisible();
  await expect(bankId.getByTestId('bankid-verify-button')).toBeEnabled();
  await expect(page.getByText('Identitet bekreftet')).toHaveCount(0);
  await expect(card.getByText(/Verifisert/i)).toHaveCount(0);

  await card.getByRole('button', { name: 'Bekreft e-post' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bekreft e-post' });
  await expect(dialog.getByRole('status')).toContainText(USERS.user.email);
  expect(calls.filter((c) => c.pathname === '/api/auth/email/send-code')).toHaveLength(1);

  const typeCode = async (code) => {
    for (const [i, digit] of [...code].entries())
      await dialog.getByLabel(`OTP siffer ${i + 1}`).fill(digit);
  };
  await typeCode('000000');
  await expect(dialog.getByRole('alert')).toHaveText('Ugyldig eller utløpt kode');
  expect(state.session.emailVerified).toBe(false);

  await typeCode('123456');
  await expect(
    page
      .getByTestId('email-verification-card')
      .locator('visible=true')
      .getByText('E-post bekreftet')
  ).toBeVisible();
  await expect(page.getByText(/E-posten din er ikke bekreftet/)).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  // E-mail confirmation never turns into the BankID badge.
  await expect(page.getByText('Identitet bekreftet')).toHaveCount(0);
  expect(calls.filter((c) => c.pathname === '/api/auth/email/verify').map((c) => c.body)).toEqual([
    { code: '000000' },
    { code: '123456' },
  ]);
});

test('a confirmed e-mail shows "E-post bekreftet" and no verify controls', async ({ page }) => {
  await mockApi(page, { as: { ...USERS.user, emailVerified: true } });
  await page.goto('/profile');
  const card = page.getByTestId('email-verification-card').locator('visible=true');
  await expect(card.getByText('E-post bekreftet')).toBeVisible();
  await expect(card.getByRole('button', { name: /Bekreft e-post/ })).toHaveCount(0);
});
