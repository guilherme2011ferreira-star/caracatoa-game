import { randomUUID } from "node:crypto";
import { rollMonsterLoot, validateItemizationConfig } from "./item-affix-system.mjs";
import {
  resolveWyd727InventoryItems,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";
import { validateWyd727MonsterCatalog } from "./wyd-727-monster-catalog.mjs";

function requireActiveCatalogItem(itemCatalog, id, clientItemId) {
  const entry = itemCatalog.entries.find((candidate) => candidate.id === id);
  if (
    !entry?.enabled ||
    entry.properties.clientItemId !== clientItemId
  ) {
    throw new Error(`Item Caracatoa ${id} não corresponde ao catálogo ativo.`);
  }
  return entry;
}

/** Rolls and persists the catalogued loot for one authoritative monster death. */
export function awardCaracatoaItemizedMonsterLoot({
  accountStore,
  accountId,
  characterSlot,
  monsterEntityId,
  lootEventId,
  monsterCatalog,
  itemCatalog,
  itemizationConfig,
  playerLuckBonusBps = 0,
  randomInt,
  now = Date.now(),
  idFactory = randomUUID,
}) {
  validateWyd727ItemCatalog(itemCatalog);
  validateWyd727MonsterCatalog(monsterCatalog);
  validateItemizationConfig(itemizationConfig);
  if (
    !Array.isArray(monsterCatalog?.entries) ||
    !Number.isInteger(monsterEntityId) || monsterEntityId < 1 || monsterEntityId > 0xffff ||
    typeof lootEventId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(lootEventId)
  ) {
    throw new RangeError("Identidade do evento de loot inválida.");
  }
  const monster = monsterCatalog.entries.find(
    (entry) => entry.properties?.clientEntityId === monsterEntityId,
  );
  const lootTableId = monster && itemizationConfig.monsterLootTableAssignments?.[monster.id];
  if (!monster?.enabled || !lootTableId) {
    return { awarded: false, reason: "no-itemization-table" };
  }
  const loot = rollMonsterLoot({
    config: itemizationConfig,
    lootTableId,
    monsterLevel: monster.properties.level,
    playerLuckBonusBps,
    randomInt,
  });
  const drops = loot.map((entry) => {
    if (entry.kind === "equipment") {
      const item = requireActiveCatalogItem(
        itemCatalog,
        entry.instance.catalogItemId,
        entry.instance.clientItemId,
      );
      return {
        ...entry.instance,
        kind: "equipment",
        catalogItemId: item.id,
      };
    }
    const item = requireActiveCatalogItem(itemCatalog, entry.itemId, entry.clientItemId);
    const definition = itemizationConfig.itemDefinitions[entry.itemId];
    if (!definition || definition.stackLimit !== entry.stackLimit) {
      throw new Error(`Definição de pilha divergente para ${entry.itemId}.`);
    }
    return {
      kind: "item",
      itemId: item.id,
      clientItemId: item.properties.clientItemId,
      quantity: entry.quantity,
      stackCount: item.properties.stackCount,
      stackLimit: definition.stackLimit,
    };
  });
  if (typeof accountStore?.awardCharacterItemizationLoot !== "function") {
    throw new TypeError("Store não aceita loot itemizado Caracatoa.");
  }
  const result = accountStore.awardCharacterItemizationLoot({
    accountId,
    characterSlot,
    lootEventId,
    drops,
    now,
    idFactory,
  });
  if (!result) return { awarded: false, reason: "character-unavailable" };
  if (!result.granted) {
    return { awarded: false, reason: result.reason ?? "inventory-full" };
  }
  if (drops.length === 0) {
    return { awarded: false, reason: "no-item-dropped", claimRecorded: true };
  }

  const resolved = resolveWyd727InventoryItems(
    result.slots.map(({ slot, catalogItemId, stackCount }) => ({
      slot,
      catalogItemId,
      stackCount,
    })),
    itemCatalog,
  );
  const itemizationBySlot = new Map(
    result.slots.map((row) => [row.slot, row.itemization]),
  );
  const slots = resolved.map((row) => ({
    ...row,
    itemization: itemizationBySlot.get(row.slot) ?? null,
  }));
  return {
    awarded: true,
    lootEventId,
    catalogItemId: drops[0].catalogItemId ?? drops[0].itemId,
    quantity: drops.reduce((sum, drop) => sum + (drop.quantity ?? 1), 0),
    slots,
  };
}
