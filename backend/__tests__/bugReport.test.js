// "Rapporter en feil" (web and app): a bug ticket keeps the page it was sent from, the
// screenshots (uploaded by the route's multer step), the device and the error reference.
jest.mock('../models/SupportTicket', () => ({
  create: jest.fn(async (doc) => ({ _id: 't1', ...doc })),
}));
jest.mock('../models/User', () => ({
  findById: () => ({ select: () => ({ lean: async () => ({ email: 'me@example.test' }) }) }),
}));
const SupportTicket = require('../models/SupportTicket');
const { createTicket } = require('../controllers/supportController');

const call = async (body, extra = {}) => {
  const res = { statusCode: 200 };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  await createTicket({ body, userId: 'u1', get: () => 'Mozilla/5.0 test', ...extra }, res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('a bug report keeps page, screenshots, device and error reference', async () => {
  const res = await call(
    {
      kind: 'bug',
      message: 'Knappen gjør ingenting',
      pageUrl: 'https://jobblo.no/job-listing/123?x=1',
      platform: 'web',
      screen: '1280x800',
      errorRef: 'ERR-ABC123',
    },
    { files: [{ path: 'https://blob/private/bug_reports/a.png' }] }
  );
  expect(res.statusCode).toBe(201);
  const doc = SupportTicket.create.mock.calls[0][0];
  expect(doc).toMatchObject({
    kind: 'bug',
    subject: 'Feilrapport: /job-listing/123?x=1',
    pageUrl: 'https://jobblo.no/job-listing/123?x=1',
    screenshots: ['https://blob/private/bug_reports/a.png'],
    client: { platform: 'web', screen: '1280x800', userAgent: 'Mozilla/5.0 test' },
    relatedErrorRef: 'ERR-ABC123',
    email: 'me@example.test',
  });
});

test('an app route is a page; a script URL or an unknown platform is dropped', async () => {
  await call({ kind: 'bug', message: 'Krasj', pageUrl: '/jobs/123', platform: 'android' });
  expect(SupportTicket.create.mock.calls[0][0]).toMatchObject({
    pageUrl: '/jobs/123',
    subject: 'Feilrapport: /jobs/123',
    client: { platform: 'android' },
  });
  await call({ kind: 'bug', message: 'x', pageUrl: 'javascript:alert(1)', platform: 'evil' });
  const doc = SupportTicket.create.mock.calls[1][0];
  expect(doc.pageUrl).toBeNull();
  expect(doc.client.platform).toBeUndefined();
});

test('a plain support ticket is unchanged (subject still required)', async () => {
  expect((await call({ message: 'Hei' })).statusCode).toBe(400);
  await call({ subject: 'Betaling', message: 'Hei' });
  expect(SupportTicket.create.mock.calls[0][0].kind).toBeUndefined();
});
