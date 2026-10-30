/**
 * "Hast" (39 kr): the job is marked urgent only from a Stripe session that matches its
 * purchase, only once, and only the job's owner can start a checkout.
 */
const mongoose = require('mongoose');
const Service = require('../models/Service');
const urgent = require('../services/urgentPurchase');
const { handleEvent } = require('../services/stripe/webhookDispatcher');

const id = () => new mongoose.Types.ObjectId();
const userId = id();
const serviceId = id();
const purchaseId = id();

const purchase = (over = {}) => ({
  _id: purchaseId,
  userId,
  serviceId,
  checkoutSessionId: 'cs_test_abc',
  amountMinor: 3900,
  currency: 'nok',
  stripeMode: 'test',
  status: 'pending',
  ...over,
});
const session = (over = {}) => ({
  id: 'cs_test_abc',
  mode: 'payment',
  amount_total: 3900,
  currency: 'nok',
  livemode: false,
  payment_status: 'paid',
  payment_intent: 'pi_1',
  metadata: {
    type: 'urgent',
    purchaseId: String(purchaseId),
    userId: String(userId),
    serviceId: String(serviceId),
  },
  ...over,
});
const fakeModel = (doc, updated = { ...doc, status: 'paid' }) => ({
  findById: () => ({ lean: async () => doc }),
  findOneAndUpdate: jest.fn(async () => updated),
});
const fakeService = () => ({ updateOne: jest.fn(async () => ({})) });
// The admin's Transactions collection.
const fakeTx = () => ({ updateOne: jest.fn(async () => ({})) });

describe('confirmUrgentSession', () => {
  test('a matching paid session marks the purchase paid and the job urgent', async () => {
    const Model = fakeModel(purchase());
    const Svc = fakeService();
    const Tx = fakeTx();
    expect(await urgent.confirmUrgentSession(session(), Model, Svc, Tx)).toEqual({
      handled: 'urgent_paid',
    });
    // «Haster» for the configured duration (default 3 days).
    const [where, set] = Svc.updateOne.mock.calls[0];
    expect(where).toEqual({ _id: serviceId });
    expect(set.$set.urgent).toBe(true);
    const ms = set.$set.urgentUntil - Date.now();
    expect(ms).toBeGreaterThan(urgent.urgentDurationMs() - 5000);
    expect(ms).toBeLessThanOrEqual(urgent.urgentDurationMs());
    // …and it shows on the admin's Transactions page: one row per Stripe session (upsert).
    const [filter, update, opts] = Tx.updateOne.mock.calls[0];
    expect(filter).toEqual({ stripeSessionId: 'cs_test_abc' });
    expect(update.$setOnInsert).toMatchObject({
      type: 'urgent',
      planName: 'Hast',
      amount: 39,
      status: 'succeeded',
      serviceId,
    });
    expect(opts).toEqual({ upsert: true });
  });

  test('a second delivery does not touch the job again', async () => {
    const Model = fakeModel(purchase({ status: 'paid' }), null);
    const Svc = fakeService();
    expect((await urgent.confirmUrgentSession(session(), Model, Svc, fakeTx())).handled).toBe(
      'urgent_already_paid'
    );
    expect(Svc.updateOne).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong amount', { amount_total: 100 }],
    ['other session', { id: 'cs_test_other' }],
    ['live vs test', { livemode: true }],
  ])('%s is a mismatch, the job stays as it is', async (_label, over) => {
    const Svc = fakeService();
    expect(
      (await urgent.confirmUrgentSession(session(over), fakeModel(purchase()), Svc, fakeTx()))
        .handled
    ).toBe('urgent_mismatch');
    expect(Svc.updateOne).not.toHaveBeenCalled();
  });

  test('an unpaid session is not urgent', async () => {
    const Svc = fakeService();
    const out = await urgent.confirmUrgentSession(
      session({ payment_status: 'unpaid' }),
      fakeModel(purchase()),
      Svc,
      fakeTx()
    );
    expect(out.handled).toBe('urgent_unpaid');
    expect(Svc.updateOne).not.toHaveBeenCalled();
  });
});

