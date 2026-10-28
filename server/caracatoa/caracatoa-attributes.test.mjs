import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaAttributeSyncBody,
  CARACATOA_ATTRIBUTE_NAMES,
  CARACATOA_ATTRIBUTE_REQUEST_OPCODE,
  CARACATOA_ATTRIBUTE_SYNC_OPCODE,
  CARACATOA_ATTRIBUTE_SYNC_STATUS,
  parseCaracatoaAttributeAllocationRequest,
} from "./caracatoa-attributes.mjs";

test("parses one versioned attribute point request and rejects malformed fields", () => {
  const body = Buffer.alloc(12);
  body.writeUInt16LE(CARACATOA_ATTRIBUTE_REQUEST_OPCODE, 0);
  body.writeUInt16LE(0x2345, 2);
  body.writeUInt32LE(0x01020304, 4);
  body.writeUInt8(1, 8);
  body.writeUInt8(1, 9);
  body.writeUInt8(1, 10);
  const request = parseCaracatoaAttributeAllocationRequest(body);
  assert.deepEqual(request, {
    malformed: false,
    clientId: 0x2345,
    timestamp: 0x01020304,
    attributeId: 1,
    attribute: "int",
    pointCount: 1,
  });
  body.writeUInt8(2, 10);
  assert.deepEqual(parseCaracatoaAttributeAllocationRequest(body), {
    malformed: true,
    reason: "invalid-fields",
  });
  assert.deepEqual(parseCaracatoaAttributeAllocationRequest(Buffer.alloc(11)), {
    malformed: true,
    reason: "invalid-length",
  });
  assert.deepEqual(CARACATOA_ATTRIBUTE_NAMES, ["str", "int", "dex", "con"]);
});

test("builds the complete 48-byte attribute snapshot with derived values", () => {
  const body = buildCaracatoaAttributeSyncBody({
    clientId: 0x2345,
    timestamp: 0x01020304,
    status: CARACATOA_ATTRIBUTE_SYNC_STATUS.applied,
    attributeId: 1,
    availablePoints: 4,
    stats: {
      str: 10,
      int: 11,
      dex: 10,
      con: 10,
      currentHp: 100,
      maxHp: 100,
      currentMp: 100,
      maxMp: 105,
      damage: 10,
      defense: 0,
    },
  });
  assert.equal(body.length, 48);
  assert.equal(body.readUInt16LE(0), CARACATOA_ATTRIBUTE_SYNC_OPCODE);
  assert.equal(body.readUInt16LE(2), 0x2345);
  assert.equal(body.readUInt8(8), 1);
  assert.equal(body.readUInt8(9), CARACATOA_ATTRIBUTE_SYNC_STATUS.applied);
  assert.equal(body.readUInt8(10), 1);
  assert.equal(body.readUInt32LE(12), 4);
  assert.deepEqual(
    [16, 18, 20, 22].map((offset) => body.readUInt16LE(offset)),
    [10, 11, 10, 10],
  );
  assert.equal(body.readInt32LE(36), 105);
  assert.equal(body.readInt32LE(40), 10);
  assert.throws(
    () =>
      buildCaracatoaAttributeSyncBody({
        clientId: 1,
        status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
        attributeId: 0,
        availablePoints: 0,
        stats: {
          str: 1, int: 1, dex: 1, con: 1,
          currentHp: 1, maxHp: 1, currentMp: 1, maxMp: 1,
          damage: 1, defense: 0,
        },
      }),
    /Snapshot inicial/,
  );
});
