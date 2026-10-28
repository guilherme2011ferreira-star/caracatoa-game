import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptSnalmirCharacterListFrame,
  adaptSnalmirEnterWorldFrame,
  adaptSnalmirPinResultFrame,
  createCaracatoaSequenceHashTable,
} from './snalmir-response-adapter.mjs';
import { decodeFrame, encodeFrame } from './protocol.mjs';

const SYNTHETIC_SEQUENCE = 0x5a;
const SYNTHETIC_HASH_TABLE = Buffer.from(Array.from({ length: 16 }, (_, index) => 0x41 + index));

function putName(buffer, offset, value, length = 16) {
  Buffer.from(value, 'ascii').copy(buffer, offset, 0, length - 1);
}

function buildSyntheticSnalmirCharListFrame(opcode = 0x10e) {
  const body = Buffer.alloc(1824 - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x0064, 2);
  body.writeUInt32LE(0x10203040, 4);
  const selection = 8;

  body.writeInt16LE(-123, selection + 0);
  body.writeInt16LE(256, selection + 2);
  body.writeInt16LE(456, selection + 8);
  body.writeInt16LE(512, selection + 10);
  putName(body, selection + 16, 'SYNTH_TK');
  putName(body, selection + 32, 'SYNTH_BM');

  const status0 = selection + 80;
  body.writeUInt16LE(12, status0 + 0);
  body.writeInt16LE(34, status0 + 2);
  body.writeInt16LE(56, status0 + 4);
  body.writeUInt8(5 | (9 << 4), status0 + 6);
  body.writeUInt8(6 | (11 << 4), status0 + 7);
  body.writeUInt16LE(1500, status0 + 8);
  body.writeUInt16LE(500, status0 + 10);
  body.writeUInt16LE(1200, status0 + 12);
  body.writeUInt16LE(300, status0 + 14);
  body.writeInt16LE(90, status0 + 16);
  body.writeInt16LE(30, status0 + 18);
  body.writeInt16LE(40, status0 + 20);
  body.writeInt16LE(50, status0 + 22);
  body.set([1, 2, 3, 4], status0 + 24);

  const equip0 = selection + 192;
  const equip1 = equip0 + 128;
  body.writeInt16LE(0, equip0);
  body.writeInt16LE(405, equip0 + 8);
  body.set([7, 8, 9, 10, 11, 12], equip0 + 10);
  body.writeInt16LE(20, equip1);
  body.writeInt16LE(512, equip1 + 8);

  body.writeUInt16LE(33, selection + 704);
  body.writeUInt16LE(44, selection + 706);
  body.writeInt32LE(700, selection + 712);
  body.writeInt32LE(900, selection + 716);
  body.writeUInt32LE(123456, selection + 728);
  body.writeUInt32LE(654321, selection + 732);

  const storage = 752;
  body.writeInt16LE(600, storage + (127 * 8));
  body.set([2, 3, 4, 5, 6, 7], storage + (127 * 8) + 2);
  body.writeInt32LE(987654, 1776);
  putName(body, 1780, 'SYNTH_ACCOUNT');
  body.set(Array.from({ length: 16 }, (_, index) => 0x90 + index), 1796);

  return encodeFrame(body, SYNTHETIC_SEQUENCE);
}

