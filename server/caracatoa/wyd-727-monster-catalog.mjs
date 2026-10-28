import { validateWyd727ClassWorldStats } from "./wyd-727-class-catalog.mjs";

const MAX_VISIBLE_MONSTERS = 60;
const MOB_FRAME_LENGTH = 256;
const MOB_BODY_LENGTH = MOB_FRAME_LENGTH - 4;
const NPC_BODY_MODEL_OVERRIDES = new Set([
  0x33, 0x36, 0x37, 0x38, 0x39, 0x43, 0x44,
]);
const MONSTER_PROPERTY_KEYS = [
  "clientEntityId",
  "equipModelIds",
  "spawnPosition",
  "level",
  "startingStats",
];

export const EMPTY_WYD727_MONSTER_CATALOG = Object.freeze({
  schemaVersion: 1,
  kind: "monsters",
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

function validateMonsterEntry(entry, seenIds, seenEntityIds) {
  assertExactKeys(
    entry,
    ["id", "name", "description", "enabled", "properties"],
    "registro de monstro",
  );
  if (
    typeof entry.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.id)
  ) {
    throw new Error("id Caracatoa de monstro inválido.");
  }
  if (seenIds.has(entry.id)) throw new Error(`id duplicado: ${entry.id}.`);
  seenIds.add(entry.id);
  if (
    typeof entry.name !== "string" ||
    !/^[A-Za-z0-9 _-]{1,15}$/.test(entry.name)
  ) {
    throw new Error("name de monstro precisa ter de 1 a 15 bytes ASCII.");
  }
  if (
    typeof entry.description !== "string" ||
    entry.description.length > 2048
  ) {
    throw new Error("description de monstro inválida.");
  }
  if (typeof entry.enabled !== "boolean") {
    throw new Error("enabled de monstro precisa ser booleano.");
  }
  const propertyKeys = [...MONSTER_PROPERTY_KEYS];
  if (Object.hasOwn(entry.properties ?? {}, "drop")) propertyKeys.push("drop");
  assertExactKeys(entry.properties, propertyKeys, "properties de monstro");
  const properties = entry.properties;
  assertInteger(properties.clientEntityId, 1000, 0xffff, "clientEntityId");
  if (seenEntityIds.has(properties.clientEntityId)) {
    throw new Error(`clientEntityId duplicado: ${properties.clientEntityId}.`);
  }
  seenEntityIds.add(properties.clientEntityId);
  if (
    !Array.isArray(properties.equipModelIds) ||
    properties.equipModelIds.length !== 16
  ) {
    throw new Error("equipModelIds precisa conter exatamente 16 IDs.");
  }
  properties.equipModelIds.forEach((modelId, index) => {
    assertInteger(
      modelId,
      index === 0 ? 1 : 0,
      0xffff,
      `equipModelIds[${index}]`,
    );
  });
  if (NPC_BODY_MODEL_OVERRIDES.has(properties.equipModelIds[0])) {
    throw new Error(
      "equipModelIds[0] é reservado pelo discriminador de NPC do cliente.",
    );
  }
  assertExactKeys(properties.spawnPosition, ["x", "y"], "spawnPosition");
  assertInteger(properties.spawnPosition.x, -0x8000, 0x7fff, "spawnPosition.x");
  assertInteger(properties.spawnPosition.y, -0x8000, 0x7fff, "spawnPosition.y");
  assertInteger(properties.level, 1, 0x7fffffff, "level");
  validateWyd727ClassWorldStats(properties.startingStats);
  if (properties.startingStats.merchant !== 0) {
    throw new Error(
      "startingStats.merchant precisa ser 0 para classificar como monstro.",
    );
  }
  if (properties.startingStats.currentHp < 1) {
    throw new Error("startingStats.currentHp precisa ser maior que zero.");
  }
  if (Object.hasOwn(properties, "drop")) {
    assertExactKeys(
      properties.drop,
      ["catalogItemId", "quantity", "chanceBasisPoints"],
      "drop de monstro",
    );
    if (
      typeof properties.drop.catalogItemId !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(properties.drop.catalogItemId)
    ) {
      throw new Error("catalogItemId do drop de monstro inválido.");
    }
    assertInteger(properties.drop.quantity, 1, 500, "drop.quantity");
    assertInteger(
      properties.drop.chanceBasisPoints,
      0,
      10_000,
      "drop.chanceBasisPoints",
    );
  }
}

export function validateWyd727MonsterCatalog(catalog) {
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "monsters" ||
    !Array.isArray(catalog.entries)
  ) {
    throw new Error("Cabeçalho do catálogo de monstros inválido.");
  }
  const seenIds = new Set();
  const seenEntityIds = new Set();
  let enabledCount = 0;
  for (const entry of catalog.entries) {
    validateMonsterEntry(entry, seenIds, seenEntityIds);
    if (entry.enabled) enabledCount += 1;
  }
  if (enabledCount > MAX_VISIBLE_MONSTERS) {
    throw new Error("No máximo 60 monstros podem ficar habilitados.");
  }
  return catalog;
}

