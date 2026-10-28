import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const MIGRATION_SQL = readFileSync(
  new URL("./data/schema/foundation-v15.sql", import.meta.url), "utf8",
);
const BANKABLE_ITEM_IDS = new Set(JSON.parse(readFileSync(
  new URL("./data/catalogs/items.json", import.meta.url), "utf8",
)).entries.filter((entry) => entry.enabled &&
  !entry.properties.equipment && !entry.properties.combatEffect)
  .map((entry) => entry.id));
const MAX_GOLD = 2_147_483_647;
const MAX_STACK = 500;

export class CaracatoaFoundationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaracatoaFoundationError";
    this.code = code;
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CaracatoaFoundationError("INVALID_INPUT", `${label} inválido.`);
  }
}

function account(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,14}$/.test(value)) {
    throw new CaracatoaFoundationError("INVALID_INPUT", "Conta inválida.");
  }
}

function character(accountId, characterSlot) {
  account(accountId);
  integer(characterSlot, 0, 3, "Slot de personagem");
}

function time(nowMs) {
  integer(nowMs, 0, Number.MAX_SAFE_INTEGER, "Horário");
}

function guildName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$/.test(value)) {
    throw new CaracatoaFoundationError("INVALID_INPUT", "Nome de guilda inválido.");
  }
  return { name: value, normalizedName: value.toLowerCase() };
}

export function migrateCaracatoaFoundationSchema(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version === 15 || version === 16 || version === 17) return;
  if (version !== 14) throw new Error(`Migração de fundação exige schema v14; recebeu v${version}.`);
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(MIGRATION_SQL);
    database.exec("COMMIT;");
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch {}
    throw error;
  }
}

/** Internal repository: call only after the authenticated game service has authorized the operation. */
export class CaracatoaFoundationStore {
  #database;