function buildSyntheticSnalmirEnterWorldFrame(opcode = 0x114) {
  const body = Buffer.alloc(1240);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x7531, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeInt16LE(321, 8);
  body.writeInt16LE(123, 10);

  const mob = 12;
  putName(body, mob, 'SYNTH_WORLD');
  body.writeUInt16LE(19, mob + 18);
  body.writeUInt8(2, mob + 20);
  body.writeInt32LE(12345, mob + 24);
  body.writeUInt32LE(987654, mob + 28);

  for (const [offset, level, strength, hp] of [
    [mob + 36, 4, 91, 1500],
    [mob + 64, 5, 101, 1400],
  ]) {
    body.writeUInt16LE(level, offset);
    body.writeInt16LE(33, offset + 2);
    body.writeInt16LE(44, offset + 4);
    body.set([5 | (9 << 4), 6 | (11 << 4)], offset + 6);
    body.writeUInt16LE(hp, offset + 8);
    body.writeUInt16LE(600, offset + 10);
    body.writeUInt16LE(hp - 100, offset + 12);
    body.writeUInt16LE(500, offset + 14);
    body.writeInt16LE(strength, offset + 16);
    body.writeInt16LE(22, offset + 18);
    body.writeInt16LE(33, offset + 20);
    body.writeInt16LE(44, offset + 22);
    body.set([1, 2, 3, 4], offset + 24);
  }

  body.writeInt16LE(601, mob + 92 + 8);
  body.set([4, 3, 2, 1, 8, 7], mob + 92 + 8 + 2);
  body.writeInt16LE(602, mob + 220 + 16);
  body.set([9, 8, 7, 6, 5, 4], mob + 220 + 16 + 2);
  body.writeUInt32LE(0x12345678, mob + 732);
  body.writeUInt16LE(31, mob + 736);
  body.writeUInt16LE(17, mob + 738);
  body.writeUInt8(6, mob + 742);
  body.writeUInt8(7, mob + 743);
  body.set([1, 2, 3, 4], mob + 744);
  body.set([5, 6, 7, 8], mob + 752);
  body.set(Array.from({ length: 16 }, (_, index) => index + 0x20), mob + 764);
  body.writeUInt16LE(321, mob + 820);

  const affect = mob + 1044;
  body.set([1, 2], affect);
  body.writeInt16LE(-3, affect + 2);
  body.writeUInt32LE(1234, affect + 4);
  return encodeFrame(body, SYNTHETIC_SEQUENCE);
}

function decodeResponseBody(body) {
  const wire = encodeFrame(body, 0x51);
  const decoded = decodeFrame(wire);
  assert.equal(decoded.ok, true);
  return decoded.frame.body;
}

function buildSyntheticPinResultFrame(opcode) {
  const body = Buffer.alloc(opcode === 0xfde ? 28 : 8);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x0077, 2);
  body.writeUInt32LE(0x11223344, 4);
  if (opcode === 0xfde) body.write('654321', 8, 'ascii');
  return encodeFrame(body, 0x5a);
}