export function getWyd727MonstersForWorld(
  catalog,
  playerPosition,
  walkability,
) {
  validateWyd727MonsterCatalog(catalog);
  assertExactKeys(playerPosition, ["x", "y"], "playerPosition");
  assertInteger(playerPosition.x, -0x8000, 0x7fff, "playerPosition.x");
  assertInteger(playerPosition.y, -0x8000, 0x7fff, "playerPosition.y");
  if (typeof walkability?.isWalkablePosition !== "function") {
    throw new Error("Grade de caminhabilidade não está disponível.");
  }
  return catalog.entries
    .filter(
      (entry) =>
        entry.enabled &&
        Math.abs(entry.properties.spawnPosition.x - playerPosition.x) <= 6 &&
        Math.abs(entry.properties.spawnPosition.y - playerPosition.y) <= 6,
    )
    .sort(
      (left, right) =>
        left.properties.clientEntityId - right.properties.clientEntityId,
    )
    .map((entry) => {
      const { x, y } = entry.properties.spawnPosition;
      if (!walkability.isWalkablePosition(x, y)) {
        throw new Error(`Spawn do monstro ${entry.id} não é caminhável.`);
      }
      return entry;
    });
}

function writeScore(body, offset, level, stats) {
  body.writeInt32LE(level, offset);
  body.writeInt32LE(stats.defense, offset + 4);
  body.writeInt32LE(stats.damage, offset + 8);
  body.writeUInt8(stats.merchant, offset + 12);
  body.writeUInt8(stats.movementSpeed, offset + 13);
  body.writeUInt8(stats.direction, offset + 14);
  body.writeUInt8(stats.chaosRate, offset + 15);
  body.writeInt32LE(stats.maxHp, offset + 16);
  body.writeInt32LE(stats.maxMp, offset + 20);
  body.writeInt32LE(stats.currentHp, offset + 24);
  body.writeInt32LE(stats.currentMp, offset + 28);
  body.writeUInt16LE(stats.str, offset + 32);
  body.writeUInt16LE(stats.int, offset + 34);
  body.writeUInt16LE(stats.dex, offset + 36);
  body.writeUInt16LE(stats.con, offset + 38);
  // The final four UInt16 MScore fields stay zero until their meaning is proven.
}

/** Build the 252-byte WYD body; outer framing makes the client frame 256 bytes. */
export function buildWyd727CreateMobBody({ clientId, timestamp, entry }) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  validateWyd727MonsterCatalog({
    schemaVersion: 1,
    kind: "monsters",
    entries: [entry],
  });
  if (entry.properties.clientEntityId === clientId) {
    throw new Error("clientEntityId do monstro colide com o jogador local.");
  }

  const body = Buffer.alloc(MOB_BODY_LENGTH);
  body.writeUInt16LE(0x364, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeInt16LE(entry.properties.spawnPosition.x, 8);
  body.writeInt16LE(entry.properties.spawnPosition.y, 10);
  body.writeUInt16LE(entry.properties.clientEntityId, 12);
  Buffer.from(entry.name, "ascii").copy(body, 14);
  for (let slot = 0; slot < 16; slot += 1) {
    body.writeUInt16LE(entry.properties.equipModelIds[slot], 30 + slot * 2);
  }
  writeScore(body, 136, entry.properties.level, entry.properties.startingStats);
  return body;
}

export const WYD727_MOB_FRAME_LENGTH = MOB_FRAME_LENGTH;
