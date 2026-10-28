import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARACATOA_CREATE_CHARACTER_STATUS as STATUS,
  parseCaracatoaCreateCharacterRequest,
} from './caracatoa-character-protocol.mjs';

function requestBody({ version = 1, slot = 0, classId = 1, name = 'Aria' } = {}) {
  const body = Buffer.alloc(36 - 4);
  body.writeUInt16LE(0x7f00, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeUInt16LE(version, 8);
  body.writeUInt8(slot, 10);
  body.writeUInt8(classId, 11);
  const bytes = Buffer.from(name, 'ascii');
  body.writeUInt8(bytes.length, 12);
  bytes.copy(body, 14);
  return body;
}

test('parses the exact 36-byte Caracatoa create request with its 12-byte WYD header', () => {
  const parsed = parseCaracatoaCreateCharacterRequest(requestBody({ slot: 2, classId: 3, name: 'Hunter_16' }));
  assert.deepEqual(parsed, { malformed: false, status: STATUS.created, slot: 2, classId: 3, name: 'Hunter_16' });
});

test('maps supported logical failures to stable result statuses', () => {
  assert.equal(parseCaracatoaCreateCharacterRequest(requestBody({ version: 2 })).status, STATUS.invalidVersion);
  assert.equal(parseCaracatoaCreateCharacterRequest(requestBody({ slot: 4 })).status, STATUS.invalidSlot);
  assert.equal(parseCaracatoaCreateCharacterRequest(requestBody({ classId: 4 })).status, STATUS.unsupportedClass);

  const badName = requestBody();
  badName[14] = 0x20;
  assert.equal(parseCaracatoaCreateCharacterRequest(badName).status, STATUS.invalidName);

  const badPadding = requestBody();
  badPadding[20] = 0x41;
  assert.equal(parseCaracatoaCreateCharacterRequest(badPadding).status, STATUS.invalidName);

  const badReserved = requestBody();
  badReserved[31] = 1;
  assert.equal(parseCaracatoaCreateCharacterRequest(badReserved).status, STATUS.invalidName);
});

test('closes malformed packet shapes instead of treating them as create requests', () => {
  assert.deepEqual(parseCaracatoaCreateCharacterRequest(Buffer.alloc(31)), { malformed: true });
  const wrongOpcode = requestBody();
  wrongOpcode.writeUInt16LE(0x20f, 0);
  assert.deepEqual(parseCaracatoaCreateCharacterRequest(wrongOpcode), { malformed: true });
});
