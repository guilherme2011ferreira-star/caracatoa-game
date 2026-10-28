import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { CaracatoaFoundationError } from "./caracatoa-foundation-store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-foundation-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.createAccount("founder", "SYNTHPASS", "123456");
  store.createCharacter("founder", { slot: 0, classId: 0, name: "Founder" });
  store.createCharacter("founder", { slot: 1, classId: 1, name: "Second" });
  return {
    databasePath,
    get store() { return store; },
    reopen() { store?.close(); store = new PlayerAccountStore({ databasePath }); return store; },
    close() { store.close(); store = null; },
  };
}

test("v15 bank transfers gold and common stacks atomically across two characters", async (t) => {
  const state = await fixture(t);
  const db = new DatabaseSync(state.databasePath);
  try {
    db.prepare("UPDATE player_characters SET gold = 100 WHERE account_id = 'founder' AND slot = 0").run();
    db.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
      VALUES ('founder', 0, 4, 'caracatoa-racao-de-campo', 8)
    `).run();
  } finally { db.close(); }

  assert.deepEqual(state.store.getAccountBank("founder").items, []);
  assert.equal(state.store.transferAccountBankGold("founder", {
    characterSlot: 0, direction: "deposit", amount: 65, nowMs: 10,
  }).bankGold, 65);
  assert.equal(state.store.transferAccountBankGold("founder", {
    characterSlot: 1, direction: "withdraw", amount: 20, nowMs: 11,
  }).bankGold, 45);
  assert.equal(state.store.transferAccountBankGold("founder", {
    characterSlot: 0, direction: "deposit", amount: 999, nowMs: 12,
  }).status, "insufficient-character-gold");
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 0, direction: "deposit", inventorySlot: 4, bankSlot: 3, amount: 5, nowMs: 13,
  }).status, "transferred");
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 1, direction: "withdraw", inventorySlot: 7, bankSlot: 3, amount: 2, nowMs: 14,
  }).status, "transferred");
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 1, direction: "withdraw", inventorySlot: 8, bankSlot: 3, amount: 4, nowMs: 15,
  }).status, "insufficient-items");
  assert.deepEqual(state.store.getAccountBank("founder"), {
    gold: 45, updatedAtMs: 14,
    items: [{ slot: 3, catalogItemId: "caracatoa-racao-de-campo", stackCount: 3 }],
  });

  state.reopen();
  assert.equal(state.store.getAccountBank("founder").gold, 45);
  const inspection = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
    assert.equal(inspection.prepare("SELECT gold FROM player_characters WHERE account_id='founder' AND slot=0").get().gold, 35);
    assert.equal(inspection.prepare("SELECT gold FROM player_characters WHERE account_id='founder' AND slot=1").get().gold, 20);
    assert.equal(inspection.prepare("SELECT stack_count FROM player_character_inventory WHERE account_id='founder' AND character_slot=0 AND inventory_slot=4").get().stack_count, 3);
    assert.equal(inspection.prepare("SELECT stack_count FROM player_character_inventory WHERE account_id='founder' AND character_slot=1 AND inventory_slot=7").get().stack_count, 2);
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { inspection.close(); }
});

test("bank refuses itemized or equipped rows and guild identity is unique", async (t) => {
  const state = await fixture(t);
  const db = new DatabaseSync(state.databasePath);
  try {
    db.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count, equipment_slot)
      VALUES ('founder', 0, 4, 'caracatoa-racao-de-campo', 3, 0)
    `).run();
    db.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count, item_instance_id)
      VALUES ('founder', 0, 5, 'caracatoa-ferro-votivo', 1,
        '11111111-1111-4111-8111-111111111111')
    `).run();
    db.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
      VALUES ('founder', 0, 6, 'caracatoa-lamina-de-treino', 1)
    `).run();
  } finally { db.close(); }
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 0, direction: "deposit", inventorySlot: 4, bankSlot: 0, amount: 1,
  }).status, "item-not-bankable");
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 0, direction: "deposit", inventorySlot: 5, bankSlot: 0, amount: 1,
  }).status, "item-not-bankable");
  assert.equal(state.store.transferAccountBankItem("founder", {
    characterSlot: 0, direction: "deposit", inventorySlot: 6, bankSlot: 0, amount: 1,
  }).status, "item-not-bankable");
  const guild = state.store.createCharacterGuild("founder", {
    characterSlot: 0, name: "Vigias do Vale", nowMs: 25,
  });
  assert.equal(state.store.getCharacterGuild("founder", 0).guildId, guild.guildId);
  assert.equal(state.store.getCharacterGuild("founder", 0).role, "leader");
  assert.equal(state.store.getCharacterGuild("founder", 1), null);
  assert.throws(() => state.store.createCharacterGuild("founder", {
    characterSlot: 1, name: "VIGIAS DO VALE", nowMs: 26,
  }), (error) => error instanceof CaracatoaFoundationError && error.code === "GUILD_NAME_EXISTS");
  assert.throws(() => state.store.createCharacterGuild("founder", {
    characterSlot: 0, name: "Outra Guilda", nowMs: 27,
  }), (error) => error instanceof CaracatoaFoundationError && error.code === "ALREADY_IN_GUILD");
  state.reopen();
  assert.equal(state.store.getCharacterGuild("founder", 0).name, "Vigias do Vale");
});

test("a v14 database migrates through v17 without changing existing account or mount rows", async (t) => {
  const state = await fixture(t);
  const egg = state.store.grantCharacterMountEgg("founder", {
    characterSlot: 0, speciesId: "equus", sourceEventId: "fixture:v14:egg", nowMs: 3,
  });
  state.close();
  const legacy = new DatabaseSync(state.databasePath);
  try {
    legacy.exec(`
      DROP TABLE player_guild_members;
      DROP TABLE player_guilds;
      DROP TABLE player_shop_purchase_receipts;
      DROP TABLE player_shop_audit_events;
      DROP TABLE player_shop_listings;
      DROP INDEX player_character_inventory_shop_listing_unique;
      ALTER TABLE player_character_inventory DROP COLUMN shop_listing_id;
      DROP TABLE player_account_bank_items;
      DROP TABLE player_account_banks;
      DROP TABLE player_character_stage_events;
      ALTER TABLE player_characters DROP COLUMN progression_stage;
      PRAGMA user_version = 14;
    `);
  } finally { legacy.close(); }
  state.reopen();
  assert.equal(state.store.getCharacterBySlot("founder", 0).name, "Founder");
  assert.equal(state.store.listCharacterMounts("founder", 0)[0].id, egg.id);
  assert.equal(state.store.getAccountBank("founder").gold, 0);
  const inspection = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { inspection.close(); }
});
