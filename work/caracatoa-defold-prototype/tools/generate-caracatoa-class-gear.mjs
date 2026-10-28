import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfitRoot = join(root, "assets", "models", "quaternius", "outfits");
const licensedSourceRoot = join(root, "tools", "assets", "quaternius-universal-base-characters");
const licensedBaseRoot = join(licensedSourceRoot, "base");
const licensedHairRoot = join(licensedSourceRoot, "hairstyles");
const licensedTextureRoot = join(root, "assets", "models", "quaternius", "heads", "source");
const headAssetRoot = join(root, "assets", "models", "quaternius", "heads");
const outputRoot = join(root, "assets", "models", "quaternius", "class-gear");
const paletteRoot = join(root, "assets", "models", "quaternius", "palettes");
const animationSet = "/assets/models/quaternius/animations/CaracatoaHumanoid.animationset";

const palette = {
	Caracatoa_Red: [0.38, 0.035, 0.025, 1],
	Caracatoa_Red_Light: [0.68, 0.10, 0.045, 1],
	Caracatoa_Blue: [0.035, 0.12, 0.31, 1],
	Caracatoa_Blue_Light: [0.16, 0.38, 0.70, 1],
	Caracatoa_Green: [0.075, 0.20, 0.10, 1],
	Caracatoa_Green_Light: [0.25, 0.36, 0.16, 1],
	Caracatoa_Leather: [0.16, 0.075, 0.035, 1],
	Caracatoa_Leather_Light: [0.36, 0.20, 0.075, 1],
	Caracatoa_Gold: [0.78, 0.49, 0.10, 1],
	Caracatoa_Gold_Light: [0.96, 0.77, 0.29, 1],
	Caracatoa_Silver: [0.58, 0.66, 0.72, 1],
	Caracatoa_Steel: [0.25, 0.32, 0.40, 1],
	Caracatoa_Ivory: [0.80, 0.76, 0.64, 1],
	Caracatoa_White: [0.95, 0.92, 0.84, 1],
	Caracatoa_Purple: [0.38, 0.12, 0.72, 1],
	Caracatoa_Blue_Gem: [0.08, 0.62, 0.92, 1],
};

const classes = [
	{
		key: "transknight", label: "TK", source: "Male_Ranger.gltf", gender: "male", hair: "Hair_SimpleParted", hairTexture: "T_Hair_1_BaseColor.png", hairTint: [0.77, 0.43, 0.22],
		outfitMaterials: ["MI_Ranger", "MI_Regular_Male"],
		gear: (g, joints, head) => {
			const torso = joints.spine_03;
			addPlate(g, "Caracatoa_Red", "Caracatoa_Gold", torso, [
				[-0.20, 1.46], [-0.13, 1.55], [-0.04, 1.51], [0, 1.47], [0.04, 1.51], [0.13, 1.55], [0.20, 1.46], [0.16, 1.25], [0, 1.17], [-0.16, 1.25],
			], 0.155);
			addEllipsoid(g, "Caracatoa_Gold", [-0.22, 1.48, 0.055], [0.12, 0.085, 0.09], torso, 12, 7);
			addEllipsoid(g, "Caracatoa_Gold", [0.22, 1.48, 0.055], [0.12, 0.085, 0.09], torso, 12, 7);
			addEllipsoid(g, "Caracatoa_Red_Light", [-0.22, 1.48, 0.105], [0.085, 0.035, 0.025], torso, 10, 6);
			addEllipsoid(g, "Caracatoa_Red_Light", [0.22, 1.48, 0.105], [0.085, 0.035, 0.025], torso, 10, 6);
			addPrism(g, "Caracatoa_Gold", [[-0.18, 1.17], [0.18, 1.17], [0.16, 1.10], [-0.16, 1.10]], 0.16, 0.19, torso);
			addPrism(g, "Caracatoa_Red", [[-0.16, 1.10], [-0.015, 1.10], [-0.04, 0.87], [-0.14, 0.90]], 0.15, 0.18, joints.spine_01);
			addPrism(g, "Caracatoa_Red", [[0.015, 1.10], [0.16, 1.10], [0.14, 0.90], [0.04, 0.87]], 0.15, 0.18, joints.spine_01);
			addKnightSword(g, joints.hand_r, head.rightHand);
			addKnightShield(g, joints.hand_l, head.leftHand);
		},
	},
	{
		key: "foema", label: "Foema", source: "Female_Peasant.gltf", gender: "female", hair: "Hair_Long", hairTexture: "T_Hair_2_BaseColor.png", hairTint: [0.95, 0.76, 0.42],
		outfitMaterials: ["MI_Peasant"],
		gear: (g, joints, head) => {
			const torso = joints.spine_03;
			addPrism(g, "Caracatoa_Blue", [[-0.16, 1.42], [0.16, 1.42], [0.20, 0.92], [0.12, 0.78], [-0.12, 0.78], [-0.20, 0.92]], 0.15, 0.18, torso);
			addPrism(g, "Caracatoa_White", [[-0.11, 1.45], [0.11, 1.45], [0.13, 1.22], [0, 1.16], [-0.13, 1.22]], 0.185, 0.205, torso);
			addPrism(g, "Caracatoa_Gold", [[-0.17, 1.19], [0.17, 1.19], [0.18, 1.13], [-0.18, 1.13]], 0.19, 0.22, torso);
			addEllipsoid(g, "Caracatoa_Blue_Gem", [0, 1.38, 0.215], [0.035, 0.055, 0.018], torso, 9, 6);
			addStaff(g, joints.hand_l, head.leftHand);
		},
	},
	{
		key: "beastmaster", label: "BM", source: "Male_Peasant.gltf", gender: "male", hair: "Hair_Buzzed", beard: "Hair_Beard", hairTexture: "T_Hair_1_BaseColor.png", hairTint: [0.40, 0.27, 0.17],
		outfitMaterials: ["MI_Peasant"],
		gear: (g, joints, head) => {
			const torso = joints.spine_03;
			addEllipsoid(g, "Caracatoa_Leather_Light", [0, 1.49, -0.025], [0.28, 0.115, 0.19], torso, 16, 8);
			for (const side of [-1, 1]) {
				addEllipsoid(g, "Caracatoa_Green", [side * 0.22, 1.48, 0.045], [0.115, 0.08, 0.09], torso, 12, 7);
				addPrism(g, "Caracatoa_Leather", [[side * 0.15, 1.42], [side * 0.09, 1.38], [side * 0.20, 1.11], [side * 0.26, 1.14]], 0.16, 0.19, torso);
			}
			addPrism(g, "Caracatoa_Green_Light", [[-0.18, 1.19], [0.18, 1.19], [0.17, 1.11], [-0.17, 1.11]], 0.18, 0.21, torso);
			addGreataxe(g, joints.hand_r, head.rightHand);
		},
	},
	{
		key: "huntress", label: "HT", source: "Female_Ranger.gltf", gender: "female", hair: "Hair_BuzzedFemale", hairTexture: "T_Hair_1_BaseColor.png", hairTint: [0.72, 0.30, 0.18],
		outfitMaterials: ["MI_Ranger", "MI_Regular_Female"],
		gear: (g, joints, head) => {
			const torso = joints.spine_03;
			addPrism(g, "Caracatoa_Red", [[-0.20, 1.45], [0.20, 1.45], [0.16, 1.07], [0.08, 0.88], [-0.08, 0.88], [-0.16, 1.07]], -0.16, -0.12, torso);
			addPrism(g, "Caracatoa_Red_Light", [[-0.16, 1.42], [0.16, 1.42], [0.18, 1.27], [0, 1.20], [-0.18, 1.27]], 0.16, 0.19, torso);
			addPrism(g, "Caracatoa_Gold", [[-0.19, 1.21], [0.19, 1.21], [0.16, 1.16], [-0.16, 1.16]], 0.19, 0.22, torso);
			addBow(g, joints.hand_l, head.leftHand);
			addQuiver(g, torso);
		},
	},
];

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const tag = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
	return Buffer.concat([length, tag, data, crc]);
}

