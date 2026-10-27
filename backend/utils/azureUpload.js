// utils/azureUpload.js
//
// Single source of truth for image/file storage on Azure Blob Storage.
// Every upload lands in one container (AZURE_CONTAINER_NAME), separated by a
// folder prefix per upload type:
//   job_images/…, profile_images/…, hero/…,
//   orders/<orderId>/evidence/…, reviews/<orderId>/…, report-evidence/…
//
// Blobs are named "<folder>/<uuid>.<ext>". The blob name (the path inside the
// container) is what deletion needs — callers persist it and pass it back to
// deleteFromAzure. deleteFromAzure also accepts a full blob URL for the legacy
// fields that only stored the URL (e.g. Hero.image).
//
// Evidence (orders/…/evidence, report-evidence) and certifications go to
// AZURE_PRIVATE_CONTAINER instead when it is set: a container with no anonymous
// access. Stored URLs there open nothing; signPrivateUrls signs them in API
// responses. Unset = the public container as before, so nothing breaks until
// the owner creates it.
const {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} = require('@azure/storage-blob');
// Node's built-in UUID v4 — no dependency, and (unlike the ESM-only `uuid`
// package) it loads cleanly under Jest's CommonJS runtime.
const { randomUUID } = require('crypto');

const containerName = process.env.AZURE_CONTAINER_NAME || 'bilder-newsub';
const privateContainerName = process.env.AZURE_PRIVATE_CONTAINER || '';
const SAS_TTL_MS = 15 * 60 * 1000;

if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
  console.warn('⚠ AZURE_STORAGE_CONNECTION_STRING mangler i .env');
}

// Lazy singletons. Building the client at require-time would crash the whole
// app on boot if the connection string is missing; deferring it means only the
// upload path fails, and with a clear message.
let _blobServiceClient = null;
function getContainerClient(name = containerName) {
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured');
  }
  if (!_blobServiceClient) {
    _blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
  }
  return _blobServiceClient.getContainerClient(name);
}

// The only types we store, decided by the file's first bytes. The client's Content-Type and
// file name are never trusted: a renamed .html or an SVG (script on the storage domain) has
// none of these signatures and is refused.
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Real type from magic bytes, or null when it is none of EXT. */
function sniffFileType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * Upload one multer file buffer to Azure. Type, extension and name come from the server:
 * the bytes decide the type, the name is a UUID. Unknown bytes throw INVALID_FILE_TYPE (400).
 * @param {{buffer:Buffer}} file
 * @param {string} folder - prefix inside the container (e.g. 'job_images')
 * @param {{private?:boolean}} [opts] - private: evidence/certifications (AZURE_PRIVATE_CONTAINER)
 * @returns {Promise<{url:string, blobName:string}>}
 */
