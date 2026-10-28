import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateWyd727ItemCatalog } from "../../../server/caracatoa/wyd-727-item-catalog.mjs";
import { validateItemizationConfig } from "../../../server/caracatoa/item-affix-system.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(projectRoot, "..", "..", "server", "caracatoa", "data", "catalogs", "items.json");
const outputPath = join(projectRoot, "main", "caracatoa_items.lua");
const itemizationCatalogPath = join(projectRoot, "..", "..", "server", "caracatoa", "data", "catalogs", "itemization.json");
const itemizationOutputPath = join(projectRoot, "main", "caracatoa_itemization.lua");
const slotIds = new Map([["weapon", 0], ["head", 1], ["chest", 2], ["legs", 3], ["feet", 4], ["accessory", 5]]);

export function renderCaracatoaItemsLua(catalog) {
  validateWyd727ItemCatalog(catalog);
  const entries = [...catalog.entries].sort((left, right) => left.properties.clientItemId - right.properties.clientItemId);
  const lines = ["-- Generated from server/caracatoa/data/catalogs/items.json.", "return {", "\tby_id = {"];
  for (const entry of entries) {
    const properties = entry.properties;
    const equipment = properties.equipment;
    const slot = equipment ? slotIds.get(equipment.slot) : -1;
    lines.push("\t\t[" + properties.clientItemId + "] = {");
    lines.push("\t\t\tname = " + JSON.stringify(entry.name) + ",");
    lines.push("\t\t\tdescription = " + JSON.stringify(entry.description) + ",");
    lines.push("\t\t\tequipment_slot = " + slot + ",");
    lines.push("\t\t\tattack_bonus = " + (equipment?.attackDamageBonus ?? 0) + ",");
    lines.push("\t\t\tdefense_bonus = " + (equipment?.defenseBonus ?? 0) + ",");
    lines.push("\t\t\tallowed_class_ids = { " + (equipment?.allowedClassIds ?? []).join(", ") + " },");
    lines.push("\t\t},");
  }
  lines.push("\t},", "}", "");
  return lines.join("\n");
}

export async function generateCaracatoaItemsLua({ check = false } = {}) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const generated = renderCaracatoaItemsLua(catalog);
  if (check) {
    const current = await readFile(outputPath, "utf8");
    assert.equal(current, generated, "caracatoa_items.lua está desatualizado em relação ao catálogo do servidor.");
    return outputPath;
  }
  await writeFile(outputPath, generated, "utf8");
  return outputPath;
}

export function renderCaracatoaItemizationLua(config) {
  validateItemizationConfig(config);
  const lines = [
    "-- Generated from server/caracatoa/data/catalogs/itemization.json.",
    "return {",
    "\trarity_names = {",
  ];
  Object.values(config.rarities).forEach((rarity, index) => {
    lines.push("\t\t[" + (index + 1) + "] = " + JSON.stringify(rarity.displayName) + ",");
  });
  lines.push("\t},", "\tby_affix_id = {");
  for (const affix of [...config.affixes].sort((left, right) => left.clientAffixId - right.clientAffixId)) {
    lines.push("\t\t[" + affix.clientAffixId + "] = {");
    lines.push("\t\t\tname = " + JSON.stringify(affix.name) + ",");
    lines.push("\t\t\tstat = " + JSON.stringify(affix.stat) + ",");
    lines.push("\t\t\tunit = " + JSON.stringify(affix.stat.endsWith("Bps") ? "basis-points" : "flat") + ",");
    lines.push("\t\t},");
  }
  lines.push("\t},", "\tby_item_id = {");
  const items = [
    ...config.itemTemplates.map((item) => ({ clientItemId: item.clientItemId, name: item.name })),
    ...Object.values(config.itemDefinitions).map((item) => ({ clientItemId: item.clientItemId, name: item.displayName })),
  ].sort((left, right) => left.clientItemId - right.clientItemId);
  for (const item of items) {
    lines.push("\t\t[" + item.clientItemId + "] = " + JSON.stringify(item.name) + ",");
  }
  lines.push("\t},", "}", "");
  return lines.join("\n");
}

export async function generateCaracatoaItemizationLua({ check = false } = {}) {
  const config = JSON.parse(await readFile(itemizationCatalogPath, "utf8"));
  const generated = renderCaracatoaItemizationLua(config);
  if (check) {
    const current = await readFile(itemizationOutputPath, "utf8");
    assert.equal(current, generated, "caracatoa_itemization.lua está desatualizado em relação ao catálogo do servidor.");
    return itemizationOutputPath;
  }
  await writeFile(itemizationOutputPath, generated, "utf8");
  return itemizationOutputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await generateCaracatoaItemsLua({ check: process.argv.includes("--check") });
  const itemizationOutput = await generateCaracatoaItemizationLua({ check: process.argv.includes("--check") });
  console.log((process.argv.includes("--check") ? "Verified" : "Generated") + " Caracatoa item metadata: " + output + " and " + itemizationOutput);
}
