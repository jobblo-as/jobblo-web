const { OpenAI } = require('openai');
const Category = require('../models/Category');
const { validateSmartFillOutput, PAYMENT_TYPES } = require('../utils/aiSmartFill');
const {
  buildRequest,
  supportsStrictSchema,
  SUPPORTED_LANGS,
} = require('../services/ai/jobListingPrompt');

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI client
//
// Bounded on purpose: an unbounded client defaults to a 10-minute timeout, so a
// stalled upstream call would hold an Express handler open far longer than any
// user waits. 25s covers the p99 for this prompt (measured ~2.6s mean), and one
// retry absorbs a transient 5xx without turning a rate-limit into a retry storm.
// ──────────────────────────────────────────────────────────────────────────────
// Constructed lazily. The client used to be built at module scope, which meant
// requiring this controller threw when OPENAI_API_KEY was unset — so app.js
// could not boot without a key, and the per-handler "AI-tjeneste ikke
// konfigurert" guards below were unreachable. Building it on first use makes
// those guards work and lets the rest of the app run without an AI key.
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 25_000,
      maxRetries: 1,
      fetch: require('../services/monitoring/externalCalls').timedFetch('openai'), // latency/failures for the developer console
    });
  }
  return _client;
}

// gpt-4o-mini is the floor for this feature: it is the cheapest model that can
// enforce a strict JSON schema. On gpt-3.5-turbo the same prompt produces
// equally good prose but structurally invalid data — it translates enum values
// ("hours" -> "timer") and returns booleans for string fields. See
// evals/results/after-gpt35.json.
const DEFAULT_MODEL = 'gpt-4o-mini';
const MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const { recordAiUsage } = require('../services/monitoring/costs');
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || MODEL;

