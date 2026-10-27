// POST /api/ai/suggest-categories (app "Legg ut oppdrag", category step). OpenAI and Category
// are mocked: no network, no database.
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })),
}));
jest.mock('../models/Category', () => ({
  find: jest.fn().mockReturnValue({
    select: jest
      .fn()
      .mockResolvedValue([
        { name: 'Maling' },
        { name: 'Rengjøring' },
        { name: 'Flytting' },
        { name: 'Hagearbeid' },
      ]),
  }),
}));

process.env.OPENAI_API_KEY = 'sk-test-not-real';
const { suggestCategories, pickSuggestedCategories } = require('../controllers/aiController');

const answer = (categories) => ({
  choices: [{ message: { content: JSON.stringify({ categories }) } }],
  usage: { prompt_tokens: 300, completion_tokens: 10 },
});
const res = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};
const JPEG = { mimetype: 'image/jpeg', buffer: Buffer.from('fake-jpeg') };

beforeEach(() => mockCreate.mockReset());

test('keeps only active categories, in order, no duplicates, max 3', () => {
  const names = ['Maling', 'Rengjøring', 'Flytting', 'Hagearbeid'];
  expect(
    pickSuggestedCategories(
      ['maling', 'Snekker', 'Maling', 'Flytting', 'Rengjøring', 'Hagearbeid'],
      names
    )
  ).toEqual(['Maling', 'Flytting', 'Rengjøring']);
  expect(pickSuggestedCategories('Maling', names)).toEqual([]);
  expect(pickSuggestedCategories(undefined, names)).toEqual([]);
});

test('nothing to look at → 400, no AI call', async () => {
  const r = res();
  await suggestCategories({ body: { text: '   ' }, files: [] }, r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

test('text only: suggestions come back, an invented category is dropped', async () => {
  mockCreate.mockResolvedValue(answer(['Maling', 'Taklegging', 'Rengjøring']));
  const r = res();
  await suggestCategories({ body: { text: 'Male stua, to vegger' } }, r);
  expect(r.json).toHaveBeenCalledWith({ success: true, suggestions: ['Maling', 'Rengjøring'] });
  const user = mockCreate.mock.calls[0][0].messages[1].content;
  expect(user).toHaveLength(1);
  expect(user[0].text).toMatch(/Male stua/);
});

test('photos: at most 3 are sent, each as a low-detail data URL; schema limited to the active names', async () => {
  mockCreate.mockResolvedValue(answer(['Flytting']));
  const r = res();
  await suggestCategories({ body: {}, files: [JPEG, JPEG, JPEG, JPEG] }, r);
  const call = mockCreate.mock.calls[0][0];
  const images = call.messages[1].content.filter((c) => c.type === 'image_url');
  expect(images).toHaveLength(3);
  expect(images[0].image_url).toEqual({
    url: expect.stringMatching(/^data:image\/jpeg;base64,/),
    detail: 'low',
  });
  expect(call.response_format.json_schema.schema.properties.categories.items.enum).toEqual([
    'Maling',
    'Rengjøring',
    'Flytting',
    'Hagearbeid',
  ]);
  expect(r.json).toHaveBeenCalledWith({ success: true, suggestions: ['Flytting'] });
});

test('unreadable model output → empty list, not a crash', async () => {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json' } }], usage: {} });
  const r = res();
  await suggestCategories({ body: { text: 'Klippe plenen' } }, r);
  expect(r.json).toHaveBeenCalledWith({ success: true, suggestions: [] });
});

test('upstream failure → mapped error, key never echoed', async () => {
  mockCreate.mockRejectedValue(
    Object.assign(new Error('Incorrect API key provided: sk-proj-abcdefghijklmnop'), {
      status: 401,
    })
  );
  const r = res();
  await suggestCategories({ body: { text: 'Vaske vinduer' } }, r);
  expect(r.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify(r.json.mock.calls[0][0])).not.toMatch(/sk-proj/);
});

test('generate-full-listing with photos: images ride along as low-detail parts; multipart strings are read right', async () => {
  const { generateFullJobListing } = require('../controllers/aiController');
  mockCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: 'Maling av stue',
            description: 'Jeg trenger hjelp til å male to vegger i stua. Malingen er kjøpt.',
            category: 'Maling',
            skills: ['Maling'],
            openQuestions: [],
            paymentType: 'Fastpris',
            hourlyRate: 450,
            suggestedPrice: 2500,
            priceMin: 2000,
            priceMax: 3200,
            duration: { value: 5, unit: 'hours' },
            locationRelevance: 'on-site',
            pricingReasoning: 'Estimat.',
          }),
        },
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 200 },
  });
  const r = res();
  await generateFullJobListing(
    {
      body: {
        prompt: 'Kategori: Maling. Omfang: Middels.',
        existingCategory: 'Maling',
        existingUrgent: 'false',
        existingDuration: '{"value":"5","unit":"hours"}',
      },
      files: [JPEG, JPEG],
    },
    r
  );
  const call = mockCreate.mock.calls[0][0];
  const content = call.messages[1].content;
  expect(Array.isArray(content)).toBe(true);
  expect(content.filter((c) => c.type === 'image_url').map((c) => c.image_url.detail)).toEqual([
    'low',
    'low',
  ]);
  expect(content[0].text).toMatch(/Kategori: Maling/);
  expect(content[0].text).not.toMatch(/haster|urgent: true/i);
  expect(r.json.mock.calls[0][0]).toMatchObject({
    success: true,
    data: { title: 'Maling av stue', category: 'Maling' },
  });
});

