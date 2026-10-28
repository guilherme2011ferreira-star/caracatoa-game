import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  buildCaracatoaRefinementRequestBody,
  buildCaracatoaRefinementResultBody,
  buildCaracatoaStageRequestBody,
  buildCaracatoaStageStateBody,
  parseCaracatoaRefinementRequest,
  parseCaracatoaRefinementResult,
  parseCaracatoaStageRequest,
  parseCaracatoaStageState,
} from "./caracatoa-advancement-protocol.mjs";
import { inspectWyd727ClientFrame, inspectWyd727ServerFrame } from "./wyd-727-profile.mjs";

const identity = {
  clientId: 45,
  timestamp: 1_800_000_000,
  requestId: randomUUID(),
};

test("refinement request has a bounded synthetic WYD frame and strict fields", () => {
  const body = buildCaracatoaRefinementRequestBody({
    ...identity,
    inventorySlot: 12,
    useDivineDust: true,
  });
  assert.equal(body.length, 48);
  assert.equal(inspectWyd727ClientFrame(body).frameLength, 52);
  assert.equal(inspectWyd727ClientFrame(body).lengthValid, true);
  assert.deepEqual(parseCaracatoaRefinementRequest(body), {
    malformed: false,
    clientId: 45,
    timestamp: 1_800_000_000,
    requestId: identity.requestId,
    inventorySlot: 12,
    useDivineDust: true,
  });

  const zeroClient = Buffer.from(body);
  zeroClient.writeUInt16LE(0, 2);
  assert.equal(parseCaracatoaRefinementRequest(zeroClient).reason, "invalid-client-id");
  const reserved = Buffer.from(body);
  reserved.writeUInt8(1, 11);
  assert.equal(parseCaracatoaRefinementRequest(reserved).reason, "invalid-fields");
});

test("stage ritual request uses the same fixed local frame contract", () => {
  const body = buildCaracatoaStageRequestBody(identity);
  assert.equal(body.length, 48);
  assert.equal(inspectWyd727ClientFrame(body).frameLength, 52);
  assert.deepEqual(parseCaracatoaStageRequest(body), {
    malformed: false,
    clientId: 45,
    timestamp: 1_800_000_000,
    requestId: identity.requestId,
  });
  const invalidAction = Buffer.from(body);
  invalidAction.writeUInt8(0, 9);
  assert.equal(parseCaracatoaStageRequest(invalidAction).reason, "invalid-action");
});

test("refinement response round-trips result and fixed server frame size", () => {
  const body = buildCaracatoaRefinementResultBody({
    clientId: 45,
    timestamp: 100,
    result: {
      status: "failed",
      reason: "none",
      slot: 12,
      oldLevel: 6,
      targetLevel: 7,
      newLevel: 5,
      success: false,
      chanceBps: 7000,
      materialClientItemId: 8103,
    },
  });
  assert.equal(body.length, 24);
  assert.equal(inspectWyd727ServerFrame(body).frameLength, 28);
  assert.equal(inspectWyd727ServerFrame(body).lengthValid, true);
  assert.deepEqual(parseCaracatoaRefinementResult(body), {
    malformed: false,
    clientId: 45,
    timestamp: 100,
    version: 1,
    status: 1,
    slot: 12,
    oldLevel: 6,
    targetLevel: 7,
    newLevel: 5,
    success: false,
    reason: 0,
    materialClientItemId: 8103,
    chanceBps: 7000,
    divineDustUsed: false,
  });
});

test("refinement rejection preserves hyphenated store reason codes on the wire", () => {
  const body = buildCaracatoaRefinementResultBody({
    clientId: 45,
    timestamp: 101,
    result: { status: "rejected", reason: "missing-catalyst", slot: 4 },
  });
  const parsed = parseCaracatoaRefinementResult(body);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.status, 2);
  assert.equal(parsed.reason, 5);
});

test("stage snapshot round-trips stage progression and 64-bit experience", () => {
  const body = buildCaracatoaStageStateBody({
    clientId: 45,
    timestamp: 200,
    status: 1,
    state: {
      stage: "arch",
      level: 1,
      totalLevel: 401,
      experience: 802_000,
      availableAttributePoints: 2025,
      availableSkillPoints: 405,
      requiredMaterialClientItemId: 8108,
    },
  });
  assert.equal(body.length, 36);
  assert.equal(inspectWyd727ServerFrame(body).frameLength, 40);
  assert.equal(inspectWyd727ServerFrame(body).lengthValid, true);
  assert.deepEqual(parseCaracatoaStageState(body), {
    malformed: false,
    clientId: 45,
    timestamp: 200,
    version: 1,
    status: 1,
    stage: "arch",
    reason: 0,
    level: 1,
    totalLevel: 401,
    experience: 802_000,
    availableAttributePoints: 2025,
    availableSkillPoints: 405,
    requiredMaterialClientItemId: 8108,
  });
});