function hashUnit(x, y, seed) {
	let value = Math.imul((x + 1) | 0, 374761393) + Math.imul((y + 3) | 0, 668265263) + Math.imul(seed + 7, 1442695041);
	value = Math.imul(value ^ (value >>> 13), 1274126177);
	return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function smoothNoise(x, y, size, cells, seed) {
	const gx = x * cells / size;
	const gy = y * cells / size;
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const fx0 = gx - x0;
	const fy0 = gy - y0;
	const fx = fx0 * fx0 * (3 - 2 * fx0);
	const fy = fy0 * fy0 * (3 - 2 * fy0);
	const sample = (ix, iy) => hashUnit(ix, iy, seed);
	const top = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx;
	const bottom = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx;
	return top * (1 - fy) + bottom * fy;
}

function texturePng(rgba, materialName) {
	const size = 128;
	const seed = [...materialName].reduce((sum, character) => Math.imul(sum ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
	const metal = /Gold|Silver|Steel/i.test(materialName);
	const leather = /Leather/i.test(materialName);
	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const broad = smoothNoise(x, y, size, 5, seed);
			const mottling = smoothNoise(x, y, size, 19, seed ^ 0x39a2);
			const grain = smoothNoise(x, y, size, 47, seed ^ 0x712d);
			let value = 0.86 + (broad - 0.5) * 0.32 + (mottling - 0.5) * 0.19 + (grain - 0.5) * 0.08;
			const brush = Math.sin((x + y * (leather ? 0.44 : 0.17) + seed % 31) * 0.22 + (broad - 0.5) * 4);
			if (metal && brush > 0.985 && hashUnit(x, y, seed ^ 0x2f17) > 0.38) value += 0.13;
		if (metal && brush < -0.993 && hashUnit(x, y, seed ^ 0x4b91) > 0.48) value -= 0.16;
			if (leather && mottling < 0.19 && grain > 0.42) value -= 0.09;
			value = Math.max(0.55, Math.min(1.17, value));
			const offset = (y * size + x) * 4;
			pixels[offset] = Math.max(0, Math.min(255, Math.round(rgba[0] * value + (broad - 0.5) * 3)));
			pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(rgba[1] * value + (mottling - 0.5) * 2)));
			pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(rgba[2] * value - (broad - 0.5) * 2)));
			pixels[offset + 3] = 255;
		}
	}
	const scanlines = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y += 1) pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function linearToSrgbByte(value) {
	const srgb = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
	return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
}

function groupFor(groups, material) {
	if (!groups.has(material)) groups.set(material, { positions: [], normals: [], uvs: [], joints: [], weights: [], indices: [] });
	return groups.get(material);
}

function addEllipsoid(groups, material, center, radii, joint, segments = 14, rings = 9) {
	addSmoothEllipsoid(groups, material, center, radii, joint, segments, rings);
}

