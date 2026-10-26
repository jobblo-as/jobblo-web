const { sendSuccess, asyncHandler } = require('../../utils/apiResponse');
const { listWorkers } = require('../../services/monitoring/workers');

// ── API workers (cluster): one row per process, from their Redis heartbeats ──────────────────
const getWorkers = asyncHandler(async (req, res) => sendSuccess(res, await listWorkers()));

module.exports = { getWorkers };
