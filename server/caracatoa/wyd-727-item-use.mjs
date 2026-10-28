import {
  getWyd727StarterInventoryItems,
  resolveWyd727InventoryItems,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";

const USE_ITEM_BODY_LENGTH = 32;
const INVENTORY_SLOT_DELTA_BODY_LENGTH = 24;
const MAX_INVENTORY_SLOT = 59;
const MAX_ITEM_STACK_COUNT = 500;

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function parseWyd727ItemUseRequest(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== USE_ITEM_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== 0x373) {
    return { malformed: true, reason: "invalid-opcode" };
  }

  const request = {
    clientId: body.readUInt16LE(2),
    form: body.readUInt32LE(8),
    slot: body.readUInt32LE(12),
    reserved: body.readUInt32LE(16),
    feedMarker: body.readUInt32LE(20),
    position: { x: body.readInt16LE(24), y: body.readInt16LE(26) },
    destinationIndex: body.readUInt32LE(28),
  };
  if (
    request.clientId === 0 ||
    request.form !== 1 ||
    request.slot > MAX_INVENTORY_SLOT ||
    request.reserved !== 0 ||
    (request.feedMarker !== 0 && request.feedMarker !== 0xe)
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { malformed: false, ...request };
}

function toWireItem(item) {
  return {
    clientItemId: item.clientItemId,
    stackCount: item.stackCount,
    field04: item.field04,
    effects: item.effects,
  };
}

function readInventoryItemAtSlot({
  accountStore,
  accountId,
  characterSlot,
  inventorySlot,
  catalog,
}) {
  const storedInventory = accountStore.initializeCharacterInventory(
    accountId,
    characterSlot,
    getWyd727StarterInventoryItems(catalog),
  );
  if (!storedInventory) return { storedItem: null, item: null };
  const storedItem = storedInventory.find(({ slot }) => slot === inventorySlot);
  if (!storedItem) return { storedItem: null, item: null };
  const item = resolveWyd727InventoryItems([storedItem], catalog)[0];
  return { storedItem, item };
}

export function consumeWyd727CatalogItem({
  accountStore,
  accountId,
  characterSlot,
  inventorySlot,
  catalog,
}) {
  validateWyd727ItemCatalog(catalog);
  if (
    !accountStore ||
    typeof accountStore.initializeCharacterInventory !== "function" ||
    typeof accountStore.consumeCharacterInventoryItem !== "function"
  ) {
    throw new TypeError(
      "accountStore não oferece consumo persistente de item.",
    );
  }
  if (!isIntegerBetween(characterSlot, 0, 3)) {
    throw new RangeError("Slot de personagem inválido para uso de item.");
  }
  if (!isIntegerBetween(inventorySlot, 0, MAX_INVENTORY_SLOT)) {
    throw new RangeError("Slot de inventário inválido para uso de item.");
  }

  const current = readInventoryItemAtSlot({
    accountStore,
    accountId,
    characterSlot,
    inventorySlot,
    catalog,
  });
  if (!current.storedItem || !current.item) {
    return { consumed: false, reason: "empty-slot", item: null };
  }

  const definition = catalog.entries.find(
    ({ id }) => id === current.storedItem.catalogItemId,
  );
  if (!definition?.enabled || !definition.properties.useEffect) {
    return {
      consumed: false,
      reason: "item-not-usable",
      item: toWireItem(current.item),
    };
  }

  const result = accountStore.consumeCharacterInventoryItem({
    accountId,
    characterSlot,
    inventorySlot,
    catalogItemId: definition.id,
    expectedStackCount: current.item.stackCount,
  });
  if (result === null || result.consumed === false) {
    const latest = readInventoryItemAtSlot({
      accountStore,
      accountId,
      characterSlot,
      inventorySlot,
      catalog,
    });
    return {
      consumed: false,
      reason: result === null ? "stale-slot" : "stack-conflict",
      item: latest.item ? toWireItem(latest.item) : null,
    };
  }

  return {
    consumed: true,
    reason: null,
    useEffect: definition.properties.useEffect,
    stackCount: result.stackCount,
    item:
      result.stackCount === 0
        ? null
        : toWireItem({ ...current.item, stackCount: result.stackCount }),
  };
}

export function buildWyd727InventorySlotDeltaBody({ clientId, slot, item }) {
  if (!isIntegerBetween(clientId, 1, 0xffff)) {
    throw new RangeError("clientId inválido para o delta de inventário.");
  }
  if (!isIntegerBetween(slot, 0, MAX_INVENTORY_SLOT)) {
    throw new RangeError("Slot inválido para o delta de inventário.");
  }

  const body = Buffer.alloc(INVENTORY_SLOT_DELTA_BODY_LENGTH);
  body.writeUInt16LE(0x182, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt16LE(1, 8);
  body.writeInt16LE(slot, 10);
  if (item === null) return body;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("Item para delta de inventário inválido.");
  }
  if (!isIntegerBetween(item.clientItemId, 1, 0xffff)) {
    throw new RangeError("clientItemId inválido para o delta de inventário.");
  }
  if (!isIntegerBetween(item.stackCount, 1, MAX_ITEM_STACK_COUNT)) {
    throw new RangeError("stackCount inválido para o delta de inventário.");
  }
  if (!isIntegerBetween(item.field04, 0, 0xffff)) {
    throw new RangeError("field04 inválido para o delta de inventário.");
  }
  if (!Array.isArray(item.effects) || item.effects.length !== 3) {
    throw new TypeError(
      "effects deve conter três pares no delta de inventário.",
    );
  }

  const itemOffset = 12;
  body.writeUInt16LE(item.clientItemId, itemOffset);
  body.writeInt16LE(item.stackCount, itemOffset + 2);
  body.writeUInt16LE(item.field04, itemOffset + 4);
  for (let index = 0; index < item.effects.length; index += 1) {
    const effect = item.effects[index];
    if (
      !effect ||
      !isIntegerBetween(effect.index, 0, 0xff) ||
      !isIntegerBetween(effect.value, 0, 0xff)
    ) {
      throw new RangeError("Efeito inválido para o delta de inventário.");
    }
    body[itemOffset + 6 + index * 2] = effect.index;
    body[itemOffset + 7 + index * 2] = effect.value;
  }
  return body;
}