test('Snalmir 0x10E becomes ordered Caracatoa login and post-PIN roster bodies', () => {
  const translated = adaptSnalmirCharacterListFrame(buildSyntheticSnalmirCharListFrame(), {
    clientId: 0x1234,
    timestamp: 0x55667788,
    hashKeyTable: SYNTHETIC_HASH_TABLE,
  });

  assert.equal(translated.kind, 'login');
  assert.equal(translated.loginBody.length, 2804);
  assert.equal(translated.loginBody.readUInt16LE(0), 0x10a);
  assert.equal(translated.loginBody.readUInt16LE(2), 0x1234);
  assert.equal(translated.loginBody.readUInt32LE(4), 0x55667788);
  assert.deepEqual(translated.loginBody.subarray(8, 24), SYNTHETIC_HASH_TABLE);
  assert.equal(translated.loginBody.readInt32LE(24), 0);
  assert.equal(translated.loginBody.readInt16LE(28), -123);
  assert.equal(translated.loginBody.readInt16LE(36), 456);
  assert.equal(translated.loginBody.toString('ascii', 44, 54), 'SYNTH_TK\0\0');

  const score = 28 + 80;
  assert.equal(translated.loginBody.readInt32LE(score), 12);
  assert.equal(translated.loginBody.readInt32LE(score + 4), 34);
  assert.equal(translated.loginBody.readInt32LE(score + 8), 56);
  assert.deepEqual([...translated.loginBody.subarray(score + 12, score + 16)], [5, 6, 9, 11]);
  assert.equal(translated.loginBody.readUInt32LE(score + 16), 1500);
  assert.equal(translated.loginBody.readUInt32LE(score + 20), 500);
  assert.equal(translated.loginBody.readUInt32LE(score + 24), 1200);
  assert.equal(translated.loginBody.readUInt32LE(score + 28), 300);
  assert.equal(translated.loginBody.readUInt16LE(score + 32), 90);
  assert.deepEqual([...translated.loginBody.subarray(score + 40, score + 48)], [1, 0, 2, 0, 3, 0, 4, 0]);

  const bodySlot0 = 28 + 272;
  const bodySlot1 = bodySlot0 + 216;
  assert.equal(translated.loginBody.readUInt16LE(bodySlot0), 0);
  assert.equal(translated.loginBody.readInt16LE(bodySlot0 + 2), 0);
  assert.equal(translated.loginBody.readUInt16LE(bodySlot0 + 12), 405);
  assert.equal(translated.loginBody.readInt16LE(bodySlot0 + 14), 1);
  assert.deepEqual([...translated.loginBody.subarray(bodySlot0 + 18, bodySlot0 + 24)], [7, 8, 9, 10, 11, 12]);
  assert.equal(translated.loginBody.readUInt16LE(bodySlot1), 20);
  assert.equal(translated.loginBody.readUInt16LE(28 + 1136 + 4), 0);
  assert.equal(translated.loginBody.readInt32LE(28 + 1144), 33);
  assert.equal(translated.loginBody.readInt32LE(28 + 1160), 700);
  assert.equal(translated.loginBody.readBigInt64LE(28 + 1176), 123456n);
  assert.equal(translated.loginBody.readUInt16LE(28 + 272 + 216), 20);

  const cargo = 1236 + (127 * 12);
  assert.equal(translated.loginBody.readUInt16LE(cargo), 600);
  assert.equal(translated.loginBody.readInt16LE(cargo + 2), 1);
  assert.deepEqual([...translated.loginBody.subarray(cargo + 6, cargo + 12)], [2, 3, 4, 5, 6, 7]);
  assert.equal(translated.loginBody.readInt32LE(2772), 987654);
  assert.equal(translated.loginBody.toString('ascii', 2776, 2792), 'SYNTH_ACCOUNT\0\0\0');
  assert.deepEqual([...translated.loginBody.subarray(2792, 2804)], Array.from({ length: 12 }, (_, index) => 0x90 + index));

  assert.equal(translated.rosterAfterPinBody.length, 1220);
  assert.equal(translated.rosterAfterPinBody.readUInt16LE(0), 0x110);
  assert.equal(translated.rosterAfterPinBody.readInt32LE(8), 0);
  assert.equal(translated.rosterAfterPinBody.readUInt16LE(12 + 272), 0);
  assert.equal(translated.rosterAfterPinBody.readUInt16LE(12 + 272 + 216), 20);
  decodeResponseBody(translated.loginBody);
  decodeResponseBody(translated.rosterAfterPinBody);
});

test('Snalmir 0x110 converts only to a Caracatoa roster update', () => {
  const translated = adaptSnalmirCharacterListFrame(buildSyntheticSnalmirCharListFrame(0x110), {
    clientId: 0x2345,
    timestamp: 0x01020304,
  });

  assert.equal(translated.kind, 'roster-update');
  assert.equal(translated.rosterBody.length, 1220);
  assert.equal(translated.rosterBody.readUInt16LE(0), 0x110);
  assert.equal(translated.rosterBody.readUInt16LE(2), 0x2345);
  assert.equal(translated.rosterBody.readUInt32LE(4), 0x01020304);
  assert.equal(translated.rosterBody.toString('ascii', 12 + 16, 12 + 32), 'SYNTH_TK\0\0\0\0\0\0\0\0');
  assert.equal(translated.rosterBody.readInt32LE(12 + 80), 12);
  assert.deepEqual(decodeResponseBody(translated.rosterBody), translated.rosterBody);
});

