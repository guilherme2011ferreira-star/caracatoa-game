import {
  getWyd727EquipmentCombatBonuses,
  getWyd727StarterInventoryItems,
  resolveWyd727InventoryItems,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";
import {
  aggregateItemAffixes,
  calculateBaseItemStats,
  validateItemizationConfig,
} from "./item-affix-system.mjs";

export const CARACATOA_EQUIPMENT_SLOTS = Object.freeze([
  "weapon",
  "head",
  "chest",
  "legs",
  "feet",
  "accessory",
]);

export const CARACATOA_EQUIPMENT_SYNC_STATUS = Object.freeze({
  applied: 0,
  rejected: 1,
  snapshot: 2,
});

const EQUIPMENT_REQUEST_OPCODE = 0x7f07;
const EQUIPMENT_SYNC_OPCODE = 0x7f08;
const EQUIPMENT_REQUEST_BODY_LENGTH = 12;
const EQUIPMENT_SYNC_BODY_LENGTH = 18;
const EMPTY_INVENTORY_SLOT = 0xff;

function inRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function parseCaracatoaEquipmentRequest(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== EQUIPMENT_REQUEST_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== EQUIPMENT_REQUEST_OPCODE) {
    return { malformed: true, reason: "invalid-opcode" };
  }
  const request = {
    clientId: body.readUInt16LE(2),
    equipmentSlot: body.readUInt8(4),
    inventorySlot: body.readUInt8(5),
    timestamp: body.readUInt32LE(6),
    reserved: body.readUInt16LE(10),
  };
  if (
    request.clientId === 0 ||
    request.equipmentSlot >= CARACATOA_EQUIPMENT_SLOTS.length ||
    (request.inventorySlot > 59 && request.inventorySlot !== EMPTY_INVENTORY_SLOT) ||
    request.reserved !== 0
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { malformed: false, ...request };
}

export function buildCaracatoaEquipmentRequest({
  clientId,
  equipmentSlot,
  inventorySlot,
  timestamp,
}) {
  if (!inRange(clientId, 1, 0xffff)) throw new RangeError("clientId inválido.");
  if (!inRange(equipmentSlot, 0, CARACATOA_EQUIPMENT_SLOTS.length - 1)) {
    throw new RangeError("equipmentSlot inválido.");
  }
  if (!(inRange(inventorySlot, 0, 59) || inventorySlot === EMPTY_INVENTORY_SLOT)) {
    throw new RangeError("inventorySlot inválido.");
  }
  if (!inRange(timestamp, 0, 0xffffffff)) throw new RangeError("timestamp inválido.");
  const body = Buffer.alloc(EQUIPMENT_REQUEST_BODY_LENGTH);
  body.writeUInt16LE(EQUIPMENT_REQUEST_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt8(equipmentSlot, 4);
  body.writeUInt8(inventorySlot, 5);
  body.writeUInt32LE(timestamp >>> 0, 6);
  return body;
}

export function buildCaracatoaEquipmentSyncBody({
  clientId,
  status,
  equipmentSlot,
  equipment = null,
  bonuses,
}) {
  if (!inRange(clientId, 1, 0xffff)) throw new RangeError("clientId inválido.");
  if (!Object.values(CARACATOA_EQUIPMENT_SYNC_STATUS).includes(status)) {
    throw new RangeError("status de equipamento inválido.");
  }
  if (!inRange(equipmentSlot, 0, CARACATOA_EQUIPMENT_SLOTS.length - 1)) {
    throw new RangeError("equipmentSlot inválido.");
  }
  if (
    !bonuses ||
    !inRange(bonuses.attackDamageBonus, 0, 0xffff) ||
    !inRange(bonuses.defenseBonus, 0, 0xffff)
  ) {
    throw new RangeError("Bônus totais de equipamento inválidos.");
  }
  if (
    equipment !== null &&
    (!inRange(equipment.inventorySlot, 0, 59) ||
      !inRange(equipment.clientItemId, 1, 0xffff) ||
      !inRange(equipment.attackDamageBonus, 0, 0xffff) ||
      !inRange(equipment.defenseBonus, 0, 0xffff))
  ) {
    throw new RangeError("Peça de equipamento inválida.");
  }
  const body = Buffer.alloc(EQUIPMENT_SYNC_BODY_LENGTH);
  body.writeUInt16LE(EQUIPMENT_SYNC_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt8(status, 4);
  body.writeUInt8(equipmentSlot, 5);
  body.writeUInt8(equipment?.inventorySlot ?? EMPTY_INVENTORY_SLOT, 6);
  body.writeUInt16LE(equipment?.clientItemId ?? 0, 8);
  body.writeUInt16LE(equipment?.attackDamageBonus ?? 0, 10);
  body.writeUInt16LE(equipment?.defenseBonus ?? 0, 12);
  body.writeUInt16LE(bonuses.attackDamageBonus, 14);
  body.writeUInt16LE(bonuses.defenseBonus, 16);
  return body;
}

export function parseCaracatoaEquipmentSync(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== EQUIPMENT_SYNC_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== EQUIPMENT_SYNC_OPCODE) {
    return { malformed: true, reason: "invalid-opcode" };
  }
  const result = {
    clientId: body.readUInt16LE(2),
    status: body.readUInt8(4),
    equipmentSlot: body.readUInt8(5),
    inventorySlot: body.readUInt8(6),
    clientItemId: body.readUInt16LE(8),
    attackDamageBonus: body.readUInt16LE(10),
    defenseBonus: body.readUInt16LE(12),
    totalAttackDamageBonus: body.readUInt16LE(14),
    totalDefenseBonus: body.readUInt16LE(16),
  };
  if (
    result.clientId === 0 ||
    !Object.values(CARACATOA_EQUIPMENT_SYNC_STATUS).includes(result.status) ||
    result.equipmentSlot >= CARACATOA_EQUIPMENT_SLOTS.length ||
    (result.inventorySlot > 59 && result.inventorySlot !== EMPTY_INVENTORY_SLOT) ||
    (result.inventorySlot === EMPTY_INVENTORY_SLOT) !== (result.clientItemId === 0) ||
    (result.clientItemId === 0 &&
      (result.attackDamageBonus !== 0 || result.defenseBonus !== 0))
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { malformed: false, ...result };
}

export function resolveCaracatoaCharacterEquipment({
  accountStore,
  accountId,
  characterSlot,
  classId,
  catalog,
  itemizationConfig = null,
}) {
  validateWyd727ItemCatalog(catalog);
  if (
    !accountStore ||
    typeof accountStore.initializeCharacterInventory !== "function" ||
    typeof accountStore.listCharacterEquipment !== "function"
  ) {
    throw new TypeError("accountStore não oferece equipamento persistente.");
  }
  if (!inRange(characterSlot, 0, 3) || !inRange(classId, 0, 3)) {
    throw new RangeError("Personagem inválido para carregar equipamento.");
  }
  const inventory = accountStore.initializeCharacterInventory(
    accountId,
    characterSlot,
    getWyd727StarterInventoryItems(catalog),
  );
  const storedEquipment = accountStore.listCharacterEquipment(accountId, characterSlot);
  if (!inventory || !storedEquipment) {
    throw new Error("Equipamento do personagem indisponível.");
  }
  const entriesById = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const instanceDetails =
    typeof accountStore.getCharacterItemizationDetails === "function"
      ? accountStore.getCharacterItemizationDetails(accountId, characterSlot)
      : [];
  const detailsBySlot = new Map(
    instanceDetails.map((detail) => [detail.slot, detail]),
  );
  const character = accountStore.getCharacterBySlot?.(accountId, characterSlot);
  const dynamicRows = storedEquipment
    .map((stored) => ({
      stored,
      entry: entriesById.get(stored.catalogItemId),
      detail: detailsBySlot.get(stored.inventorySlot),
    }))
    .filter(({ entry }) => entry?.properties?.equipment?.itemizationType);
  if (dynamicRows.length > 0) {
    validateItemizationConfig(itemizationConfig);
    if (!character) throw new Error("Personagem indisponível ao resolver equipamento itemizado.");
  }
  const validatedDynamic = dynamicRows.map(({ stored, entry, detail }) =>
    resolveItemizedEquipmentBonuses({
      entry,
      stored,
      detail,
      itemizationConfig,
      characterLevel: character.level,
    }),
  );
  const totalAffixBonuses = dynamicRows.length > 0
    ? aggregateItemAffixes(validatedDynamic.map(({ detail, itemType }) => ({
      ...detail,
      itemType,
      isEquipped: true,
    })), itemizationConfig)
    : null;
  let remainingPhysicalAffix = totalAffixBonuses?.physicalDamageFlat ?? 0;
  let remainingMagicAffix = totalAffixBonuses?.magicAttackBps ?? 0;
  let remainingDefenseAffix = totalAffixBonuses?.physicalDefenseFlat ?? 0;
  let remainingHpAffix = totalAffixBonuses?.maxHpFlat ?? 0;
  let remainingMpAffix = totalAffixBonuses?.maxMpFlat ?? 0;
  let remainingAbsorptionAffix = totalAffixBonuses?.damageAbsorptionBps ?? 0;
  let remainingDropRateAffix = totalAffixBonuses?.dropRateBps ?? 0;
  let remainingExperienceAffix = totalAffixBonuses?.experienceBonusBps ?? 0;
  let remainingMpCostReductionAffix = totalAffixBonuses?.mpCostReductionBps ?? 0;
  let remainingCooldownReductionAffix = totalAffixBonuses?.cooldownReductionBps ?? 0;
  const dynamicByInventorySlot = new Map();
  for (const item of validatedDynamic.sort(
    (left, right) => left.stored.equipmentSlot - right.stored.equipmentSlot,
  )) {
    const physicalAffix = Math.min(
      remainingPhysicalAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "physicalDamageFlat")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const magicAffix = Math.min(
      remainingMagicAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "magicAttackBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const defenseAffix = Math.min(
      remainingDefenseAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "physicalDefenseFlat")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const hpAffix = Math.min(
      remainingHpAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "maxHpFlat")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const mpAffix = Math.min(
      remainingMpAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "maxMpFlat")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const absorptionAffix = Math.min(
      remainingAbsorptionAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "damageAbsorptionBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const dropRateAffix = Math.min(
      remainingDropRateAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "dropRateBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const experienceAffix = Math.min(
      remainingExperienceAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "experienceBonusBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const mpCostReductionAffix = Math.min(
      remainingMpCostReductionAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "mpCostReductionBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    const cooldownReductionAffix = Math.min(
      remainingCooldownReductionAffix,
      item.detail.affixes
        .filter((affix) => affix.stat === "cooldownReductionBps")
        .reduce((sum, affix) => sum + affix.value, 0),
    );
    remainingPhysicalAffix -= physicalAffix;
    remainingMagicAffix -= magicAffix;
    remainingDefenseAffix -= defenseAffix;
    remainingHpAffix -= hpAffix;
    remainingMpAffix -= mpAffix;
    remainingAbsorptionAffix -= absorptionAffix;
    remainingDropRateAffix -= dropRateAffix;
    remainingExperienceAffix -= experienceAffix;
    remainingMpCostReductionAffix -= mpCostReductionAffix;
    remainingCooldownReductionAffix -= cooldownReductionAffix;
    dynamicByInventorySlot.set(item.stored.inventorySlot, {
      attackDamageBonus: item.baseStats.physicalDamage + physicalAffix,
      magicAttackBonus: item.baseStats.magicAttack,
      magicAttackBps: magicAffix,
      defenseBonus: item.baseStats.physicalDefense + defenseAffix,
      maxHpBonus: item.baseStats.maxHp + hpAffix,
      maxMpBonus: item.baseStats.maxMp + mpAffix,
      absorptionBps: absorptionAffix,
      dropRateBps: dropRateAffix,
      experienceBonusBps: experienceAffix,
      mpCostReductionBps: mpCostReductionAffix,
      cooldownReductionBps: cooldownReductionAffix,
    });
  }
  const equipment = storedEquipment.map((stored) => {
    const entry = entriesById.get(stored.catalogItemId);
    const item = inventory.find(({ slot }) => slot === stored.inventorySlot);
    if (!entry?.enabled || !entry.properties.equipment || !item) {
      throw new Error("O vínculo de equipamento aponta para item indisponível.");
    }
    const definition = entry.properties.equipment;
    if (
      CARACATOA_EQUIPMENT_SLOTS.indexOf(definition.slot) !== stored.equipmentSlot ||
      !definition.allowedClassIds.includes(classId) ||
      (item.stackCount || entry.properties.stackCount) !== 1
    ) {
      throw new Error("Equipamento persistido incompatível com o personagem.");
    }
    const dynamicBonuses = dynamicByInventorySlot.get(stored.inventorySlot);
    return {
      equipmentSlot: stored.equipmentSlot,
      inventorySlot: stored.inventorySlot,
      clientItemId: entry.properties.clientItemId,
      attackDamageBonus:
        dynamicBonuses?.attackDamageBonus ?? definition.attackDamageBonus,
      magicAttackBonus: dynamicBonuses?.magicAttackBonus ?? 0,
      magicAttackBps: dynamicBonuses?.magicAttackBps ?? 0,
      defenseBonus: dynamicBonuses?.defenseBonus ?? definition.defenseBonus,
      maxHpBonus: dynamicBonuses?.maxHpBonus ?? 0,
      maxMpBonus: dynamicBonuses?.maxMpBonus ?? 0,
      absorptionBps: dynamicBonuses?.absorptionBps ?? 0,
      dropRateBps: dynamicBonuses?.dropRateBps ?? 0,
      experienceBonusBps: dynamicBonuses?.experienceBonusBps ?? 0,
      mpCostReductionBps: dynamicBonuses?.mpCostReductionBps ?? 0,
      cooldownReductionBps: dynamicBonuses?.cooldownReductionBps ?? 0,
    };
  });
  return { equipment, bonuses: getWyd727EquipmentCombatBonuses(equipment) };
}

export function applyCaracatoaEquipmentRequest({
  accountStore,
  accountId,
  characterSlot,
  classId,
  equipmentSlot,
  inventorySlot,
  catalog,
  itemizationConfig = null,
}) {
  validateWyd727ItemCatalog(catalog);
  if (!accountStore || typeof accountStore.setCharacterEquipment !== "function") {
    throw new TypeError("accountStore não oferece troca persistente de equipamento.");
  }
  const slotDefinition = CARACATOA_EQUIPMENT_SLOTS[equipmentSlot];
  if (!slotDefinition || !inRange(characterSlot, 0, 3) || !inRange(classId, 0, 3)) {
    throw new RangeError("Pedido de equipamento inválido.");
  }

  if (inventorySlot !== 0xff) {
    const inventory = accountStore.initializeCharacterInventory(
      accountId,
      characterSlot,
      getWyd727StarterInventoryItems(catalog),
    );
    const storedItem = inventory?.find(({ slot }) => slot === inventorySlot);
    if (!storedItem) return { accepted: false, reason: "empty-slot" };
    const entry = catalog.entries.find(({ id }) => id === storedItem.catalogItemId);
    const equipment = entry?.enabled ? entry.properties.equipment : null;
    if (!equipment) return { accepted: false, reason: "not-equipment" };
    if (!equipment.allowedClassIds.includes(classId)) {
      return { accepted: false, reason: "wrong-class" };
    }
    if (CARACATOA_EQUIPMENT_SLOTS.indexOf(equipment.slot) !== equipmentSlot) {
      return { accepted: false, reason: "wrong-equipment-slot" };
    }
    if ((storedItem.stackCount || entry.properties.stackCount) !== 1) {
      return { accepted: false, reason: "stacked-item" };
    }
    if (equipment.itemizationType) {
      if (!itemizationConfig) return { accepted: false, reason: "itemization-unavailable" };
      const character = accountStore.getCharacterBySlot?.(accountId, characterSlot);
      if (!character) return { accepted: false, reason: "character-unavailable" };
      const detail = (
        accountStore.getCharacterItemizationDetails?.(accountId, characterSlot) ?? []
      )
        .find((item) => item.slot === inventorySlot);
      if (!detail) return { accepted: false, reason: "item-instance-unavailable" };
      if (detail.itemLevel > character.level) return { accepted: false, reason: "item-level-too-high" };
      try {
        resolveItemizedEquipmentBonuses({
          entry,
          stored: { inventorySlot, catalogItemId: storedItem.catalogItemId },
          detail,
          itemizationConfig,
          characterLevel: character.level,
        });
      } catch {
        return { accepted: false, reason: "invalid-item-instance" };
      }
    }
  }

  const stored = accountStore.setCharacterEquipment({
    accountId,
    characterSlot,
    equipmentSlot,
    inventorySlot: inventorySlot === 0xff ? null : inventorySlot,
  });
  if (!stored?.accepted) {
    return { accepted: false, reason: stored?.reason ?? "character-unavailable" };
  }
  const current = resolveCaracatoaCharacterEquipment({
    accountStore,
    accountId,
    characterSlot,
    classId,
    catalog,
    itemizationConfig,
  });
  return { accepted: true, ...current };
}

function resolveItemizedEquipmentBonuses({
  entry,
  stored,
  detail,
  itemizationConfig,
  characterLevel,
}) {
  if (!detail || !itemizationConfig) throw new Error("Instância itemizada ausente.");
  const itemizationType = entry.properties.equipment.itemizationType;
  const template = itemizationConfig.itemTemplates.find(({ id }) => id === detail.catalogItemId);
  if (
    !template ||
    template.id !== entry.id ||
    template.itemType !== itemizationType ||
    itemizationConfig.itemTypes[itemizationType]?.equipmentSlot !==
      entry.properties.equipment.slot ||
    template.clientItemId !== entry.properties.clientItemId ||
    detail.clientItemId !== template.clientItemId ||
    detail.catalogItemId !== stored.catalogItemId ||
    detail.slot !== stored.inventorySlot ||
    detail.itemLevel > characterLevel
  ) {
    throw new Error("Instância itemizada não corresponde ao item equipado.");
  }
  const expectedBaseStats = calculateBaseItemStats(
    itemizationConfig,
    itemizationType,
    detail.itemLevel,
    detail.rarity,
  );
  if (
    JSON.stringify(detail.baseStats) !== JSON.stringify(expectedBaseStats)
  ) {
    throw new Error("Stats-base persistidos não correspondem ao catálogo de itemização.");
  }
  aggregateItemAffixes([{
    ...detail,
    itemType: itemizationType,
    isEquipped: true,
  }], itemizationConfig);
  const refinementLevel = detail.refinementLevel ?? 0;
  if (!inRange(refinementLevel, 0, 15)) {
    throw new Error("Nível de refinamento persistido fora do intervalo.");
  }
  const refinementMultiplierBps = 10_000 +
    refinementLevel * 350;
  const refinedBaseStats = Object.fromEntries(
    Object.entries(expectedBaseStats).map(([stat, value]) => [
      stat,
      value === 0 ? 0 : Math.floor(value * refinementMultiplierBps / 10_000),
    ]),
  );
  return {
    stored,
    detail,
    itemType: itemizationType,
    refinementLevel,
    baseStats: refinedBaseStats,
  };
}
