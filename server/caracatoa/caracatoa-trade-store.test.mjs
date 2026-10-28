import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";

async function temporaryTradeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-trade-"));
  const databasePath = join(directory, "players.sqlite");
  const store = new PlayerAccountStore({ databasePath });
  await store.createAccount("TradeAlpha", "ALPHAPASS", "135790");
  await store.createAccount("TradeBeta", "BETAPASS", "246810");
  store.createCharacter("tradealpha", { slot: 0, classId: 0, name: "Alpha" });
  store.createCharacter("tradebeta", { slot: 0, classId: 1, name: "Beta" });
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, databasePath };
}

function seedGold(databasePath, values) {
  const database = new DatabaseSync(databasePath);
  try {
    for (const [accountId, gold] of Object.entries(values)) {
      database.prepare("UPDATE player_characters SET gold = ? WHERE account_id = ? AND slot = 0")
        .run(gold, accountId);
    }
  } finally {
    database.close();
  }
}

test("troca atômica move itens e gold nos dois sentidos e é idempotente", async (t) => {
  const fixture = await temporaryTradeFixture(t);
  fixture.store.initializeCharacterInventory("tradealpha", 0, ["alpha-sword", "alpha-token"]);
  fixture.store.initializeCharacterInventory("tradebeta", 0, ["beta-cape"]);
  seedGold(fixture.databasePath, { tradealpha: 1000, tradebeta: 200 });

  const request = {
    tradeId: "00000000-0000-4000-8000-000000000001",
    first: { accountId: "TRADEALPHA", characterSlot: 0, inventorySlot: 0, gold: 125 },
    second: { accountId: "tradebeta", characterSlot: 0, inventorySlot: 0, gold: 50 },
    now: 123456,
  };
  const result = fixture.store.executeCharacterTrade(request);
  assert.equal(result.accepted, true);
  assert.equal(result.committed, true);
  assert.equal(result.alreadyCommitted, false);
  assert.deepEqual(result.participants, [
    {
      accountId: "tradealpha",
      characterSlot: 0,
      gold: 925,
      received: { slot: 2, catalogItemId: "beta-cape", instanceId: null, stackCount: 0 },
    },
    {
      accountId: "tradebeta",
      characterSlot: 0,
      gold: 275,
      received: { slot: 1, catalogItemId: "alpha-sword", instanceId: null, stackCount: 0 },
    },
  ]);

  const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    const items = database.prepare(`
      SELECT account_id AS accountId, inventory_slot AS slot, catalog_item_id AS itemId
      FROM player_character_inventory WHERE character_slot = 0 ORDER BY account_id, inventory_slot
    `).all().map(({ accountId, slot, itemId }) => ({ accountId, slot, itemId }));
    assert.deepEqual(items, [
      { accountId: "tradealpha", slot: 1, itemId: "alpha-token" },
      { accountId: "tradealpha", slot: 2, itemId: "beta-cape" },
      { accountId: "tradebeta", slot: 1, itemId: "alpha-sword" },
    ]);
    const balances = database.prepare(`
      SELECT account_id AS accountId, gold FROM player_characters ORDER BY account_id
    `).all().map(({ accountId, gold }) => ({ accountId, gold }));
    assert.deepEqual(balances, [
      { accountId: "tradealpha", gold: 925 },
      { accountId: "tradebeta", gold: 275 },
    ]);
    assert.equal(database.prepare(`
      SELECT count(*) AS count FROM itemization_audit_events
      WHERE action = 'trade' AND source_id = ?
    `).get(request.tradeId).count, 2);
  } finally {
    database.close();
  }

  assert.deepEqual(
    fixture.store.executeCharacterTrade(request),
    { accepted: true, committed: true, alreadyCommitted: true },
  );
});

