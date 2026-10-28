import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GOLD = 2_147_483_647;
const MAX_ACTIVE_PER_CHARACTER = 4;
const LISTING_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const ITEM_CATALOG = JSON.parse(readFileSync(
  new URL("./data/catalogs/items.json", import.meta.url), "utf8",
));
const ITEM_BY_CATALOG_ID = new Map(ITEM_CATALOG.entries
  .filter((entry) => entry.enabled === true)
  .map((entry) => [entry.id, entry]));

export class CaracatoaPlayerShopError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaracatoaPlayerShopError";
    this.code = code;
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CaracatoaPlayerShopError("INVALID_INPUT", `${label} inválido.`);
  }
}

function identity(accountId, characterSlot) {
  if (typeof accountId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,14}$/i.test(accountId)) {
    throw new CaracatoaPlayerShopError("INVALID_INPUT", "Conta inválida.");
  }
  integer(characterSlot, 0, 3, "Slot de personagem");
  return accountId.toLowerCase();
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new CaracatoaPlayerShopError("INVALID_INPUT", `${label} inválido.`);
  }
  return value.toLowerCase();
}

function validTime(nowMs) {
  integer(nowMs, 0, Number.MAX_SAFE_INTEGER, "Horário");
}

export function migrateCaracatoaPlayerShopSchema(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version === 17) return;
  if (version !== 16) {
    throw new Error(`Migração de lojas exige schema v16; recebeu v${version}.`);
  }
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(`
      ALTER TABLE player_character_inventory ADD COLUMN shop_listing_id TEXT
        CHECK (shop_listing_id IS NULL OR length(shop_listing_id) = 36);
      CREATE UNIQUE INDEX player_character_inventory_shop_listing_unique
        ON player_character_inventory(shop_listing_id) WHERE shop_listing_id IS NOT NULL;
      CREATE TABLE player_shop_listings (
        listing_id TEXT PRIMARY KEY NOT NULL CHECK (length(listing_id) = 36),
        seller_account TEXT NOT NULL,
        seller_character_slot INTEGER NOT NULL CHECK (seller_character_slot BETWEEN 0 AND 3),
        seller_name TEXT NOT NULL CHECK (length(seller_name) BETWEEN 1 AND 16),
        inventory_slot INTEGER NOT NULL CHECK (inventory_slot BETWEEN 0 AND 59),
        catalog_item_id TEXT NOT NULL CHECK (length(catalog_item_id) BETWEEN 1 AND 64),
        client_item_id INTEGER NOT NULL CHECK (client_item_id BETWEEN 1 AND 65535),
        item_instance_id TEXT CHECK (item_instance_id IS NULL OR length(item_instance_id) = 36),
        stack_count INTEGER NOT NULL CHECK (stack_count BETWEEN 1 AND 500),
        asking_gold INTEGER NOT NULL CHECK (asking_gold BETWEEN 1 AND 2147483647),
        status TEXT NOT NULL CHECK (status IN ('active', 'sold', 'cancelled', 'expired', 'invalidated')),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
        buyer_account TEXT,
        buyer_character_slot INTEGER CHECK (buyer_character_slot IS NULL OR buyer_character_slot BETWEEN 0 AND 3),
        completed_at_ms INTEGER CHECK (completed_at_ms IS NULL OR completed_at_ms >= 0)
      ) STRICT;
      CREATE UNIQUE INDEX player_shop_one_active_listing_per_item
        ON player_shop_listings(seller_account, seller_character_slot, inventory_slot)
        WHERE status = 'active';
      CREATE INDEX player_shop_listings_active_by_time
        ON player_shop_listings(status, created_at_ms DESC);
      CREATE INDEX player_shop_listings_by_seller
        ON player_shop_listings(seller_account, seller_character_slot, status, created_at_ms DESC);
      CREATE TABLE player_shop_purchase_receipts (
        request_id TEXT PRIMARY KEY NOT NULL CHECK (length(request_id) = 36),
        listing_id TEXT NOT NULL CHECK (length(listing_id) = 36),
        buyer_account TEXT NOT NULL,
        buyer_character_slot INTEGER NOT NULL CHECK (buyer_character_slot BETWEEN 0 AND 3),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
      ) STRICT;
      CREATE TABLE player_shop_audit_events (
        event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) = 36),
        listing_id TEXT NOT NULL CHECK (length(listing_id) = 36),
        action TEXT NOT NULL CHECK (action IN ('listed', 'purchased', 'sold', 'cancelled', 'expired', 'invalidated')),
        account_id TEXT NOT NULL,
        character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
        item_instance_id TEXT,
        asking_gold INTEGER NOT NULL CHECK (asking_gold BETWEEN 1 AND 2147483647),
        details_json TEXT NOT NULL CHECK (json_valid(details_json)),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
      ) STRICT;
      CREATE INDEX player_shop_audit_by_listing
        ON player_shop_audit_events(listing_id, created_at_ms);
      PRAGMA user_version = 17;
    `);
    database.exec("COMMIT;");
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch {}
    throw error;
  }
}

