import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaracatoaMountRequestBody,
  buildCaracatoaMountStateBody,
  CARACATOA_MOUNT_ACTION,
  CARACATOA_MOUNT_ENTRY_BYTES,
  CARACATOA_MOUNT_HEADER_BYTES,
  CARACATOA_MOUNT_REASON,
  CARACATOA_MOUNT_REQUEST_BYTES,
  CARACATOA_MOUNT_REQUEST_OPCODE,
  CARACATOA_MOUNT_STATE_OPCODE,
  CARACATOA_MOUNT_STATUS,
  parseCaracatoaMountRequestBody,
  parseCaracatoaMountStateBody,
} from "./caracatoa-mount-protocol.mjs";

const UUID = "f7796323-341b-44f9-9294-302d15e3b063";
const EQUUS = {
  id: "equus",
  name: "Equus da Vigília",
  requiredLevel: 1,
};

function makeMount(overrides = {}) {
  return {
    id: UUID,
    speciesId: "equus",
    stage: "juvenile",
    level: 2,
    experience: 130,
    hunger: 120,
    maxHunger: 180,
    vitality: 100,
    maxVitality: 100,
    incubationRemaining: 0,
    incubationReadyAtMs: 0,
    expiresAtMs: null,
    active: 1,
    riding: 1,
    ...overrides,
  };
}

test("montaria request has stable 48-byte little-endian shape and parses strict actions", () => {
  const body = buildCaracatoaMountRequestBody({
    clientId: 0x1234,
    timestamp: 0x01020304,
    action: CARACATOA_MOUNT_ACTION.feed,
    mountId: UUID,
    inventorySlot: 7,
  });
  assert.equal(body.length, CARACATOA_MOUNT_REQUEST_BYTES);
  assert.equal(body.readUInt16LE(0), CARACATOA_MOUNT_REQUEST_OPCODE);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x01020304);
  assert.equal(body.readUInt8(9), CARACATOA_MOUNT_ACTION.feed);
  assert.equal(body.readUInt8(10), 7);
  assert.deepEqual(parseCaracatoaMountRequestBody(body), {
    malformed: false,
    clientId: 0x1234,
    timestamp: 0x01020304,
    action: "feed",
    actionId: CARACATOA_MOUNT_ACTION.feed,
    inventorySlot: 7,
    mountId: UUID,
  });
  for (const malformed of [body.subarray(0, body.length - 1), Buffer.from(body)]) {
    if (malformed.length === body.length) malformed.writeUInt8(99, 9);
    assert.equal(parseCaracatoaMountRequestBody(malformed).malformed, true);
  }
  assert.throws(() => buildCaracatoaMountRequestBody({
    clientId: 1,
    action: CARACATOA_MOUNT_ACTION.feed,
    mountId: UUID,
    inventorySlot: 60,
  }));
});

test("mount list request uses null ID and no inventory slot", () => {
  const body = buildCaracatoaMountRequestBody({
    clientId: 42,
    action: CARACATOA_MOUNT_ACTION.list,
  });
  assert.equal(body.readUInt8(10), 0xff);
  assert.equal(body.toString("ascii", 12, 48), "00000000-0000-0000-0000-000000000000");
  assert.equal(parseCaracatoaMountRequestBody(body).action, "list");
});

test("server mount snapshot exposes authoritative life, hunger, bonuses, and incubation wait", () => {
  const egg = makeMount({
    stage: "egg",
    level: 1,
    experience: 0,
    hunger: 0,
    vitality: 0,
    incubationRemaining: 2,
    incubationReadyAtMs: 75_000,
    active: 0,
    riding: 0,
  });
  const body = buildCaracatoaMountStateBody({
    clientId: 0x2345,
    timestamp: 0x11223344,
    status: CARACATOA_MOUNT_STATUS.waiting,
    action: CARACATOA_MOUNT_ACTION.incubate,
    reason: CARACATOA_MOUNT_REASON.notReady,
    mounts: [{ mount: egg, species: EQUUS, bonuses: null }],
    nowMs: 50_000,
  });
  assert.equal(body.length, CARACATOA_MOUNT_HEADER_BYTES + CARACATOA_MOUNT_ENTRY_BYTES);
  assert.equal(body.readUInt16LE(0), CARACATOA_MOUNT_STATE_OPCODE);
  assert.equal(body.readUInt8(11), 1);
  const parsed = parseCaracatoaMountStateBody(body);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.clientId, 0x2345);
  assert.equal(parsed.timestamp, 0x11223344);
  assert.equal(parsed.status, CARACATOA_MOUNT_STATUS.waiting);
  assert.equal(parsed.action, "incubate");
  assert.equal(parsed.reason, CARACATOA_MOUNT_REASON.notReady);
  assert.equal(parsed.mounts[0].id, UUID);
  assert.equal(parsed.mounts[0].stage, "egg");
  assert.equal(parsed.mounts[0].incubationRemaining, 2);
  assert.equal(parsed.mounts[0].incubationWaitMs, 25_000);
  assert.equal(parsed.mounts[0].bonuses.hp, 0);
});

test("mount snapshot preserves riding flags and computed bonus values", () => {
  const body = buildCaracatoaMountStateBody({
    clientId: 1,
    mounts: [{
      mount: makeMount(),
      species: EQUUS,
      bonuses: {
        hp: 21,
        physicalAttack: 0,
        magicAttack: 0,
        defense: 2,
        moveSpeedBps: 250,
        absorptionBps: 0,
      },
    }],
    nowMs: 100,
  });
  const parsed = parseCaracatoaMountStateBody(body);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.mounts[0].active, true);
  assert.equal(parsed.mounts[0].riding, true);
  assert.equal(parsed.mounts[0].bonuses.hp, 21);
  assert.equal(parsed.mounts[0].bonuses.defense, 2);
  assert.equal(parsed.mounts[0].bonuses.moveSpeedBps, 250);
});

test("mount snapshot rejects truncation, duplicate identities, and invalid stage values", () => {
  const body = buildCaracatoaMountStateBody({
    clientId: 1,
    mounts: [{ mount: makeMount(), species: EQUUS }],
  });
  assert.equal(parseCaracatoaMountStateBody(body.subarray(0, body.length - 1)).malformed, true);
  assert.throws(() => buildCaracatoaMountStateBody({
    clientId: 1,
    mounts: [
      { mount: makeMount(), species: EQUUS },
      { mount: makeMount(), species: EQUUS },
    ],
  }));
  const invalidStage = Buffer.from(body);
  invalidStage.writeUInt8(99, CARACATOA_MOUNT_HEADER_BYTES + 37);
  assert.equal(parseCaracatoaMountStateBody(invalidStage).malformed, true);
});
