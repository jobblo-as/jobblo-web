const express = require('express');
const router = express.Router();
const { authenticate, requireVerifiedEmail } = require('../middleware/auth');
const c = require('../controllers/stripeConnectController');

router.post('/account',      authenticate, requireVerifiedEmail, c.createOrGetAccount);
router.post('/account-link', authenticate, requireVerifiedEmail, c.createAccountLink);
router.post('/refresh',      authenticate, c.refreshAccountStatus);
router.get('/status',        authenticate, c.getStatus);

module.exports = router;