function addSmoothEllipsoid(groups, material, center, radii, joint, segments = 14, rings = 9) {
	const group = groupFor(groups, material);
	const start = group.positions.length / 3;
	for (let ring = 0; ring <= rings; ring += 1) {
		const theta = Math.PI * ring / rings;
		for (let segment = 0; segment <= segments; segment += 1) {
			const phi = Math.PI * 2 * segment / segments;
			const dx = Math.sin(theta) * Math.cos(phi);
			const dy = Math.cos(theta);
			const dz = Math.sin(theta) * Math.sin(phi);
			group.positions.push(center[0] + dx * radii[0], center[1] + dy * radii[1], center[2] + dz * radii[2]);
			const normal = normalize([dx / radii[0], dy / radii[1], dz / radii[2]]);
			group.normals.push(...normal);
			group.uvs.push(segment / segments, ring / rings);
			group.joints.push(joint, 0, 0, 0);
			group.weights.push(1, 0, 0, 0);
		}
	}
	for (let ring = 0; ring < rings; ring += 1) {
		for (let segment = 0; segment < segments; segment += 1) {
			const a = start + ring * (segments + 1) + segment;
			const b = a + segments + 1;
			const d = a + 1;
			const c = b + 1;
			group.indices.push(a, d, b, b, d, c);
		}
	}
}

function addFlatTriangle(groups, material, a, b, c, joint) {
	const group = groupFor(groups, material);
	const normal = normalize(cross(subtract(b, a), subtract(c, a)));
	const base = group.positions.length / 3;
	for (const [index, point] of [a, b, c].entries()) {
		group.positions.push(...point);
		group.normals.push(...normal);
		group.uvs.push(index === 1 ? 1 : 0, index === 2 ? 1 : 0);
		group.joints.push(joint, 0, 0, 0);
		group.weights.push(1, 0, 0, 0);
	}
	group.indices.push(base, base + 1, base + 2);
}

function addPrism(groups, material, polygon, frontZ, backZ, joint) {
	assert.ok(polygon.length >= 3, "a gear plate needs a closed polygon");
	const front = polygon.map(([x, y]) => [x, y, frontZ]);
	const back = [...polygon].reverse().map(([x, y]) => [x, y, backZ]);
	for (let i = 1; i < front.length - 1; i += 1) addFlatTriangle(groups, material, front[0], front[i], front[i + 1], joint);
	for (let i = 1; i < back.length - 1; i += 1) addFlatTriangle(groups, material, back[0], back[i], back[i + 1], joint);
	for (let i = 0; i < polygon.length; i += 1) {
		const next = (i + 1) % polygon.length;
		const a = front[i]; const b = front[next]; const c = [polygon[next][0], polygon[next][1], backZ]; const d = [polygon[i][0], polygon[i][1], backZ];
		addFlatTriangle(groups, material, a, b, c, joint);
		addFlatTriangle(groups, material, a, c, d, joint);
	}
}

function addBox(groups, material, center, half, joint) {
	const [x, y, z] = center; const [hx, hy, hz] = half;
	addPrism(groups, material, [[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy]], z + hz, z - hz, joint);
}

function addCylinderY(groups, material, center, radius, height, joint, segments = 10) {
	const [cx, cy, cz] = center;
	const low = []; const high = [];
	for (let i = 0; i < segments; i += 1) {
		const angle = Math.PI * 2 * i / segments;
		const x = cx + Math.cos(angle) * radius; const z = cz + Math.sin(angle) * radius;
		low.push([x, cy - height / 2, z]); high.push([x, cy + height / 2, z]);
	}
	for (let i = 0; i < segments; i += 1) {
		const next = (i + 1) % segments;
		addFlatTriangle(groups, material, low[i], low[next], high[next], joint);
		addFlatTriangle(groups, material, low[i], high[next], high[i], joint);
		addFlatTriangle(groups, material, [cx, cy - height / 2, cz], low[next], low[i], joint);
		addFlatTriangle(groups, material, [cx, cy + height / 2, cz], high[i], high[next], joint);
	}
}

function addPolylineRibbon(groups, material, points, thickness, frontZ, backZ, joint) {
	const left = []; const right = [];
	for (let i = 0; i < points.length; i += 1) {
		const prev = points[Math.max(0, i - 1)]; const next = points[Math.min(points.length - 1, i + 1)];
		const tangent = normalize([next[0] - prev[0], next[1] - prev[1], 0]);
		const nx = -tangent[1] * thickness / 2; const ny = tangent[0] * thickness / 2;
		left.push([points[i][0] + nx, points[i][1] + ny]);
		right.push([points[i][0] - nx, points[i][1] - ny]);
	}
	const polygon = [...left, ...right.reverse()];
	addPrism(groups, material, polygon, frontZ, backZ, joint);
}

function addPlate(groups, primary, trim, joint, polygon, z) {
	addPrism(groups, primary, polygon, z, z - 0.045, joint);
	for (const [x, y] of [polygon[0], polygon[Math.floor(polygon.length / 3)], polygon[Math.floor((polygon.length * 2) / 3)]]) {
		addSmoothEllipsoid(groups, trim, [x, y, z + 0.012], [0.018, 0.018, 0.012], joint, 8, 5);
	}
}

function addKnightSword(groups, joint, hand) {
	const [hx, hy, hz] = hand;
	const x = hx - 0.015; const z = hz + 0.035;
	addPrism(groups, "Caracatoa_Steel", [[x - 0.055, hy - 0.77], [x + 0.055, hy - 0.77], [x + 0.025, hy - 0.18], [x, hy - 0.10], [x - 0.025, hy - 0.18]], z, z - 0.035, joint);
	addBox(groups, "Caracatoa_Gold", [x, hy - 0.08, z + 0.006], [0.13, 0.022, 0.04], joint);
	addBox(groups, "Caracatoa_Leather", [x, hy + 0.02, z], [0.025, 0.085, 0.025], joint);
	addEllipsoid(groups, "Caracatoa_Gold_Light", [x, hy + 0.115, z], [0.04, 0.04, 0.035], joint, 8, 5);
}

