import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeWyd727ClineVersion,
  parseWyd727CharacterEntryRequest,
} from './wyd-727-character-entry.mjs';

function requestBody({ slot = 2, clientId = 0, shift = 3 } = {}) {
  const body = Buffer.alloc(32);
  body.writeUInt16LE(0x213, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeInt32LE(slot, 8);
  body.writeUInt32LE(computeWyd727ClineVersion(shift), 16);
  return body;
}

test('parses WYDBot 7.27 0x213 slot and CLIVER with client header id zero', () => {
  const body = requestBody();
  assert.equal(body.length + 4, 36);
  assert.deepEqual(parseWyd727CharacterEntryRequest(body), {
    malformed: false,
    clientId: 0,
    slot: 2,
    shift: 3,
    clineVersion: computeWyd727ClineVersion(3),
    versionValid: true,
    reservedValid: true,
    paddingValid: true,
  });
});

test('rejects malformed size/opcode and marks altered CLIVER, reserved bytes, and padding', () => {
  assert.deepEqual(parseWyd727CharacterEntryRequest(Buffer.alloc(31)), { malformed: true });
  const wrongOpcode = requestBody();
  wrongOpcode.writeUInt16LE(0x20d, 0);
  assert.deepEqual(parseWyd727CharacterEntryRequest(wrongOpcode), { malformed: true });

  const wrongVersion = requestBody();
  wrongVersion.writeUInt32LE(0x12345678, 16);
  assert.equal(parseWyd727CharacterEntryRequest(wrongVersion).versionValid, false);

  const reserved = requestBody();
  reserved[12] = 1;
  assert.equal(parseWyd727CharacterEntryRequest(reserved).reservedValid, false);

  const padding = requestBody();
  padding[31] = 1;
  assert.equal(parseWyd727CharacterEntryRequest(padding).paddingValid, false);
});

test('computes only supported client CLIVER shifts', () => {
  for (let shift = 1; shift <= 9; shift += 1) {
    assert.equal(parseWyd727CharacterEntryRequest(requestBody({ shift })).versionValid, true);
  }
  assert.throws(() => computeWyd727ClineVersion(0), RangeError);
  assert.throws(() => computeWyd727ClineVersion(10), RangeError);
});
