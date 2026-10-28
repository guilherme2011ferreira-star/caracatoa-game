import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  aggregateItemAffixes,
  calculateAffixScaleBps,
  calculateBaseItemStats,
  calculateItemDropChanceBps,
  rollAffixes,
  rollMonsterLoot,
  validateItemizationConfig,
} from "./item-affix-system.mjs";
import { awardCaracatoaItemizedMonsterLoot } from "./caracatoa-itemized-monster-loot.mjs";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { validateWyd727MonsterCatalog } from "./wyd-727-monster-catalog.mjs";
import { validateWyd727ItemCatalog } from "./wyd-727-item-catalog.mjs";
import {
  applyCaracatoaEquipmentRequest,
  resolveCaracatoaCharacterEquipment,
} from "./wyd-727-item-equipment.mjs";

const itemizationConfig = JSON.parse(
  await readFile(new URL("./data/catalogs/itemization.json", import.meta.url), "utf8"),
);
const monsterCatalog = JSON.parse(
  await readFile(new URL("./data/catalogs/monsters.json", import.meta.url), "utf8"),
);
const itemCatalog = JSON.parse(
  await readFile(new URL("./data/catalogs/items.json", import.meta.url), "utf8"),
);

test("validates itemization catalogs and keeps configured chances/caps bounded", () => {
  assert.equal(validateItemizationConfig(itemizationConfig), true);
  assert.equal(validateWyd727MonsterCatalog(monsterCatalog).kind, "monsters");
  assert.equal(validateWyd727ItemCatalog(itemCatalog).kind, "items");
  assert.equal(calculateItemDropChanceBps({
    baseChanceBps: 100,
    monsterMultiplierBps: 60_000,
    zoneMultiplierBps: 12_500,
    luckBonusBps: 2_500,
    chanceCapBps: 1_000,
  }), 937);
  assert.equal(calculateItemDropChanceBps({
    baseChanceBps: 120,
    monsterMultiplierBps: 60_000,
    zoneMultiplierBps: 12_500,
    luckBonusBps: 2_500,
    chanceCapBps: 1_000,
  }), 1_000);
  assert.equal(calculateAffixScaleBps(itemizationConfig, 1), 5_000);
  assert.equal(calculateAffixScaleBps(itemizationConfig, 100), 9_950);
  assert.equal(calculateAffixScaleBps(itemizationConfig, 400), 24_950);
  assert.equal(
    calculateBaseItemStats(itemizationConfig, "weapon_1h", 100, "legendary").physicalDamage,
    143,
  );
});

test("the original astral armor tiers are obtainable from their level-appropriate loot tables", () => {
  const armorDrops = [
    { itemId: "caracatoa-bronze-elmo-do-vigia-errante", lootTableId: "field-common", monsterLevel: 1, expectedLevel: 1 },
    { itemId: "caracatoa-silver-elmo-do-veu-lunar", lootTableId: "adventure-elite", monsterLevel: 125, expectedLevel: 100 },
    { itemId: "caracatoa-gold-elmo-da-coroa-solar", lootTableId: "dangerous-boss", monsterLevel: 313, expectedLevel: 250 },
  ];
  for (const fixture of armorDrops) {
    const config = structuredClone(itemizationConfig);
    const poolId = config.lootTables[fixture.lootTableId].itemPool;
    config.itemPools[poolId] = [fixture.itemId];
    const [drop] = rollMonsterLoot({
      config,
      lootTableId: fixture.lootTableId,
      monsterLevel: fixture.monsterLevel,
      randomInt: (min) => min,
      idFactory: () => `fixture-${fixture.itemId}`,
    });
    assert.equal(drop.kind, "equipment");
    assert.equal(drop.instance.catalogItemId, fixture.itemId);
    assert.equal(drop.instance.itemLevel, fixture.expectedLevel);
    assert.equal(drop.instance.origin, "monster-drop");
  }
});

