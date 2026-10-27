const multer = require('multer');
const sharp = require('sharp');
const {
  uploadBufferToAzure,
  sniffFileType,
  IMAGE_TYPES,
  DOCUMENT_TYPES,
} = require('../utils/azureUpload');
const { makeLimiter } = require('./rateLimiter');

// File uploads, per user (every route runs it after authenticate): 60 multipart requests per
// 15 minutes, so a script cannot fill storage. JSON edits on the same routes do not count.
const uploadLimiter = makeLimiter('upload', {
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: (req) => !req.is('multipart/form-data'),
  keyGenerator: (req) =>
    req.userId ? `u:${req.userId}` : require('express-rate-limit').ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange opplastinger. Prøv igjen om 15 minutter.' },
});

// Social share cards (WhatsApp/Facebook) only render the big landscape card when the
// fetched image really is a wide ~1200×630. User uploads are any shape, and Azure Blob
// cannot resize from a URL the way Cloudinary can — so we derive a fixed 1200×630 JPEG
// once, at upload time, and store it alongside the original. `fit: 'cover'` crops to the
// frame; a white flatten covers PNG/WEBP transparency so the card is never see-through.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// A 16000×16000 PNG is a few KB but took 1.3 s of CPU here (sharp's default ceiling is 268 MP);
// 40 MP covers any photo a phone sends. Over it sharp throws and the post keeps its original.
async function makeOgBuffer(buffer) {
  return sharp(buffer, { limitInputPixels: 40e6 })
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'attention' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

// Buffers uploads in memory and pushes them to Azure Blob in a post-multer step,
// exposing the SAME file.path (URL) + file.filename (blobName) shape the
// controllers (userController, serviceController) already read.

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'application/pdf',
]);

// Text-field caps for EVERY multer instance (spread into each `limits`). multer's defaults are
// unlimited: 40 fields of 1 MB each were accepted.
const MULTIPART_LIMITS = { fields: 50, fieldSize: 64 * 1024, parts: 60 };

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    ...MULTIPART_LIMITS,
    fileSize: MAX_FILE_BYTES,
    files: 6, // matches the "inntil 6 bilder" the job form promises
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    const err = new Error('Ugyldig filtype. Last opp JPG, PNG, WEBP eller PDF.');
    err.code = 'INVALID_FILE_TYPE';
    cb(err);
  },
});

// User routes mount under /users -> profile images; everything else is a job.
function folderFor(req) {
  return req.baseUrl.includes('users') ? 'profile_images' : 'job_images';
}

// Certifications are documents (PDF allowed) and private; every other user of this
// middleware is a photo.
const isCertification = (req) => req.path.startsWith('/certifications');

function filesOf(req) {
  const all = [];
  if (req.file) all.push(req.file);
  if (Array.isArray(req.files)) all.push(...req.files);
  else if (req.files) for (const key of Object.keys(req.files)) all.push(...req.files[key]);
  return all;
}

// multer parses `tags[50000000]=a` into a 50M-element array (5 s and 1 GB when Mongoose casts
// it) and `email[$ne]=x` into an operator object. Neither is anything our forms send.
function badFormValue(v) {
  if (Array.isArray(v)) return v.length > 100 || v.some(badFormValue);
  if (v && typeof v === 'object')
    return Object.keys(v).some((k) => k.startsWith('$') || badFormValue(v[k]));
  return false;
}

/** After multer: 400 on a multipart body with a huge array or a `$` key. JSON bodies pass. */
function checkMultipartBody(req, res, next) {
  if (req.is('multipart/form-data') && badFormValue(req.body)) {
    return res.status(400).json({ error: 'Ugyldige skjemafelt.' });
  }
  next();
}

/**
 * After multer: refuse any file whose first bytes are not one of `allowed`, and replace the
 * client's Content-Type with the real one so controllers and storage read the truth.
 */
function checkFileTypes(allowed) {
  // Every multer route runs this next, so the body guard rides along here instead of per route.
  return (req, res, next) =>
    checkMultipartBody(req, res, () => {
      for (const file of filesOf(req)) {
        const type = sniffFileType(file.buffer);
        if (!allowed.includes(type)) {
          const err = new Error(
            allowed.includes('application/pdf')
              ? 'Ugyldig filtype. Last opp JPG, PNG, WEBP eller PDF.'
              : 'Ugyldig filtype. Last opp JPG, PNG eller WEBP.'
          );
          err.code = 'INVALID_FILE_TYPE';
          return next(err);
        }
        file.mimetype = type;
      }
      next();
    });
}

// Upload each buffered file to Azure, then attach: file.path = URL,
// file.filename = blobName (what deletion needs).
async function pushToAzure(req) {
  const folder = folderFor(req);
  const priv = isCertification(req);

  for (const file of filesOf(req)) {
    const { url, blobName } = await uploadBufferToAzure(file, folder, { private: priv });
    file.path = url;
    file.filename = blobName;

    // Only images get an OG derivative; a PDF (report evidence) has no card use.
    if (folder === 'job_images' && /^image\//.test(file.mimetype || '')) {
      try {
        const ogBuffer = await makeOgBuffer(file.buffer);
        const { url: ogUrl, blobName: ogBlobName } = await uploadBufferToAzure(
          { buffer: ogBuffer, originalname: 'og.jpg', mimetype: 'image/jpeg' },
          `${folder}/og`
        );
        file.ogPath = ogUrl;
        file.ogFilename = ogBlobName;
      } catch (err) {
        // A bad OG render must never block the real upload — the card just falls back
        // to the original image (small-thumbnail) instead of failing the whole post.
        console.error('OG image generation failed: %s', err.message);
      }
    }
  }
}

// Wrap a multer middleware so the Azure upload runs right after it, before the
// controller. Errors from either step flow to the same next().
function wrap(multerMw) {
  return (req, res, next) => {
    uploadLimiter(req, res, (limitErr) => {
      if (limitErr) return next(limitErr);
      multerMw(req, res, (err) => {
        if (err) return next(err);
        checkFileTypes(isCertification(req) ? DOCUMENT_TYPES : IMAGE_TYPES)(req, res, (typeErr) => {
          if (typeErr) return next(typeErr);
          pushToAzure(req)
            .then(() => next())
            .catch(next);
        });
      });
    });
  };
}

// Same call surface as before: upload.single(...), .array(...), .fields(...).
const upload = {
  single: (field) => wrap(multerUpload.single(field)),
  array: (field, max) => wrap(multerUpload.array(field, max)),
  fields: (fields) => wrap(multerUpload.fields(fields)),
  none: () => multerUpload.none(),
};

module.exports = upload;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
// For routes with their own multer config (chat reports, order evidence, review photos, …).
module.exports.checkFileTypes = checkFileTypes;
module.exports.uploadLimiter = uploadLimiter;
module.exports.MULTIPART_LIMITS = MULTIPART_LIMITS;
module.exports.checkMultipartBody = checkMultipartBody;
module.exports.IMAGE_TYPES = IMAGE_TYPES;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
// Reused by scripts/backfillOgImages.js so old listings get the same 1200×630 JPEG.
module.exports.makeOgBuffer = makeOgBuffer;
