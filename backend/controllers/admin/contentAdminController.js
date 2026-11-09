const GlobalConfig = require('../../models/GlobalConfig');
const UpcomingFeature = require('../../models/UpcomingFeature');
const { sendSuccess, sendError, asyncHandler } = require('../../utils/apiResponse');
const { logActivity } = require('../../services/admin/activityService');
const {
  CONFIG_KEY: SAFEPAY_CONNECT_DEADLINE_KEY,
  getProviderConnectDeadlineDays,
} = require('../../services/safepay/providerConnectDeadline');

const SECRET_KEY_PATTERNS = [
  'secret',
  'password',
  'token',
  'apikey',
  'privatekey',
  'authorization',
];

const isSecretKey = (key) => {
  const lower = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
};

/** A config key: a plain string of letters, digits and _ . - (never an object: that would
 * reach the Mongo filter as an operator). */
const KEY_RE = /^[A-Za-z0-9_.-]{2,80}$/;
const MAX_VALUE_BYTES = 20_000;

/** Request → { key, value, description } or an error message. Pure, unit-tested. */
function readConfigInput({ key, value, description }) {
  if (typeof key !== 'string' || !KEY_RE.test(key))
    return { error: 'Nøkkelen kan bare ha bokstaver, tall og _ . - (2–80 tegn).' };
  if (isSecretKey(key))
    return { error: 'Hemmeligheter hører hjemme i miljøvariabler, ikke i innstillingene.' };
  if (value === undefined) return { error: 'Verdi mangler.' };
  if (JSON.stringify(value).length > MAX_VALUE_BYTES)
    return { error: 'Verdien er for stor (maks 20 kB).' };
  if (description !== undefined && description !== null && typeof description !== 'string')
    return { error: 'Beskrivelsen må være tekst.' };
  return {
    key,
    value,
    description: typeof description === 'string' ? description.trim().slice(0, 300) : undefined,
  };
}

const toObject = (configs) => {
  return configs.reduce((acc, c) => {
    acc[c.key] = c.value;
    return acc;
  }, {});
};

const getLogBase = (req) => ({
  adminId: req.user._id,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

const getAllConfigs = asyncHandler(async (req, res) => {
  await getProviderConnectDeadlineDays();
  const configs = await GlobalConfig.find().lean();
  const filtered = configs.filter((c) => !isSecretKey(c.key));
  return sendSuccess(
    res,
    {
      configs: toObject(filtered),
      // With description and last change, for the settings page.
      entries: filtered
        .map((c) => ({
          key: c.key,
          value: c.value,
          description: c.description || null,
          updatedAt: c.updatedAt || null,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    },
    'All configs retrieved.'
  );
});

const getConfigByKey = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const config = await GlobalConfig.findOne({ key }).lean();
  if (!config) {
    return sendError(res, 'Config not found.', 404);
  }
  return sendSuccess(
    res,
    { key: config.key, value: config.value, description: config.description },
    'Config retrieved.'
  );
});

const updateConfig = asyncHandler(async (req, res) => {
  const input = readConfigInput(req.body || {});
  if (input.error) return sendError(res, input.error, 400);
  const { key, value, description } = input;
  // "Ny innstilling" must not silently overwrite an existing key.
  if (req.body?.create === true && (await GlobalConfig.exists({ key })))
    return sendError(res, 'Denne nøkkelen finnes allerede. Rediger den i stedet.', 409);
  if (
    key === SAFEPAY_CONNECT_DEADLINE_KEY &&
    (!Number.isInteger(value) || value < 1 || value > 30)
  ) {
    return sendError(res, 'Connect-fristen må være et heltall mellom 1 og 30 dager.', 400);
  }
  const previous =
    key === SAFEPAY_CONNECT_DEADLINE_KEY
      ? await GlobalConfig.findOne({ key }).select('value').lean()
      : null;
  const config = await GlobalConfig.findOneAndUpdate(
    { key },
    // Description only when sent: saving a value must not wipe it.
    { value, ...(description !== undefined ? { description } : {}) },
    { new: true, upsert: true }
  ).lean();
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    targetId: config._id,
    description: `${req.body?.create === true ? 'Created' : 'Updated'} config key: ${key}`,
    metadata: {
      key,
      ...(key === SAFEPAY_CONNECT_DEADLINE_KEY
        ? { previousValue: previous?.value ?? null, newValue: value }
        : {}),
    },
  });
  return sendSuccess(res, { key: config.key, value: config.value }, 'Config updated.');
});

const deleteConfig = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (typeof key !== 'string' || !KEY_RE.test(key)) return sendError(res, 'Ugyldig nøkkel.', 400);
  const config = await GlobalConfig.findOneAndDelete({ key });
  if (!config) {
    return sendError(res, 'Config not found.', 404);
  }
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    targetId: config._id,
    description: `Deleted config key: ${key}`,
    metadata: { key },
  });
  return sendSuccess(res, { key }, 'Config deleted.');
});