describe('webhook routing', () => {
  test('an urgent session never reaches the SafePay default branch', async () => {
    const spy = jest
      .spyOn(urgent, 'confirmUrgentSession')
      .mockResolvedValue({ handled: 'urgent_paid' });
    const out = await handleEvent({
      type: 'checkout.session.completed',
      data: { object: session() },
    });
    expect(spy).toHaveBeenCalled();
    expect(out).toEqual({ handled: 'urgent_paid' });
    spy.mockRestore();
  });
});

describe('createUrgentCheckout', () => {
  const findJob = (job) =>
    jest.spyOn(Service, 'findById').mockReturnValue({
      select: () => ({ lean: async () => job }),
    });
  afterEach(() => jest.restoreAllMocks());

  test("someone else's job is refused before Stripe is called", async () => {
    findJob({ userId: id(), status: 'open', urgent: false });
    const getStripeConfiguration = jest.fn();
    await expect(
      urgent.createUrgentCheckout({ userId, serviceId }, { getStripeConfiguration })
    ).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });
    expect(getStripeConfiguration).not.toHaveBeenCalled();
  });

  test('a job that is already urgent is not charged twice', async () => {
    findJob({ userId, status: 'open', urgent: true });
    await expect(urgent.createUrgentCheckout({ userId, serviceId })).rejects.toMatchObject({
      code: 'ALREADY_URGENT',
    });
  });

  test('a closed job is refused', async () => {
    findJob({ userId, status: 'completed', urgent: false });
    await expect(urgent.createUrgentCheckout({ userId, serviceId })).rejects.toMatchObject({
      code: 'SERVICE_CLOSED',
    });
  });
});

describe('prepaid Hast (web: pay on "Nesten ferdig", then publish)', () => {
  test('a confirmed prepaid payment touches no job yet', async () => {
    const Model = fakeModel(purchase({ serviceId: null }));
    const Svc = fakeService();
    const prepaid = session({ metadata: { ...session().metadata, serviceId: '' } });
    const Tx = fakeTx();
    expect((await urgent.confirmUrgentSession(prepaid, Model, Svc, Tx)).handled).toBe(
      'urgent_paid'
    );
    expect(Svc.updateOne).not.toHaveBeenCalled();
    // The transaction is there already, with no job yet.
    expect(Tx.updateOne.mock.calls[0][1].$setOnInsert.serviceId).toBeNull();
  });

  test("publishing claims only the user's own paid, unused purchase, and only once", async () => {
    const findOneAndUpdate = jest
      .fn()
      .mockResolvedValueOnce({ _id: purchaseId, checkoutSessionId: 'cs_test_abc' })
      .mockResolvedValueOnce(null);
    const Model = { findOneAndUpdate };
    const Tx = fakeTx();
    const args = { userId, purchaseId: String(purchaseId), serviceId };
    expect(await urgent.consumeUrgentPurchase(args, Model, Tx)).toBe(true);
    // Its transaction now names the published job.
    expect(Tx.updateOne).toHaveBeenCalledWith(
      { stripeSessionId: 'cs_test_abc', serviceId: null },
      { $set: { serviceId } }
    );
    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: String(purchaseId),
      userId,
      status: 'paid',
      serviceId: null,
    });
    expect(await urgent.consumeUrgentPurchase(args, Model, Tx)).toBe(false); // second publish
    expect(await urgent.consumeUrgentPurchase({ ...args, purchaseId: 'nope' }, Model, Tx)).toBe(
      false
    );
  });
});

