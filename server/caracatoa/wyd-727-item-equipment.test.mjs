import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";
import {
  getWyd727EquipmentCombatBonuses,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";
import {
  applyCaracatoaEquipmentRequest,
  buildCaracatoaEquipmentRequest,
  buildCaracatoaEquipmentSyncBody,
  CARACATOA_EQUIPMENT_SYNC_STATUS,
  parseCaracatoaEquipmentRequest,
  parseCaracatoaEquipmentSync,
  resolveCaracatoaCharacterEquipment,
} from "./wyd-727-item-equipment.mjs";

const ITEM = {
  id: "caracatoa-training-blade",
  name: "Lâmina de Treino",
  description: "Arma original de fixture.",
  enabled: true,
  properties: {
    clientItemId: 7001,
    stackCount: 1,
    field04: 0,
    effects: [
      { index: 0, value: 0 },
      { index: 0, value: 0 },
      { index: 0, value: 0 },
    ],
    starter: true,
    equipment: {
      slot: "weapon",
      attackDamageBonus: 5,
      defenseBonus: 0,
      allowedClassIds: [0, 1, 2, 3],
    },
  },
};

const catalog = () => ({ schemaVersion: 1, kind: "items", entries: [structuredClone(ITEM)] });

test("Caracatoa equipment request has a fixed 12-byte body and validates its slots", () => {
  const body = buildCaracatoaEquipmentRequest({
    clientId: 0x2345,
    equipmentSlot: 0,
    inventorySlot: 7,
    timestamp: 0x01020304,
  });
  assert.equal(body.length, 12);
  assert.deepEqual(parseCaracatoaEquipmentRequest(body), {
    malformed: false,
    clientId: 0x2345,
    equipmentSlot: 0,
    inventorySlot: 7,
    timestamp: 0x01020304,
    reserved: 0,
  });
  body.writeUInt16LE(1, 10);
  assert.deepEqual(parseCaracatoaEquipmentRequest(body), {
    malformed: true,
    reason: "invalid-fields",
  });
  assert.throws(() => buildCaracatoaEquipmentRequest({
    clientId: 0x2345,
    equipmentSlot: 6,
    inventorySlot: 0,
    timestamp: 0,
  }));
});

test("equipment state fixture reports the item and authoritative total bonuses", () => {
  const body = buildCaracatoaEquipmentSyncBody({
    clientId: 0x2345,
    status: CARACATOA_EQUIPMENT_SYNC_STATUS.applied,
    equipmentSlot: 0,
    equipment: {
      inventorySlot: 7,
      clientItemId: 7001,
      attackDamageBonus: 5,
      defenseBonus: 0,
    },
    bonuses: { attackDamageBonus: 5, defenseBonus: 2 },
  });
  assert.equal(body.length, 18);
  assert.deepEqual(parseCaracatoaEquipmentSync(body), {
    malformed: false,
    clientId: 0x2345,
    status: 0,
    equipmentSlot: 0,
    inventorySlot: 7,
    clientItemId: 7001,
    attackDamageBonus: 5,
    defenseBonus: 0,
    totalAttackDamageBonus: 5,
    totalDefenseBonus: 2,
  });
  assert.deepEqual(getWyd727EquipmentCombatBonuses([
    {
      equipmentSlot: 0,
      inventorySlot: 7,
      clientItemId: 7001,
      attackDamageBonus: 5,
      defenseBonus: 2,
    },
  ]), {
    attackDamageBonus: 5,
    magicAttackBonus: 0,
    magicAttackBps: 0,
    defenseBonus: 2,
    maxHpBonus: 0,
    maxMpBonus: 0,
    absorptionBps: 0,
    dropRateBps: 0,
    experienceBonusBps: 0,
    mpCostReductionBps: 0,
    cooldownReductionBps: 0,
  });
});

test("equipped gear absorption is aggregated under the shared mount cap", () => {
  const bonuses = getWyd727EquipmentCombatBonuses([
    {
      equipmentSlot: 2,
      inventorySlot: 7,
      clientItemId: 7001,
      attackDamageBonus: 0,
      defenseBonus: 0,
      absorptionBps: 800,
    },
    {
      equipmentSlot: 3,
      inventorySlot: 8,
      clientItemId: 7002,
      attackDamageBonus: 0,
      defenseBonus: 0,
      absorptionBps: 500,
    },
  ]);
  assert.deepEqual(bonuses, {
    attackDamageBonus: 0,
    magicAttackBonus: 0,
    magicAttackBps: 0,
    defenseBonus: 0,
    maxHpBonus: 0,
    maxMpBonus: 0,
    absorptionBps: 1000,
    dropRateBps: 0,
    experienceBonusBps: 0,
    mpCostReductionBps: 0,
    cooldownReductionBps: 0,
  });
});

test("equipped reward affixes aggregate independently under the equipment cap", () => {
  const bonuses = getWyd727EquipmentCombatBonuses([
    {
      equipmentSlot: 5,
      inventorySlot: 7,
      clientItemId: 8011,
      attackDamageBonus: 0,
      defenseBonus: 0,
      dropRateBps: 500,
      experienceBonusBps: 450,
    },
    {
      equipmentSlot: 4,
      inventorySlot: 8,
      clientItemId: 8012,
      attackDamageBonus: 0,
      defenseBonus: 0,
      dropRateBps: 600,
      experienceBonusBps: 600,
    },
  ]);
  assert.equal(bonuses.dropRateBps, 800);
  assert.equal(bonuses.experienceBonusBps, 800);
});

test("equipped mana efficiency affixes aggregate under the 15% cap", () => {
  const bonuses = getWyd727EquipmentCombatBonuses([
    { equipmentSlot: 0, inventorySlot: 7, clientItemId: 8004, attackDamageBonus: 0, defenseBonus: 0, mpCostReductionBps: 500 },
    { equipmentSlot: 2, inventorySlot: 8, clientItemId: 8006, attackDamageBonus: 0, defenseBonus: 0, mpCostReductionBps: 500 },
    { equipmentSlot: 5, inventorySlot: 9, clientItemId: 8011, attackDamageBonus: 0, defenseBonus: 0, mpCostReductionBps: 500 },
  ]);
  assert.equal(bonuses.mpCostReductionBps, 1_500);
  assert.throws(() => getWyd727EquipmentCombatBonuses([
    { equipmentSlot: 0, inventorySlot: 7, clientItemId: 8004, attackDamageBonus: 0, defenseBonus: 0, mpCostReductionBps: 501 },
  ]));
});

test("equipped cooldown affixes aggregate under the 10% cap and 400 BP per piece", () => {
  const bonuses = getWyd727EquipmentCombatBonuses([
    { equipmentSlot: 0, inventorySlot: 7, clientItemId: 8004, attackDamageBonus: 0, defenseBonus: 0, cooldownReductionBps: 400 },
    { equipmentSlot: 2, inventorySlot: 8, clientItemId: 8006, attackDamageBonus: 0, defenseBonus: 0, cooldownReductionBps: 400 },
    { equipmentSlot: 5, inventorySlot: 9, clientItemId: 8011, attackDamageBonus: 0, defenseBonus: 0, cooldownReductionBps: 400 },
  ]);
  assert.equal(bonuses.cooldownReductionBps, 1_000);
  assert.throws(() => getWyd727EquipmentCombatBonuses([
    { equipmentSlot: 0, inventorySlot: 7, clientItemId: 8004, attackDamageBonus: 0, defenseBonus: 0, cooldownReductionBps: 401 },
  ]));
});

test("staff base magic attack and spell affix aggregate under the 18% cap", () => {
  const bonuses = getWyd727EquipmentCombatBonuses([
    {
      equipmentSlot: 0,
      inventorySlot: 7,
      clientItemId: 8004,
      attackDamageBonus: 0,
      defenseBonus: 0,
      magicAttackBonus: 140,
      magicAttackBps: 1300,
    },
    {
      equipmentSlot: 5,
      inventorySlot: 8,
      clientItemId: 8011,
      attackDamageBonus: 0,
      defenseBonus: 0,
      magicAttackBonus: 60,
      magicAttackBps: 1000,
    },
  ]);
  assert.equal(bonuses.magicAttackBonus, 200);
  assert.equal(bonuses.magicAttackBps, 1800);
  assert.throws(() => getWyd727EquipmentCombatBonuses([
    {
      equipmentSlot: 0,
      inventorySlot: 7,
      clientItemId: 8004,
      attackDamageBonus: 0,
      defenseBonus: 0,
      magicAttackBps: 1801,
    },
  ]));
});

test("only allowed classes can equip the persistent starter weapon and removing it clears bonuses", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-equipment-"));
  const store = new PlayerAccountStore({ databasePath: join(directory, "players.sqlite") });
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  const items = catalog();
  items.entries[0].properties.equipment.allowedClassIds = [0];
  validateWyd727ItemCatalog(items);

  await store.createAccount("EquipmentTest", "SYNTHPASS", "135790");
  store.createCharacter("equipmenttest", {
    slot: 0,
    classId: 2,
    name: "BeastNoBlade",
  });
  assert.deepEqual(
    applyCaracatoaEquipmentRequest({
      accountStore: store,
      accountId: "equipmenttest",
      characterSlot: 0,
      classId: 2,
      equipmentSlot: 0,
      inventorySlot: 0,
      catalog: items,
    }),
    { accepted: false, reason: "wrong-class" },
  );
  assert.deepEqual(store.listCharacterEquipment("equipmenttest", 0), []);

  store.createCharacter("equipmenttest", {
    slot: 1,
    classId: 0,
    name: "StarterBlade",
  });
  const equipped = applyCaracatoaEquipmentRequest({
    accountStore: store,
    accountId: "equipmenttest",
    characterSlot: 1,
    classId: 0,
    equipmentSlot: 0,
    inventorySlot: 0,
    catalog: items,
  });
  assert.equal(equipped.accepted, true);
  assert.deepEqual(equipped.bonuses, {
    attackDamageBonus: 5,
    magicAttackBonus: 0,
    magicAttackBps: 0,
    defenseBonus: 0,
    maxHpBonus: 0,
    maxMpBonus: 0,
    absorptionBps: 0,
    dropRateBps: 0,
    experienceBonusBps: 0,
    mpCostReductionBps: 0,
    cooldownReductionBps: 0,
  });
  assert.deepEqual(equipped.equipment, [
    {
      equipmentSlot: 0,
      inventorySlot: 0,
      clientItemId: 7001,
      attackDamageBonus: 5,
      magicAttackBonus: 0,
      magicAttackBps: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      maxMpBonus: 0,
      absorptionBps: 0,
      dropRateBps: 0,
      experienceBonusBps: 0,
      mpCostReductionBps: 0,
      cooldownReductionBps: 0,
    },
  ]);
  assert.deepEqual(
    resolveCaracatoaCharacterEquipment({
      accountStore: store,
      accountId: "equipmenttest",
      characterSlot: 1,
      classId: 0,
      catalog: items,
    }).bonuses,
    {
      attackDamageBonus: 5,
      magicAttackBonus: 0,
      magicAttackBps: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      maxMpBonus: 0,
      absorptionBps: 0,
      dropRateBps: 0,
      experienceBonusBps: 0,
      mpCostReductionBps: 0,
      cooldownReductionBps: 0,
    },
  );

  const unequipped = applyCaracatoaEquipmentRequest({
    accountStore: store,
    accountId: "equipmenttest",
    characterSlot: 1,
    classId: 0,
    equipmentSlot: 0,
    inventorySlot: 0xff,
    catalog: items,
  });
  assert.equal(unequipped.accepted, true);
  assert.deepEqual(unequipped.equipment, []);
  assert.deepEqual(unequipped.bonuses, {
    attackDamageBonus: 0,
    magicAttackBonus: 0,
    magicAttackBps: 0,
    defenseBonus: 0,
    maxHpBonus: 0,
    maxMpBonus: 0,
    absorptionBps: 0,
    dropRateBps: 0,
    experienceBonusBps: 0,
    mpCostReductionBps: 0,
    cooldownReductionBps: 0,
  });
});
