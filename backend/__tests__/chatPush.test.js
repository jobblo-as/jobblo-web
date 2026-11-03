/**
 * A chat message reaches the other person as a tray entry + push (HTTP route and socket both
 * use postChatMessage). It had been dropped by accident; this keeps it from going again.
 */
jest.mock('../services/notifications', () => ({ notify: jest.fn(async () => null) }));
jest.mock('../models/ChatMessage', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn() }));

const mongoose = require('mongoose');
const Chat = require('../models/ChatMessage');
const User = require('../models/User');
const { notify } = require('../services/notifications');
const { postChatMessage } = require('../controllers/chatController');

const chatId = String(new mongoose.Types.ObjectId());
const client = String(new mongoose.Types.ObjectId());
const provider = String(new mongoose.Types.ObjectId());
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  Chat.findById.mockReturnValue({
    select: async () => ({ clientId: client, providerId: provider }),
  });
  Chat.updateOne.mockResolvedValue({ modifiedCount: 1 });
  User.exists.mockResolvedValue(null);
  User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ name: 'Ola' }) }) });
});

test('the other person gets the message as a push that opens the chat', async () => {
  const result = await postChatMessage({
    chatId,
    userId: client,
    text: '  Hei, når passer det?  ',
  });
  expect(result.message.text).toBe('Hei, når passer det?');
  await flush();
  expect(notify).toHaveBeenCalledWith({
    userId: provider,
    type: 'message',
    content: 'Hei, når passer det?',
    senderId: client,
    title: 'Melding fra Ola',
    data: { type: 'chat_message', chatId },
  });
});

test('a long message is shortened in the push, the chat keeps all of it', async () => {
  const text = 'a'.repeat(500);
  const result = await postChatMessage({ chatId, userId: provider, text });
  expect(result.message.text).toHaveLength(500);
  await flush();
  expect(notify.mock.calls[0][0].userId).toBe(client);
  expect(notify.mock.calls[0][0].content).toHaveLength(198);
});

test('nothing is sent for a refused message (blocked, full chat)', async () => {
  User.exists.mockResolvedValueOnce({ _id: 'x' });
  expect((await postChatMessage({ chatId, userId: client, text: 'Hei' })).status).toBe(403);
  Chat.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
  expect((await postChatMessage({ chatId, userId: client, text: 'Hei' })).status).toBe(409);
  await flush();
  expect(notify).not.toHaveBeenCalled();
});