test('Snalmir 0x114 maps confirmed world fields into the 2100-byte Caracatoa body', () => {
  const translated = adaptSnalmirEnterWorldFrame(buildSyntheticSnalmirEnterWorldFrame(), {
    clientId: 0x2345,
    timestamp: 0x55667788,
    mobIndex: 0x3456,
    serverTime: 0x01020304,
  });

  assert.equal(translated.kind, 'world-entry');
  assert.equal(translated.worldBody.length, 2100);
  assert.equal(translated.worldBody.readUInt16LE(0), 0x114);
  assert.equal(translated.worldBody.readUInt16LE(2), 0x2345);
  assert.equal(translated.worldBody.readUInt32LE(4), 0x55667788);
  assert.deepEqual([translated.worldBody.readInt16LE(8), translated.worldBody.readInt16LE(10)], [321, 123]);
  assert.equal(translated.worldBody.toString('ascii', 12, 30), 'SYNTH_WORLD\0\0\0\0\0\0\0');
  assert.equal(translated.worldBody.readUInt16LE(30), 19);
  assert.equal(translated.worldBody.readUInt8(32), 2);
  assert.equal(translated.worldBody.readInt32LE(36), 12345);
  assert.equal(translated.worldBody.readBigInt64LE(44), 987654n);
  assert.equal(translated.worldBody.readInt32LE(56), 4);
  assert.equal(translated.worldBody.readInt32LE(104), 5);
  assert.equal(translated.worldBody.readUInt16LE(152 + 12 + 2), 1);
  assert.equal(translated.worldBody.readUInt16LE(152 + 12), 601);
  assert.deepEqual([...translated.worldBody.subarray(152 + 12 + 6, 152 + 12 + 12)], [4, 3, 2, 1, 8, 7]);
  assert.equal(translated.worldBody.readUInt16LE(368 + 24), 602);
  assert.equal(translated.worldBody.readUInt32LE(1136), 0x12345678);
  assert.equal(translated.worldBody.readUInt16LE(1144), 31);
  assert.equal(translated.worldBody.readUInt16LE(1148), 17);
  assert.equal(translated.worldBody.readUInt8(1150), 6);
  assert.equal(translated.worldBody.readUInt8(1151), 7);
  assert.deepEqual([...translated.worldBody.subarray(1152, 1156)], [1, 2, 3, 4]);
  assert.equal(translated.worldBody.readUInt16LE(1158), 321);
  assert.deepEqual([1366, 1368, 1370, 1372].map((offset) => translated.worldBody.readUInt16LE(offset)), [5, 6, 7, 8]);
  assert.equal(translated.worldBody.readUInt16LE(1382), 0x3456);
  assert.deepEqual([...translated.worldBody.subarray(1386, 1402)], Array.from({ length: 16 }, (_, index) => index + 0x20));
  assert.deepEqual([...translated.worldBody.subarray(1692, 1700)], [1, 2, 0xfd, 0xff, 0xd2, 0x04, 0, 0]);
  assert.equal(translated.worldBody.readUInt32LE(2072), 0x01020304);
  assert.equal(translated.worldBody.readUInt16LE(1404), 0);
  assert.equal(translated.worldBody.readUInt16LE(1406), 0);
  assert.deepEqual(decodeResponseBody(translated.worldBody), translated.worldBody);
});

test('Snalmir world adapter rejects wrong frames, opcodes, classes, and missing mob index', () => {
  const valid = buildSyntheticSnalmirEnterWorldFrame();
  const options = { clientId: 1, timestamp: 1, mobIndex: 1 };
  assert.throws(() => adaptSnalmirEnterWorldFrame(valid.subarray(0, -1), options), /Frame 0x114|Comprimento/);
  assert.throws(() => adaptSnalmirEnterWorldFrame(buildSyntheticSnalmirEnterWorldFrame(0x113), options), /Opcode/);
  assert.throws(() => adaptSnalmirEnterWorldFrame(valid, { ...options, mobIndex: 0 }), /mobIndex/);
  const invalidClassBody = decodeFrame(valid).frame.body;
  invalidClassBody.writeUInt8(4, 12 + 20);
  assert.throws(
    () => adaptSnalmirEnterWorldFrame(encodeFrame(invalidClassBody, SYNTHETIC_SEQUENCE), options),
    /Classe/,
  );
});

test('PIN results become 8-byte Caracatoa bodies without echoing PIN digits', () => {
  for (const [sourceOpcode, expectedOpcode] of [[0xfde, 0xfde], [0xfdf, 0xfdf]]) {
    const translated = adaptSnalmirPinResultFrame(
      buildSyntheticPinResultFrame(sourceOpcode),
      { clientId: 0x4321, timestamp: 0x55667788 },
    );

    assert.equal(translated.kind, 'pin-result');
    assert.equal(translated.pinResultBody.length, 8);
    assert.equal(translated.pinResultBody.readUInt16LE(0), expectedOpcode);
    assert.equal(translated.pinResultBody.readUInt16LE(2), 0x4321);
    assert.equal(translated.pinResultBody.readUInt32LE(4), 0x55667788);
    assert.equal(translated.pinResultBody.includes(Buffer.from('654321')), false);
    assert.deepEqual(decodeResponseBody(translated.pinResultBody), translated.pinResultBody);
  }
});

