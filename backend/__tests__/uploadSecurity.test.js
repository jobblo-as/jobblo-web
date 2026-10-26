/**
 * M3 + M4 (uploads): the stored type comes from the file's bytes, SVG and disguised files are
 * refused, names are server-made, evidence/certifications go to the private container and are
 * served as short-lived SAS links, ownership is checked before anything is uploaded, chat-report
 * and admin evidence really upload, and superAdmins can read SafePay history.
 *
 * The real Azure SDK builds URLs and signs SAS offline; only the network calls are stubbed.
 */
process.env.AZURE_CONTAINER_NAME = 'pub-images';
process.env.AZURE_PRIVATE_CONTAINER = 'private-evidence';
process.env.AZURE_STORAGE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' +
  Buffer.from('test-key-0123456789').toString('base64') +
  ';EndpointSuffix=core.windows.net';

jest.mock('../middleware/auth', () => {
  const as = (req, _res, next) => {
    req.userId = req.get('x-user') || 'u1';
    req.user = { _id: req.userId, role: req.get('x-role') || 'user' };
    next();
  };
  return { authenticate: as, optionalAuthenticate: as, requireAdmin: (_q, _s, n) => n(), requireDeveloper: (_q, _s, n) => n(), requireRole: () => (_q, _s, n) => n() };
});

const express = require('express');
const request = require('supertest');
const multer = require('multer');
const { BlockBlobClient } = require('@azure/storage-blob');
const az = require('../utils/azureUpload');
const { checkFileTypes, IMAGE_TYPES } = require('../middleware/upload');
const { uploadErrors } = require('../middleware/errorHandlers');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010101', 'hex');
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

let uploads;
let deletes;
beforeEach(() => {
  uploads = [];
  deletes = [];
  jest.spyOn(BlockBlobClient.prototype, 'uploadData').mockImplementation(async function (data, opts) {
    uploads.push({ url: this.url, type: opts.blobHTTPHeaders.blobContentType });
  });
  jest.spyOn(BlockBlobClient.prototype, 'deleteIfExists').mockImplementation(async function () {
    deletes.push(this.url);
  });
});
afterEach(() => jest.restoreAllMocks());