test("transferência preserva o UUID e os dados persistentes de um item afixado", async (t) => {
  const fixture = await temporaryTradeFixture(t);
  fixture.store.initializeCharacterInventory("tradealpha", 0, []);
  fixture.store.initializeCharacterInventory("tradebeta", 0, []);
  const instanceId = "11111111-2222-4333-8444-555555555555";
  const database = new DatabaseSync(fixture.databasePath);
  try {
    database.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count, item_instance_id)
      VALUES ('tradealpha', 0, 0, 'astral-cuirass', 1, ?)
    `).run(instanceId);
    database.prepare(`
      INSERT INTO player_character_item_rolls
        (item_instance_id, client_item_id, rarity, item_level, refinement_level,
         base_stats_json, source_kind, source_id, catalog_version, created_at_ms)
      VALUES (?, 8221, 'legendary', 80, 3, '{}', 'monster-drop', 'fixture-drop', 'fixture-v1', 1)
    `).run(instanceId);
  } finally {
    database.close();
  }

  const result = fixture.store.executeCharacterTrade({
    tradeId: "00000000-0000-4000-8000-000000000002",
    first: { accountId: "tradealpha", characterSlot: 0, inventorySlot: 0, gold: 0 },
    second: { accountId: "tradebeta", characterSlot: 0, inventorySlot: null, gold: 0 },
    now: 123457,
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.participants[1].received, {
    slot: 0,
    catalogItemId: "astral-cuirass",
    instanceId,
    stackCount: 1,
  });
  assert.equal(fixture.store.getCharacterItemizationDetails("tradealpha", 0).length, 0);
  assert.equal(fixture.store.getCharacterItemizationDetails("tradebeta", 0)[0].instanceId, instanceId);
});

test("recusa item equipado, gold insuficiente e mochila cheia sem mutações", async (t) => {
  const fixture = await temporaryTradeFixture(t);
  fixture.store.initializeCharacterInventory("tradealpha", 0, ["alpha-sword"]);
  fixture.store.initializeCharacterInventory("tradebeta", 0, Array.from({ length: 60 }, (_, index) => `beta-item-${index}`));
  seedGold(fixture.databasePath, { tradealpha: 10, tradebeta: 20 });

  const base = {
    tradeId: "00000000-0000-4000-8000-000000000003",
    first: { accountId: "tradealpha", characterSlot: 0, inventorySlot: 0, gold: 15 },
    second: { accountId: "tradebeta", characterSlot: 0, inventorySlot: null, gold: 0 },
    now: 123458,
  };
  assert.deepEqual(fixture.store.executeCharacterTrade(base), {
    accepted: false,
    reason: "insufficient-gold",
  });

  const equipped = fixture.store.setCharacterEquipment({
    accountId: "tradealpha", characterSlot: 0, equipmentSlot: 0, inventorySlot: 0,
  });
  assert.equal(equipped.accepted, true);
  assert.deepEqual(fixture.store.executeCharacterTrade({
    ...base,
    tradeId: "00000000-0000-4000-8000-000000000004",
    first: { ...base.first, gold: 0 },
  }), { accepted: false, reason: "item-equipped" });

  fixture.store.setCharacterEquipment({
    accountId: "tradealpha", characterSlot: 0, equipmentSlot: 0, inventorySlot: null,
  });
  assert.deepEqual(fixture.store.executeCharacterTrade({
    ...base,
    tradeId: "00000000-0000-4000-8000-000000000005",
    first: { ...base.first, gold: 0 },
  }), { accepted: false, reason: "inventory-full" });

  const database = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare(`SELECT gold FROM player_characters WHERE account_id='tradealpha'`).get().gold, 10);
    assert.equal(database.prepare(`SELECT gold FROM player_characters WHERE account_id='tradebeta'`).get().gold, 20);
    assert.equal(database.prepare(`SELECT account_id FROM player_character_inventory WHERE catalog_item_id='alpha-sword'`).get().account_id, "tradealpha");
    assert.equal(database.prepare("SELECT count(*) AS count FROM itemization_audit_events WHERE action='trade'").get().count, 0);
  } finally {
    database.close();
  }
});

test("não permite auto-troca e rejeita payload inválido", async (t) => {
  const fixture = await temporaryTradeFixture(t);
  fixture.store.initializeCharacterInventory("tradealpha", 0, ["alpha-sword"]);
  assert.throws(() => fixture.store.executeCharacterTrade({
    tradeId: "00000000-0000-4000-8000-000000000006",
    first: { accountId: "tradealpha", characterSlot: 0, inventorySlot: null, gold: 0 },
    second: { accountId: "TRADEALPHA", characterSlot: 0, inventorySlot: null, gold: 0 },
  }), { code: "PLAYER_CHARACTER_INPUT_INVALID" });
  assert.deepEqual(fixture.store.executeCharacterTrade({
    tradeId: "00000000-0000-4000-8000-000000000007",
    first: { accountId: "tradealpha", characterSlot: 0, inventorySlot: null, gold: 0 },
    second: { accountId: "tradebeta", characterSlot: 0, inventorySlot: null, gold: 0 },
  }), { accepted: false, reason: "empty-offer" });
});
