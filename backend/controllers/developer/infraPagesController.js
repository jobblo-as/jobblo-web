const { sendSuccess, asyncHandler } = require('../../utils/apiResponse');

// ── Nginx / PM2 / Caching pages (read-only; each part reports "not available" with a reason) ──
const getNginx = asyncHandler(async (req, res) =>
  sendSuccess(res, await require('../../services/monitoring/nginx').nginxOverview())
);
const getPm2 = asyncHandler(async (req, res) =>
  sendSuccess(res, await require('../../services/monitoring/pm2').pm2Overview())
);
const getCaching = asyncHandler(async (req, res) =>
  sendSuccess(res, await require('../../services/monitoring/caching').cachingOverview())
);

module.exports = { getNginx, getPm2, getCaching };
