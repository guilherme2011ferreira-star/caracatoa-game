import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_WYD727_SKILL_CATALOG,
  getWyd727LearnedSkillMask,
  getWyd727SkillsForClass,
  validateWyd727SkillCatalog,
} from "./wyd-727-skill-catalog.mjs";

const FOEMA_SKILL = {
  id: "caracatoa-corte",
  name: "Caracatoa Corte",
  description: "Habilidade ofensiva sintética para a prévia local.",
  enabled: true,
  properties: {
    clientSkillId: 25,
    branchId: "magia-negra",
    scalingAttribute: "int",
    effectType: "damage",
    skillPointCost: 1,
    requiredLevel: 1,
    prerequisites: [],
    damageBonus: 6,
    healAmount: 0,
    defenseBonus: 0,
    durationMs: 0,
    manaCost: 7,
    cooldownMs: 3000,
    rangeTiles: 1,
  },
};

function catalog(entries = [structuredClone(FOEMA_SKILL)]) {
  return { ...structuredClone(DEFAULT_WYD727_SKILL_CATALOG), entries };
}

test("skill catalog filters enabled single-target skills by WYD class ID", () => {
  const data = catalog([
    structuredClone(FOEMA_SKILL),
    { ...structuredClone(FOEMA_SKILL), id: "other-disabled", enabled: false },
  ]);
  data.entries[1].properties.clientSkillId = 26;
  validateWyd727SkillCatalog(data);
  assert.deepEqual(getWyd727SkillsForClass(data, 1), [data.entries[0]]);
  assert.deepEqual(getWyd727SkillsForClass(data, 0), []);
  assert.deepEqual(getWyd727SkillsForClass(data, 4), []);
  assert.deepEqual(getWyd727LearnedSkillMask([data.entries[0]]), [2, 0]);
});

test("active catalog gives every class a starter skill and the Foema white-magic branch", async () => {
  const catalogPath = new URL("./data/catalogs/skills.json", import.meta.url);
  const activeCatalog = JSON.parse(await readFile(catalogPath, "utf8"));
  validateWyd727SkillCatalog(activeCatalog);
  assert.deepEqual(
    activeCatalog.entries.map(({ id, properties }) => ({
      id,
      clientSkillId: properties.clientSkillId,
      branchId: properties.branchId,
      scalingAttribute: properties.scalingAttribute,
      effectType: properties.effectType,
      requiredLevel: properties.requiredLevel,
      prerequisites: properties.prerequisites,
      rangeTiles: properties.rangeTiles,
    })),
    [
      {
        id: "golpe-da-forja",
        clientSkillId: 1,
        branchId: "trans",
        scalingAttribute: "str",
        effectType: "damage",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 1,
      },
      {
        id: "ruptura-de-aco",
        clientSkillId: 2,
        branchId: "trans",
        scalingAttribute: "str",
        effectType: "damage",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 1,
      },
      {
        id: "guarda-inabalavel",
        clientSkillId: 3,
        branchId: "confianca",
        scalingAttribute: "con",
        effectType: "defense",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 0,
      },
      {
        id: "caracatoa-corte",
        clientSkillId: 25,
        branchId: "magia-negra",
        scalingAttribute: "int",
        effectType: "damage",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 1,
      },
      {
        id: "caracatoa-impacto-celeste",
        clientSkillId: 26,
        branchId: "magia-negra",
        scalingAttribute: "int",
        effectType: "damage",
        requiredLevel: 2,
        prerequisites: ["caracatoa-corte"],
        rangeTiles: 1,
      },
      {
        id: "luz-de-yetserahi",
        clientSkillId: 27,
        branchId: "magia-branca",
        scalingAttribute: "int",
        effectType: "heal",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 0,
      },
      {
        id: "garras-de-cipo",
        clientSkillId: 49,
        branchId: "naturais",
        scalingAttribute: "str",
        effectType: "damage",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 1,
      },
      {
        id: "flecha-perfurante",
        clientSkillId: 73,
        branchId: "captura",
        scalingAttribute: "dex",
        effectType: "damage",
        requiredLevel: 1,
        prerequisites: [],
        rangeTiles: 5,
      },
    ],
  );
  assert.deepEqual([0, 1, 2, 3].map((classId) =>
    getWyd727SkillsForClass(activeCatalog, classId).map((entry) => entry.properties.clientSkillId)),
  [[1, 2, 3], [25, 26, 27], [49], [73]]);
  const guard = activeCatalog.entries.find(({ id }) => id === "guarda-inabalavel");
  assert.deepEqual(
    {
      id: guard.id,
      branchId: guard.properties.branchId,
      scalingAttribute: guard.properties.scalingAttribute,
      effectType: guard.properties.effectType,
      defenseBonus: guard.properties.defenseBonus,
      durationMs: guard.properties.durationMs,
      rangeTiles: guard.properties.rangeTiles,
    },
    { id: "guarda-inabalavel", branchId: "confianca", scalingAttribute: "con", effectType: "defense", defenseBonus: 20, durationMs: 8000, rangeTiles: 0 },
  );
});

