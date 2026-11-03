/** An admin moving a support case tells its poster (tray + push); internal notes stay internal. */
jest.mock('../services/notifications', () => ({ notify: jest.fn(async () => null) }));
jest.mock('../models/SupportTicket', () => ({ findById: jest.fn() }));
jest.mock('../utils/devQuery', () => ({
  ...jest.requireActual('../utils/devQuery'),
  audit: jest.fn(async () => undefined),
}));

const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const { notify } = require('../services/notifications');
const { updateTicket } = require('../controllers/developer/ticketsController');

const owner = new mongoose.Types.ObjectId();
const ticketDoc = () => ({
  _id: new mongoose.Types.ObjectId(),
  userId: owner,
  subject: 'Fikk ikke betalt',
  status: 'open',
  priority: 'normal',
  history: [],
  save: jest.fn(async () => undefined),
});
const run = async (doc, body) => {
  SupportTicket.findById.mockResolvedValue(doc);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await updateTicket(
    { params: { id: String(doc._id) }, body, user: { _id: new mongoose.Types.ObjectId() } },
    res,
    jest.fn()
  );
  await new Promise((r) => setImmediate(r));
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('resolved: the poster is told, and a tap opens their support cases', async () => {
  await run(ticketDoc(), { status: 'resolved' });
  expect(notify).toHaveBeenCalledWith({
    userId: owner,
    type: 'system',
    title: 'Kundeservice',
    content: 'Saken din «Fikk ikke betalt» er løst.',
    data: { type: 'support_ticket' },
  });
});

test('an internal note or a priority change sends nothing', async () => {
  await run(ticketDoc(), { note: 'Sjekk Stripe-loggen' });
  await run(ticketDoc(), { priority: 'high' });
  expect(notify).not.toHaveBeenCalled();
});
