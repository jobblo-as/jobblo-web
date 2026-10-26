const multer = require('multer');
const { MULTIPART_LIMITS } = require('./upload');

const storage = multer.memoryStorage();

module.exports = multer({
  storage,
  limits: { ...MULTIPART_LIMITS, fileSize: 5 * 1024 * 1024 },
});