const getFeatureFlags = asyncHandler(async (req, res) => {
  const flags = await GlobalConfig.find({
    key: { $regex: /^(feature_|flag_)/i },
  }).lean();
  const filtered = flags.filter((f) => !isSecretKey(f.key));
  return sendSuccess(
    res,
    { flags: filtered.map((f) => ({ key: f.key, value: f.value, description: f.description })) },
    'Feature flags retrieved.'
  );
});

const toggleFeatureFlag = asyncHandler(async (req, res) => {
  const { key, enabled } = req.body;
  if (!key) {
    return sendError(res, 'Key is required.', 400);
  }
  if (typeof enabled !== 'boolean') {
    return sendError(res, 'Enabled must be a boolean.', 400);
  }
  const config = await GlobalConfig.findOne({ key });
  if (!config) {
    return sendError(res, 'Feature flag not found.', 404);
  }
  config.value = enabled;
  await config.save();
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    targetId: config._id,
    description: `Toggled feature flag: ${key} → ${enabled}`,
    metadata: { key, enabled },
  });
  return sendSuccess(res, { key, value: enabled }, 'Feature flag toggled.');
});

const updateHomepageContent = asyncHandler(async (req, res) => {
  const {
    heroTitle,
    heroSubtitle,
    heroDescription,
    ctaText,
    ctaUrl,
    featuredCategories,
    statistics,
    announcementBanner,
  } = req.body;
  const entries = {
    heroTitle,
    heroSubtitle,
    heroDescription,
    ctaText,
    ctaUrl,
    featuredCategories,
    statistics,
    announcementBanner,
  };
  const ops = Object.entries(entries)
    .filter(([, v]) => v !== undefined)
    .map(([field, value]) => ({
      updateOne: {
        filter: { key: `homepage_${field}` },
        update: { $set: { value } },
        upsert: true,
      },
    }));
  if (ops.length > 0) {
    await GlobalConfig.bulkWrite(ops);
  }
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    description: 'Updated homepage content',
    metadata: { updatedFields: Object.keys(entries).filter((k) => entries[k] !== undefined) },
  });
  return sendSuccess(res, {}, 'Homepage content updated.');
});

const getHomepageContent = asyncHandler(async (req, res) => {
  const configs = await GlobalConfig.find({ key: { $regex: /^homepage_/i } }).lean();
  return sendSuccess(res, { content: toObject(configs) }, 'Homepage content retrieved.');
});

const updateNavigation = asyncHandler(async (req, res) => {
  const { headerLinks, footerLinks, socialLinks } = req.body;
  const ops = [];
  if (headerLinks !== undefined) {
    ops.push({
      updateOne: {
        filter: { key: 'nav_header' },
        update: { $set: { value: headerLinks } },
        upsert: true,
      },
    });
  }
  if (footerLinks !== undefined) {
    ops.push({
      updateOne: {
        filter: { key: 'nav_footer' },
        update: { $set: { value: footerLinks } },
        upsert: true,
      },
    });
  }
  if (socialLinks !== undefined) {
    ops.push({
      updateOne: {
        filter: { key: 'nav_social' },
        update: { $set: { value: socialLinks } },
        upsert: true,
      },
    });
  }
  if (ops.length > 0) {
    await GlobalConfig.bulkWrite(ops);
  }
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    description: 'Updated navigation links',
    metadata: {
      updatedFields: ['headerLinks', 'footerLinks', 'socialLinks'].filter(
        (k) => req.body[k] !== undefined
      ),
    },
  });
  return sendSuccess(res, {}, 'Navigation updated.');
});

const getNavigation = asyncHandler(async (req, res) => {
  const configs = await GlobalConfig.find({
    key: { $in: ['nav_header', 'nav_footer', 'nav_social'] },
  }).lean();
  return sendSuccess(res, { navigation: toObject(configs) }, 'Navigation retrieved.');
});