function addKnightShield(groups, joint, hand) {
	const [hx, hy, hz] = hand;
	const x = hx + 0.02; const y = hy - 0.20; const z = hz + 0.04;
	addPrism(groups, "Caracatoa_Gold", [[x - 0.17, y + 0.25], [x + 0.17, y + 0.25], [x + 0.15, y - 0.14], [x, y - 0.29], [x - 0.15, y - 0.14]], z, z - 0.05, joint);
	addPrism(groups, "Caracatoa_Blue", [[x - 0.135, y + 0.21], [x + 0.135, y + 0.21], [x + 0.115, y - 0.12], [x, y - 0.225], [x - 0.115, y - 0.12]], z + 0.006, z - 0.004, joint);
	addEllipsoid(groups, "Caracatoa_Gold_Light", [x, y + 0.02, z + 0.02], [0.065, 0.10, 0.018], joint, 9, 6);
}

function addStaff(groups, joint, hand) {
	const [hx, hy, hz] = hand;
	const x = hx + 0.045; const z = hz + 0.075;
	addCylinderY(groups, "Caracatoa_Gold", [x, hy - 0.08, z], 0.018, 1.52, joint, 10);
	addCylinderY(groups, "Caracatoa_Silver", [x, hy + 0.52, z], 0.038, 0.22, joint, 10);
	addSmoothEllipsoid(groups, "Caracatoa_Blue_Gem", [x, hy + 0.74, z], [0.075, 0.12, 0.07], joint, 12, 8);
	addSmoothEllipsoid(groups, "Caracatoa_Purple", [x, hy + 0.74, z + 0.055], [0.04, 0.07, 0.025], joint, 10, 7);
}

function addGreataxe(groups, joint, hand) {
	const [hx, hy, hz] = hand;
	const x = hx - 0.015; const z = hz + 0.04;
	addCylinderY(groups, "Caracatoa_Leather", [x, hy - 0.32, z], 0.027, 1.20, joint, 10);
	addPrism(groups, "Caracatoa_Steel", [[x - 0.02, hy + 0.28], [x - 0.20, hy + 0.45], [x - 0.42, hy + 0.25], [x - 0.39, hy + 0.05], [x - 0.25, hy - 0.08], [x - 0.12, hy + 0.03]], z + 0.025, z - 0.035, joint);
	addPrism(groups, "Caracatoa_Gold", [[x - 0.02, hy + 0.25], [x - 0.18, hy + 0.39], [x - 0.32, hy + 0.24], [x - 0.31, hy + 0.11], [x - 0.20, hy + 0.02]], z + 0.04, z + 0.026, joint);
}

function addBow(groups, joint, hand) {
	const [hx, hy, hz] = hand;
	const x = hx + 0.04; const z = hz + 0.075;
	const points = [[x + 0.08, hy + 0.48], [x + 0.24, hy + 0.33], [x + 0.30, hy + 0.11], [x + 0.29, hy - 0.12], [x + 0.21, hy - 0.35], [x + 0.07, hy - 0.49]];
	addPolylineRibbon(groups, "Caracatoa_Gold", points, 0.045, z + 0.025, z - 0.02, joint);
	addPrism(groups, "Caracatoa_Ivory", [[x + 0.08, hy + 0.48], [x + 0.07, hy - 0.49], [x + 0.055, hy - 0.49], [x + 0.065, hy + 0.48]], z - 0.005, z - 0.018, joint);
}

function addQuiver(groups, joint) {
	addPrism(groups, "Caracatoa_Leather", [[-0.22, 1.50], [-0.14, 1.52], [-0.17, 1.14], [-0.26, 1.14]], -0.20, -0.14, joint);
	for (let index = 0; index < 3; index += 1) {
		const x = -0.23 + index * 0.045;
		addCylinderY(groups, "Caracatoa_Ivory", [x, 1.58, -0.13], 0.008, 0.43, joint, 6);
		addPrism(groups, "Caracatoa_Steel", [[x - 0.02, 1.80], [x + 0.02, 1.80], [x, 1.85]], -0.13, -0.16, joint);
	}
}

function normalize(vector) {
	const length = Math.hypot(...vector) || 1;
	return vector.map((value) => value / length);
}

function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function jointInfo(gltf) {
	const parent = Array(gltf.nodes.length).fill(-1);
	gltf.nodes.forEach((node, index) => (node.children ?? []).forEach((child) => { parent[child] = index; }));
	const skin = gltf.skins?.[0];
	assert.ok(skin?.joints?.length, "outfit skeleton is required");
	const nodeByName = new Map(gltf.nodes.map((node, index) => [node.name, index]));
	const skinIndex = (name) => {
		const node = nodeByName.get(name);
		const index = skin.joints.indexOf(node);
		assert.ok(index >= 0, `${name}: required skin joint is missing`);
		return index;
	};
	return {
		head: skinIndex("Head"), spine_03: skinIndex("spine_03"), spine_01: skinIndex("spine_01"),
		hand_r: skinIndex("hand_r"), hand_l: skinIndex("hand_l"),
		nodeByName,
		worldPosition(name) {
			let index = nodeByName.get(name);
			assert.ok(Number.isInteger(index), `${name}: required node is missing`);
			let result = [0, 0, 0];
			const chain = [];
			while (index >= 0) { chain.push(gltf.nodes[index]); index = parent[index]; }
			let rotation = [0, 0, 0, 1];
			let scale = [1, 1, 1];
			for (const node of chain.reverse()) {
				const local = node.translation ?? [0, 0, 0];
				const scaled = local.map((value, axis) => value * scale[axis]);
				const rotated = rotateQuaternion(rotation, scaled);
				result = result.map((value, axis) => value + rotated[axis]);
				scale = scale.map((value, axis) => value * (node.scale?.[axis] ?? 1));
				rotation = multiplyQuaternion(rotation, node.rotation ?? [0, 0, 0, 1]);
			}
			return result;
		},
	};
}