test("skill catalog rejects duplicate IDs, unsupported classes, and invalid wire rules", () => {
  const duplicateCatalogId = catalog([
    structuredClone(FOEMA_SKILL),
    structuredClone(FOEMA_SKILL),
  ]);
  assert.throws(() => validateWyd727SkillCatalog(duplicateCatalogId));

  const duplicateClientId = catalog([
    structuredClone(FOEMA_SKILL),
    { ...structuredClone(FOEMA_SKILL), id: "duplicate-wire-id" },
  ]);
  assert.throws(() => validateWyd727SkillCatalog(duplicateClientId));

  const unsupportedClass = catalog();
  unsupportedClass.entries[0].properties.clientSkillId = 96;
  assert.throws(() => validateWyd727SkillCatalog(unsupportedClass));

  const invalidCost = catalog();
  invalidCost.entries[0].properties.manaCost = -1;
  assert.throws(() => validateWyd727SkillCatalog(invalidCost));

  const invalidRange = catalog();
  invalidRange.entries[0].properties.rangeTiles = 13;
  assert.throws(() => validateWyd727SkillCatalog(invalidRange));

  const unsupportedWireField = catalog();
  unsupportedWireField.entries[0].properties.packetKind = 2;
  assert.throws(() => validateWyd727SkillCatalog(unsupportedWireField));

  const wrongClassBranch = catalog();
  wrongClassBranch.entries[0].properties.branchId = "trans";
  assert.throws(() => validateWyd727SkillCatalog(wrongClassBranch), /Ramo/);

  const invalidScalingAttribute = catalog();
  invalidScalingAttribute.entries[0].properties.scalingAttribute = "luck";
  assert.throws(() => validateWyd727SkillCatalog(invalidScalingAttribute), /escala/);

  const invalidEffect = catalog();
  invalidEffect.entries[0].properties.effectType = "buff";
  assert.throws(() => validateWyd727SkillCatalog(invalidEffect), /Efeito/);

  const invalidHealingBranch = catalog();
  invalidHealingBranch.entries[0].properties.effectType = "heal";
  invalidHealingBranch.entries[0].properties.damageBonus = 0;
  invalidHealingBranch.entries[0].properties.healAmount = 20;
  assert.throws(() => validateWyd727SkillCatalog(invalidHealingBranch), /cura da Foema Magia Branca/);

  const invalidDefenseBranch = catalog();
  Object.assign(invalidDefenseBranch.entries[0].properties, {
    branchId: "confianca",
    scalingAttribute: "con",
    effectType: "defense",
    damageBonus: 0,
    defenseBonus: 20,
    durationMs: 8000,
    rangeTiles: 0,
  });
  assert.throws(() => validateWyd727SkillCatalog(invalidDefenseBranch), /Ramo/);

  const missingPrerequisite = catalog();
  missingPrerequisite.entries[0].properties.prerequisites = ["missing-skill"];
  assert.throws(() => validateWyd727SkillCatalog(missingPrerequisite));

  const duplicatePrerequisite = catalog();
  duplicatePrerequisite.entries[0].properties.prerequisites = [
    "caracatoa-corte",
  ];
  assert.throws(() => validateWyd727SkillCatalog(duplicatePrerequisite));

  const prerequisiteCycle = catalog([
    structuredClone(FOEMA_SKILL),
    {
      ...structuredClone(FOEMA_SKILL),
      id: "caracatoa-explosao",
      properties: {
        ...FOEMA_SKILL.properties,
        clientSkillId: 26,
        prerequisites: ["caracatoa-corte"],
      },
    },
  ]);
  prerequisiteCycle.entries[0].properties.prerequisites = ["caracatoa-explosao"];
  assert.throws(() => validateWyd727SkillCatalog(prerequisiteCycle), /Ciclo/);
});

test("learned-skill mask rejects duplicate casts and unsupported list sizes", () => {
  assert.throws(() =>
    getWyd727LearnedSkillMask([FOEMA_SKILL, structuredClone(FOEMA_SKILL)]),
  );
  assert.throws(() => getWyd727LearnedSkillMask(Array(25).fill(FOEMA_SKILL)));
});