const updateFooter = asyncHandler(async (req, res) => {
  const { contactEmail, supportEmail, copyrightText, aboutText } = req.body;
  const entries = { contactEmail, supportEmail, copyrightText, aboutText };
  const ops = Object.entries(entries)
    .filter(([, v]) => v !== undefined)
    .map(([field, value]) => ({
      updateOne: {
        filter: { key: `footer_${field}` },
        update: { $set: { value } },
        upsert: true,
      },
    }));
  if (ops.length > 0) {
    await GlobalConfig.bulkWrite(ops);
  }
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    description: 'Updated footer content',
    metadata: { updatedFields: Object.keys(entries).filter((k) => entries[k] !== undefined) },
  });
  return sendSuccess(res, {}, 'Footer updated.');
});

const getFooter = asyncHandler(async (req, res) => {
  const configs = await GlobalConfig.find({ key: { $regex: /^footer_/i } }).lean();
  return sendSuccess(res, { footer: toObject(configs) }, 'Footer retrieved.');
});

const getAnnouncements = asyncHandler(async (req, res) => {
  const configs = await GlobalConfig.find({ key: { $regex: /^announcement_/i } }).lean();
  const filtered = configs.filter((c) => !isSecretKey(c.key));
  return sendSuccess(
    res,
    { announcements: filtered.map((c) => ({ key: c.key, value: c.value })) },
    'Announcements retrieved.'
  );
});

const updateAnnouncement = asyncHandler(async (req, res) => {
  const { key, text, type, isActive, linkUrl } = req.body;
  if (!key) {
    return sendError(res, 'Key is required.', 400);
  }
  const value = {};
  if (text !== undefined) value.text = text;
  if (type !== undefined) value.type = type;
  if (isActive !== undefined) value.isActive = isActive;
  if (linkUrl !== undefined) value.linkUrl = linkUrl;
  const config = await GlobalConfig.findOneAndUpdate(
    { key },
    { value },
    { new: true, upsert: true }
  ).lean();
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    targetId: config._id,
    description: `Updated announcement: ${key}`,
    metadata: { key },
  });
  return sendSuccess(res, { key, value }, 'Announcement updated.');
});

const getMaintenanceMode = asyncHandler(async (req, res) => {
  const maintenance = require('../../services/maintenance');
  return sendSuccess(
    res,
    {
      maintenanceMode: await maintenance.getState({ fresh: true }),
      // What can be switched off one by one (services/maintenance.js AREAS).
      areas: maintenance.AREAS.map(({ key, label, description, writesOnly }) => ({
        key,
        label,
        description: description || null,
        writesOnly: Boolean(writesOnly),
      })),
      defaultMessage: maintenance.DEFAULT_MESSAGE,
    },
    'Maintenance mode retrieved.'
  );
});

const toggleMaintenanceMode = asyncHandler(async (req, res) => {
  const maintenance = require('../../services/maintenance');
  const { enabled, message, areas } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return sendError(res, 'Enabled must be a boolean.', 400);
  }
  if (message !== undefined && typeof message !== 'string')
    return sendError(res, 'Meldingen må være tekst.', 400);
  if (areas !== undefined && (typeof areas !== 'object' || areas === null || Array.isArray(areas)))
    return sendError(res, 'Ugyldige områder.', 400);
  const before = await maintenance.getState({ fresh: true });
  // Only known areas survive; an area not sent keeps its current setting.
  const value = maintenance.normalize({
    enabled,
    message: message ?? before.message,
    areas: { ...before.areas, ...(areas || {}) },
  });
  const config = await GlobalConfig.findOneAndUpdate(
    { key: maintenance.CONFIG_KEY },
    { value, description: 'Vedlikeholdsmodus: hele siden eller enkeltområder' },
    { new: true, upsert: true }
  ).lean();
  maintenance.invalidate();
  const on = (s) => Object.keys(s.areas).filter((k) => s.areas[k].enabled);
  await logActivity({
    ...getLogBase(req),
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    targetId: config._id,
    description: `Maintenance: site ${value.enabled ? 'off' : 'on'}${on(value).length ? `, areas off: ${on(value).join(', ')}` : ''}`,
    metadata: {
      enabled: value.enabled,
      areasOff: on(value),
      before: { enabled: before.enabled, areasOff: on(before) },
    },
  });
  return sendSuccess(res, { maintenanceMode: value }, 'Maintenance mode updated.');
});

module.exports = {
  readConfigInput,
  getAllConfigs,
  getConfigByKey,
  updateConfig,
  deleteConfig,
  getFeatureFlags,
  toggleFeatureFlag,
  updateHomepageContent,
  getHomepageContent,
  updateNavigation,
  getNavigation,
  updateFooter,
  getFooter,
  getAnnouncements,
  updateAnnouncement,
  getMaintenanceMode,
  toggleMaintenanceMode,
};