function multiplyQuaternion(a, b) {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

function rotateQuaternion(q, vector) {
	const value = multiplyQuaternion(multiplyQuaternion(q, [...vector, 0]), [-q[0], -q[1], -q[2], q[3]]);
	return value.slice(0, 3);
}

function appendBuffer(gltf, binary, typedArray, type, componentType, target, min, max) {
	while (binary.length % 4 !== 0) binary.push(0);
	const offset = binary.length;
	const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
	for (const byte of bytes) binary.push(byte);
	const bufferView = gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target }) - 1;
	return gltf.accessors.push({ bufferView, componentType, count: typedArray.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]), type, ...(min ? { min } : {}), ...(max ? { max } : {}) }) - 1;
}

function addMaterial(gltf, materialName) {
	let index = gltf.materials.findIndex((material) => material.name === materialName);
	if (index >= 0) return index;
	const color = palette[materialName];
	assert.ok(color, `${materialName}: material palette entry is missing`);
	index = gltf.materials.length;
	gltf.materials.push({
		name: materialName,
		pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: /Gold|Silver|Steel/.test(materialName) ? 0.72 : 0.02, roughnessFactor: /Gold|Silver|Steel/.test(materialName) ? 0.30 : 0.78 },
		doubleSided: true,
	});
	return index;
}

function decodeAccessor(gltf, binary, accessorIndex) {
	const accessor = gltf.accessors[accessorIndex];
	const view = gltf.bufferViews[accessor.bufferView];
	const typeInfo = {
		5120: { bytes: 1, read: "getInt8", signed: true },
		5121: { bytes: 1, read: "getUint8" },
		5122: { bytes: 2, read: "getInt16", signed: true },
		5123: { bytes: 2, read: "getUint16" },
		5125: { bytes: 4, read: "getUint32" },
		5126: { bytes: 4, read: "getFloat32", float: true },
	};
	const component = typeInfo[accessor.componentType];
	const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
	assert.ok(component && components, `unsupported glTF accessor ${accessorIndex}`);
	const stride = view.byteStride ?? component.bytes * components;
	const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
	const values = new Array(accessor.count * components);
	for (let row = 0; row < accessor.count; row += 1) {
		for (let column = 0; column < components; column += 1) {
			const byteOffset = offset + row * stride + column * component.bytes;
			let value = data[component.read](byteOffset, component.bytes > 1);
			if (accessor.normalized && !component.float) {
				const max = component.signed ? 2 ** (component.bytes * 8 - 1) - 1 : 2 ** (component.bytes * 8) - 1;
				value = component.signed ? Math.max(value / max, -1) : value / max;
			}
			values[row * components + column] = value;
		}
	}
	return { values, count: accessor.count, components };
}

function addLicensedMaterial(gltf, sourceGltf, sourceMaterialIndex, materialName, imageUri) {
	const existing = gltf.materials.findIndex((material) => material.name === materialName);
	if (existing >= 0) return existing;
	const original = sourceGltf.materials[sourceMaterialIndex];
	assert.ok(original?.pbrMetallicRoughness?.baseColorTexture, `${materialName}: source base-color texture is missing`);
	const imageIndex = gltf.images.findIndex((image) => image.uri === imageUri);
	const targetImageIndex = imageIndex >= 0 ? imageIndex : gltf.images.push({ uri: imageUri }) - 1;
	gltf.samplers ??= [];
	const samplerIndex = gltf.samplers.length ? 0 : gltf.samplers.push({}) - 1;
	const textureIndex = gltf.textures.push({ sampler: samplerIndex, source: targetImageIndex }) - 1;
	const material = structuredClone(original);
	material.name = materialName;
	material.pbrMetallicRoughness.baseColorTexture = { index: textureIndex };
	material.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
	delete material.pbrMetallicRoughness.metallicRoughnessTexture;
	delete material.normalTexture;
	delete material.occlusionTexture;
	delete material.emissiveTexture;
	material.doubleSided = true;
	gltf.materials.push(material);
	return gltf.materials.length - 1;
}

function ensureGroup(groups, material) {
	if (!groups.has(material)) groups.set(material, { positions: [], normals: [], uvs: [], joints: [], weights: [], indices: [] });
	return groups.get(material);
}

function appendImportedPrimitive(groups, targetGltf, materialName, sourceGltf, sourceBinary, primitive, keepTriangle = () => true) {
	const position = decodeAccessor(sourceGltf, sourceBinary, primitive.attributes.POSITION);
	const normal = decodeAccessor(sourceGltf, sourceBinary, primitive.attributes.NORMAL);
	const uv = decodeAccessor(sourceGltf, sourceBinary, primitive.attributes.TEXCOORD_0);
	const joint = decodeAccessor(sourceGltf, sourceBinary, primitive.attributes.JOINTS_0);
	const weight = decodeAccessor(sourceGltf, sourceBinary, primitive.attributes.WEIGHTS_0);
	const index = decodeAccessor(sourceGltf, sourceBinary, primitive.indices);
	assert.equal(position.count, normal.count, `${materialName}: source normal count`);
	assert.equal(position.count, uv.count, `${materialName}: source UV count`);
	assert.equal(position.count, joint.count, `${materialName}: source joint count`);
	assert.equal(position.count, weight.count, `${materialName}: source weight count`);
	const sourceSkin = sourceGltf.skins?.[0];
	assert.ok(sourceSkin?.joints?.length, `${materialName}: source skin missing`);
	const sourceJointNames = sourceSkin.joints.map((node) => sourceGltf.nodes[node].name);
	const targetJointByName = new Map(targetGltf.skins[0].joints.map((node, i) => [targetGltf.nodes[node].name, i]));
	const jointRemap = sourceJointNames.map((name) => targetJointByName.get(name));
	assert.ok(jointRemap.every((mapped) => Number.isInteger(mapped) && mapped < 255), `${materialName}: source joint names must exist on target rig`);
	const group = ensureGroup(groups, materialName);
	let triangles = 0;
	for (let offset = 0; offset < index.values.length; offset += 3) {
		const sourceIndices = index.values.slice(offset, offset + 3);
		if (!keepTriangle(sourceIndices, joint.values, weight.values, sourceJointNames)) continue;
		for (const sourceVertex of sourceIndices) {
			const outputVertex = group.positions.length / 3;
			for (let axis = 0; axis < 3; axis += 1) {
				group.positions.push(position.values[sourceVertex * 3 + axis]);
				group.normals.push(normal.values[sourceVertex * 3 + axis]);
			}
			group.uvs.push(uv.values[sourceVertex * 2], uv.values[sourceVertex * 2 + 1]);
			let totalWeight = 0;
			for (let influence = 0; influence < 4; influence += 1) totalWeight += weight.values[sourceVertex * 4 + influence];
			assert.ok(totalWeight > 0, `${materialName}: source vertex has no skin weight`);
			for (let influence = 0; influence < 4; influence += 1) {
				const sourceJoint = joint.values[sourceVertex * 4 + influence];
				group.joints.push(jointRemap[sourceJoint]);
				group.weights.push(weight.values[sourceVertex * 4 + influence] / totalWeight);
			}
			group.indices.push(outputVertex);
		}
		triangles += 1;
	}
	return triangles;
}

