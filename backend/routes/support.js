const express = require('express');
const router = express.Router();
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const supportController = require('../controllers/supportController');
const { makeLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');

// Anonymous, and every ticket is a DB row plus staff work: its own budget beyond the global one.
const ticketLimiter = makeLimiter('support-ticket', {
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange henvendelser. Prøv igjen om en time.' }, // same shape as the controller's errors
});

/**
 * Support requests. `createTicket` is deliberately open to logged-out visitors:
 * someone who cannot log in is the person most likely to need help. It runs
 * `optionalAuthenticate` so a signed-in caller is still recognised — the form
 * hides the e-mail field for members and relies on `req.userId` to look up the
 * account address, so without this the ticket would be rejected for exactly the
 * users we can already identify.
 */
// Multipart for a bug report's screenshots (up to 3 images, private); JSON still works.
router.post(
  '/tickets',
  ticketLimiter,
  optionalAuthenticate,
  upload.array('screenshots', 3),
  supportController.createTicket
);
router.get('/tickets/mine', authenticate, supportController.getMyTickets);

module.exports = router;