describe('photo-hint (camera helper)', () => {
  const { photoHint } = require('../controllers/aiController');
  const reply = (obj) => ({
    choices: [{ message: { content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 200, completion_tokens: 30 },
  });

  test('one low-detail image, language and photo count in the prompt, hint + quality back', async () => {
    mockCreate.mockResolvedValue(
      reply({
        hint: 'I can see a wall with flaking paint. Now take a close-up of the damage.',
        seen: 'Living-room wall with flaking white paint',
        quality: 'ok',
      })
    );
    const r = res();
    await photoHint({ body: { lang: 'en', count: '2' }, file: JPEG }, r);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toMatch(/photo number 2 of up to 6/);
    expect(call.messages[0].content).toMatch(/in English/);
    expect(call.messages[1].content[0].image_url.detail).toBe('low');
    expect(r.json).toHaveBeenCalledWith({
      success: true,
      hint: expect.stringMatching(/close-up/),
      seen: 'Living-room wall with flaking white paint',
      quality: 'ok',
    });
    expect(call.response_format.json_schema.schema.required).toEqual(['hint', 'seen', 'quality']);
  });

  test('earlier photos and advice ride along (no repeated "take a close-up"); junk is ignored', async () => {
    mockCreate.mockResolvedValue(
      reply({ hint: 'Looks good – tap Done.', seen: 'Close-up of the ceiling edge', quality: 'ok' })
    );
    const r = res();
    await photoHint(
      {
        body: {
          count: '3',
          previousSeen: JSON.stringify(['Whole living room', 'Ceiling with stains']),
          previousHints: '["Take a close-up of the stains."]',
        },
        file: JPEG,
      },
      r
    );
    const content = mockCreate.mock.calls[0][0].messages[1].content;
    expect(content[0].text).toMatch(
      /Earlier photos showed: Whole living room; Ceiling with stains/
    );
    expect(content[0].text).toMatch(/Advice already given: Take a close-up of the stains\./);
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(
      /never a view already shown or already asked for/
    );

    mockCreate.mockClear();
    await photoHint(
      { body: { previousSeen: 'not json', previousHints: '{"a":1}' }, file: JPEG },
      res()
    );
    expect(mockCreate.mock.calls[0][0].messages[1].content).toHaveLength(1); // just the image
  });

  test('no image → 400; unknown quality → ok; empty hint → 502', async () => {
    let r = res();
    await photoHint({ body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);

    mockCreate.mockResolvedValue(
      reply({ hint: 'Too dark – please retake.', quality: 'pitch-black' })
    );
    r = res();
    await photoHint({ body: {}, file: JPEG }, r);
    expect(r.json.mock.calls[0][0].quality).toBe('ok');

    mockCreate.mockResolvedValue(reply({ hint: '  ', quality: 'ok' }));
    r = res();
    await photoHint({ body: {}, file: JPEG }, r);
    expect(r.status).toHaveBeenCalledWith(502);
  });
});

test('repeatsAdvice: the same kind of view asked again counts as a repeat, a new kind does not', () => {
  const { repeatsAdvice } = require('../controllers/aiController');
  expect(
    repeatsAdvice('Please take a close-up of the painted area.', [
      'Please take a close-up of the area being painted.',
    ])
  ).toBe(true);
  expect(repeatsAdvice('Ta et nærbilde av skaden.', ['Ta et nærbilde av veggen.'])).toBe(true);
  expect(
    repeatsAdvice('Now show the whole room for an overview.', [
      'Please take a close-up of the stains.',
    ])
  ).toBe(false);
  expect(repeatsAdvice('Looks good – tap Done.', ['Take a close-up.'])).toBe(false);
  expect(repeatsAdvice('Take a close-up.', [])).toBe(false);
});

test('photo-hint: a repeated "close-up" request becomes "looks good, tap Done"', async () => {
  const { photoHint } = require('../controllers/aiController');
  mockCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            hint: 'Please take a close-up of the painted area.',
            seen: 'Ceiling',
            quality: 'ok',
          }),
        },
      },
    ],
    usage: {},
  });
  const r = res();
  await photoHint(
    {
      body: {
        lang: 'en',
        count: '2',
        previousHints: JSON.stringify(['Please take a close-up of the area being painted.']),
      },
      file: JPEG,
    },
    r
  );
  expect(r.json.mock.calls[0][0].hint).toMatch(/Looks good – tap Done/);
});

describe('photo-hint: "unclear" reads as guidance, not as an error', () => {
  const { photoHint } = require('../controllers/aiController');
  const answer = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }], usage: {} });
  const run = async (body, model) => {
    mockCreate.mockResolvedValue(answer(model));
    const r = res();
    await photoHint({ body, file: JPEG }, r);
    return r.json.mock.calls[0][0];
  };

  test('quality unclear → the friendly next step, in the asked language', async () => {
    expect(
      (await run({ lang: 'en' }, { hint: 'The photo is unclear.', seen: '', quality: 'unclear' }))
        .hint
    ).toMatch(/^I can't quite see what needs doing yet/);
    expect(
      (await run({ lang: 'no' }, { hint: 'Bildet er uklart.', seen: '', quality: 'unclear' })).hint
    ).toMatch(/^Jeg ser ikke helt/);
  });

  test('an "unclear" sentence marked ok is replaced too; a blurry photo keeps its retake advice', async () => {
    expect(
      (
        await run(
          { lang: 'en' },
          { hint: 'This photo is not clear, try again.', seen: 'x', quality: 'ok' }
        )
      ).hint
    ).toMatch(/^I can't quite see/);
    const blurry = await run(
      { lang: 'en' },
      { hint: 'The photo is unclear and blurry – please retake it.', seen: '', quality: 'blurry' }
    );
    expect(blurry.hint).toMatch(/retake/);
    expect(blurry.quality).toBe('blurry');
  });
});
