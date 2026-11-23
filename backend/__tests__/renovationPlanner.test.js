/**
 * Renovation planner ("Oppussingskalkulator"): the estimate is plain arithmetic over
 * jobblo-pricing-config.json, the public route validates its input, and the AI facts
 * endpoint never passes the model's answer through unchecked.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })),
}));
jest.mock('../services/monitoring/costs', () => ({ recordAiUsage: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { _id: 'u1' };
    req.userId = 'u1';
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { renovation: CONFIG } = require('../config/jobblo-pricing-config.json');
const { parsePlan, estimate } = require('../services/renovation/estimate');
const { renovationFacts, pdfPageCount } = require('../controllers/aiController');
const { finnCodeOf } = require('../routes/renovation');

const plan = (body) => {
  const parsed = parsePlan(body);
  if (parsed.error) throw new Error(parsed.error);
  return estimate(parsed.plan);
};

const app = express();
app.use(express.json());
app.use('/api/renovation', require('../routes/renovation'));

describe('estimate', () => {
  it('prices a standard surface kitchen inside the configured range', () => {
    const result = plan({ quality: 'standard', areas: [{ key: 'kitchen', scope: 'surface' }] });
    const [low, high] = CONFIG.areas.find((a) => a.key === 'kitchen').surface.range;
    const [line] = result.areas;
    expect(line.low).toBeGreaterThanOrEqual(low);
    expect(line.high).toBeLessThanOrEqual(high);
    expect(line.low).toBeLessThanOrEqual(line.high);
    // Labour + materials add up to the line, and lines add up to the total.
    expect(line.labour.low + line.materials.low).toBe(line.low);
    expect(result.total.low).toBe(line.low);
    expect(result.disclaimer).toMatch(/veiledende/);
  });

  it('a better quality never costs less, and full never less than surface', () => {
    const at = (scope, quality) =>
      plan({ facts: { sizeM2: 80 }, quality, areas: [{ key: 'rooms', scope }] }).total;
    let previous = 0;
    for (const quality of CONFIG.qualities) {
      const { low, high } = at('surface', quality);
      expect(high).toBeGreaterThanOrEqual(low);
      expect(low).toBeGreaterThanOrEqual(previous);
      previous = low;
      expect(at('full', quality).low).toBeGreaterThan(at('surface', quality).low);
    }
  });

  it('scales rooms by m² and bathrooms by count', () => {
    const rooms = (sizeM2) =>
      plan({ facts: { sizeM2 }, areas: [{ key: 'rooms', scope: 'surface' }] }).total.low;
    expect(rooms(140)).toBeGreaterThan(rooms(70));
    const baths = (bathrooms) =>
      plan({ facts: { bathrooms }, areas: [{ key: 'bathroom', scope: 'full' }] }).total.low;
    expect(baths(2)).toBe(baths(1) * 2);
  });

  it('marks certified work as quotes (Anbud)', () => {
    const result = plan({
      areas: [
        { key: 'bathroom', scope: 'surface' },
        { key: 'kitchen', scope: 'full' },
        { key: 'hallway', scope: 'surface' },
      ],
    });
    const byKey = Object.fromEntries(result.areas.map((a) => [a.key, a]));
    expect(byKey.bathroom.quote).toBe(true);
    expect(byKey.kitchen.quote).toBe(true);
    expect(byKey.kitchen.certified).toEqual(expect.arrayContaining(['Elektriker']));
    expect(byKey.hallway.quote).toBe(false);
  });

  it('per-area quality overrides the project quality', () => {
    const result = plan({
      quality: 'budget',
      areas: [
        { key: 'kitchen', scope: 'full', quality: 'premium' },
        { key: 'hallway', scope: 'full' },
      ],
    });
    expect(result.areas.map((a) => a.quality)).toEqual(['premium', 'budget']);
  });

  it('over budget: suggests the biggest single saving first, in Norwegian', () => {
    const result = plan({
      quality: 'good',
      budget: 100000,
      areas: [
        { key: 'kitchen', scope: 'full' },
        { key: 'hallway', scope: 'surface' },
      ],
    });
    expect(result.budget.status).toBe('over');
    expect(result.budget.overBy).toBeGreaterThan(0);
    const [first] = result.budget.suggestions;
    expect(first).toMatchObject({ key: 'kitchen', change: { scope: 'surface' } });
    expect(first.text).toMatch(/^Overflate i stedet for total på kjøkken sparer ca\. [\d ]+ kr\.$/);
    const savings = result.budget.suggestions.map((s) => s.saving);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
  });

  it('within budget: no suggestions', () => {
    const result = plan({ budget: 5_000_000, areas: [{ key: 'hallway', scope: 'surface' }] });
    expect(result.budget).toMatchObject({ status: 'within', suggestions: [] });
  });

  it('no budget: no budget block', () => {
    expect(plan({ areas: [{ key: 'hallway', scope: 'surface' }] }).budget).toBeNull();
  });

  it('out-of-range facts fall back to the defaults instead of pricing nonsense', () => {
    const result = plan({
      facts: { sizeM2: 1e9, rooms: -4, bathrooms: 'mange' },
      areas: [{ key: 'hallway', scope: 'surface' }],
    });
    expect(result.facts).toEqual(CONFIG.defaults);
  });
});

describe('parsePlan rejects bad input', () => {
  it.each([
    [{}, 'Velg minst ett område.'],
    [{ areas: [] }, 'Velg minst ett område.'],
    [{ areas: [{ key: 'pool', scope: 'full' }] }, 'Ukjent område.'],
    [{ areas: [{ key: 'kitchen', scope: 'half' }] }, 'Velg overflate eller total.'],
    [{ areas: [{ key: 'kitchen', scope: 'full', quality: 'gold' }] }, 'Ugyldig kvalitet.'],
    [{ areas: [{ key: 'kitchen', scope: 'full' }], budget: -5 }, 'Ugyldig budsjett.'],
    [{ areas: [{ key: 'kitchen', scope: 'full' }], budget: 'lots' }, 'Ugyldig budsjett.'],
    [{ areas: [{ $gt: '' }] }, 'Ukjent område.'],
    [{ areas: Array(50).fill({ key: 'kitchen', scope: 'full' }) }, 'For mange områder.'],
  ])('%j', (body, error) => {
    expect(parsePlan(body)).toEqual({ error });
  });

  it('a duplicated area is priced once', () => {
    const { plan: parsed } = parsePlan({
      areas: [
        { key: 'kitchen', scope: 'full' },
        { key: 'kitchen', scope: 'surface' },
      ],
    });
    expect(parsed.areas).toHaveLength(1);
  });
});

describe('routes', () => {
  it('GET /catalogue lists every configured area', async () => {
    const res = await request(app).get('/api/renovation/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.areas.map((a) => a.key)).toEqual(CONFIG.areas.map((a) => a.key));
    expect(res.body.homeTypes).toContainEqual({ key: 'enebolig', label: 'Enebolig' });
  });

  it('POST /estimate answers 200 with a total, 400 with { error } on bad input', async () => {
    const ok = await request(app)
      .post('/api/renovation/estimate')
      .send({ areas: [{ key: 'bathroom', scope: 'full' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.total.low).toBeGreaterThan(0);

    const bad = await request(app).post('/api/renovation/estimate').send({ areas: 'kitchen' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBeTruthy();
  });
});

describe('POST /api/ai/renovation-facts', () => {
  const call = async (body) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    await renovationFacts({ body, headers: {} }, res);
    return res;
  };

  beforeAll(() => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  });
  beforeEach(() => mockCreate.mockReset());

  it('refuses a too-short text without calling the model', async () => {
    const res = await call({ text: 'kort' });
    expect(res.statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a non-string text', async () => {
    expect((await call({ text: { $gt: '' } })).statusCode).toBe(400);
  });

  it('keeps only valid facts from the model', async () => {
    mockCreate.mockResolvedValue({
      usage: {},
      choices: [
        {
          message: {
            content: JSON.stringify({
              sizeM2: 74.6,
              rooms: 3,
              bathrooms: 99,
              yearBuilt: 1972,
              homeType: 'slott',
              standardNotes: [
                { area: 'kitchen', text: ' Originalt kjøkken fra 1985 ' },
                { area: 'pool', text: 'Basseng' },
              ],
              outdatedAreas: ['kitchen', 'kitchen', 'garage'],
            }),
          },
        },
      ],
    });
    const res = await call({ text: 'Pen 3-roms leilighet på 75 kvm, originalt kjøkken fra 1985.' });
    expect(res.statusCode).toBe(200);
    expect(res.body.facts).toEqual({
      sizeM2: 75,
      rooms: 3,
      bathrooms: null,
      yearBuilt: 1972,
      homeType: null,
      standardNotes: [{ area: 'kitchen', text: 'Originalt kjøkken fra 1985' }],
      outdatedAreas: ['kitchen'],
      // No photos sent, so no photo areas, whatever the model says.
      photoAreas: [],
    });
  });

  it('an unparseable answer gives empty facts, not a crash', async () => {
    mockCreate.mockResolvedValue({ usage: {}, choices: [{ message: { content: 'not json' } }] });
    const res = await call({ text: 'En lang nok annonsetekst om en leilighet i Oslo.' });
    expect(res.statusCode).toBe(200);
    expect(res.body.facts.sizeM2).toBeNull();
    expect(res.body.facts.outdatedAreas).toEqual([]);
  });

  it('a model timeout is a 504, not a hang', async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' })
    );
    const res = await call({ text: 'En lang nok annonsetekst om en leilighet i Oslo.' });
    expect(res.statusCode).toBe(504);
  });
});

describe('renovation-facts with photos and a prospectus (multipart)', () => {
  const aiApp = express();
  aiApp.use(express.json());
  aiApp.use('/api/ai', require('../routes/ai'));
  // eslint-disable-next-line no-unused-vars
  aiApp.use((err, req, res, next) =>
    res.status(err.code === 'INVALID_FILE_TYPE' ? 400 : 500).json({ error: err.message })
  );

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  const pdf = (pages = 2) =>
    Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages >>\n${'<< /Type /Page >>\n'.repeat(pages)}`);
  const answer = {
    sizeM2: 90,
    rooms: 4,
    bathrooms: 2,
    yearBuilt: 1990,
    homeType: 'enebolig',
    standardNotes: [],
    outdatedAreas: ['bathroom'],
    // One more entry than photos, and an unknown area: both cleaned away.
    photoAreas: ['kitchen', 'sauna', 'bathroom'],
  };

  beforeAll(() => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  });
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      usage: {},
      choices: [{ message: { content: JSON.stringify(answer) } }],
    });
  });

  it('sends the PDF as a file and the photos as images, text optional', async () => {
    const res = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('prospectus', pdf(), 'prospekt.pdf')
      .attach('images', PNG, 'kjokken.png');
    expect(res.status).toBe(200);
    expect(res.body.facts).toMatchObject({ sizeM2: 90, outdatedAreas: ['bathroom'] });
    expect(res.body.facts.photoAreas).toEqual(['kitchen']); // one photo was sent
    const content = mockCreate.mock.calls[0][0].messages[1].content;
    expect(content.map((part) => part.type)).toEqual(['text', 'file', 'image_url']);
    expect(content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('tags each photo with its area, null for unknown areas, one entry per photo', async () => {
    const res = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('images', PNG, 'a.png')
      .attach('images', PNG, 'b.png')
      .attach('images', PNG, 'c.png');
    expect(res.status).toBe(200);
    expect(res.body.facts.photoAreas).toEqual(['kitchen', null, 'bathroom']);
  });

  it('refuses a prospectus that is not a PDF, and a photo that is a PDF', async () => {
    const notPdf = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('prospectus', PNG, 'prospekt.pdf');
    expect(notPdf.status).toBe(400);
    const notPhoto = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('images', pdf(), 'bilde.png');
    expect(notPhoto.status).toBe(400);
    const fake = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('images', Buffer.from('not an image at all'), 'x.png');
    expect(fake.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a very long prospectus before calling the model', async () => {
    const res = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('prospectus', pdf(61), 'prospekt.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/for langt/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a file over 15 MB and more than 5 photos', async () => {
    const big = Buffer.concat([pdf(), Buffer.alloc(15 * 1024 * 1024 + 1)]);
    const tooBig = await request(aiApp)
      .post('/api/ai/renovation-facts')
      .attach('prospectus', big, 'prospekt.pdf');
    expect(tooBig.status).toBe(413);
    let many = request(aiApp).post('/api/ai/renovation-facts');
    for (let i = 0; i < 6; i += 1) many = many.attach('images', PNG, `b${i}.png`);
    expect((await many).status).toBe(400);
  });

  it('nothing at all is a 400', async () => {
    const res = await request(aiApp).post('/api/ai/renovation-facts').field('text', 'kort');
    expect(res.status).toBe(400);
  });
});

describe('helpers', () => {
  it('pdfPageCount counts page objects, not the page tree', () => {
    expect(pdfPageCount(Buffer.from('<< /Type /Pages >> << /Type /Page >> << /Type/Page>>'))).toBe(
      2
    );
  });

  it.each([
    ['412345678', '412345678'],
    ['https://www.finn.no/realestate/homes/ad.html?finnkode=412345678', '412345678'],
    ['https://www.finn.no/412345678', '412345678'],
    ['finn.no', ''],
    ['12', ''],
    [{ $gt: '' }, ''],
  ])('finnCodeOf(%j) = %j', (input, code) => {
    expect(finnCodeOf(input)).toBe(code);
  });
});
