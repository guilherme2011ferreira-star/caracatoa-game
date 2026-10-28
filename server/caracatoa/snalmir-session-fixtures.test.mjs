import assert from 'node:assert/strict';
import test from 'node:test';
import { clientHandshake, decodeFrame, encodeFrame } from './protocol.mjs';

const SYNTHETIC_TIME = 0x10203040;
const SYNTHETIC_SEQUENCE = 0x5a;

function packetFrame(frameSize, opcode, sequence = SYNTHETIC_SEQUENCE, fill = () => {}) {
  const body = Buffer.alloc(frameSize - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x0064, 2);
  body.writeUInt32LE(SYNTHETIC_TIME, 4);
  fill(body);
  return encodeFrame(body, sequence);
}

function inspectFrame(frame, expectedOpcode, expectedSize) {
  assert.equal(frame.length, expectedSize, 'frame length');
  assert.equal(frame.readUInt16LE(0), expectedSize, 'declared length');
  const decoded = decodeFrame(frame);
  assert.equal(decoded.ok, true, 'checksum and decrypt');
  assert.equal(decoded.frame.body.readUInt16LE(0), expectedOpcode, 'opcode');
  return decoded.frame.body;
}

function asciiField(target, offset, width, value) {
  const bytes = Buffer.from(value, 'ascii');
  assert.ok(bytes.length <= width, `${value} must fit the field`);
  bytes.copy(target, offset);
}

test('synthetic Snalmir 7.54 request and response sequence has expected framing', () => {
  const hello = clientHandshake();
  assert.deepEqual(hello, Buffer.from('11f3111f', 'hex'));

  const login = packetFrame(116, 0x20d, 0x11, (body) => {
    asciiField(body, 8, 16, 'SYNTH_ACCOUNT');
    asciiField(body, 24, 12, 'SYNTH_PASS');
    body.writeUInt32LE(754, 36);
  });
  const loginBody = inspectFrame(login, 0x20d, 116);
  assert.equal(loginBody.readUInt32LE(36), 754);
  assert.equal(loginBody.subarray(8, 24).toString('ascii').split('\0')[0], 'SYNTH_ACCOUNT');
  assert.equal(loginBody.subarray(24, 36).toString('ascii').split('\0')[0], 'SYNTH_PASS');

  const loginRoster = packetFrame(1824, 0x10e, 0x12);
  const rosterBody = inspectFrame(loginRoster, 0x10e, 1824);
  assert.equal(rosterBody.length, 1820);
  // Snalmir initializes this response with zeroes and does not fill keys[16].
  assert.deepEqual(rosterBody.subarray(1796, 1812), Buffer.alloc(16));

  const pin = packetFrame(32, 0xfde, 0x13, (body) => {
    asciiField(body, 8, 6, 'SYN001');
    body.writeUInt32LE(0, 24);
  });
  const pinBody = inspectFrame(pin, 0xfde, 32);
  assert.equal(pinBody.subarray(8, 14).toString('ascii'), 'SYN001');

  const pinAccepted = packetFrame(32, 0xfde, 0x14);
  inspectFrame(pinAccepted, 0xfde, 32);
  const welcomeMessage = packetFrame(108, 0x101, 0x15);
  inspectFrame(welcomeMessage, 0x101, 108);

  const create = packetFrame(36, 0x20f, 0x16, (body) => {
    body.writeInt32LE(0, 8);
    asciiField(body, 12, 16, 'SYNTH_TK');
    body.writeInt32LE(0, 28);
  });
  const createBody = inspectFrame(create, 0x20f, 36);
  assert.equal(createBody.readInt32LE(8), 0);
  assert.equal(createBody.readInt32LE(28), 0);

  const createdRoster = packetFrame(1824, 0x110, 0x17);
  inspectFrame(createdRoster, 0x110, 1824);

  const enter = packetFrame(36, 0x213, 0x18, (body) => body.writeInt32LE(0, 8));
  assert.equal(inspectFrame(enter, 0x213, 36).readInt32LE(8), 0);

  // Snalmir transmits sizeof(packet_enter_world) - 4: 1244 bytes.
  const enteredWorld = packetFrame(1244, 0x114, 0x19);
  inspectFrame(enteredWorld, 0x114, 1244);
});

test('synthetic rejection responses keep Snalmir signal and message sizes', () => {
  const invalidPinMessage = packetFrame(108, 0x101, 0x31);
  const invalidPin = packetFrame(12, 0xfdf, 0x32);
  const invalidCreate = packetFrame(12, 0x11a, 0x33);
  const failedWorldEntry = packetFrame(12, 0x119, 0x34);

  inspectFrame(invalidPinMessage, 0x101, 108);
  inspectFrame(invalidPin, 0xfdf, 12);
  inspectFrame(invalidCreate, 0x11a, 12);
  inspectFrame(failedWorldEntry, 0x119, 12);
});
