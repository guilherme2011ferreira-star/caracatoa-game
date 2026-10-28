import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateCaracatoaSkillsLua, renderCaracatoaSkillsLua } from "./generate-caracatoa-skills.mjs";

test("client skill metadata is generated from the authoritative server catalog", async () => {
  const catalog = JSON.parse(await readFile(new URL("../../../server/caracatoa/data/catalogs/skills.json", import.meta.url), "utf8"));
  const source = renderCaracatoaSkillsLua(catalog);
  assert.match(source, /\[1\].*\n\s*name = "Golpe da Forja"/);
  assert.match(source, /\[25\].*\n\s*name = "Caracatoa Corte"/);
  assert.match(source, /\[2\].*\n\s*name = "Ruptura de Aço"/);
  assert.match(source, /branch_name = "Trans"/);
  assert.match(source, /scaling_attribute = "str"/);
  assert.match(source, /effect_type = "heal"/);
  assert.match(source, /heal_amount = 32/);
  assert.match(source, /name = "Luz de Yetserahi"/);
  assert.match(source, /\[49\].*\n\s*name = "Garras de Cipó"/);
  assert.match(source, /\[73\].*\n\s*name = "Flecha Perfurante"/);
  assert.match(source, /range_tiles = 5/);
  await generateCaracatoaSkillsLua({ check: true });
});
