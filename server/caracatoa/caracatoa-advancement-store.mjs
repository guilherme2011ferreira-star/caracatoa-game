import { randomInt as cryptoRandomInt } from "node:crypto";
import { readFileSync } from "node:fs";

const ADVANCEMENT = JSON.parse(readFileSync(
  new URL("./data/catalogs/advancement.json", import.meta.url), "utf8",
));
const STAGES = ADVANCEMENT.stages;
const STAGE_BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CaracatoaAdvancementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaracatoaAdvancementError";
    this.code = code;
  }
}

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CaracatoaAdvancementError("INVALID_INPUT", `${name} inválido.`);
  }
}

function identity(accountId, characterSlot) {
  if (typeof accountId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,14}$/.test(accountId)) {
    throw new CaracatoaAdvancementError("INVALID_INPUT", "Conta inválida.");
  }
  integer(characterSlot, 0, 3, "Slot de personagem");
}

function validateAdvancementCatalog(catalog = ADVANCEMENT) {
  const refinement = catalog?.refinement;
  if (catalog?.schemaVersion !== 1 || catalog?.kind !== "advancement" ||
      catalog?.balanceVersion !== "caracatoa-advancement-v1" ||
      !Array.isArray(catalog.stages) || catalog.stages.length !== 4 ||
      refinement?.maximumLevel !== 15 || refinement.successChanceBpsByTargetLevel?.length !== 16 ||
      refinement.noItemBreak !== true) {
    throw new Error("Catálogo de evolução Caracatoa inválido.");
  }
  for (let index = 0; index < catalog.stages.length; index += 1) {
    const stage = catalog.stages[index];
    if (stage.stageId !== index || stage.id !== STAGES[index].id ||
        stage.maximumTotalLevel !== (index + 1) * 400) {
      throw new Error("Estágios de personagem fora de sequência.");
    }
  }
  for (let level = 1; level <= 15; level += 1) {
    integer(refinement.successChanceBpsByTargetLevel[level], 0, 10_000, `chance +${level}`);
    if (typeof refinement.materialByTargetLevel[level] !== "string") {
      throw new Error(`Material do refinamento +${level} ausente.`);
    }
  }
  integer(refinement.baseStatIncreasePerLevelBps, 0, 1000, "Bônus por refino");
  integer(catalog.stageRitual?.bonusAttributePoints, 0, 1000, "Pontos de atributo do ritual");
  integer(catalog.stageRitual?.bonusSkillPoints, 0, 1000, "Pontos de habilidade do ritual");
  return catalog;
}

validateAdvancementCatalog();

export function getCaracatoaAdvancementCatalog() {
  return structuredClone(ADVANCEMENT);
}

export function migrateCaracatoaAdvancementSchema(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version === 16 || version === 17) return;
  if (version !== 15) throw new Error(`Migração de progressão exige schema v15; recebeu v${version}.`);
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(`
      ALTER TABLE player_characters ADD COLUMN progression_stage TEXT NOT NULL
        DEFAULT 'mortal' CHECK (progression_stage IN ('mortal', 'arch', 'celestial', 'sub-celestial'));
      UPDATE player_characters
      SET progression_stage = CASE
        WHEN level >= 1201 THEN 'sub-celestial'
        WHEN level >= 801 THEN 'celestial'
        WHEN level >= 401 THEN 'arch'
        ELSE 'mortal'
      END;
      CREATE TABLE player_character_stage_events (
        event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) = 36),
        account_id TEXT NOT NULL,
        character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
        from_stage TEXT NOT NULL CHECK (from_stage IN ('mortal', 'arch', 'celestial')),
        to_stage TEXT NOT NULL CHECK (to_stage IN ('arch', 'celestial', 'sub-celestial')),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        FOREIGN KEY (account_id, character_slot)
          REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX player_character_stage_events_by_owner
        ON player_character_stage_events(account_id, character_slot, created_at_ms DESC);
      PRAGMA user_version = 16;
    `);
    database.exec("COMMIT;");
  } catch (error) {
    try { database.exec("ROLLBACK;"); } catch {}
    throw error;
  }
}

function currentStageLevel(stage, totalLevel) {
  const previousMaximum = stage.stageId === 0 ? 0 : STAGES[stage.stageId - 1].maximumTotalLevel;
  return Math.max(1, Math.min(400, totalLevel - previousMaximum));
}

export class CaracatoaAdvancementStore {
  #database;
  #config;