async function uploadBufferToAzure(file, folder = 'misc', opts = {}) {
  const type = sniffFileType(file.buffer);
  if (!type) {
    const err = new Error('Ugyldig filtype. Last opp JPG, PNG, WEBP eller PDF.');
    err.code = 'INVALID_FILE_TYPE';
    err.status = 400;
    throw err;
  }
  const containerClient = getContainerClient(
    opts.private && privateContainerName ? privateContainerName : containerName
  );
  const blobName = `${folder}/${randomUUID()}.${EXT[type]}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: { blobContentType: type },
  });

  return { url: blockBlobClient.url, blobName };
}

/**
 * Upload one multer file buffer to Azure and return just the URL.
 * Thin wrapper for callers that don't track the blob name separately (they
 * delete via the stored URL instead).
 * @param {Object} file - multer file (needs .buffer)
 * @param {string} folder - prefix inside the container
 * @returns {Promise<string>} the blob URL
 */
async function uploadToAzure(file, folder = 'misc', opts) {
  const { url } = await uploadBufferToAzure(file, folder, opts);
  return url;
}

/**
 * Express middleware: every private-container URL in a JSON response gets a read-only SAS
 * valid for 15 minutes. Whoever the endpoint already lets see the record gets a working link;
 * the stored URL alone opens nothing. No-op while AZURE_PRIVATE_CONTAINER is unset, or when
 * the connection string has no account key (cannot sign; logged once).
 * ponytail: one extra stringify per JSON response that mentions the container, and socket
 * payloads are not signed (clients refetch over HTTP). Sign per field if it ever shows up.
 */
let warnedNoKey = false;
function signPrivateUrls(req, res, next) {
  if (!privateContainerName) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    let text;
    try {
      text = JSON.stringify(body);
    } catch {
      return json(body);
    }
    if (!text || !text.includes(`/${privateContainerName}/`)) return json(body);
    const client = getContainerClient(privateContainerName);
    if (!(client.credential instanceof StorageSharedKeyCredential)) {
      if (!warnedNoKey)
        console.warn(
          'AZURE_PRIVATE_CONTAINER set but connection string has no AccountKey; links unsigned'
        );
      warnedNoKey = true;
      return json(body);
    }
    const prefix = `${client.url}/`;
    const expiresOn = new Date(Date.now() + SAS_TTL_MS);
    return json(
      JSON.parse(text, (key, value) => {
        if (typeof value !== 'string' || !value.startsWith(prefix) || value.includes('?'))
          return value;
        const blobName = privateBlobNameFromUrl(value);
        if (!blobName) return value;
        const sas = generateBlobSASQueryParameters(
          {
            containerName: privateContainerName,
            blobName,
            permissions: BlobSASPermissions.parse('r'),
            expiresOn,
          },
          client.credential
        ).toString();
        return `${value}?${sas}`;
      })
    );
  };
  next();
}

/**
 * Turn a stored blob URL back into its blob name (the container-relative path).
 * Needed for the legacy call sites that only persisted the URL (Hero.image).
 * Example:
 *   https://acct.blob.core.windows.net/bilder-newsub/hero/uuid.jpg -> hero/uuid.jpg
 * Returns null when the URL clearly isn't one of our blobs.
 */
function blobNameFromUrl(url, container = containerName) {
  if (!url || typeof url !== 'string' || !container) return null;
  let pathname;
  try {
    pathname = new URL(url).pathname; // "/<container>/<folder>/<file>"
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  // First segment is the container name; the rest is the blob name.
  if (segments.length < 2 || segments[0] !== container) return null;
  return segments.slice(1).join('/');
}
const privateBlobNameFromUrl = (url) => blobNameFromUrl(url, privateContainerName);

/**
 * Does this URL point into the private container? signPrivateUrls signs every such URL in any
 * response, so a user-supplied image field (review photos, portfolio, listing images) holding
 * one would re-publish someone's evidence with fresh links to every reader. Inputs refuse them.
 */
function isPrivateBlobUrl(url) {
  try {
    return privateBlobNameFromUrl(url) !== null;
  } catch {
    return true; // malformed %-escape: refuse rather than guess
  }
}

/**
 * Is this URL one of our own public-container uploads (what /api/upload and the multer
 * middleware return)? Client-supplied image URLs must be: anything else is a tracking pixel,
 * a hotlink or someone else's private evidence. False when storage is not configured.
 */
function isOurPublicBlobUrl(url) {
  try {
    const base = new URL(getContainerClient(containerName).url);
    return (
      new URL(url).origin === base.origin && blobNameFromUrl(url) !== null && !isPrivateBlobUrl(url)
    );
  } catch {
    return false; // not a URL, malformed escape, or no storage configured
  }
}

/**
 * Delete a blob. Best-effort: a missing blob is not an error.
 * Accepts either a blob name (folder/uuid.ext) or a full blob URL — a value
 * that looks like a URL is converted back to its blob name first.
 * A bare blob name does not say which container it is in; names are UUIDs, so
 * with a private container configured both are tried.
 * @param {string} blobNameOrUrl
 */
async function deleteFromAzure(blobNameOrUrl) {
  if (!blobNameOrUrl) return;
  const isUrl = /^https?:\/\//i.test(blobNameOrUrl);
  const targets = [
    [containerName, isUrl ? blobNameFromUrl(blobNameOrUrl) : blobNameOrUrl],
    [
      privateContainerName,
      isUrl ? privateBlobNameFromUrl(blobNameOrUrl) : privateContainerName && blobNameOrUrl,
    ],
  ].filter(([, name]) => name);
  const blobName = targets[0]?.[1];
  if (!blobName) return;
  try {
    for (const [container, name] of targets) {
      await getContainerClient(container).getBlockBlobClient(name).deleteIfExists();
    }
  } catch (error) {
    console.error('Azure delete error for %s: %s', blobName, error.message);
  }
}

/** Listing photos and their OG derivatives (middleware/upload.js, uploadController). */
const LISTING_PREFIX = 'job_images/';

/**
 * A blob name a listing may own: under job_images/, no traversal, no URL syntax.
 * Deliberately not a strict `<uuid>.<ext>` match — historical names include
 * `job_images/<userId>/<uuid>.<ext>` and `job_images/og/<uuid>.jpg`.
 */
function isListingBlobName(name) {
  return (
    typeof name === 'string' &&
    name.length <= 1024 &&
    name.startsWith(LISTING_PREFIX) &&
    !name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') &&
    !/[\u0000-\u001f\\?#%]/.test(name)
  );
}

/**
 * Delete one listing image entry (original + OG derivative) — only when it provably
 * belongs to this listing and to nothing else.
 *
 * imageMetadata used to be accepted from the request body, so a listing could carry
 * `{ blobName: 'profile_images/<victim>.jpg' }` and its owner (or an admin cleaning it
 * up) would delete someone else's file. Persisted metadata is therefore NOT trusted on
 * its own. A blob is deleted only if:
 *   1. it is under job_images/ (never profiles, reviews, evidence, hero, reports);
 *   2. its name is exactly what the entry's own stored URL points at in our container;
 *   3. no other listing references it — job_images/<uuid> names carry no owner, and
 *      another listing's public photo URL is easy to copy into forged metadata.
 * Anything else is skipped (logged) and left in storage: fail closed, orphan at worst.
 *
 * ponytail: check 3 is an unindexed Service scan per blob; add an index on
 * imageMetadata.blobName if listing deletes get slow.
 */
async function deleteListingImage(meta, serviceId) {
  if (!meta) return;
  const Service = require('../models/Service');
  const pairs = [
    [meta.url, meta.blobName],
    [meta.ogUrl, meta.ogBlobName],
  ];
  for (const [url, name] of pairs) {
    if (!name) continue;
    if (!isListingBlobName(name) || blobNameFromUrl(url) !== name) {
      console.warn('Listing image delete refused for service %s: unverifiable blob', serviceId);
      continue;
    }
    try {
      const sharedElsewhere = await Service.exists({
        _id: { $ne: serviceId },
        $or: [
          { images: url },
          { 'imageMetadata.url': url },
          { 'imageMetadata.blobName': name },
          { 'imageMetadata.ogUrl': url },
          { 'imageMetadata.ogBlobName': name },
        ],
      });
      if (sharedElsewhere) {
        console.warn('Listing image delete refused for service %s: blob used elsewhere', serviceId);
        continue;
      }
      await deleteFromAzure(name);
    } catch (error) {
      // Runs after the listing is saved; a storage hiccup must not fail that request.
      console.error('Listing image cleanup failed for service %s: %s', serviceId, error.message);
    }
  }
}

module.exports = {
  uploadBufferToAzure,
  uploadToAzure,
  deleteFromAzure,
  deleteListingImage,
  isListingBlobName,
  blobNameFromUrl,
  containerName,
  sniffFileType,
  IMAGE_TYPES,
  DOCUMENT_TYPES,
  signPrivateUrls,
  isPrivateBlobUrl,
  isOurPublicBlobUrl,
};