test('prepared synthetic session responses preserve login, PIN, and roster order', () => {
  const clientId = 0x4321;
  const timestamp = 0x55667788;
  const login = adaptSnalmirCharacterListFrame(buildSyntheticSnalmirCharListFrame(), {
    clientId,
    timestamp,
    hashKeyTable: SYNTHETIC_HASH_TABLE,
  });
  const acceptedPin = adaptSnalmirPinResultFrame(buildSyntheticPinResultFrame(0xfde), {
    clientId,
    timestamp,
  });
  const rejectedPin = adaptSnalmirPinResultFrame(buildSyntheticPinResultFrame(0xfdf), {
    clientId,
    timestamp,
  });

  const acceptedBodies = [login.loginBody, acceptedPin.pinResultBody, login.rosterAfterPinBody];
  assert.deepEqual(acceptedBodies.map((body) => body.readUInt16LE(0)), [0x10a, 0xfde, 0x110]);
  assert.deepEqual([rejectedPin.pinResultBody].map((body) => body.readUInt16LE(0)), [0xfdf]);
});

test('PIN result adapter rejects unsupported opcodes and source lengths', () => {
  const badOpcode = Buffer.alloc(8);
  badOpcode.writeUInt16LE(0xfda, 0);
  assert.throws(
    () => adaptSnalmirPinResultFrame(encodeFrame(badOpcode, 0x5a), { clientId: 1, timestamp: 1 }),
    /Opcode/,
  );

  const shortSuccess = Buffer.alloc(8);
  shortSuccess.writeUInt16LE(0xfde, 0);
  assert.throws(
    () => adaptSnalmirPinResultFrame(encodeFrame(shortSuccess, 0x5a), { clientId: 1, timestamp: 1 }),
    /Comprimento/,
  );
});

test('adapter rejects invalid lengths, opcodes, sequence tables, and unsupported body classes', () => {
  const valid = buildSyntheticSnalmirCharListFrame();
  const inputOptions = { clientId: 1, timestamp: 1, hashKeyTable: SYNTHETIC_HASH_TABLE };
  assert.throws(() => adaptSnalmirCharacterListFrame(valid.subarray(0, -1), inputOptions), /Frame Snalmir|Comprimento/);
  assert.throws(() => adaptSnalmirCharacterListFrame(valid, { ...inputOptions, hashKeyTable: Buffer.alloc(16) }), /hashKeyTable/);

  const badOpcodeBody = Buffer.alloc(1820);
  badOpcodeBody.writeUInt16LE(0x1234, 0);
  assert.throws(() => adaptSnalmirCharacterListFrame(encodeFrame(badOpcodeBody, SYNTHETIC_SEQUENCE), inputOptions), /Opcode/);

  const badClassBody = Buffer.alloc(1820);
  badClassBody.writeUInt16LE(0x10e, 0);
  badClassBody.writeUInt8(1, 8 + 16);
  badClassBody.writeUInt16LE(40, 8 + 192);
  assert.throws(() => adaptSnalmirCharacterListFrame(encodeFrame(badClassBody, SYNTHETIC_SEQUENCE), inputOptions), /Classe/);
});

test('session sequence table uses 16 bytes and retries a zero first byte', () => {
  let calls = 0;
  const table = createCaracatoaSequenceHashTable(() => {
    calls += 1;
    return calls === 1
      ? Buffer.alloc(16)
      : Buffer.from(Array.from({ length: 16 }, (_, index) => index + 0x21));
  });

  assert.equal(calls, 2);
  assert.equal(table.length, 16);
  assert.equal(table[0], 0x21);
  assert.throws(() => createCaracatoaSequenceHashTable(() => Buffer.alloc(16)), /Não foi possível/);
  assert.throws(() => createCaracatoaSequenceHashTable(() => Buffer.alloc(15)), /16 bytes/);

  const generatedLogin = adaptSnalmirCharacterListFrame(buildSyntheticSnalmirCharListFrame(), {
    clientId: 0x1234,
    timestamp: 0x55667788,
  });
  assert.notEqual(generatedLogin.loginBody[8], 0);
});