  constructor(database, { config = ADVANCEMENT } = {}) {
    this.#database = database;
    this.#config = validateAdvancementCatalog(config);
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

  getStageState(accountId, characterSlot) {
    identity(accountId, characterSlot);
    const row = this.#database.prepare(`
      SELECT pc.progression_stage AS stageId, pc.level AS totalLevel,
        pc.experience, pc.attribute_points AS attributePoints,
        pc.skill_points AS skillPoints
      FROM player_characters AS pc
      JOIN player_accounts AS pa ON pa.account_id = pc.account_id
      WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
    `).get(accountId, characterSlot);
    if (!row) return null;
    const stage = STAGE_BY_ID.get(row.stageId);
    const nextStage = STAGES[stage.stageId + 1] ?? null;
    return {
      stage: stage.id,
      displayName: stage.displayName,
      stageId: stage.stageId,
      level: currentStageLevel(stage, row.totalLevel),
      totalLevel: row.totalLevel,
      experience: row.experience,
      maximumLevel: 400,
      availableAttributePoints: row.attributePoints,
      availableSkillPoints: row.skillPoints,
      requiredMaterialId: nextStage?.requiredMaterialId ?? null,
      requiredMaterialClientItemId: nextStage?.requiredMaterialClientItemId ?? 0,
      canAdvance: Boolean(nextStage) && row.totalLevel === stage.maximumTotalLevel,
      maximumStage: !nextStage,
    };
  }

  promoteStage({ accountId, characterSlot, eventId, nowMs = Date.now() }) {
    identity(accountId, characterSlot);
    if (typeof eventId !== "string" || !UUID.test(eventId)) {
      throw new CaracatoaAdvancementError("INVALID_INPUT", "ID do ritual inválido.");
    }
    integer(nowMs, 0, Number.MAX_SAFE_INTEGER, "Horário");
    return this.#transaction(() => {
      const prior = this.#database.prepare(`
        SELECT account_id AS accountId, character_slot AS characterSlot,
          result_json AS resultJson
        FROM player_character_stage_events WHERE event_id = ?
      `).get(eventId);
      if (prior) {
        if (prior.accountId !== accountId || prior.characterSlot !== characterSlot) {
          return { status: "rejected", reason: "event-conflict", state: this.getStageState(accountId, characterSlot) };
        }
        return { ...JSON.parse(prior.resultJson), status: "duplicate", replayed: true };
      }
      const row = this.#database.prepare(`
        SELECT pc.progression_stage AS stageId, pc.level AS totalLevel,
          pc.experience, pc.attribute_points AS attributePoints,
          pc.skill_points AS skillPoints
        FROM player_characters AS pc
        JOIN player_accounts AS pa ON pa.account_id = pc.account_id
        WHERE pc.account_id = ? AND pc.slot = ? AND pa.enabled = 1
      `).get(accountId, characterSlot);
      if (!row) return { status: "rejected", reason: "character-unavailable", state: null };
      const stage = STAGE_BY_ID.get(row.stageId);
      const nextStage = STAGES[stage.stageId + 1];
      if (!nextStage) return { status: "rejected", reason: "maximum-stage", state: this.getStageState(accountId, characterSlot) };
      if (row.totalLevel < stage.maximumTotalLevel) {
        return { status: "rejected", reason: "level-cap-required", state: this.getStageState(accountId, characterSlot) };
      }
      const material = this.#database.prepare(`
        SELECT inventory_slot AS slot, stack_count AS stackCount
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND catalog_item_id = ?
          AND shop_listing_id IS NULL
        ORDER BY inventory_slot LIMIT 1
      `).get(accountId, characterSlot, nextStage.requiredMaterialId);
      if (!material) return { status: "rejected", reason: "missing-material", state: this.getStageState(accountId, characterSlot) };
      const attributePoints = row.attributePoints + this.#config.stageRitual.bonusAttributePoints;
      const skillPoints = row.skillPoints + this.#config.stageRitual.bonusSkillPoints;
      if (attributePoints > 0x7fffffff || skillPoints > 0x7fffffff) {
        return { status: "rejected", reason: "points-cap", state: this.getStageState(accountId, characterSlot) };
      }
      const consume = material.stackCount <= 1
        ? this.#database.prepare(`DELETE FROM player_character_inventory WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?`).run(accountId, characterSlot, material.slot)
        : this.#database.prepare(`UPDATE player_character_inventory SET stack_count = stack_count - 1 WHERE account_id = ? AND character_slot = ? AND inventory_slot = ?`).run(accountId, characterSlot, material.slot);
      if (consume.changes !== 1) throw new Error("O material do ritual mudou durante a transação.");
      const update = this.#database.prepare(`
        UPDATE player_characters
        SET progression_stage = ?, level = level + 1,
            experience = MAX(experience, ?), attribute_points = ?, skill_points = ?
        WHERE account_id = ? AND slot = ? AND progression_stage = ?
      `).run(
        nextStage.id,
        5 * (row.totalLevel + 1) * row.totalLevel,
        attributePoints,
        skillPoints,
        accountId,
        characterSlot,
        stage.id,
      );
      if (update.changes !== 1) throw new Error("A etapa do personagem mudou durante o ritual.");
      const state = this.getStageState(accountId, characterSlot);
      const result = {
        status: "promoted",
        reason: "none",
        fromStage: stage.id,
        toStage: nextStage.id,
        materialId: nextStage.requiredMaterialId,
        materialSlot: material.slot,
        remainingMaterialCount: Math.max(0, material.stackCount - 1),
        state,
      };
      this.#database.prepare(`
        INSERT INTO player_character_stage_events
          (event_id, account_id, character_slot, from_stage, to_stage, result_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, accountId, characterSlot, stage.id, nextStage.id, JSON.stringify(result), nowMs);
      return result;
    });
  }

  refineItem({
    accountId,
    characterSlot,
    inventorySlot,
    eventId,
    useDivineDust = false,
    itemCatalog,
    itemizationConfig,
    nowMs = Date.now(),
    randomInt = (minimum, maximum) => cryptoRandomInt(minimum, maximum + 1),
  }) {
    identity(accountId, characterSlot);
    integer(inventorySlot, 0, 59, "Slot de inventário");
    integer(nowMs, 0, Number.MAX_SAFE_INTEGER, "Horário");
    if (typeof eventId !== "string" || !UUID.test(eventId) || typeof randomInt !== "function") {
      throw new CaracatoaAdvancementError("INVALID_INPUT", "Pedido de refinamento inválido.");
    }
    if (useDivineDust !== true && useDivineDust !== false) {
      throw new CaracatoaAdvancementError("INVALID_INPUT", "Opção divina inválida.");
    }
    if (!Array.isArray(itemCatalog?.entries) || !itemizationConfig?.itemDefinitions) {
      throw new CaracatoaAdvancementError("CATALOG_UNAVAILABLE", "Catálogo de itens indisponível.");
    }
    const rules = this.#config.refinement;
    return this.#transaction(() => {
      const prior = this.#database.prepare(`
        SELECT account_id AS accountId, character_slot AS characterSlot,
          item_instance_id AS instanceId, details_json AS detailsJson
        FROM itemization_audit_events WHERE event_id = ?
      `).get(eventId);
      if (prior) {
        if (prior.accountId !== accountId || prior.characterSlot !== characterSlot) {
          return { status: "rejected", reason: "event-conflict", inventoryChanges: [] };
        }
        return { ...JSON.parse(prior.detailsJson), status: "duplicate", replayed: true, inventoryChanges: [] };
      }
      const row = this.#database.prepare(`
        SELECT pci.inventory_slot AS slot, pci.catalog_item_id AS catalogItemId,
          pci.stack_count AS stackCount, pci.equipment_slot AS equipmentSlot,
          pir.item_instance_id AS instanceId, pir.client_item_id AS clientItemId,
          pir.rarity, pir.item_level AS itemLevel,
          pir.refinement_level AS refinementLevel,
          pc.level AS characterLevel, pa.enabled AS accountEnabled
        FROM player_character_inventory AS pci
        JOIN player_character_item_rolls AS pir ON pir.item_instance_id = pci.item_instance_id
        JOIN player_characters AS pc ON pc.account_id = pci.account_id AND pc.slot = pci.character_slot
        JOIN player_accounts AS pa ON pa.account_id = pc.account_id
        WHERE pci.account_id = ? AND pci.character_slot = ? AND pci.inventory_slot = ?
          AND pci.shop_listing_id IS NULL
      `).get(accountId, characterSlot, inventorySlot);
      if (!row || row.accountEnabled !== 1) return { status: "rejected", reason: "empty-slot", inventoryChanges: [] };
      const item = itemCatalog.entries.find((entry) => entry.id === row.catalogItemId && entry.enabled);
      const itemType = item?.properties?.equipment?.itemizationType;
      if (!itemType || row.stackCount > 1 || row.itemLevel > row.characterLevel) {
        return { status: "rejected", reason: !itemType ? "not-itemized-equipment" : row.itemLevel > row.characterLevel ? "item-level-too-high" : "invalid-stack", inventoryChanges: [] };
      }
      if (row.refinementLevel >= rules.maximumLevel) return { status: "rejected", reason: "maximum-refinement", inventoryChanges: [] };
      const targetLevel = row.refinementLevel + 1;
      if (useDivineDust && targetLevel < rules.guaranteedFromTargetLevel) {
        return { status: "rejected", reason: "divine-level-too-low", inventoryChanges: [] };
      }
      const requiredItemId = rules.materialByTargetLevel[targetLevel];
      const requiredDefinition = itemizationConfig.itemDefinitions[requiredItemId];
      const divineDefinition = itemizationConfig.itemDefinitions[rules.divineDustItemId];
      const requiredItemEntry = itemCatalog.entries.find((entry) => entry.id === requiredItemId && entry.enabled);
      const divineItemEntry = itemCatalog.entries.find((entry) => entry.id === rules.divineDustItemId && entry.enabled);
      if (!requiredDefinition || !requiredItemEntry || requiredDefinition.clientItemId !== requiredItemEntry.properties.clientItemId ||
          (useDivineDust && (!divineDefinition || !divineItemEntry || divineDefinition.clientItemId !== divineItemEntry.properties.clientItemId))) {
        throw new CaracatoaAdvancementError("CATALOG_MISMATCH", "Material de refinamento diverge do catálogo de itens.");
      }
      const findMaterial = (catalogItemId) => this.#database.prepare(`
        SELECT inventory_slot AS slot, stack_count AS stackCount
        FROM player_character_inventory
        WHERE account_id = ? AND character_slot = ? AND catalog_item_id = ?
          AND shop_listing_id IS NULL
        ORDER BY inventory_slot LIMIT 1
      `).get(accountId, characterSlot, catalogItemId);
      const catalyst = findMaterial(requiredItemId);
      const divine = useDivineDust ? findMaterial(rules.divineDustItemId) : null;
      if (!catalyst || (useDivineDust && !divine)) {
        return { status: "rejected", reason: !catalyst ? "missing-catalyst" : "missing-divine-dust", inventoryChanges: [] };
      }
      const chanceBps = useDivineDust ? 10_000 : rules.successChanceBpsByTargetLevel[targetLevel];
      const roll = randomInt(1, 10_000);
      integer(roll, 1, 10_000, "Resultado do refinamento");
      const success = roll <= chanceBps;
      const nextRefinementLevel = success
        ? targetLevel
        : targetLevel >= rules.failureDowngradeFromTargetLevel
          ? Math.max(0, row.refinementLevel - 1)
          : row.refinementLevel;
      const consumeOne = (catalogItemId, material) => {
        const definition = itemizationConfig.itemDefinitions[catalogItemId];
        const count = material.stackCount === 0 ? definition.stackCount : material.stackCount;
        const update = count <= 1
          ? this.#database.prepare(`DELETE FROM player_character_inventory WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND catalog_item_id = ? AND shop_listing_id IS NULL`).run(accountId, characterSlot, material.slot, catalogItemId)
          : this.#database.prepare(`UPDATE player_character_inventory SET stack_count = ? WHERE account_id = ? AND character_slot = ? AND inventory_slot = ? AND catalog_item_id = ? AND shop_listing_id IS NULL`).run(count - 1, accountId, characterSlot, material.slot, catalogItemId);
        if (update.changes !== 1) throw new Error("Material de refinamento mudou durante a transação.");
        return { slot: material.slot, catalogItemId, remainingCount: Math.max(0, count - 1) };
      };
      const consumed = [consumeOne(requiredItemId, catalyst)];
      if (useDivineDust) consumed.push(consumeOne(rules.divineDustItemId, divine));
      const update = this.#database.prepare(`
        UPDATE player_character_item_rolls SET refinement_level = ?
        WHERE item_instance_id = ? AND refinement_level = ?
      `).run(nextRefinementLevel, row.instanceId, row.refinementLevel);
      if (update.changes !== 1) throw new Error("O nível do item mudou durante o refinamento.");
      const outcome = {
        status: success ? "success" : "failed",
        reason: "none",
        slot: inventorySlot,
        oldLevel: row.refinementLevel,
        targetLevel,
        newLevel: nextRefinementLevel,
        success,
        chanceBps,
        materialItemId: requiredItemId,
        materialClientItemId: requiredDefinition.clientItemId,
        divineDustUsed: useDivineDust,
        itemInstanceId: row.instanceId,
        equipped: row.equipmentSlot !== null,
        consumed,
      };
      this.#database.prepare(`
        INSERT INTO itemization_audit_events
          (event_id, account_id, character_slot, item_instance_id, action, source_id, details_json, created_at_ms)
        VALUES (?, ?, ?, ?, 'reforge', 'caracatoa-refinement-v1', ?, ?)
      `).run(eventId, accountId, characterSlot, row.instanceId, JSON.stringify(outcome), nowMs);
      outcome.inventoryChanges = consumed.map((material) => ({
        slot: material.slot,
        catalogItemId: material.catalogItemId,
        stackCount: material.remainingCount,
      }));
      return outcome;
    });
  }
}
