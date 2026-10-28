import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, generateTownStoneV4 } from "../../../docs/art/concept/stone-organic-periodic-v1/generate-town-stone-v4.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = join(root, "assets", "models", "stone_monster.glb");
const paletteRoot = join(root, "assets", "models", "palettes");
const glb = await readFile(modelPath);

function readGlb(bytes) {
	if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2.0 binary model.");
	let offset = 12;
	let json;
	let binary;
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32LE(offset);
		const kind = bytes.readUInt32LE(offset + 4);
		offset += 8;
		const chunk = bytes.subarray(offset, offset + length);
		if (kind === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").trimEnd());
		if (kind === 0x004e4942) binary = Buffer.from(chunk);
		offset += length;
	}
	if (!json || !binary) throw new Error("The stone monster GLB is missing a JSON or binary chunk.");
	return { json, binary };
}

function accessorFloats(json, binary, accessorIndex, components) {
	const accessor = json.accessors[accessorIndex];
	const view = json.bufferViews[accessor.bufferView];
	if (accessor.componentType !== 5126 || accessor.type !== `VEC${components}`) throw new Error(`Unexpected accessor ${accessorIndex} format.`);
	const stride = view.byteStride ?? components * 4;
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	return Array.from({ length: accessor.count }, (_, index) => Array.from({ length: components }, (_, component) => binary.readFloatLE(start + index * stride + component * 4)));
}

function accessorIndices(json, binary, accessorIndex) {
	const accessor = json.accessors[accessorIndex];
	const view = json.bufferViews[accessor.bufferView];
	if (accessor.type !== "SCALAR") throw new Error(`Unexpected index accessor ${accessorIndex} format.`);
	const bytesPerIndex = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5125 ? 4 : 0;
	if (!bytesPerIndex) throw new Error(`Unexpected index component type ${accessor.componentType}.`);
	const read = bytesPerIndex === 1 ? "readUInt8" : bytesPerIndex === 2 ? "readUInt16LE" : "readUInt32LE";
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	return Array.from({ length: accessor.count }, (_, index) => binary[read](start + index * bytesPerIndex));
}

function appendFloatAccessor(json, binaryChunks, values, components, target = 34962) {
	let length = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const padding = (4 - (length % 4)) % 4;
	if (padding) {
		binaryChunks.push(Buffer.alloc(padding));
		length += padding;
	}
	const bytes = Buffer.alloc(values.length * 4);
	values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
	const bufferView = json.bufferViews.length;
	json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target });
	binaryChunks.push(bytes);
	const accessor = json.accessors.length;
	const rows = Array.from({ length: values.length / components }, (_, row) => values.slice(row * components, (row + 1) * components));
	const min = Array.from({ length: components }, (_, component) => Math.min(...rows.map((row) => row[component])));
	const max = Array.from({ length: components }, (_, component) => Math.max(...rows.map((row) => row[component])));
	json.accessors.push({ bufferView, componentType: 5126, count: rows.length, type: `VEC${components}`, min, max });
	return accessor;
}

function projectUv(position, bounds) {
	const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
	const radii = bounds.min.map((value, axis) => Math.max(0.0001, (bounds.max[axis] - value) / 2));
	const x = (position[0] - center[0]) / radii[0];
	const y = Math.max(-1, Math.min(1, (position[1] - center[1]) / radii[1]));
	const z = (position[2] - center[2]) / radii[2];
	return [0.5 + Math.atan2(z, x) / (Math.PI * 2), 0.5 + Math.asin(y) / Math.PI];
}

function rebuildGlb(json, binary) {
	const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
	const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
	const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
	jsonBytes.copy(jsonChunk);
	const binaryChunk = Buffer.from(binary);
	const paddedBinaryLength = Math.ceil(binaryChunk.length / 4) * 4;
	const paddedBinary = Buffer.alloc(paddedBinaryLength);
	binaryChunk.copy(paddedBinary);
	const totalLength = 12 + 8 + jsonChunk.length + 8 + paddedBinary.length;
	const header = Buffer.alloc(12);
	header.write("glTF", 0, "ascii");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(totalLength, 8);
	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonChunk.length, 0);
	jsonHeader.writeUInt32LE(0x4e4f534a, 4);
	const binaryHeader = Buffer.alloc(8);
	binaryHeader.writeUInt32LE(paddedBinary.length, 0);
	binaryHeader.writeUInt32LE(0x004e4942, 4);
	return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, paddedBinary]);
}

