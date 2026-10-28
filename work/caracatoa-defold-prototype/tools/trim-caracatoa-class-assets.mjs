import assert from "node:assert/strict";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "models", "quaternius");
const outfitRoot = join(root, "outfits");
const modelFiles = ["Male_Ranger.gltf", "Female_Ranger.gltf", "Male_Peasant.gltf", "Female_Peasant.gltf"];
const mode = process.argv.includes("--trim") ? "trim" : process.argv.includes("--check") ? "check" : null;
assert.ok(mode, "Choose --trim to remove unused PBR maps or --check to validate the optimized assets.");

const referencedImages = new Set();

for (const filename of modelFiles) {
  const path = join(outfitRoot, filename);
  const gltf = JSON.parse(await readFile(path, "utf8"));
  assert.equal(gltf.asset?.version, "2.0", `${filename}: expected glTF 2.0`);
  assert.ok(gltf.meshes?.length && gltf.skins?.length, `${filename}: expected a skinned character mesh`);

  const oldTextures = gltf.textures ?? [];
  const oldImages = gltf.images ?? [];
  const usedTextureIndices = new Set();
  for (const material of gltf.materials ?? []) {
    const baseColor = material.pbrMetallicRoughness?.baseColorTexture;
    assert.ok(Number.isInteger(baseColor?.index), `${filename}/${material.name}: base color texture required`);
    assert.ok(oldTextures[baseColor.index], `${filename}/${material.name}: base color texture index is valid`);
    usedTextureIndices.add(baseColor.index);
    if (mode === "trim") {
      delete material.normalTexture;
      delete material.occlusionTexture;
      delete material.emissiveTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    } else {
      assert.equal(material.normalTexture, undefined, `${filename}/${material.name}: unused normal map removed`);
      assert.equal(material.occlusionTexture, undefined, `${filename}/${material.name}: unused occlusion map removed`);
      assert.equal(material.emissiveTexture, undefined, `${filename}/${material.name}: unused emissive map removed`);
      assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture, undefined, `${filename}/${material.name}: unused ORM map removed`);
    }
  }

  const textureIndexMap = new Map();
  const imageIndexMap = new Map();
  const optimizedTextures = [];
  const optimizedImages = [];
  for (const oldTextureIndex of [...usedTextureIndices].sort((a, b) => a - b)) {
    const oldTexture = oldTextures[oldTextureIndex];
    assert.ok(Number.isInteger(oldTexture.source) && oldImages[oldTexture.source], `${filename}: texture source is valid`);
    if (!imageIndexMap.has(oldTexture.source)) {
      const oldImage = oldImages[oldTexture.source];
      assert.ok(typeof oldImage.uri === "string" && !oldImage.uri.startsWith("data:"), `${filename}: expected a local texture file`);
      const imagePath = resolve(outfitRoot, oldImage.uri);
      assert.ok(imagePath.startsWith(`${resolve(outfitRoot)}${sep}`), `${filename}: texture path stays inside the outfit asset directory`);
      await stat(imagePath);
      imageIndexMap.set(oldTexture.source, optimizedImages.length);
      optimizedImages.push(oldImage);
      referencedImages.add(oldImage.uri);
    }
    textureIndexMap.set(oldTextureIndex, optimizedTextures.length);
    optimizedTextures.push({ ...oldTexture, source: imageIndexMap.get(oldTexture.source) });
  }

  for (const material of gltf.materials ?? []) {
    const oldIndex = material.pbrMetallicRoughness.baseColorTexture.index;
    material.pbrMetallicRoughness.baseColorTexture.index = textureIndexMap.get(oldIndex);
  }
  if (mode === "trim") {
    gltf.textures = optimizedTextures;
    gltf.images = optimizedImages;
    await writeFile(path, `${JSON.stringify(gltf, null, 2)}\n`);
  } else {
    assert.equal(gltf.textures?.length, usedTextureIndices.size, `${filename}: no unused texture entries`);
    assert.equal(gltf.images?.length, imageIndexMap.size, `${filename}: no unused image entries`);
    for (const material of gltf.materials ?? []) {
      assert.ok(gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index], `${filename}/${material.name}: optimized base color index is valid`);
    }
  }
}

if (mode === "trim") {
  for (const entry of await readdir(outfitRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name) || referencedImages.has(entry.name)) continue;
    await unlink(join(outfitRoot, entry.name));
  }
} else {
  for (const entry of await readdir(outfitRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) {
      assert.ok(referencedImages.has(entry.name), `${entry.name}: unreferenced texture should be removed`);
    }
  }
}

const totalBytes = (await Promise.all((await readdir(outfitRoot)).map(async (name) => {
  const itemPath = join(outfitRoot, name);
  return (await stat(itemPath)).isFile() ? (await stat(itemPath)).size : 0;
}))).reduce((sum, size) => sum + size, 0);
console.log(`${mode === "trim" ? "Trimmed" : "Validated"} four Quaternius character models; ${referencedImages.size} base-color textures, ${Math.round(totalBytes / 1024 / 1024)} MiB outfit assets.`);
