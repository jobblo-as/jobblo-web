const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticate } = require('../middleware/auth');
const imageUpload = require('../middleware/multer');
const { checkFileTypes, IMAGE_TYPES } = require('../middleware/upload');
const { makeLimiter } = require('../middleware/rateLimiter');
const { ipKeyGenerator } = require('express-rate-limit');

// Every call here is a paid OpenAI request: 20 per user per hour (IP when there is no user).
const aiLimiter = makeLimiter('ai', {
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req.userId ? `u:${req.userId}` : ipKeyGenerator(req.ip)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'For mange AI-forespørsler. Prøv igjen om en time.' },
});

// Prompt size is cost: the whole text body goes into the prompt. A real listing (prompt plus
// already-typed fields) is well under this; the global parser alone allowed 12 MB.
const MAX_AI_INPUT_CHARS = 8000;
function capAiInput(req, res, next) {
  if (JSON.stringify(req.body || {}).length > MAX_AI_INPUT_CHARS) {
    return res
      .status(413)
      .json({ success: false, error: 'Teksten er for lang for AI. Kort den ned og prøv igjen.' });
  }
  // The controllers call .trim() on these; an object or array there threw instead of a 400.
  for (const key of ['title', 'description', 'prompt']) {
    if (req.body?.[key] !== undefined && typeof req.body[key] !== 'string') {
      return res.status(400).json({ success: false, error: `${key} må være tekst.` });
    }
  }
  next();
}

router.post(
  '/analyze-job-image',
  authenticate,
  aiLimiter,
  imageUpload.single('image'),
  // The controller sends file.mimetype to OpenAI: take it from the bytes, not the client.
  checkFileTypes(IMAGE_TYPES),
  capAiInput,
  aiController.analyzeJobImage
);

// Camera helper hints: one small photo each, up to 6 per job, so a separate and larger budget
// than the 20/h shared by the other AI features.
const photoHintLimiter = makeLimiter('ai-photo-hint', {
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => (req.userId ? `u:${req.userId}` : ipKeyGenerator(req.ip)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'For mange AI-forespørsler. Prøv igjen om en time.' },
});

// App "Legg ut oppdrag", camera: one photo ("image") + `count` (photos taken) + `lang` →
// { hint, quality: 'ok'|'blurry'|'dark'|'unclear' }.
router.post(
  '/photo-hint',
  authenticate,
  photoHintLimiter,
  imageUpload.single('image'),
  checkFileTypes(IMAGE_TYPES),
  capAiInput,
  aiController.photoHint
);

// App "Legg ut oppdrag", category step: up to 3 photos (field "images") and/or `text` →
// { suggestions: [category name, ...] }, at most 3, best first.
router.post(
  '/suggest-categories',
  authenticate,
  aiLimiter,
  imageUpload.array('images', 3),
  checkFileTypes(IMAGE_TYPES),
  capAiInput,
  aiController.suggestCategories
);

/**
 * @swagger
 * /api/ai/generate-job-info:
 *   post:
 *     summary: Generate job description and estimated price
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully generated job info
 *       400:
 *         description: Title is required
 */
router.post(
  '/generate-job-info',
  authenticate,
  aiLimiter,
  capAiInput,
  aiController.generateJobInfo
);

/**
 * @swagger
 * /api/ai/generate-title:
 *   post:
 *     summary: Generate job title based on description
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully generated title
 *       400:
 *         description: Description is required
 */
router.post('/generate-title', authenticate, aiLimiter, capAiInput, aiController.generateTitle);

/**
 * @swagger
 * /api/ai/generate-full-listing:
 *   post:
 *     summary: Generate a complete, structured job listing from a prompt
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully generated full listing
 *       400:
 *         description: Prompt is required
 */
// JSON as before, or multipart with up to 3 photos in "images" (app "Legg ut oppdrag").
router.post(
  '/generate-full-listing',
  authenticate,
  aiLimiter,
  imageUpload.array('images', 3),
  checkFileTypes(IMAGE_TYPES),
  capAiInput,
  aiController.generateFullJobListing
);

module.exports = router;