/** Persistent personal-shop listings. Inventory rows stay in place while escrowed. */
export class CaracatoaPlayerShopStore {
  #database;
  #listingLifetimeMs;
  #maxListingsPerCharacter;

  constructor(database, {
    listingLifetimeMs = LISTING_LIFETIME_MS,
    maxListingsPerCharacter = MAX_ACTIVE_PER_CHARACTER,
  } = {}) {
    this.#database = database;
    integer(listingLifetimeMs, 60_000, 30 * 24 * 60 * 60 * 1000, "Prazo do anúncio");
    integer(maxListingsPerCharacter, 1, 12, "Limite de anúncios");
    this.#listingLifetimeMs = listingLifetimeMs;
    this.#maxListingsPerCharacter = maxListingsPerCharacter;
  }

  #transaction(action) {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const result = action();
      this.#database.exec("COMMIT;");
      return result;
    } catch (error) {
      try { this.#database.exec("ROLLBACK;"); } catch {}
      throw error;
    }
  }

  #audit({ listing, action, accountId, characterSlot, nowMs, idFactory, details = {} }) {
    const eventId = uuid(idFactory(), "ID de auditoria");
    this.#database.prepare(`
      INSERT INTO player_shop_audit_events
        (event_id, listing_id, action, account_id, character_slot, item_instance_id,
         asking_gold, details_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, listing.listingId, action, accountId, characterSlot,
      listing.itemInstanceId ?? null, listing.askingGold,
      JSON.stringify(details), nowMs,
    );
  }

  #expire(nowMs, idFactory = randomUUID) {
    const expired = this.#database.prepare(`
      SELECT listing_id AS listingId, seller_account AS sellerAccount,
        seller_character_slot AS sellerCharacterSlot, item_instance_id AS itemInstanceId,
        asking_gold AS askingGold
      FROM player_shop_listings
      WHERE status = 'active' AND expires_at_ms <= ?
      ORDER BY expires_at_ms
    `).all(nowMs);
    const updateListing = this.#database.prepare(`
      UPDATE player_shop_listings SET status = 'expired', completed_at_ms = ?
      WHERE listing_id = ? AND status = 'active'
    `);
    const releaseItem = this.#database.prepare(`
      UPDATE player_character_inventory SET shop_listing_id = NULL
      WHERE shop_listing_id = ?
    `);
    for (const listing of expired) {
      updateListing.run(nowMs, listing.listingId);
      releaseItem.run(listing.listingId);
      this.#audit({
        listing, action: "expired", accountId: listing.sellerAccount,
        characterSlot: listing.sellerCharacterSlot, nowMs, idFactory,
      });
    }
    return expired.length;
  }

  expireAt(nowMs = Date.now()) {
    validTime(nowMs);
    return this.#transaction(() => this.#expire(nowMs));
  }

  #character(accountId, characterSlot) {
    const row = this.#database.prepare(`
      SELECT pc.name AS name, pc.gold AS gold, pc.inventory_seeded AS inventorySeeded,
        pa.enabled AS accountEnabled
      FROM player_characters AS pc
      JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ?
    `).get(accountId, characterSlot);
    if (!row || row.accountEnabled !== 1) return null;
    return row;
  }

  #listingRow(row, own) {
    return {
      listingId: row.listingId,
      sellerName: row.sellerName,
      catalogItemId: row.catalogItemId,
      clientItemId: row.clientItemId,
      itemInstanceId: row.itemInstanceId,
      stackCount: row.stackCount,
      askingGold: row.askingGold,
      rarity: row.rarity ?? null,
      itemLevel: row.itemLevel ?? null,
      refinementLevel: row.refinementLevel ?? null,
      createdAtMs: row.createdAtMs,
      expiresAtMs: row.expiresAtMs,
      own,
    };
  }

  #listRows(whereSql, parameters, own) {
    return this.#database.prepare(`
      SELECT l.listing_id AS listingId, l.seller_name AS sellerName,
        l.seller_account AS sellerAccount, l.seller_character_slot AS sellerCharacterSlot,
        l.catalog_item_id AS catalogItemId, l.item_instance_id AS itemInstanceId,
        l.client_item_id AS clientItemId,
        l.stack_count AS stackCount, l.asking_gold AS askingGold,
        l.created_at_ms AS createdAtMs, l.expires_at_ms AS expiresAtMs,
        pir.rarity AS rarity, pir.item_level AS itemLevel,
        pir.refinement_level AS refinementLevel
      FROM player_shop_listings AS l
      LEFT JOIN player_character_item_rolls AS pir
        ON pir.item_instance_id = l.item_instance_id
      WHERE l.status = 'active' AND ${whereSql}
      ORDER BY l.created_at_ms DESC, l.listing_id
      LIMIT 8
    `).all(...parameters).map((row) => this.#listingRow(
      row,
      own === true || (typeof own === "string" && row.sellerAccount === own),
    ));
  }

  list({ accountId: inputAccountId, characterSlot, view = "market", nowMs = Date.now() } = {}) {
    const accountId = identity(inputAccountId, characterSlot);
    if (!['market', 'mine'].includes(view)) {
      throw new CaracatoaPlayerShopError("INVALID_INPUT", "Visão do mercado inválida.");
    }
    validTime(nowMs);
    return this.#transaction(() => {
      this.#expire(nowMs);
      const character = this.#character(accountId, characterSlot);
      if (!character) return { accepted: false, reason: "character-unavailable", listings: [] };
      if (character.inventorySeeded !== 1) {
        return { accepted: false, reason: "inventory-not-ready", listings: [] };
      }
      const listings = view === "mine"
        ? this.#listRows("l.seller_account = ? AND l.seller_character_slot = ?", [accountId, characterSlot], true)
        : this.#listRows("1 = 1", [], accountId);
      return { accepted: true, view, goldBalance: character.gold, listings };
    });
  }

  createListing({
    accountId: inputAccountId, characterSlot, inventorySlot, askingGold,
    nowMs = Date.now(), idFactory = randomUUID,
  } = {}) {
    const accountId = identity(inputAccountId, characterSlot);
    integer(inventorySlot, 0, 59, "Slot de inventário");
    integer(askingGold, 1, MAX_GOLD, "Preço");
    validTime(nowMs);
    if (typeof idFactory !== "function") {
      throw new CaracatoaPlayerShopError("INVALID_INPUT", "Gerador de IDs inválido.");
    }
    return this.#transaction(() => {
      this.#expire(nowMs, idFactory);
      const character = this.#character(accountId, characterSlot);
      if (!character) return { accepted: false, reason: "character-unavailable" };
      if (character.inventorySeeded !== 1) return { accepted: false, reason: "inventory-not-ready" };
      const activeCount = this.#database.prepare(`
        SELECT COUNT(*) AS count FROM player_shop_listings
        WHERE seller_account = ? AND seller_character_slot = ? AND status = 'active'
      `).get(accountId, characterSlot).count;
      if (activeCount >= this.#maxListingsPerCharacter) {
        return { accepted: false, reason: "listing-limit" };
      }
      const item = this.#database.prepare(`
        SELECT inventory_slot AS inventorySlot, catalog_item_id AS catalogItemId,
          item_instance_id AS itemInstanceId, stack_count AS storedStackCount,
          equipment_slot AS equipmentSlot, shop_listing_id AS shopListingId
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
      `).get(accountId, characterSlot, inventorySlot);
      if (!item) return { accepted: false, reason: "item-missing" };
      if (item.shopListingId) return { accepted: false, reason: "item-already-listed" };
      if (item.equipmentSlot !== null) return { accepted: false, reason: "item-equipped" };
      const stackCount = item.storedStackCount > 0 ? item.storedStackCount : 1;
      const definition = ITEM_BY_CATALOG_ID.get(item.catalogItemId);
      if (!definition || !Number.isInteger(definition.properties?.clientItemId)) {
        return { accepted: false, reason: "item-unlisted" };
      }
      if (item.itemInstanceId && stackCount !== 1) {
        return { accepted: false, reason: "invalid-item-stack" };
      }
      const listingId = uuid(idFactory(), "ID do anúncio");
      const expiresAtMs = nowMs + this.#listingLifetimeMs;
      if (!Number.isSafeInteger(expiresAtMs)) {
        throw new CaracatoaPlayerShopError("INVALID_INPUT", "Prazo do anúncio inválido.");
      }
      const listing = {
        listingId,
        sellerName: character.name,
        catalogItemId: item.catalogItemId,
        clientItemId: definition.properties.clientItemId,
        itemInstanceId: item.itemInstanceId,
        stackCount,
        askingGold,
        createdAtMs: nowMs,
        expiresAtMs,
      };
      this.#database.prepare(`
        INSERT INTO player_shop_listings
          (listing_id, seller_account, seller_character_slot, seller_name, inventory_slot,
           catalog_item_id, client_item_id, item_instance_id, stack_count, asking_gold, status,
           created_at_ms, expires_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        listingId, accountId, characterSlot, character.name, inventorySlot,
        item.catalogItemId, definition.properties.clientItemId, item.itemInstanceId, stackCount, askingGold,
        nowMs, expiresAtMs,
      );
      const reserved = this.#database.prepare(`
        UPDATE player_character_inventory SET shop_listing_id = ?
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          AND equipment_slot IS NULL AND shop_listing_id IS NULL
      `).run(listingId, accountId, characterSlot, inventorySlot);
      if (reserved.changes !== 1) {
        throw new CaracatoaPlayerShopError("ITEM_CHANGED", "O item mudou antes da publicação.");
      }
      this.#audit({
        listing, action: "listed", accountId, characterSlot, nowMs, idFactory,
        details: { catalogItemId: item.catalogItemId, stackCount, askingGold },
      });
      return { accepted: true, listing: this.#listingRow(listing, true) };
    });
  }

  cancelListing({
    accountId: inputAccountId, characterSlot, listingId: inputListingId,
    nowMs = Date.now(), idFactory = randomUUID,
  } = {}) {
    const accountId = identity(inputAccountId, characterSlot);
    const listingId = uuid(inputListingId, "ID do anúncio");
    validTime(nowMs);
    return this.#transaction(() => {
      this.#expire(nowMs, idFactory);
      const listing = this.#database.prepare(`
        SELECT listing_id AS listingId, item_instance_id AS itemInstanceId,
          asking_gold AS askingGold, inventory_slot AS inventorySlot
        FROM player_shop_listings
        WHERE listing_id = ? AND seller_account = ? AND seller_character_slot = ? AND status = 'active'
      `).get(listingId, accountId, characterSlot);
      if (!listing) return { accepted: false, reason: "listing-not-active" };
      const released = this.#database.prepare(`
        UPDATE player_character_inventory SET shop_listing_id = NULL
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND shop_listing_id = ?
      `).run(accountId, characterSlot, listing.inventorySlot, listingId);
      if (released.changes !== 1) {
        throw new CaracatoaPlayerShopError("ITEM_CHANGED", "O item anunciado não está mais reservado.");
      }
      this.#database.prepare(`
        UPDATE player_shop_listings SET status = 'cancelled', completed_at_ms = ?
        WHERE listing_id = ? AND status = 'active'
      `).run(nowMs, listingId);
      this.#audit({
        listing, action: "cancelled", accountId, characterSlot, nowMs, idFactory,
      });
      const character = this.#character(accountId, characterSlot);
      return { accepted: true, listingId, inventorySlot: listing.inventorySlot, goldBalance: character?.gold ?? null };
    });
  }

  buyListing({
    accountId: inputAccountId, characterSlot, listingId: inputListingId,
    requestId: inputRequestId, nowMs = Date.now(), idFactory = randomUUID,
  } = {}) {
    const accountId = identity(inputAccountId, characterSlot);
    const listingId = uuid(inputListingId, "ID do anúncio");
    const requestId = uuid(inputRequestId, "ID da compra");
    validTime(nowMs);
    if (typeof idFactory !== "function") {
      throw new CaracatoaPlayerShopError("INVALID_INPUT", "Gerador de IDs inválido.");
    }
    return this.#transaction(() => {
      const existing = this.#database.prepare(`
        SELECT r.listing_id AS listingId, r.buyer_account AS buyerAccount,
          r.buyer_character_slot AS buyerCharacterSlot, r.result_json AS resultJson,
          l.seller_account AS sellerAccount, l.seller_character_slot AS sellerCharacterSlot
        FROM player_shop_purchase_receipts AS r
        JOIN player_shop_listings AS l ON l.listing_id = r.listing_id
        WHERE r.request_id = ?
      `).get(requestId);
      if (existing) {
        if (existing.listingId !== listingId || existing.buyerAccount !== accountId ||
            existing.buyerCharacterSlot !== characterSlot) {
          return { accepted: false, reason: "request-id-reused" };
        }
        return {
          ...JSON.parse(existing.resultJson),
          alreadyCommitted: true,
          sellerAccount: existing.sellerAccount,
          sellerCharacterSlot: existing.sellerCharacterSlot,
        };
      }
      this.#expire(nowMs, idFactory);
      const buyer = this.#character(accountId, characterSlot);
      if (!buyer) return { accepted: false, reason: "character-unavailable" };
      if (buyer.inventorySeeded !== 1) return { accepted: false, reason: "inventory-not-ready" };
      const listing = this.#database.prepare(`
        SELECT listing_id AS listingId, seller_account AS sellerAccount,
          seller_character_slot AS sellerCharacterSlot, seller_name AS sellerName,
          inventory_slot AS inventorySlot, catalog_item_id AS catalogItemId,
          client_item_id AS clientItemId, item_instance_id AS itemInstanceId, stack_count AS stackCount,
          asking_gold AS askingGold, status, expires_at_ms AS expiresAtMs
        FROM player_shop_listings WHERE listing_id = ?
      `).get(listingId);
      if (!listing) return { accepted: false, reason: "listing-not-found" };
      if (listing.status === "expired") return { accepted: false, reason: "listing-expired" };
      if (listing.status !== "active") return { accepted: false, reason: "listing-closed" };
      if (listing.sellerAccount === accountId) return { accepted: false, reason: "own-listing" };
      const seller = this.#character(listing.sellerAccount, listing.sellerCharacterSlot);
      if (!seller) return { accepted: false, reason: "seller-unavailable" };
      if (seller.inventorySeeded !== 1) return { accepted: false, reason: "seller-inventory-not-ready" };
      if (buyer.gold < listing.askingGold) return { accepted: false, reason: "insufficient-gold", goldBalance: buyer.gold };
      if (seller.gold + listing.askingGold > MAX_GOLD) return { accepted: false, reason: "seller-gold-limit" };
      const item = this.#database.prepare(`
        SELECT catalog_item_id AS catalogItemId, stack_count AS storedStackCount,
          item_instance_id AS itemInstanceId, equipment_slot AS equipmentSlot
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND shop_listing_id = ?
      `).get(listing.sellerAccount, listing.sellerCharacterSlot, listing.inventorySlot, listingId);
      const actualStack = item?.storedStackCount > 0 ? item.storedStackCount : 1;
      if (!item || item.catalogItemId !== listing.catalogItemId ||
          item.itemInstanceId !== listing.itemInstanceId || actualStack !== listing.stackCount ||
          item.equipmentSlot !== null) {
        if (item) {
          this.#database.prepare(`
            UPDATE player_character_inventory SET shop_listing_id = NULL
            WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND shop_listing_id = ?
          `).run(listing.sellerAccount, listing.sellerCharacterSlot, listing.inventorySlot, listingId);
        }
        this.#database.prepare(`
          UPDATE player_shop_listings SET status = 'invalidated', completed_at_ms = ?
          WHERE listing_id = ? AND status = 'active'
        `).run(nowMs, listingId);
        this.#audit({
          listing, action: "invalidated", accountId: listing.sellerAccount,
          characterSlot: listing.sellerCharacterSlot, nowMs, idFactory,
        });
        return { accepted: false, reason: "item-missing" };
      }
      const occupied = new Set(this.#database.prepare(`
        SELECT inventory_slot AS slot FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ?
      `).all(accountId, characterSlot).map((row) => row.slot));
      let buyerInventorySlot = 0;
      while (buyerInventorySlot < 60 && occupied.has(buyerInventorySlot)) buyerInventorySlot += 1;
      if (buyerInventorySlot >= 60) return { accepted: false, reason: "inventory-full" };
      const buyerGold = buyer.gold - listing.askingGold;
      const sellerGold = seller.gold + listing.askingGold;
      const updateBuyer = this.#database.prepare(`
        UPDATE player_characters SET gold = ?
        WHERE account_id = ? AND slot = ? AND gold = ?
          AND EXISTS (SELECT 1 FROM player_accounts WHERE account_id = ? AND enabled = 1)
      `).run(buyerGold, accountId, characterSlot, buyer.gold, accountId);
      const updateSeller = this.#database.prepare(`
        UPDATE player_characters SET gold = ?
        WHERE account_id = ? AND slot = ? AND gold = ?
          AND EXISTS (SELECT 1 FROM player_accounts WHERE account_id = ? AND enabled = 1)
      `).run(sellerGold, listing.sellerAccount, listing.sellerCharacterSlot, seller.gold, listing.sellerAccount);
      if (updateBuyer.changes !== 1 || updateSeller.changes !== 1) {
        throw new CaracatoaPlayerShopError("BALANCE_CHANGED", "O saldo mudou durante a compra.");
      }
      const moved = this.#database.prepare(`
        UPDATE player_character_inventory
        SET account_id = ?, character_slot = ?, inventory_slot = ?, shop_listing_id = NULL
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND shop_listing_id = ?
          AND equipment_slot IS NULL
      `).run(
        accountId, characterSlot, buyerInventorySlot,
        listing.sellerAccount, listing.sellerCharacterSlot, listing.inventorySlot, listingId,
      );
      if (moved.changes !== 1) throw new CaracatoaPlayerShopError("ITEM_CHANGED", "O item mudou durante a compra.");
      this.#database.prepare(`
        UPDATE player_shop_listings
        SET status = 'sold', buyer_account = ?, buyer_character_slot = ?, completed_at_ms = ?
        WHERE listing_id = ? AND status = 'active'
      `).run(accountId, characterSlot, nowMs, listingId);
      const receipt = {
        listingId,
        catalogItemId: listing.catalogItemId,
        clientItemId: listing.clientItemId,
        itemInstanceId: listing.itemInstanceId,
        stackCount: listing.stackCount,
        inventorySlot: buyerInventorySlot,
        askingGold: listing.askingGold,
        sellerName: listing.sellerName,
        buyerGoldBalance: buyerGold,
        sellerGoldBalance: sellerGold,
      };
      this.#database.prepare(`
        INSERT INTO player_shop_purchase_receipts
          (request_id, listing_id, buyer_account, buyer_character_slot, result_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(requestId, listingId, accountId, characterSlot, JSON.stringify({ accepted: true, receipt }), nowMs);
      this.#audit({
        listing, action: "purchased", accountId, characterSlot, nowMs, idFactory,
        details: { sellerAccount: listing.sellerAccount, sellerCharacterSlot: listing.sellerCharacterSlot },
      });
      this.#audit({
        listing, action: "sold", accountId: listing.sellerAccount,
        characterSlot: listing.sellerCharacterSlot, nowMs, idFactory,
        details: { buyerAccount: accountId, buyerCharacterSlot: characterSlot },
      });
      return {
        accepted: true,
        receipt,
        alreadyCommitted: false,
        sellerAccount: listing.sellerAccount,
        sellerCharacterSlot: listing.sellerCharacterSlot,
      };
    });
  }
}
