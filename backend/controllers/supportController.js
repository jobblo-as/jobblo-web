const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { sendMongoError } = require('../utils/mongoErrors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/support/tickets
 *
 * Open to logged-out visitors too — someone who cannot log in is exactly the
 * person who needs support most. Rate limited per IP in routes/support.js (10/hour).
 */
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Where a bug report was sent from: an http(s) URL or an app route ("/jobs/123"). */
function cleanPageUrl(value) {
  const url = text(value, 2000);
  return /^https?:\/\/\S+$/i.test(url) || /^\/\S*$/.test(url) ? url : null;
}

exports.createTicket = async (req, res) => {
  try {
    const { subject, message } = req.body;
    const isBug = req.body.kind === 'bug';
    const pageUrl = isBug ? cleanPageUrl(req.body.pageUrl) : null;
    // A bug report has no subject field: it is named after the page it came from.
    const trimmedSubject =
      typeof subject === 'string' && subject.trim()
        ? subject.trim()
        : isBug
          ? `Feilrapport: ${(pageUrl || 'ukjent side').replace(/^https?:\/\/[^/]+/i, '').slice(0, 180) || '/'}`
          : '';
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    if (!trimmedSubject || !trimmedMessage) {
      return res.status(400).json({ error: 'Emne og melding er påkrevd.' });
    }
    if (trimmedSubject.length > 200) {
      return res.status(400).json({ error: 'Emnet kan være maks 200 tegn.' });
    }
    if (trimmedMessage.length > 5000) {
      return res.status(400).json({ error: 'Meldingen kan være maks 5000 tegn.' });
    }

    // Prefer the account's own address so a reply always reaches the right place;
    // fall back to whatever a logged-out visitor typed.
    let email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (req.userId) {
      const user = await User.findById(req.userId).select('email').lean();
      if (user?.email) email = user.email;
    }

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Oppgi en gyldig e-postadresse vi kan svare på.' });
    }

    const ticket = await SupportTicket.create({
      userId: req.userId || null,
      email,
      subject: trimmedSubject,
      message: trimmedMessage,
      orderId: req.body.orderId || null,
      ...(isBug
        ? {
            kind: 'bug',
            pageUrl,
            screenshots: (req.files || []).map((f) => f.path).filter(Boolean),
            client: {
              platform: ['web', 'ios', 'android'].includes(req.body.platform)
                ? req.body.platform
                : undefined,
              appVersion: text(req.body.appVersion, 40) || undefined,
              userAgent: text(req.get('user-agent'), 500) || undefined,
              screen: text(req.body.screen, 40) || undefined,
            },
            // The ErrorLog reference shown on an error screen, so the dashboard links to it.
            relatedErrorRef: text(req.body.errorRef, 64) || null,
          }
        : {}),
    });

    return res.status(201).json({
      message: 'Saken din er registrert. Vi svarer normalt innen 24 timer.',
      ticketId: ticket._id,
    });
  } catch (err) {
    console.error('createTicket Error:', err);
    return sendMongoError(res, err, 'Kunne ikke sende saken. Prøv igjen.');
  }
};

/**
 * GET /api/support/tickets/mine
 * Lets a signed-in user see what they have already reported.
 */
exports.getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.userId })
      .select('subject message status createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json(tickets);
  } catch (err) {
    console.error('getMyTickets Error:', err);
    return res.status(500).json({ error: 'Kunne ikke hente sakene dine.' });
  }
};
