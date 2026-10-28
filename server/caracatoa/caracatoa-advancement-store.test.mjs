import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateBaseItemStats } from "./item-affix-system.mjs";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { applyCaracatoaEquipmentRequest, resolveCaracatoaCharacterEquipment } from "./wyd-727-item-equipment.mjs";

const itemCatalog = JSON.parse(await readFile(new URL("./data/catalogs/items.json", import.meta.url), "utf8"));
const itemizationConfig = JSON.parse(await readFile(new URL("./data/catalogs/itemization.json", import.meta.url), "utf8"));

async function fixture(t, accountId) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-advancement-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  await store.createAccount(accountId, "SYNTHPASS", "135790");
  store.createCharacter(accountId, { slot: 0, classId: 0, name: "Vigia" });
  store.initializeCharacterInventory(accountId, 0, []);
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    databasePath,
    get store() { return store; },
    close() {
      store?.close();
      store = null;
    },
    reopen() {
      store?.close();
      store = new PlayerAccountStore({ databasePath });
    },
  };
}

function catalogItem(itemId) {
  const entry = itemCatalog.entries.find((candidate) => candidate.id === itemId && candidate.enabled);
  assert.ok(entry, `catálogo deve conter ${itemId}`);
  return entry;
}

function stackDrop(itemId, quantity) {
  const item = catalogItem(itemId);
  const definition = itemizationConfig.itemDefinitions[itemId];
  assert.ok(definition);
  return {
    kind: "item",
    itemId,
    clientItemId: item.properties.clientItemId,
    quantity,
    stackCount: 1,
    stackLimit: definition.stackLimit,
  };
}

function addDrops(store, accountId, lootEventId, drops) {
  const result = store.awardCharacterItemizationLoot({
    accountId,
    characterSlot: 0,
    lootEventId,
    drops,
    now: 1_800_000_000_000,
  });
  assert.equal(result.granted, true);
  return result;
}

function refine(store, accountId, inventorySlot, options = {}) {
  return store.refineCharacterItem({
    accountId,
    characterSlot: 0,
    inventorySlot,
    eventId: options.eventId ?? randomUUID(),
    useDivineDust: options.useDivineDust ?? false,
    itemCatalog,
    itemizationConfig,
    nowMs: 1_800_000_000_000,
    randomInt: options.randomInt ?? ((minimum) => minimum),
  });
}

