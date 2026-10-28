import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  CaracatoaMountStore,
  migrateCaracatoaMountSchema,
} from "./caracatoa-mount-store.mjs";
import {
  CaracatoaFoundationStore,
  migrateCaracatoaFoundationSchema,
} from "./caracatoa-foundation-store.mjs";
import {
  CaracatoaAdvancementStore,
  migrateCaracatoaAdvancementSchema,
} from "./caracatoa-advancement-store.mjs";
import {
  CaracatoaPlayerShopStore,
  migrateCaracatoaPlayerShopSchema,
} from "./caracatoa-player-shop-store.mjs";
import { getCaracatoaAdvancementCatalog } from "./caracatoa-advancement-store.mjs";
import {
  CARACATOA_ATTRIBUTE_POINTS_PER_LEVEL,
  CARACATOA_INITIAL_ATTRIBUTE_POINTS,
  CARACATOA_INITIAL_SKILL_POINTS,
  CARACATOA_SKILL_POINTS_PER_LEVEL,
  getCaracatoaLevelForExperience,
} from "./caracatoa-character-progression.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(
  process.env.CARACATOA_STATE_DIR ?? join(APP_DIR, "data", "state"),
);
export const DEFAULT_PLAYER_DATABASE = join(
  STATE_DIR,
  "player-accounts.sqlite",
);
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const DUMMY_SALT = Buffer.alloc(16, 0xa5);
const DUMMY_HASH = Buffer.alloc(PASSWORD_HASH_BYTES, 0x5a);
const scryptAsync = promisify(scrypt);

export class PlayerAccountInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlayerAccountInputError";
  }
}

export class PlayerAccountConflictError extends Error {
  constructor() {
    super("A conta de jogador já existe.");
    this.name = "PlayerAccountConflictError";
    this.code = "PLAYER_ACCOUNT_EXISTS";
  }
}

export class PlayerCharacterInputError extends Error {
  constructor() {
    super("Dados de criação de personagem inválidos.");
    this.name = "PlayerCharacterInputError";
    this.code = "PLAYER_CHARACTER_INPUT_INVALID";
  }
}

export class PlayerCharacterSlotConflictError extends Error {
  constructor() {
    super("O slot de personagem já está ocupado.");
    this.name = "PlayerCharacterSlotConflictError";
    this.code = "PLAYER_CHARACTER_SLOT_OCCUPIED";
  }
}

export class PlayerCharacterNameConflictError extends Error {
  constructor() {
    super("O nome de personagem já está em uso.");
    this.name = "PlayerCharacterNameConflictError";
    this.code = "PLAYER_CHARACTER_NAME_EXISTS";
  }
}

export class PlayerCharacterLimitError extends Error {
  constructor() {
    super("A conta já atingiu o limite de personagens.");
    this.name = "PlayerCharacterLimitError";
    this.code = "PLAYER_CHARACTER_LIMIT";
  }
}

export class PlayerCharacterAccountError extends Error {
  constructor() {
    super("A conta de jogador não está habilitada.");
    this.name = "PlayerCharacterAccountError";
    this.code = "PLAYER_CHARACTER_ACCOUNT_DISABLED";
  }
}

export class PlayerCharacterPositionError extends Error {
  constructor() {
    super("Posição de personagem inválida.");
    this.name = "PlayerCharacterPositionError";
    this.code = "PLAYER_CHARACTER_POSITION_INVALID";
  }
}

function normalizeAccountId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/.test(value)
  ) {
    throw new PlayerAccountInputError(
      "ID de jogador inválido para o campo WYD 7.27.",
    );
  }
  return value.toLowerCase();
}

function normalizeCharacterName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(value)) {
    throw new PlayerCharacterInputError();
  }
  return { name: value, normalizedName: value.toLowerCase() };
}

function validateWorldPosition(position) {
  if (
    !position ||
    !Number.isInteger(position.x) ||
    position.x < -0x8000 ||
    position.x > 0x7fff ||
    !Number.isInteger(position.y) ||
    position.y < -0x8000 ||
    position.y > 0x7fff
  ) {
    throw new PlayerCharacterPositionError();
  }
}

function passwordBytes(value) {
  let bytes;
  if (typeof value === "string") {
    if (!/^[\x20-\x7e]{1,11}$/.test(value)) {
      throw new PlayerAccountInputError(
        "Senha de jogador deve ter de 1 a 11 bytes ASCII imprimíveis.",
      );
    }
    bytes = Buffer.from(value, "ascii");
  } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = Buffer.from(value);
    if (
      bytes.length < 1 ||
      bytes.length > 11 ||
      bytes.some((byte) => byte < 0x20 || byte > 0x7e)
    ) {
      bytes.fill(0);
      throw new PlayerAccountInputError(
        "Senha de jogador deve ter de 1 a 11 bytes ASCII imprimíveis.",
      );
    }
  } else {
    throw new PlayerAccountInputError("Senha de jogador inválida.");
  }
  return bytes;
}

function tokenBytes(value) {
  let bytes;
  if (typeof value === "string") {
    if (!/^\d{4,6}$/.test(value)) {
      throw new PlayerAccountInputError(
        "Token de jogador precisa ter de 4 a 6 dígitos.",
      );
    }
    bytes = Buffer.from(value, "ascii");
  } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = Buffer.from(value);
    if (
      bytes.length < 4 ||
      bytes.length > 6 ||
      bytes.some((byte) => byte < 0x30 || byte > 0x39)
    ) {
      bytes.fill(0);
      throw new PlayerAccountInputError(
        "Token de jogador precisa ter de 4 a 6 dígitos.",
      );
    }
  } else {
    throw new PlayerAccountInputError("Token de jogador inválido.");
  }
  return bytes;
}

function publicAccount(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    enabled: row.enabled === 1,
    tokenConfigured:
      row.token_configured === 1 ||
      (row.token_hash !== undefined && row.token_hash !== null),
    createdAt: row.created_at,
  };
}

export class PlayerAccountStore {
  #database;
  #mountStore;
  #foundationStore;
  #advancementStore;
  #shopStore;
  #find;
  #list;
  #insert;
  #setEnabled;
  #setToken;
  #countCharacters;
  #findCharacterSlot;
  #findCharacterName;
  #findCharacterBySlot;
  #initializeCharacterPosition;
  #saveCharacterPosition;
  #inventorySeedState;
  #markInventorySeeded;
  #insertInventoryItem;
  #insertLootInventoryItem;
  #listCharacterInventory;
  #findInventoryItemForEquipment;
  #clearEquipmentSlot;
  #clearInventoryEquipment;
  #setInventoryEquipmentSlot;
  #listCharacterEquipment;
  #findInventoryItemForConsumption;
  #updateInventoryItemStackCount;
  #deleteInventoryItem;
  #itemInUse;
  #findItemizationLootClaim;
  #insertItemizationLootClaim;
  #insertItemizedLootInventoryItem;
  #insertItemRoll;
  #insertItemAffix;
  #insertItemizationAudit;
  #listCharacterItemRolls;
  #listItemRollAffixes;
  #insertCharacter;
  #listCharacters;

