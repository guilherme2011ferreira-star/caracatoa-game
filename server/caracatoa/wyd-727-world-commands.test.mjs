import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWyd727MoveResponseBody,
  parseWyd727KeepAliveRequest,
  parseWyd727MoveRequest,
} from './wyd-727-world-commands.mjs';

function keepAliveBody(clientId = 0x1234) {
  const body = Buffer.alloc(8);
  body.writeUInt16LE(0x3a0, 0);
  body.writeUInt16LE(clientId, 2);
  return body;
}

function moveBody({
  clientId = 0x1234,
  from = { x: 10, y: 20 },
  destiny = { x: 12, y: 21 },
  codes = [0x36, 0x36, 0x38],
  moveType = 0,
  speed = 3,
} = {}) {
  const body = Buffer.alloc(48);
  body.writeUInt16LE(0x36c, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeInt16LE(from.x, 8);
  body.writeInt16LE(from.y, 10);
  body.writeUInt32LE(moveType, 12);
  body.writeUInt32LE(speed, 16);
  codes.forEach((code, index) => body.writeUInt8(code, 20 + index));
  body.writeInt16LE(destiny.x, 44);
  body.writeInt16LE(destiny.y, 46);
  return body;
}

test('parses header-only WYDBot 0x3A0 keepalive', () => {
  assert.equal(keepAliveBody().length + 4, 12);
  assert.deepEqual(parseWyd727KeepAliveRequest(keepAliveBody()), {
    malformed: false,
    clientId: 0x1234,
  });
  assert.deepEqual(parseWyd727KeepAliveRequest(Buffer.alloc(8)), { malformed: true });
});

test('replays the 0x36C numpad path and checks the requested destination', () => {
  const body = moveBody();
  assert.equal(body.length + 4, 52);
  assert.deepEqual(parseWyd727MoveRequest(body), {
    malformed: false,
    clientId: 0x1234,
    lastPosition: { x: 10, y: 20 },
    moveType: 0,
    requestedSpeed: 3,
    directionCodes: [0x36, 0x36, 0x38],
    destiny: { x: 12, y: 21 },
    pathValid: true,
    invalidReason: null,
    replayedDestiny: { x: 12, y: 21 },
  });

  const wrongDestiny = parseWyd727MoveRequest(moveBody({ destiny: { x: 99, y: 21 } }));
  assert.equal(wrongDestiny.pathValid, false);
  assert.equal(wrongDestiny.invalidReason, 'destiny-does-not-match-path');
});

test('rejects bad route padding, unsupported direction codes, and paths longer than twelve steps', () => {
  const badPadding = moveBody();
  badPadding[20 + 4] = 0x38;
  assert.equal(parseWyd727MoveRequest(badPadding).invalidReason, 'nonzero-after-path-padding');

  assert.equal(parseWyd727MoveRequest(moveBody({ codes: [0x35], destiny: { x: 10, y: 20 } })).invalidReason, 'invalid-direction-code');
  assert.equal(parseWyd727MoveRequest(moveBody({ codes: Array(13).fill(0x36), destiny: { x: 23, y: 20 } })).invalidReason, 'too-many-steps');
});

test('builds the public 0x366 response shape with server-selected speed', () => {
  const body = buildWyd727MoveResponseBody({
    clientId: 0x1234,
    timestamp: 0x55667788,
    lastPosition: { x: 10, y: 20 },
    destiny: { x: 12, y: 21 },
    moveType: 0,
    speedMove: 3,
    directionCodes: [0x36, 0x36, 0x38],
  });
  assert.equal(body.length, 48);
  assert.equal(body.length + 4, 52);
  assert.equal(body.readUInt16LE(0), 0x366);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x55667788);
  assert.equal(body.readInt16LE(8), 10);
  assert.equal(body.readInt16LE(10), 20);
  assert.equal(body.readUInt32LE(16), 3);
  assert.deepEqual([...body.subarray(20, 44)], [0x36, 0x36, 0x38, ...Array(21).fill(0)]);
  assert.equal(body.readInt16LE(44), 12);
  assert.equal(body.readInt16LE(46), 21);
  assert.throws(() => buildWyd727MoveResponseBody({ clientId: 1, lastPosition: { x: 0, y: 0 }, destiny: { x: 1, y: 0 }, speedMove: 8 }), RangeError);
});
