import {
  CARACATOA_MAX_DAMAGE_ABSORPTION_BPS,
  CARACATOA_MAX_EQUIPMENT_MAGIC_ATTACK_BPS,
} from "./caracatoa-combat.mjs";
import { CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS } from "./caracatoa-rewards.mjs";
import {
  CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS,
  CARACATOA_MAX_ITEM_MP_COST_REDUCTION_BPS,
} from "./caracatoa-mana.mjs";
import {
  CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS,
  CARACATOA_MAX_ITEM_COOLDOWN_REDUCTION_BPS,
} from "./caracatoa-cooldowns.mjs";

const MAX_INVENTORY_ITEMS = 60;
const MAX_ITEM_ATTACK_DAMAGE_BONUS = 1000;
const MAX_ITEM_DEFENSE_BONUS = 1000;
const EQUIPMENT_SLOT_IDS = new Map([
  ["weapon", 0],
  ["head", 1],
  ["chest", 2],
  ["legs", 3],
  ["feet", 4],
  ["accessory", 5],
]);
const ITEMIZATION_TYPE_IDS = new Set([
  "weapon_1h",
  "weapon_2h",
  "bow",
  "staff",
  "head",
  "chest",
  "legs",
  "gloves",
  "boots",
  "cape",
  "necklace",
  "ring",
  "yeti_mantle",
]);
const MAX_INVENTORY_ATTACK_DAMAGE_BONUS =
  MAX_INVENTORY_ITEMS * MAX_ITEM_ATTACK_DAMAGE_BONUS;
const ITEM_PROPERTY_KEYS = [
  "clientItemId",
  "stackCount",
  "field04",
  "effects",
  "starter",
];
const EMPTY_CATALOG = Object.freeze({
  schemaVersion: 1,
  kind: "items",
  entries: Object.freeze([]),
});

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} fora do intervalo aceito.`);
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} precisa ser um objeto.`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    throw new Error(`${label} contém campos ausentes ou não previstos.`);
  }
}

