import { readFile } from "node:fs/promises";

export const WYD727_CLASS_IDS = Object.freeze([0, 1, 2, 3]);

const STAT_RANGES = Object.freeze({
  defense: [0, 0x7fffffff],
  damage: [0, 0x7fffffff],
  merchant: [0, 0xff],
  movementSpeed: [1, 7],
  direction: [0, 0xff],
  chaosRate: [0, 0xff],
  maxHp: [1, 0x7fffffff],
  maxMp: [1, 0x7fffffff],
  currentHp: [0, 0x7fffffff],
  currentMp: [0, 0x7fffffff],
  str: [0, 0xffff],
  int: [0, 0xffff],
  dex: [0, 0xffff],
  con: [0, 0xffff],
});

export const DEFAULT_WYD727_CLASS_WORLD_STATS = Object.freeze({
  defense: 0,
  damage: 10,
  merchant: 0,
  movementSpeed: 3,
  direction: 0,
  chaosRate: 0,
  maxHp: 100,
  maxMp: 100,
  currentHp: 100,
  currentMp: 100,
  str: 10,
  int: 10,
  dex: 10,
  con: 10,
});

const CLASS_NAMES = Object.freeze([
  "TransKnight",
  "Foema",
  "BeastMaster",
  "Huntress",
]);

export const DEFAULT_WYD727_CLASS_CATALOG = Object.freeze({
  schemaVersion: 1,
  kind: "classes",
  entries: Object.freeze(
    CLASS_NAMES.map((name, classId) =>
      Object.freeze({
        id: String(classId),
        name,
        description: "Classe WYDBot 7.27 com atributos iniciais Caracatoa.",
        enabled: true,
        properties: Object.freeze({
          startingStats: DEFAULT_WYD727_CLASS_WORLD_STATS,
        }),
      }),
    ),
  ),
});

export class Wyd727ClassCatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "Wyd727ClassCatalogError";
  }
}

export function validateWyd727ClassWorldStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    throw new Wyd727ClassCatalogError(
      "properties.startingStats precisa ser um objeto.",
    );
  }

  const keys = Object.keys(stats).sort();
  const expected = Object.keys(STAT_RANGES).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Wyd727ClassCatalogError(
      "startingStats precisa conter exatamente os campos do WYD 7.27.",
    );
  }

  for (const [field, [min, max]] of Object.entries(STAT_RANGES)) {
    if (
      !Number.isInteger(stats[field]) ||
      stats[field] < min ||
      stats[field] > max
    ) {
      throw new Wyd727ClassCatalogError(
        `startingStats.${field} está fora do intervalo do WYD 7.27.`,
      );
    }
  }
  if (stats.currentHp > stats.maxHp || stats.currentMp > stats.maxMp) {
    throw new Wyd727ClassCatalogError(
      "HP/MP atuais não podem superar o máximo.",
    );
  }
  return stats;
}

export function validateWyd727ClassCatalog(catalog) {
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "classes" ||
    !Array.isArray(catalog.entries) ||
    catalog.entries.length !== WYD727_CLASS_IDS.length
  ) {
    throw new Wyd727ClassCatalogError(
      "O catálogo WYD 7.27 precisa conter exatamente as classes de ID 0 a 3.",
    );
  }

  const ids = new Set();
  for (const entry of catalog.entries) {
    const classId = Number(entry?.id);
    if (
      !entry ||
      typeof entry !== "object" ||
      !WYD727_CLASS_IDS.some((id) => entry.id === String(id)) ||
      entry.name !== CLASS_NAMES[classId] ||
      typeof entry.name !== "string" ||
      typeof entry.description !== "string" ||
      typeof entry.enabled !== "boolean" ||
      !entry.properties ||
      typeof entry.properties !== "object" ||
      Array.isArray(entry.properties)
    ) {
      throw new Wyd727ClassCatalogError(
        "Registro de classe WYD 7.27 inválido.",
      );
    }
    if (ids.has(entry.id)) {
      throw new Wyd727ClassCatalogError(`Classe duplicada: ${entry.id}.`);
    }
    ids.add(entry.id);
    validateWyd727ClassWorldStats(entry.properties.startingStats);
  }

  if (ids.size !== WYD727_CLASS_IDS.length) {
    throw new Wyd727ClassCatalogError(
      "O catálogo precisa conter as quatro classes WYDBot 7.27.",
    );
  }
  return catalog;
}

export function getWyd727ClassEntry(catalog, classId) {
  validateWyd727ClassCatalog(catalog);
  if (!Number.isInteger(classId) || !WYD727_CLASS_IDS.includes(classId)) {
    return null;
  }
  return catalog.entries.find((entry) => entry.id === String(classId)) ?? null;
}

export async function loadWyd727ClassEntry(catalogPath, classId) {
  const text = await readFile(catalogPath, "utf8");
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Wyd727ClassCatalogError(
      "O catálogo de classes não contém JSON válido.",
    );
  }
  return getWyd727ClassEntry(catalog, classId);
}
