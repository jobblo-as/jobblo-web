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
    expect(Svc.updateOne).toHaveBeenCalledWith({ _id: serviceId }, { $set: { urgent: true } });
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