export function validateWyd727ItemCatalog(catalog) {
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "items" ||
    !Array.isArray(catalog.entries)
  ) {
    throw new Error("Cabeçalho do catálogo de itens inválido.");
  }

  const itemIds = new Set();
  let starterCount = 0;
  for (const entry of catalog.entries) {
    if (!entry || typeof entry.id !== "string") {
      throw new Error("Registro de item inválido.");
    }
    const propertyKeys = [...ITEM_PROPERTY_KEYS];
    if (Object.hasOwn(entry.properties ?? {}, "combatEffect")) {
      propertyKeys.push("combatEffect");
    }
    if (Object.hasOwn(entry.properties ?? {}, "useEffect")) {
      propertyKeys.push("useEffect");
    }
    if (Object.hasOwn(entry.properties ?? {}, "equipment")) {
      propertyKeys.push("equipment");
    }
    assertExactKeys(
      entry.properties,
      propertyKeys,
      `properties do item ${entry.id}`,
    );
    const properties = entry.properties;
    assertInteger(properties.clientItemId, 1, 0xffff, "clientItemId");
    assertInteger(properties.stackCount, 1, 500, "stackCount");
    assertInteger(properties.field04, 0, 0xffff, "field04");
    if (itemIds.has(properties.clientItemId)) {
      throw new Error(`clientItemId duplicado: ${properties.clientItemId}.`);
    }
    itemIds.add(properties.clientItemId);
    if (typeof properties.starter !== "boolean") {
      throw new Error("starter precisa ser booleano.");
    }
    if (
      properties.effects?.length !== 3 ||
      !Array.isArray(properties.effects)
    ) {
      throw new Error("effects precisa conter exatamente três pares.");
    }
    for (const effect of properties.effects) {
      assertExactKeys(effect, ["index", "value"], "efeito de item");
      assertInteger(effect.index, 0, 0xff, "effect.index");
      assertInteger(effect.value, 0, 0xff, "effect.value");
    }
    if (Object.hasOwn(properties, "combatEffect")) {
      assertExactKeys(
        properties.combatEffect,
        ["kind", "amount"],
        "combatEffect",
      );
      if (
        properties.combatEffect.kind !== "flat-attack-damage" ||
        properties.stackCount !== 1
      ) {
        throw new Error(
          "combatEffect exige flat-attack-damage e stackCount igual a 1.",
        );
      }
      assertInteger(
        properties.combatEffect.amount,
        1,
        MAX_ITEM_ATTACK_DAMAGE_BONUS,
        "combatEffect.amount",
      );
    }
    if (Object.hasOwn(properties, "useEffect")) {
      if (Object.hasOwn(properties, "combatEffect")) {
        throw new Error(
          "Um item não pode combinar combatEffect com useEffect.",
        );
      }
      assertExactKeys(properties.useEffect, ["kind", "amount"], "useEffect");
      if (properties.useEffect.kind !== "next-basic-attack-damage") {
        throw new Error("Tipo de useEffect não suportado.");
      }
      assertInteger(
        properties.useEffect.amount,
        1,
        MAX_ITEM_ATTACK_DAMAGE_BONUS,
        "useEffect.amount",
      );
    }
    if (Object.hasOwn(properties, "equipment")) {
      if (
        Object.hasOwn(properties, "combatEffect") ||
        Object.hasOwn(properties, "useEffect")
      ) {
        throw new Error("equipment não pode ser combinado com efeito de combate ou consumo.");
      }
      const equipment = properties.equipment;
      assertExactKeys(
        equipment,
        [
          "slot",
          "attackDamageBonus",
          "defenseBonus",
          "allowedClassIds",
          ...(Object.hasOwn(equipment, "itemizationType") ? ["itemizationType"] : []),
        ],
        "equipment",
      );
      if (!EQUIPMENT_SLOT_IDS.has(equipment.slot) || properties.stackCount !== 1) {
        throw new Error("equipment exige um slot válido e stackCount igual a 1.");
      }
      assertInteger(
        equipment.attackDamageBonus,
        0,
        MAX_ITEM_ATTACK_DAMAGE_BONUS,
        "equipment.attackDamageBonus",
      );
      assertInteger(
        equipment.defenseBonus,
        0,
        MAX_ITEM_DEFENSE_BONUS,
        "equipment.defenseBonus",
      );
      if (Object.hasOwn(equipment, "itemizationType")) {
        if (
          !ITEMIZATION_TYPE_IDS.has(equipment.itemizationType) ||
          equipment.attackDamageBonus !== 0 ||
          equipment.defenseBonus !== 0
        ) {
          throw new Error("equipment.itemizationType inválido ou combinado com bônus estático.");
        }
      } else if (
        equipment.attackDamageBonus === 0 &&
        equipment.defenseBonus === 0
      ) {
        throw new Error("equipment precisa modificar ataque ou defesa.");
      }
      if (
        !Array.isArray(equipment.allowedClassIds) ||
        equipment.allowedClassIds.length < 1 ||
        equipment.allowedClassIds.length > 4 ||
        equipment.allowedClassIds.some(
          (classId) => !Number.isInteger(classId) || classId < 0 || classId > 3,
        ) ||
        new Set(equipment.allowedClassIds).size !== equipment.allowedClassIds.length
      ) {
        throw new Error("equipment.allowedClassIds inválido.");
      }
    }
    if (entry.enabled && properties.starter) starterCount += 1;
  }
  if (starterCount > MAX_INVENTORY_ITEMS) {
    throw new Error("O inventário inicial não pode exceder 60 itens.");
  }
  return catalog;
}

export function getWyd727StarterCatalogIds(catalog) {
  validateWyd727ItemCatalog(catalog);
  return catalog.entries
    .filter((entry) => entry.enabled && entry.properties.starter)
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((entry) => entry.id);
}

/** Starter inventory descriptors include the initial stack count from the catalog. */
export function getWyd727StarterInventoryItems(catalog) {
  validateWyd727ItemCatalog(catalog);
  return catalog.entries
    .filter((entry) => entry.enabled && entry.properties.starter)
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((entry) => ({
      catalogItemId: entry.id,
      stackCount: entry.properties.stackCount,
    }));
}