test("the twelve class-specific astral breastplates keep their tier gates and are selectable from matching loot pools", () => {
  const variants = itemCatalog.entries.filter(({ properties }) =>
    properties.clientItemId >= 8221 && properties.clientItemId <= 8232,
  );
  assert.equal(variants.length, 12);
  assert.equal(new Set(variants.map(({ properties }) => properties.clientItemId)).size, 12);

  for (const [index, entry] of variants.entries()) {
    const clientItemId = entry.properties.clientItemId;
    const tier = index < 4 ? "bronze" : index < 8 ? "silver" : "gold";
    const classId = index % 4;
    const tierConfig = {
      bronze: { poolId: "starter", lootTableId: "field-common", monsterLevel: 1, itemLevel: 1, min: 1, max: 99 },
      silver: { poolId: "adventure", lootTableId: "adventure-elite", monsterLevel: 125, itemLevel: 100, min: 100, max: 249 },
      gold: { poolId: "dangerous", lootTableId: "dangerous-boss", monsterLevel: 313, itemLevel: 250, min: 250, max: 400 },
    }[tier];
    const template = itemizationConfig.itemTemplates.find(({ clientItemId: id }) => id === clientItemId);
    assert.ok(template, `${entry.id} precisa ter template de itemização.`);
    assert.equal(template.itemType, "chest");
    assert.equal(template.minItemLevel, tierConfig.min);
    assert.equal(template.maxItemLevel, tierConfig.max);
    assert.ok(itemizationConfig.itemPools[tierConfig.poolId].includes(entry.id));
    assert.equal(entry.properties.equipment.slot, "chest");
    assert.deepEqual(entry.properties.equipment.allowedClassIds, [classId]);

    const config = structuredClone(itemizationConfig);
    config.itemPools[tierConfig.poolId] = [entry.id];
    const [drop] = rollMonsterLoot({
      config,
      lootTableId: tierConfig.lootTableId,
      monsterLevel: tierConfig.monsterLevel,
      randomInt: (min) => min,
      idFactory: () => `fixture-${entry.id}`,
    });
    assert.equal(drop.kind, "equipment", entry.id);
    assert.equal(drop.instance.catalogItemId, entry.id);
    assert.equal(drop.instance.itemLevel, tierConfig.itemLevel);
    assert.equal(drop.instance.itemType, "chest");
  }
});

test("rolls distinct bounded affixes and scales the same base item by level", () => {
  const affixes = rollAffixes({
    config: itemizationConfig,
    itemType: "weapon_1h",
    itemLevel: 100,
    rarityId: "legendary",
    maxRollChanceBps: 0,
    randomInt: (min) => min,
  });
  assert.equal(affixes.length, 3);
  assert.equal(new Set(affixes.map(({ stat }) => stat)).size, affixes.length);
  for (const affix of affixes) {
    const cap = itemizationConfig.affixes.find(({ id }) => id === affix.id).hardCapPerItem;
    assert.ok(affix.value <= cap);
  }
  assert.ok(
    calculateBaseItemStats(itemizationConfig, "weapon_1h", 200, "normal").physicalDamage >
      calculateBaseItemStats(itemizationConfig, "weapon_1h", 100, "normal").physicalDamage,
  );
});

test("equipped affixes are catalog-valid, distinct, and clamped by global stat caps", () => {
  const item = {
    instanceId: "fixture-weapon",
    isEquipped: true,
    itemType: "weapon_1h",
    rarity: "mystic",
    affixes: [
      {
        id: "keen",
        clientAffixId: 1,
        stat: "physicalDamageFlat",
        value: 30,
        valueUnit: "flat",
      },
    ],
  };
  assert.equal(
    aggregateItemAffixes([
      item,
      { ...item, instanceId: "fixture-weapon-2" },
      { ...item, instanceId: "fixture-weapon-3" },
    ], itemizationConfig).physicalDamageFlat,
    itemizationConfig.globalStatCaps.physicalDamageFlat,
  );
  assert.throws(
    () => aggregateItemAffixes([{ ...item, affixes: [{ ...item.affixes[0], value: 31 }] }], itemizationConfig),
    /Afixo inválido/,
  );
  assert.throws(
    () => aggregateItemAffixes([{ ...item, affixes: [{ ...item.affixes[0], stat: "physicalDefenseFlat" }] }], itemizationConfig),
    /Afixo inválido/,
  );
});

