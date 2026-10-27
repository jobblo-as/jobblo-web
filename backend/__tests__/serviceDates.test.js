// A job without an end date: clients send toDate '' (app post-job flow, old form, web).
const { validateServiceFields } = require('../controllers/services/serviceHelpers');

const body = (over) => ({
  title: 'Male to vegger i stua',
  description: 'Jeg trenger hjelp til å male to vegger i stua, lys farge.',
  price: '2500',
  paymentType: 'Fastpris',
  duration: { value: '4', unit: 'hours' },
  fromDate: '2026-11-02',
  toDate: '',
  ...over,
});

test('an empty end date is no end date, not "Ugyldig til-dato"', () => {
  expect(validateServiceFields(body({}))).toBeNull();
  expect(validateServiceFields(body({ fromDate: '' }), { partial: true })).toBeNull();
});

test('real date problems are still refused', () => {
  expect(validateServiceFields(body({ toDate: 'not-a-date' }))).toBe('Ugyldig til-dato.');
  expect(validateServiceFields(body({ fromDate: '2026-13-45' }))).toBe('Ugyldig fra-dato.');
  expect(validateServiceFields(body({ fromDate: '2026-11-10', toDate: '2026-11-02' }))).toMatch(/Sluttdato/);
});