  constructor({ databasePath = DEFAULT_PLAYER_DATABASE } = {}) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath, { timeout: 5000 });
    try {
      this.#database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA trusted_schema = OFF;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
      `);
    } catch (error) {
      this.#database.close();
      throw error;
    }

    const schemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (
      schemaVersion !== 0 &&
      schemaVersion !== 1 &&
      schemaVersion !== 2 &&
      schemaVersion !== 3 &&
      schemaVersion !== 4 &&
      schemaVersion !== 5 &&
      schemaVersion !== 6 &&
      schemaVersion !== 7 &&
      schemaVersion !== 8 &&
      schemaVersion !== 9 &&
      schemaVersion !== 10 &&
      schemaVersion !== 11 &&
      schemaVersion !== 12 &&
      schemaVersion !== 13 &&
      schemaVersion !== 14 &&
      schemaVersion !== 15 &&
      schemaVersion !== 16 &&
      schemaVersion !== 17
    ) {
      this.#database.close();
      throw new Error(
        `Versão incompatível da base de jogadores: ${schemaVersion}.`,
      );
    }
    if (schemaVersion === 0 || schemaVersion === 1) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        if (schemaVersion === 0) {
          this.#database.exec(`
            CREATE TABLE IF NOT EXISTS player_accounts (
              account_id TEXT PRIMARY KEY NOT NULL,
              password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
              password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
              token_salt BLOB CHECK (token_salt IS NULL OR length(token_salt) = 16),
              token_hash BLOB CHECK (token_hash IS NULL OR length(token_hash) = 64),
              enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
              created_at TEXT NOT NULL
            ) STRICT;
          `);
        } else {
          this.#database.exec(`
            ALTER TABLE player_accounts ADD COLUMN token_salt BLOB
              CHECK (token_salt IS NULL OR length(token_salt) = 16);
            ALTER TABLE player_accounts ADD COLUMN token_hash BLOB
              CHECK (token_hash IS NULL OR length(token_hash) = 64);
          `);
        }
        this.#database.exec("PRAGMA user_version = 2; COMMIT;");
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const migratedVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (migratedVersion === 2) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          CREATE TABLE player_characters (
            account_id TEXT NOT NULL REFERENCES player_accounts(account_id) ON DELETE CASCADE,
            slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
            normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 16),
            class_id INTEGER NOT NULL CHECK (class_id BETWEEN 0 AND 3),
            level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
            gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
            created_at TEXT NOT NULL,
            PRIMARY KEY (account_id, slot)
          ) STRICT;
          CREATE INDEX player_characters_by_account ON player_characters(account_id, slot);
          PRAGMA user_version = 3;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const characterSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (characterSchemaVersion === 3) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN world_x INTEGER
            CHECK (world_x IS NULL OR world_x BETWEEN -32768 AND 32767);
          ALTER TABLE player_characters ADD COLUMN world_y INTEGER
            CHECK (world_y IS NULL OR world_y BETWEEN -32768 AND 32767);
          CREATE TRIGGER player_characters_world_position_pair_insert
          BEFORE INSERT ON player_characters
          WHEN (NEW.world_x IS NULL) != (NEW.world_y IS NULL)
          BEGIN
            SELECT RAISE(ABORT, 'world position coordinates must be paired');
          END;
          CREATE TRIGGER player_characters_world_position_pair_update
          BEFORE UPDATE OF world_x, world_y ON player_characters
          WHEN (NEW.world_x IS NULL) != (NEW.world_y IS NULL)
          BEGIN
            SELECT RAISE(ABORT, 'world position coordinates must be paired');
          END;
          PRAGMA user_version = 4;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const inventorySchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (inventorySchemaVersion === 4) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN inventory_seeded INTEGER NOT NULL
            DEFAULT 0 CHECK (inventory_seeded IN (0, 1));
          CREATE TABLE player_character_inventory (
            account_id TEXT NOT NULL,
            character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
            inventory_slot INTEGER NOT NULL CHECK (inventory_slot BETWEEN 0 AND 59),
            catalog_item_id TEXT NOT NULL CHECK (length(catalog_item_id) BETWEEN 1 AND 64),
            PRIMARY KEY (account_id, character_slot, inventory_slot),
            FOREIGN KEY (account_id, character_slot)
              REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX player_character_inventory_by_catalog_item
            ON player_character_inventory(catalog_item_id);
          PRAGMA user_version = 5;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const stackCountSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (stackCountSchemaVersion === 5) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_character_inventory ADD COLUMN stack_count INTEGER NOT NULL
            DEFAULT 0 CHECK (stack_count BETWEEN 0 AND 500);
          PRAGMA user_version = 6;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const experienceSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (experienceSchemaVersion === 6) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN experience INTEGER NOT NULL
            DEFAULT 0 CHECK (experience BETWEEN 0 AND 9007199254740991);
          PRAGMA user_version = 7;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const hitPointsSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (hitPointsSchemaVersion === 7) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN current_hp INTEGER NOT NULL
            DEFAULT -1 CHECK (current_hp BETWEEN -1 AND 2147483647);
          PRAGMA user_version = 8;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const manaSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (manaSchemaVersion === 8) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN current_mp INTEGER NOT NULL
            DEFAULT -1 CHECK (current_mp BETWEEN -1 AND 2147483647);
          PRAGMA user_version = 9;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const attributeSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (attributeSchemaVersion === 9) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN attribute_points INTEGER NOT NULL
            DEFAULT 0 CHECK (attribute_points BETWEEN 0 AND 2147483647);
          ALTER TABLE player_characters ADD COLUMN attribute_str INTEGER NOT NULL
            DEFAULT 0 CHECK (attribute_str BETWEEN 0 AND 65535);
          ALTER TABLE player_characters ADD COLUMN attribute_int INTEGER NOT NULL
            DEFAULT 0 CHECK (attribute_int BETWEEN 0 AND 65535);
          ALTER TABLE player_characters ADD COLUMN attribute_dex INTEGER NOT NULL
            DEFAULT 0 CHECK (attribute_dex BETWEEN 0 AND 65535);
          ALTER TABLE player_characters ADD COLUMN attribute_con INTEGER NOT NULL
            DEFAULT 0 CHECK (attribute_con BETWEEN 0 AND 65535);
          PRAGMA user_version = 10;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const skillSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (skillSchemaVersion === 10) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_characters ADD COLUMN skill_points INTEGER NOT NULL
            DEFAULT 0 CHECK (skill_points BETWEEN 0 AND 2147483647);
          CREATE TABLE player_character_skills (
            account_id TEXT NOT NULL,
            character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
            catalog_skill_id TEXT NOT NULL,
            client_skill_id INTEGER NOT NULL CHECK (client_skill_id BETWEEN 1 AND 95),
            learned_at TEXT NOT NULL,
            PRIMARY KEY (account_id, character_slot, catalog_skill_id),
            UNIQUE (account_id, character_slot, client_skill_id),
            FOREIGN KEY (account_id, character_slot)
              REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
          );
          PRAGMA user_version = 11;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const equipmentSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (equipmentSchemaVersion === 11) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_character_inventory ADD COLUMN equipment_slot INTEGER
            CHECK (equipment_slot IS NULL OR equipment_slot BETWEEN 0 AND 5);
          CREATE UNIQUE INDEX player_character_equipment_slot_unique
            ON player_character_inventory(account_id, character_slot, equipment_slot)
            WHERE equipment_slot IS NOT NULL;
          PRAGMA user_version = 12;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    const itemizationSchemaVersion = this.#database
      .prepare("PRAGMA user_version")
      .get().user_version;
    if (itemizationSchemaVersion === 12) {
      try {
        this.#database.exec("BEGIN IMMEDIATE;");
        this.#database.exec(`
          ALTER TABLE player_character_inventory ADD COLUMN item_instance_id TEXT
            CHECK (item_instance_id IS NULL OR length(item_instance_id) = 36);
          CREATE UNIQUE INDEX player_character_inventory_instance_unique
            ON player_character_inventory(item_instance_id);
          CREATE TABLE player_character_item_rolls (
            item_instance_id TEXT PRIMARY KEY NOT NULL
              REFERENCES player_character_inventory(item_instance_id) ON DELETE CASCADE,
            client_item_id INTEGER NOT NULL CHECK (client_item_id BETWEEN 1 AND 65535),
            rarity TEXT NOT NULL CHECK (rarity IN ('normal', 'mystic', 'arcane', 'legendary', 'ancient')),
            item_level INTEGER NOT NULL CHECK (item_level BETWEEN 1 AND 400),
            refinement_level INTEGER NOT NULL DEFAULT 0 CHECK (refinement_level BETWEEN 0 AND 15),
            base_stats_json TEXT NOT NULL CHECK (json_valid(base_stats_json)),
            source_kind TEXT NOT NULL CHECK (source_kind IN ('monster-drop', 'quest', 'craft', 'admin-grant')),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 96),
            catalog_version TEXT NOT NULL CHECK (length(catalog_version) BETWEEN 1 AND 64),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
          ) STRICT;
          CREATE TABLE player_character_item_affixes (
            item_instance_id TEXT NOT NULL
              REFERENCES player_character_item_rolls(item_instance_id) ON DELETE CASCADE,
            affix_index INTEGER NOT NULL CHECK (affix_index BETWEEN 0 AND 3),
            client_affix_id INTEGER NOT NULL CHECK (client_affix_id BETWEEN 1 AND 255),
            affix_id TEXT NOT NULL CHECK (length(affix_id) BETWEEN 1 AND 64),
            stat_id TEXT NOT NULL CHECK (length(stat_id) BETWEEN 1 AND 64),
            value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 100000),
            value_unit TEXT NOT NULL CHECK (value_unit IN ('flat', 'basis-points')),
            PRIMARY KEY (item_instance_id, affix_index),
            UNIQUE (item_instance_id, affix_id),
            UNIQUE (item_instance_id, stat_id)
          ) STRICT;
          CREATE INDEX player_character_item_rolls_by_rarity_level
            ON player_character_item_rolls(rarity, item_level);
          CREATE TABLE player_character_itemization_kills (
            loot_event_id TEXT NOT NULL CHECK (length(loot_event_id) BETWEEN 1 AND 96),
            account_id TEXT NOT NULL,
            character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            PRIMARY KEY (loot_event_id, account_id, character_slot),
            FOREIGN KEY (account_id, character_slot)
              REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
          ) STRICT;
          CREATE TABLE itemization_audit_events (
            event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) = 36),
            account_id TEXT NOT NULL,
            character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
            item_instance_id TEXT,
            action TEXT NOT NULL CHECK (action IN ('drop', 'equip', 'unequip', 'trade', 'reforge', 'destroy', 'admin-grant')),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 96),
            details_json TEXT NOT NULL CHECK (json_valid(details_json)),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            FOREIGN KEY (account_id, character_slot)
              REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX itemization_audit_events_by_character_time
            ON itemization_audit_events(account_id, character_slot, created_at_ms DESC);
          PRAGMA user_version = 13;
          COMMIT;
        `);
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
        this.#database.close();
        throw error;
      }
    }

    try {
      migrateCaracatoaMountSchema(this.#database);
      migrateCaracatoaFoundationSchema(this.#database);
      migrateCaracatoaAdvancementSchema(this.#database);
      migrateCaracatoaPlayerShopSchema(this.#database);
      this.#mountStore = new CaracatoaMountStore(this.#database);
      this.#foundationStore = new CaracatoaFoundationStore(this.#database);
      this.#advancementStore = new CaracatoaAdvancementStore(this.#database);
      this.#shopStore = new CaracatoaPlayerShopStore(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }

    this.#find = this.#database.prepare(`
      SELECT account_id, password_salt, password_hash, token_salt, token_hash, enabled, created_at
      FROM player_accounts WHERE account_id = ?
    `);
    this.#list = this.#database.prepare(`
      SELECT account_id, enabled, created_at, token_hash IS NOT NULL AS token_configured
      FROM player_accounts ORDER BY account_id
    `);
    this.#insert = this.#database.prepare(`
      INSERT INTO player_accounts (account_id, password_salt, password_hash, token_salt, token_hash, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    this.#setEnabled = this.#database.prepare(
      "UPDATE player_accounts SET enabled = ? WHERE account_id = ?",
    );
    this.#setToken = this.#database.prepare(
      "UPDATE player_accounts SET token_salt = ?, token_hash = ? WHERE account_id = ?",
    );
    this.#countCharacters = this.#database.prepare(
      "SELECT COUNT(*) AS count FROM player_characters WHERE account_id = ?",
    );
    this.#findCharacterSlot = this.#database.prepare(
      "SELECT slot FROM player_characters WHERE account_id = ? AND slot = ?",
    );
    this.#findCharacterName = this.#database.prepare(
      "SELECT account_id FROM player_characters WHERE normalized_name = ?",
    );
    this.#findCharacterBySlot = this.#database.prepare(`
      SELECT pc.slot, pc.name, pc.class_id AS classId, pc.level, pc.gold,
        pc.progression_stage AS progressionStage,
        pc.experience, pc.current_hp AS currentHp,
        pc.current_mp AS currentMp,
        pc.world_x AS worldX, pc.world_y AS worldY
      FROM player_characters AS pc
      INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
    `);
    this.#initializeCharacterPosition = this.#database.prepare(`
      UPDATE player_characters SET world_x = ?, world_y = ?
      WHERE account_id = ? AND slot = ? AND world_x IS NULL AND world_y IS NULL
        AND EXISTS (
          SELECT 1 FROM player_accounts
          WHERE player_accounts.account_id = player_characters.account_id AND enabled = 1
        )
    `);
    this.#saveCharacterPosition = this.#database.prepare(`
      UPDATE player_characters SET world_x = ?, world_y = ?
      WHERE account_id = ? AND slot = ? AND world_x = ? AND world_y = ?
        AND EXISTS (
          SELECT 1 FROM player_accounts
          WHERE player_accounts.account_id = player_characters.account_id AND enabled = 1
        )
    `);
    this.#inventorySeedState = this.#database.prepare(`
      SELECT pc.inventory_seeded AS inventorySeeded
      FROM player_characters AS pc
      INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
    `);
    this.#markInventorySeeded = this.#database.prepare(`
      UPDATE player_characters SET inventory_seeded = 1
      WHERE account_id = ? AND slot = ? AND inventory_seeded = 0
    `);
    this.#insertInventoryItem = this.#database.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.#insertLootInventoryItem = this.#database.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.#listCharacterInventory = this.#database.prepare(`
      SELECT pci.inventory_slot AS slot, pci.catalog_item_id AS catalogItemId,
        pci.stack_count AS stackCount, pci.shop_listing_id AS shopListingId
      FROM player_character_inventory AS pci
      INNER JOIN player_accounts AS pa ON pa.account_id = pci.account_id
      WHERE pci.account_id = ? AND pci.character_slot = ? AND pa.enabled = 1
      ORDER BY pci.inventory_slot
    `);
    this.#findInventoryItemForEquipment = this.#database.prepare(`
      SELECT pci.catalog_item_id AS catalogItemId, pci.stack_count AS stackCount
      FROM player_character_inventory AS pci
      INNER JOIN player_accounts AS pa ON pa.account_id = pci.account_id
      WHERE pci.account_id = ? AND pci.character_slot = ?
        AND pci.inventory_slot = ? AND pci.shop_listing_id IS NULL AND pa.enabled = 1
    `);
    this.#clearEquipmentSlot = this.#database.prepare(`
      UPDATE player_character_inventory SET equipment_slot = NULL
      WHERE account_id = ? AND character_slot = ? AND equipment_slot = ?
    `);
    this.#clearInventoryEquipment = this.#database.prepare(`
      UPDATE player_character_inventory SET equipment_slot = NULL
      WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
    `);
    this.#setInventoryEquipmentSlot = this.#database.prepare(`
      UPDATE player_character_inventory SET equipment_slot = ?
      WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
    `);
    this.#listCharacterEquipment = this.#database.prepare(`
      SELECT pci.equipment_slot AS equipmentSlot,
        pci.inventory_slot AS inventorySlot,
        pci.catalog_item_id AS catalogItemId,
        pci.stack_count AS stackCount
      FROM player_character_inventory AS pci
      INNER JOIN player_accounts AS pa ON pa.account_id = pci.account_id
      WHERE pci.account_id = ? AND pci.character_slot = ?
        AND pci.equipment_slot IS NOT NULL AND pci.shop_listing_id IS NULL AND pa.enabled = 1
      ORDER BY pci.equipment_slot
    `);
    this.#findInventoryItemForConsumption = this.#database.prepare(`
      SELECT pci.catalog_item_id AS catalogItemId,
        pci.stack_count AS stackCount
      FROM player_character_inventory AS pci
      INNER JOIN player_accounts AS pa ON pa.account_id = pci.account_id
      WHERE pci.account_id = ? AND pci.character_slot = ?
        AND pci.inventory_slot = ? AND pci.shop_listing_id IS NULL AND pa.enabled = 1
    `);
    this.#updateInventoryItemStackCount = this.#database.prepare(`
      UPDATE player_character_inventory SET stack_count = ?
      WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
        AND catalog_item_id = ? AND shop_listing_id IS NULL
    `);
    this.#deleteInventoryItem = this.#database.prepare(`
      DELETE FROM player_character_inventory
      WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
        AND catalog_item_id = ? AND shop_listing_id IS NULL
    `);
    this.#itemInUse = this.#database.prepare(`
      SELECT 1 FROM player_character_inventory WHERE catalog_item_id = ? LIMIT 1
    `);
    this.#findItemizationLootClaim = this.#database.prepare(`
      SELECT 1 FROM player_character_itemization_kills
      WHERE loot_event_id = ? AND account_id = ? AND character_slot = ?
    `);
    this.#insertItemizationLootClaim = this.#database.prepare(`
      INSERT INTO player_character_itemization_kills
        (loot_event_id, account_id, character_slot, created_at_ms)
      VALUES (?, ?, ?, ?)
    `);
    this.#insertItemizedLootInventoryItem = this.#database.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count, item_instance_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#insertItemRoll = this.#database.prepare(`
      INSERT INTO player_character_item_rolls
        (item_instance_id, client_item_id, rarity, item_level, refinement_level,
         base_stats_json, source_kind, source_id, catalog_version, created_at_ms)
      VALUES (?, ?, ?, ?, 0, ?, 'monster-drop', ?, ?, ?)
    `);
    this.#insertItemAffix = this.#database.prepare(`
      INSERT INTO player_character_item_affixes
        (item_instance_id, affix_index, client_affix_id, affix_id, stat_id, value, value_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertItemizationAudit = this.#database.prepare(`
      INSERT INTO itemization_audit_events
        (event_id, account_id, character_slot, item_instance_id, action,
         source_id, details_json, created_at_ms)
      VALUES (?, ?, ?, ?, 'drop', ?, ?, ?)
    `);
    this.#listCharacterItemRolls = this.#database.prepare(`
      SELECT pci.inventory_slot AS slot, pci.item_instance_id AS instanceId,
        pci.catalog_item_id AS catalogItemId, pir.client_item_id AS clientItemId,
        pir.rarity AS rarity, pir.item_level AS itemLevel,
        pir.refinement_level AS refinementLevel,
        pir.base_stats_json AS baseStatsJson, pir.source_id AS sourceId,
        pir.catalog_version AS catalogVersion
      FROM player_character_inventory AS pci
      INNER JOIN player_character_item_rolls AS pir
        ON pir.item_instance_id = pci.item_instance_id
      INNER JOIN player_accounts AS pa ON pa.account_id = pci.account_id
      WHERE pci.account_id = ? AND pci.character_slot = ? AND pa.enabled = 1
        AND pci.shop_listing_id IS NULL
      ORDER BY pci.inventory_slot
    `);
    this.#listItemRollAffixes = this.#database.prepare(`
      SELECT client_affix_id AS clientAffixId, affix_id AS id,
        stat_id AS stat, value, value_unit AS valueUnit
      FROM player_character_item_affixes
      WHERE item_instance_id = ? ORDER BY affix_index
    `);
    this.#insertCharacter = this.#database.prepare(`
      INSERT INTO player_characters
        (account_id, slot, name, normalized_name, class_id, level, gold, created_at, attribute_points, skill_points)
      VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
    `);
    this.#listCharacters = this.#database.prepare(`
      SELECT slot, name, class_id AS classId, level, gold, experience,
        progression_stage AS progressionStage
      FROM player_characters WHERE account_id = ? ORDER BY slot
    `);
  }

  async createAccount(accountIdInput, passwordInput, tokenInput) {
    const accountId = normalizeAccountId(accountIdInput);
    let password;
    let token;
    try {
      password = passwordBytes(passwordInput);
      token = tokenBytes(tokenInput);
    } catch (error) {
      password?.fill(0);
      token?.fill(0);
      throw error;
    }
    const passwordSalt = randomBytes(16);
    const tokenSalt = randomBytes(16);
    try {
      let passwordHash;
      let tokenHash;
      try {
        passwordHash = Buffer.from(
          await scryptAsync(
            password,
            passwordSalt,
            PASSWORD_HASH_BYTES,
            PASSWORD_SCRYPT_OPTIONS,
          ),
        );
        tokenHash = Buffer.from(
          await scryptAsync(
            token,
            tokenSalt,
            PASSWORD_HASH_BYTES,
            PASSWORD_SCRYPT_OPTIONS,
          ),
        );
        this.#insert.run(
          accountId,
          passwordSalt,
          passwordHash,
          tokenSalt,
          tokenHash,
          new Date().toISOString(),
        );
      } catch (error) {
        if (
          error.code === "ERR_SQLITE_ERROR" &&
          /UNIQUE constraint failed/i.test(error.message)
        ) {
          throw new PlayerAccountConflictError();
        }
        throw error;
      } finally {
        passwordHash?.fill(0);
        tokenHash?.fill(0);
      }
    } finally {
      password.fill(0);
      token.fill(0);
      passwordSalt.fill(0);
      tokenSalt.fill(0);
    }
    return this.getAccount(accountId);
  }

  async authenticate(accountIdInput, passwordInput) {
    let accountId;
    let password;
    try {
      accountId = normalizeAccountId(accountIdInput);
      password = passwordBytes(passwordInput);
    } catch (error) {
      if (error instanceof PlayerAccountInputError) return null;
      throw error;
    }

    try {
      const row = this.#find.get(accountId);
      const salt = row
        ? Buffer.from(row.password_salt)
        : Buffer.from(DUMMY_SALT);
      const expected = row
        ? Buffer.from(row.password_hash)
        : Buffer.from(DUMMY_HASH);
      try {
        const actual = Buffer.from(
          await scryptAsync(
            password,
            salt,
            PASSWORD_HASH_BYTES,
            PASSWORD_SCRYPT_OPTIONS,
          ),
        );
        const matches =
          actual.length === expected.length &&
          timingSafeEqual(actual, expected);
        actual.fill(0);
        const currentRow = row ? this.#find.get(accountId) : null;
        const currentHash = currentRow
          ? Buffer.from(currentRow.password_hash)
          : Buffer.alloc(0);
        try {
          const unchangedHash =
            currentHash.length === expected.length &&
            timingSafeEqual(currentHash, expected);
          if (
            !row ||
            row.enabled !== 1 ||
            !matches ||
            !currentRow ||
            currentRow.enabled !== 1 ||
            !unchangedHash
          ) {
            return null;
          }
          return publicAccount(currentRow);
        } finally {
          currentHash.fill(0);
        }
      } finally {
        salt.fill(0);
        expected.fill(0);
      }
    } finally {
      password.fill(0);
    }
  }

  async authenticateToken(accountIdInput, tokenInput) {
    let accountId;
    let token;
    try {
      accountId = normalizeAccountId(accountIdInput);
      token = tokenBytes(tokenInput);
    } catch (error) {
      if (error instanceof PlayerAccountInputError) return null;
      throw error;
    }

    try {
      const row = this.#find.get(accountId);
      const tokenConfigured = Boolean(row?.token_salt && row?.token_hash);
      const salt = tokenConfigured
        ? Buffer.from(row.token_salt)
        : Buffer.from(DUMMY_SALT);
      const expected = tokenConfigured
        ? Buffer.from(row.token_hash)
        : Buffer.from(DUMMY_HASH);
      try {
        const actual = Buffer.from(
          await scryptAsync(
            token,
            salt,
            PASSWORD_HASH_BYTES,
            PASSWORD_SCRYPT_OPTIONS,
          ),
        );
        const matches =
          actual.length === expected.length &&
          timingSafeEqual(actual, expected);
        actual.fill(0);
        const currentRow = row ? this.#find.get(accountId) : null;
        const currentHash =
          currentRow?.token_salt && currentRow?.token_hash
            ? Buffer.from(currentRow.token_hash)
            : Buffer.alloc(0);
        try {
          const unchangedHash =
            currentHash.length === expected.length &&
            timingSafeEqual(currentHash, expected);
          if (
            !row ||
            row.enabled !== 1 ||
            !tokenConfigured ||
            !matches ||
            !currentRow ||
            currentRow.enabled !== 1 ||
            !currentRow.token_salt ||
            !currentRow.token_hash ||
            !unchangedHash
          ) {
            return null;
          }
          return publicAccount(currentRow);
        } finally {
          currentHash.fill(0);
        }
      } finally {
        salt.fill(0);
        expected.fill(0);
      }
    } finally {
      token.fill(0);
    }
  }

  listAccounts() {
    return this.#list.all().map(publicAccount);
  }

  createCharacter(accountIdInput, { slot, classId, name } = {}) {
    const accountId = normalizeAccountId(accountIdInput);
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 3 ||
      !Number.isInteger(classId) ||
      classId < 0 ||
      classId > 3
    ) {
      throw new PlayerCharacterInputError();
    }
    const { name: normalizedDisplayName, normalizedName } =
      normalizeCharacterName(name);

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const account = this.#find.get(accountId);
      if (!account || account.enabled !== 1)
        throw new PlayerCharacterAccountError();
      const count = this.#countCharacters.get(accountId).count;
      if (count >= 4) throw new PlayerCharacterLimitError();
      if (this.#findCharacterSlot.get(accountId, slot))
        throw new PlayerCharacterSlotConflictError();
      if (this.#findCharacterName.get(normalizedName))
        throw new PlayerCharacterNameConflictError();

      this.#insertCharacter.run(
        accountId,
        slot,
        normalizedDisplayName,
        normalizedName,
        classId,
        new Date().toISOString(),
        CARACATOA_INITIAL_ATTRIBUTE_POINTS,
        CARACATOA_INITIAL_SKILL_POINTS,
      );
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return { slot, name: normalizedDisplayName, classId, level: 1, gold: 0 };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  listCharacters(accountIdInput) {
    const accountId = normalizeAccountId(accountIdInput);
    return this.#listCharacters.all(accountId).map((row) => ({
      slot: row.slot,
      name: row.name,
      classId: row.classId,
      level: getCaracatoaLevelForExperience(row.experience, row.level),
      gold: row.gold,
      progressionStage: row.progressionStage,
    }));
  }

  getCharacterBySlot(accountIdInput, slot) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    const row = this.#findCharacterBySlot.get(accountId, slot);
    if (!row) return null;
    return {
      slot: row.slot,
      name: row.name,
      classId: row.classId,
      level: getCaracatoaLevelForExperience(row.experience, row.level),
      gold: row.gold,
      progressionStage: row.progressionStage,
      experience: row.experience,
      currentHp: row.currentHp < 0 ? null : row.currentHp,
      currentMp: row.currentMp < 0 ? null : row.currentMp,
      worldX: row.worldX,
      worldY: row.worldY,
    };
  }

  awardCharacterExperience(accountIdInput, slot, experienceGained) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isSafeInteger(experienceGained) ||
      experienceGained < 1 ||
      experienceGained > Number.MAX_SAFE_INTEGER
    ) {
      throw new PlayerCharacterInputError(
        "experienceGained precisa ser um inteiro positivo seguro.",
      );
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const character = this.#database
        .prepare(
          `
          SELECT player_characters.level, player_characters.experience,
            player_characters.progression_stage AS progressionStage,
            player_characters.attribute_points AS attributePoints,
            player_characters.skill_points AS skillPoints
          FROM player_characters
          JOIN player_accounts
            ON player_accounts.account_id = player_characters.account_id
          WHERE player_characters.account_id = ?
            AND player_characters.slot = ?
            AND player_accounts.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (
        !character ||
        character.experience > Number.MAX_SAFE_INTEGER - experienceGained
      ) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      const stage = getCaracatoaAdvancementCatalog().stages.find(
        (entry) => entry.id === character.progressionStage,
      );
      if (!stage) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      const experienceCap = 5 * stage.maximumTotalLevel * (stage.maximumTotalLevel - 1);
      const experience = Math.min(character.experience + experienceGained, experienceCap);
      const gained = experience - character.experience;
      if (gained <= 0) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      const previousLevel = getCaracatoaLevelForExperience(
        character.experience,
        character.level,
      );
      const level = getCaracatoaLevelForExperience(experience, previousLevel);
      const attributePoints =
        character.attributePoints +
        (level - previousLevel) * CARACATOA_ATTRIBUTE_POINTS_PER_LEVEL;
      const skillPoints =
        character.skillPoints +
        (level - previousLevel) * CARACATOA_SKILL_POINTS_PER_LEVEL;
      if (!Number.isSafeInteger(attributePoints) || attributePoints > 0x7fffffff) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      if (!Number.isSafeInteger(skillPoints) || skillPoints > 0x7fffffff) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      const update = this.#database
        .prepare(
          `
          UPDATE player_characters
          SET experience = ?, level = ?, attribute_points = ?, skill_points = ?
          WHERE account_id = ? AND slot = ?
            AND experience = ?
            AND EXISTS (
              SELECT 1 FROM player_accounts
              WHERE player_accounts.account_id = player_characters.account_id
                AND player_accounts.enabled = 1
            )
        `,
        )
        .run(experience, level, attributePoints, skillPoints, accountId, slot, character.experience);
      if (update.changes !== 1) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      this.#database.exec("COMMIT;");
      return {
        gained,
        experience,
        previousLevel,
        level,
        levelsGained: level - previousLevel,
        skillPoints,
      };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  getCharacterSkillState(accountIdInput, slot) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    const character = this.#database
      .prepare(`
        SELECT pc.skill_points AS availablePoints, pc.class_id AS classId,
          pc.level
        FROM player_characters AS pc
        INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
        WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
      `)
      .get(accountId, slot);
    if (!character) return null;
    const learned = this.#database
      .prepare(`
        SELECT pcs.catalog_skill_id AS catalogSkillId,
          pcs.client_skill_id AS clientSkillId
        FROM player_character_skills AS pcs
        INNER JOIN player_accounts AS pa ON pa.account_id = pcs.account_id
        WHERE pcs.account_id = ? AND pcs.character_slot = ? AND pa.enabled = 1
        ORDER BY pcs.catalog_skill_id
      `)
      .all(accountId, slot);
    return {
      availablePoints: character.availablePoints,
      classId: character.classId,
      level: character.level,
      learned: learned.map((row) => ({
        catalogSkillId: row.catalogSkillId,
        clientSkillId: row.clientSkillId,
      })),
    };
  }

  learnCharacterSkill(
    accountIdInput,
    slot,
    {
      catalogSkillId,
      clientSkillId,
      classId,
      pointCost,
      requiredLevel,
      prerequisites = [],
    } = {},
  ) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      typeof catalogSkillId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(catalogSkillId) ||
      !Number.isInteger(clientSkillId) || clientSkillId < 1 || clientSkillId > 95 ||
      !Number.isInteger(classId) || classId < 0 || classId > 3 ||
      !Number.isInteger(pointCost) || pointCost < 1 || pointCost > 1000 ||
      !Number.isInteger(requiredLevel) || requiredLevel < 1 ||
      !Array.isArray(prerequisites) ||
      prerequisites.length > 24 ||
      prerequisites.some(
        (id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id),
      )
    ) {
      throw new PlayerCharacterInputError();
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const character = this.#database
        .prepare(`
          SELECT pc.skill_points AS availablePoints, pc.class_id AS classId,
            pc.level
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `)
        .get(accountId, slot);
      if (!character) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const learnedIds = new Set(
        this.#database
          .prepare(`
            SELECT catalog_skill_id FROM player_character_skills
            WHERE account_id = ? AND character_slot = ?
          `)
          .all(accountId, slot)
          .map((row) => row.catalog_skill_id),
      );
      const alreadyLearnedClientSkill = this.#database
        .prepare(`
          SELECT 1 FROM player_character_skills
          WHERE account_id = ? AND character_slot = ? AND client_skill_id = ?
        `)
        .get(accountId, slot, clientSkillId);
      let status = "learned";
      if (character.classId !== classId) status = "wrong-class";
      else if (learnedIds.has(catalogSkillId) || alreadyLearnedClientSkill) {
        status = "already-learned";
      }
      else if (character.level < requiredLevel) status = "level-locked";
      else if (prerequisites.some((id) => !learnedIds.has(id))) {
        status = "prerequisite-locked";
      } else if (character.availablePoints < pointCost) {
        status = "insufficient-points";
      }
      if (status === "learned") {
        const update = this.#database
          .prepare(`
            UPDATE player_characters SET skill_points = skill_points - ?
            WHERE account_id = ? AND slot = ? AND skill_points = ?
              AND EXISTS (
                SELECT 1 FROM player_accounts
                WHERE player_accounts.account_id = player_characters.account_id
                  AND player_accounts.enabled = 1
              )
          `)
          .run(pointCost, accountId, slot, character.availablePoints);
        if (update.changes !== 1) {
          this.#database.exec("ROLLBACK;");
          return null;
        }
        this.#database
          .prepare(`
            INSERT INTO player_character_skills
              (account_id, character_slot, catalog_skill_id, client_skill_id, learned_at)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(accountId, slot, catalogSkillId, clientSkillId, new Date().toISOString());
      }
      const state = this.getCharacterSkillState(accountId, slot);
      this.#database.exec("COMMIT;");
      return { status, ...state };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  getCharacterAttributes(accountIdInput, slot) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    const row = this.#database
      .prepare(`
        SELECT pc.attribute_points AS availablePoints,
          pc.attribute_str AS str, pc.attribute_int AS int,
          pc.attribute_dex AS dex, pc.attribute_con AS con
        FROM player_characters AS pc
        INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
        WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
      `)
      .get(accountId, slot);
    if (!row) return null;
    return {
      availablePoints: row.availablePoints,
      allocated: { str: row.str, int: row.int, dex: row.dex, con: row.con },
    };
  }

  allocateCharacterAttributePoint(accountIdInput, slot, attribute, maxAllocated) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    const attributeColumns = {
      str: "attribute_str",
      int: "attribute_int",
      dex: "attribute_dex",
      con: "attribute_con",
    };
    const column = attributeColumns[attribute];
    if (!column) throw new PlayerCharacterInputError();
    if (!Number.isInteger(maxAllocated) || maxAllocated < 0 || maxAllocated > 0xffff) {
      throw new PlayerCharacterInputError();
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(`
          SELECT pc.attribute_points AS availablePoints,
            pc.${column} AS allocated
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `)
        .get(accountId, slot);
      if (!row) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const allocated = {
        ...this.getCharacterAttributes(accountId, slot).allocated,
      };
      let status = "applied";
      if (row.availablePoints < 1) status = "no-points";
      else if (row.allocated >= maxAllocated) status = "capped";
      if (status !== "applied") {
        this.#database.exec("COMMIT;");
        return { status, availablePoints: row.availablePoints, allocated };
      }
      const update = this.#database
        .prepare(`
          UPDATE player_characters
          SET ${column} = ${column} + 1, attribute_points = attribute_points - 1
          WHERE account_id = ? AND slot = ? AND attribute_points = ?
            AND ${column} = ? AND ${column} < ?
            AND EXISTS (
              SELECT 1 FROM player_accounts
              WHERE player_accounts.account_id = player_characters.account_id
                AND player_accounts.enabled = 1
            )
        `)
        .run(accountId, slot, row.availablePoints, row.allocated, maxAllocated);
      if (update.changes !== 1) {
        this.#database.exec("ROLLBACK;");
        return null;
      }
      allocated[attribute] += 1;
      this.#database.exec("COMMIT;");
      return {
        status,
        availablePoints: row.availablePoints - 1,
        allocated,
      };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  initializeCharacterHitPoints(accountIdInput, slot, startingHp, maxHp) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isInteger(maxHp) ||
      maxHp < 1 ||
      maxHp > 0x7fffffff ||
      !Number.isInteger(startingHp) ||
      startingHp < 1 ||
      startingHp > maxHp
    ) {
      throw new PlayerCharacterInputError("HP inicial fora do intervalo.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_hp AS currentHp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const currentHp =
        row.currentHp < 0
          ? startingHp
          : row.currentHp === 0
            ? maxHp
            : Math.min(row.currentHp, maxHp);
      if (currentHp !== row.currentHp) {
        this.#database
          .prepare(
            "UPDATE player_characters SET current_hp = ? WHERE account_id = ? AND slot = ?",
          )
          .run(currentHp, accountId, slot);
      }
      this.#database.exec("COMMIT;");
      return { currentHp };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  initializeCharacterMana(accountIdInput, slot, startingMp, maxMp) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isInteger(maxMp) ||
      maxMp < 1 ||
      maxMp > 0x7fffffff ||
      !Number.isInteger(startingMp) ||
      startingMp < 0 ||
      startingMp > maxMp
    ) {
      throw new PlayerCharacterInputError("MP inicial fora do intervalo.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_mp AS currentMp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const currentMp =
        row.currentMp < 0 ? startingMp : Math.min(row.currentMp, maxMp);
      if (currentMp !== row.currentMp) {
        this.#database
          .prepare(
            "UPDATE player_characters SET current_mp = ? WHERE account_id = ? AND slot = ?",
          )
          .run(currentMp, accountId, slot);
      }
      this.#database.exec("COMMIT;");
      return { currentMp };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  setCharacterResources(accountIdInput, slot, currentHp, currentMp) {
    const accountId = normalizeAccountId(accountIdInput);
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 3 ||
      !Number.isInteger(currentHp) ||
      currentHp < 0 ||
      currentHp > 0x7fffffff ||
      !Number.isInteger(currentMp) ||
      currentMp < 0 ||
      currentMp > 0x7fffffff
    ) {
      throw new PlayerCharacterInputError("Recursos atuais fora do intervalo.");
    }
    const result = this.#database.prepare(`
      UPDATE player_characters
      SET current_hp = ?, current_mp = ?
      WHERE account_id = ? AND slot = ?
        AND EXISTS (
          SELECT 1 FROM player_accounts AS pa
          WHERE pa.account_id = player_characters.account_id AND pa.enabled = 1
        )
    `).run(currentHp, currentMp, accountId, slot);
    if (result.changes !== 1) return null;
    return { currentHp, currentMp };
  }

  spendCharacterMana(accountIdInput, slot, manaCost) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (!Number.isInteger(manaCost) || manaCost < 0 || manaCost > 0x7fffffff) {
      throw new PlayerCharacterInputError("manaCost fora do intervalo.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_mp AS currentMp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row || row.currentMp < manaCost || row.currentMp < 0) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const currentMp = row.currentMp - manaCost;
      if (manaCost > 0) {
        this.#database
          .prepare(
            "UPDATE player_characters SET current_mp = ? WHERE account_id = ? AND slot = ?",
          )
          .run(currentMp, accountId, slot);
      }
      this.#database.exec("COMMIT;");
      return { spent: manaCost, currentMp };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  refundCharacterMana(accountIdInput, slot, manaAmount, maxMp) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isInteger(manaAmount) ||
      manaAmount < 0 ||
      manaAmount > 0x7fffffff ||
      !Number.isInteger(maxMp) ||
      maxMp < 1 ||
      maxMp > 0x7fffffff
    ) {
      throw new PlayerCharacterInputError("Reembolso de MP fora do intervalo.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_mp AS currentMp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row || row.currentMp < 0) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const currentMp = Math.min(maxMp, row.currentMp + manaAmount);
      if (currentMp !== row.currentMp) {
        this.#database
          .prepare(
            "UPDATE player_characters SET current_mp = ? WHERE account_id = ? AND slot = ?",
          )
          .run(currentMp, accountId, slot);
      }
      this.#database.exec("COMMIT;");
      return { currentMp };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  applyCharacterDamage(accountIdInput, slot, damageInput) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isInteger(damageInput) ||
      damageInput < 1 ||
      damageInput > 0x7fffffff
    ) {
      throw new PlayerCharacterInputError("damage fora do intervalo.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_hp AS currentHp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row || row.currentHp <= 0) {
        this.#database.exec("COMMIT;");
        return null;
      }
      const damage = Math.min(row.currentHp, damageInput);
      const currentHp = row.currentHp - damage;
      this.#database
        .prepare(
          `
          UPDATE player_characters SET current_hp = ?
          WHERE account_id = ? AND slot = ?
        `,
        )
        .run(currentHp, accountId, slot);
      this.#database.exec("COMMIT;");
      return { damage, currentHp };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  applyCharacterHealAndSpendMana(
    accountIdInput,
    slot,
    { healingAmount, maxHp, manaCost },
  ) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (
      !Number.isInteger(healingAmount) ||
      healingAmount < 1 ||
      healingAmount > 0x7fffffff ||
      !Number.isInteger(maxHp) ||
      maxHp < 1 ||
      maxHp > 0x7fffffff ||
      !Number.isInteger(manaCost) ||
      manaCost < 0 ||
      manaCost > 0x7fffffff
    ) {
      throw new PlayerCharacterInputError("Parâmetros de cura fora do intervalo.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT pc.current_hp AS currentHp, pc.current_mp AS currentMp
          FROM player_characters AS pc
          INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
          WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
        `,
        )
        .get(accountId, slot);
      if (!row) {
        this.#database.exec("COMMIT;");
        return null;
      }
      if (row.currentHp <= 0) {
        this.#database.exec("COMMIT;");
        return {
          status: "dead",
          currentHp: Math.max(0, row.currentHp),
          currentMp: Math.max(0, row.currentMp),
        };
      }
      const currentHp = Math.min(row.currentHp, maxHp);
      if (currentHp >= maxHp) {
        this.#database.exec("COMMIT;");
        return { status: "full-health", currentHp, currentMp: row.currentMp };
      }
      if (row.currentMp < 0 || row.currentMp < manaCost) {
        this.#database.exec("COMMIT;");
        return {
          status: "insufficient-mana",
          currentHp,
          currentMp: Math.max(0, row.currentMp),
        };
      }

      const healed = Math.min(healingAmount, maxHp - currentHp);
      const updatedHp = currentHp + healed;
      const updatedMp = row.currentMp - manaCost;
      this.#database
        .prepare(
          `
          UPDATE player_characters
          SET current_hp = ?, current_mp = ?
          WHERE account_id = ? AND slot = ?
        `,
        )
        .run(updatedHp, updatedMp, accountId, slot);
      this.#database.exec("COMMIT;");
      return {
        status: "healed",
        healed,
        spent: manaCost,
        currentHp: updatedHp,
        currentMp: updatedMp,
      };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  }

  initializeCharacterPosition(accountIdInput, slot, fallbackPosition) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    validateWorldPosition(fallbackPosition);
    this.#initializeCharacterPosition.run(
      fallbackPosition.x,
      fallbackPosition.y,
      accountId,
      slot,
    );
    return this.getCharacterBySlot(accountId, slot);
  }

  initializeCharacterInventory(accountIdInput, slot, starterCatalogItemIds) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    this.#shopStore?.expireAt(Date.now());
    if (
      !Array.isArray(starterCatalogItemIds) ||
      starterCatalogItemIds.length > 60 ||
      starterCatalogItemIds.some((item) => {
        const catalogItemId = typeof item === "string" ? item : item?.catalogItemId;
        const stackCount = typeof item === "string" ? 0 : item?.stackCount;
        return typeof catalogItemId !== "string" ||
          !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(catalogItemId) ||
          !Number.isInteger(stackCount) || stackCount < 0 || stackCount > 500 ||
          (typeof item !== "string" && (
            !item || Array.isArray(item) ||
            Object.keys(item).sort().join(",") !== "catalogItemId,stackCount"
          ));
      }) ||
      new Set(starterCatalogItemIds.map((item) => typeof item === "string" ? item : item.catalogItemId)).size !== starterCatalogItemIds.length
    ) {
      throw new PlayerCharacterInputError("Itens iniciais inválidos.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const character = this.#inventorySeedState.get(accountId, slot);
      if (!character) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return null;
      }
      if (character.inventorySeeded === 0) {
        starterCatalogItemIds.forEach((starterItem, inventorySlot) => {
          const catalogItemId = typeof starterItem === "string"
            ? starterItem
            : starterItem.catalogItemId;
          const stackCount = typeof starterItem === "string" ? 0 : starterItem.stackCount;
          this.#insertInventoryItem.run(
            accountId,
            slot,
            inventorySlot,
            catalogItemId,
            stackCount,
          );
        });
        this.#markInventorySeeded.run(accountId, slot);
      }
      const inventory = this.#listCharacterInventory
        .all(accountId, slot)
        .filter((row) => row.shopListingId === null)
        .map((row) => ({
          slot: row.slot,
          catalogItemId: row.catalogItemId,
          stackCount: row.stackCount,
        }));
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return inventory;
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  setCharacterEquipment({
    accountId: accountIdInput,
    characterSlot,
    equipmentSlot,
    inventorySlot,
  }) {
    const accountId = normalizeAccountId(accountIdInput);
    if (
      !Number.isInteger(characterSlot) ||
      characterSlot < 0 ||
      characterSlot > 3 ||
      !Number.isInteger(equipmentSlot) ||
      equipmentSlot < 0 ||
      equipmentSlot > 5 ||
      (inventorySlot !== null &&
        (!Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot > 59))
    ) {
      throw new PlayerCharacterInputError("Mudança de equipamento inválida.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const character = this.#inventorySeedState.get(accountId, characterSlot);
      if (!character || character.inventorySeeded !== 1) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return null;
      }
      if (inventorySlot !== null) {
        const inventoryItem = this.#findInventoryItemForEquipment.get(
          accountId,
          characterSlot,
          inventorySlot,
        );
        if (!inventoryItem) {
          this.#database.exec("COMMIT;");
          transactionOpen = false;
          return { accepted: false, reason: "empty-slot" };
        }
      }

      this.#clearEquipmentSlot.run(accountId, characterSlot, equipmentSlot);
      if (inventorySlot === null) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return { accepted: true, inventorySlot: null };
      }
      this.#clearInventoryEquipment.run(accountId, characterSlot, inventorySlot);
      const result = this.#setInventoryEquipmentSlot.run(
        equipmentSlot,
        accountId,
        characterSlot,
        inventorySlot,
      );
      if (result.changes !== 1) {
        throw new Error("O inventário mudou durante a troca de equipamento.");
      }
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return { accepted: true, inventorySlot };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  executeCharacterTrade({
    tradeId,
    first: firstInput,
    second: secondInput,
    now = Date.now(),
    idFactory = randomUUID,
  } = {}) {
    const validGold = (value) =>
      Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
    const normalizeParticipant = (participant) => {
      if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
        throw new PlayerCharacterInputError("Oferta de troca inválida.");
      }
      const accountId = normalizeAccountId(participant.accountId);
      const { characterSlot, inventorySlot, gold } = participant;
      if (
        !Number.isInteger(characterSlot) || characterSlot < 0 || characterSlot > 3 ||
        (inventorySlot !== null && (!Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot > 59)) ||
        !validGold(gold)
      ) {
        throw new PlayerCharacterInputError("Oferta de troca inválida.");
      }
      return { accountId, characterSlot, inventorySlot, gold };
    };

    if (
      typeof tradeId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tradeId) ||
      !Number.isSafeInteger(now) || now < 0 ||
      typeof idFactory !== "function"
    ) {
      throw new PlayerCharacterInputError("Troca inválida.");
    }
    const first = normalizeParticipant(firstInput);
    const second = normalizeParticipant(secondInput);
    if (first.accountId === second.accountId && first.characterSlot === second.characterSlot) {
      throw new PlayerCharacterInputError("Um personagem não pode trocar consigo mesmo.");
    }
    if (
      first.inventorySlot === null && second.inventorySlot === null &&
      first.gold === 0 && second.gold === 0
    ) {
      return { accepted: false, reason: "empty-offer" };
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    const finish = (result) => {
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return result;
    };
    try {
      const previousTrade = this.#database.prepare(`
        SELECT 1 FROM itemization_audit_events
        WHERE action = 'trade' AND source_id = ? LIMIT 1
      `).get(tradeId);
      if (previousTrade) {
        return finish({ accepted: true, committed: true, alreadyCommitted: true });
      }

      const findCharacter = this.#database.prepare(`
        SELECT pc.gold AS gold, pc.inventory_seeded AS inventorySeeded,
          pa.enabled AS accountEnabled
        FROM player_characters AS pc
        INNER JOIN player_accounts AS pa ON pa.account_id = pc.account_id
        WHERE pc.account_id = ? AND pc.slot = ?
      `);
      const findItem = this.#database.prepare(`
        SELECT inventory_slot AS slot, catalog_item_id AS catalogItemId,
          stack_count AS stackCount, item_instance_id AS instanceId,
          equipment_slot AS equipmentSlot
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          AND shop_listing_id IS NULL
      `);
      const listSlots = this.#database.prepare(`
        SELECT inventory_slot AS slot
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ?
      `);
      const characters = [first, second].map((participant) =>
        findCharacter.get(participant.accountId, participant.characterSlot),
      );
      if (characters.some((character) => !character || character.accountEnabled !== 1)) {
        return finish({ accepted: false, reason: "character-unavailable" });
      }
      if (characters.some((character) => character.inventorySeeded !== 1)) {
        return finish({ accepted: false, reason: "inventory-not-ready" });
      }

      const offers = [first, second].map((participant) => ({
        participant,
        item: participant.inventorySlot === null
          ? null
          : findItem.get(participant.accountId, participant.characterSlot, participant.inventorySlot),
      }));
      if (offers.some((offer) => offer.participant.inventorySlot !== null && !offer.item)) {
        return finish({ accepted: false, reason: "item-missing" });
      }
      if (offers.some((offer) => offer.item && offer.item.equipmentSlot !== null)) {
        return finish({ accepted: false, reason: "item-equipped" });
      }
      if (offers.some((offer) => offer.item?.instanceId && offer.item.stackCount !== 1)) {
        return finish({ accepted: false, reason: "invalid-item-stack" });
      }
      if (first.gold > characters[0].gold || second.gold > characters[1].gold) {
        return finish({ accepted: false, reason: "insufficient-gold" });
      }

      const slots = [first, second].map((participant) =>
        new Set(listSlots.all(participant.accountId, participant.characterSlot).map((row) => row.slot)),
      );
      const incomingSlots = [null, null];
      for (let recipientIndex = 0; recipientIndex < 2; recipientIndex += 1) {
        if (!offers[1 - recipientIndex].item) continue;
        let freeSlot = 0;
        while (freeSlot < 60 && slots[recipientIndex].has(freeSlot)) freeSlot += 1;
        if (freeSlot >= 60) return finish({ accepted: false, reason: "inventory-full" });
        incomingSlots[recipientIndex] = freeSlot;
      }

      const nextGold = [
        characters[0].gold - first.gold + second.gold,
        characters[1].gold - second.gold + first.gold,
      ];
      if (nextGold.some((value) => !validGold(value))) {
        return finish({ accepted: false, reason: "gold-limit" });
      }
      const updateGold = this.#database.prepare(`
        UPDATE player_characters SET gold = ?
        WHERE account_id = ? AND slot = ? AND gold = ?
      `);
      for (let index = 0; index < 2; index += 1) {
        const result = updateGold.run(
          nextGold[index],
          [first, second][index].accountId,
          [first, second][index].characterSlot,
          characters[index].gold,
        );
        if (result.changes !== 1) throw new Error("O gold mudou durante a troca.");
      }

      const moveItem = this.#database.prepare(`
        UPDATE player_character_inventory
        SET account_id = ?, character_slot = ?, inventory_slot = ?
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
          AND equipment_slot IS NULL AND shop_listing_id IS NULL
      `);
      const receivedItems = [null, null];
      for (let recipientIndex = 0; recipientIndex < 2; recipientIndex += 1) {
        const offer = offers[1 - recipientIndex];
        if (!offer.item) continue;
        const owner = [first, second][1 - recipientIndex];
        const recipient = [first, second][recipientIndex];
        const result = moveItem.run(
          recipient.accountId,
          recipient.characterSlot,
          incomingSlots[recipientIndex],
          owner.accountId,
          owner.characterSlot,
          owner.inventorySlot,
        );
        if (result.changes !== 1) throw new Error("O item mudou durante a troca.");
        receivedItems[recipientIndex] = {
          slot: incomingSlots[recipientIndex],
          catalogItemId: offer.item.catalogItemId,
          instanceId: offer.item.instanceId,
          stackCount: offer.item.stackCount,
        };
      }

      const insertTradeAudit = this.#database.prepare(`
        INSERT INTO itemization_audit_events
          (event_id, account_id, character_slot, item_instance_id, action,
           source_id, details_json, created_at_ms)
        VALUES (?, ?, ?, ?, 'trade', ?, ?, ?)
      `);
      for (let index = 0; index < 2; index += 1) {
        const participant = [first, second][index];
        const partner = [first, second][1 - index];
        const given = offers[index].item;
        const received = receivedItems[index];
        const auditId = idFactory();
        if (typeof auditId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditId)) {
          throw new PlayerCharacterInputError("ID de auditoria inválido.");
        }
        insertTradeAudit.run(
          auditId,
          participant.accountId,
          participant.characterSlot,
          given?.instanceId ?? received?.instanceId ?? null,
          tradeId,
          JSON.stringify({
            counterpartyAccountId: partner.accountId,
            counterpartyCharacterSlot: partner.characterSlot,
            goldSent: participant.gold,
            goldReceived: partner.gold,
            itemSent: given ? { catalogItemId: given.catalogItemId, instanceId: given.instanceId } : null,
            itemReceived: received ? { catalogItemId: received.catalogItemId, instanceId: received.instanceId } : null,
          }),
          now,
        );
      }

      return finish({
        accepted: true,
        committed: true,
        alreadyCommitted: false,
        participants: [
          { accountId: first.accountId, characterSlot: first.characterSlot, gold: nextGold[0], received: receivedItems[0] },
          { accountId: second.accountId, characterSlot: second.characterSlot, gold: nextGold[1], received: receivedItems[1] },
        ],
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  listCharacterEquipment(accountIdInput, characterSlot) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(characterSlot) || characterSlot < 0 || characterSlot > 3) {
      return null;
    }
    const character = this.#inventorySeedState.get(accountId, characterSlot);
    if (!character || character.inventorySeeded !== 1) return null;
    return this.#listCharacterEquipment.all(accountId, characterSlot).map((row) => ({
      equipmentSlot: row.equipmentSlot,
      inventorySlot: row.inventorySlot,
      catalogItemId: row.catalogItemId,
      stackCount: row.stackCount,
    }));
  }

  awardCharacterInventoryItem({
    accountId: accountIdInput,
    characterSlot,
    catalogItemId,
    quantity,
    baseStackCount,
  }) {
    const accountId = normalizeAccountId(accountIdInput);
    if (
      !Number.isInteger(characterSlot) ||
      characterSlot < 0 ||
      characterSlot > 3 ||
      typeof catalogItemId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(catalogItemId) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 500 ||
      !Number.isInteger(baseStackCount) ||
      baseStackCount < 1 ||
      baseStackCount > 500
    ) {
      throw new PlayerCharacterInputError("Recompensa de inventário inválida.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const character = this.#inventorySeedState.get(accountId, characterSlot);
      if (!character || character.inventorySeeded !== 1) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return null;
      }

      const inventory = this.#listCharacterInventory.all(
        accountId,
        characterSlot,
      );
      const occupiedSlots = new Set(inventory.map((row) => row.slot));
      let remaining = quantity;
      const plannedSlots = [];

      for (const row of inventory) {
        if (row.shopListingId !== null || row.catalogItemId !== catalogItemId || remaining === 0) continue;
        const stackCount = row.stackCount || baseStackCount;
        if (stackCount >= 500) continue;
        const added = Math.min(500 - stackCount, remaining);
        plannedSlots.push({
          slot: row.slot,
          catalogItemId,
          stackCount: stackCount + added,
          previousStackCount: row.stackCount,
        });
        remaining -= added;
      }

      for (let slot = 0; slot < 60 && remaining > 0; slot += 1) {
        if (occupiedSlots.has(slot)) continue;
        const stackCount = Math.min(500, remaining);
        plannedSlots.push({ slot, catalogItemId, stackCount, isNew: true });
        remaining -= stackCount;
      }

      if (remaining > 0) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return { granted: false, reason: "inventory-full", slots: [] };
      }

      for (const planned of plannedSlots) {
        if (planned.isNew) {
          this.#insertLootInventoryItem.run(
            accountId,
            characterSlot,
            planned.slot,
            catalogItemId,
            planned.stackCount,
          );
          continue;
        }
        const result = this.#updateInventoryItemStackCount.run(
          planned.stackCount,
          accountId,
          characterSlot,
          planned.slot,
          catalogItemId,
        );
        if (result.changes !== 1) {
          throw new Error("O inventário mudou durante a recompensa de loot.");
        }
      }

      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return {
        granted: true,
        slots: plannedSlots.map(
          ({ slot, catalogItemId: itemId, stackCount }) => ({
            slot,
            catalogItemId: itemId,
            stackCount,
          }),
        ),
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  awardCharacterItemizationLoot({
    accountId: accountIdInput,
    characterSlot,
    lootEventId,
    drops,
    now = Date.now(),
    idFactory = randomUUID,
  }) {
    const accountId = normalizeAccountId(accountIdInput);
    const validCatalogId = (value) =>
      typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
    const validInt = (value, min, max) =>
      Number.isSafeInteger(value) && value >= min && value <= max;
    if (
      !validInt(characterSlot, 0, 3) ||
      typeof lootEventId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(lootEventId) ||
      !Array.isArray(drops) ||
      drops.length > 5 ||
      !validInt(now, 0, Number.MAX_SAFE_INTEGER) ||
      typeof idFactory !== "function"
    ) {
      throw new PlayerCharacterInputError("Recompensa itemizada inválida.");
    }

    const rarityIds = new Set(["normal", "mystic", "arcane", "legendary", "ancient"]);
    const validStats = new Set([
      "physicalDamageFlat", "criticalDamageBps", "accuracyBps",
      "armorPenetrationBps", "magicAttackBps", "cooldownReductionBps",
      "mpCostReductionBps", "physicalDefenseFlat", "elementalResistanceBps",
      "maxHpFlat", "maxMpFlat", "damageAbsorptionBps", "movementSpeedBps",
      "dropRateBps", "experienceBonusBps",
    ]);
    const normalizedDrops = drops.map((drop) => {
      if (!drop || typeof drop !== "object" || Array.isArray(drop)) {
        throw new PlayerCharacterInputError("Entrada de loot inválida.");
      }
      if (drop.kind === "item") {
        if (
          !validCatalogId(drop.itemId) ||
          !validInt(drop.clientItemId, 1, 0xffff) ||
          !validInt(drop.quantity, 1, 500) ||
          !validInt(drop.stackLimit, 1, 500) ||
          !validInt(drop.stackCount ?? 1, 1, drop.stackLimit) ||
          drop.quantity > 500
        ) {
          throw new PlayerCharacterInputError("Pilha de loot inválida.");
        }
        return { ...drop, stackCount: drop.stackCount ?? 1 };
      }
      if (drop.kind !== "equipment") {
        throw new PlayerCharacterInputError("Tipo de loot desconhecido.");
      }
      if (
        !validCatalogId(drop.catalogItemId) ||
        !validInt(drop.clientItemId, 1, 0xffff) ||
        typeof drop.instanceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(drop.instanceId) ||
        !rarityIds.has(drop.rarity) ||
        !validInt(drop.itemLevel, 1, 400) ||
        !drop.baseStats || typeof drop.baseStats !== "object" || Array.isArray(drop.baseStats) ||
        !Array.isArray(drop.affixes) || drop.affixes.length > 4
      ) {
        throw new PlayerCharacterInputError("Instância de equipamento inválida.");
      }
      for (const stat of ["physicalDamage", "magicAttack", "physicalDefense", "maxHp", "maxMp"]) {
        if (!validInt(drop.baseStats[stat], 0, 0x7fffffff)) {
          throw new PlayerCharacterInputError(`Stat-base ${stat} inválido.`);
        }
      }
      const affixIds = new Set();
      const affixStats = new Set();
      const affixes = drop.affixes.map((affix) => {
        if (
          !affix || typeof affix !== "object" ||
          !validInt(affix.clientAffixId, 1, 0xff) ||
          typeof affix.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(affix.id) ||
          !validStats.has(affix.stat) || !validInt(affix.value, 0, 100_000) ||
          !["flat", "basis-points"].includes(affix.valueUnit) ||
          affixIds.has(affix.id) || affixStats.has(affix.stat)
        ) {
          throw new PlayerCharacterInputError("Afixo rolado inválido ou repetido.");
        }
        affixIds.add(affix.id);
        affixStats.add(affix.stat);
        return { ...affix };
      });
      return { ...drop, affixes };
    });
    const instanceIds = normalizedDrops
      .filter((drop) => drop.kind === "equipment")
      .map((drop) => drop.instanceId);
    if (new Set(instanceIds).size !== instanceIds.length) {
      throw new PlayerCharacterInputError("UUID de instância duplicado no loot.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const character = this.#inventorySeedState.get(accountId, characterSlot);
      if (!character || character.inventorySeeded !== 1) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return null;
      }
      if (this.#findItemizationLootClaim.get(lootEventId, accountId, characterSlot)) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return { granted: false, reason: "already-awarded", slots: [] };
      }

      const inventory = this.#database.prepare(`
        SELECT inventory_slot AS slot, catalog_item_id AS catalogItemId,
          stack_count AS stackCount, item_instance_id AS instanceId
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ?
        ORDER BY inventory_slot
      `).all(accountId, characterSlot);
      const working = new Map(inventory.map((row) => [row.slot, {
        ...row,
        stackCount: row.stackCount || 0,
        isNew: false,
      }]));
      let nextSlot = 0;
      const findFreeSlot = () => {
        while (nextSlot < 60 && working.has(nextSlot)) nextSlot += 1;
        if (nextSlot >= 60) return null;
        const slot = nextSlot;
        nextSlot += 1;
        return slot;
      };

      for (const drop of normalizedDrops) {
        if (drop.kind === "equipment") {
          const slot = findFreeSlot();
          if (slot === null) {
            this.#database.exec("COMMIT;");
            transactionOpen = false;
            return { granted: false, reason: "inventory-full", slots: [] };
          }
          working.set(slot, {
            slot,
            catalogItemId: drop.catalogItemId,
            stackCount: 1,
            instanceId: drop.instanceId,
            isNew: true,
            itemization: drop,
          });
          continue;
        }

        let remaining = drop.quantity;
        for (const row of working.values()) {
          if (remaining === 0) break;
          if (row.catalogItemId !== drop.itemId || row.instanceId !== null) continue;
          const stackCount = row.stackCount || drop.stackCount || 1;
          if (stackCount >= drop.stackLimit) continue;
          const added = Math.min(drop.stackLimit - stackCount, remaining);
          row.stackCount = stackCount + added;
          row.isNew = row.isNew || false;
          remaining -= added;
        }
        while (remaining > 0) {
          const slot = findFreeSlot();
          if (slot === null) {
            this.#database.exec("COMMIT;");
            transactionOpen = false;
            return { granted: false, reason: "inventory-full", slots: [] };
          }
          const stackCount = Math.min(drop.stackLimit, remaining);
          working.set(slot, {
            slot,
            catalogItemId: drop.itemId,
            stackCount,
            instanceId: null,
            isNew: true,
          });
          remaining -= stackCount;
        }
      }

      this.#insertItemizationLootClaim.run(
        lootEventId,
        accountId,
        characterSlot,
        now,
      );
      const changed = [];
      for (const row of working.values()) {
        const previous = inventory.find((entry) => entry.slot === row.slot);
        if (!row.isNew && row.stackCount === (previous?.stackCount || 0)) continue;
        if (row.isNew) {
          if (row.instanceId) {
            this.#insertItemizedLootInventoryItem.run(
              accountId,
              characterSlot,
              row.slot,
              row.catalogItemId,
              row.stackCount,
              row.instanceId,
            );
            this.#insertItemRoll.run(
              row.instanceId,
              row.itemization.clientItemId,
              row.itemization.rarity,
              row.itemization.itemLevel,
              JSON.stringify(row.itemization.baseStats),
              lootEventId,
              row.itemization.catalogVersion ?? "caracatoa-itemization-v1",
              now,
            );
            row.itemization.affixes.forEach((affix, affixIndex) => {
              this.#insertItemAffix.run(
                row.instanceId,
                affixIndex,
                affix.clientAffixId,
                affix.id,
                affix.stat,
                affix.value,
                affix.valueUnit,
              );
            });
          } else {
            this.#insertLootInventoryItem.run(
              accountId,
              characterSlot,
              row.slot,
              row.catalogItemId,
              row.stackCount,
            );
          }
        } else {
          const result = this.#updateInventoryItemStackCount.run(
            row.stackCount,
            accountId,
            characterSlot,
            row.slot,
            row.catalogItemId,
          );
          if (result.changes !== 1) {
            throw new Error("O inventário mudou durante a recompensa itemizada.");
          }
        }
        changed.push({
          slot: row.slot,
          catalogItemId: row.catalogItemId,
          stackCount: row.stackCount,
          itemInstanceId: row.instanceId,
          itemization: row.itemization ?? null,
        });
        this.#insertItemizationAudit.run(
          idFactory(),
          accountId,
          characterSlot,
          row.instanceId,
          lootEventId,
          JSON.stringify({ catalogItemId: row.catalogItemId, stackCount: row.stackCount }),
          now,
        );
      }
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return { granted: true, slots: changed };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  getCharacterItemizationDetails(accountIdInput, characterSlot) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(characterSlot) || characterSlot < 0 || characterSlot > 3) {
      return [];
    }
    return this.#listCharacterItemRolls.all(accountId, characterSlot).map((row) => ({
      slot: row.slot,
      instanceId: row.instanceId,
      catalogItemId: row.catalogItemId,
      clientItemId: row.clientItemId,
      rarity: row.rarity,
      itemLevel: row.itemLevel,
      refinementLevel: row.refinementLevel,
      baseStats: JSON.parse(row.baseStatsJson),
      sourceId: row.sourceId,
      catalogVersion: row.catalogVersion,
      affixes: this.#listItemRollAffixes.all(row.instanceId),
    }));
  }

  listPlayerShopListings(accountIdInput, details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados do mercado inválidos.");
    }
    return this.#shopStore.list({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  createPlayerShopListing(accountIdInput, details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados do anúncio inválidos.");
    }
    return this.#shopStore.createListing({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  cancelPlayerShopListing(accountIdInput, details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados para retirar anúncio inválidos.");
    }
    return this.#shopStore.cancelListing({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  buyPlayerShopListing(accountIdInput, details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados da compra inválidos.");
    }
    return this.#shopStore.buyListing({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  expirePlayerShopListings(nowMs = Date.now()) {
    return this.#shopStore.expireAt(nowMs);
  }

  getCharacterStageState(accountIdInput, characterSlot) {
    return this.#advancementStore.getStageState(
      normalizeAccountId(accountIdInput),
      characterSlot,
    );
  }

  promoteCharacterStage(accountIdInput, details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados do ritual inválidos.");
    }
    return this.#advancementStore.promoteStage({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  refineCharacterItem(details) {
    if (!details || typeof details !== "object") {
      throw new PlayerCharacterInputError("Dados de refinamento inválidos.");
    }
    return this.#advancementStore.refineItem({
      ...details,
      accountId: normalizeAccountId(details.accountId),
    });
  }

  consumeCharacterInventoryItem({
    accountId: accountIdInput,
    characterSlot,
    inventorySlot,
    catalogItemId,
    expectedStackCount,
  }) {
    const accountId = normalizeAccountId(accountIdInput);
    if (
      !Number.isInteger(characterSlot) ||
      characterSlot < 0 ||
      characterSlot > 3 ||
      !Number.isInteger(inventorySlot) ||
      inventorySlot < 0 ||
      inventorySlot > 59 ||
      typeof catalogItemId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(catalogItemId) ||
      !Number.isInteger(expectedStackCount) ||
      expectedStackCount < 1 ||
      expectedStackCount > 500
    ) {
      throw new PlayerCharacterInputError("Consumo de item inválido.");
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    let transactionOpen = true;
    try {
      const row = this.#findInventoryItemForConsumption.get(
        accountId,
        characterSlot,
        inventorySlot,
      );
      if (!row || row.catalogItemId !== catalogItemId) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return null;
      }

      const currentStackCount =
        row.stackCount === 0 ? expectedStackCount : row.stackCount;
      if (currentStackCount !== expectedStackCount) {
        this.#database.exec("COMMIT;");
        transactionOpen = false;
        return { consumed: false, stackCount: currentStackCount };
      }

      const stackCount = currentStackCount - 1;
      const result =
        stackCount === 0
          ? this.#deleteInventoryItem.run(
              accountId,
              characterSlot,
              inventorySlot,
              catalogItemId,
            )
          : this.#updateInventoryItemStackCount.run(
              stackCount,
              accountId,
              characterSlot,
              inventorySlot,
              catalogItemId,
            );
      if (result.changes !== 1) {
        throw new Error("A quantidade do item mudou durante o consumo.");
      }
      this.#database.exec("COMMIT;");
      transactionOpen = false;
      return { consumed: true, stackCount };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {}
      }
      throw error;
    }
  }

  isCatalogItemInUse(catalogItemId) {
    if (
      typeof catalogItemId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(catalogItemId)
    ) {
      return false;
    }
    return Boolean(this.#itemInUse.get(catalogItemId));
  }

  saveCharacterPosition(accountIdInput, slot, expectedPosition, nextPosition) {
    const accountId = normalizeAccountId(accountIdInput);
    if (!Number.isInteger(slot) || slot < 0 || slot > 3) return false;
    validateWorldPosition(expectedPosition);
    validateWorldPosition(nextPosition);
    const result = this.#saveCharacterPosition.run(
      nextPosition.x,
      nextPosition.y,
      accountId,
      slot,
      expectedPosition.x,
      expectedPosition.y,
    );
    return result.changes === 1;
  }

  getAccount(accountIdInput) {
    const accountId = normalizeAccountId(accountIdInput);
    return publicAccount(this.#find.get(accountId));
  }

  listCharacterMounts(accountIdInput, characterSlot) {
    return this.#mountStore.list(normalizeAccountId(accountIdInput), characterSlot);
  }

  grantCharacterMountEgg(accountIdInput, details) {
    return this.#mountStore.grantEgg({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  incubateCharacterMountEgg(accountIdInput, details) {
    return this.#mountStore.incubate({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  feedCharacterMount(accountIdInput, details) {
    return this.#mountStore.feed({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  awardCharacterMountExperience(accountIdInput, details) {
    return this.#mountStore.awardExperience({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  evolveCharacterMount(accountIdInput, details) {
    return this.#mountStore.evolve({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  selectCharacterMount(accountIdInput, details) {
    return this.#mountStore.selectActive({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  startCharacterMountRide(accountIdInput, details) {
    return this.#mountStore.startRiding({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  tickCharacterMountRide(accountIdInput, details) {
    return this.#mountStore.tickRiding({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  stopCharacterMountRide(accountIdInput, details) {
    return this.#mountStore.stopRiding({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  getAccountBank(accountIdInput) {
    return this.#foundationStore.getBank(normalizeAccountId(accountIdInput));
  }

  transferAccountBankGold(accountIdInput, details) {
    return this.#foundationStore.transferGold({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  transferAccountBankItem(accountIdInput, details) {
    return this.#foundationStore.transferItem({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  createCharacterGuild(accountIdInput, details) {
    return this.#foundationStore.createGuild({
      ...details,
      accountId: normalizeAccountId(accountIdInput),
    });
  }

  getCharacterGuild(accountIdInput, characterSlot) {
    return this.#foundationStore.getGuildForCharacter(
      normalizeAccountId(accountIdInput), characterSlot,
    );
  }

  setEnabled(accountIdInput, enabled) {
    if (typeof enabled !== "boolean")
      throw new PlayerAccountInputError("enabled precisa ser true ou false.");
    const accountId = normalizeAccountId(accountIdInput);
    this.#setEnabled.run(enabled ? 1 : 0, accountId);
    return this.getAccount(accountId);
  }

  async setToken(accountIdInput, tokenInput) {
    const accountId = normalizeAccountId(accountIdInput);
    const token = tokenBytes(tokenInput);
    const salt = randomBytes(16);
    try {
      const hash = Buffer.from(
        await scryptAsync(
          token,
          salt,
          PASSWORD_HASH_BYTES,
          PASSWORD_SCRYPT_OPTIONS,
        ),
      );
      try {
        const result = this.#setToken.run(salt, hash, accountId);
        if (result.changes === 0) return null;
      } finally {
        hash.fill(0);
      }
    } finally {
      token.fill(0);
      salt.fill(0);
    }
    return this.getAccount(accountId);
  }

  close() {
    if (this.#database) {
      this.#database.close();
      this.#database = undefined;
    }
  }
}