const { json, binary: originalBinary } = readGlb(glb);
const chunks = [originalBinary];
let texturedTriangles = 0;
const sourcePrimitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
const alreadyTextured = sourcePrimitives.length > 0 && sourcePrimitives.every((primitive) =>
	Number.isInteger(primitive.attributes?.TEXCOORD_0) && primitive.indices === undefined);
for (const mesh of json.meshes ?? []) {
	for (const primitive of mesh.primitives ?? []) {
		const positionIndex = primitive.attributes?.POSITION;
		const normalIndex = primitive.attributes?.NORMAL;
		if (alreadyTextured) {
			texturedTriangles += json.accessors[positionIndex].count / 3;
			continue;
		}
		if (positionIndex === undefined || normalIndex === undefined || primitive.indices === undefined) throw new Error(`${mesh.name ?? "mesh"}: expected indexed positions and normals.`);
		const positions = accessorFloats(json, originalBinary, positionIndex, 3);
		const normals = accessorFloats(json, originalBinary, normalIndex, 3);
		const positionAccessor = json.accessors[positionIndex];
		const bounds = { min: positionAccessor.min, max: positionAccessor.max };
		const indices = accessorIndices(json, originalBinary, primitive.indices);
		if (indices.length % 3 !== 0) throw new Error(`${mesh.name ?? "mesh"}: triangle index count is not divisible by 3.`);
		const outPositions = [];
		const outNormals = [];
		const outUvs = [];
		for (let face = 0; face < indices.length; face += 3) {
			const vertexIds = indices.slice(face, face + 3);
			const uvs = vertexIds.map((vertexId) => projectUv(positions[vertexId], bounds));
			const uValues = uvs.map(([u]) => u);
			if (Math.max(...uValues) - Math.min(...uValues) > 0.5) {
				for (const uv of uvs) if (uv[0] < 0.5) uv[0] += 1;
			}
			for (let corner = 0; corner < 3; corner += 1) {
				const vertexId = vertexIds[corner];
				outPositions.push(...positions[vertexId]);
				outNormals.push(...normals[vertexId]);
				outUvs.push(...uvs[corner]);
			}
		}
		const positionAccessorOut = appendFloatAccessor(json, chunks, outPositions, 3);
		const normalAccessorOut = appendFloatAccessor(json, chunks, outNormals, 3);
		const uvAccessorOut = appendFloatAccessor(json, chunks, outUvs, 2);
		primitive.attributes = { ...primitive.attributes, POSITION: positionAccessorOut, NORMAL: normalAccessorOut, TEXCOORD_0: uvAccessorOut };
		delete primitive.indices;
		texturedTriangles += indices.length / 3;
	}
}

for (const material of json.materials ?? []) {
	if (material.name === "monster" || material.name === "monsterLight") {
		material.pbrMetallicRoughness ??= {};
		material.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
		material.pbrMetallicRoughness.metallicFactor = 0;
		material.pbrMetallicRoughness.roughnessFactor = 0.96;
	}
}
const newBinary = Buffer.concat(chunks);
json.buffers[0].byteLength = newBinary.length;
const output = rebuildGlb(json, newBinary);
await writeFile(modelPath, output);

const body = generateTownStoneV4({ seed: 0xFA00, tone: "basalt" });
const chest = generateTownStoneV4({ seed: 0xFA01, tone: "warm" });
await writeFile(join(paletteRoot, "stone_monster_monster.png"), encodePng(body));
await writeFile(join(paletteRoot, "stone_monster_monsterLight.png"), encodePng(chest));

const manifestPath = join(root, "assets", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const monster = manifest.models.find((entry) => entry.file === "stone_monster.glb");
if (monster) {
	monster.bytes = output.length;
	monster.sha256 = createHash("sha256").update(output).digest("hex");
	monster.triangles = texturedTriangles;
	monster.textureCoordinates = "per-face spherical UVs with seam unwrapping";
}
for (const entry of manifest.paletteTextures ?? []) {
	if (!entry.file.startsWith("palettes/stone_monster_monster")) continue;
	const file = await readFile(join(root, "assets", "models", entry.file));
	entry.width = 512;
	entry.height = 512;
	entry.generated = "stone-organic-periodic-v4";
	entry.sha256 = createHash("sha256").update(file).digest("hex");
	delete entry.rgba;
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Textured ${texturedTriangles} triangles and generated two irregular stone maps for the Caracatoa Golem.`);
