import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "..", "caracatoa-godot-prototype", "assets", "models");
const assetRoot = join(projectRoot, "assets", "models");
const paletteRoot = join(assetRoot, "palettes");
const models = ["transknight", "foema", "beastmaster", "huntress", "stone_monster", "arena_floor"];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function solidPng(rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixel = Buffer.from([0, ...rgba]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixel)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function linearToSrgbByte(value) {
  const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
}

await mkdir(assetRoot, { recursive: true });
await mkdir(paletteRoot, { recursive: true });
const manifest = { engine: "Defold 1.14.0 x86_64", source: "shared Caracatoa synthetic GLBs", models: [], paletteTextures: [] };
for (const name of models) {
  const file = `${name}.glb`;
  const source = await readFile(join(sourceRoot, file));
  assert.equal(source.toString("ascii", 0, 4), "glTF", `${file}: GLB magic`);
  assert.equal(source.readUInt32LE(4), 2, `${file}: GLB version`);
  assert.equal(source.readUInt32LE(8), source.length, `${file}: declared size`);
  const jsonLength = source.readUInt32LE(12);
  assert.equal(source.toString("ascii", 16, 20), "JSON", `${file}: JSON chunk`);
  const gltf = JSON.parse(source.toString("utf8", 20, 20 + jsonLength).trim());
  assert.ok(gltf.meshes?.length, `${file}: meshes`);
  const materialByName = new Map();
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const material = gltf.materials?.[primitive.material];
      assert.ok(material?.name, `${file}: referenced material has a name`);
      const factor = material.pbrMetallicRoughness?.baseColorFactor;
      assert.ok(Array.isArray(factor) && factor.length === 4, `${file}/${material.name}: RGBA base color`);
      const previous = materialByName.get(material.name);
      if (previous) assert.deepEqual(previous.factor, factor, `${file}/${material.name}: stable palette color`);
      else materialByName.set(material.name, { factor });
    }
  }
  const materials = [...materialByName.entries()].sort(([left], [right]) => left.localeCompare(right));
  const out = join(assetRoot, file);
  await writeFile(out, source);
  for (const [materialName, material] of materials) {
    const paletteFile = `${name}_${materialName}.png`;
    const rgba = [
      linearToSrgbByte(material.factor[0]),
      linearToSrgbByte(material.factor[1]),
      linearToSrgbByte(material.factor[2]),
      Math.round(Math.min(1, Math.max(0, material.factor[3])) * 255),
    ];
    const paletteBytes = solidPng(rgba);
    await writeFile(join(paletteRoot, paletteFile), paletteBytes);
    manifest.paletteTextures.push({ file: `palettes/${paletteFile}`, material: materialName, rgba, sha256: createHash("sha256").update(paletteBytes).digest("hex") });
  }
  const modelText = [
    `mesh: "/assets/models/${file}"`,
    `name: "caracatoa_${name}"`,
    ...materials.flatMap(([materialName]) => [
      "materials {",
      `  name: "${materialName}"`,
      '  material: "/builtins/materials/model.material"',
      "  textures {",
      '    sampler: "tex0"',
      `    texture: "/assets/models/palettes/${name}_${materialName}.png"`,
      "  }",
      "}",
    ]),
    "create_go_bones: false",
    "",
  ].join("\n");
  await writeFile(join(assetRoot, `${name}.model`), modelText);
  const triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((part, primitive) => part + (primitive.indices === undefined ? gltf.accessors[primitive.attributes.POSITION].count : gltf.accessors[primitive.indices].count) / 3, 0), 0);
  manifest.models.push({ file, sha256: createHash("sha256").update(source).digest("hex"), bytes: source.length, meshes: gltf.meshes.length, materials: materials.map(([materialName]) => materialName), triangles });
}
await writeFile(join(projectRoot, "assets", "manifest.json"), `${JSON.stringify({ ...manifest, totalTriangles: manifest.models.reduce((sum, model) => sum + model.triangles, 0), totalGlbBytes: manifest.models.reduce((sum, model) => sum + model.bytes, 0) }, null, 2)}\n`);
console.log(`Generated ${manifest.models.length} model resources; ${manifest.models.reduce((sum, model) => sum + model.triangles, 0)} triangles, ${manifest.models.reduce((sum, model) => sum + model.bytes, 0)} GLB bytes.`);