describe('type from bytes', () => {
  it('recognises JPEG, PNG, WebP, PDF and nothing else', () => {
    expect(az.sniffFileType(JPEG)).toBe('image/jpeg');
    expect(az.sniffFileType(PNG)).toBe('image/png');
    expect(az.sniffFileType(WEBP)).toBe('image/webp');
    expect(az.sniffFileType(PDF)).toBe('application/pdf');
    expect(az.sniffFileType(SVG)).toBeNull();
    expect(az.sniffFileType(HTML)).toBeNull();
  });

  const app = express();
  app.post('/img', multer({ storage: multer.memoryStorage() }).single('f'), checkFileTypes(IMAGE_TYPES), (req, res) =>
    res.json({ type: req.file.mimetype })
  );
  app.use(uploadErrors);

  it('refuses an SVG or HTML file renamed and labelled as PNG', async () => {
    for (const bytes of [SVG, HTML]) {
      const r = await request(app).post('/img').attach('f', bytes, { filename: 'a.png', contentType: 'image/png' });
      expect(r.status).toBe(400);
    }
  });

  it('refuses a PDF where only images are expected', async () => {
    const r = await request(app).post('/img').attach('f', PDF, { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
  });

  it('replaces the client Content-Type with the real one', async () => {
    const r = await request(app).post('/img').attach('f', PNG, { filename: 'a.html', contentType: 'text/html' });
    expect(r.status).toBe(200);
    expect(r.body.type).toBe('image/png');
  });
});

describe('private container + SAS', () => {
  it('stores private uploads in AZURE_PRIVATE_CONTAINER with a server-made name', async () => {
    const { url } = await az.uploadBufferToAzure({ buffer: PDF, originalname: 'x.exe' }, 'report-evidence', { private: true });
    expect(url).toMatch(/^https:\/\/acct\.blob\.core\.windows\.net\/private-evidence\/report-evidence\/[0-9a-f-]{36}\.pdf$/);
    expect(uploads[0].type).toBe('application/pdf');
  });

  it('signs private URLs in JSON responses, leaves public ones alone', async () => {
    const priv = 'https://acct.blob.core.windows.net/private-evidence/orders/1/evidence/a.png';
    const pub = 'https://acct.blob.core.windows.net/pub-images/job_images/b.png';
    const app = express();
    app.use(az.signPrivateUrls);
    app.get('/', (_q, res) => res.json({ order: { afterImages: [priv], images: [pub] } }));
    const { body } = await request(app).get('/');
    const signed = new URL(body.order.afterImages[0]);
    expect(signed.origin + signed.pathname).toBe(priv);
    expect(signed.searchParams.get('sp')).toBe('r');
    expect(signed.searchParams.get('sig')).toBeTruthy();
    expect(new Date(signed.searchParams.get('se')) - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(body.order.images[0]).toBe(pub);
  });

  it('deletes a private blob given its signed URL', async () => {
    await az.deleteFromAzure('https://acct.blob.core.windows.net/private-evidence/orders/1/evidence/a.png?sv=x&sig=y');
    expect(deletes).toEqual(['https://acct.blob.core.windows.net/private-evidence/orders/1/evidence/a.png']);
  });
});

describe('ownership before upload', () => {
  const mount = (path, router) => {
    const app = express();
    app.use(express.json());
    app.use(path, router);
    app.use(uploadErrors);
    return app;
  };

  it("PUT /users/:id for someone else's id uploads nothing", async () => {
    const app = mount('/api/users', require('../routes/users'));
    const r = await request(app).put('/api/users/507f1f77bcf86cd799439011').set('x-user', 'u1').attach('avatar', PNG, 'a.png');
    expect(r.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("PUT /services/:id on someone else's listing uploads nothing", async () => {
    const Service = require('../models/Service');
    jest.spyOn(Service, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ userId: 'owner' }) }) });
    const app = mount('/api/services', require('../routes/service'));
    const r = await request(app).put('/api/services/507f1f77bcf86cd799439011').set('x-user', 'u1').attach('images', PNG, 'a.png');
    expect(r.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });
});

describe('chat-report evidence (M4)', () => {
  const Chat = require('../models/ChatMessage');
  const ChatReport = require('../models/ChatReport');
  const User = require('../models/User');
  const chatId = '507f1f77bcf86cd799439011';
  const body = { scope: 'chat', reportType: 'spam', title: 'Spam spam', description: 'This user keeps sending spam links.' };

  const app = express();
  app.use('/api/chats', require('../routes/chat'));
  app.use(uploadErrors);

  const post = (user) => {
    let r = request(app).post(`/api/chats/${chatId}/reports`).set('x-user', user);
    for (const [k, v] of Object.entries(body)) r = r.field(k, v);
    return r.attach('evidence', PNG, { filename: 'shot.svg', contentType: 'image/svg+xml' });
  };

  beforeEach(() => {
    jest.spyOn(Chat, 'findById').mockReturnValue({ lean: async () => ({ _id: chatId, clientId: 'u1', providerId: 'u2', messages: [] }) });
    jest.spyOn(ChatReport, 'findOne').mockReturnValue({ lean: async () => null });
    jest.spyOn(ChatReport, 'create').mockImplementation(async (doc) => ({ ...doc, _id: 'r1', status: 'open' }));
    jest.spyOn(User, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) });
  });

  it('really uploads the files and saves their private URL', async () => {
    const r = await post('u1');
    expect(r.status).toBe(201);
    const saved = ChatReport.create.mock.calls[0][0].evidence;
    expect(saved).toHaveLength(1);
    expect(saved[0].fileUrl).toMatch(/\/private-evidence\/report-evidence\/[0-9a-f-]{36}\.png$/);
    expect(saved[0].fileType).toBe('image/png');
  });

  it('a non-participant is refused and nothing is uploaded', async () => {
    const r = await post('stranger');
    expect(r.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });
});

describe('admin chat-report evidence upload (M4)', () => {
  it('accepts multipart files and stores them', async () => {
    const ChatReport = require('../models/ChatReport');
    const report = { evidence: [], timeline: [], save: jest.fn(async () => {}) };
    jest.spyOn(ChatReport, 'findById').mockResolvedValue(report);
    const app = express();
    app.use('/api/admin', require('../routes/admin/index'));
    const r = await request(app)
      .post('/api/admin/chat-reports/507f1f77bcf86cd799439011/evidence')
      .set('x-role', 'superAdmin')
      .attach('files', JPEG, 'proof.jpg');
    expect(r.status).toBe(200);
    expect(report.evidence[0].fileUrl).toMatch(/\/private-evidence\/report-evidence\/.+\.jpg$/);
  });
});

describe('SafePay history role check (M4)', () => {
  const { getSafePayHistory } = require('../controllers/safepayController');
  const call = async (role) => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await getSafePayHistory({ params: { userId: '507f1f77bcf86cd799439011' }, userId: '507f1f77bcf86cd799439012', user: { role } }, res);
    return res.status.mock.calls[0]?.[0] ?? 200;
  };

  it('lets a superAdmin read another user and still refuses a normal user', async () => {
    const SafePayHistory = require('../models/SafePayHistory');
    jest.spyOn(SafePayHistory, 'find').mockImplementation(() => {
      throw new Error('stop after auth');
    });
    expect(await call('superAdmin')).not.toBe(403);
    expect(await call('user')).toBe(403);
  });
});
