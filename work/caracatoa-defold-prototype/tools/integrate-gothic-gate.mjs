import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_GLB = join(CLIENT_ROOT, "..", "..", "docs", "art", "concept", "portao-astral-3d-v1", "models", "portao-astral-v1.glb");
const MODEL_ROOT = join(CLIENT_ROOT, "assets", "models");
const TEXTURE_ROOT = join(MODEL_ROOT, "portao-astral-textures");
const TARGET_GLB = join(MODEL_ROOT, "portao-astral.glb");
const TARGET_MODEL = join(MODEL_ROOT, "portao-astral.model");
const MATERIAL = "/assets/materials/caracatoa_town.material";

const bytes = await readFile(PREVIEW_GLB);
if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
  throw new Error("O portao aprovado nao e um GLB 2.0 valido.");
}

let json = null;
let binary = null;
for (let offset = 12; offset < bytes.length;) {
  const length = bytes.readUInt32LE(offset);
  const type = bytes.toString("ascii", offset + 4, offset + 8);
  const chunk = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === "JSON") json = JSON.parse(chunk.toString("utf8"));
  else if (type === "BIN\0") binary = chunk;
  offset += 8 + length;
}
if (!json || !binary || !Array.isArray(json.materials) || !Array.isArray(json.images) || !Array.isArray(json.textures)) {
  throw new Error("O GLB nao contem materiais/texturas embutidos que o importador do cliente consiga mapear.");
}

await mkdir(TEXTURE_ROOT, { recursive: true });
const usedNames = new Set();
const modelEntries = [];
for (const [index, material] of json.materials.entries()) {
  const name = material.name;
  if (!name || usedNames.has(name)) throw new Error(`Nome de material ausente ou repetido no GLB: ${name ?? index}`);
  usedNames.add(name);
  const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
  const texture = json.textures[textureIndex];
  const image = json.images[texture?.source];
  const view = json.bufferViews[image?.bufferView];
  if (!view || !Number.isInteger(view.byteOffset) || !Number.isInteger(view.byteLength)) {
    throw new Error(`Textura base ausente para o material ${name}.`);
  }
  const imageBytes = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  if (imageBytes.length !== view.byteLength || imageBytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error(`Textura do material ${name} nao e um PNG embutido valido.`);
  }
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const texturePath = join(TEXTURE_ROOT, `${slug}.png`);
  await writeFile(texturePath, imageBytes);
  const gamePath = `/assets/models/portao-astral-textures/${slug}.png`;
  modelEntries.push(`materials {\n  name: "${name}"\n  material: "${MATERIAL}"\n  textures {\n    sampler: "tex0"\n    texture: "${gamePath}"\n  }\n}`);
}

await copyFile(PREVIEW_GLB, TARGET_GLB);
const config = [
  'mesh: "/assets/models/portao-astral.glb"',
  'name: "portao-astral"',
  ...modelEntries,
  "",
].join("\n");
await writeFile(TARGET_MODEL, config, "utf8");

console.log(`Modelo Defold preparado: ${TARGET_GLB}`);
console.log(`Slots de material mapeados: ${modelEntries.length}`);
console.log(`Texturas base exportadas: ${modelEntries.length} PNGs em ${TEXTURE_ROOT}`);
