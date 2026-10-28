import { resolveWyd727InventoryItems } from "./wyd-727-item-catalog.mjs";
import { validateWyd727ItemCatalog } from "./wyd-727-item-catalog.mjs";
import { validateWyd727MonsterCatalog } from "./wyd-727-monster-catalog.mjs";

export function awardWyd727MonsterLoot({
  accountStore,
  accountId,
  characterSlot,
  monsterEntityId,
  monsterCatalog,
  itemCatalog,
  random = Math.random,
}) {
  validateWyd727MonsterCatalog(monsterCatalog);
  validateWyd727ItemCatalog(itemCatalog);
  if (
    !Number.isInteger(monsterEntityId) ||
    monsterEntityId < 1 ||
    monsterEntityId > 0xffff
  ) {
    throw new RangeError("clientEntityId do drop está fora do intervalo.");
  }
  if (typeof random !== "function") {
    throw new TypeError("random precisa ser uma função.");
  }

  const monster = monsterCatalog.entries.find(
    (entry) => entry.properties.clientEntityId === monsterEntityId,
  );
  if (!monster?.enabled || !monster.properties.drop) {
    return { awarded: false, reason: "no-drop-configured" };
  }

  const drop = monster.properties.drop;
  const item = itemCatalog.entries.find(
    (entry) => entry.id === drop.catalogItemId,
  );
  if (!item?.enabled) {
    throw new Error(
      `Item habilitado ${drop.catalogItemId} do drop não existe no catálogo.`,
    );
  }

  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError("random deve retornar um número entre 0 e 1.");
  }
  if (roll * 10_000 >= drop.chanceBasisPoints) {
    return { awarded: false, reason: "chance-missed" };
  }

  if (typeof accountStore?.awardCharacterInventoryItem !== "function") {
    throw new TypeError("Store de jogador não aceita loot de monstro.");
  }
  const result = accountStore.awardCharacterInventoryItem({
    accountId,
    characterSlot,
    catalogItemId: item.id,
    quantity: drop.quantity,
    baseStackCount: item.properties.stackCount,
  });
  if (!result) return { awarded: false, reason: "character-unavailable" };
  if (!result.granted) {
    return { awarded: false, reason: result.reason ?? "inventory-full" };
  }

  const slots = resolveWyd727InventoryItems(
    result.slots.map(({ slot, catalogItemId, stackCount }) => ({
      slot,
      catalogItemId,
      stackCount,
    })),
    itemCatalog,
  );
  return {
    awarded: true,
    catalogItemId: item.id,
    quantity: drop.quantity,
    slots,
  };
}