function headNeckTriangle() {
	const headNeck = new Set(["Head", "neck_01"]);
	return (vertices, joints, weights, names) => vertices.every((vertex) => {
		let influence = 0;
		for (let slot = 0; slot < 4; slot += 1) {
			if (headNeck.has(names[joints[vertex * 4 + slot]])) influence += weights[vertex * 4 + slot];
		}
		return influence >= 0.68;
	});
}

function assertCompatibleHeadRig(sourceGltf, targetGltf, sourceName) {
	const sourceNodes = new Map(sourceGltf.nodes.map((node) => [node.name, node]));
	const targetNodes = new Map(targetGltf.nodes.map((node) => [node.name, node]));
	for (const boneName of ["root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"]) {
		const source = sourceNodes.get(boneName); const target = targetNodes.get(boneName);
		assert.ok(source && target, `${sourceName}: required head rig bone ${boneName} is missing`);
		for (const [field, fallback] of [["translation", [0, 0, 0]], ["rotation", [0, 0, 0, 1]], ["scale", [1, 1, 1]]]) {
			const left = source[field] ?? fallback; const right = target[field] ?? fallback;
			assert.equal(left.length, right.length, `${sourceName}: ${boneName}.${field} size`);
			assert.ok(left.every((value, index) => Math.abs(value - right[index]) < 1e-5), `${sourceName}: ${boneName}.${field} differs from the active outfit rig`);
		}
	}
}

