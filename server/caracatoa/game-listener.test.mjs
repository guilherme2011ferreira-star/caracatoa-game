import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createConnection } from 'node:net';
import test from 'node:test';
import { clientHandshake, encodeFrame } from './protocol.mjs';
import { createLocalGameListener } from './game-listener.mjs';

function waitForEvent(events, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      events.off('event', onEvent);
      reject(new Error('listener event timed out'));
    }, timeoutMs);
    const onEvent = (event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      events.off('event', onEvent);
      resolve(event);
    };
    events.on('event', onEvent);
  });
}

async function startLoopbackServer(listener) {
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  return listener.address().port;
}

function closeServer(listener) {
  return new Promise((resolve) => {
    if (!listener.listening) return resolve();
    listener.close(() => resolve());
  });
}

async function connectLoopback(port) {
  const socket = createConnection({ host: '127.0.0.1', port });
  await once(socket, 'connect');
  return socket;
}

test('local listener incrementally decodes and reports frame metadata without replying', async (t) => {
  const events = new EventEmitter();
  const received = [];
  const listener = createLocalGameListener({
    idleTimeoutMs: 0,
    onEvent(event) {
      received.push(event);
      events.emit('event', event);
    },
  });
  const port = await startLoopbackServer(listener);
  t.after(() => closeServer(listener));

  const socket = await connectLoopback(port);
  const responseChunks = [];
  socket.on('data', (chunk) => responseChunks.push(chunk));

  const handshakeEvent = waitForEvent(events, (event) => event.type === 'handshake');
  const frameEvent = waitForEvent(events, (event) => event.type === 'frame');
  const packetEvent = waitForEvent(events, (event) => event.type === 'packet');
  const body = Buffer.alloc(120);
  body.writeUInt16LE(0x20d, 0);
  const frame = encodeFrame(body, 0x2a);
  const marker = clientHandshake();
  socket.write(marker.subarray(0, 2));
  socket.write(Buffer.concat([marker.subarray(2), frame.subarray(0, 5)]));
  socket.write(frame.subarray(5));

  await Promise.all([handshakeEvent, frameEvent, packetEvent]);
  const closePromise = once(socket, 'close');
  socket.end();
  await closePromise;

  assert.deepEqual(received.find((event) => event.type === 'frame'), {
    type: 'frame', sequence: 0x2a, bodyLength: body.length,
  });
  assert.deepEqual(received.find((event) => event.type === 'packet'), {
    type: 'packet', sequence: 0x2a, recognized: true, malformed: false,
    opcode: 0x20d, name: 'account-login', frameLength: 124,
    expectedFrameLength: 124, lengthValid: true,
  });
  assert.equal(responseChunks.reduce((total, chunk) => total + chunk.length, 0), 0);
});

test('local listener closes a client with an invalid handshake', async (t) => {
  const events = new EventEmitter();
  const listener = createLocalGameListener({
    idleTimeoutMs: 0,
    onEvent: (event) => events.emit('event', event),
  });
  const port = await startLoopbackServer(listener);
  t.after(() => closeServer(listener));

  const socket = await connectLoopback(port);
  const errorEvent = waitForEvent(events, (event) => event.type === 'protocol-error');
  const closePromise = once(socket, 'close');
  socket.write(Buffer.from([0, 0, 0, 0]));

  assert.equal((await errorEvent).message, 'unexpected client handshake');
  await closePromise;
});

test('graceful shutdown drains connected clients, closes the listener, and is idempotent', async (t) => {
  const events = new EventEmitter();
  const received = [];
  const listener = createLocalGameListener({
    idleTimeoutMs: 0,
    onEvent(event) {
      received.push(event);
      events.emit('event', event);
    },
  });
  const port = await startLoopbackServer(listener);
  t.after(() => closeServer(listener));

  const connectionOpen = waitForEvent(events, (event) => event.type === 'connection-open');
  const socket = await connectLoopback(port);
  await connectionOpen;
  const endPromise = once(socket, 'end');
  const closePromise = once(socket, 'close');
  const shutdown = listener.shutdown();
  assert.equal(listener.shutdown(), shutdown);

  await endPromise;
  socket.end();
  await Promise.all([shutdown, closePromise]);

  assert.equal(listener.listening, false);
  assert.equal(received.some((event) => event.type === 'connection-close'), true);
  await assert.rejects(connectLoopback(port), { code: 'ECONNREFUSED' });
});
