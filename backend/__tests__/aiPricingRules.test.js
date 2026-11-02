const { validateSmartFillOutput } = require('../utils/aiSmartFill');
const { buildContextBlock, buildSchema } = require('../services/ai/jobListingPrompt');

// Jobblo-AI-pricing-rules.pdf, applied to whatever the model answered.
const fill = (raw, ctx) =>
  validateSmartFillOutput(
    { title: 'Oppdrag test', duration: { value: 2, unit: 'hours' }, ...raw },
    ctx
  ).cleaned;

describe('AI pricing rules (jobblo-pricing-config.json)', () => {
  it('"Oppussing av trapper" is 5 000–12 000 kr, not 390', () => {
    const c = fill(
      { jobType: 'Pusse opp trapp', suggestedPrice: 390, priceMin: 300, priceMax: 500 },
      { categoryName: 'Oppussing' }
    );
    expect([c.priceMin, c.suggestedPrice, c.priceMax]).toEqual([5000, 5000, 12000]);
    expect(c.pricingReasoning).toBe(
      'Prisen er et anslag basert på jobbtype, størrelse og vanlige timepriser.'
    );
  });

  it('never below the category minimum', () => {
    const c = fill({ jobType: 'Ærend / handle' }, { categoryName: 'Småjobber' });
    expect(c.priceMin).toBe(400);
  });

  it('urgent +20 %', () => {
    const c = fill({ jobType: 'Vanlig vask' }, { categoryName: 'Rengjøring', urgent: true });
    expect([c.priceMin, c.priceMax]).toEqual([720, 1800]);
  });

  it('evening/weekend +20 %: from the text, or dates that are all Saturday/Sunday', () => {
    const vask = { jobType: 'Vanlig vask' };
    const range = (c) => [c.priceMin, c.priceMax];
    // 2026-11-07 is a Saturday, 2026-11-09 a Monday.
    expect(range(fill(vask, { categoryName: 'Rengjøring', fromDate: '2026-11-07' }))).toEqual([
      720, 1800,
    ]);
    expect(
      range(
        fill(vask, { categoryName: 'Rengjøring', fromDate: '2026-11-07', toDate: '2026-11-08' })
      )
    ).toEqual([720, 1800]);
    expect(
      range(
        fill(vask, { categoryName: 'Rengjøring', fromDate: '2026-11-07', toDate: '2026-11-09' })
      )
    ).toEqual([600, 1500]);
    expect(range(fill(vask, { categoryName: 'Rengjøring', fromDate: 'nonsense' }))).toEqual([
      600, 1500,
    ]);
    expect(
      range(fill(vask, { categoryName: 'Rengjøring', userText: 'Vask på kvelden etter kl 18' }))
    ).toEqual([720, 1800]);
    // Urgent and weekend add up: +40 %.
    expect(
      range(fill(vask, { categoryName: 'Rengjøring', urgent: true, userText: 'i helgen' }))
    ).toEqual([840, 2100]);
  });

  it('quote job types become Anbud', () => {
    const c = fill(
      { jobType: 'Bad / våtrom', paymentType: 'Fastpris' },
      { categoryName: 'Oppussing', lang: 'en' }
    );
    expect(c.paymentType).toBe('Anbud');
    expect(c.priceMin).toBeGreaterThanOrEqual(1500);
    expect(c.pricingReasoning).toMatch(/request quotes/);
  });

  it('no job type: hours × professional rate for plumbing (+ call-out fee 500–900)', () => {
    const c = fill({ hourlyRate: 400 }, { categoryName: 'Rørlegger' });
    expect([c.priceMin, c.priceMax, c.hourlyRate]).toEqual([2300, 3500, 900]);
  });

  it('renovation words switch to the professional hourly rate', () => {
    const c = fill(
      { description: 'Pusse opp bad', hourlyRate: 300 },
      { categoryName: 'Småjobber', userText: 'oppussing' }
    );
    expect(c.hourlyRate).toBe(500);
  });

  it('matches the job type when the model echoes the English part', () => {
    const c = fill({ jobType: 'Lekkasje (Leak repair)' }, { categoryName: 'Rørlegger' });
    expect([c.priceMin, c.priceMax, c.jobType]).toEqual([2500, 6900, 'Lekkasje']);
    expect(c.pricingReasoning).toMatch(/Inkluderer oppmøtegebyr \(500–900 kr\)\./);
  });

  it('bathroom renovation without a job type is still Anbud; cleaning a bathroom is not', () => {
    const reno = fill(
      { description: 'Pusse opp badet, nye fliser', jobType: '' },
      { categoryName: 'Oppussing' }
    );
    expect(reno.paymentType).toBe('Anbud');
    expect(reno.pricingReasoning).toMatch(/be om anbud/);
    const clean = fill({ description: 'Vaske badet og kjøkkenet' }, { categoryName: 'Rengjøring' });
    expect(clean.paymentType).toBe('Fastpris');
  });

  it('paint unless the customer supplies it, waste removal when asked; unknown extras ignored', () => {
    const room = { jobType: 'Male ett rom (vegger)' };
    const noPaint = fill({ ...room, customerSuppliesMaterials: true }, { categoryName: 'Maling' });
    expect([noPaint.priceMin, noPaint.priceMax]).toEqual([3000, 7000]);
    const paint = fill(
      { ...room, extras: ['Gratis kaffe'] },
      { categoryName: 'Maling', urgent: true }
    );
    // Labour +20 % urgent, paint is not marked up: 3 600 + 800, 8 400 + 1 500.
    expect([paint.priceMin, paint.priceMax]).toEqual([4400, 9900]);
    expect(paint.pricingReasoning).toMatch(/maling \/ beis \(800–1.500 kr\)/);
    const waste = fill(
      { jobType: 'Rake løv', extras: ['Bortkjøring av hageavfall (Garden waste removal)'] },
      { categoryName: 'Hagearbeid' }
    );
    expect([waste.priceMin, waste.priceMax]).toEqual([1100, 3500]);
    const noWaste = fill({ jobType: 'Rake løv', extras: [] }, { categoryName: 'Hagearbeid' });
    expect([noWaste.priceMin, noWaste.priceMax]).toEqual([600, 2000]);
  });

  it('bathroom (quote, no table price): Anbud and no figure shown', () => {
    const c = fill({ jobType: 'Bad / våtrom' }, { categoryName: 'Oppussing' });
    expect([c.paymentType, c.priceHidden]).toEqual(['Anbud', true]);
    expect(c.pricingReasoning).not.toMatch(/Inkluderer|kr/);
    const facade = fill({ jobType: 'Male husfasade' }, { categoryName: 'Maling' });
    expect([facade.paymentType, facade.priceHidden, facade.priceMin]).toEqual([
      'Anbud',
      undefined,
      30000,
    ]);
  });

  it('unsure between job types: the range spans them and the user is asked to answer', () => {
    const c = fill(
      { jobType: 'Lett ripe', jobTypeAlternatives: ['Dyp ripe (Deep scratch)', 'Lett ripe'] },
      { categoryName: 'Bil & Pleie' }
    );
    expect([c.priceMin, c.priceMax]).toEqual([400, 4000]);
    expect(c.pricingReasoning).toMatch(/Svar på spørsmålene/);
  });

  it('"ripe" alone is unsure (light or deep); the user own depth words settle it', () => {
    const scratch = (userText) =>
      fill({ jobType: 'Lett ripe' }, { categoryName: 'Bil & Pleie', userText });
    expect([scratch('Ripe på bildøra').priceMin, scratch('Ripe på bildøra').priceMax]).toEqual([
      400, 4000,
    ]);
    expect(scratch('Lett ripe på bildøra').priceMax).toBe(800);
  });

  it('size: the estimated hours place the suggestion inside the job type range', () => {
    const at = (value) =>
      fill(
        { jobType: 'Vanlig vask', duration: { value, unit: 'hours' } },
        { categoryName: 'Rengjøring' }
      ).suggestedPrice;
    expect([at(2), at(2.5), at(3), at(8)]).toEqual([600, 1050, 1500, 1500]);
  });

  it('per unit when the user gave the quantity', () => {
    const range = (raw, categoryName) => {
      const c = fill(raw, { categoryName });
      return [c.priceMin, c.priceMax];
    };
    // Move-out clean 100 m² × 25–45 kr.
    expect(range({ jobType: 'Flyttevask', quantities: { m2: 100 } }, 'Rengjøring')).toEqual([
      2500, 4500,
    ]);
    // Three rooms: 3 × 3 000–7 000 labour + 3 × 800–1 500 paint.
    expect(range({ jobType: 'Male ett rom (vegger)', quantities: { rooms: 3 } }, 'Maling')).toEqual(
      [11400, 25500]
    );
    // 20 m hedge × 80–250 kr.
    expect(range({ jobType: 'Klippe hekk', quantities: { meters: 20 } }, 'Hagearbeid')).toEqual([
      1600, 5000,
    ]);
    // Transport: km only from 30 km, 10–20 kr per km.
    expect(range({ jobType: 'Hente møbel', quantities: { km: 100 } }, 'Transport')).toEqual([
      1500, 3200,
    ]);
    expect(range({ jobType: 'Hente møbel', quantities: { km: 20 } }, 'Transport')).toEqual([
      500, 1200,
    ]);
    // Moving, private rate per person: 2 h × 300–450 × people (2 when not stated).
    expect(range({ quantities: { people: 3 } }, 'Flytting')).toEqual([1800, 2700]);
    expect(range({}, 'Flytting')).toEqual([1200, 1800]);
  });

  it('"ikke i helgen" does not add the weekend rate', () => {
    const c = fill(
      { jobType: 'Vanlig vask' },
      { categoryName: 'Rengjøring', userText: 'Kan gjøres når som helst, ikke i helgen' }
    );
    expect([c.priceMin, c.priceMax]).toEqual([600, 1500]);
  });

  it('garbage from the model or the client never breaks the price', () => {
    const junk = [
      undefined,
      null,
      '',
      0,
      -5,
      NaN,
      Infinity,
      1e308,
      'x'.repeat(5000),
      {},
      [],
      [null, 42, {}],
      { $ne: '' },
      { m2: -1, pieces: 'mange', meters: Infinity, rooms: 1e9, km: NaN, people: -3 },
    ];
    for (const categoryName of ['Rørlegger', 'Maling', 'Flytting', 'Transport', 'Bil & Pleie']) {
      for (const v of junk) {
        const c = fill(
          {
            jobType: v,
            jobTypeAlternatives: v,
            extras: v,
            quantities: v,
            customerSuppliesMaterials: v,
            suggestedPrice: v,
            hourlyRate: v,
            duration: v,
          },
          { categoryName, fromDate: v, toDate: v, userText: v, urgent: v }
        );
        for (const n of [c.priceMin, c.suggestedPrice, c.priceMax, c.hourlyRate]) {
          expect(Number.isSafeInteger(n) && n > 0).toBe(true);
        }
        expect(c.priceMin).toBeLessThanOrEqual(c.suggestedPrice);
        expect(c.suggestedPrice).toBeLessThanOrEqual(c.priceMax);
        expect(c.priceMax).toBeLessThanOrEqual(250_000); // TOTAL_MAX
      }
    }
  });

  it('the price follows the work the text describes, not a different category left on the form', () => {
    const c = fill(
      { category: 'Rengjøring', jobType: 'Vanlig vask' },
      {
        categoryName: 'Oppussing',
        categoryAllowList: ['Oppussing', 'Rengjøring'],
        userText: 'Vanlig vask på lørdag',
      }
    );
    expect([c.priceMin, c.priceMax]).toEqual([720, 1800]);
    const block = buildContextBlock({
      categoryName: 'Oppussing',
      categoryAllowList: ['Rengjøring', 'Oppussing'],
      lang: 'no',
      feature: 'x',
    });
    expect(block.pricingRules.map((r) => r.category)).toEqual(['Oppussing', 'Rengjøring']);
  });

  it('Anbud only for quote work: a model-chosen Anbud on a priced job type falls back', () => {
    const scratch = fill(
      { jobType: 'Dyp ripe', paymentType: 'Anbud' },
      { categoryName: 'Bil & Pleie', userPaymentType: 'Fastpris' }
    );
    expect(scratch.paymentType).toBe('Fastpris');
    const chosen = fill(
      { jobType: 'Dyp ripe', paymentType: 'Anbud' },
      { categoryName: 'Bil & Pleie', userPaymentType: 'Anbud' }
    );
    expect(chosen.paymentType).toBe('Anbud');
  });

  it('quote work gets no per-room paint, the call-out fee still applies', () => {
    const facade = fill({ jobType: 'Male husfasade' }, { categoryName: 'Maling' });
    expect([facade.priceMin, facade.priceMax]).toEqual([30000, 120000]);
    expect(facade.pricingReasoning).not.toMatch(/Inkluderer/);
  });

  it('a category outside the config keeps the old heuristics', () => {
    const c = fill({ jobType: 'Pusse opp trapp' }, { categoryName: 'Snømåking' });
    expect(c.pricingReasoning).not.toMatch(/^Prisen er et anslag/);
  });

  it('the prompt gets the category job types and the schema asks for jobType', () => {
    const block = buildContextBlock({ categoryName: 'Maling', lang: 'no', feature: 'x' });
    expect(block.pricingRules.minimumKr).toBe(1000);
    expect(block.pricingRules.jobTypes.join()).toMatch(/Pusse opp trapp.*5000–12000 kr, pro/);
    const all = buildContextBlock({
      categoryAllowList: ['Maling', 'Rørlegger'],
      lang: 'no',
      feature: 'x',
    });
    expect(all.pricingRules.map((r) => r.category)).toEqual(['Rørlegger', 'Maling']);
    expect(buildSchema().schema.required).toEqual(
      expect.arrayContaining([
        'jobType',
        'extras',
        'customerSuppliesMaterials',
        'jobTypeAlternatives',
        'quantities',
      ])
    );
    expect(block.pricingRules.extras.join()).toMatch(
      /Maling \/ beis.*800–1500 kr — added automatically unless/
    );
  });
});