let _warnedAboutModel = false;
function warnIfWeakModel() {
  if (_warnedAboutModel || supportsStrictSchema(MODEL)) return;
  _warnedAboutModel = true;
  console.warn(
    `[ai] OPENAI_MODEL="${MODEL}" cannot enforce a strict JSON schema. ` +
      `Falling back to loose JSON mode, which measured 4/28 structurally valid ` +
      `responses in evals. Set OPENAI_MODEL=${DEFAULT_MODEL} or better.`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers shared across all 3 endpoints
// ──────────────────────────────────────────────────────────────────────────────
async function _loadCategoryContext(categoryFromUser) {
  const all = await Category.find({ isActive: true }).select('name');
  const names = all.map((c) => c.name);
  const chosen =
    (categoryFromUser &&
      (typeof categoryFromUser === 'string'
        ? categoryFromUser
        : Array.isArray(categoryFromUser)
          ? categoryFromUser[0]
          : categoryFromUser.name)) ||
    '';
  // Previously `names.includes(chosen) ? chosen : chosen` — both branches
  // returned the same value, so a category that is not in the active list was
  // passed to the prompt as though it were valid, and the pricing anchor was
  // looked up against a name the marketplace does not have.
  return { names, chosen: names.includes(chosen) ? chosen : '' };
}

/** Remove anything key-shaped before a message is written to a log. */
function _redact(text) {
  return String(text == null ? '' : text).replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***');
}

/**
 * Map an upstream failure onto a safe response.
 *
 * The previous version returned `err.message` straight to the client. OpenAI's
 * 401 body embeds the key that was rejected ("Incorrect API key provided:
 * sk-proj-..."), so a misconfigured server would have handed its own credential
 * to every browser that pressed Smart Fill. Upstream text is now logged
 * (redacted) and never returned; the client gets a fixed message per class.
 */
function _respondWithAiError(res, err, prefix = 'AI generation failed') {
  const status = err && err.status;
  console.error(`[${prefix}]`, _redact(err && err.message ? err.message : err));

  if (
    err &&
    (status === 429 || err.code === 'insufficient_quota' || /\b429\b/.test(String(err.message)))
  ) {
    return res.status(429).json({
      success: false,
      error: 'AI-kvote overskredet',
      message: 'Du har nådd grensen for AI-forespørsler. Prøv igjen senere.',
    });
  }
  if (status === 401 || status === 403) {
    return res.status(500).json({
      success: false,
      error: 'AI-tjenesten er ikke riktig konfigurert',
      message: 'Kontakt support hvis dette fortsetter.',
    });
  }
  if (
    err &&
    (err.name === 'APIConnectionTimeoutError' ||
      /timeout|hang up|ECONNRESET/i.test(String(err.message)))
  ) {
    return res.status(504).json({
      success: false,
      error: 'AI-tjenesten svarte ikke i tide',
      message: 'Prøv igjen, eller fyll ut feltene manuelt.',
    });
  }
  return res.status(500).json({
    success: false,
    error: 'Kunne ikke generere AI-innhold',
    message: 'Prøv igjen, eller fyll ut feltene manuelt.',
  });
}

// Resolve the caller's UI language. The frontend has a locale ('no' | 'en')
// from LanguageContext; when it sends one we honour it, otherwise the prompt
// module sniffs the free text. The old implementation hard-coded Norwegian
// bokmål, so an English-speaking user got a Norwegian listing back.
function _resolveLang(body) {
  const raw = ((body && (body.lang || body.locale || body.language)) || '')
    .toString()
    .toLowerCase();
  return SUPPORTED_LANGS.includes(raw) ? raw : undefined;
}

/**
 * Single entry point for all three endpoints.
 *
 * The prompt itself lives in services/ai/jobListingPrompt.js, which keeps the
 * stable instructions, the application context and the user's raw text in
 * separate, clearly-labelled parts. This function only performs the call.
 */
async function _callAi(context, images = []) {
  warnIfWeakModel();
  const model = images.length ? VISION_MODEL : MODEL;
  const request = buildRequest({ ...context, hasImages: images.length > 0 }, model);
  // Photos of the job (app "Legg ut oppdrag"): the same prompt, with the images beside it.
  // Low detail: a fixed ~85 tokens each, plenty to see what the work is.
  if (images.length) {
    request.messages[1].content = [
      {
        type: 'text',
        text:
          request.messages[1].content +
          '\n\nThe attached photos show the job. Describe the work you can see in them as the customer would; ' +
          'never mention the photos themselves ("se bildet").',
      },
      ...images.map((file) => ({
        type: 'image_url',
        image_url: {
          url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
          detail: 'low',
        },
      })),
    ];
  }
  const completion = await getClient().chat.completions.create(request);
  recordAiUsage(model, completion.usage, images.length ? 'image' : 'text'); // token counts only, for the cost center
  const choice = completion.choices && completion.choices[0];

  // A strict-schema refusal is a distinct outcome from a bad answer: the model
  // declined rather than returned something malformed.
  if (choice && choice.message && choice.message.refusal) {
    throw new Error(`AI declined to answer: ${choice.message.refusal}`);
  }

  const rawText = ((choice && choice.message && choice.message.content) || '').toString().trim();
  if (!rawText) throw new Error('OpenAI returnerte tomt svar');

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    // Only reachable on models without strict-schema support. Never surface the
    // raw model text to the client — it is unvalidated and may echo user input.
    console.error('[ai] model returned unparseable JSON', { model: MODEL, length: rawText.length });
    throw new Error('AI returnerte et svar som ikke kunne tolkes');
  }
  return { parsed, usage: completion.usage };
}

/** Same allowlist used by jobListingPrompt.js — models that support strict json_schema. */
function _visionSupportsStrictSchema(model) {
  const m = String(model || '');
  if (/^gpt-3\.5/.test(m)) return false;
  if (/^gpt-4-/.test(m) || m === 'gpt-4') return false;
  if (/^gpt-4o-mini-(search|transcribe|tts)/.test(m)) return false;
  return /^(gpt-4o|gpt-4\.1|gpt-5|o[134])/.test(m);
}

async function _callVisionAi(file, categoryNames, lang) {
  const useStrictSchema = _visionSupportsStrictSchema(VISION_MODEL);

  const systemContent =
    `You are Jobblo's image-based job creation assistant. Analyze only the visible work. ` +
    `Return Norwegian bokmål unless the requested language is English. Do not invent ` +
    `specific measurements, materials, dates, or conditions. Category must be exactly one ` +
    `of these active Jobblo categories, or an empty string if unclear: ${JSON.stringify(categoryNames)}. ` +
    `Prices and time are estimates, never guarantees.` +
    (!useStrictSchema
      ? ` Respond with a single JSON object with keys: title (string), description (string), ` +
        `category (string), duration ({value: number, unit: "minutes"|"hours"|"days"}), ` +
        `durationRange ({min: number, max: number, unit: "minutes"|"hours"|"days"}), ` +
        `suggestedPrice (number), priceMin (number), priceMax (number), ` +
        `hourlyRate (number), pricingReasoning (string).`
      : '');

  const visionSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'description',
      'category',
      'duration',
      'durationRange',
      'suggestedPrice',
      'priceMin',
      'priceMax',
      'hourlyRate',
      'pricingReasoning',
    ],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      duration: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'unit'],
        properties: {
          value: { type: 'number' },
          unit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
        },
      },
      durationRange: {
        type: 'object',
        additionalProperties: false,
        required: ['min', 'max', 'unit'],
        properties: {
          min: { type: 'number' },
          max: { type: 'number' },
          unit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
        },
      },
      suggestedPrice: { type: 'number' },
      priceMin: { type: 'number' },
      priceMax: { type: 'number' },
      hourlyRate: { type: 'number' },
      pricingReasoning: { type: 'string' },
    },
  };

  const response = await getClient().chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Requested language: ${lang === 'en' ? 'English' : 'Norwegian bokmål'}. ` +
              'Suggest an editable draft for the work shown in this image.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
          },
        ],
      },
    ],
    response_format: useStrictSchema
      ? {
          type: 'json_schema',
          json_schema: { name: 'jobblo_image_job_suggestion', strict: true, schema: visionSchema },
        }
      : { type: 'json_object' },
  });

  recordAiUsage(VISION_MODEL, response.usage, 'image');
  const choice = response.choices && response.choices[0];
  if (choice?.message?.refusal) throw new Error(`AI declined to answer: ${choice.message.refusal}`);
  const content = choice?.message?.content?.toString().trim();
  if (!content) throw new Error('OpenAI returnerte tomt svar');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('AI returnerte et svar som ikke kunne tolkes');
  }
}

exports.analyzeJobImage = async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AI-tjenesten er ikke konfigurert',
        message: 'Prøv igjen, eller fyll ut feltene manuelt.',
      });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'Et bilde er påkrevd.' });
    }
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Ugyldig bildefil.' });
    }

    const { names: categoryNames } = await _loadCategoryContext();
    const raw = await _callVisionAi(req.file, categoryNames, _resolveLang(req.body));
    console.error('[analyze-job-image] raw AI output:', JSON.stringify(raw));
    const firstPass = validateSmartFillOutput(raw, { categoryAllowList: categoryNames });
    if (!firstPass.valid) {
      return res
        .status(500)
        .json({ success: false, error: 'AI returnerte ugyldige verdier. Prøv igjen.' });
    }

    // category is best-effort from a photo — empty is acceptable, the user can
    // pick one manually. Only re-validate with the category context when we have one.
    const validationCtx = {
      categoryAllowList: categoryNames,
      ...(firstPass.cleaned.category && {
        categoryName: firstPass.cleaned.category,
        userCategory: firstPass.cleaned.category,
      }),
    };
    const validated = validateSmartFillOutput(raw, validationCtx);
    if (!validated.valid) {
      return res
        .status(500)
        .json({ success: false, error: 'AI returnerte ugyldige verdier. Prøv igjen.' });
    }

    const c = validated.cleaned;
    const range = raw.durationRange || {};
    const rangeUnit = ['minutes', 'hours', 'days'].includes(String(range.unit))
      ? range.unit
      : c.duration.unit;
    const min = Number(range.min);
    const max = Number(range.max);
    const durationRange = {
      min: Number.isFinite(min) && min > 0 ? Math.min(min, 240) : c.duration.value,
      max: Number.isFinite(max) && max >= min ? Math.min(max, 240) : c.duration.value,
      unit: rangeUnit,
    };

    return res.json({
      success: true,
      data: {
        title: c.title,
        description: c.description,
        category: c.category,
        duration: c.duration,
        durationRange,
        suggestedPrice: c.suggestedPrice,
        priceMin: c.priceMin,
        priceMax: c.priceMax,
        hourlyRate: c.hourlyRate,
        pricingReasoning: c.pricingReasoning,
        isEstimate: true,
      },
    });
  } catch (err) {
    return _respondWithAiError(res, err, 'analyze-job-image');
  }
};

/** Fields every endpoint returns, so the three responses stay consistent. */
function _sharedPayload(c) {
  return {
    skills: c.skills,
    openQuestions: c.openQuestions,
    hourlyRate: c.hourlyRate,
    suggestedPrice: c.suggestedPrice,
    priceMin: c.priceMin,
    priceMax: c.priceMax,
    estimatedPrice: c.suggestedPrice, // backwards-compat key BasicInformation.tsx uses
    duration: c.duration,
    locationRelevance: c.locationRelevance,
    pricingReasoning: c.pricingReasoning,
    paymentType: c.paymentType,
    isEstimate: true, // UI shows "Dette er et estimat" label
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1) Generate job info (description + price) — called from BasicInformation
//    when user has ALREADY typed a title + picked a category.
// POST /api/ai/generate-job-info
// ──────────────────────────────────────────────────────────────────────────────
exports.generateJobInfo = async (req, res) => {
  try {
    const {
      title,
      category,
      paymentType,
      duration,
      city,
      countyCode,
      equipment,
      urgent,
      existingDescription,
    } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI-tjeneste ikke konfigurert (mangler API-nøkkel)' });
    }
    if (!title || title.trim().length < 5) {
      return res
        .status(400)
        .json({ error: 'Tittel må fylles ut (min. 5 tegn) før AI kan foreslå beskrivelse.' });
    }

    const { names: catNames, chosen: catChosen } = await _loadCategoryContext(category);
    const userPayment = PAYMENT_TYPES.includes(paymentType) ? paymentType : 'Fastpris';

    const { parsed } = await _callAi({
      feature: 'job-info',
      lang: _resolveLang(req.body),
      task: title,
      categoryAllowList: catNames,
      categoryName: catChosen,
      title,
      description: existingDescription,
      paymentType: userPayment,
      userDuration: duration,
      userCity: city,
      userCounty: countyCode,
      equipment,
      urgency: !!urgent,
    });

    const validated = validateSmartFillOutput(parsed, {
      userPaymentType: userPayment,
      categoryName: catChosen,
      categoryAllowList: catNames,
      userCategory: catChosen,
    });

    if (!validated.valid) {
      return res.status(500).json({
        success: false,
        error: 'AI returnerte ugyldige verdier. Prøv igjen.',
        fallback: validated.cleaned,
        validationErrors: validated.errors,
      });
    }

    // Endpoint is called "generate-job-info" — historically kept description /
    // hourlyRate / estimatedPrice / duration / skills / category shape so the
    // frontend BasicInformation.tsx does not need a rewrite.
    const c = validated.cleaned;
    return res.json({
      success: true,
      data: {
        description: c.description,
        category: c.category,
        ..._sharedPayload(c),
      },
    });
  } catch (err) {
    return _respondWithAiError(res, err, 'generate-job-info');
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 2) Generate title — called from BasicInformation when user writes a short
//    free-text blurb about the job.
// POST /api/ai/generate-title
// ──────────────────────────────────────────────────────────────────────────────
exports.generateTitle = async (req, res) => {
  try {
    const { description, category, paymentType, duration, city, countyCode, equipment, urgent } =
      req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI-tjeneste ikke konfigurert' });
    }
    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: 'Beskrivelse for kort (min. 5 tegn).' });
    }

    const { names: catNames, chosen: catChosen } = await _loadCategoryContext(category);
    const userPayment = PAYMENT_TYPES.includes(paymentType) ? paymentType : 'Fastpris';

    const { parsed } = await _callAi({
      feature: 'title',
      lang: _resolveLang(req.body),
      task: description,
      categoryAllowList: catNames,
      categoryName: catChosen,
      description,
      paymentType: userPayment,
      userDuration: duration,
      userCity: city,
      userCounty: countyCode,
      equipment,
      urgency: !!urgent,
    });

    const validated = validateSmartFillOutput(parsed, {
      userPaymentType: userPayment,
      categoryName: catChosen,
      categoryAllowList: catNames,
      userCategory: catChosen,
    });

    if (!validated.valid) {
      return res.status(500).json({
        success: false,
        error: 'Kunne ikke generere tittel. Prøv igjen med litt mer detaljer.',
        validationErrors: validated.errors,
      });
    }

    const c = validated.cleaned;
    return res.json({
      success: true,
      data: {
        title: c.title,
        ..._sharedPayload(c),
      },
    });
  } catch (err) {
    return _respondWithAiError(res, err, 'generate-title');
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 3) Generate full listing — used by the top Smart Fill chip on /publish-job.
//    Accepts a full free-text prompt + any ALREADY-TYPED user fields so AI
//    does NOT clobber good manual input.
// POST /api/ai/generate-full-listing
// ──────────────────────────────────────────────────────────────────────────────
exports.generateFullJobListing = async (req, res) => {
  try {
    const {
      prompt,
      // Optional: fields the user has already typed manually. Backend writes
      // these into the prompt context ("don't overwrite") AND the validator
      // prefers them if AI's suggestion is clearly worse.
      existingTitle,
      existingDescription,
      existingCategory,
      existingPaymentType,
      existingDuration,
      existingCity,
      existingCounty,
      existingEquipment,
      existingUrgent,
    } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'AI-tjeneste ikke konfigurert' });
    }
    if (!prompt || prompt.trim().length < 5) {
      return res.status(400).json({ error: 'Vennligst beskriv jobben (min. 5 tegn).' });
    }

    // Multipart (with photos) sends every field as text.
    const images = (req.files || []).slice(0, 3);
    let duration = existingDuration;
    if (typeof duration === 'string') {
      try {
        duration = JSON.parse(duration);
      } catch {
        duration = undefined;
      }
    }

    const { names: catNames, chosen: catChosen } = await _loadCategoryContext(existingCategory);
    const userPayment = PAYMENT_TYPES.includes(existingPaymentType)
      ? existingPaymentType
      : 'Fastpris';

    const { parsed } = await _callAi(
      {
        feature: 'full-listing',
        lang: _resolveLang(req.body),
        task: prompt,
        categoryAllowList: catNames,
        categoryName: catChosen,
        title: existingTitle,
        description: existingDescription,
        paymentType: userPayment,
        userDuration: duration,
        userCity: existingCity,
        userCounty: existingCounty,
        equipment: existingEquipment,
        urgency: existingUrgent === true || existingUrgent === 'true',
      },
      images
    );

    const validated = validateSmartFillOutput(parsed, {
      userPaymentType: userPayment,
      categoryName: catChosen,
      categoryAllowList: catNames,
      userCategory: catChosen,
    });

    if (!validated.valid) {
      return res.status(500).json({
        success: false,
        error: 'AI returnerte ugyldige data. Prøv igjen, eller fyll ut feltene manuelt.',
        validationErrors: validated.errors,
        fallback: validated.cleaned,
      });
    }

    const c = validated.cleaned;
    return res.json({
      success: true,
      data: {
        title: c.title,
        description: c.description,
        category: c.category,
        priceRange: { min: c.priceMin, max: c.priceMax },
        ..._sharedPayload(c),
      },
    });
  } catch (err) {
    return _respondWithAiError(res, err, 'generate-full-listing');
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Category suggestions for the one-question-per-screen flow (app "Legg ut oppdrag").
// Up to 3 photos and/or a short text → up to 3 active categories, best first.
// Images go as `detail: 'low'` (a fixed ~85 tokens each): enough to tell painting from
// moving, and the call stays fast and cheap.
// ──────────────────────────────────────────────────────────────────────────────
const MAX_SUGGESTION_IMAGES = 3;
const MAX_SUGGESTION_TEXT = 500;

/** Keep only active category names (case-insensitive match), no duplicates, at most 3. Pure. */
function pickSuggestedCategories(raw, names) {
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const out = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const name = byLower.get(
      String(value || '')
        .trim()
        .toLowerCase()
    );
    if (name && !out.includes(name)) out.push(name);
    if (out.length === 3) break;
  }
  return out;
}

exports.suggestCategories = async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res
        .status(500)
        .json({
          success: false,
          error: 'AI-tjenesten er ikke konfigurert',
          message: 'Velg kategori selv.',
        });
    }
    const files = (req.files || []).slice(0, MAX_SUGGESTION_IMAGES);
    const text =
      typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_SUGGESTION_TEXT) : '';
    if (!files.length && !text) {
      return res
        .status(400)
        .json({ success: false, error: 'Legg til et bilde eller en kort beskrivelse.' });
    }

    const { names } = await _loadCategoryContext();
    if (!names.length) return res.json({ success: true, suggestions: [] });

    const strict = _visionSupportsStrictSchema(VISION_MODEL);
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['categories'],
      properties: { categories: { type: 'array', items: { type: 'string', enum: names } } },
    };
    const response = await getClient().chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 80,
      messages: [
        {
          role: 'system',
          content:
            'You sort jobs on Jobblo, a Norwegian marketplace for small jobs. From the photos and/or text, ' +
            'pick the 3 categories the job most likely belongs to, best first, from exactly this list: ' +
            `${JSON.stringify(names)}. Fewer than 3 only if the list has fewer.` +
            (strict ? '' : ' Respond with a JSON object: {"categories": [string, ...]}.'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: text ? `The customer wrote: ${text}` : 'Photos of the job:' },
            ...files.map((file) => ({
              type: 'image_url',
              image_url: {
                url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
                detail: 'low',
              },
            })),
          ],
        },
      ],
      response_format: strict
        ? {
            type: 'json_schema',
            json_schema: { name: 'jobblo_category_suggestions', strict: true, schema },
          }
        : { type: 'json_object' },
    });
    recordAiUsage(VISION_MODEL, response.usage, files.length ? 'image' : 'text');

    let parsed = {};
    try {
      parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = {};
    }
    return res.json({
      success: true,
      suggestions: pickSuggestedCategories(parsed.categories, names),
    });
  } catch (err) {
    return _respondWithAiError(res, err, 'suggest-categories');
  }
};
exports.pickSuggestedCategories = pickSuggestedCategories;

// ──────────────────────────────────────────────────────────────────────────────
// Camera helper (app "Legg ut oppdrag"): after each photo, one short line on what the AI
// sees and what to photograph next, and whether the photo should be retaken.
// One low-detail image (~85 tokens) and a tiny answer: fast and cheap enough per photo.
// ──────────────────────────────────────────────────────────────────────────────
const PHOTO_QUALITIES = ['ok', 'blurry', 'dark', 'unclear'];
// Said instead of a model hint that only calls the photo unclear: guidance, not an error.
const PHOTO_UNCLEAR_HINT = {
  en: "I can't quite see what needs doing yet – take a photo of the area or thing that needs work.",
  no: 'Jeg ser ikke helt hva som skal gjøres ennå – ta et bilde av området eller tingen som trenger arbeid.',
};
const PHOTO_DONE_HINT = {
  en: 'Looks good – tap Done, or add another angle if you like.',
  no: 'Ser bra ut – trykk Ferdig, eller ta et bilde fra en annen vinkel om du vil.',
};
// The kinds of view the helper asks for, in both languages.
const PHOTO_VIEWS = {
  closeup: /close-?up|nærbilde|detail|detalj/i,
  overview: /overview|whole (area|room)|wide|oversikt|hele (rommet|området)/i,
  angle: /angle|vinkel/i,
  size: /size|measure|størrelse|mål/i,
  access: /access|entrance|adkomst|inngang/i,
};
/** Pure: does `hint` ask for a kind of view an earlier hint already asked for? */
function repeatsAdvice(hint, earlierHints) {
  const kinds = (text) => Object.keys(PHOTO_VIEWS).filter((k) => PHOTO_VIEWS[k].test(text));
  const asked = new Set(earlierHints.flatMap(kinds));
  const now = kinds(hint);
  return now.length > 0 && now.every((k) => asked.has(k));
}
exports.repeatsAdvice = repeatsAdvice;

exports.photoHint = async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ success: false, error: 'AI-tjenesten er ikke konfigurert' });
    if (!req.file?.buffer)
      return res.status(400).json({ success: false, error: 'Et bilde er påkrevd.' });
    const lang = _resolveLang(req.body);
    const count = Math.max(1, Math.min(6, parseInt(req.body?.count, 10) || 1));
    // What the earlier photos showed and the advice already given, so the helper does not say
    // "take a close-up" after every photo. Multipart sends them as JSON text; bad input is ignored.
    const list = (raw) => {
      try {
        const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(v)
          ? v
              .filter((x) => typeof x === 'string' && x.trim())
              .slice(-5)
              .map((x) => x.trim().slice(0, 160))
          : [];
      } catch {
        return [];
      }
    };
    const earlierSeen = list(req.body?.previousSeen);
    const earlierHints = list(req.body?.previousHints);
    const strict = _visionSupportsStrictSchema(VISION_MODEL);
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['hint', 'seen', 'quality'],
      properties: {
        hint: { type: 'string' },
        seen: { type: 'string' },
        quality: { type: 'string', enum: PHOTO_QUALITIES },
      },
    };
    const response = await getClient().chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.3,
      max_tokens: 90,
      messages: [
        {
          role: 'system',
          content:
            'You are the camera helper in Jobblo, where people post small jobs they want done (painting, cleaning, moving, ' +
            'garden, repairs, assembly). The user just took photo number ' +
            count +
            ' of up to 6. Answer in ' +
            (lang === 'en' ? 'English' : 'Norwegian bokmål') +
            '. hint: ONE short, friendly sentence (max 22 words). If the ' +
            'photo should be retaken, say why. Otherwise look at ALL photos so far and ask for the ONE view that is still ' +
            'missing for a pro to understand the job (an overview of the whole area, a close-up of the problem, something ' +
            'showing size, the access) - never a view already shown or already asked for. If nothing important is missing ' +
            '(usually after an overview and a close-up, or from photo 3), say the photos look good and they can tap Done. ' +
            'You see a small, low-resolution preview: never judge sharpness from its resolution. quality "blurry" only ' +
            'when the subject is clearly out of focus or smeared by motion, "dark" only when you cannot make out the subject; ' +
            'then the photo should be retaken. Be generous otherwise: most photos show a ' +
            'place or thing that needs work even when the problem is subtle (a room to clean, a wall to paint, furniture ' +
            'to move or assemble, a garden) - that is "ok". Use "unclear" only when the photo is almost empty, covered or ' +
            'shows nothing recognisable. The hint always guides the next step; never answer only that the photo is unclear. ' +
            'seen: what the photo shows that matters for the job, as plain facts for the listing text (max 15 words, same ' +
            'language, no advice, empty when unclear). Never mention people.' +
            (strict
              ? ''
              : ' Respond with a JSON object: {"hint": string, "seen": string, "quality": "ok"|"blurry"|"dark"|"unclear"}.'),
        },
        {
          role: 'user',
          content: [
            ...(earlierSeen.length || earlierHints.length
              ? [
                  {
                    type: 'text',
                    text: `Earlier photos showed: ${earlierSeen.join('; ') || '—'}. Advice already given: ${earlierHints.join(' | ') || '—'}.`,
                  },
                ]
              : []),
            {
              type: 'image_url',
              image_url: {
                url: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      response_format: strict
        ? { type: 'json_schema', json_schema: { name: 'jobblo_photo_hint', strict: true, schema } }
        : { type: 'json_object' },
    });
    recordAiUsage(VISION_MODEL, response.usage, 'image');

    let parsed = {};
    try {
      parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = {};
    }
    let hint = typeof parsed.hint === 'string' ? parsed.hint.trim().slice(0, 200) : '';
    // The model still tends to ask for "a close-up" after every photo. Asking again for a view it
    // already asked for is replaced: the user has done that, so the set is good enough.
    const quality = PHOTO_QUALITIES.includes(parsed.quality) ? parsed.quality : 'ok';
    if (quality === 'ok' && hint && repeatsAdvice(hint, earlierHints))
      hint = PHOTO_DONE_HINT[lang === 'en' ? 'en' : 'no'];
    // "The photo is unclear" read like an error to testers, while the listing text (which also
    // uses the category and details) came out fine. Unclear photos get guidance instead.
    if (quality === 'unclear' || /\b(unclear|not clear|uklart|utydelig)\b/i.test(hint)) {
      if (quality !== 'blurry' && quality !== 'dark')
        hint = PHOTO_UNCLEAR_HINT[lang === 'en' ? 'en' : 'no'];
    }
    if (!hint) return res.status(502).json({ success: false, error: 'AI ga ikke noe svar.' });
    // `seen` feeds the title/description later (the app keeps one per photo).
    const seen = typeof parsed.seen === 'string' ? parsed.seen.trim().slice(0, 160) : '';
    return res.json({ success: true, hint, seen, quality });
  } catch (err) {
    return _respondWithAiError(res, err, 'photo-hint');
  }
};
