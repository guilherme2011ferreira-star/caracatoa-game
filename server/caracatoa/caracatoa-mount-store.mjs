import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getCaracatoaLevelForExperience } from "./caracatoa-character-progression.mjs";

const CATALOG = JSON.parse(
  readFileSync(new URL("./data/catalogs/mounts.json", import.meta.url), "utf8"),
);
const SPECIES = new Map(CATALOG.entries.map((entry) => [entry.id, entry]));
const MAX_MOUNTS_PER_CHARACTER = 20;
const MAX_MOUNT_LEVEL = 50;
const EVOLUTION_LEVEL = 10;

export class CaracatoaMountError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaracatoaMountError";
    this.code = code;
  }
}

function requireInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CaracatoaMountError("INVALID_INPUT", `${label} inválido.`);
  }
}

function requireIdentity(accountId, characterSlot) {
  if (typeof accountId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,14}$/.test(accountId)) {
    throw new CaracatoaMountError("INVALID_INPUT", "Conta inválida.");
  }
  requireInteger(characterSlot, 0, 3, "Slot de personagem");
}

function requireMountId(mountId) {
  if (typeof mountId !== "string" || !/^[0-9a-f-]{36}$/.test(mountId)) {
    throw new CaracatoaMountError("INVALID_INPUT", "ID de montaria inválido.");
  }
}

function requireTime(nowMs) {
  requireInteger(nowMs, 0, Number.MAX_SAFE_INTEGER, "Horário");
}

function requiredDust(species) {
  return species.incubationCritical > 6 ? CATALOG.dust.lact : CATALOG.dust.ori;
}

function publicMount(row) {
  if (!row) return null;
  return {
    id: row.mountId,
    speciesId: row.speciesId,
    stage: row.stage,
    level: row.level,
    experience: row.experience,
    hunger: row.hunger,
    maxHunger: row.maxHunger,
    vitality: row.vitality,
    maxVitality: row.maxVitality,
    incubationRemaining: row.incubationRemaining,
    incubationReadyAtMs: row.incubationReadyAtMs,
    active: row.active === 1,
    riding: row.riding === 1,
    bornAtMs: row.bornAtMs,
    expiresAtMs: row.expiresAtMs,
    totalRidingMs: row.totalRidingMs,
  };
}

export function validateCaracatoaMountCatalog(catalog = CATALOG) {
  if (catalog?.schemaVersion !== 1 || catalog?.kind !== "mounts" ||
      !Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    throw new Error("Catálogo de montarias inválido.");
  }
  requireInteger(catalog.hungerTickMs, 1000, 3600000, "hungerTickMs");
  requireInteger(catalog.feed?.restore, 1, 10000, "feed.restore");
  for (const value of [catalog.feed?.catalogItemId, catalog.dust?.ori, catalog.dust?.lact]) {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
      throw new Error("Item de montaria inválido.");
    }
  }
  const ids = new Set();
  for (const entry of catalog.entries) {
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.id) ||
        ids.has(entry.id) || typeof entry.name !== "string" || !entry.name ||
        !["basic", "intermediate", "advanced"].includes(entry.tier)) {
      throw new Error("Espécie de montaria inválida ou duplicada.");
    }
    ids.add(entry.id);
    requireInteger(entry.requiredLevel, 1, 400, "requiredLevel");
    requireInteger(entry.incubationCritical, 1, 9, "incubationCritical");
    requireInteger(entry.incubationWaitMs, 1000, 86400000, "incubationWaitMs");
    requireInteger(entry.maxHunger, 1, 10000, "maxHunger");
    requireInteger(entry.maxVitality, 1, 10000, "maxVitality");
    for (const key of ["hp", "physicalAttack", "magicAttack", "defense", "moveSpeedBps", "absorptionBps"]) {
      requireInteger(entry.bonuses?.[key], 0, key.endsWith("Bps") ? 1000 : 1000, key);
    }
  }
  return catalog;
}

validateCaracatoaMountCatalog();

export function getCaracatoaMountCatalog() {
  return structuredClone(CATALOG);
}

export function calculateCaracatoaMountBonuses(mount) {
  const species = SPECIES.get(mount?.speciesId);
  if (!species || !["juvenile", "adult"].includes(mount.stage) || mount.vitality <= 0) {
    return null;
  }
  const growthBps = 10000 + Math.min(mount.level - 1, 30) * 100 +
    (mount.stage === "adult" ? 1000 : 0);
  const bonuses = {};
  for (const key of ["hp", "physicalAttack", "magicAttack", "defense"]) {
    bonuses[key] = Math.floor(species.bonuses[key] * growthBps / 10000);
  }
  bonuses.moveSpeedBps = species.bonuses.moveSpeedBps;
  bonuses.absorptionBps = species.bonuses.absorptionBps;
  return bonuses;
}

