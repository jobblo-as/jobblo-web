const express = require('express');
const { isValidObjectId } = require('mongoose');
const JobDraft = require('../models/JobDraft');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const MAX_DRAFTS = 20;
const MAX_BYTES = 32000;

/** The body is the form state; it must be a plain object that fits the stored limit. */
const parseBody = (body) => {
  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { error: 'Utkastet mangler innhold.' };
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_BYTES) return { error: 'Utkastet er for stort.' };
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 200) : '';
  return { json, title };
};

const toClient = (d) => ({
  _id: d._id,
  title: d.title,
  updatedAt: d.updatedAt,
  data: d.data ? JSON.parse(d.data) : undefined,
});

/** Owner-scoped lookup; a bad or foreign id is the same 404. */
const findMine = (req) =>
  isValidObjectId(req.params.id)
    ? JobDraft.findOne({ _id: req.params.id, user: req.user._id })
    : null;

router.get('/', async (req, res, next) => {
  try {
    const drafts = await JobDraft.find({ user: req.user._id })
      .select('title updatedAt')
      .sort({ updatedAt: -1 })
      .limit(MAX_DRAFTS)
      .lean();
    res.json({ drafts: drafts.map(toClient) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const draft = await findMine(req)?.lean();
    if (!draft) return res.status(404).json({ error: 'Fant ikke utkastet.' });
    res.json({ draft: toClient(draft) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { json, title, error } = parseBody(req.body);
    if (error) return res.status(400).json({ error });
    // ponytail: count-then-insert can let two parallel creates pass at 19; harmless overshoot of one.
    if ((await JobDraft.countDocuments({ user: req.user._id })) >= MAX_DRAFTS)
      return res.status(409).json({
        error: `Du kan ha maks ${MAX_DRAFTS} utkast. Slett et gammelt først.`,
        code: 'DRAFT_LIMIT',
      });
    const draft = await JobDraft.create({ user: req.user._id, title, data: json });
    res
      .status(201)
      .json({ draft: { _id: draft._id, title: draft.title, updatedAt: draft.updatedAt } });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { json, title, error } = parseBody(req.body);
    if (error) return res.status(400).json({ error });
    if (!isValidObjectId(req.params.id))
      return res.status(404).json({ error: 'Fant ikke utkastet.' });
    const draft = await JobDraft.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { title, data: json },
      { new: true, projection: { title: 1, updatedAt: 1 } }
    ).lean();
    if (!draft) return res.status(404).json({ error: 'Fant ikke utkastet.' });
    res.json({ draft });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const draft = await findMine(req)?.deleteOne();
    if (!draft?.deletedCount) return res.status(404).json({ error: 'Fant ikke utkastet.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
