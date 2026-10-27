// Query-string input that used to 500 or fan out: lone-backslash regex after slicing an
// escaped string, repeated keys (arrays) hitting .split/.replace, raw $regex from admins,
// uncapped location tokens on /users/top, and an unescaped name in the OTP email.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../services/monitoring/searchHealth', () => ({ recordSearch: jest.fn() }));
const chain = (result) => {
  const q = {};
  for (const m of ['populate', 'lean', 'skip', 'limit', 'sort', 'select']) q[m] = jest.fn(() => q);
  q.then = (ok, ko) => Promise.resolve(result).then(ok, ko);
  return q;
};
jest.mock('../models/Service', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/User', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/ErrorLog', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/NorwayMunicipality', () => ({ find: jest.fn() }));

const Service = require('../models/Service');
const User = require('../models/User');
const ErrorLog = require('../models/ErrorLog');
const NorwayMunicipality = require('../models/NorwayMunicipality');
const nodemailer = require('nodemailer');
const { queryString } = require('../utils/devQuery');

const mkRes = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const M of [Service, User, ErrorLog]) {
    M.find.mockImplementation(() => chain([]));
    M.countDocuments.mockResolvedValue(0);
  }
  NorwayMunicipality.find.mockImplementation(() => chain([]));
});

test('queryString keeps strings, drops arrays/objects', () => {
  expect(queryString('a')).toBe('a');
  expect(queryString(['a', 'b'])).toBe('');
  expect(queryString({ $ne: 1 })).toBe('');
});

test('browse: 200-char search ending in a special char compiles; repeated region keys do not 500', async () => {
  const { getAllServices } = require('../controllers/services/browseController');
  const res = mkRes();
  await getAllServices(
    {
      query: {
        search: `${'a'.repeat(199)}.`,
        countyCodes: ['01', '02'],
        municipalityCodes: ['x', 'y'],
        areaCodes: ['z', 'w'],
      },
    },
    res
  );
  expect(res.status).not.toHaveBeenCalledWith(500);
  const pattern = Service.find.mock.calls[0][0].$and[0].$or[0].title.$regex;
  expect(() => new RegExp(pattern)).not.toThrow();
});

test('admin user search with a repeated ?search key does not 500', async () => {
  const { getUsers } = require('../controllers/admin/usersAdminController');
  const res = mkRes();
  await getUsers({ query: { search: ['a', 'b'] } }, res, jest.fn());
  expect(res.status).not.toHaveBeenCalledWith(500);
});

test('admin error log ?route is matched literally', async () => {
  const { getSystemErrors } = require('../controllers/admin/systemAdminController');
  await getSystemErrors({ query: { route: '(a+)+$' } }, mkRes(), jest.fn());
  expect(ErrorLog.find.mock.calls[0][0].route.$regex).toBe('\\(a\\+\\)\\+\\$');
});

test('/users/top caps location tokens and limits each tier query', async () => {
  const { getTopUsers } = require('../controllers/users/searchController');
  const address = Array.from({ length: 40 }, (_, i) => `token${i}x`).join(' ');
  await getTopUsers({ query: { address, postNumber: '0150' }, userId: 'me' }, mkRes());
  const nearby = User.find.mock.calls.find(([f]) => f.$or)[0];
  expect(nearby.$or.length).toBeLessThanOrEqual(10);
  for (const r of User.find.mock.results.slice(0, 3)) expect(r.value.limit).toHaveBeenCalled();
});

test('OTP email escapes the recipient name', async () => {
  const sendMail = jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({ sendMail });
  const { deliverOtpEmail } = require('../utils/emailService');
  await deliverOtpEmail('a@b.test', '123456', '<img src=x onerror=alert(1)>');
  expect(sendMail.mock.calls[0][0].html).toContain('&lt;img src=x');
  expect(sendMail.mock.calls[0][0].html).not.toContain('<img src=x');
});
