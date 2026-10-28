import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  getWyd727SkillBranchName,
  validateWyd727SkillCatalog,
} from "../../../server/caracatoa/wyd-727-skill-catalog.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(projectRoot, "..", "..", "server", "caracatoa", "data", "catalogs", "skills.json");
const outputPath = join(projectRoot, "main", "caracatoa_skills.lua");

export function renderCaracatoaSkillsLua(catalog) {
  validateWyd727SkillCatalog(catalog);
  const entries = [...catalog.entries].sort(
    (left, right) => left.properties.clientSkillId - right.properties.clientSkillId,
  );
  const idByCatalogId = new Map(
    entries.map((entry) => [entry.id, entry.properties.clientSkillId]),
  );
  const lines = ["-- Generated from server/caracatoa/data/catalogs/skills.json.", "return {", "\tby_id = {"];
  for (const entry of entries) {
    const skill = entry.properties;
    const classId = Math.floor(skill.clientSkillId / 24);
    const branchName = getWyd727SkillBranchName(classId, skill.branchId);
    const prerequisites = skill.prerequisites
      .map((id) => idByCatalogId.get(id))
      .sort((left, right) => left - right);
    lines.push(`\t\t[${skill.clientSkillId}] = {`);
    lines.push(`\t\t\tname = ${JSON.stringify(entry.name)},`);
    lines.push(`\t\t\tdescription = ${JSON.stringify(entry.description)},`);
    lines.push(`\t\t\tclass_id = ${classId},`);
    lines.push(`\t\t\tbranch_id = ${JSON.stringify(skill.branchId)},`);
    lines.push(`\t\t\tbranch_name = ${JSON.stringify(branchName)},`);
    lines.push(`\t\t\tscaling_attribute = ${JSON.stringify(skill.scalingAttribute)},`);
    lines.push(`\t\t\teffect_type = ${JSON.stringify(skill.effectType)},`);
    lines.push(`\t\t\tdamage_bonus = ${skill.damageBonus},`);
    lines.push(`\t\t\theal_amount = ${skill.healAmount},`);
    lines.push(`\t\t\tdefense_bonus = ${skill.defenseBonus},`);
    lines.push(`\t\t\tduration_ms = ${skill.durationMs},`);
    lines.push(`\t\t\tmana = ${skill.manaCost},`);
    lines.push(`\t\t\tcooldown = ${skill.cooldownMs / 1000},`);
    lines.push(`\t\t\trange_tiles = ${skill.rangeTiles},`);
    lines.push(`\t\t\trequired_level = ${skill.requiredLevel},`);
    lines.push(`\t\t\tpoint_cost = ${skill.skillPointCost},`);
    lines.push(`\t\t\tprerequisites = { ${prerequisites.join(", ")} },`);
    lines.push("\t\t},");
  }
  lines.push("\t},", "\tby_class = {");
  for (let classId = 0; classId < 4; classId += 1) {
    const skillIds = entries
      .filter((entry) => Math.floor(entry.properties.clientSkillId / 24) === classId)
      .map((entry) => entry.properties.clientSkillId);
    lines.push(`\t\t[${classId}] = { ${skillIds.join(", ")} },`);
  }
  lines.push("\t},", "}", "");
  return lines.join("\n");
}

export async function generateCaracatoaSkillsLua({ check = false } = {}) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const generated = renderCaracatoaSkillsLua(catalog);
  if (check) {
    const current = (await readFile(outputPath, "utf8")).replace(/\r\n/g, "\n");
    assert.equal(current, generated, "caracatoa_skills.lua está desatualizado em relação ao catálogo do servidor.");
    return outputPath;
  }
  await writeFile(outputPath, generated, "utf8");
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await generateCaracatoaSkillsLua({ check: process.argv.includes("--check") });
  console.log(`${process.argv.includes("--check") ? "Verified" : "Generated"} Caracatoa skill metadata: ${output}`);
}