export function resolveWyd727InventoryItems(inventory, catalog) {
  validateWyd727ItemCatalog(catalog);
  if (!Array.isArray(inventory) || inventory.length > MAX_INVENTORY_ITEMS) {
    throw new Error("Inventário persistido inválido.");
  }
  const entriesById = new Map(
    catalog.entries.map((entry) => [entry.id, entry]),
  );
  const slots = new Set();
  return inventory.map((stored) => {
    const storedKeys = Object.hasOwn(stored ?? {}, "stackCount")
      ? ["slot", "catalogItemId", "stackCount"]
      : ["slot", "catalogItemId"];
    assertExactKeys(stored, storedKeys, "item persistido");
    assertInteger(stored.slot, 0, MAX_INVENTORY_ITEMS - 1, "inventory.slot");
    const storedStackCount = stored.stackCount ?? 0;
    assertInteger(storedStackCount, 0, 500, "inventory.stackCount");
    if (slots.has(stored.slot))
      throw new Error("Slot de inventário duplicado.");
    slots.add(stored.slot);
    const entry = entriesById.get(stored.catalogItemId);
    if (!entry) {
      throw new Error(`Definição do item ${stored.catalogItemId} não existe.`);
    }
    const properties = { ...entry.properties };
    properties.stackCount = storedStackCount || properties.stackCount;
    if (!entry.enabled) {
      delete properties.combatEffect;
      delete properties.useEffect;
    }
    return { slot: stored.slot, ...properties };
  });
}

export function getWyd727InventoryAttackDamageBonus(inventoryItems) {
  if (
    !Array.isArray(inventoryItems) ||
    inventoryItems.length > MAX_INVENTORY_ITEMS
  ) {
    throw new Error("Inventário para cálculo de combate inválido.");
  }
  let total = 0;
  for (const item of inventoryItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Item para cálculo de combate inválido.");
    }
    if (item.combatEffect === undefined) continue;
    assertExactKeys(item.combatEffect, ["kind", "amount"], "combatEffect");
    if (
      item.combatEffect.kind !== "flat-attack-damage" ||
      item.stackCount !== 1
    ) {
      throw new Error("Efeito de combate com stackCount diferente de 1.");
    }
    assertInteger(
      item.combatEffect.amount,
      1,
      MAX_ITEM_ATTACK_DAMAGE_BONUS,
      "combatEffect.amount",
    );
    total += item.combatEffect.amount;
  }
  if (total > MAX_INVENTORY_ATTACK_DAMAGE_BONUS) {
    throw new Error("Bônus de combate do inventário excede o limite.");
  }
  return total;
}