export function migrateCaracatoaMountSchema(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version === 14 || version === 15 || version === 16 || version === 17) return;
  if (version !== 13) throw new Error(`Migração de montarias exige schema v13; recebeu v${version}.`);
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(`
      CREATE TABLE player_character_mounts (
        mount_id TEXT PRIMARY KEY NOT NULL CHECK (length(mount_id) = 36),
        account_id TEXT NOT NULL,
        character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
        species_id TEXT NOT NULL CHECK (length(species_id) BETWEEN 1 AND 64),
        source_event_id TEXT NOT NULL UNIQUE CHECK (length(source_event_id) BETWEEN 1 AND 96),
        stage TEXT NOT NULL CHECK (stage IN ('egg', 'juvenile', 'adult', 'dead')),
        level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
        experience INTEGER NOT NULL DEFAULT 0 CHECK (experience BETWEEN 0 AND 2147483647),
        hunger INTEGER NOT NULL DEFAULT 0 CHECK (hunger BETWEEN 0 AND 10000),
        max_hunger INTEGER NOT NULL CHECK (max_hunger BETWEEN 1 AND 10000),
        vitality INTEGER NOT NULL DEFAULT 0 CHECK (vitality BETWEEN 0 AND 10000),
        max_vitality INTEGER NOT NULL CHECK (max_vitality BETWEEN 1 AND 10000),
        incubation_remaining INTEGER NOT NULL CHECK (incubation_remaining BETWEEN 0 AND 9),
        incubation_ready_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (incubation_ready_at_ms >= 0),
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
        riding INTEGER NOT NULL DEFAULT 0 CHECK (riding IN (0, 1)),
        last_tick_at_ms INTEGER CHECK (last_tick_at_ms IS NULL OR last_tick_at_ms >= 0),
        tick_carry_ms INTEGER NOT NULL DEFAULT 0 CHECK (tick_carry_ms BETWEEN 0 AND 3599999),
        born_at_ms INTEGER CHECK (born_at_ms IS NULL OR born_at_ms >= 0),
        expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms >= 0),
        total_riding_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_riding_ms >= 0),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        FOREIGN KEY (account_id, character_slot)
          REFERENCES player_characters(account_id, slot) ON DELETE CASCADE,
        CHECK (hunger <= max_hunger AND vitality <= max_vitality),
        CHECK (stage != 'dead' OR (vitality = 0 AND active = 0 AND riding = 0)),
        CHECK (riding = 0 OR (active = 1 AND stage IN ('juvenile', 'adult')))
      ) STRICT;
      CREATE INDEX player_character_mounts_by_owner
        ON player_character_mounts(account_id, character_slot, created_at_ms);
      CREATE UNIQUE INDEX player_character_mounts_one_active
        ON player_character_mounts(account_id, character_slot) WHERE active = 1;
      PRAGMA user_version = 14;
    `);
    database.exec("COMMIT;");
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch {}
    throw error;
  }
}

export class CaracatoaMountStore {
  #database;
  #find;
  #owner;

