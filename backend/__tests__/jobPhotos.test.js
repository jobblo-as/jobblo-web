/**
 * "Jobs without photos" task 2, AI side: POST /api/ai/photo-suggestions returns 1–3 short
 * lines on what to photograph, cleaned, and never passes the model's answer through as-is.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })),
}));
jest.mock('../services/monitoring/costs', () => ({ recordAiUsage: jest.fn() }));

const { photoSuggestions } = require('../controllers/aiController');

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
  await photoSuggestions({ body, headers: {} }, res);
  return res;
};
const answer = (content) => ({ usage: {}, choices: [{ message: { content } }] });

beforeAll(() => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
});
beforeEach(() => mockCreate.mockReset());

it('returns at most 3 trimmed suggestions', async () => {
  mockCreate.mockResolvedValue(
    answer(
      JSON.stringify({
        suggestions: [
          '  Ta et bilde av gulvet  ',
          'Ta et bilde av hele rommet',
          '',
          42,
          'Ta et nærbilde av skjøtene',
          'En fjerde som kuttes',
        ],
      })
    )
  );
  const res = await call({
    title: 'Legge laminat',
    description: 'Stue på 30 m²',
    category: 'Oppussing',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body.suggestions).toEqual([
    'Ta et bilde av gulvet',
    'Ta et bilde av hele rommet',
    'Ta et nærbilde av skjøtene',
  ]);
  // The job text goes to the model as data in the user message.
  expect(mockCreate.mock.calls[0][0].messages[1].content).toContain('Legge laminat');
});

it('refuses an empty job without calling the model', async () => {
  expect((await call({ title: '', description: ' ' })).statusCode).toBe(400);
  expect((await call({ title: { $gt: '' } })).statusCode).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('a useless answer is a 502, not an empty list shown as advice', async () => {
  mockCreate.mockResolvedValue(answer('not json'));
  expect((await call({ description: 'Klippe hekk, 15 meter' })).statusCode).toBe(502);
});

it('caps very long text before it reaches the model', async () => {
  mockCreate.mockResolvedValue(answer(JSON.stringify({ suggestions: ['Ta et bilde av hekken'] })));
  await call({ description: 'x'.repeat(10_000) });
  expect(mockCreate.mock.calls[0][0].messages[1].content.length).toBeLessThan(2400);
});

describe('POST /api/ai/description-questions (task 3)', () => {
  const { descriptionQuestions, isShortDescription } = require('../controllers/aiController');
  const ask = async (body) => {
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
    await descriptionQuestions({ body, headers: {} }, res);
    return res;
  };

  it('a short description: cleaned questions with labels', async () => {
    mockCreate.mockResolvedValue(
      answer(
        JSON.stringify({
          questions: [
            { label: 'Størrelse', question: ' Hvor stort er speilet (cm)? ' },
            { label: '', question: 'Hvor skal det henge?' },
            { label: 'Når', question: 'Når skal det gjøres?' },
            { label: 'Når', question: 'Når skal det gjøres?' },
            { label: 'X', question: '' },
          ],
        })
      )
    );
    const res = await ask({ description: 'Noen som er flinke med speilglass?' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      short: true,
      questions: [
        { label: 'Størrelse', question: 'Hvor stort er speilet (cm)?' },
        { label: 'Svar', question: 'Hvor skal det henge?' },
        { label: 'Når', question: 'Når skal det gjøres?' },
      ],
    });
  });

  it('a description that says enough: no AI call, no questions', async () => {
    const long =
      'Vi trenger hjelp til å montere et speil på 120 x 80 cm på badet i andre etasje. Skruer og plugger har vi.';
    const res = await ask({ description: long });
    expect(res.body).toEqual({ success: true, short: false, questions: [] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('nothing written: 400 without an AI call', async () => {
    expect((await ask({ description: '  ', title: '' })).statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('the rule: under 12 words or 80 characters is short', () => {
    expect(isShortDescription('Klippe hekk')).toBe(true);
    // 11 long words: over 80 characters, still too few words.
    expect(isShortDescription('speilglass '.repeat(11))).toBe(true);
    // 12 words but under 80 characters.
    expect(isShortDescription('ord '.repeat(12))).toBe(true);
    expect(isShortDescription('ord '.repeat(20) + 'x'.repeat(10))).toBe(false);
  });
});