export function getWyd727EquipmentCombatBonuses(equipmentItems) {
  if (!Array.isArray(equipmentItems) || equipmentItems.length > EQUIPMENT_SLOT_IDS.size) {
    throw new Error("Equipamento do personagem inválido.");
  }
  let attackDamageBonus = 0;
  let magicAttackBonus = 0;
  let magicAttackBps = 0;
  let defenseBonus = 0;
  let maxHpBonus = 0;
  let maxMpBonus = 0;
  let absorptionBps = 0;
  let dropRateBps = 0;
  let experienceBonusBps = 0;
  let mpCostReductionBps = 0;
  let cooldownReductionBps = 0;
  const usedSlots = new Set();
  const usedInventorySlots = new Set();
  for (const item of equipmentItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Peça equipada inválida.");
    }
    const allowedKeys = [
      "equipmentSlot",
      "inventorySlot",
      "clientItemId",
      "attackDamageBonus",
      "defenseBonus",
    ];
    if (Object.hasOwn(item, "maxHpBonus")) allowedKeys.push("maxHpBonus");
    if (Object.hasOwn(item, "maxMpBonus")) allowedKeys.push("maxMpBonus");
    if (Object.hasOwn(item, "magicAttackBonus")) allowedKeys.push("magicAttackBonus");
    if (Object.hasOwn(item, "magicAttackBps")) allowedKeys.push("magicAttackBps");
    if (Object.hasOwn(item, "absorptionBps")) allowedKeys.push("absorptionBps");
    if (Object.hasOwn(item, "dropRateBps")) allowedKeys.push("dropRateBps");
    if (Object.hasOwn(item, "experienceBonusBps")) allowedKeys.push("experienceBonusBps");
    if (Object.hasOwn(item, "mpCostReductionBps")) allowedKeys.push("mpCostReductionBps");
    if (Object.hasOwn(item, "cooldownReductionBps")) allowedKeys.push("cooldownReductionBps");
    assertExactKeys(item, allowedKeys, "peça equipada");
    assertInteger(item.equipmentSlot, 0, EQUIPMENT_SLOT_IDS.size - 1, "equipmentSlot");
    assertInteger(item.inventorySlot, 0, MAX_INVENTORY_ITEMS - 1, "inventorySlot");
    assertInteger(item.clientItemId, 1, 0xffff, "clientItemId");
    assertInteger(item.attackDamageBonus, 0, MAX_ITEM_ATTACK_DAMAGE_BONUS, "attackDamageBonus");
    assertInteger(item.defenseBonus, 0, MAX_ITEM_DEFENSE_BONUS, "defenseBonus");
    assertInteger(item.magicAttackBonus ?? 0, 0, 1_000_000, "magicAttackBonus");
    assertInteger(item.magicAttackBps ?? 0, 0, CARACATOA_MAX_EQUIPMENT_MAGIC_ATTACK_BPS, "magicAttackBps");
    assertInteger(item.maxHpBonus ?? 0, 0, 1_000_000, "maxHpBonus");
    assertInteger(item.maxMpBonus ?? 0, 0, 1_000_000, "maxMpBonus");
    assertInteger(item.absorptionBps ?? 0, 0, CARACATOA_MAX_DAMAGE_ABSORPTION_BPS, "absorptionBps");
    assertInteger(item.dropRateBps ?? 0, 0, CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS, "dropRateBps");
    assertInteger(item.experienceBonusBps ?? 0, 0, CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS, "experienceBonusBps");
    assertInteger(item.mpCostReductionBps ?? 0, 0, CARACATOA_MAX_ITEM_MP_COST_REDUCTION_BPS, "mpCostReductionBps");
    assertInteger(item.cooldownReductionBps ?? 0, 0, CARACATOA_MAX_ITEM_COOLDOWN_REDUCTION_BPS, "cooldownReductionBps");
    if (usedSlots.has(item.equipmentSlot) || usedInventorySlots.has(item.inventorySlot)) {
      throw new Error("Slot de equipamento ou inventário duplicado.");
    }
    usedSlots.add(item.equipmentSlot);
    usedInventorySlots.add(item.inventorySlot);
    attackDamageBonus += item.attackDamageBonus;
    magicAttackBonus += item.magicAttackBonus ?? 0;
    magicAttackBps += item.magicAttackBps ?? 0;
    defenseBonus += item.defenseBonus;
    maxHpBonus += item.maxHpBonus ?? 0;
    maxMpBonus += item.maxMpBonus ?? 0;
    absorptionBps += item.absorptionBps ?? 0;
    dropRateBps += item.dropRateBps ?? 0;
    experienceBonusBps += item.experienceBonusBps ?? 0;
    mpCostReductionBps += item.mpCostReductionBps ?? 0;
    cooldownReductionBps += item.cooldownReductionBps ?? 0;
  }
  return {
    attackDamageBonus,
    magicAttackBonus,
    magicAttackBps: Math.min(magicAttackBps, CARACATOA_MAX_EQUIPMENT_MAGIC_ATTACK_BPS),
    defenseBonus,
    maxHpBonus,
    maxMpBonus,
    absorptionBps: Math.min(absorptionBps, CARACATOA_MAX_DAMAGE_ABSORPTION_BPS),
    dropRateBps: Math.min(dropRateBps, CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS),
    experienceBonusBps: Math.min(experienceBonusBps, CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS),
    mpCostReductionBps: Math.min(mpCostReductionBps, CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS),
    cooldownReductionBps: Math.min(cooldownReductionBps, CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS),
  };
}

export const EMPTY_WYD727_ITEM_CATALOG = EMPTY_CATALOG;
