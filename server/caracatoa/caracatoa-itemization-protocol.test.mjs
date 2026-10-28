import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaItemizationDetailBody,
  parseCaracatoaItemizationDetailBody,
  CARACATOA_ITEMIZATION_DETAIL_STATUS,
} from "./caracatoa-itemization-protocol.mjs";

const detail = {
  clientItemId: 8001,
  rarity: "arcane",
  itemLevel: 40,
  refinementLevel: 7,
  baseStats: {
    physicalDamage: 63,
    magicAttack: 0,
    physicalDefense: 0,
    maxHp: 0,
    maxMp: 0,
  },
  affixes: [
    { clientAffixId: 1, stat: "physicalDamageFlat", value: 8 },
    { clientAffixId: 3, stat: "accuracyBps", value: 400 },
  ],
};

test("encodes a bounded itemization snapshot for the selected inventory slot", () => {
  const body = buildCaracatoaItemizationDetailBody({
    clientId: 45,
    timestamp: 1234,
    status: CARACATOA_ITEMIZATION_DETAIL_STATUS.snapshot,
    slot: 7,
    itemization: detail,
  });
  assert.equal(body.length, 58);
  assert.deepEqual(parseCaracatoaItemizationDetailBody(body), {
    malformed: false,
    clientId: 45,
    timestamp: 1234,
    status: 0,
    slot: 7,
    rarity: "arcane",
    clientItemId: 8001,
    itemLevel: 40,
    refinementLevel: 7,
    baseStats: detail.baseStats,
    affixes: [
      { clientAffixId: 1, value: 8 },
      { clientAffixId: 3, value: 400 },
    ],
  });
});

test("rejects duplicate affixes and clears only a specified slot", () => {
  assert.throws(() => buildCaracatoaItemizationDetailBody({
    clientId: 45,
    slot: 7,
    itemization: { ...detail, affixes: [detail.affixes[0], { ...detail.affixes[1], clientAffixId: 1 }] },
  }), /Afixo repetido/);
  const body = buildCaracatoaItemizationDetailBody({
    clientId: 45,
    status: CARACATOA_ITEMIZATION_DETAIL_STATUS.removed,
    slot: 7,
  });
  const parsed = parseCaracatoaItemizationDetailBody(body);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.slot, 7);
  assert.equal(parsed.status, 2);
  assert.equal(parsed.rarity, null);
  assert.equal(parsed.clientItemId, 0);
});

test("rejects modified lengths, unused affix bytes, and impossible levels", () => {
  const body = buildCaracatoaItemizationDetailBody({ clientId: 45, slot: 7, itemization: detail });
  assert.equal(parseCaracatoaItemizationDetailBody(body.subarray(0, 57)).reason, "invalid-length");
  const dirtyUnusedAffix = Buffer.from(body);
  dirtyUnusedAffix.writeUInt8(9, 48);
  assert.equal(parseCaracatoaItemizationDetailBody(dirtyUnusedAffix).reason, "nonzero-unused-affix");
  assert.throws(() => buildCaracatoaItemizationDetailBody({
    clientId: 45,
    slot: 7,
    itemization: { ...detail, itemLevel: 401 },
  }), /itemLevel/);
});