  constructor(database) {
    this.#database = database;
    // A sessão de montaria é volátil; reiniciar o processo não consome ração offline.
    database.exec("UPDATE player_character_mounts SET riding = 0, last_tick_at_ms = NULL, tick_carry_ms = 0 WHERE riding = 1;");
    this.#find = database.prepare(`
      SELECT mount_id AS mountId, species_id AS speciesId, stage, level, experience,
        hunger, max_hunger AS maxHunger, vitality, max_vitality AS maxVitality,
        incubation_remaining AS incubationRemaining,
        incubation_ready_at_ms AS incubationReadyAtMs, active, riding,
        last_tick_at_ms AS lastTickAtMs, tick_carry_ms AS tickCarryMs,
        born_at_ms AS bornAtMs, expires_at_ms AS expiresAtMs,
        total_riding_ms AS totalRidingMs
      FROM player_character_mounts
      WHERE account_id = ? AND character_slot = ? AND mount_id = ?
    `);
    this.#owner = database.prepare(`
      SELECT pc.level, pc.experience FROM player_characters AS pc
      JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
    `);
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

  #character(accountId, characterSlot) {
    const character = this.#owner.get(accountId, characterSlot);
    if (!character) throw new CaracatoaMountError("CHARACTER_UNAVAILABLE", "Personagem indisponível.");
    return character;
  }

  #mount(accountId, characterSlot, mountId) {
    const row = this.#find.get(accountId, characterSlot, mountId);
    if (!row) throw new CaracatoaMountError("MOUNT_NOT_FOUND", "Montaria não encontrada.");
    return row;
  }

  #consumeItem(accountId, characterSlot, inventorySlot, catalogItemId) {
    requireInteger(inventorySlot, 0, 59, "Slot de inventário");
    const item = this.#database.prepare(`
      SELECT catalog_item_id AS catalogItemId, stack_count AS stackCount
      FROM player_character_inventory
      WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
    `).get(accountId, characterSlot, inventorySlot);
    if (!item || item.catalogItemId !== catalogItemId || item.stackCount < 1) {
      return false;
    }
    if (item.stackCount === 1) {
      this.#database.prepare(`
        DELETE FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
      `).run(accountId, characterSlot, inventorySlot);
    } else {
      this.#database.prepare(`
        UPDATE player_character_inventory SET stack_count = stack_count - 1
        WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?
      `).run(accountId, characterSlot, inventorySlot);
    }
    return true;
  }

  list(accountId, characterSlot) {
    requireIdentity(accountId, characterSlot);
    this.#character(accountId, characterSlot);
    return this.#database.prepare(`
      SELECT mount_id AS mountId, species_id AS speciesId, stage, level, experience,
        hunger, max_hunger AS maxHunger, vitality, max_vitality AS maxVitality,
        incubation_remaining AS incubationRemaining,
        incubation_ready_at_ms AS incubationReadyAtMs, active, riding,
        born_at_ms AS bornAtMs, expires_at_ms AS expiresAtMs,
        total_riding_ms AS totalRidingMs
      FROM player_character_mounts WHERE account_id = ? AND character_slot = ?
      ORDER BY created_at_ms, mount_id
    `).all(accountId, characterSlot).map(publicMount);
  }

  grantEgg({ accountId, characterSlot, speciesId, sourceEventId, incubationCritical, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireTime(nowMs);
    const species = SPECIES.get(speciesId);
    if (!species || typeof sourceEventId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,95}$/.test(sourceEventId)) {
      throw new CaracatoaMountError("INVALID_INPUT", "Espécie ou origem inválida.");
    }
    const critical = incubationCritical ?? species.incubationCritical;
    requireInteger(critical, 1, 9, "Incubation critical");
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      const previous = this.#database.prepare(`
        SELECT account_id AS accountId, character_slot AS characterSlot,
          species_id AS speciesId, mount_id AS mountId
        FROM player_character_mounts WHERE source_event_id = ?
      `).get(sourceEventId);
      if (previous) {
        if (previous.accountId !== accountId || previous.characterSlot !== characterSlot ||
            previous.speciesId !== speciesId) {
          throw new CaracatoaMountError("SOURCE_CONFLICT", "Origem de ovo já usada.");
        }
        return publicMount(this.#mount(accountId, characterSlot, previous.mountId));
      }
      const count = this.#database.prepare(`
        SELECT COUNT(*) AS count FROM player_character_mounts
        WHERE account_id = ? AND character_slot = ? AND stage != 'dead'
      `).get(accountId, characterSlot).count;
      if (count >= MAX_MOUNTS_PER_CHARACTER) {
        throw new CaracatoaMountError("MOUNT_LIMIT", "Limite de montarias atingido.");
      }
      const mountId = randomUUID();
      this.#database.prepare(`
        INSERT INTO player_character_mounts
          (mount_id, account_id, character_slot, species_id, source_event_id,
           stage, max_hunger, max_vitality, incubation_remaining, created_at_ms)
        VALUES (?, ?, ?, ?, ?, 'egg', ?, ?, ?, ?)
      `).run(mountId, accountId, characterSlot, speciesId, sourceEventId,
        species.maxHunger, species.maxVitality, critical, nowMs);
      return publicMount(this.#mount(accountId, characterSlot, mountId));
    });
  }

  incubate({ accountId, characterSlot, mountId, inventorySlot, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      const mount = this.#mount(accountId, characterSlot, mountId);
      if (mount.stage !== "egg") {
        throw new CaracatoaMountError("NOT_AN_EGG", "Esta montaria já saiu do ovo.");
      }
      if (nowMs < mount.incubationReadyAtMs) {
        return { status: "waiting", mount: publicMount(mount) };
      }
      const species = SPECIES.get(mount.speciesId);
      const dustItemId = requiredDust(species);
      if (!this.#consumeItem(accountId, characterSlot, inventorySlot, dustItemId)) {
        return { status: "missing-dust", requiredItemId: dustItemId, mount: publicMount(mount) };
      }
      const remaining = mount.incubationRemaining - 1;
      const hatched = remaining === 0;
      this.#database.prepare(`
        UPDATE player_character_mounts
        SET incubation_remaining = ?, incubation_ready_at_ms = ?, stage = ?,
          hunger = ?, vitality = ?, born_at_ms = ?
        WHERE mount_id = ?
      `).run(remaining, hatched ? 0 : nowMs + species.incubationWaitMs,
        hatched ? "juvenile" : "egg", hatched ? mount.maxHunger : 0,
        hatched ? mount.maxVitality : 0, hatched ? nowMs : null, mountId);
      return { status: hatched ? "hatched" : "incubating",
        requiredItemId: dustItemId,
        mount: publicMount(this.#mount(accountId, characterSlot, mountId)) };
    });
  }

  feed({ accountId, characterSlot, mountId, inventorySlot, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      const mount = this.#mount(accountId, characterSlot, mountId);
      if (mount.stage === "egg" || mount.stage === "dead") {
        throw new CaracatoaMountError("NOT_FEEDABLE", "Esta montaria não pode ser alimentada.");
      }
      if (mount.hunger === mount.maxHunger) return { status: "full", mount: publicMount(mount) };
      if (!this.#consumeItem(accountId, characterSlot, inventorySlot, CATALOG.feed.catalogItemId)) {
        return { status: "missing-feed", mount: publicMount(mount) };
      }
      this.#database.prepare(`
        UPDATE player_character_mounts SET hunger = MIN(max_hunger, hunger + ?)
        WHERE mount_id = ?
      `).run(CATALOG.feed.restore, mountId);
      return { status: "fed", mount: publicMount(this.#mount(accountId, characterSlot, mountId)) };
    });
  }

  awardExperience({ accountId, characterSlot, mountId, amount }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireInteger(amount, 1, 1000000, "Experiência de montaria");
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      const mount = this.#mount(accountId, characterSlot, mountId);
      if (mount.stage === "egg" || mount.stage === "dead") {
        throw new CaracatoaMountError("NOT_TRAINABLE", "Montaria não pode ganhar experiência.");
      }
      let level = mount.level;
      let experience = mount.experience + amount;
      while (level < MAX_MOUNT_LEVEL && experience >= level * level * 100) {
        experience -= level * level * 100;
        level++;
      }
      if (level === MAX_MOUNT_LEVEL) experience = 0;
      this.#database.prepare(`
        UPDATE player_character_mounts SET level = ?, experience = ? WHERE mount_id = ?
      `).run(level, experience, mountId);
      return publicMount(this.#mount(accountId, characterSlot, mountId));
    });
  }

  evolve({ accountId, characterSlot, mountId, inventorySlot, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      const mount = this.#mount(accountId, characterSlot, mountId);
      if (mount.stage !== "juvenile" || mount.level < EVOLUTION_LEVEL) {
        throw new CaracatoaMountError("EVOLUTION_REQUIREMENT", "Montaria exige estágio jovem e nível 10.");
      }
      const itemId = requiredDust(SPECIES.get(mount.speciesId));
      if (!this.#consumeItem(accountId, characterSlot, inventorySlot, itemId)) {
        return { status: "missing-dust", requiredItemId: itemId, mount: publicMount(mount) };
      }
      this.#database.prepare("UPDATE player_character_mounts SET stage = 'adult' WHERE mount_id = ?")
        .run(mountId);
      return { status: "evolved", mount: publicMount(this.#mount(accountId, characterSlot, mountId)) };
    });
  }

  selectActive({ accountId, characterSlot, mountId }) {
    requireIdentity(accountId, characterSlot);
    if (mountId !== null) requireMountId(mountId);
    return this.#transaction(() => {
      const character = this.#character(accountId, characterSlot);
      let mount = null;
      if (mountId !== null) {
        mount = this.#mount(accountId, characterSlot, mountId);
        const species = SPECIES.get(mount.speciesId);
        const level = getCaracatoaLevelForExperience(character.experience, character.level);
        if (!["juvenile", "adult"].includes(mount.stage) || mount.vitality <= 0 ||
            level < species.requiredLevel) {
          throw new CaracatoaMountError("MOUNT_REQUIREMENT", "Nível ou estado da montaria insuficiente.");
        }
      }
      const riding = this.#database.prepare(`
        SELECT 1 FROM player_character_mounts
        WHERE account_id = ? AND character_slot = ? AND riding = 1 LIMIT 1
      `).get(accountId, characterSlot);
      if (riding) {
        throw new CaracatoaMountError("RIDE_ACTIVE", "Desmonte antes de trocar de montaria.");
      }
      this.#database.prepare(`
        UPDATE player_character_mounts SET active = 0, riding = 0,
          last_tick_at_ms = NULL
        WHERE account_id = ? AND character_slot = ? AND active = 1
      `).run(accountId, characterSlot);
      if (mountId !== null) {
        this.#database.prepare("UPDATE player_character_mounts SET active = 1 WHERE mount_id = ?")
          .run(mountId);
      }
      return mountId === null ? null : publicMount(this.#mount(accountId, characterSlot, mountId));
    });
  }

  startRiding({ accountId, characterSlot, mountId, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      const character = this.#character(accountId, characterSlot);
      const mount = this.#mount(accountId, characterSlot, mountId);
      const species = SPECIES.get(mount.speciesId);
      const level = getCaracatoaLevelForExperience(character.experience, character.level);
      if (mount.active !== 1 || mount.riding === 1 ||
          !["juvenile", "adult"].includes(mount.stage) ||
          mount.hunger <= 0 || mount.vitality <= 0 || level < species.requiredLevel ||
          (mount.expiresAtMs !== null && nowMs >= mount.expiresAtMs)) {
        throw new CaracatoaMountError("RIDE_REQUIREMENT", "Montaria não pode ser usada agora.");
      }
      this.#database.prepare(`
        UPDATE player_character_mounts SET riding = 1, last_tick_at_ms = ?
        WHERE mount_id = ?
      `).run(nowMs, mountId);
      const activeMount = publicMount(this.#mount(accountId, characterSlot, mountId));
      return { mount: activeMount, bonuses: calculateCaracatoaMountBonuses(activeMount) };
    });
  }

  #advance(accountId, characterSlot, mountId, nowMs, stop) {
    const mount = this.#mount(accountId, characterSlot, mountId);
    if (mount.riding !== 1) return publicMount(mount);
    if (nowMs < mount.lastTickAtMs) {
      throw new CaracatoaMountError("INVALID_TIME", "Relógio da montaria retrocedeu.");
    }
    const elapsed = nowMs - mount.lastTickAtMs;
    const total = mount.tickCarryMs + elapsed;
    const steps = Math.floor(total / CATALOG.hungerTickMs);
    const hunger = Math.max(0, mount.hunger - steps);
    const vitality = Math.max(0, mount.vitality - Math.max(0, steps - mount.hunger));
    const dead = vitality === 0 || (mount.expiresAtMs !== null && nowMs >= mount.expiresAtMs);
    this.#database.prepare(`
      UPDATE player_character_mounts
      SET hunger = ?, vitality = ?, stage = ?, active = ?, riding = ?,
        last_tick_at_ms = ?, tick_carry_ms = ?, total_riding_ms = ?
      WHERE mount_id = ?
    `).run(hunger, dead ? 0 : vitality, dead ? "dead" : mount.stage,
      dead ? 0 : mount.active, dead || stop ? 0 : 1,
      dead || stop ? null : nowMs, dead ? 0 : total % CATALOG.hungerTickMs,
      Math.min(Number.MAX_SAFE_INTEGER, mount.totalRidingMs + elapsed), mountId);
    return publicMount(this.#mount(accountId, characterSlot, mountId));
  }

  tickRiding({ accountId, characterSlot, mountId, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      return this.#advance(accountId, characterSlot, mountId, nowMs, false);
    });
  }

  stopRiding({ accountId, characterSlot, mountId, nowMs }) {
    requireIdentity(accountId, characterSlot);
    requireMountId(mountId);
    requireTime(nowMs);
    return this.#transaction(() => {
      this.#character(accountId, characterSlot);
      return this.#advance(accountId, characterSlot, mountId, nowMs, true);
    });
  }
}
