/**
 * "Add photos" reminder (scheduler remindJobsWithoutPhotos) against a REAL MongoDB: only open
 * jobs without photos, 24–48 h old, and once per job even when it runs twice. Opt-in:
 *   SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-photo-reminder-test npx jest jobPhotoReminder
 * The database name must end in "-test"; it is dropped afterwards.
 */
jest.mock('../services/notifications', () => ({ notify: jest.fn().mockResolvedValue({}) }));

const mongoose = require('mongoose');
const { notify } = require('../services/notifications');
const Service = require('../models/Service');
const { remindJobsWithoutPhotos } = require('../services/scheduler/jobs');

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run =
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri)
    ? describe
    : describe.skip;

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-23T12:00:00.000Z');
const OWNER = new mongoose.Types.ObjectId();

/** A job, inserted raw so createdAt can be set in the past. */
const job = async (title, hoursOld, extra = {}) => {
  const createdAt = new Date(NOW - hoursOld * HOUR);
  const { insertedId } = await Service.collection.insertOne({
    title,
    description: 'Testoppdrag',
    price: 1000,
    userId: OWNER,
    status: 'open',
    images: [],
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });
  return insertedId;
};

run('remindJobsWithoutPhotos (real MongoDB)', () => {
  beforeAll(() => mongoose.connect(uri, { dbName: 'jobblo-test-photo-reminder' }));
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await Service.deleteMany({});
  });

  it('reminds only open jobs without photos posted 24-48 h ago, once', async () => {
    const due = await job('Klippe hekk', 30);
    await job('For ny', 10);
    await job('For gammel', 60);
    await job('Har bilde', 30, { images: ['https://img.example.test/a.jpg'] });
    await job('Lukket', 30, { status: 'closed' });
    const noField = await job('Uten images-felt', 30);
    await Service.collection.updateOne({ _id: noField }, { $unset: { images: 1 } });

    expect(await remindJobsWithoutPhotos(NOW)).toEqual({ reminded: 2 });
    const reminded = notify.mock.calls.map(([input]) => String(input.serviceId)).sort();
    expect(reminded).toEqual([String(due), String(noField)].sort());

    const [input] = notify.mock.calls[0];
    expect(input).toMatchObject({
      userId: OWNER,
      type: 'job_update',
      title: 'Legg til bilder',
      data: { type: 'job_photos' },
    });
    expect(input.content).toMatch(/Oppdrag med bilder får flere og mer presise svar/);

    // A second run (or a second server) sends nothing more.
    expect(await remindJobsWithoutPhotos(NOW)).toEqual({ reminded: 0 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect((await Service.findById(due).lean()).photoReminderSentAt).toEqual(NOW);
  });

  it('two runs at the same time still remind a job once', async () => {
    await job('Samtidig', 30);
    const results = await Promise.all([remindJobsWithoutPhotos(NOW), remindJobsWithoutPhotos(NOW)]);
    expect(results.reduce((n, r) => n + r.reminded, 0)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a photo added before the run means no reminder', async () => {
    const id = await job('Fikk bilde', 30);
    await Service.updateOne({ _id: id }, { $set: { images: ['https://img.example.test/b.jpg'] } });
    expect(await remindJobsWithoutPhotos(NOW)).toEqual({ reminded: 0 });
  });
});