  constructor(database) {
    this.#database = database;
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

  #requireCharacter(accountId, characterSlot) {
    const row = this.#database.prepare(`
      SELECT pc.gold FROM player_characters AS pc
      JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
    `).get(accountId, characterSlot);
    if (!row) throw new CaracatoaFoundationError("CHARACTER_UNAVAILABLE", "Personagem indisponível.");
    return row;
  }

  #ensureBank(accountId) {
    this.#database.prepare(`
      INSERT OR IGNORE INTO player_account_banks (account_id)
      SELECT account_id FROM player_accounts WHERE account_id = ? AND enabled = 1
    `).run(accountId);
    const bank = this.#database.prepare(`
      SELECT b.gold, b.updated_at_ms AS updatedAtMs
      FROM player_account_banks AS b
      JOIN player_accounts AS pa ON pa.account_id = b.account_id
      WHERE b.account_id = ? AND pa.enabled = 1
    `).get(accountId);
    if (!bank) throw new CaracatoaFoundationError("ACCOUNT_UNAVAILABLE", "Conta indisponível.");
    return bank;
  }

  getBank(accountId) {
    account(accountId);
    return this.#transaction(() => {
      const bank = this.#ensureBank(accountId);
      const items = this.#database.prepare(`
        SELECT bank_slot AS slot, catalog_item_id AS catalogItemId,
          stack_count AS stackCount
        FROM player_account_bank_items WHERE account_id = ? ORDER BY bank_slot
      `).all(accountId).map((item) => ({ ...item }));
      return { gold: bank.gold, updatedAtMs: bank.updatedAtMs, items };
    });
  }

  transferGold({ accountId, characterSlot, direction, amount, nowMs }) {
    character(accountId, characterSlot);
    if (!['deposit', 'withdraw'].includes(direction)) {
      throw new CaracatoaFoundationError("INVALID_INPUT", "Direção de transferência inválida.");
    }
    integer(amount, 1, MAX_GOLD, "Quantidade de ouro");
    time(nowMs);
    return this.#transaction(() => {
      const player = this.#requireCharacter(accountId, characterSlot);
      const bank = this.#ensureBank(accountId);
      if (direction === 'deposit' && player.gold < amount) {
        return { status: 'insufficient-character-gold', characterGold: player.gold, bankGold: bank.gold };
      }
      if (direction === 'withdraw' && bank.gold < amount) {
        return { status: 'insufficient-bank-gold', characterGold: player.gold, bankGold: bank.gold };
      }
      if ((direction === 'deposit' && bank.gold > MAX_GOLD - amount) ||
          (direction === 'withdraw' && player.gold > MAX_GOLD - amount)) {
        return { status: 'balance-cap', characterGold: player.gold, bankGold: bank.gold };
      }
      const playerDelta = direction === 'deposit' ? -amount : amount;
      const bankDelta = -playerDelta;
      this.#database.prepare(`
        UPDATE player_characters SET gold = gold + ? WHERE account_id = ? AND slot = ?
      `).run(playerDelta, accountId, characterSlot);
      this.#database.prepare(`
        UPDATE player_account_banks SET gold = gold + ?, updated_at_ms = ? WHERE account_id = ?
      `).run(bankDelta, nowMs, accountId);
      return {
        status: 'transferred',
        characterGold: player.gold + playerDelta,
        bankGold: bank.gold + bankDelta,
      };
    });
  }

  transferItem({ accountId, characterSlot, direction, inventorySlot, bankSlot, amount, nowMs = Date.now() }) {
    character(accountId, characterSlot);
    if (!['deposit', 'withdraw'].includes(direction)) {
      throw new CaracatoaFoundationError("INVALID_INPUT", "Direção de transferência inválida.");
    }
    integer(inventorySlot, 0, 59, "Slot de inventário");
    integer(bankSlot, 0, 119, "Slot de banco");
    integer(amount, 1, MAX_STACK, "Quantidade de itens");
    time(nowMs);
    return this.#transaction(() => {
      this.#requireCharacter(accountId, characterSlot);
      this.#ensureBank(accountId);
      const inventory = this.#database.prepare(`
        SELECT catalog_item_id AS catalogItemId, stack_count AS stackCount,
          equipment_slot AS equipmentSlot, item_instance_id AS instanceId,
          shop_listing_id AS shopListingId
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          AND shop_listing_id IS NULL
      `).get(accountId, characterSlot, inventorySlot);
      const stored = this.#database.prepare(`
        SELECT catalog_item_id AS catalogItemId, stack_count AS stackCount
        FROM player_account_bank_items WHERE account_id = ? AND bank_slot = ?
      `).get(accountId, bankSlot);
      const source = direction === 'deposit' ? inventory : stored;
      const destination = direction === 'deposit' ? stored : inventory;
      if (!source || source.stackCount < amount) return { status: 'insufficient-items' };
      if (!BANKABLE_ITEM_IDS.has(source.catalogItemId)) {
        return { status: 'item-not-bankable' };
      }
      if (inventory && (inventory.stackCount < 1 || inventory.equipmentSlot !== null || inventory.instanceId !== null || inventory.shopListingId !== null)) {
        return { status: 'item-not-bankable' };
      }
      if (destination && destination.catalogItemId !== source.catalogItemId) {
        return { status: 'slot-occupied' };
      }
      if (destination && destination.stackCount > MAX_STACK - amount) {
        return { status: 'stack-cap' };
      }
      if (direction === 'deposit') {
        if (source.stackCount === amount) {
          this.#database.prepare(`
            DELETE FROM player_character_inventory
            WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          `).run(accountId, characterSlot, inventorySlot);
        } else {
          this.#database.prepare(`
            UPDATE player_character_inventory SET stack_count = stack_count - ?
            WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          `).run(amount, accountId, characterSlot, inventorySlot);
        }
        if (stored) {
          this.#database.prepare(`
            UPDATE player_account_bank_items SET stack_count = stack_count + ?
            WHERE account_id = ? AND bank_slot = ?
          `).run(amount, accountId, bankSlot);
        } else {
          this.#database.prepare(`
            INSERT INTO player_account_bank_items
              (account_id, bank_slot, catalog_item_id, stack_count)
            VALUES (?, ?, ?, ?)
          `).run(accountId, bankSlot, source.catalogItemId, amount);
        }
      } else {
        if (source.stackCount === amount) {
          this.#database.prepare(`
            DELETE FROM player_account_bank_items WHERE account_id = ? AND bank_slot = ?
          `).run(accountId, bankSlot);
        } else {
          this.#database.prepare(`
            UPDATE player_account_bank_items SET stack_count = stack_count - ?
            WHERE account_id = ? AND bank_slot = ?
          `).run(amount, accountId, bankSlot);
        }
        if (inventory) {
          this.#database.prepare(`
            UPDATE player_character_inventory SET stack_count = stack_count + ?
            WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          `).run(amount, accountId, characterSlot, inventorySlot);
        } else {
          this.#database.prepare(`
            INSERT INTO player_character_inventory
              (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
            VALUES (?, ?, ?, ?, ?)
          `).run(accountId, characterSlot, inventorySlot, source.catalogItemId, amount);
        }
      }
      this.#database.prepare(`
        UPDATE player_account_banks SET updated_at_ms = ? WHERE account_id = ?
      `).run(nowMs, accountId);
      return { status: 'transferred', catalogItemId: source.catalogItemId,
        amount, inventorySlot, bankSlot };
    });
  }

  createGuild({ accountId, characterSlot, name, nowMs }) {
    character(accountId, characterSlot);
    const normalized = guildName(name);
    time(nowMs);
    return this.#transaction(() => {
      this.#requireCharacter(accountId, characterSlot);
      const occupied = this.#database.prepare(`
        SELECT 1 FROM player_guild_members WHERE account_id = ? AND character_slot = ?
      `).get(accountId, characterSlot);
      if (occupied) throw new CaracatoaFoundationError("ALREADY_IN_GUILD", "Personagem já pertence a uma guilda.");
      const taken = this.#database.prepare(`
        SELECT 1 FROM player_guilds WHERE normalized_name = ?
      `).get(normalized.normalizedName);
      if (taken) throw new CaracatoaFoundationError("GUILD_NAME_EXISTS", "Nome de guilda já utilizado.");
      const guildId = randomUUID();
      this.#database.prepare(`
        INSERT INTO player_guilds
          (guild_id, name, normalized_name, leader_account_id, leader_character_slot, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(guildId, normalized.name, normalized.normalizedName, accountId, characterSlot, nowMs);
      this.#database.prepare(`
        INSERT INTO player_guild_members
          (guild_id, account_id, character_slot, role, joined_at_ms)
        VALUES (?, ?, ?, 'leader', ?)
      `).run(guildId, accountId, characterSlot, nowMs);
      return { guildId, name: normalized.name, leaderAccountId: accountId,
        leaderCharacterSlot: characterSlot, createdAtMs: nowMs };
    });
  }

  getGuildForCharacter(accountId, characterSlot) {
    character(accountId, characterSlot);
    this.#requireCharacter(accountId, characterSlot);
    const row = this.#database.prepare(`
      SELECT g.guild_id AS guildId, g.name,
        g.leader_account_id AS leaderAccountId,
        g.leader_character_slot AS leaderCharacterSlot,
        g.created_at_ms AS createdAtMs, m.role
      FROM player_guild_members AS m
      JOIN player_guilds AS g ON g.guild_id = m.guild_id
      WHERE m.account_id = ? AND m.character_slot = ?
    `).get(accountId, characterSlot);
    return row ? { ...row } : null;
  }
}
