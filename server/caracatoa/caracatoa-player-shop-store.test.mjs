import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-shop-"));
  const databasePath = join(directory, "players.sqlite");
  const store = new PlayerAccountStore({ databasePath });
  await store.createAccount("ShopAlpha", "ALPHAPASS", "135790");
  await store.createAccount("ShopBeta", "BETAPASS", "246810");
  store.createCharacter("shopalpha", { slot: 0, classId: 0, name: "Artesao" });
  store.createCharacter("shopbeta", { slot: 0, classId: 1, name: "Aventureira" });
  store.initializeCharacterInventory("shopalpha", 0, ["caracatoa-lamina-de-treino", "alpha-token"]);
  store.initializeCharacterInventory("shopbeta", 0, ["beta-token"]);
  const database = new DatabaseSync(databasePath);
  const instanceId = "11111111-2222-4333-8444-555555555555";
  try {
    database.prepare("UPDATE player_characters SET gold = 1000 WHERE account_id = 'shopalpha' AND slot = 0").run();
    database.prepare("UPDATE player_characters SET gold = 5000 WHERE account_id = 'shopbeta' AND slot = 0").run();
    database.prepare(`
      UPDATE player_character_inventory SET item_instance_id = ?
      WHERE account_id = 'shopalpha' AND character_slot = 0 AND inventory_slot = 0
    `).run(instanceId);
    database.prepare(`
      INSERT INTO player_character_item_rolls
        (item_instance_id, client_item_id, rarity, item_level, refinement_level,
         base_stats_json, source_kind, source_id, catalog_version, created_at_ms)
      VALUES (?, 7001, 'legendary', 80, 7, '{"physical_attack":40}',
        'monster-drop', 'shop-fixture-drop', 'fixture-v1', 1)
    `).run(instanceId);
    database.prepare(`
      INSERT INTO player_character_item_affixes
        (item_instance_id, affix_index, client_affix_id, affix_id, stat_id, value, value_unit)
      VALUES (?, 0, 4, 'keen', 'critical_chance', 350, 'basis-points')
    `).run(instanceId);
  } finally {
    database.close();
  }
  const state = { store, databasePath, instanceId };
  state.reopen = () => {
    state.store.close();
    state.store = new PlayerAccountStore({ databasePath });
    return state.store;
  };
  t.after(async () => {
    state.store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return state;
}

function inspect(databasePath, read) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try { return read(database); } finally { database.close(); }
}

test("anúncio reserva o item e compra atômica preserva UUID, afixos e gold", async (t) => {
  const state = await fixture(t);
  const createdAt = Date.now();
  const listing = state.store.createPlayerShopListing("shopalpha", {
    characterSlot: 0, inventorySlot: 0, askingGold: 1250, nowMs: createdAt,
  });
  assert.equal(listing.accepted, true);
  assert.equal(listing.listing.askingGold, 1250);
  assert.equal(listing.listing.itemInstanceId, state.instanceId);
  assert.deepEqual(state.store.initializeCharacterInventory("shopalpha", 0, []).map((row) => row.slot), [1]);
  assert.deepEqual(state.store.getCharacterItemizationDetails("shopalpha", 0), []);
  assert.equal(state.store.setCharacterEquipment({
    accountId: "shopalpha", characterSlot: 0, equipmentSlot: 0, inventorySlot: 0,
  }).accepted, false);

  const market = state.store.listPlayerShopListings("shopbeta", {
    characterSlot: 0, view: "market", nowMs: createdAt + 1,
  });
  assert.equal(market.listings[0].listingId, listing.listing.listingId);
  assert.equal(market.listings[0].own, false);
  assert.equal(state.store.listPlayerShopListings("shopalpha", {
    characterSlot: 0, view: "mine", nowMs: createdAt + 1,
  }).listings[0].own, true);

  const request = {
    characterSlot: 0,
    listingId: listing.listing.listingId,
    requestId: "00000000-0000-4000-8000-000000000002",
    nowMs: createdAt + 2,
  };
  const bought = state.store.buyPlayerShopListing("shopbeta", request);
  assert.equal(bought.accepted, true);
  assert.equal(bought.receipt.buyerGoldBalance, 3750);
  assert.equal(bought.receipt.sellerGoldBalance, 2250);
  assert.equal(bought.receipt.inventorySlot, 1);
  assert.equal(bought.sellerAccount, "shopalpha");
  const replay = state.store.buyPlayerShopListing("shopbeta", request);
  assert.equal(replay.accepted, true);
  assert.equal(replay.alreadyCommitted, true);

  assert.deepEqual(state.store.getCharacterItemizationDetails("shopbeta", 0).map((row) => ({
    slot: row.slot, instanceId: row.instanceId, rarity: row.rarity,
    refinementLevel: row.refinementLevel, affix: row.affixes[0]?.id,
  })), [{ slot: 1, instanceId: state.instanceId, rarity: "legendary", refinementLevel: 7, affix: "keen" }]);
  assert.deepEqual(inspect(state.databasePath, (db) => ({
    balances: db.prepare("SELECT account_id AS id, gold FROM player_characters ORDER BY account_id").all().map((row) => ({ ...row })),
    item: { ...db.prepare("SELECT account_id AS id, inventory_slot AS slot, shop_listing_id AS listing FROM player_character_inventory WHERE item_instance_id = ?").get(state.instanceId) },
    audits: db.prepare("SELECT action FROM player_shop_audit_events ORDER BY rowid").all().map((row) => row.action),
    receipts: db.prepare("SELECT COUNT(*) AS count FROM player_shop_purchase_receipts").get().count,
    schemaVersion: db.prepare("PRAGMA user_version").get().user_version,
  })), {
    balances: [{ id: "shopalpha", gold: 2250 }, { id: "shopbeta", gold: 3750 }],
    item: { id: "shopbeta", slot: 1, listing: null },
    audits: ["listed", "purchased", "sold"],
    receipts: 1,
    schemaVersion: 17,
  });
});