describe('Hast from the app: the HTTPS bridge back into the app', () => {
  const safePay = require('../controllers/SafePayCheckoutController');
  const page = () => ({
    headers: {},
    set(h, v) {
      Object.assign(this.headers, typeof h === 'string' ? { [h]: v } : h);
      return this;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  });

  test('Stripe returns to the bridge, which opens "Legg ut" in the app', () => {
    process.env.MOBILE_RETURN_URL = 'https://api.jobblo.test';
    const urls = safePay.hastMobileReturnUrls({});
    delete process.env.MOBILE_RETURN_URL;
    expect(urls.success).toBe(
      'https://api.jobblo.test/api/safepay-checkout/mobile-return?state=hast&session_id={CHECKOUT_SESSION_ID}'
    );
    for (const state of ['hast', 'hast-cancel']) {
      const res = page();
      safePay.mobileReturn({ query: { state } }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('href="jobblo://create-job"');
    }
  });
});

describe('pressing "Betal" again', () => {
  const User = require('../models/User');
  afterEach(() => jest.restoreAllMocks());

  // A Model whose findOne answers by query: a paid unused purchase, or an open one.
  const modelWith = ({ paid = null, pending = null } = {}) => ({
    findOne: jest.fn((q) => {
      const doc = q.status === 'paid' ? paid : q.status === 'pending' ? pending : null;
      const chain = { select: () => chain, lean: async () => doc };
      return chain;
    }),
    updateMany: jest.fn(async () => ({})),
    updateOne: jest.fn(async () => ({})),
    create: jest.fn(),
  });

  test('already paid and not used: no second charge, the payment is handed back', async () => {
    const Model = modelWith({ paid: { _id: purchaseId } });
    const getStripeConfiguration = jest.fn();
    const out = await urgent.createUrgentCheckout({ userId }, { Model, getStripeConfiguration });
    expect(out).toEqual({ alreadyPaid: true, purchaseId: String(purchaseId), priceNok: 39 });
    expect(getStripeConfiguration).not.toHaveBeenCalled();
    expect(Model.create).not.toHaveBeenCalled();
  });

  test('a Checkout closed without paying opens again instead of a 409', async () => {
    jest.spyOn(User, 'findById').mockResolvedValue({ _id: userId });
    const Model = modelWith({
      pending: { _id: purchaseId, serviceId: null, checkoutSessionId: 'cs_test_open' },
    });
    const stripe = {
      checkout: {
        sessions: {
          retrieve: jest.fn(async () => ({
            id: 'cs_test_open',
            status: 'open',
            url: 'https://checkout.stripe.test/open',
            success_url: 'http://localhost:5173/Publish-job?hast=paid&session_id=cs_test_open',
          })),
          create: jest.fn(),
        },
      },
    };
    const out = await urgent.createUrgentCheckout(
      { userId },
      {
        Model,
        getStripeConfiguration: async () => ({ keyModeValid: true, testMode: true, mode: 'test' }),
        getStripeForMode: async () => stripe,
        resolveStripeCustomer: async () => 'cus_1',
      }
    );
    expect(out).toEqual({
      url: 'https://checkout.stripe.test/open',
      sessionId: 'cs_test_open',
      priceNok: 39,
    });
    expect(Model.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('Hast runs out after 7 days', () => {
  const Service = require('../models/Service');
  const { expireUrgentMarks } = require('../services/scheduler/jobs');
  afterEach(() => jest.restoreAllMocks());

  test('the hourly sweep clears only marks whose time has passed', async () => {
    const updateMany = jest.spyOn(Service, 'updateMany').mockResolvedValue({ modifiedCount: 2 });
    const now = new Date('2026-11-06T12:00:00Z');
    expect(await expireUrgentMarks(now)).toEqual({ expired: 2 });
    expect(updateMany).toHaveBeenCalledWith(
      { urgent: true, urgentUntil: { $lte: now } },
      { $set: { urgent: false } }
    );
  });

  test('the duration comes from HAST_DURATION_MINUTES; unset or invalid means 3 days', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    const saved = process.env.HAST_DURATION_MINUTES;
    try {
      delete process.env.HAST_DURATION_MINUTES;
      expect(urgent.urgentMark(now).urgentUntil).toEqual(new Date('2026-11-02T10:00:00Z'));
      process.env.HAST_DURATION_MINUTES = '3'; // the local test setting
      expect(urgent.urgentMark(now)).toEqual({
        urgent: true,
        urgentUntil: new Date('2026-10-30T10:03:00Z'),
      });
      process.env.HAST_DURATION_MINUTES = 'abc';
      expect(urgent.urgentDurationMs()).toBe(3 * 24 * 3600 * 1000);
    } finally {
      if (saved === undefined) delete process.env.HAST_DURATION_MINUTES;
      else process.env.HAST_DURATION_MINUTES = saved;
    }
  });
});

describe('Hast paid but never published: refunded', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const paidUnused = {
    _id: purchaseId,
    status: 'refunding',
    stripeMode: 'test',
    paymentIntentId: 'pi_1',
    checkoutSessionId: 'cs_test_abc',
  };
  // find → the due ids; findOneAndUpdate → the claim (null = published or refunded meanwhile).
  const model = (claim) => {
    const find = jest.fn(() => ({
      select: () => ({ limit: () => ({ lean: async () => [{ _id: purchaseId }] }) }),
    }));
    return {
      find,
      findOneAndUpdate: jest.fn(async () => claim),
      updateOne: jest.fn(async () => ({})),
    };
  };
  const stripeWith = (create) => async () => ({ refunds: { create } });

  test('claims it, refunds once on Stripe, and marks the purchase and transaction refunded', async () => {
    const Model = model(paidUnused);
    const Tx = fakeTx();
    const create = jest.fn(async () => ({ id: 're_1' }));
    const out = await urgent.refundUnusedPurchases(
      { now },
      { Model, TransactionModel: Tx, stripeFor: stripeWith(create) }
    );
    expect(out).toEqual({ refunded: 1 });
    // Only paid, unused, and older than HAST_DURATION_MINUTES (default 3 days).
    expect(Model.find.mock.calls[0][0]).toEqual({
      status: 'paid',
      serviceId: null,
      paidAt: { $lte: new Date(now.getTime() - urgent.unusedRefundMs()) },
    });
    // Claimed first, so publishing can no longer use it.
    expect(Model.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { status: 'refunding' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_1' }), {
      idempotencyKey: `jobblo-urgent-refund:${purchaseId}`,
    });
    expect(Model.updateOne.mock.calls[0][1].$set).toMatchObject({
      status: 'refunded',
      refundId: 're_1',
    });
    expect(Tx.updateOne).toHaveBeenCalledWith(
      { stripeSessionId: 'cs_test_abc' },
      {
        $set: {
          status: 'refunded',
          refunded: true,
          refundedAt: now,
          refundReason: 'Oppdraget ble ikke publisert, så Hast ble ikke brukt.',
        },
      }
    );
  });

  test('published meanwhile: nothing is refunded', async () => {
    const create = jest.fn();
    const out = await urgent.refundUnusedPurchases(
      { now },
      { Model: model(null), TransactionModel: fakeTx(), stripeFor: stripeWith(create) }
    );
    expect(out).toEqual({ refunded: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  test('Stripe fails: back to paid, so the next run tries again', async () => {
    const Model = model(paidUnused);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const create = jest.fn(async () => {
      throw Object.assign(new Error('down'), { type: 'StripeConnectionError' });
    });
    const out = await urgent.refundUnusedPurchases(
      { now },
      { Model, TransactionModel: fakeTx(), stripeFor: stripeWith(create) }
    );
    expect(out).toEqual({ refunded: 0 });
    expect(Model.updateOne).toHaveBeenCalledWith(
      { _id: purchaseId, status: 'refunding' },
      { $set: { status: 'paid' } }
    );
    console.error.mockRestore();
  });
});
