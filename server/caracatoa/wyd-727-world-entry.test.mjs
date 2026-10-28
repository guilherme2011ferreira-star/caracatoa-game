import assert from "node:assert/strict";
import test from "node:test";
import { buildWyd727CharacterToWorldBody } from "./wyd-727-world-entry.mjs";

const CHARACTER = {
  slot: 2,
  name: "Aria_01",
  classId: 1,
  level: 1,
  gold: 0,
  experience: 1337,
};

test("builds the exact WYDBot 7.27 0x114 length and persisted bootstrap fields", () => {
  const body = buildWyd727CharacterToWorldBody({
    clientId: 0x1234,
    mobIndex: 0x1234,
    timestamp: 0x10203040,
    serverTime: 0x55667788,
    character: CHARACTER,
    position: { x: 321, y: -123 },
  });

  assert.equal(body.length, 2100);
  assert.equal(body.length + 4, 2104);
  assert.equal(body.readUInt16LE(0), 0x114);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x10203040);
  assert.equal(body.readInt16LE(8), 321);
  assert.equal(body.readInt16LE(10), -123);
  assert.equal(body.toString("ascii", 12, 30).replace(/\0+$/, ""), "Aria_01");
  assert.equal(body.readUInt16LE(30), 0);
  assert.equal(body.readUInt8(32), 1);
  assert.equal(body.readInt32LE(36), 0);
  assert.equal(body.readBigInt64LE(44), 1337n);
  assert.equal(body.readInt32LE(56), 0);
  assert.equal(body.readInt32LE(104), 0);
  assert.equal(body.readInt32LE(72), 100);
  assert.equal(body.readInt32LE(80), 100);
  assert.equal(body.readUInt16LE(88), 10);
  assert.equal(body.readUInt16LE(152), 10);
  assert.equal(body.readUInt16LE(368), 0);
  assert.equal(body.readUInt16LE(1382), 0x1234);
  assert.equal(body.readUInt32LE(2072), 0x55667788);
});

test("rejects invalid persisted values and signed spawn coordinates", () => {
  assert.throws(
    () =>
      buildWyd727CharacterToWorldBody({
        clientId: 1,
        character: { ...CHARACTER, name: "bad name" },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      buildWyd727CharacterToWorldBody({
        clientId: 1,
        character: { ...CHARACTER, classId: 4 },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      buildWyd727CharacterToWorldBody({
        clientId: 1,
        character: CHARACTER,
        position: { x: 32768, y: 0 },
      }),
    RangeError,
  );
});

test("writes persisted catalog items into their exact 0x114 MItem slots", () => {
  const body = buildWyd727CharacterToWorldBody({
    clientId: 0x1234,
    character: CHARACTER,
    inventoryItems: [
      {
        slot: 2,
        clientItemId: 1234,
        stackCount: 5,
        field04: 7,
        effects: [
          { index: 1, value: 2 },
          { index: 3, value: 4 },
          { index: 5, value: 6 },
        ],
      },
    ],
  });
  const offset = 368 + 2 * 12;
  assert.equal(body.readUInt16LE(offset), 1234);
  assert.equal(body.readInt16LE(offset + 2), 5);
  assert.equal(body.readUInt16LE(offset + 4), 7);
  assert.deepEqual(
    [...body.subarray(offset + 6, offset + 12)],
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(body.readUInt16LE(368), 0);
  assert.throws(() =>
    buildWyd727CharacterToWorldBody({
      clientId: 1,
      character: CHARACTER,
      inventoryItems: [
        { slot: 60, clientItemId: 1, stackCount: 1, field04: 0, effects: [] },
      ],
    }),
  );
});

test("writes learned class-skill masks to the public 0x114 Learn fields", () => {
  const body = buildWyd727CharacterToWorldBody({
    clientId: 0x1234,
    character: CHARACTER,
    learnedSkill: [2, 0],
  });
  assert.equal(body.readUInt32LE(1136), 2); // Learn[0] @ packet +1140
  assert.equal(body.readUInt32LE(1140), 0); // Learn[1] @ packet +1144
  assert.throws(() =>
    buildWyd727CharacterToWorldBody({
      clientId: 0x1234,
      character: CHARACTER,
      learnedSkill: [2],
    }),
  );
});