test("cancelamento e expiração devolvem o item; compra recusa gold e anúncio próprio", async (t) => {
  const state = await fixture(t);
  const nowMs = Date.now();
  const created = state.store.createPlayerShopListing("shopalpha", {
    characterSlot: 0, inventorySlot: 0, askingGold: 6000, nowMs,
  });
  assert.deepEqual(state.store.buyPlayerShopListing("shopalpha", {
    characterSlot: 0, listingId: created.listing.listingId,
    requestId: "00000000-0000-4000-8000-000000000003", nowMs: nowMs + 1,
  }), { accepted: false, reason: "own-listing" });
  assert.deepEqual(state.store.buyPlayerShopListing("shopbeta", {
    characterSlot: 0, listingId: created.listing.listingId,
    requestId: "00000000-0000-4000-8000-000000000004", nowMs: nowMs + 1,
  }), { accepted: false, reason: "insufficient-gold", goldBalance: 5000 });
  const canceled = state.store.cancelPlayerShopListing("shopalpha", {
    characterSlot: 0, listingId: created.listing.listingId, nowMs: nowMs + 2,
  });
  assert.equal(canceled.accepted, true);
  assert.deepEqual(state.store.initializeCharacterInventory("shopalpha", 0, []).map((row) => row.slot), [0, 1]);

  const expiring = state.store.createPlayerShopListing("shopalpha", {
    characterSlot: 0, inventorySlot: 0, askingGold: 100, nowMs: nowMs + 3,
  });
  assert.equal(state.store.expirePlayerShopListings(expiring.listing.expiresAtMs).valueOf(), 1);
  assert.deepEqual(state.store.initializeCharacterInventory("shopalpha", 0, []).map((row) => row.slot), [0, 1]);
  assert.deepEqual(state.store.buyPlayerShopListing("shopbeta", {
    characterSlot: 0, listingId: expiring.listing.listingId,
    requestId: "00000000-0000-4000-8000-000000000005", nowMs: expiring.listing.expiresAtMs,
  }), { accepted: false, reason: "listing-expired" });
});

test("anúncio e escrow sobrevivem à reabertura do banco enquanto o vendedor está offline", async (t) => {
  const state = await fixture(t);
  const nowMs = Date.now();
  const created = state.store.createPlayerShopListing("shopalpha", {
    characterSlot: 0, inventorySlot: 0, askingGold: 700, nowMs,
  });
  assert.equal(created.accepted, true);
  const listingId = created.listing.listingId;
  state.reopen();

  const market = state.store.listPlayerShopListings("shopbeta", {
    characterSlot: 0, view: "market", nowMs: nowMs + 1,
  });
  assert.equal(market.listings[0].listingId, listingId);
  assert.equal(market.listings[0].own, false);
  assert.deepEqual(state.store.initializeCharacterInventory("shopalpha", 0, []).map((row) => row.slot), [1]);
  assert.deepEqual(state.store.getCharacterItemizationDetails("shopalpha", 0), []);

  const bought = state.store.buyPlayerShopListing("shopbeta", {
    characterSlot: 0,
    listingId,
    requestId: "00000000-0000-4000-8000-000000000006",
    nowMs: nowMs + 2,
  });
  assert.equal(bought.accepted, true);
  assert.equal(state.store.getCharacterBySlot("shopalpha", 0).gold, 1700);
  assert.deepEqual(state.store.getCharacterItemizationDetails("shopbeta", 0).map((item) => ({
    slot: item.slot, instanceId: item.instanceId, affix: item.affixes[0]?.id,
  })), [{ slot: 1, instanceId: state.instanceId, affix: "keen" }]);
});
