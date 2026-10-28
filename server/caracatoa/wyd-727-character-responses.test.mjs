import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWyd727ServerFrame } from './wyd-727-profile.mjs';
import {
  buildCaracatoaCharacterCreateResultBody,
  buildWyd727CharacterListUpdateBody,
  buildWyd727LoginSuccessfulBody,
} from './wyd-727-session-responses.mjs';

const characters = [
  { slot: 2, name: 'Aria_01', classId: 1, level: 1, gold: 0 },
];

test('builds the Caracatoa result packet with the fixed 16-byte frame contract', () => {
  const body = buildCaracatoaCharacterCreateResultBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    status: 0,
    slot: 2,
    classId: 1,
  });
  assert.equal(body.length + 4, 16);
  assert.equal(body.readUInt16LE(0), 0x7f01);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x10203040);
  assert.deepEqual([...body.subarray(8)], [1, 0, 2, 1]);
  assert.deepEqual(inspectWyd727ServerFrame(body), {
    recognized: true,
    malformed: false,
    opcode: 0x7f01,
    name: 'caracatoa-create-character-result',
    frameLength: 16,
    expectedFrameLength: 16,
    lengthKnown: true,
    lengthValid: true,
  });
});

test('builds 0x110 with persisted names, class tags, levels, and gold at the public client offsets', () => {
  const body = buildWyd727CharacterListUpdateBody({ clientId: 0x1234, characters });
  assert.equal(body.length + 4, 1224);
  assert.equal(body.readUInt16LE(0), 0x110);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.subarray(12 + 16 + 2 * 16, 12 + 16 + 3 * 16).toString('ascii').replace(/\0.*$/s, ''), 'Aria_01');
  assert.equal(body.readInt32LE(12 + 80 + 2 * 48), 1);
  assert.equal(body.readUInt16LE(12 + 272 + 2 * 216), 10);
  assert.equal(body.readInt32LE(12 + 1160 + 2 * 4), 0);
  const inspected = inspectWyd727ServerFrame(body);
  assert.equal(inspected.opcode, 0x110);
  assert.equal(inspected.frameLength, 1224);
  assert.equal(inspected.lengthValid, true);
});

test('keeps the 0x10A roster empty until the second-factor token is accepted', () => {
  const body = buildWyd727LoginSuccessfulBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    hashKeyTable: Buffer.from([1, ...Array(15).fill(0x22)]),
  });
  assert.equal(body.length + 4, 2808);
  assert.equal(body.readUInt16LE(0), 0x10a);
  assert.ok(body.subarray(28, 28 + 1208).every((byte) => byte === 0));
});
