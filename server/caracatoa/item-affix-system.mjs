import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";

const BASIS = 10_000;
const RARITY_IDS = ["normal", "mystic", "arcane", "legendary", "ancient"];
const EQUIPMENT_SLOTS = new Set(["weapon", "head", "chest", "legs", "feet", "accessory"]);

function assertInt(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} precisa estar entre ${min} e ${max}.`);
  }
}

function draw(randomInt, min, max) {
  const value = randomInt(min, max);
  assertInt(value, min, max, "resultado aleatório");
  return value;
}

function secureRandomInt(min, max) {
  return cryptoRandomInt(min, max + 1);
}

function resolveRandom(randomInt) {
  if (randomInt === undefined) return secureRandomInt;
  if (typeof randomInt !== "function") {
    throw new TypeError("randomInt precisa ser uma função inclusiva (min, max).");
  }
  return randomInt;
}

function requireDefinition(table, key, label) {
  const value = table?.[key];
  if (!value || typeof value !== "object") {
    throw new Error(`${label} desconhecido: ${key}.`);
  }
  return value;
}

function weightedChoice(entries, weightOf, randomInt) {
  const eligible = entries.filter((entry) => weightOf(entry) > 0);
  const total = eligible.reduce((sum, entry) => sum + weightOf(entry), 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error("A tabela ponderada não possui pesos positivos.");
  }
  let cursor = draw(randomInt, 1, total);
  for (const entry of eligible) {
    cursor -= weightOf(entry);
    if (cursor <= 0) return entry;
  }
  throw new Error("Falha ao resolver a tabela ponderada.");
}

export function validateItemizationConfig(config) {
  if (
    !config ||
    config.schemaVersion !== 1 ||
    config.kind !== "itemization" ||
    config.balanceVersion !== "caracatoa-itemization-v1"
  ) {
    throw new Error("Cabeçalho do catálogo de itemização inválido.");
  }
  if (Object.keys(config.rarities ?? {}).length !== RARITY_IDS.length) {
    throw new Error("O catálogo precisa declarar as cinco raridades Caracatoa.");
  }
  const levelRules = config.levelRules;
  assertInt(levelRules?.minimum, 1, 400, "levelRules.minimum");
  assertInt(levelRules?.maximum, levelRules.minimum, 400, "levelRules.maximum");
  assertInt(levelRules?.affixReferenceLevel, levelRules.minimum, levelRules.maximum, "levelRules.affixReferenceLevel");
  assertInt(levelRules?.affixScaleBaseBps, 0, 100_000, "levelRules.affixScaleBaseBps");
  assertInt(levelRules?.affixScalePerLevelBps, 0, 10_000, "levelRules.affixScalePerLevelBps");
  assertInt(levelRules?.affixScaleCapBps, levelRules.affixScaleBaseBps, 100_000, "levelRules.affixScaleCapBps");
  assertInt(levelRules?.itemLevelFromMonsterLevelBps, 1, BASIS, "levelRules.itemLevelFromMonsterLevelBps");
  assertInt(levelRules?.minimumItemLevel, levelRules.minimum, levelRules.maximum, "levelRules.minimumItemLevel");
  assertInt(levelRules?.maximumItemLevel, levelRules.minimumItemLevel, levelRules.maximum, "levelRules.maximumItemLevel");
  const dropRules = config.dropRules;
  assertInt(dropRules?.luckBonusCapBps, 0, 2_500, "dropRules.luckBonusCapBps");
  assertInt(dropRules?.equipmentChanceCapBps, 0, BASIS, "dropRules.equipmentChanceCapBps");
  assertInt(dropRules?.itemChanceCapBps, 0, BASIS, "dropRules.itemChanceCapBps");
  assertInt(dropRules?.maximumGeneratedDropsPerKill, 1, 10, "dropRules.maximumGeneratedDropsPerKill");
  if (!config.globalStatCaps || typeof config.globalStatCaps !== "object" || Array.isArray(config.globalStatCaps)) {
    throw new Error("O catálogo precisa declarar hard caps globais por stat.");
  }
  for (const [stat, cap] of Object.entries(config.globalStatCaps)) {
    assertInt(cap, 0, 100_000, `globalStatCaps.${stat}`);
  }
  for (const rarityId of RARITY_IDS) {
    const rarity = requireDefinition(config.rarities, rarityId, "Raridade");
    assertInt(rarity.baseStatMultiplierBps, BASIS, 20_000, `${rarityId}.baseStatMultiplierBps`);
    assertInt(rarity.affixCount?.min, 0, 4, `${rarityId}.affixCount.min`);
    assertInt(rarity.affixCount?.max, rarity.affixCount.min, 4, `${rarityId}.affixCount.max`);
  }
  for (const [profileId, profile] of Object.entries(config.monsterProfiles ?? {})) {
    assertInt(profile.dropMultiplierBps, 0, 100_000, `${profileId}.dropMultiplierBps`);
    assertInt(profile.maxAffixValueRollBps, 0, BASIS, `${profileId}.maxAffixValueRollBps`);
    const weightTotal = RARITY_IDS.reduce(
      (sum, rarityId) => sum + (profile.rarityWeights?.[rarityId] ?? 0),
      0,
    );
    if (weightTotal !== BASIS) {
      throw new Error(`${profileId}.rarityWeights precisa somar 10000 BP.`);
    }
    for (const rarityId of RARITY_IDS) {
      assertInt(profile.rarityWeights[rarityId], 0, BASIS, `${profileId}.${rarityId}`);
    }
  }
  for (const [zoneId, zone] of Object.entries(config.zoneProfiles ?? {})) {
    assertInt(zone.dropMultiplierBps, 0, 100_000, `${zoneId}.dropMultiplierBps`);
    assertInt(zone.maxAffixValueRollBonusBps, 0, BASIS, `${zoneId}.maxAffixValueRollBonusBps`);
    for (const [monsterId, monster] of Object.entries(config.monsterProfiles)) {
      const deltas = zone.rarityWeightDeltaByMonsterProfile?.[monsterId] ?? {};
      const adjustedTotal = RARITY_IDS.reduce(
        (sum, rarityId) =>
          sum +
          (monster.rarityWeights[rarityId] ?? 0) +
          (deltas[rarityId] ?? 0),
        0,
      );
      if (adjustedTotal !== BASIS) {
        throw new Error(`${zoneId}/${monsterId} rarity weights precisam somar 10000 BP.`);
      }
      for (const rarityId of RARITY_IDS) {
        const adjusted =
          (monster.rarityWeights[rarityId] ?? 0) +
          (deltas[rarityId] ?? 0);
        if (!Number.isSafeInteger(adjusted) || adjusted < 0 || adjusted > BASIS) {
          throw new Error(`${zoneId}/${rarityId} produz peso fora do intervalo.`);
        }
      }
    }
  }
  for (const [typeId, type] of Object.entries(config.itemTypes ?? {})) {
    if (!type.baseStatsAt100 || Object.values(type.baseStatsAt100).length === 0) {
      throw new Error(`${typeId} precisa declarar stats-base no nível 100.`);
    }
    if (!EQUIPMENT_SLOTS.has(type.equipmentSlot)) {
      throw new Error(`${typeId}.equipmentSlot não corresponde a um slot equipado pelo cliente.`);
    }
    for (const [stat, value] of Object.entries(type.baseStatsAt100)) {
      assertInt(value, 0, 1_000_000, `${typeId}.${stat}`);
    }
  }
  const affixIds = new Set();
  const clientAffixIds = new Set();
  for (const affix of config.affixes ?? []) {
    if (!affix?.id || affixIds.has(affix.id)) {
      throw new Error(`ID de afixo ausente ou duplicado: ${affix?.id}.`);
    }
    affixIds.add(affix.id);
    assertInt(affix.clientAffixId, 1, 255, `${affix.id}.clientAffixId`);
    if (clientAffixIds.has(affix.clientAffixId)) {
      throw new Error(`clientAffixId duplicado: ${affix.clientAffixId}.`);
    }
    clientAffixIds.add(affix.clientAffixId);
    if (!Array.isArray(affix.allowedTypes) || affix.allowedTypes.length === 0) {
      throw new Error(`${affix.id} precisa declarar tipos de item compatíveis.`);
    }
    for (const itemType of affix.allowedTypes) {
      if (!config.itemTypes?.[itemType]) {
        throw new Error(`${affix.id} referencia tipo de item inválido: ${itemType}.`);
      }
    }
    if (!Number.isSafeInteger(affix.weight) || affix.weight < 1) {
      throw new Error(`${affix.id}.weight precisa ser inteiro positivo.`);
    }
    if (!Object.hasOwn(config.globalStatCaps, affix.stat)) {
      throw new Error(`Falta hard cap global para ${affix.stat}.`);
    }
    assertInt(affix.minValue, 0, 100_000, `${affix.id}.minValue`);
    assertInt(affix.maxValue, affix.minValue, 100_000, `${affix.id}.maxValue`);
    assertInt(affix.hardCapPerItem, affix.maxValue, 100_000, `${affix.id}.hardCapPerItem`);
    if (affix.hardCapPerItem > config.globalStatCaps[affix.stat]) {
      throw new Error(`${affix.id}.hardCapPerItem excede o cap agregado de ${affix.stat}.`);
    }
  }
  const maxAffixCount = Math.max(
    ...RARITY_IDS.map((rarityId) => config.rarities[rarityId].affixCount.max),
  );
  for (const [itemType, type] of Object.entries(config.itemTypes ?? {})) {
    const uniqueStatCount = new Set(
      config.affixes
        .filter((affix) => affix.allowedTypes.includes(itemType))
        .map((affix) => affix.stat),
    ).size;
    if (uniqueStatCount < maxAffixCount) {
      throw new Error(`${itemType} não possui afixos únicos suficientes para a raridade máxima.`);
    }
  }
  const templateIds = new Set();
  const clientItemIds = new Set();
  for (const template of config.itemTemplates ?? []) {
    if (!template?.id || templateIds.has(template.id)) {
      throw new Error(`Template ausente ou duplicado: ${template?.id}.`);
    }
    templateIds.add(template.id);
    assertInt(template.clientItemId, 1, 65_535, `${template.id}.clientItemId`);
    if (clientItemIds.has(template.clientItemId)) {
      throw new Error(`clientItemId duplicado: ${template.clientItemId}.`);
    }
    clientItemIds.add(template.clientItemId);
    if (!config.itemTypes?.[template.itemType]) {
      throw new Error(`${template.id} referencia tipo de item inexistente.`);
    }
    assertInt(template.minItemLevel, levelRules.minimumItemLevel, levelRules.maximumItemLevel, `${template.id}.minItemLevel`);
    assertInt(template.maxItemLevel, template.minItemLevel, levelRules.maximumItemLevel, `${template.id}.maxItemLevel`);
    assertInt(template.dropWeight, 1, 1_000_000, `${template.id}.dropWeight`);
  }
  for (const [itemId, item] of Object.entries(config.itemDefinitions ?? {})) {
    assertInt(item.clientItemId, 1, 65_535, `${itemId}.clientItemId`);
    if (clientItemIds.has(item.clientItemId)) {
      throw new Error(`clientItemId duplicado: ${item.clientItemId}.`);
    }
    clientItemIds.add(item.clientItemId);
    assertInt(item.stackLimit, 1, 500, `${itemId}.stackLimit`);
    assertInt(item.stackCount, 1, item.stackLimit, `${itemId}.stackCount`);
  }
  for (const [poolId, itemIds] of Object.entries(config.itemPools ?? {})) {
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new Error(`Pool de itens vazio ou inválido: ${poolId}.`);
    }
    for (const itemId of itemIds) {
      if (!config.itemTemplates?.some((template) => template.id === itemId)) {
        throw new Error(`Template ${itemId} referenciado pelo pool ${poolId} não existe.`);
      }
    }
  }
  for (const [tableId, table] of Object.entries(config.lootTables ?? {})) {
    requireDefinition(config.monsterProfiles, table.monsterProfile, `${tableId}.monsterProfile`);
    requireDefinition(config.zoneProfiles, table.zoneProfile, `${tableId}.zoneProfile`);
    requireDefinition(config.itemPools, table.itemPool, `${tableId}.itemPool`);
    if (!Array.isArray(table.entries) || table.entries.length === 0) {
      throw new Error(`${tableId} precisa conter drops.`);
    }
    assertInt(table.maxDropsPerKill, 1, 10, `${tableId}.maxDropsPerKill`);
    for (const entry of table.entries) {
      if (entry.kind !== "equipment" && entry.kind !== "item") {
        throw new Error(`${tableId} contém um tipo de drop desconhecido.`);
      }
      assertInt(entry.baseChanceBps, 0, BASIS, `${tableId}.baseChanceBps`);
      if (entry.kind === "item") {
        const item = requireDefinition(config.itemDefinitions, entry.itemId, `${tableId}.itemId`);
        assertInt(entry.minCount, 1, 500, `${tableId}.minCount`);
        assertInt(entry.maxCount, entry.minCount, 500, `${tableId}.maxCount`);
        if (entry.maxCount > item.stackLimit) {
          throw new Error(`${tableId}/${entry.itemId} pode exceder o limite de pilha.`);
        }
      }
    }
  }
  for (const [monsterCatalogId, tableId] of Object.entries(
    config.monsterLootTableAssignments ?? {},
  )) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(monsterCatalogId)) {
      throw new Error(`ID de monstro inválido no mapeamento de loot: ${monsterCatalogId}.`);
    }
    requireDefinition(config.lootTables, tableId, `${monsterCatalogId}.lootTable`);
  }
  return true;
}

export function calculateItemDropChanceBps({
  baseChanceBps,
  monsterMultiplierBps,
  zoneMultiplierBps,
  luckBonusBps = 0,
  chanceCapBps = 10_000,
}) {
  assertInt(baseChanceBps, 0, BASIS, "baseChanceBps");
  assertInt(monsterMultiplierBps, 0, 100_000, "monsterMultiplierBps");
  assertInt(zoneMultiplierBps, 0, 100_000, "zoneMultiplierBps");
  assertInt(luckBonusBps, 0, 2_500, "luckBonusBps");
  assertInt(chanceCapBps, 0, BASIS, "chanceCapBps");

  const numerator =
    BigInt(baseChanceBps) *
    BigInt(monsterMultiplierBps) *
    BigInt(zoneMultiplierBps) *
    BigInt(BASIS + luckBonusBps);
  const denominator = BigInt(BASIS) ** 3n;
  const result = Number(numerator / denominator);
  return Math.min(chanceCapBps, result);
}

export function calculateAffixScaleBps(config, itemLevel) {
  const rules = config.levelRules;
  assertInt(itemLevel, rules.minimum, rules.maximum, "itemLevel");
  return Math.min(
    rules.affixScaleCapBps,
    rules.affixScaleBaseBps + (itemLevel - 1) * rules.affixScalePerLevelBps,
  );
}

export function calculateBaseItemStats(config, itemType, itemLevel, rarityId) {
  const type = requireDefinition(config.itemTypes, itemType, "Tipo de item");
  const rarity = requireDefinition(config.rarities, rarityId, "Raridade");
  assertInt(itemLevel, config.levelRules.minimum, config.levelRules.maximum, "itemLevel");
  const multiplier = rarity.baseStatMultiplierBps;
  return Object.fromEntries(
    Object.entries(type.baseStatsAt100).map(([stat, valueAt100]) => [
      stat,
      valueAt100 === 0
        ? 0
        : Math.max(1, Math.floor((valueAt100 * itemLevel * multiplier) / (100 * BASIS))),
    ]),
  );
}

function effectiveRarityWeights(monsterProfileId, monsterProfile, zoneProfile) {
  const deltas = zoneProfile.rarityWeightDeltaByMonsterProfile?.[monsterProfileId] ?? {};
  const weights = {};
  for (const rarityId of RARITY_IDS) {
    weights[rarityId] = Math.max(
      0,
      (monsterProfile.rarityWeights?.[rarityId] ?? 0) +
        (deltas[rarityId] ?? 0),
    );
  }
  return weights;
}

function rollAffixValue(affix, itemLevel, maxRollChanceBps, randomInt, config) {
  const isPerfect = draw(randomInt, 1, BASIS) <= maxRollChanceBps;
  const rawValue = isPerfect
    ? affix.maxValue
    : draw(randomInt, affix.minValue, Math.max(affix.minValue, affix.maxValue - 1));
  const scale = calculateAffixScaleBps(config, itemLevel);
  return Math.min(
    affix.hardCapPerItem,
    Math.floor((rawValue * scale) / BASIS),
  );
}

export function rollAffixes({
  config,
  itemType,
  itemLevel,
  rarityId,
  maxRollChanceBps,
  randomInt: randomIntInput,
}) {
  validateItemizationConfig(config);
  const randomInt = resolveRandom(randomIntInput);
  const rarity = requireDefinition(config.rarities, rarityId, "Raridade");
  const compatible = config.affixes.filter((affix) => affix.allowedTypes.includes(itemType));
  const targetCount = draw(randomInt, rarity.affixCount.min, rarity.affixCount.max);
  if (compatible.length < targetCount) {
    throw new Error(`O tipo ${itemType} não possui afixos únicos suficientes para ${rarityId}.`);
  }

  const candidates = [...compatible];
  const affixes = [];
  for (let index = 0; index < targetCount; index += 1) {
    const affix = weightedChoice(candidates, (entry) => entry.weight, randomInt);
    for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      if (candidates[candidateIndex].stat === affix.stat) candidates.splice(candidateIndex, 1);
    }
    affixes.push({
      id: affix.id,
      clientAffixId: affix.clientAffixId,
      name: affix.name,
      position: affix.position,
      stat: affix.stat,
      value: rollAffixValue(affix, itemLevel, maxRollChanceBps, randomInt, config),
      valueUnit: affix.stat.endsWith("Bps") ? "basis-points" : "flat",
    });
  }
  return affixes;
}

function createEquipmentInstance({
  config,
  poolId,
  monsterProfileId,
  monsterLevel,
  monsterProfile,
  zoneProfile,
  randomInt,
  idFactory,
}) {
  const itemIds = config.itemPools[poolId];
  const itemLevelTarget = Math.max(
    config.levelRules.minimumItemLevel,
    Math.floor((monsterLevel * config.levelRules.itemLevelFromMonsterLevelBps) / BASIS),
  );
  const candidates = itemIds
    .map((id) => config.itemTemplates.find((template) => template.id === id))
    .filter((template) =>
      template &&
      template.minItemLevel <= itemLevelTarget &&
      template.maxItemLevel >= template.minItemLevel,
    );
  if (candidates.length === 0) return null;

  const template = weightedChoice(candidates, (entry) => entry.dropWeight, randomInt);
  const itemLevel = Math.min(itemLevelTarget, template.maxItemLevel);
  const rarityWeights = effectiveRarityWeights(monsterProfileId, monsterProfile, zoneProfile);
  const rarityId = weightedChoice(
    RARITY_IDS,
    (entry) => rarityWeights[entry],
    randomInt,
  );
  const baseStats = calculateBaseItemStats(config, template.itemType, itemLevel, rarityId);
  const affixes = rollAffixes({
    config,
    itemType: template.itemType,
    itemLevel,
    catalogVersion: config.balanceVersion,
    rarityId,
    maxRollChanceBps: Math.min(
      BASIS,
      monsterProfile.maxAffixValueRollBps + zoneProfile.maxAffixValueRollBonusBps,
    ),
    randomInt,
  });
  const prefixes = affixes.filter((affix) => affix.position === "prefix").map((affix) => affix.name);
  const suffixes = affixes.filter((affix) => affix.position === "suffix").map((affix) => affix.name);
  return {
    instanceId: idFactory(),
    catalogItemId: template.id,
    clientItemId: template.clientItemId,
    displayName: [prefixes.join(" "), template.name, suffixes.join(" ")].filter(Boolean).join(" "),
    itemType: template.itemType,
    requiredLevel: itemLevel,
    itemLevel,
    rarity: rarityId,
    baseStats,
    affixes,
    isEquipped: false,
    refinementLevel: 0,
    origin: "monster-drop",
  };
}

export function rollMonsterLoot({
  config,
  lootTableId,
  monsterLevel,
  playerLuckBonusBps = 0,
  randomInt: randomIntInput,
  idFactory = randomUUID,
}) {
  validateItemizationConfig(config);
  const randomInt = resolveRandom(randomIntInput);
  assertInt(monsterLevel, config.levelRules.minimum, config.levelRules.maximum, "monsterLevel");
  assertInt(playerLuckBonusBps, 0, config.dropRules.luckBonusCapBps, "playerLuckBonusBps");
  const table = requireDefinition(config.lootTables, lootTableId, "Loot table");
  const monsterProfile = requireDefinition(config.monsterProfiles, table.monsterProfile, "Perfil de monstro");
  const zoneProfile = requireDefinition(config.zoneProfiles, table.zoneProfile, "Perfil de zona");
  const results = [];

  const orderedEntries = [
    ...table.entries.filter((entry) => entry.kind === "equipment"),
    ...table.entries.filter((entry) => entry.kind !== "equipment"),
  ];
  for (const entry of orderedEntries) {
    if (results.length >= Math.min(table.maxDropsPerKill, config.dropRules.maximumGeneratedDropsPerKill)) break;
    const chanceBps = calculateItemDropChanceBps({
      baseChanceBps: entry.baseChanceBps,
      monsterMultiplierBps: monsterProfile.dropMultiplierBps,
      zoneMultiplierBps: zoneProfile.dropMultiplierBps,
      luckBonusBps: playerLuckBonusBps,
      chanceCapBps: entry.kind === "equipment"
        ? config.dropRules.equipmentChanceCapBps
        : config.dropRules.itemChanceCapBps,
    });
    if (draw(randomInt, 1, BASIS) > chanceBps) continue;

    if (entry.kind === "equipment") {
      const instance = createEquipmentInstance({
        config,
        poolId: table.itemPool,
        monsterProfileId: table.monsterProfile,
        monsterLevel,
        monsterProfile,
        zoneProfile,
        randomInt,
        idFactory,
      });
      if (instance) results.push({ kind: "equipment", chanceBps, instance });
      continue;
    }
    const item = requireDefinition(config.itemDefinitions, entry.itemId, "Item de loot");
    const quantity = draw(randomInt, entry.minCount, entry.maxCount);
    results.push({
      kind: "item",
      chanceBps,
      itemId: entry.itemId,
      clientItemId: item.clientItemId,
      displayName: item.displayName,
      stackCount: item.stackCount,
      stackLimit: item.stackLimit,
      quantity,
    });
  }
  return results;
}

export function aggregateItemAffixes(instances, config) {
  if (!Array.isArray(instances)) throw new TypeError("instances precisa ser um array.");
  validateItemizationConfig(config);
  const totals = Object.fromEntries(
    Object.keys(config.globalStatCaps).map((stat) => [stat, 0]),
  );
  for (const instance of instances) {
    if (!instance?.isEquipped) continue;
    if (!config.itemTypes?.[instance.itemType]) {
      throw new Error(`Tipo inválido em item ${instance.instanceId ?? "sem ID"}.`);
    }
    const rarity = requireDefinition(config.rarities, instance.rarity, "Raridade");
    if (
      !Array.isArray(instance.affixes) ||
      instance.affixes.length < rarity.affixCount.min ||
      instance.affixes.length > rarity.affixCount.max
    ) {
      throw new Error(`Quantidade de afixos inválida em item ${instance.instanceId ?? "sem ID"}.`);
    }
    const affixIds = new Set();
    const affixStats = new Set();
    for (const affix of instance.affixes ?? []) {
      const definition = config.affixes.find((candidate) => candidate.id === affix.id);
      if (
        !definition ||
        definition.stat !== affix.stat ||
        !definition.allowedTypes.includes(instance.itemType) ||
        affix.clientAffixId !== definition.clientAffixId ||
        affix.valueUnit !== (affix.stat.endsWith("Bps") ? "basis-points" : "flat") ||
        !Object.hasOwn(totals, affix.stat) ||
        !Number.isSafeInteger(affix.value) ||
        affix.value < 0 ||
        affix.value > definition.hardCapPerItem ||
        affixIds.has(affix.id) ||
        affixStats.has(affix.stat)
      ) {
        throw new Error(`Afixo inválido em item ${instance.instanceId ?? "sem ID"}.`);
      }
      affixIds.add(affix.id);
      affixStats.add(affix.stat);
      totals[affix.stat] += affix.value;
    }
  }
  for (const [stat, cap] of Object.entries(config.globalStatCaps)) {
    totals[stat] = Math.min(totals[stat], cap);
  }
  return totals;
}
