const express = require('express');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/pushTokenController');

const router = express.Router();
router.post('/', authenticate, controller.register);
router.delete('/current', authenticate, controller.deactivateCurrent);
// Per-group push on/off (Varslingsinnstillinger in the app).
router.get('/preferences', authenticate, controller.getPreferences);
router.put('/preferences', authenticate, controller.updatePreferences);

module.exports = router;
