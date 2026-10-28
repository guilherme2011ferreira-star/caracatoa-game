import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(
  process.env.CARACATOA_STATE_DIR ?? join(APP_DIR, "data", "state"),
);
export const DEFAULT_MONSTER_STATE_DATABASE = join(
  STATE_DIR,
  "world-monsters.sqlite",
);
export const DEFAULT_MONSTER_RESPAWN_MS = 60_000;

function assertInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function persistencePosition(monster) {
  return monster?.spawnPosition ?? monster?.position;
}

function validateMonster(monster) {
  assertInteger(monster?.clientEntityId, 1000, 0xffff, "clientEntityId");
  const position = persistencePosition(monster);
  assertInteger(position?.x, -0x8000, 0x7fff, "spawnPosition.x");
  assertInteger(position?.y, -0x8000, 0x7fff, "spawnPosition.y");
  assertInteger(monster?.maxHp, 1, 0x7fffffff, "maxHp");
  assertInteger(monster?.currentHp, 0, monster.maxHp, "currentHp");
  assertInteger(monster?.defense, 0, 0x7fffffff, "defense");
}

function stateFromRow(row, respawned = false) {
  return {
    clientEntityId: row.client_entity_id,
    position: { x: row.world_x, y: row.world_y },
    maxHp: row.max_hp,
    currentHp: row.current_hp,
    defense: row.defense,
    respawnAt: row.respawn_at,
    respawned,
  };
}

/** Durable HP/death state for the Caracatoa server's single local world grid. */
export class Wyd727MonsterStateStore {
  #database;
  #select;
  #insert;
  #update;

