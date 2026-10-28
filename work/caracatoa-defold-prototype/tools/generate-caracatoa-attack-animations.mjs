import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clipRoot = join(root, "assets", "models", "quaternius", "animations", "clips");
const idlePath = join(clipRoot, "Idle_Loop.glb");
const animationSetPath = join(root, "assets", "models", "quaternius", "animations", "CaracatoaHumanoid.animationset");

function parseGlb(bytes) {
	if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2.0 binary model.");
	let offset = 12;
	let json;
	let binary;
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32LE(offset);
		const type = bytes.readUInt32LE(offset + 4);
		offset += 8;
		const chunk = bytes.subarray(offset, offset + length);
		if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").trimEnd());
		if (type === 0x004e4942) binary = Buffer.from(chunk);
		offset += length;
	}
	if (!json || !binary) throw new Error("The source animation is missing a JSON or binary chunk.");
	return { json, binary };
}

function readVec(json, binary, accessorIndex, row) {
	const accessor = json.accessors[accessorIndex];
	const view = json.bufferViews[accessor.bufferView];
	if (accessor.componentType !== 5126 || accessor.type !== "VEC4") throw new Error(`Unexpected quaternion accessor ${accessorIndex}.`);
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + row * (view.byteStride ?? 16);
	return Array.from({ length: 4 }, (_, component) => binary.readFloatLE(start + component * 4));
}

function appendFloatAccessor(json, binaryChunks, values, components) {
	let byteOffset = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const padding = (4 - (byteOffset % 4)) % 4;
	if (padding) {
		binaryChunks.push(Buffer.alloc(padding));
		byteOffset += padding;
	}
	const payload = Buffer.alloc(values.length * 4);
	values.forEach((value, index) => payload.writeFloatLE(value, index * 4));
	const bufferView = json.bufferViews.length;
	json.bufferViews.push({ buffer: 0, byteOffset, byteLength: payload.length });
	binaryChunks.push(payload);
	const accessor = json.accessors.length;
	const count = values.length / components;
	const result = { bufferView, componentType: 5126, count, type: components === 1 ? "SCALAR" : `VEC${components}` };
	if (components === 1) {
		result.min = [Math.min(...values)];
		result.max = [Math.max(...values)];
	}
	json.accessors.push(result);
	return accessor;
}

function multiplyQuaternion(a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	const result = [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
	const length = Math.hypot(...result);
	return result.map((value) => value / length);
}

function axisQuaternion(axis, angle) {
	const half = angle / 2;
	const sine = Math.sin(half);
	return axis === "x" ? [sine, 0, 0, Math.cos(half)]
		: axis === "y" ? [0, sine, 0, Math.cos(half)]
			: [0, 0, sine, Math.cos(half)];
}

function rebuildGlb(json, binary) {
	const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
	const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
	const jsonChunk = Buffer.alloc(jsonLength, 0x20);
	jsonBytes.copy(jsonChunk);
	const binaryLength = Math.ceil(binary.length / 4) * 4;
	const binaryChunk = Buffer.alloc(binaryLength);
	binary.copy(binaryChunk);
	const header = Buffer.alloc(12);
	header.write("glTF", 0, "ascii");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binaryChunk.length, 8);
	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonChunk.length, 0);
	jsonHeader.writeUInt32LE(0x4e4f534a, 4);
	const binaryHeader = Buffer.alloc(8);
	binaryHeader.writeUInt32LE(binaryChunk.length, 0);
	binaryHeader.writeUInt32LE(0x004e4942, 4);
	return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