test("awards one deterministic monster drop, persists item instance/affix, and prevents duplicate death rewards", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-itemized-loot-"));
  const databasePath = join(directory, "players.sqlite");
  let accountStore = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    accountStore?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("TestPlayer", "SYNTHPASS", "135790");
  accountStore.createCharacter("testplayer", {
    slot: 0,
    classId: 0,
    name: "LootTester",
  });
  accountStore.initializeCharacterInventory("testplayer", 0, []);

  let drawNumber = 0;
  const randomInt = (min, max) => {
    drawNumber += 1;
    if (drawNumber === 3 && min === 1 && max === 10_000) return 8_001;
    if (drawNumber === 6 && min === 1 && max === 10_000) return 10_000;
    return min;
  };
  const death = {
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    monsterEntityId: 64_000,
    lootEventId: "m64000:d-fixture-001",
    monsterCatalog,
    itemCatalog,
    itemizationConfig,
    randomInt,
    now: 1_800_000_000_000,
    idFactory: randomUUID,
  };
  const result = awardCaracatoaItemizedMonsterLoot(death);
  assert.equal(result.awarded, true);
  assert.equal(result.slots.length, 5);
  const equipment = result.slots.find(({ itemization }) => itemization);
  assert.ok(equipment);
  assert.equal(equipment.itemization.rarity, "mystic");
  assert.equal(equipment.itemization.itemLevel, 1);
  assert.equal(equipment.itemization.affixes.length, 1);
  assert.equal(result.slots.filter(({ itemization }) => !itemization).length, 4);

  const stored = accountStore.getCharacterItemizationDetails("testplayer", 0);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].instanceId, equipment.itemization.instanceId);
  assert.equal(stored[0].sourceId, death.lootEventId);
  assert.equal(stored[0].rarity, "mystic");
  assert.equal(stored[0].affixes.length, 1);
  const equipped = applyCaracatoaEquipmentRequest({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    classId: 0,
    equipmentSlot: 0,
    inventorySlot: equipment.slot,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(equipped.accepted, true);
  const rolledAttackBonus = equipment.itemization.baseStats.physicalDamage +
    equipment.itemization.affixes
      .filter(({ stat }) => stat === "physicalDamageFlat")
      .reduce((sum, affix) => sum + affix.value, 0);
  assert.equal(equipped.bonuses.attackDamageBonus, rolledAttackBonus);
  assert.equal(equipped.equipment[0].inventorySlot, equipment.slot);
  assert.equal(accountStore.getCharacterItemizationDetails("testplayer", 0)[0].instanceId, equipment.itemization.instanceId);

  accountStore.close();
  accountStore = new PlayerAccountStore({ databasePath });
  assert.equal(accountStore.getCharacterItemizationDetails("testplayer", 0)[0].instanceId, equipment.itemization.instanceId);
  const restoredEquipment = resolveCaracatoaCharacterEquipment({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    classId: 0,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(restoredEquipment.equipment[0].inventorySlot, equipment.slot);
  assert.equal(restoredEquipment.bonuses.attackDamageBonus, rolledAttackBonus);
  assert.equal(accountStore.getCharacterItemizationDetails("testplayer", 0)[0].instanceId, equipment.itemization.instanceId);
  const duplicate = awardCaracatoaItemizedMonsterLoot({ ...death, accountStore });
  assert.deepEqual(duplicate, { awarded: false, reason: "already-awarded" });

  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
    assert.equal(inspection.prepare("SELECT count(*) AS count FROM player_character_itemization_kills").get().count, 1);
    assert.equal(inspection.prepare("SELECT count(*) AS count FROM itemization_audit_events").get().count, 5);
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    inspection.close();
  }
});

test("itemized catalog equipment cannot be equipped without its persisted instance", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-itemized-empty-instance-"));
  const accountStore = new PlayerAccountStore({ databasePath: join(directory, "players.sqlite") });
  t.after(() => {
    accountStore.close();
    return rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("TestPlayer", "SYNTHPASS", "135790");
  accountStore.createCharacter("testplayer", { slot: 0, classId: 0, name: "NoInstance" });
  accountStore.initializeCharacterInventory("testplayer", 0, ["caracatoa-ferro-votivo"]);
  assert.deepEqual(applyCaracatoaEquipmentRequest({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    classId: 0,
    equipmentSlot: 0,
    inventorySlot: 0,
    catalog: itemCatalog,
    itemizationConfig,
  }), { accepted: false, reason: "item-instance-unavailable" });
});

test("itemized armor adds its base defense and capped physical-defense affix", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-itemized-armor-"));
  const accountStore = new PlayerAccountStore({ databasePath: join(directory, "players.sqlite") });
  t.after(() => {
    accountStore.close();
    return rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("TestPlayer", "SYNTHPASS", "135790");
  accountStore.createCharacter("testplayer", { slot: 0, classId: 0, name: "ArmorTester" });
  accountStore.initializeCharacterInventory("testplayer", 0, []);

  const armorConfig = structuredClone(itemizationConfig);
  armorConfig.itemPools.starter = ["caracatoa-peitoral-de-cobre"];
  armorConfig.levelRules.affixScaleBaseBps = 10_000;
  let drawNumber = 0;
  const result = awardCaracatoaItemizedMonsterLoot({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    monsterEntityId: 64_000,
    lootEventId: "m64000:d-fixture-armor-001",
    monsterCatalog,
    itemCatalog,
    itemizationConfig: armorConfig,
    randomInt: (min, max) => {
      drawNumber += 1;
      if (drawNumber === 3 && min === 1 && max === 10_000) return 8_001;
      if (drawNumber === 5 && min === 1 && max > 600) return 601;
      if (drawNumber === 6 && min === 1 && max === 10_000) return 10_000;
      return min;
    },
    now: 1_800_000_000_001,
    idFactory: randomUUID,
  });
  const armor = result.slots.find(({ itemization }) => itemization);
  assert.ok(armor);
  assert.equal(armor.itemization.catalogItemId, "caracatoa-peitoral-de-cobre");
  assert.equal(armor.itemization.affixes[0].stat, "physicalDefenseFlat");
  const expectedDefense = armor.itemization.baseStats.physicalDefense +
    armor.itemization.affixes[0].value;
  const equipped = applyCaracatoaEquipmentRequest({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    classId: 0,
    equipmentSlot: 2,
    inventorySlot: armor.slot,
    catalog: itemCatalog,
    itemizationConfig: armorConfig,
  });
  assert.equal(equipped.accepted, true);
  assert.equal(equipped.bonuses.defenseBonus, expectedDefense);
  assert.equal(equipped.equipment[0].defenseBonus, expectedDefense);
});

test("itemized armor adds capped maximum HP and MP affixes to equipment totals", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-itemized-vitals-"));
  const accountStore = new PlayerAccountStore({ databasePath: join(directory, "players.sqlite") });
  t.after(() => {
    accountStore.close();
    return rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("TestPlayer", "SYNTHPASS", "135790");
  accountStore.createCharacter("testplayer", { slot: 0, classId: 1, name: "VitalTester" });
  accountStore.initializeCharacterInventory("testplayer", 0, []);

  const vitalsConfig = structuredClone(itemizationConfig);
  vitalsConfig.itemPools.starter = ["caracatoa-peitoral-de-cobre"];
  vitalsConfig.levelRules.affixScaleBaseBps = 10_000;
  vitalsConfig.monsterProfiles.common.maxAffixValueRollBps = 0;
  vitalsConfig.rarities.mystic.affixCount = { min: 2, max: 2 };
  const vital = vitalsConfig.affixes.find(({ id }) => id === "vital");
  const focused = vitalsConfig.affixes.find(({ id }) => id === "focused");
  vital.minValue = 10;
  focused.minValue = 8;
  vitalsConfig.affixes = [
    vital,
    focused,
    ...vitalsConfig.affixes.filter(({ id }) => id !== "vital" && id !== "focused"),
  ];

  let drawNumber = 0;
  const result = awardCaracatoaItemizedMonsterLoot({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    monsterEntityId: 64_000,
    lootEventId: "m64000:d-fixture-vitals-001",
    monsterCatalog,
    itemCatalog,
    itemizationConfig: vitalsConfig,
    randomInt(min) {
      drawNumber += 1;
      if (drawNumber === 3) return 8_001;
      return min;
    },
    now: 1_800_000_000_002,
    idFactory: randomUUID,
  });
  const armor = result.slots.find(({ itemization }) => itemization);
  assert.ok(armor);
  assert.deepEqual(armor.itemization.affixes.map(({ stat, value }) => ({ stat, value })), [
    { stat: "maxHpFlat", value: 10 },
    { stat: "maxMpFlat", value: 8 },
  ]);

  const equipped = applyCaracatoaEquipmentRequest({
    accountStore,
    accountId: "testplayer",
    characterSlot: 0,
    classId: 1,
    equipmentSlot: 2,
    inventorySlot: armor.slot,
    catalog: itemCatalog,
    itemizationConfig: vitalsConfig,
  });
  assert.equal(equipped.accepted, true);
  assert.equal(equipped.equipment[0].maxHpBonus, 11);
  assert.equal(equipped.equipment[0].maxMpBonus, 8);
  assert.deepEqual(equipped.bonuses, {
    attackDamageBonus: 0,
    magicAttackBonus: 0,
    magicAttackBps: 0,
    defenseBonus: equipped.equipment[0].defenseBonus,
    maxHpBonus: 11,
    maxMpBonus: 8,
    absorptionBps: 0,
    dropRateBps: 0,
    experienceBonusBps: 0,
    mpCostReductionBps: 0,
    cooldownReductionBps: 0,
  });
});

test("a v12 database upgrades to v16 without changing existing inventory rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-itemization-v12-"));
  const databasePath = join(directory, "players.sqlite");
  let accountStore = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    accountStore?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("TestPlayer", "SYNTHPASS", "135790");
  accountStore.createCharacter("testplayer", { slot: 0, classId: 1, name: "Legacy" });
  accountStore.initializeCharacterInventory("testplayer", 0, ["legacy-item"]);
  accountStore.close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TABLE player_guild_members;
    DROP TABLE player_guilds;
    DROP TABLE player_account_bank_items;
    DROP TABLE player_account_banks;
    DROP TABLE player_character_mounts;
    DROP TABLE itemization_audit_events;
    DROP TABLE player_character_itemization_kills;
    DROP TABLE player_character_item_affixes;
    DROP TABLE player_character_item_rolls;
    DROP TABLE player_character_stage_events;
    DROP TABLE player_shop_purchase_receipts;
    DROP TABLE player_shop_audit_events;
    DROP TABLE player_shop_listings;
    DROP INDEX player_character_inventory_shop_listing_unique;
    ALTER TABLE player_character_inventory DROP COLUMN shop_listing_id;
    ALTER TABLE player_characters DROP COLUMN progression_stage;
    DROP INDEX player_character_inventory_instance_unique;
    ALTER TABLE player_character_inventory DROP COLUMN item_instance_id;
    PRAGMA user_version = 12;
  `);
  legacy.close();

  accountStore = new PlayerAccountStore({ databasePath });
  assert.deepEqual(accountStore.initializeCharacterInventory("testplayer", 0, []), [
    { slot: 0, catalogItemId: "legacy-item", stackCount: 0 },
  ]);
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    inspection.close();
  }
});
