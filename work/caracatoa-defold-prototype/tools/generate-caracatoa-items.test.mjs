import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateCaracatoaItemsLua,
  generateCaracatoaItemizationLua,
  renderCaracatoaItemsLua,
  renderCaracatoaItemizationLua,
} from "./generate-caracatoa-items.mjs";

test("client item labels and equipment details come from the server catalog", async () => {
  const catalog = JSON.parse(await readFile(new URL("../../../server/caracatoa/data/catalogs/items.json", import.meta.url), "utf8"));
  const source = renderCaracatoaItemsLua(catalog);
  assert.match(source, /\[7001\] = \{[\s\S]*?name = "Lâmina de Treino"[\s\S]*?equipment_slot = 0[\s\S]*?attack_bonus = 5/);
  assert.match(source, /\[7002\] = \{[\s\S]*?name = "Manto de Linho"[\s\S]*?equipment_slot = 2[\s\S]*?defense_bonus = 2/);
  await generateCaracatoaItemsLua({ check: true });
});

test("client itemization labels and affix IDs come from the server catalog", async () => {
  const config = JSON.parse(await readFile(new URL("../../../server/caracatoa/data/catalogs/itemization.json", import.meta.url), "utf8"));
  const source = renderCaracatoaItemizationLua(config);
  assert.match(source, /rarity_names = \{[\s\S]*?\[5\] = "Ancient"/);
  assert.match(source, /\[1\] = \{[\s\S]*?name = "Afiado"[\s\S]*?stat = "physicalDamageFlat"/);
  assert.match(source, /\[8001\] = "Ferro Votivo"/);
  await generateCaracatoaItemizationLua({ check: true });
  await generateCaracatoaItemsLua({ check: true });
});
