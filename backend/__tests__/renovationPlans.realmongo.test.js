/**
 * Saved and shared renovation plans against a REAL MongoDB (owner scoping, the share link,
 * the per-user cap). Opt-in:
 *   SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-renovation-test npx jest renovationPlans
 * The database name must end in "-test"; it is dropped afterwards.
 */
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!req.headers['x-user']) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { _id: req.headers['x-user'] };
    req.userId = req.headers['x-user'];
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const RenovationPlan = require('../models/RenovationPlan');

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run =
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri)
    ? describe
    : describe.skip;

const app = express();
app.use(express.json());
app.use('/api/renovation', require('../routes/renovation'));

const KARI = new mongoose.Types.ObjectId().toString();
const OLA = new mongoose.Types.ObjectId().toString();
const as = (user) => ({ 'x-user': user });

const BODY = {
  title: 'Leiligheten på Grünerløkka',
  facts: { sizeM2: 75, rooms: 3, bathrooms: 1, yearBuilt: 1978, homeType: 'leilighet' },
  quality: 'standard',
  areas: [{ key: 'kitchen', scope: 'full' }],
  budget: 200000,
  notes: [{ area: 'kitchen', text: 'Originalt kjøkken fra 1985' }],
  finnCode: 'https://www.finn.no/realestate/homes/ad.html?finnkode=412345678',
};

run('renovation plans (real MongoDB)', () => {
  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-renovation-plans' });
    await RenovationPlan.init(); // the unique shareId index
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  beforeEach(() => RenovationPlan.deleteMany({}));

  const create = (user = KARI, body = BODY) =>
    request(app).post('/api/renovation/plans').set(as(user)).send(body);

  it('saves the normalised plan with a fresh estimate, and lists it', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.plan).toMatchObject({
      title: BODY.title,
      yearBuilt: 1978,
      homeType: 'leilighet',
      finnCode: '412345678',
      shareId: null,
      notes: BODY.notes,
    });
    expect(res.body.plan.estimate.total.low).toBeGreaterThan(0);

    const list = await request(app).get('/api/renovation/plans').set(as(KARI));
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0].total.low).toBe(res.body.plan.estimate.total.low);
  });

  it('needs a login, and keeps plans private to their owner', async () => {
    expect((await request(app).post('/api/renovation/plans').send(BODY)).status).toBe(401);
    const { body } = await create();
    const id = body.plan._id;
    expect((await request(app).get(`/api/renovation/plans/${id}`).set(as(OLA))).status).toBe(404);
    expect(
      (await request(app).put(`/api/renovation/plans/${id}`).set(as(OLA)).send(BODY)).status
    ).toBe(404);
    expect((await request(app).delete(`/api/renovation/plans/${id}`).set(as(OLA))).status).toBe(
      404
    );
    expect((await request(app).post(`/api/renovation/plans/${id}/share`).set(as(OLA))).status).toBe(
      404
    );
    expect((await request(app).get('/api/renovation/plans').set(as(OLA))).body.plans).toEqual([]);
    expect((await request(app).get('/api/renovation/plans/not-an-id').set(as(KARI))).status).toBe(
      404
    );
  });

  it('drops an unknown home type instead of storing it', async () => {
    const res = await create(KARI, { ...BODY, facts: { ...BODY.facts, homeType: 'slott' } });
    expect(res.status).toBe(201);
    expect(res.body.plan.homeType).toBeNull();
  });

  it('rejects an invalid plan and never stores client fields it does not know', async () => {
    expect((await create(KARI, { ...BODY, areas: [{ key: 'pool', scope: 'full' }] })).status).toBe(
      400
    );
    const res = await create(KARI, { ...BODY, user: OLA, shareId: 'aaaaaaaaaaaaaaaa', $where: 1 });
    expect(res.status).toBe(201);
    const stored = await RenovationPlan.findById(res.body.plan._id).lean();
    expect(String(stored.user)).toBe(KARI);
    expect(stored.shareId).toBeUndefined();
  });

  it('updates in place', async () => {
    const { body } = await create();
    const res = await request(app)
      .put(`/api/renovation/plans/${body.plan._id}`)
      .set(as(KARI))
      .send({
        ...BODY,
        title: 'Ny tittel',
        finnCode: '',
        areas: [{ key: 'hallway', scope: 'surface' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ title: 'Ny tittel', finnCode: null });
    expect(res.body.plan.plan.areas).toEqual([
      { key: 'hallway', scope: 'surface', quality: 'standard' },
    ]);
  });

  it('shares with a stable link, shows it without the owner, and stops sharing', async () => {
    const { body } = await create();
    const id = body.plan._id;
    const first = await request(app).post(`/api/renovation/plans/${id}/share`).set(as(KARI));
    const again = await request(app).post(`/api/renovation/plans/${id}/share`).set(as(KARI));
    expect(first.body.shareId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(again.body.shareId).toBe(first.body.shareId);

    const shared = await request(app).get(`/api/renovation/shared/${first.body.shareId}`);
    expect(shared.status).toBe(200);
    expect(shared.body.plan.title).toBe(BODY.title);
    expect(shared.body.plan.estimate.areas[0].key).toBe('kitchen');
    expect(shared.body.plan).not.toHaveProperty('_id');
    expect(shared.body.plan).not.toHaveProperty('shareId');
    expect(JSON.stringify(shared.body)).not.toContain(KARI);

    await request(app).delete(`/api/renovation/plans/${id}/share`).set(as(KARI));
    expect((await request(app).get(`/api/renovation/shared/${first.body.shareId}`)).status).toBe(
      404
    );
    expect((await request(app).get('/api/renovation/shared/x')).status).toBe(404);
  });

  it('a plan whose area left the config still loads, without an estimate', async () => {
    const { body } = await create();
    await RenovationPlan.updateOne(
      { _id: body.plan._id },
      { $set: { 'plan.areas': [{ key: 'sauna', scope: 'full', quality: 'standard' }] } }
    );
    const res = await request(app).get(`/api/renovation/plans/${body.plan._id}`).set(as(KARI));
    expect(res.status).toBe(200);
    expect(res.body.plan.estimate).toBeNull();
    const list = await request(app).get('/api/renovation/plans').set(as(KARI));
    expect(list.body.plans[0].total).toBeNull();
  });

  it('caps plans per user', async () => {
    await RenovationPlan.insertMany(
      Array.from({ length: 20 }, () => ({ user: KARI, plan: { quality: 'standard', areas: [] } }))
    );
    expect((await create()).status).toBe(409);
    expect((await create(OLA)).status).toBe(201);
  });

  it('deletes', async () => {
    const { body } = await create();
    expect(
      (await request(app).delete(`/api/renovation/plans/${body.plan._id}`).set(as(KARI))).status
    ).toBe(200);
    expect(await RenovationPlan.countDocuments()).toBe(0);
  });
});
