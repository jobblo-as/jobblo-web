const express = require('express');
const router = express.Router();
const multer = require('multer');
const { checkFileTypes, DOCUMENT_TYPES, MULTIPART_LIMITS } = require('../middleware/upload');
// Report evidence: buffered here, type checked from the bytes (checkFileTypes), uploaded by
// submitChatReport only after the participant checks pass.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { ...MULTIPART_LIMITS, fileSize: 10 * 1024 * 1024, files: 5 }, // 10 MB per file
});

const chatController = require('../controllers/chatController');
const {
  submitChatReport,
  getMyChatReports,
  reportSubmitLimiter,
} = require('../controllers/chatReportController');
const { authenticate } = require('../middleware/auth');

// Applying already consumes contact entitlement on /orders/request. Opening that
// applicant's existing job conversation must not consume it a second time.
router.post('/create', authenticate, chatController.createOrGetChat);
router.get('/get', authenticate, chatController.getMyChats);
router.get('/:chatId', authenticate, chatController.getChatById);
router.post('/:chatId/message', authenticate, chatController.sendMessage);
router.post('/:chatId/payments', authenticate, chatController.createPaymentSession);
router.post('/:chatId/contracts', authenticate, chatController.createContract);
router.patch('/:chatId/agreed-price', authenticate, chatController.updateAgreedPrice);
router.delete('/:chatId', authenticate, chatController.deleteChat);
router.patch('/:chatId/delete-for-me', authenticate, chatController.deleteForMe);

// ── Chat Reports (user-facing) ─────────────────────────────────────────────
// POST /api/chats/:chatId/reports — with optional evidence files (max 5, 10 MB each)
router.post(
  '/:chatId/reports',
  authenticate,
  reportSubmitLimiter,
  upload.array('evidence', 5),
  checkFileTypes(DOCUMENT_TYPES),
  submitChatReport
);
// GET /api/chats/:chatId/reports/me — the authenticated user's own reports for this chat
router.get('/:chatId/reports/me', authenticate, getMyChatReports);

module.exports = router;