function tintPng(source, tint) {
	assert.equal(source.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "licensed hair texture must be PNG");
	let width; let height; let bitDepth; let colorType; const idat = [];
	for (let offset = 8; offset < source.length;) {
		const size = source.readUInt32BE(offset); const type = source.toString("ascii", offset + 4, offset + 8);
		const bytes = source.subarray(offset + 8, offset + 8 + size);
		if (type === "IHDR") { width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4); bitDepth = bytes[8]; colorType = bytes[9]; }
		if (type === "IDAT") idat.push(bytes);
		offset += 12 + size;
		if (type === "IEND") break;
	}
	assert.equal(bitDepth, 8, "licensed hair textures must use 8-bit channels");
	assert.ok(colorType === 2 || colorType === 6, "licensed hair textures must be RGB or RGBA");
	const channels = colorType === 6 ? 4 : 3; const stride = width * channels;
	const compressed = inflateSync(Buffer.concat(idat)); const pixels = Buffer.alloc(height * stride);
	const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
	for (let row = 0; row < height; row += 1) {
		const sourceOffset = row * (stride + 1); const filter = compressed[sourceOffset];
		for (let column = 0; column < stride; column += 1) {
			const raw = compressed[sourceOffset + 1 + column];
			const left = column >= channels ? pixels[row * stride + column - channels] : 0;
			const above = row > 0 ? pixels[(row - 1) * stride + column] : 0;
			const upperLeft = row > 0 && column >= channels ? pixels[(row - 1) * stride + column - channels] : 0;
			const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : null;
			assert.notEqual(predictor, null, `unsupported PNG filter ${filter}`);
			pixels[row * stride + column] = (raw + predictor) & 0xff;
		}
	}
	for (let pixel = 0; pixel < width * height; pixel += 1) for (let channel = 0; channel < 3; channel += 1) {
		const at = pixel * channels + channel;
		pixels[at] = Math.min(255, Math.round(pixels[at] * tint[channel]));
	}
	const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = colorType;
	const scanlines = Buffer.alloc(height * (stride + 1));
	for (let row = 0; row < height; row += 1) pixels.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function importLicensedHead(groups, gltf, character) {
	const stem = character.gender === "male" ? "Superhero_Male_FullBody" : "Superhero_Female_FullBody";
	const sourcePath = join(licensedBaseRoot, `${stem}.gltf`);
	const sourceGltf = JSON.parse(await readFile(sourcePath, "utf8"));
	assertCompatibleHeadRig(sourceGltf, gltf, stem);
	const sourceBinary = await readFile(join(licensedBaseRoot, sourceGltf.buffers[0].uri));
	const bodyNode = sourceGltf.nodes.find((node) => node.mesh !== undefined && !["Eyebrows", "Eyes"].includes(node.name));
	assert.ok(bodyNode, `${character.label}: licensed base head mesh not found`);
	assert.ok(!bodyNode.matrix && !bodyNode.translation && !bodyNode.rotation && !bodyNode.scale, `${character.label}: licensed body mesh must remain in bind space`);
	const sourceBody = sourceGltf.meshes[bodyNode.mesh].primitives[0];
	const headMaterialName = `Caracatoa_Face_${character.gender}`;
	const headTexture = character.gender === "male" ? "T_Superhero_Male_Dark.png" : "T_Superhero_Female_Dark_BaseColor.png";
	const headMaterialIndex = addLicensedMaterial(gltf, sourceGltf, sourceBody.material, headMaterialName, `../heads/source/${headTexture}`);
	const faceTriangles = appendImportedPrimitive(groups, gltf, headMaterialName, sourceGltf, sourceBinary, sourceBody, headNeckTriangle());
	assert.ok(faceTriangles > 1800, `${character.label}: expected a full licensed head and neck mesh`);
	const hairTextureBytes = await readFile(join(licensedTextureRoot, character.hairTexture));
	const hairTextureName = `${character.key}-hair.png`;
	await writeFile(join(headAssetRoot, hairTextureName), tintPng(hairTextureBytes, character.hairTint));
	const hairMaterialName = `Caracatoa_Hair_${character.key}`;
	const eyeTexture = "T_Eye_Brown.png";
	const featureNode = (name) => sourceGltf.nodes.find((node) => node.name === name && node.mesh !== undefined);
	for (const [featureName, alias] of [["Eyes", "Caracatoa_Eyes"], ["Eyebrows", hairMaterialName]]) {
		const node = featureNode(featureName);
		assert.ok(node, `${character.label}: licensed ${featureName} mesh not found`);
		const primitive = sourceGltf.meshes[node.mesh].primitives[0];
		const sourceMaterial = sourceGltf.materials[primitive.material];
		const textureName = featureName === "Eyes" ? eyeTexture : character.hairTexture;
		const outputTexture = featureName === "Eyes" ? `../heads/source/${textureName}` : `../heads/${hairTextureName}`;
		addLicensedMaterial(gltf, sourceGltf, primitive.material, alias, outputTexture);
		appendImportedPrimitive(groups, gltf, alias, sourceGltf, sourceBinary, primitive);
		assert.ok(sourceMaterial, `${character.label}: licensed ${featureName} material missing`);
	}
	let hairTriangles = 0;
	for (const style of [character.hair, character.beard].filter(Boolean)) {
		const hairPath = join(licensedHairRoot, `${style}.gltf`);
		const hairGltf = JSON.parse(await readFile(hairPath, "utf8"));
		assertCompatibleHeadRig(hairGltf, gltf, style);
		const hairBinary = await readFile(join(licensedHairRoot, hairGltf.buffers[0].uri));
		const hairNode = hairGltf.nodes.find((node) => node.mesh !== undefined);
		assert.ok(hairNode && !hairNode.matrix && !hairNode.translation && !hairNode.rotation && !hairNode.scale, `${style}: hairstyle mesh must remain in bind space`);
		for (const primitive of hairGltf.meshes[hairNode.mesh].primitives) {
			addLicensedMaterial(gltf, hairGltf, primitive.material, hairMaterialName, `../heads/${hairTextureName}`);
			hairTriangles += appendImportedPrimitive(groups, gltf, hairMaterialName, hairGltf, hairBinary, primitive);
		}
	}
	return { faceTriangles, hairTriangles, hairStyle: character.hair, beard: character.beard ?? null, texture: hairTextureName, headMaterial: headMaterialName, eyeMaterial: "Caracatoa_Eyes", hairMaterial: hairMaterialName, headTexture };
}

function writeMeshes(gltf, binary, groups, jointNames) {
	const jointMap = Object.fromEntries(jointNames.map((name) => [name, gltf.skins[0].joints.indexOf(gltf.nodes.findIndex((node) => node.name === name))]));
	const rootNode = gltf.scenes?.[gltf.scene ?? 0]?.nodes?.[0];
	assert.ok(Number.isInteger(rootNode), "GLTF character root must exist");
	const nodes = gltf.nodes[rootNode].children ?? (gltf.nodes[rootNode].children = []);
	for (const [material, group] of groups) {
		if (group.indices.length === 0) continue;
		const positions = new Float32Array(group.positions);
		const normals = new Float32Array(group.normals);
		const uvs = new Float32Array(group.uvs);
		const joints = new Uint8Array(group.joints);
		const weights = new Float32Array(group.weights);
		assert.equal(positions.length % 3, 0, `${material}: POSITION count`);
		const vertexCount = positions.length / 3;
		assert.equal(normals.length / 3, vertexCount, `${material}: NORMAL count`);
		assert.equal(uvs.length / 2, vertexCount, `${material}: TEXCOORD_0 count`);
		assert.equal(joints.length / 4, vertexCount, `${material}: JOINTS_0 count`);
		assert.equal(weights.length / 4, vertexCount, `${material}: WEIGHTS_0 count`);
		const indexArray = new Uint16Array(group.indices);
		const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis += 1) {
			min[axis] = Math.min(min[axis], positions[i + axis]); max[axis] = Math.max(max[axis], positions[i + axis]);
		}
		const attributes = {
			POSITION: appendBuffer(gltf, binary, positions, "VEC3", 5126, 34962, min, max),
			NORMAL: appendBuffer(gltf, binary, normals, "VEC3", 5126, 34962),
			TEXCOORD_0: appendBuffer(gltf, binary, uvs, "VEC2", 5126, 34962),
			JOINTS_0: appendBuffer(gltf, binary, joints, "VEC4", 5121, 34962),
			WEIGHTS_0: appendBuffer(gltf, binary, weights, "VEC4", 5126, 34962),
		};
		const indexAccessor = appendBuffer(gltf, binary, indexArray, "SCALAR", 5123, 34963);
		const meshIndex = gltf.meshes.push({
			name: `Caracatoa_${material}`,
			primitives: [{ attributes, indices: indexAccessor, material: addMaterial(gltf, material), mode: 4 }],
		}) - 1;
		const nodeIndex = gltf.nodes.push({ name: `Caracatoa_${material}_skinned`, mesh: meshIndex, skin: 0 }) - 1;
		nodes.push(nodeIndex);
	}
	assert.ok(Object.values(jointMap).every((index) => index >= 0 && index < 255), "skin joint indices fit in UBYTE");
}