test("refinement consumes catalysts atomically, survives replay, affects equipped stats, and supports Divine Dust", async (t) => {
  const state = await fixture(t, "refiner");
  assert.equal(state.store.awardCharacterExperience("refiner", 0, 49_500).level, 100);
  const weapon = catalogItem("caracatoa-ferro-votivo");
  const baseStats = calculateBaseItemStats(itemizationConfig, "weapon_1h", 100, "normal");
  const drops = addDrops(state.store, "refiner", "advancement:refine:initial", [
    {
      kind: "equipment",
      catalogItemId: weapon.id,
      clientItemId: weapon.properties.clientItemId,
      instanceId: randomUUID(),
      rarity: "normal",
      itemLevel: 100,
      baseStats,
      affixes: [],
    },
    stackDrop("caracatoa-poeira-de-oriharucon", 8),
    stackDrop("caracatoa-fragmento-de-lactolerium", 5),
    stackDrop("caracatoa-pedra-do-sabio", 1),
    stackDrop("caracatoa-poeira-divina", 1),
  ]);
  const equipment = drops.slots.find((entry) => entry.itemization);
  assert.ok(equipment);

  const firstRequestId = randomUUID();
  const first = refine(state.store, "refiner", equipment.slot, { eventId: firstRequestId });
  assert.equal(first.status, "success");
  assert.equal(first.newLevel, 1);
  assert.equal(first.inventoryChanges[0].catalogItemId, "caracatoa-poeira-de-oriharucon");
  const replay = refine(state.store, "refiner", equipment.slot, { eventId: firstRequestId });
  assert.equal(replay.status, "duplicate");
  assert.deepEqual(replay.inventoryChanges, []);
  assert.equal(state.store.getCharacterItemizationDetails("refiner", 0)[0].refinementLevel, 1);

  for (let target = 2; target <= 6; target += 1) {
    const result = refine(state.store, "refiner", equipment.slot);
    assert.equal(result.status, "success");
    assert.equal(result.newLevel, target);
  }
  const failed = refine(state.store, "refiner", equipment.slot, {
    randomInt: (_minimum, maximum) => maximum,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.targetLevel, 7);
  assert.equal(failed.newLevel, 5);
  assert.equal(failed.materialClientItemId, 8103);

  const tooEarlyForDivine = refine(state.store, "refiner", equipment.slot, { useDivineDust: true });
  assert.equal(tooEarlyForDivine.reason, "divine-level-too-low");
  assert.equal(tooEarlyForDivine.inventoryChanges.length, 0);

  assert.equal(refine(state.store, "refiner", equipment.slot).newLevel, 6);
  assert.equal(refine(state.store, "refiner", equipment.slot).newLevel, 7);
  assert.equal(refine(state.store, "refiner", equipment.slot).newLevel, 8);
  assert.equal(refine(state.store, "refiner", equipment.slot).newLevel, 9);
  const divine = refine(state.store, "refiner", equipment.slot, { useDivineDust: true });
  assert.equal(divine.status, "success");
  assert.equal(divine.targetLevel, 10);
  assert.equal(divine.chanceBps, 10_000);
  assert.deepEqual(divine.consumed.map((entry) => entry.catalogItemId), [
    "caracatoa-pedra-do-sabio",
    "caracatoa-poeira-divina",
  ]);

  assert.equal(applyCaracatoaEquipmentRequest({
    accountStore: state.store,
    accountId: "refiner",
    characterSlot: 0,
    classId: 0,
    equipmentSlot: 0,
    inventorySlot: equipment.slot,
    catalog: itemCatalog,
    itemizationConfig,
  }).accepted, true);
  const equipped = resolveCaracatoaCharacterEquipment({
    accountStore: state.store,
    accountId: "refiner",
    characterSlot: 0,
    classId: 0,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(state.store.getCharacterItemizationDetails("refiner", 0)[0].refinementLevel, 10);
  assert.equal(equipped.equipment[0].attackDamageBonus, Math.floor(baseStats.physicalDamage * 1.35));

  const inventory = state.store.initializeCharacterInventory("refiner", 0, []);
  assert.equal(inventory.find((entry) => entry.catalogItemId === "caracatoa-poeira-de-oriharucon").stackCount, 1);
  assert.equal(inventory.find((entry) => entry.catalogItemId === "caracatoa-fragmento-de-lactolerium").stackCount, 1);
});

test("stage cap partially awards final experience, ritual consumes its seal once, and carries progression", async (t) => {
  const state = await fixture(t, "ascender");
  const early = state.store.promoteCharacterStage("ascender", {
    characterSlot: 0,
    eventId: randomUUID(),
    nowMs: 10,
  });
  assert.equal(early.reason, "level-cap-required");

  const award = state.store.awardCharacterExperience("ascender", 0, 900_000);
  assert.equal(award.gained, 798_000);
  assert.equal(award.level, 400);
  assert.equal(award.experience, 798_000);
  const attributesBefore = state.store.getCharacterAttributes("ascender", 0);
  const skillsBefore = state.store.getCharacterSkillState("ascender", 0);
  assert.equal(state.store.awardCharacterExperience("ascender", 0, 1), null);

  const noSeal = state.store.promoteCharacterStage("ascender", {
    characterSlot: 0,
    eventId: randomUUID(),
    nowMs: 11,
  });
  assert.equal(noSeal.reason, "missing-material");

  addDrops(state.store, "ascender", "advancement:stage:seal", [
    stackDrop("caracatoa-selo-do-abismo", 1),
  ]);
  const eventId = randomUUID();
  const promoted = state.store.promoteCharacterStage("ascender", {
    characterSlot: 0,
    eventId,
    nowMs: 12,
  });
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.toStage, "arch");
  assert.equal(promoted.state.level, 1);
  assert.equal(promoted.state.totalLevel, 401);
  assert.equal(promoted.state.experience, 802_000);
  assert.equal(promoted.state.availableAttributePoints, attributesBefore.availablePoints + 25);
  assert.equal(promoted.state.availableSkillPoints, skillsBefore.availablePoints + 5);

  const replay = state.store.promoteCharacterStage("ascender", {
    characterSlot: 0,
    eventId,
    nowMs: 13,
  });
  assert.equal(replay.status, "duplicate");
  assert.equal(replay.state.totalLevel, 401);
  assert.equal(state.store.initializeCharacterInventory("ascender", 0, []).some(
    (entry) => entry.catalogItemId === "caracatoa-selo-do-abismo",
  ), false);
});

test("v15 character levels migrate into their matching progression stage", async (t) => {
  const state = await fixture(t, "migration");
  state.close();
  const oldDatabase = new DatabaseSync(state.databasePath);
  oldDatabase.exec(`
    UPDATE player_characters SET level = 450, experience = 1_010_250
      WHERE account_id = 'migration' AND slot = 0;
    DROP TABLE player_character_stage_events;
    ALTER TABLE player_characters DROP COLUMN progression_stage;
    DROP TABLE player_shop_purchase_receipts;
    DROP TABLE player_shop_audit_events;
    DROP TABLE player_shop_listings;
    DROP INDEX player_character_inventory_shop_listing_unique;
    ALTER TABLE player_character_inventory DROP COLUMN shop_listing_id;
    PRAGMA user_version = 15;
  `);
  oldDatabase.close();
  state.reopen();
  const stage = state.store.getCharacterStageState("migration", 0);
  assert.equal(stage.stage, "arch");
  assert.equal(stage.level, 50);
  assert.equal(stage.totalLevel, 450);
  const inspection = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
  } finally {
    inspection.close();
  }
});
