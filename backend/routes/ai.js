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
		return res.status(413).json({ success: false, error: 'Teksten er for lang for AI. Kort den ned og prøv igjen.' });
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
router.post('/generate-job-info', authenticate, aiLimiter, capAiInput, aiController.generateJobInfo);

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
router.post('/generate-full-listing', authenticate, aiLimiter, capAiInput, aiController.generateFullJobListing);

module.exports = router;