function bindMeshVertices(groups) {
	return groups;
}

function modelTexturePath(uri) {
	if (uri.startsWith("../outfits/")) return `quaternius/outfits/${uri.slice("../outfits/".length)}`;
	if (uri.startsWith("../heads/")) return `quaternius/heads/${uri.slice("../heads/".length)}`;
	throw new Error(`unsupported class model texture URI: ${uri}`);
}

function createModelConfig(outputFile, gltf, paletteMaterials) {
	const materials = [
		...gltf.materials.flatMap((material) => {
			const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
			if (!Number.isInteger(textureIndex)) return [];
			const imageIndex = gltf.textures[textureIndex]?.source;
			const image = gltf.images[imageIndex];
			assert.ok(image?.uri, `${material.name}: texture image is missing`);
			return [{ name: material.name, texture: modelTexturePath(image.uri) }];
		}),
		...paletteMaterials.map((material) => ({ name: material, texture: `quaternius/palettes/${material}.png` })),
	];
	const lines = [
		`mesh: "/assets/models/quaternius/class-gear/${outputFile}.gltf"`,
		`name: "caracatoa_${outputFile}"`,
		`skeleton: "/assets/models/quaternius/class-gear/${outputFile}.gltf"`,
		`animations: "${animationSet}"`,
		'default_animation: "Idle_Loop"',
	];
	for (const material of materials) {
		lines.push("materials {", `  name: "${material.name}"`, '  material: "/builtins/materials/model_skinned.material"', "  textures {", '    sampler: "tex0"', `    texture: "/assets/models/${material.texture.replaceAll("\\", "/")}"`, "  }", "}");
	}
	lines.push("create_go_bones: false", "");
	return lines.join("\n");
}

async function generateCharacter(character) {
	const sourcePath = join(outfitRoot, character.source);
	const original = JSON.parse(await readFile(sourcePath, "utf8"));
	const sourceBuffer = await readFile(join(outfitRoot, original.buffers[0].uri));
	const gltf = structuredClone(original);
	for (const image of gltf.images ?? []) image.uri = `../outfits/${image.uri}`;
	const binary = [...sourceBuffer];
	const joints = jointInfo(gltf);
	const groups = new Map();
	const head = {
		position: joints.worldPosition("Head"),
		leftHand: joints.worldPosition("hand_l"),
		rightHand: joints.worldPosition("hand_r"),
	};
	const licensedHead = await importLicensedHead(groups, gltf, character);
	character.gear(bindMeshVertices(groups), joints, head);
	const jointNames = ["Head", "spine_03", "spine_01", "hand_r", "hand_l"];
	writeMeshes(gltf, binary, groups, jointNames);
	const outputFile = character.key;
	const bufferBytes = Buffer.from(binary);
	gltf.buffers[0].uri = `${outputFile}.bin`;
	gltf.buffers[0].byteLength = bufferBytes.length;
	await writeFile(join(outputRoot, `${outputFile}.bin`), bufferBytes);
	await writeFile(join(outputRoot, `${outputFile}.gltf`), `${JSON.stringify(gltf, null, 2)}\n`);
	const newMaterials = [...groups.keys()];
	const paletteMaterials = newMaterials.filter((material) => palette[material]);
	for (const material of paletteMaterials) {
		const linearColor = palette[material];
		const bytes = linearColor.slice(0, 3).map(linearToSrgbByte).concat(Math.round(linearColor[3] * 255));
		await writeFile(join(paletteRoot, `${material}.png`), texturePng(bytes, material));
	}
	await writeFile(join(root, "assets", "models", "quaternius", "classes", `${character.key}.model`), createModelConfig(outputFile, gltf, paletteMaterials));
	const vertexCount = [...groups.values()].reduce((sum, group) => sum + group.positions.length / 3, 0);
	const triangleCount = [...groups.values()].reduce((sum, group) => sum + group.indices.length / 3, 0);
	assert.ok(vertexCount > 700 && triangleCount > 600, `${character.label}: expected detailed attached geometry`);
	return { class: character.label, outputFile, vertexCount, triangleCount, addedMaterials: newMaterials.length, sourceOutfit: character.source, faceJoint: joints.head, licensedHead };
}

await mkdir(outputRoot, { recursive: true });
await mkdir(paletteRoot, { recursive: true });
await mkdir(headAssetRoot, { recursive: true });
const manifest = [];
for (const character of classes) manifest.push(await generateCharacter(character));
await writeFile(join(root, "assets", "class-gear-manifest.json"), `${JSON.stringify({ source: "CC0 Quaternius Universal Base Characters head/eyes/hairstyles, combined with original Caracatoa class identity gear", generated: new Date().toISOString(), visualMaterials: { size: "128x128 RGBA", finish: "irregular painted breakup, brushed metal wear, and restrained leather mottling" }, classes: manifest, materials: palette }, null, 2)}\n`);
console.log(`Generated licensed facial meshes and class gear: ${manifest.map((item) => `${item.class} ${item.triangleCount} triangles (${item.licensedHead.hairStyle})`).join("; ")}.`);
