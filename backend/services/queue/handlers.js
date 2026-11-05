/**
 * Job handlers: queue → job name → async (data, ctx) => result.
 * Every handler is idempotent and may run more than once. Throwing = retry with backoff
 * (see QUEUES in ./index.js); after the last attempt the job stays in the failed list
 * (developer console → Queues), where it can be retried or removed.
 */
const otpBox = () => require('../../utils/secretBox').createBox('queued-otp');

const HANDLERS = {
  email: {
    /** One-time code. The code travels sealed; it is opened only here, at send time. */
    otp: async ({ to, name, otpSealed, purpose }) => {
      await require('../../utils/emailService').deliverOtpEmail(
        to,
        otpBox().open(otpSealed).toString('utf8'),
        name,
        purpose
      );
      return { sent: true };
    },
    /** Plain-text security notice to an account owner (queueSecurityAlertEmail). */
    securityAlert: async ({ to, subject, text }) => {
      await require('../../utils/emailService').sendSecurityAlertEmail(to, subject, text);
      return { sent: true };
    },
    /** Alert email to the on-call developer. Loads the incident fresh: the job only carries its id. */
    devAlert: async ({ to, incidentId }) => {
      const incident = await require('../../models/Incident').findById(incidentId).lean();
      if (!incident) return { skipped: 'incident gone' };
      await require('../../utils/emailService').sendDevAlertEmail(to, incident);
      return { sent: true };
    },
  },
  push: {
    send: async ({ userId, message }) =>
      require('../pushNotifications').deliverPush(userId, message),
  },
  security: {
    /** Classify an IP and write it onto every observation of it (idempotent: same result twice). */
    enrich: async ({ ip }) => {
      const network = await require('../security/ipIntel').classify(ip);
      const DeviceObservation = require('../../models/DeviceObservation');
      const res = await DeviceObservation.updateMany({ ip }, { $set: { network } });
      // The classification can change what the rules see (VPN transition): re-evaluate the
      // installations on this IP (bounded).
      const { evaluateDevice } = require('../security/risk/engine');
      const devices = (await DeviceObservation.distinct('deviceKey', { ip })).slice(0, 50);
      for (const deviceKey of devices) await evaluateDevice(deviceKey);
      return { ip, class: network.class, updated: res.modifiedCount, evaluated: devices.length };
    },
    /** Risk rules for one installation (services/security/risk/engine). Idempotent. */
    evaluate: async ({ deviceKey }) => require('../security/risk/engine').evaluateDevice(deviceKey),
  },
  scheduler: {
    /** One run of a scheduled lifecycle job (services/scheduler). One worker picks it up — fleet-wide. */
    run: async ({ job }) => {
      const scheduler = require('../scheduler');
      const def = scheduler.SCHEDULE.find((j) => j.name === job);
      if (!def) return { skipped: `unknown job ${job}` };
      await scheduler.runOnce(def);
      return { ran: job };
    },
  },
};

/** Seal a one-time code for a job payload. */
const sealOtp = (code) => otpBox().seal(String(code));

module.exports = { HANDLERS, sealOtp };
