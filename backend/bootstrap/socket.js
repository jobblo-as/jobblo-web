const { Server } = require('socket.io');
const chatSocket = require('../sockets/chat.socket');
const { joinUserRooms } = require('../sockets/rooms');
const { setIO } = require('../sockets/io');
const { allowedOrigins, originCheck } = require('../config/cors');

/**
 * socket.io on the HTTP server, with the same origin allowlist as HTTP CORS (it used to be
 * `FRONTEND_URL || 'http://localhost:5173' || …`, whose second fallback could never apply).
 * With REDIS_URL the redis adapter is attached in bootstrap/index.js, so events emitted on
 * one instance reach sockets connected to another.
 */
/** The request's Origin is this server itself (a browser on another site can't set Host). */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function setupSockets(server, app) {
  const origins = allowedOrigins();
  const io = new Server(server, {
    cors: { origin: originCheck(origins), credentials: true },
    // CORS only adds headers; browsers do not apply it to WebSockets, so a page on another site
    // could open a socket with the visitor's cookie. Refuse the handshake itself for a foreign
    // Origin. No Origin (server-to-server) passes, as for HTTP. Same-origin passes too: React
    // Native's WebSocket on Android always sends Origin = the API's own address, which is not a
    // web origin in the allowlist, so the mobile chat socket was refused ("websocket error").
    allowRequest: (req, callback) =>
      isSameOrigin(req) ? callback(null, true) : originCheck(origins)(req.headers.origin, callback),
    // Clients send ids and chat text (max 5,000 characters); the 1 MB default let every
    // event carry a megabyte to parse.
    maxHttpBufferSize: 64 * 1024,
  });

  app.set('io', io); // for code with a `req`
  setIO(io); // for background jobs and services without one (sockets/io.js)
  chatSocket(io);

  io.on('connection', (socket) => {
    // Private rooms from the authenticated id on every connection and reconnect — never from a
    // client-supplied id (F-50: a `join` with a victim's id used to stream their events).
    // chat.socket.js already joined them (before its session re-check); joining is idempotent.
    joinUserRooms(socket);
    // `join_service` is gone: nothing ever emitted to a service_ room, and any user could
    // join unlimited rooms with client strings up to 1 MB each (memory growth).
    // Older clients still send `join`; the rooms are already joined above.
    socket.on('join', () => joinUserRooms(socket));
  });

  return io;
}

module.exports = { setupSockets };
