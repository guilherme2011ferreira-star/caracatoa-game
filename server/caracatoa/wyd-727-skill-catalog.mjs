const SKILL_ID_MIN = 1;
const SKILL_ID_MAX = 95;
export const WYD727_CLASS_BRANCHES = Object.freeze({
  0: Object.freeze({ trans: "Trans", magia: "Magia", confianca: "Confiança" }),
  1: Object.freeze({
    "magia-branca": "Magia Branca",
    "magia-negra": "Magia Negra",
    "magia-especial": "Magia Especial",
  }),
  2: Object.freeze({ elemental: "Elemental", naturais: "Naturais", invocacao: "Invocação" }),
  3: Object.freeze({ sobrevivencia: "Sobrevivência", troca: "Troca", captura: "Captura" }),
});
const DEFAULT_SKILL_CATALOG = Object.freeze({
  schemaVersion: 1,
  kind: "skills",
  entries: Object.freeze([]),
});

export function getWyd727SkillBranchName(classId, branchId) {
  return WYD727_CLASS_BRANCHES[classId]?.[branchId] ?? null;
}

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

export function validateWyd727SkillCatalog(catalog) {
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== "skills" ||
    !Array.isArray(catalog.entries)
  ) {
    throw new Error("Cabeçalho do catálogo de habilidades inválido.");
  }

  const entryIds = new Set();
  const clientSkillIds = new Set();
  for (const entry of catalog.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 128 ||
      typeof entry.description !== "string" ||
      entry.description.length > 2048 ||
      typeof entry.enabled !== "boolean"
    ) {
      throw new Error("Registro de habilidade inválido.");
    }
    if (entryIds.has(entry.id)) {
      throw new Error(`ID de catálogo de habilidade duplicado: ${entry.id}.`);
    }
    entryIds.add(entry.id);
    assertExactKeys(
      entry.properties,
      [
        "clientSkillId",
        "branchId",
        "scalingAttribute",
        "effectType",
        "skillPointCost",
        "requiredLevel",
        "prerequisites",
        "damageBonus",
        "healAmount",
        "defenseBonus",
        "durationMs",
        "manaCost",
        "cooldownMs",
        "rangeTiles",
      ],
      `properties da habilidade ${entry.id}`,
    );
    const {
      clientSkillId,
      branchId,
      scalingAttribute,
      effectType,
      skillPointCost,
      requiredLevel,
      prerequisites,
      damageBonus,
      healAmount,
      defenseBonus,
      durationMs,
      manaCost,
      cooldownMs,
      rangeTiles,
    } = entry.properties;
    assertInteger(clientSkillId, SKILL_ID_MIN, SKILL_ID_MAX, "clientSkillId");
    const classId = Math.floor(clientSkillId / 24);
    if (!getWyd727SkillBranchName(classId, branchId)) {
      throw new Error(`Ramo ${branchId} inválido para a classe ${classId}.`);
    }
    if (!["str", "int", "dex", "con"].includes(scalingAttribute)) {
      throw new Error(`Atributo de escala inválido na habilidade ${entry.id}.`);
    }
    assertInteger(skillPointCost, 1, 1000, "skillPointCost");
    assertInteger(requiredLevel, 1, 0x7fffffff, "requiredLevel");
    if (!Array.isArray(prerequisites) || prerequisites.length > 24) {
      throw new Error(`Pré-requisitos inválidos na habilidade ${entry.id}.`);
    }
    const prerequisiteIds = new Set();
    for (const prerequisiteId of prerequisites) {
      if (
        typeof prerequisiteId !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(prerequisiteId) ||
        prerequisiteId === entry.id ||
        prerequisiteIds.has(prerequisiteId)
      ) {
        throw new Error(`Pré-requisito inválido na habilidade ${entry.id}.`);
      }
      prerequisiteIds.add(prerequisiteId);
    }
    if (!["damage", "heal", "defense"].includes(effectType)) {
      throw new Error(`Efeito inválido na habilidade ${entry.id}.`);
    }
    assertInteger(damageBonus, 0, 1000, "damageBonus");
    assertInteger(healAmount, 0, 0x7fffffff, "healAmount");
    assertInteger(defenseBonus, 0, 1000, "defenseBonus");
    assertInteger(durationMs, 0, 120_000, "durationMs");
    if (effectType === "damage" && (damageBonus < 1 || healAmount !== 0 || defenseBonus !== 0 || durationMs !== 0)) {
      throw new Error(`Habilidade ofensiva ${entry.id} precisa de dano e não pode curar nem conceder defesa.`);
    }
    if (
      effectType === "heal" &&
      (classId !== 1 || branchId !== "magia-branca" || damageBonus !== 0 || healAmount < 1 || defenseBonus !== 0 || durationMs !== 0)
    ) {
      throw new Error(`Habilidade de cura ${entry.id} precisa ser uma cura da Foema Magia Branca.`);
    }
    if (
      effectType === "defense" &&
      (classId !== 0 || branchId !== "confianca" || scalingAttribute !== "con" ||
        damageBonus !== 0 || healAmount !== 0 || defenseBonus < 1 || durationMs < 1000)
    ) {
      throw new Error(`Habilidade defensiva ${entry.id} precisa ser do ramo Confiança do TransKnight e durar pelo menos 1 segundo.`);
    }
    assertInteger(manaCost, 0, 1000, "manaCost");
    assertInteger(cooldownMs, 1000, 120_000, "cooldownMs");
    assertInteger(rangeTiles, effectType === "damage" ? 1 : 0, 12, "rangeTiles");
    if (effectType !== "damage" && rangeTiles !== 0) {
      throw new Error(`Efeito de autoalvo ${entry.id} deve ter alcance zero.`);
    }
    if (clientSkillIds.has(clientSkillId)) {
      throw new Error(`clientSkillId duplicado: ${clientSkillId}.`);
    }
    clientSkillIds.add(clientSkillId);
  }
  for (const entry of catalog.entries) {
    for (const prerequisiteId of entry.properties.prerequisites) {
      const prerequisite = catalog.entries.find(
        (candidate) => candidate.id === prerequisiteId,
      );
      if (
        !prerequisite ||
        !prerequisite.enabled ||
        Math.floor(prerequisite.properties.clientSkillId / 24) !==
          Math.floor(entry.properties.clientSkillId / 24)
      ) {
        throw new Error(
          `Pré-requisito ${prerequisiteId} precisa existir na mesma classe.`,
        );
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (entry) => {
    if (visiting.has(entry.id)) {
      throw new Error(`Ciclo de pré-requisitos na habilidade ${entry.id}.`);
    }
    if (visited.has(entry.id)) return;
    visiting.add(entry.id);
    for (const prerequisiteId of entry.properties.prerequisites) {
      visit(catalog.entries.find((candidate) => candidate.id === prerequisiteId));
    }
    visiting.delete(entry.id);
    visited.add(entry.id);
  };
  for (const entry of catalog.entries) visit(entry);
  return catalog;
}

export function getWyd727SkillsForClass(catalog, classId) {
  validateWyd727SkillCatalog(catalog);
  if (!Number.isInteger(classId) || classId < 0 || classId > 3) return [];
  return catalog.entries.filter(
    (entry) =>
      entry.enabled &&
      Math.floor(entry.properties.clientSkillId / 24) === classId,
  );
}

export function getWyd727LearnedSkillMask(skills) {
  if (!Array.isArray(skills) || skills.length > 24) {
    throw new TypeError("skills precisa conter até 24 habilidades da classe.");
  }
  let learn0 = 0;
  const ids = new Set();
  for (const skill of skills) {
    const id = skill?.properties?.clientSkillId;
    assertInteger(id, SKILL_ID_MIN, SKILL_ID_MAX, "clientSkillId");
    if (ids.has(id)) throw new Error(`clientSkillId duplicado: ${id}.`);
    ids.add(id);
    learn0 = (learn0 | (1 << (id % 24))) >>> 0;
  }
  return [learn0, 0];
}

export const DEFAULT_WYD727_SKILL_CATALOG = DEFAULT_SKILL_CATALOG;
