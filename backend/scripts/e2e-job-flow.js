/**
 * End-to-end walk of the money path, run against a live local backend.
 *
 *   register customer + provider
 *     → customer posts a job
 *     → provider applies
 *     → customer awards it (creates the SafePay contract / Order)
 *     → customer opens a Stripe Checkout session
 *     → the session is paid with a test card via the Stripe API
 *     → the order is confirmed paid (the same path the success page polls)
 *     → provider starts the job and marks it ready for review
 *     → customer approves, which releases the payout
 *
 * Every step asserts on the response, so a break names the step it broke at instead of
 * surfacing later as a wrong number. Nothing here is mocked: it talks to the real
 * controllers and to Stripe in test mode.
 *
 *   node scripts/e2e-job-flow.js
 *
 * Requires the API running on $API (default http://localhost:5001) and a Stripe *test*
 * secret key — it refuses to run against a live key.
 */
require('../config/env'); // backend/.env.development (production: .env.production)

const API = process.env.API || 'http://localhost:5001';
const stamp = Date.now();

let step = 0;
const log = (msg) => console.log(`  ${msg}`);
const head = (msg) => console.log(`\n[${++step}] ${msg}`);

function fail(what, detail) {
  console.error(`\n  ✗ FAILED at step ${step}: ${what}`);
  if (detail !== undefined)
    console.error('    ', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

async function api(method, path, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }

  if (!expect.includes(res.status)) {
    fail(`${method} ${path} → ${res.status} (expected ${expect.join('/')})`, json);
  }
  return json;
}

async function register(role, label) {
  const email = `e2e.${role}.${stamp}@jobblo.test`;
  const password = 'E2ePassord!2024';
  const body = {
    name: `E2E ${label}`,
    lastName: 'Test',
    email,
    password,
    confirmPassword: password,
    role: 'user',
    acceptedTerms: true, // register refuses without it (authHelpers.validateRegistration)
  };

  const out = await api('POST', '/api/auth/register', { body, expect: [200, 201] });
  const token = out.token || out.accessToken || out.data?.token;
  const id = out.user?._id || out.data?.user?._id || out._id;
  if (!token) fail(`register ${label}: no token in response`, out);
  log(`${label.padEnd(8)} ${email}  id=${id}`);
  return { token, id, email, password };
}

(async () => {
  console.log(`\nSafePay end-to-end — ${API}\n${'─'.repeat(60)}`);

  // ── Guard: never run this against live Stripe keys ────────────────────────────
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) fail('preflight', 'STRIPE_SECRET_KEY is not set');
  if (!key.startsWith('sk_test_')) {
    fail('preflight', 'STRIPE_SECRET_KEY is not a test key — refusing to charge a live account');
  }
  const stripe = require('stripe')(key);

  head('Register both parties');
  const customer = await register('customer', 'customer');
  const provider = await register('provider', 'provider');

  head('Give the provider a payouts-enabled Connect account');
  // Applying needs a ready Connect account (STRIPE_CONNECT_REQUIRED), and the payout at the end
  // needs it to move money. A test-mode Custom account is enabled on creation. This script only
  // runs on a test key, so the account goes in the test-mode field the readiness check reads.
  const connect = await stripe.accounts.create({
    type: 'custom',
    country: 'NO',
    email: provider.email,
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    individual: {
      first_name: 'E2E',
      last_name: 'Provider',
      dob: { day: 1, month: 1, year: 1990 },
      address: { line1: 'address_full_match', city: 'Oslo', postal_code: '0150', country: 'NO' },
      email: provider.email,
      phone: '+4721234567',
    },
    business_profile: { mcc: '1520', url: 'https://jobblo.no' },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
    external_account: {
      object: 'bank_account',
      country: 'NO',
      currency: 'nok',
      account_number: 'NO9386011117947',
    },
  });
  if (!connect.payouts_enabled)
    fail('test Connect account is not payouts-enabled', connect.requirements);

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await require('../models/User').findByIdAndUpdate(provider.id, {
    stripeConnectAccountIdTest: connect.id,
    payoutEnabled: true,
    chargesEnabled: true,
    detailsSubmitted: true,
  });
  log(`connect=${connect.id} payouts_enabled=${connect.payouts_enabled}`);

  head('Customer posts a job');
  const service = await api('POST', '/api/services', {
    token: customer.token,
    body: {
      title: `E2E oppdrag ${stamp}`,
      description: 'Automated end-to-end test of the SafePay money path.',
      price: 2500,
      categories: ['Maling'],
      location: {
        type: 'Point',
        coordinates: [10.7461, 59.9127],
        address: 'Testveien 1',
        city: 'Oslo',
      },
      duration: { value: 2, unit: 'hours' },
      equipment: 'utstyrfri',
      tags: [],
    },
  });
  const serviceId = service._id || service.data?._id || service.service?._id;
  if (!serviceId) fail('create service: no _id in response', service);
  log(`serviceId=${serviceId}  price=2500`);

  head('Provider applies');
  const request = await api('POST', '/api/orders/request', {
    token: provider.token,
    body: { serviceId, message: 'Jeg kan ta dette oppdraget.' },
  });
  const requestId = request._id || request.data?._id || request.request?._id;
  log(`requestId=${requestId}`);

  head('Customer awards it — creates the SafePay contract');
  const contract = await api('POST', '/api/safepay/create-contract', {
    token: customer.token,
    body: { serviceId, applicantId: provider.id, requestId },
  });
  const orderId = contract.order?._id || contract._id || contract.orderId;
  if (!orderId) fail('create-contract: no order id', contract);
  log(`orderId=${orderId}`);

  head('Checkout details reflect the 3 % fee');
  const details = await api('GET', `/api/safepay-checkout/details/${orderId}`, {
    token: customer.token,
  });
  const calc = details.calculation || {};
  log(
    `base=${calc.basePrice}  fee=${calc.fee}  total=${calc.total}  providerNet=${calc.providerNet}`
  );
  if (calc.fee !== Math.round(calc.basePrice * 0.03)) fail('fee is not 3 % of base', calc);
  if (calc.total !== calc.basePrice + calc.fee) fail('total != base + fee', calc);
  if (calc.providerNet !== calc.basePrice - calc.fee) fail('providerNet != base - fee', calc);

  head('Create the Stripe Checkout session  ← the endpoint returning 500 in production');
  const session = await api('POST', '/api/safepay-checkout/create-session', {
    token: customer.token,
    body: { orderId },
  });
  if (!session.url) fail('create-session returned no url', session);
  log(`checkout url ok (${session.url.slice(0, 48)}…)`);

  head('Customer can read their own order');
  // Regression guard: `getOrderById` populates the party refs before authorising, so a
  // `.toString()` on the populated document never matched the user id and BOTH parties
  // got 403 on every order.
  const order = await api('GET', `/api/orders/${orderId}`, { token: customer.token });
  const sessionId = order.checkoutSessionId;
  if (!sessionId) fail('order has no checkoutSessionId after create-session', order);
  log(`checkoutSessionId=${sessionId}`);

  head('A forged "paid" event is refused (signed, but Stripe says the session is unpaid)');
  // A Checkout Session cannot be completed over the API, and the webhook no longer trusts the
  // event body: it re-reads the session from Stripe before marking anything paid. So a
  // correctly signed but made-up "completed" event must leave the order unpaid.
  const webhookSecretVar = process.env.STRIPE_TEST_WEBHOOK_SECRET
    ? 'STRIPE_TEST_WEBHOOK_SECRET'
    : 'STRIPE_WEBHOOK_SECRET';
  const webhookSecret = process.env[webhookSecretVar];
  if (!webhookSecret)
    fail(
      'Neither STRIPE_TEST_WEBHOOK_SECRET nor STRIPE_WEBHOOK_SECRET is set',
      'Use the secret the server verifies with (for `stripe listen`, the one it prints).'
    );
  const forged = JSON.stringify({
    id: `evt_e2e_forged_${stamp}`,
    object: 'event',
    livemode: false, // the webhook refuses an event whose mode differs from its signing secret's
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        status: 'complete',
        payment_status: 'paid',
        metadata: {
          orderId: String(orderId),
          userId: String(customer.id),
          type: 'safepay_payment',
        },
      },
    },
  });
  const forgedRes = await fetch(`${API}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({
        payload: forged,
        secret: webhookSecret,
      }),
    },
    body: forged,
  });
  if (forgedRes.status !== 200)
    fail(
      `forged webhook → ${forgedRes.status} (signed with ${webhookSecretVar})`,
      await forgedRes.text()
    );
  const afterForged = await api('GET', `/api/orders/${orderId}`, { token: customer.token });
  if (afterForged.paymentStatus === 'paid' || afterForged.status !== 'awaiting_payment')
    fail('a forged event marked the order paid', afterForged);
  log(`refused: order still ${afterForged.status}/${afterForged.paymentStatus}`);

  head('Pay the Checkout session in a browser with a test card');
  // Needs Playwright (frontend/node_modules) and `stripe listen --forward-to <API>/api/stripe/webhook`
  // running with the same signing secret, so Stripe's real checkout.session.completed arrives.
  const { chromium } = require(
    require.resolve('@playwright/test', {
      paths: [require('path').join(__dirname, '../../frontend')],
    })
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const fillIf = async (sel, value) => {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) await el.fill(value);
    };
    await fillIf('#email', customer.email);
    const cardTab = page.locator('[data-testid="card-accordion-item-button"]').first();
    if (await cardTab.isVisible({ timeout: 3000 }).catch(() => false)) await cardTab.click();
    await page.locator('#cardNumber').fill('4242424242424242', { timeout: 30_000 });
    await page.locator('#cardExpiry').fill('12 / 34');
    await page.locator('#cardCvc').fill('123');
    await fillIf('#billingName', 'E2E Customer');
    await fillIf('#billingPostalCode', '0150');
    await page
      .locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]')
      .first()
      .click();
    // Ask Stripe rather than waiting for the redirect: the success URL is the web app, which
    // does not have to be running for this script.
    let cs;
    for (let i = 0; i < 30; i++) {
      cs = await stripe.checkout.sessions.retrieve(sessionId);
      if (cs.payment_status === 'paid') break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (cs.payment_status !== 'paid') {
      const shot = require('path').join(require('os').tmpdir(), `e2e-checkout-${stamp}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      fail(
        `Checkout session not paid at Stripe (status ${cs.status}/${cs.payment_status})`,
        `screenshot: ${shot}`
      );
    }
    log(`paid with 4242 4242 4242 4242 — Stripe: session ${cs.status}/${cs.payment_status}`);
  } finally {
    await browser.close();
  }

  head('Stripe tells us it is paid (real webhook — the production confirmation path)');
  let paid;
  for (let i = 0; i < 40; i++) {
    paid = await api('GET', `/api/orders/${orderId}`, { token: customer.token });
    if (['paid', 'in_progress'].includes(paid.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log(`status=${paid.status}  paymentStatus=${paid.paymentStatus}`);
  if (!['paid', 'in_progress'].includes(paid.status)) {
    fail(
      'order did not reach paid within 2 minutes of paying',
      'Is `stripe listen --forward-to ' +
        API +
        '/api/stripe/webhook` running, and does the server use the secret it printed?'
    );
  }

  head('Provider starts the job');
  await api('POST', `/api/safepay/orders/${orderId}/start`, { token: provider.token });

  head('Provider marks it ready for review');
  await api('POST', `/api/safepay/orders/${orderId}/ready-for-review`, { token: provider.token });

  head('Customer approves — releases the payout');
  const approved = await api('POST', '/api/safepay-checkout/approve', {
    token: customer.token,
    body: {
      orderId,
      ratings: { overall: 5, punctuality: 5, quality: 5, communication: 5, tidiness: 5 },
      comment: 'Automated end-to-end approval.',
      recommendWorker: true,
    },
  });
  log(JSON.stringify(approved).slice(0, 300));

  head('Final state — and did the money actually move?');
  const final = await api('GET', `/api/orders/${orderId}`, { token: customer.token });
  log(`status=${final.status}  paymentStatus=${final.paymentStatus}`);

  if (approved.payoutWarning) {
    log(`payout warning: ${approved.payoutWarning}`);
    fail('the payout did not go through', approved.payoutErrorCode);
  }

  const payout = await require('../models/Payout').findOne({ orderId });
  if (!payout) fail('no Payout record was written', null);
  log(
    `payout status=${payout.status}  net=${payout.netProviderAmount} kr  transfer=${payout.stripeTransferId}`
  );
  if (payout.status !== 'transferred') fail('payout never reached "transferred"', payout.status);

  const transfer = await stripe.transfers.retrieve(payout.stripeTransferId);
  log(
    `stripe transfer ${transfer.id}: ${transfer.amount / 100} ${transfer.currency} → ${transfer.destination}`
  );
  if (transfer.amount !== calc.providerNet * 100) {
    fail('transferred amount != providerNet', {
      transferred: transfer.amount / 100,
      expected: calc.providerNet,
    });
  }

  console.log(`\n${'─'.repeat(60)}\nWalked every step without an unexpected status.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\n  ✗ UNCAUGHT:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
