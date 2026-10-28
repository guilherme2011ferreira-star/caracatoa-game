import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCaracatoaNavigationFromTownLayout } from "../caracatoa-town-layout.mjs";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const WORLD_DIR = join(APP_DIR, "data", "world");
const layoutPath = join(WORLD_DIR, "bastiao-layout.json");
const mapsPath = join(WORLD_DIR, "maps.json");
const outputPath = join(WORLD_DIR, "navigation.json");

const [layoutText, mapsText] = await Promise.all([
  readFile(layoutPath, "utf8"),
  readFile(mapsPath, "utf8"),
]);
const layout = JSON.parse(layoutText);
const maps = JSON.parse(mapsText);
const map = maps.entries?.find((entry) => entry.mapId === layout.mapId);
if (!map) throw new Error(`Mapa ${layout.mapId} não encontrado em maps.json.`);

const navigation = createCaracatoaNavigationFromTownLayout(layout, map.bounds);
const generated = `${JSON.stringify(navigation, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8");
  if (current !== generated) {
    console.error("navigation.json está desatualizado; execute o gerador sem --check.");
    process.exitCode = 1;
  } else {
    console.log(`PASS: navegação do mapa ${layout.mapId} corresponde a ${layout.layoutRevision}.`);
  }
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Gerada navegação do mapa ${layout.mapId} a partir de ${layoutPath}.`);
}