  constructor({ databasePath = DEFAULT_MONSTER_STATE_DATABASE } = {}) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath, { timeout: 5000 });
    try {
      this.#database.exec(`
        PRAGMA trusted_schema = OFF;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
      `);
      const version = this.#database
        .prepare("PRAGMA user_version")
        .get().user_version;
      if (version !== 0 && version !== 1) {
        throw new Error(
          `Versão incompatível do estado de monstros: ${version}.`,
        );
      }
      if (version === 0) {
        this.#database.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE world_monster_state (
            client_entity_id INTEGER NOT NULL CHECK (client_entity_id BETWEEN 1000 AND 65535),
            world_x INTEGER NOT NULL CHECK (world_x BETWEEN -32768 AND 32767),
            world_y INTEGER NOT NULL CHECK (world_y BETWEEN -32768 AND 32767),
            max_hp INTEGER NOT NULL CHECK (max_hp BETWEEN 1 AND 2147483647),
            current_hp INTEGER NOT NULL CHECK (current_hp BETWEEN 0 AND max_hp),
            defense INTEGER NOT NULL CHECK (defense BETWEEN 0 AND 2147483647),
            respawn_at INTEGER NOT NULL DEFAULT 0 CHECK (respawn_at >= 0),
            PRIMARY KEY (client_entity_id, world_x, world_y)
          ) STRICT;
          PRAGMA user_version = 1;
          COMMIT;
        `);
      }
      this.#select = this.#database.prepare(`
        SELECT client_entity_id, world_x, world_y, max_hp, current_hp,
               defense, respawn_at
        FROM world_monster_state
        WHERE client_entity_id = ? AND world_x = ? AND world_y = ?
      `);
      this.#insert = this.#database.prepare(`
        INSERT INTO world_monster_state
          (client_entity_id, world_x, world_y, max_hp, current_hp, defense, respawn_at)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `);
      this.#update = this.#database.prepare(`
        UPDATE world_monster_state
        SET max_hp = ?, current_hp = ?, defense = ?, respawn_at = ?
        WHERE client_entity_id = ? AND world_x = ? AND world_y = ?
      `);
    } catch (error) {
      this.#database.close();
      this.#database = undefined;
      throw error;
    }
  }

  #withTransaction(operation) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  initialize(monster, now) {
    validateMonster(monster);
    const position = persistencePosition(monster);
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, "now");
    return this.#withTransaction(() => {
      let row = this.#select.get(
        monster.clientEntityId,
        position.x,
        position.y,
      );
      if (!row) {
        this.#insert.run(
          monster.clientEntityId,
          position.x,
          position.y,
          monster.maxHp,
          monster.currentHp,
          monster.defense,
        );
        row = this.#select.get(monster.clientEntityId, position.x, position.y);
        return stateFromRow(row);
      }

      let currentHp = Math.min(row.current_hp, monster.maxHp);
      let respawnAt = row.respawn_at;
      let respawned = false;
      if (currentHp === 0 && respawnAt > 0 && respawnAt <= now) {
        currentHp = monster.maxHp;
        respawnAt = 0;
        respawned = true;
      }
      this.#update.run(
        monster.maxHp,
        currentHp,
        monster.defense,
        respawnAt,
        monster.clientEntityId,
        position.x,
        position.y,
      );
      row = this.#select.get(monster.clientEntityId, position.x, position.y);
      return stateFromRow(row, respawned);
    });
  }

  applyDamage(monster, damage, now, respawnMs = DEFAULT_MONSTER_RESPAWN_MS) {
    validateMonster(monster);
    const position = persistencePosition(monster);
    const runtimePosition = { ...monster.position };
    assertInteger(damage, 1, 0x7fffffff, "damage");
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, "now");
    assertInteger(respawnMs, 1000, 86_400_000, "respawnMs");
    return this.#withTransaction(() => {
      const row = this.#select.get(
        monster.clientEntityId,
        position.x,
        position.y,
      );
      if (!row)
        throw new Error("Monstro não foi inicializado no estado local.");
      if (row.current_hp === 0) {
        return {
          ...stateFromRow(row),
          position: runtimePosition,
          damage: 0,
          died: false,
        };
      }
      const actualDamage = Math.min(damage, row.current_hp);
      const currentHp = row.current_hp - actualDamage;
      const respawnAt = currentHp === 0 ? now + respawnMs : row.respawn_at;
      if (!Number.isSafeInteger(respawnAt)) {
        throw new RangeError("respawnAt fora do intervalo seguro.");
      }
      this.#update.run(
        row.max_hp,
        currentHp,
        row.defense,
        respawnAt,
        monster.clientEntityId,
        position.x,
        position.y,
      );
      return {
        ...stateFromRow({
          ...row,
          current_hp: currentHp,
          respawn_at: respawnAt,
        }),
        position: runtimePosition,
        damage: actualDamage,
        died: currentHp === 0,
      };
    });
  }

  applyModeration(
    monster,
    action,
    now,
    respawnMs = DEFAULT_MONSTER_RESPAWN_MS,
  ) {
    validateMonster(monster);
    const position = persistencePosition(monster);
    const runtimePosition = { ...monster.position };
    if (!["kill", "revive"].includes(action)) {
      throw new RangeError("Ação de moderação de monstro inválida.");
    }
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, "now");
    assertInteger(respawnMs, 1000, 86_400_000, "respawnMs");
    return this.#withTransaction(() => {
      const row = this.#select.get(
        monster.clientEntityId,
        position.x,
        position.y,
      );
      if (!row)
        throw new Error("Monstro não foi inicializado no estado local.");
      const before = { ...stateFromRow(row), position: runtimePosition };
      if (action === "kill" && row.current_hp === 0) {
        return { before, after: before, changed: false };
      }
      const currentHp = action === "kill" ? 0 : row.max_hp;
      const respawnAt = action === "kill" ? now + respawnMs : 0;
      if (!Number.isSafeInteger(respawnAt)) {
        throw new RangeError("respawnAt fora do intervalo seguro.");
      }
      const changed =
        currentHp !== row.current_hp || respawnAt !== row.respawn_at;
      if (changed) {
        this.#update.run(
          row.max_hp,
          currentHp,
          row.defense,
          respawnAt,
          monster.clientEntityId,
          position.x,
          position.y,
        );
      }
      return {
        before,
        after: {
          ...stateFromRow({
            ...row,
            current_hp: currentHp,
            respawn_at: respawnAt,
          }),
          position: runtimePosition,
        },
        changed,
      };
    });
  }

  respawn(monster, now) {
    assertInteger(monster?.clientEntityId, 1000, 0xffff, "clientEntityId");
    const position = persistencePosition(monster);
    assertInteger(position?.x, -0x8000, 0x7fff, "spawnPosition.x");
    assertInteger(position?.y, -0x8000, 0x7fff, "spawnPosition.y");
    assertInteger(now, 0, Number.MAX_SAFE_INTEGER, "now");
    return this.#withTransaction(() => {
      const row = this.#select.get(
        monster.clientEntityId,
        position.x,
        position.y,
      );
      if (
        !row ||
        row.current_hp > 0 ||
        row.respawn_at === 0 ||
        row.respawn_at > now
      ) {
        return null;
      }
      this.#update.run(
        row.max_hp,
        row.max_hp,
        row.defense,
        0,
        monster.clientEntityId,
        position.x,
        position.y,
      );
      return stateFromRow(
        { ...row, current_hp: row.max_hp, respawn_at: 0 },
        true,
      );
    });
  }

  close() {
    if (this.#database) {
      this.#database.close();
      this.#database = undefined;
    }
  }
}