const source = parseGlb(await readFile(idlePath));
const sourceAnimation = source.json.animations?.find(({ name }) => name === "Idle_Loop");
if (!sourceAnimation) throw new Error("Idle_Loop was not found in the Quaternius source clip.");
const nodeIndex = new Map(source.json.nodes.map((node, index) => [node.name, index]));
const childNodes = new Set(source.json.nodes.flatMap((node) => node.children ?? []));
const animationNodeList = source.json.nodes.map((node) => Object.fromEntries(
	["name", "children", "translation", "rotation", "scale", "matrix"]
		.filter((key) => node[key] !== undefined)
		.map((key) => [key, node[key]]),
));
const animationRoots = source.json.nodes.flatMap((node, index) => childNodes.has(index) ? [] : [index]);
const baseRotations = new Map();
for (const channel of sourceAnimation.channels) {
	if (channel.target.path !== "rotation") continue;
	const name = source.json.nodes[channel.target.node]?.name;
	if (["spine_02", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l", "hand_l"].includes(name)) {
		baseRotations.set(name, readVec(source.json, source.binary, sourceAnimation.samplers[channel.sampler].output, 0));
	}
}

const times = [0, 0.11, 0.21, 0.35, 0.52];
const clips = [
	{
		name: "Caracatoa_TK_Slash",
		tracks: {
			spine_02: ["y", 0, 0.10, -0.20, 0.05, 0],
			upperarm_r: ["x", 0, 0.55, -0.92, -0.32, 0],
			lowerarm_r: ["x", 0, -0.25, 0.62, 0.18, 0],
			hand_r: ["y", 0, 0, 0.20, -0.08, 0],
			upperarm_l: ["x", 0, -0.16, 0.24, 0.04, 0],
			lowerarm_l: ["x", 0, 0.08, -0.14, 0, 0],
		},
	},
	{
		name: "Caracatoa_Foema_Cast",
		tracks: {
			spine_02: ["x", 0, -0.08, 0.10, 0.03, 0],
			upperarm_r: ["x", 0, -0.42, -0.72, -0.50, 0],
			lowerarm_r: ["x", 0, 0.28, 0.18, 0.04, 0],
			hand_r: ["z", 0, 0.08, 0.24, 0.12, 0],
			upperarm_l: ["x", 0, -0.38, -0.66, -0.46, 0],
			lowerarm_l: ["x", 0, 0.24, 0.16, 0.04, 0],
			hand_l: ["z", 0, -0.08, -0.22, -0.10, 0],
		},
	},
	{
		name: "Caracatoa_BM_Heavy",
		tracks: {
			spine_02: ["y", 0, -0.14, 0.22, 0.06, 0],
			upperarm_r: ["x", 0, 0.92, -1.06, -0.48, 0],
			lowerarm_r: ["x", 0, -0.62, 0.74, 0.22, 0],
			hand_r: ["z", 0, 0.16, -0.20, -0.06, 0],
			upperarm_l: ["x", 0, 0.24, -0.18, 0.04, 0],
			lowerarm_l: ["x", 0, -0.12, 0.08, 0, 0],
		},
	},
	{
		name: "Caracatoa_HT_Shot",
		tracks: {
			spine_02: ["y", 0, 0.08, -0.08, 0, 0],
			upperarm_l: ["x", 0, -0.68, -0.72, -0.58, 0],
			lowerarm_l: ["x", 0, 0.14, 0.08, 0.04, 0],
			upperarm_r: ["x", 0, 0.42, 0.48, 0.35, 0],
			lowerarm_r: ["x", 0, 0.46, 0.58, 0.38, 0],
			hand_r: ["z", 0, 0.12, 0.18, 0.06, 0],
		},
	},
];

for (const clip of clips) {
	for (const name of Object.keys(clip.tracks)) {
		if (!nodeIndex.has(name) || !baseRotations.has(name)) throw new Error(`Skeleton node ${name} is missing from the source clip.`);
	}
	const json = {
		asset: { version: "2.0", generator: "Caracatoa combat animation based on Quaternius CC0 rig" },
		scene: 0,
		scenes: [{ nodes: animationRoots }],
		nodes: animationNodeList,
		buffers: [{ byteLength: 0 }],
		bufferViews: [],
		accessors: [],
		animations: [],
	};
	const binaryChunks = [Buffer.alloc(0)];
	const input = appendFloatAccessor(json, binaryChunks, times, 1);
	const channels = [];
	const samplers = [];
	for (const [bone, track] of Object.entries(clip.tracks)) {
		const [axis, ...angles] = track;
		const base = baseRotations.get(bone);
		const rotations = angles.flatMap((angle) => multiplyQuaternion(base, axisQuaternion(axis, angle)));
		const output = appendFloatAccessor(json, binaryChunks, rotations, 4);
		const sampler = samplers.length;
		samplers.push({ input, output, interpolation: "LINEAR" });
		channels.push({ sampler, target: { node: nodeIndex.get(bone), path: "rotation" } });
	}
	const binary = Buffer.concat(binaryChunks);
	json.buffers[0].byteLength = binary.length;
	json.animations = [{ name: clip.name, samplers, channels }];
	const output = rebuildGlb(json, binary);
	const path = join(clipRoot, `${clip.name}.glb`);
	await writeFile(path, output);
	console.log(`${clip.name}: ${channels.length} articulated bone tracks, ${times.at(-1)}s, ${output.length} bytes, SHA-256 ${createHash("sha256").update(output).digest("hex")}`);
}

const animationPaths = ["Idle_Loop", "Walk_Loop", ...clips.map(({ name }) => name)];
const animationSet = animationPaths.map((name) =>
	`animations {\n\tanimation: "/assets/models/quaternius/animations/clips/${name}.glb"\n}`,
).join("\n") + '\nskeleton: "/assets/models/quaternius/outfits/Male_Ranger.gltf"\n';
await writeFile(animationSetPath, animationSet);
