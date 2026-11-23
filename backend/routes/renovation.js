const crypto = require('crypto');
const express = require('express');
const { ipKeyGenerator } = require('express-rate-limit');
const { makeLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { parseObjectId } = require('../utils/pagination');
const RenovationPlan = require('../models/RenovationPlan');
const {
  parsePlan,
  estimate,
  catalogue,
  AREA_KEYS,
  HOME_TYPES,
} = require('../services/renovation/estimate');

/**
 * Renovation planner ("Oppussingskalkulator"). The calculator is public: people use it before
 * they have an account, and it is pure arithmetic over the pricing config, so the limit is only
 * against abuse. Saved plans belong to a signed-in user; a shared plan is readable by anyone
 * with its link. Reading facts from a listing is AI and lives in routes/ai.js.
 */
const router = express.Router();

const MAX_PLANS = 20;

const estimateLimiter = makeLimiter('renovation-estimate', {
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange forespørsler. Prøv igjen senere.' },
});

router.get('/catalogue', (req, res) => {
  res.json(catalogue());
});

router.post('/estimate', estimateLimiter, (req, res) => {
  const { error, plan } = parsePlan(req.body);
  if (error) return res.status(400).json({ error });
  return res.json(estimate(plan));
});

/** "12345678", "finnkode=12345678" or a FINN URL → the code; '' when there is none. */
const finnCodeOf = (value) => {
  if (typeof value !== 'string') return '';
  const match =
    value.match(/(?:finnkode=|\/)(\d{6,12})(?:\D|$)/) || value.match(/^\s*(\d{6,12})\s*$/);
  return match ? match[1] : '';
};

/** The saved-plan body: everything parsePlan checks, plus title, year, home type, notes, FINN code. */
function parseSavedPlan(body) {
  const { error, plan } = parsePlan(body);
  if (error) return { error };
  const year = Number(body?.facts?.yearBuilt);
  const notes = Array.isArray(body?.notes) ? body.notes : [];
  return {
    doc: {
      title:
        (typeof body?.title === 'string' && body.title.trim().slice(0, 120)) ||
        'Min oppussingsplan',
      plan,
      yearBuilt:
        Number.isInteger(year) && year >= 1600 && year <= new Date().getFullYear() + 2
          ? year
          : undefined,
      homeType: HOME_TYPES.includes(body?.facts?.homeType) ? body.facts.homeType : undefined,
      notes: notes
        .filter(
          (n) => n && AREA_KEYS.includes(n.area) && typeof n.text === 'string' && n.text.trim()
        )
        .slice(0, 8)
        .map((n) => ({ area: n.area, text: n.text.trim().slice(0, 160) })),
      finnCode: finnCodeOf(body?.finnCode) || undefined,
    },
  };
}

/**
 * A stored plan's estimate at today's rates. Stored plans are re-checked first: an area or
 * quality removed from the config since the plan was saved must not crash the page.
 */
const estimateSaved = (doc) => {
  const { error, plan } = parsePlan(doc.plan);
  return error ? null : estimate(plan);
};

const toClient = (doc, { withOwnerFields = true } = {}) => ({
  ...(withOwnerFields ? { _id: doc._id, shareId: doc.shareId || null } : {}),
  title: doc.title,
  plan: doc.plan,
  yearBuilt: doc.yearBuilt ?? null,
  homeType: doc.homeType || null,
  notes: doc.notes || [],
  finnCode: doc.finnCode || null,
  updatedAt: doc.updatedAt,
  estimate: estimateSaved(doc),
});

/** Owner-scoped lookup; a bad or foreign id is the same 404. */
const findMine = (req) => {
  const id = parseObjectId(req.params.id);
  return id ? RenovationPlan.findOne({ _id: id, user: req.user._id }) : null;
};

router.get('/plans', authenticate, async (req, res, next) => {
  try {
    const plans = await RenovationPlan.find({ user: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(MAX_PLANS)
      .lean();
    res.json({
      plans: plans.map((p) => {
        const total = estimateSaved(p)?.total;
        return {
          _id: p._id,
          title: p.title,
          updatedAt: p.updatedAt,
          shareId: p.shareId || null,
          total: total ? { low: total.low, high: total.high } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/plans/:id', authenticate, async (req, res, next) => {
  try {
    const plan = await findMine(req)?.lean();
    if (!plan) return res.status(404).json({ error: 'Fant ikke planen.' });
    res.json({ plan: toClient(plan) });
  } catch (err) {
    next(err);
  }
});

router.post('/plans', authenticate, async (req, res, next) => {
  try {
    const { error, doc } = parseSavedPlan(req.body);
    if (error) return res.status(400).json({ error });
    if ((await RenovationPlan.countDocuments({ user: req.user._id })) >= MAX_PLANS)
      return res
        .status(409)
        .json({ error: `Du kan ha maks ${MAX_PLANS} planer. Slett en gammel først.` });
    const plan = await RenovationPlan.create({ ...doc, user: req.user._id });
    res.status(201).json({ plan: toClient(plan.toObject()) });
  } catch (err) {
    next(err);
  }
});

router.put('/plans/:id', authenticate, async (req, res, next) => {
  try {
    const { error, doc } = parseSavedPlan(req.body);
    if (error) return res.status(400).json({ error });
    const id = parseObjectId(req.params.id);
    const plan =
      id &&
      (await RenovationPlan.findOneAndUpdate(
        { _id: id, user: req.user._id },
        { $set: doc, ...(doc.finnCode ? {} : { $unset: { finnCode: 1 } }) },
        { new: true, lean: true }
      ));
    if (!plan) return res.status(404).json({ error: 'Fant ikke planen.' });
    res.json({ plan: toClient(plan) });
  } catch (err) {
    next(err);
  }
});

router.delete('/plans/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseObjectId(req.params.id);
    const result = id && (await RenovationPlan.deleteOne({ _id: id, user: req.user._id }));
    if (!result?.deletedCount) return res.status(404).json({ error: 'Fant ikke planen.' });
    res.json({ message: 'Planen er slettet.' });
  } catch (err) {
    next(err);
  }
});

/** Start sharing: one random, unguessable link per plan (the same link on every call). */
router.post('/plans/:id/share', authenticate, async (req, res, next) => {
  try {
    const plan = await findMine(req);
    if (!plan) return res.status(404).json({ error: 'Fant ikke planen.' });
    if (!plan.shareId) {
      plan.shareId = crypto.randomBytes(12).toString('base64url');
      await plan.save();
    }
    res.json({ shareId: plan.shareId });
  } catch (err) {
    next(err);
  }
});

/** Stop sharing: the old link stops working. */
router.delete('/plans/:id/share', authenticate, async (req, res, next) => {
  try {
    const id = parseObjectId(req.params.id);
    const plan =
      id &&
      (await RenovationPlan.findOneAndUpdate(
        { _id: id, user: req.user._id },
        { $unset: { shareId: 1 } },
        { new: true }
      ));
    if (!plan) return res.status(404).json({ error: 'Fant ikke planen.' });
    res.json({ shareId: null });
  } catch (err) {
    next(err);
  }
});

/** A shared plan, read-only. Never says whose plan it is. */
router.get('/shared/:shareId', estimateLimiter, async (req, res, next) => {
  try {
    const { shareId } = req.params;
    if (!/^[A-Za-z0-9_-]{16}$/.test(shareId))
      return res.status(404).json({ error: 'Fant ikke planen.' });
    const plan = await RenovationPlan.findOne({ shareId }).lean();
    if (!plan) return res.status(404).json({ error: 'Fant ikke planen.' });
    res.json({ plan: toClient(plan, { withOwnerFields: false }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.finnCodeOf = finnCodeOf;
