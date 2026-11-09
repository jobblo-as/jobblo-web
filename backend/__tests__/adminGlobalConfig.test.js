/**
 * Admin settings (GlobalConfig): input is checked before it reaches MongoDB, creating never
 * overwrites, saving a value keeps the description, and secrets cannot be stored here.
 */
jest.mock('../models/GlobalConfig', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  exists: jest.fn(),
}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

const GlobalConfig = require('../models/GlobalConfig');
const { logActivity } = require('../services/admin/activityService');
const ctl = require('../controllers/admin/contentAdminController');

beforeEach(() => jest.clearAllMocks());

const response = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn((body) => ((res.body = body), res)),
  };
  return res;
};
const call = async (fn, req) => {
  const res = response();
  await fn({ user: { _id: 'admin_1' }, ip: '127.0.0.1', headers: {}, params: {}, ...req }, res);
  return res;
};

describe('readConfigInput', () => {
  test.each([
    [{ key: { $ne: 'x' }, value: 1 }, /Nøkkelen/], // an operator object never reaches the filter
    [{ key: 'a', value: 1 }, /Nøkkelen/],
    [{ key: 'has space', value: 1 }, /Nøkkelen/],
    [{ key: 'stripe_secret_live', value: 'sk' }, /miljøvariabler/],
    [{ key: 'API_TOKEN', value: 'x' }, /miljøvariabler/],
    [{ key: 'feature_x' }, /Verdi mangler/],
    [{ key: 'feature_x', value: 'x'.repeat(25000) }, /for stor/],
    [{ key: 'feature_x', value: true, description: 5 }, /tekst/],
  ])('%j → refused', (input, message) => {
    expect(ctl.readConfigInput(input).error).toMatch(message);
  });

  test('a good flag passes, description trimmed and capped', () => {
    expect(
      ctl.readConfigInput({
        key: 'feature_new_checkout',
        value: false,
        description: `  ${'d'.repeat(400)} `,
      })
    ).toEqual({ key: 'feature_new_checkout', value: false, description: 'd'.repeat(300) });
  });
});

test('an injection attempt is a 400 and never queries', async () => {
  const res = await call(ctl.updateConfig, { body: { key: { $ne: 'x' }, value: 1 } });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(GlobalConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('"Ny innstilling" refuses an existing key (409) instead of overwriting it', async () => {
  GlobalConfig.exists.mockResolvedValue({ _id: 'c1' });
  const res = await call(ctl.updateConfig, {
    body: { key: 'feature_x', value: true, create: true },
  });
  expect(res.status).toHaveBeenCalledWith(409);
  expect(GlobalConfig.findOneAndUpdate).not.toHaveBeenCalled();
});

test('creating a new key works and is audited as created', async () => {
  GlobalConfig.exists.mockResolvedValue(null);
  GlobalConfig.findOneAndUpdate.mockReturnValue({
    lean: async () => ({ _id: 'c1', key: 'feature_x', value: false }),
  });
  const res = await call(ctl.updateConfig, {
    body: { key: 'feature_x', value: false, description: 'Naya checkout', create: true },
  });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(GlobalConfig.findOneAndUpdate).toHaveBeenCalledWith(
    { key: 'feature_x' },
    { value: false, description: 'Naya checkout' },
    expect.objectContaining({ upsert: true })
  );
  expect(logActivity).toHaveBeenCalledWith(
    expect.objectContaining({ description: 'Created config key: feature_x' })
  );
});

test('saving only a value keeps the stored description', async () => {
  GlobalConfig.findOneAndUpdate.mockReturnValue({
    lean: async () => ({ _id: 'c1', key: 'feature_x', value: true }),
  });
  await call(ctl.updateConfig, { body: { key: 'feature_x', value: true } });
  expect(GlobalConfig.findOneAndUpdate.mock.calls[0][1]).toEqual({ value: true });
});

test('delete refuses a malformed key before querying', async () => {
  const res = await call(ctl.deleteConfig, { params: { key: '$where' } });
  expect(res.status).toHaveBeenCalledWith(400);
  expect(GlobalConfig.findOneAndDelete).not.toHaveBeenCalled();
});

test('the list carries descriptions and hides secret-looking keys', async () => {
  GlobalConfig.find.mockReturnValue({
    lean: async () => [
      { key: 'feature_b', value: true, description: 'B', updatedAt: new Date('2026-11-06') },
      { key: 'SMTP_PASSWORD', value: 'x' },
      { key: 'a_setting', value: 3 },
    ],
  });
  GlobalConfig.findOne.mockReturnValue({
    select: () => ({ lean: async () => null }),
    lean: async () => null,
  });
  const res = await call(ctl.getAllConfigs, {});
  expect(res.body.data.entries.map((e) => e.key)).toEqual(['a_setting', 'feature_b']);
  expect(res.body.data.entries[1]).toMatchObject({ description: 'B' });
  expect(JSON.stringify(res.body)).not.toContain('SMTP_PASSWORD');
});
