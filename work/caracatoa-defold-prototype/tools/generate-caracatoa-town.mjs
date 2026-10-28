import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { gabledRoofSurfaces } from "./caracatoa-town-geometry.mjs";
import { encodePng as encodeOrganicPng, generateRoofShinglesV4, generateTownStoneV4 } from "../../../docs/art/concept/stone-organic-periodic-v1/generate-town-stone-v4.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ROOT = join(ROOT, "assets", "models");
const TEXTURE_ROOT = join(MODEL_ROOT, "town-textures");
const TOWN_LAYOUT_PATH = join(ROOT, "..", "..", "server", "caracatoa", "data", "world", "bastiao-layout.json");
const TOWN_LAYOUT = JSON.parse(await readFile(TOWN_LAYOUT_PATH, "utf8"));
const materials = [
  ["TownStone", "stone.png", [0.76, 0.72, 0.62, 1]],
  ["TownTrim", "trim.png", [0.88, 0.79, 0.58, 1]],
  ["TownShadow", "shadow.png", [0.30, 0.32, 0.34, 1]],
  ["TownPlaster", "plaster.png", [0.87, 0.79, 0.65, 1]],
  ["TownTimber", "timber.png", [0.33, 0.19, 0.11, 1]],
  ["TownRoofRed", "roof-red.png", [0.61, 0.20, 0.12, 1]],
  ["TownRoofBlue", "roof-blue.png", [0.22, 0.32, 0.42, 1]],
  ["TownGold", "gold.png", [0.79, 0.52, 0.19, 1]],
  ["TownBanner", "banner.png", [0.52, 0.035, 0.07, 1]],
  ["TownBlueBanner", "blue-banner.png", [0.06, 0.20, 0.45, 1]],
  ["TownGlass", "glass.png", [0.18, 0.52, 0.72, 1]],
  ["TownCobble", "cobble.png", [0.58, 0.56, 0.52, 1]],
  ["TownGrass", "grass.png", [0.22, 0.30, 0.19, 1]],
  ["TownWater", "water.png", [0.10, 0.45, 0.65, 1]],
  ["TownLeaf", "leaf.png", [0.20, 0.34, 0.21, 1]],
  ["TownTorch", "torch.png", [0.96, 0.56, 0.18, 1]],
];
const groups = new Map(materials.map(([name]) => [name, { positions: [], normals: [], uvs: [], indices: [] }]));

function seeded(x, y, salt = 0) {
  let value = Math.imul((x + 1) | 0, 374761393) + Math.imul((y + 3) | 0, 668265263) + Math.imul(salt + 7, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function cross(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...n) || 1;
  return n.map((v) => v / length);
}

function uvFor(point, normal) {
  if (Math.abs(normal[1]) > 0.65) return [point[0] * 0.22, point[2] * 0.22];
  return Math.abs(normal[0]) > Math.abs(normal[2])
    ? [point[2] * 0.24, point[1] * 0.24]
    : [point[0] * 0.24, point[1] * 0.24];
}

function triangle(material, a, b, c, uv = null) {
  const group = groups.get(material);
  const normal = cross(a, b, c);
  const vertices = [a, b, c];
  const texcoords = uv ?? vertices.map((point) => uvFor(point, normal));
  for (let index = 0; index < 3; index += 1) {
    group.positions.push(...vertices[index]);
    group.normals.push(...normal);
    group.uvs.push(...texcoords[index]);
    group.indices.push(group.indices.length);
  }
}

function quad(material, a, b, c, d) {
  triangle(material, a, b, c);
  triangle(material, a, c, d);
}

function bevelPoints(cx, cz, width, depth, bevel = 0.16) {
  const x = width / 2;
  const z = depth / 2;
  const cut = Math.min(x, z) * bevel;
  return [
    [cx - x + cut, cz - z], [cx + x - cut, cz - z],
    [cx + x, cz - z + cut], [cx + x, cz + z - cut],
    [cx + x - cut, cz + z], [cx - x + cut, cz + z],
    [cx - x, cz + z - cut], [cx - x, cz - z + cut],
  ];
}

function prism(cx, y, cz, width, height, depth, material, bevel = 0.14) {
  const points = bevelPoints(cx, cz, width, depth, bevel);
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const a = [points[index][0], y, points[index][1]];
    const b = [points[next][0], y, points[next][1]];
    const c = [points[next][0], y + height, points[next][1]];
    const d = [points[index][0], y + height, points[index][1]];
    quad(material, a, b, c, d);
  }
  const center = [cx, y + height, cz];
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    triangle(material, center, [points[next][0], y + height, points[next][1]], [points[index][0], y + height, points[index][1]]);
  }
}

function cylinder(cx, y, cz, radius, height, material, sides = 16, topRadius = radius) {
  const bottom = [];
  const top = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = index * Math.PI * 2 / sides;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    bottom.push([cx + cos * radius, y, cz + sin * radius]);
    top.push([cx + cos * topRadius, y + height, cz + sin * topRadius]);
  }
  const topCenter = [cx, y + height, cz];
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    quad(material, bottom[index], bottom[next], top[next], top[index]);
    triangle(material, topCenter, top[next], top[index]);
  }
}

function cone(cx, y, cz, radius, height, material, sides = 12, radiusTop = 0.04) {
  const base = [];
  const top = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = index * Math.PI * 2 / sides;
    base.push([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
    top.push([cx + Math.cos(angle) * radiusTop, y + height, cz + Math.sin(angle) * radiusTop]);
  }
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    quad(material, base[index], base[next], top[next], top[index]);
  }
}

function arch(cx, baseY, cz, radius, band, depth, material, segments = 14) {
  const zFront = cz + depth / 2;
  const zBack = cz - depth / 2;
  for (let index = 0; index < segments; index += 1) {
    const a0 = Math.PI * index / segments;
    const a1 = Math.PI * (index + 1) / segments;
    const outer0 = [cx + Math.cos(a0) * (radius + band), baseY + Math.sin(a0) * (radius + band)];
    const outer1 = [cx + Math.cos(a1) * (radius + band), baseY + Math.sin(a1) * (radius + band)];
    const inner0 = [cx + Math.cos(a0) * radius, baseY + Math.sin(a0) * radius];
    const inner1 = [cx + Math.cos(a1) * radius, baseY + Math.sin(a1) * radius];
    quad(material, [outer0[0], outer0[1], zFront], [outer1[0], outer1[1], zFront], [inner1[0], inner1[1], zFront], [inner0[0], inner0[1], zFront]);
    quad(material, [inner0[0], inner0[1], zBack], [inner1[0], inner1[1], zBack], [outer1[0], outer1[1], zBack], [outer0[0], outer0[1], zBack]);
    quad(material, [outer0[0], outer0[1], zBack], [outer1[0], outer1[1], zBack], [outer1[0], outer1[1], zFront], [outer0[0], outer0[1], zFront]);
    quad(material, [inner1[0], inner1[1], zBack], [inner0[0], inner0[1], zBack], [inner0[0], inner0[1], zFront], [inner1[0], inner1[1], zFront]);
  }
}

function pointedArch(cx, baseY, cz, width, height, band, depth, material, segments = 16) {
  const zFront = cz + depth / 2;
  const zBack = cz - depth / 2;
  const point = (side, t, expanded) => {
    const angle = t * Math.PI / 2;
    const radius = width / 2 + expanded;
    return [cx + side * radius * Math.cos(angle), baseY + (height + expanded * 0.78) * Math.sin(angle)];
  };
  for (const side of [-1, 1]) {
    for (let index = 0; index < segments; index += 1) {
      const t0 = index / segments;
      const t1 = (index + 1) / segments;
      const i0 = point(side, t0, 0); const i1 = point(side, t1, 0);
      const o0 = point(side, t0, band); const o1 = point(side, t1, band);
      quad(material, [o0[0], o0[1], zFront], [o1[0], o1[1], zFront], [i1[0], i1[1], zFront], [i0[0], i0[1], zFront]);
      quad(material, [i0[0], i0[1], zBack], [i1[0], i1[1], zBack], [o1[0], o1[1], zBack], [o0[0], o0[1], zBack]);
      quad(material, [o0[0], o0[1], zBack], [o1[0], o1[1], zBack], [o1[0], o1[1], zFront], [o0[0], o0[1], zFront]);
    }
  }
}

function ellipsoid(cx, cy, cz, rx, ry, rz, material, rings = 8, segments = 12) {
  const point = (ring, segment) => {
    const phi = Math.PI * ring / rings;
    const theta = Math.PI * 2 * segment / segments;
    return [cx + rx * Math.sin(phi) * Math.cos(theta), cy + ry * Math.cos(phi), cz + rz * Math.sin(phi) * Math.sin(theta)];
  };
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = point(ring, segment); const b = point(ring + 1, segment);
      const c = point(ring + 1, segment + 1); const d = point(ring, segment + 1);
      if (ring > 0) triangle(material, a, b, d);
      if (ring < rings - 1) triangle(material, b, c, d);
    }
  }
}

function roofPyramid(cx, y, cz, width, depth, height, material) {
  const corners = [
    [cx - width / 2, y, cz - depth / 2], [cx + width / 2, y, cz - depth / 2],
    [cx + width / 2, y, cz + depth / 2], [cx - width / 2, y, cz + depth / 2],
  ];
  const ridge = [cx, y + height, cz];
  for (let index = 0; index < corners.length; index += 1) {
    triangle(material, corners[index], corners[(index + 1) % 4], ridge);
  }
}

function gabledRoof(cx, y, cz, width, depth, height, material) {
	const surfaces = gabledRoofSurfaces(cx, y, cz, width, depth, height);
	for (const face of surfaces.roof) quad(material, ...face);
}

function house(cx, cz, width, depth, height, roofMaterial = "TownRoofRed") {
  prism(cx, 0.08, cz, width + 0.52, 0.42, depth + 0.52, "TownStone", 0.22);
  prism(cx, 0.43, cz, width, height - 0.28, depth, "TownPlaster", 0.22);
  prism(cx, height - 0.12, cz, width + 0.34, 0.28, depth + 0.35, "TownTrim", 0.18);
  const roofY = height + 0.12;
  const roofHeight = height * 0.62;
	const roofWidth = width + 0.85;
	const roofDepth = depth + 0.9;
	gabledRoof(cx, roofY, cz, roofWidth, roofDepth, roofHeight, roofMaterial);
  const front = cz + depth / 2 + 0.035;
  const back = cz - depth / 2 - 0.035;
	const gableBaseY = height - 0.08;
	const gablePeakY = roofY + roofHeight - 0.1;
	triangle("TownPlaster", [cx - width * 0.47, gableBaseY, front], [cx + width * 0.47, gableBaseY, front], [cx, gablePeakY, front]);
	triangle("TownPlaster", [cx + width * 0.47, gableBaseY, back], [cx - width * 0.47, gableBaseY, back], [cx, gablePeakY, back]);
	for (const side of [-1, 1]) {
		const eaveX = cx + side * roofWidth / 2;
		prism(eaveX, roofY - 0.08, cz, 0.16, 0.18, roofDepth, "TownTimber", 0.24);
		prism(eaveX, roofY + 0.045, cz, 0.12, 0.055, roofDepth + 0.08, "TownTrim", 0.3);
	}
	for (const face of [cz - roofDepth / 2, cz + roofDepth / 2]) {
    prism(cx, roofY - 0.04, face, width + 0.66, 0.16, 0.17, "TownTimber", 0.18);
  }
  const frontFace = front + 0.08;
  prism(cx, 0.45, frontFace, 1.48, 2.38, 0.12, "TownShadow", 0.15);
  prism(cx, 0.52, frontFace + 0.08, 1.16, 2.12, 0.11, "TownTimber", 0.15);
  prism(cx - 0.36, 0.66, frontFace + 0.15, 0.07, 1.82, 0.04, "TownGold", 0.18);
  prism(cx + 0.36, 0.66, frontFace + 0.15, 0.07, 1.82, 0.04, "TownGold", 0.18);
  cylinder(cx + 0.42, 1.45, frontFace + 0.17, 0.055, 0.08, "TownGold", 10, 0.05);
  pointedArch(cx, 2.64, frontFace, 1.58, 0.9, 0.18, 0.22, "TownGold", 16);
  pointedArch(cx, 2.66, frontFace + 0.035, 1.25, 0.72, 0.045, 0.1, "TownTrim", 16);
  for (const side of [-1, 1]) {
    const wx = cx + side * width * 0.31;
    const wy = Math.max(1.65, height * 0.5);
    prism(wx, wy - 0.4, frontFace, 0.68, 1.15, 0.1, "TownShadow", 0.13);
    prism(wx, wy - 0.29, frontFace + 0.07, 0.46, 0.88, 0.08, "TownGlass", 0.13);
    for (const offset of [-1, 1]) prism(wx + offset * 0.33, wy - 0.46, frontFace + 0.13, 0.1, 1.15, 0.1, "TownGold", 0.16);
    prism(wx, wy, frontFace + 0.13, 0.72, 0.1, 0.1, "TownTrim", 0.15);
    pointedArch(wx, wy + 0.67, frontFace + 0.08, 0.66, 0.5, 0.12, 0.14, "TownGold", 12);
  }
  for (const side of [-1, 1]) {
    prism(cx + side * (width * 0.43), 0.58, frontFace + 0.035, 0.16, height - 0.55, 0.12, "TownTimber", 0.16);
    prism(cx + side * (width * 0.43), height - 0.48, frontFace + 0.04, 0.24, 0.15, 0.14, "TownGold", 0.2);
  }
  for (const bandY of [1.15, height - 0.42]) prism(cx, bandY, frontFace + 0.04, width * 0.82, 0.11, 0.1, "TownTimber", 0.18);
  prism(cx, roofY + roofHeight * 0.4, front + 0.055, 0.72, 0.48, 0.11, "TownShadow", 0.18);
  pointedArch(cx, roofY + roofHeight * 0.4 + 0.46, front + 0.06, 0.72, 0.5, 0.11, 0.14, "TownGold", 12);
  prism(cx, roofY + roofHeight - 0.03, cz, 0.14, 0.18, depth + 0.96, "TownGold", 0.18);
}

function tower(cx, cz, radius = 2.3, height = 8.2) {
  cylinder(cx, 0.12, cz, radius, height, "TownStone", 32);
  cylinder(cx, 0.12, cz, radius + 0.22, 0.42, "TownTrim", 32, radius + 0.22);
  cylinder(cx, height - 0.25, cz, radius + 0.28, 0.55, "TownTrim", 32, radius + 0.1);
  cylinder(cx, height - 1.15, cz, radius + 0.08, 0.13, "TownGold", 32, radius + 0.08);
  cone(cx, height + 0.2, cz, radius + 0.45, 4.7, "TownRoofRed", 32, 0.12);
  cylinder(cx, height + 4.8, cz, 0.09, 0.9, "TownGold", 8, 0.02);
  for (let index = 0; index < 10; index += 1) {
    const angle = index * Math.PI / 5;
    const x = cx + Math.cos(angle) * (radius + 0.06);
    const z = cz + Math.sin(angle) * (radius + 0.06);
    cylinder(x, height + 0.2, z, 0.13, 0.58, "TownTrim", 8, 0.11);
  }
  const windowZ = cz + radius + 0.03;
  for (const xOffset of [-0.78, 0, 0.78]) {
    const wx = cx + xOffset;
    prism(wx, 3.2, windowZ, 0.44, 1.55, 0.09, "TownShadow", 0.15);
    prism(wx, 3.34, windowZ + 0.06, 0.25, 1.19, 0.07, "TownGlass", 0.14);
    pointedArch(wx, 4.72, windowZ + 0.03, 0.48, 0.42, 0.1, 0.14, "TownGold", 12);
    prism(wx, 3.26, windowZ + 0.1, 0.42, 0.1, 0.08, "TownTrim", 0.15);
  }
}

function banner(cx, y, cz, blue = false) {
  const cloth = blue ? "TownBlueBanner" : "TownBanner";
  cylinder(cx, y, cz, 0.055, 3.4, "TownGold", 8);
  const top = y + 3.1;
  const bottom = y + 1.15;
  const columns = 10; const rows = 8;
  for (let column = 0; column < columns; column += 1) {
    const u0 = column / columns; const u1 = (column + 1) / columns;
    for (let row = 0; row < rows; row += 1) {
      const v0 = row / rows; const v1 = (row + 1) / rows;
      const point = (u, v) => {
        const x = cx - 0.68 + u * 1.36;
        const edge = u < 0.2 ? u * 0.55 : u > 0.8 ? (1 - u) * 0.55 : 0.11;
        const hem = bottom + edge;
        const fold = Math.cos(u * Math.PI * 10 + v * 0.3) * 0.11;
        return [x, top * (1 - v) + hem * v, cz + fold];
      };
      quad(cloth, point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1));
    }
  }
  prism(cx, top - 0.08, cz, 1.48, 0.16, 0.2, "TownGold", 0.18);
  prism(cx - 0.64, bottom + 0.2, cz, 0.07, 1.66, 0.11, "TownGold", 0.16);
  prism(cx + 0.64, bottom + 0.2, cz, 0.07, 1.66, 0.11, "TownGold", 0.16);
  for (const offset of [-0.32, 0, 0.32]) prism(cx + offset, bottom + 0.86, cz + 0.13, 0.1, 0.36, 0.07, "TownGold", 0.28);
}

function lantern(cx, cz) {
  cylinder(cx, 0.15, cz, 0.08, 3.3, "TownTimber", 8);
  prism(cx, 3.3, cz, 0.65, 0.12, 0.65, "TownGold", 0.12);
  prism(cx, 3.42, cz, 0.48, 0.72, 0.48, "TownTorch", 0.18);
  roofPyramid(cx, 4.13, cz, 0.8, 0.8, 0.35, "TownRoofBlue");
}

function tree(cx, cz, height = 5.4) {
  cylinder(cx, 0.12, cz, 0.38, height * 0.55, "TownTimber", 10, 0.22);
  for (const [dx, dy, dz, rx, ry, rz] of [
    [-0.48, height * 0.68, 0.08, 1.18, 1.16, 1.08],
    [0.44, height * 0.74, -0.12, 1.24, 1.24, 1.15],
    [0, height * 0.96, 0.02, 1.12, 1.3, 1.05],
  ]) ellipsoid(cx + dx, dy, cz + dz, rx, ry, rz, "TownLeaf", 8, 12);
}

function fountain(cx, cz) {
  prism(cx, 0.12, cz, 5.4, 0.48, 5.4, "TownTrim", 0.3);
  cylinder(cx, 0.58, cz, 2.45, 0.3, "TownShadow", 24, 2.2);
  cylinder(cx, 0.83, cz, 2.1, 0.18, "TownWater", 24);
  cylinder(cx, 0.85, cz, 0.54, 1.2, "TownTrim", 14, 0.38);
  cylinder(cx, 2.05, cz, 0.65, 0.2, "TownGold", 14, 0.24);
  cone(cx, 2.25, cz, 0.24, 1.05, "TownTrim", 12, 0.03);
}

function createCity() {
  // Wide courtyard and a softly bordered ceremonial route.
  // Keep the grass foundation below the paved square. The previous height
  // order placed grass over the cobbles, hiding the city's main material.
  const { terrain, fountain: fountainData, houses, marketStalls, lanterns, trees, perimeterWalls, wallCrenellations } = TOWN_LAYOUT;
  const foundation = terrain.foundation;
  const paving = terrain.paving;
  const route = terrain.ceremonialRoute;
  prism(foundation.center[0], foundation.y, foundation.center[1], foundation.size[0], foundation.height, foundation.size[1], foundation.material, 0.12);
  prism(paving.center[0], paving.y, paving.center[1], paving.size[0], paving.height, paving.size[1], paving.material, 0.08);
  prism(route.center[0], route.gold.y, route.center[1], route.gold.size[0], route.gold.height, route.gold.size[1], "TownGold", 0.08);
  prism(route.center[0], route.cloth.y, route.center[1], route.cloth.size[0], route.cloth.height, route.cloth.size[1], "TownBanner", 0.08);
  for (const side of [-1, 1]) {
    prism(route.center[0] + side * route.rails.offsetX, route.rails.y, route.center[1], route.rails.width, route.rails.height, route.rails.depth, "TownGold", 0.15);
  }

  // The reviewed Portao Astral is a separate scene module at this end of the
  // square. Keep this plaza mesh clear so its detailed walls and forecourt do
  // not intersect a second, low-detail shrine.

  fountain(...fountainData.center);
  for (const building of houses) {
    house(building.center[0], building.center[1], building.width, building.depth, building.height, building.roofMaterial);
  }

  // Curved market canopies sit at the edge of the plaza.
  for (const stall of marketStalls) {
    const [x, z] = stall.center;
    const [counterWidth, counterDepth] = stall.counterSize;
    const postZ = stall.postLineZ;
    prism(x, 0.1, z, counterWidth, 0.48, counterDepth, "TownTimber", 0.18);
    for (const offset of stall.postOffsets) cylinder(x + offset, 0.55, postZ, 0.12, 3.2, "TownTimber", 8);
    prism(x, 3.7, postZ, counterWidth + 0.2, 0.14, counterDepth + 0.2, "TownBanner", 0.12);
    prism(x, 3.4, postZ, counterWidth + 0.05, 0.48, 0.15, stall.bannerMaterial, 0.12);
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      prism(x + stripe * stall.stripeStep, 3.38, postZ + 0.08, 0.12, 0.52, 0.08, "TownTrim", 0.1);
    }
  }

  for (const item of lanterns) lantern(...item.center);
  for (const item of trees) tree(item.center[0], item.center[1], item.height);

  // Low perimeter walls and corner towers frame the town while leaving a wide gate.
  for (const wall of perimeterWalls) {
    prism(wall.center[0], wall.baseY, wall.center[1], wall.width, wall.height, wall.depth, "TownStone", 0.16);
    for (let index = 0; index < wallCrenellations.count; index += 1) {
      prism(wall.center[0], wallCrenellations.y, wallCrenellations.startZ + index * wallCrenellations.stepZ, wallCrenellations.width, wallCrenellations.height, wallCrenellations.depth, "TownTrim", 0.14);
    }
  }
}

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
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3] ?? 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function stoneTexture(mode) {
  const width = 128; const height = 128;
  const palette = {
    stone: [170, 162, 143], trim: [210, 190, 148], shadow: [72, 76, 78], plaster: [218, 205, 178], timber: [105, 66, 41],
    roofRed: [170, 71, 49], roofBlue: [73, 106, 142], gold: [212, 153, 64], banner: [135, 27, 37], blueBanner: [28, 69, 135],
    glass: [49, 137, 184], cobble: [144, 136, 121], grass: [76, 99, 57], water: [45, 137, 181], leaf: [70, 111, 58], torch: [245, 163, 55],
  }[mode];
  return makePng(width, height, (x, y) => {
    const noise = (seed) => Math.round((seed - 0.5) * 22);
    let color = palette;
    if (mode === "stone" || mode === "trim" || mode === "shadow") {
      const blockX = Math.floor((x + (Math.floor(y / 18) % 2) * 10) / 32);
      const blockY = Math.floor(y / 18);
      const seam = ((x + (blockY % 2) * 10) % 32 < 2) || (y % 18 < 2);
      const mortar = mode === "shadow" ? [43, 45, 46] : mode === "trim" ? [98, 85, 65] : [69, 66, 59];
      color = seam ? mortar : palette.map((value, channel) => value + noise(seeded(blockX, blockY, channel)));
    } else if (mode === "plaster") {
      const wash = Math.sin(x * 0.07 + Math.sin(y * 0.035) * 1.6) * 5 + Math.cos(y * 0.09) * 3;
      const grain = noise(seeded(Math.floor(x / 3), Math.floor(y / 3), 31)) * 0.42;
      color = palette.map((value, channel) => value + wash + grain + (channel === 0 ? 2 : 0));
    } else if (mode === "cobble") {
      const cellX = x % 20; const cellY = y % 16;
      const row = Math.floor(y / 16);
      const offsetX = (row % 2) * 10;
      const xx = (x + offsetX) % 20;
      const inside = xx > 1 && xx < 18 && cellY > 1 && cellY < 14 && ((xx - 10) ** 2 / 105 + (cellY - 8) ** 2 / 46 < 1);
      const tint = Math.round((seeded(Math.floor(x / 20), row, 8) - 0.5) * 26);
      color = inside ? palette.map((value) => value + tint + (cellY < 5 ? 9 : 0)) : [56, 53, 50];
    } else if (mode === "roofRed" || mode === "roofBlue") {
      const row = Math.floor(y / 15);
      const col = Math.floor((x + (row % 2) * 16) / 16);
      const tile = (y % 15) > 2 && (x + (row % 2) * 16) % 16 > 1;
      const tint = Math.round((seeded(col, row, mode === "roofRed" ? 2 : 4) - 0.5) * 24);
      color = tile ? palette.map((value, channel) => value + tint + (y % 15 < 5 ? 13 : 0)) : [53, 48, 44];
    } else if (mode === "timber") {
      const grain = Math.sin(x * 0.26 + Math.sin(y * 0.08) * 1.7) * 12;
      color = palette.map((value, channel) => value + grain + noise(seeded(x, y, channel)) * 0.45);
    } else if (mode === "banner" || mode === "blueBanner") {
      const seam = x % 32 < 2 || x % 32 > 29;
      const fold = Math.cos(x * Math.PI * 2 / 128) * 9;
      const embroidery = (x % 32 === 16 && y % 20 < 13) || (y % 40 === 20 && x % 32 < 8);
      color = seam ? [193, 146, 70] : palette.map((value) => value + fold + (embroidery ? 38 : 0));
    } else if (mode === "glass") {
      const light = Math.max(0, 1 - Math.hypot(x - 42, y - 34) / 110);
      color = [palette[0] + light * 32, palette[1] + light * 60, palette[2] + light * 76];
    } else if (mode === "grass" || mode === "leaf") {
      const broad = Math.sin(x * 0.15) * 4 + Math.cos(y * 0.12) * 5;
      color = palette.map((value, channel) => value + broad + noise(seeded(Math.floor(x / 4), Math.floor(y / 4), channel)));
    } else if (mode === "water") {
      const ripple = Math.sin(x * 0.34 + y * 0.15) * 9 + Math.sin(y * 0.11) * 4;
      color = palette.map((value, channel) => value + ripple + noise(seeded(x, y, channel)) * 0.3);
    } else if (mode === "gold") {
      const shine = 10 * Math.sin(y * Math.PI / 14) + noise(seeded(x, y, 12));
      color = palette.map((value) => value + shine);
    } else if (mode === "torch") {
      const glow = Math.max(0, 1 - Math.hypot(x - 65, y - 60) / 90);
      color = [palette[0] + glow * 18, palette[1] + glow * 46, palette[2] + glow * 26];
    }
    return color.map((value) => Math.max(0, Math.min(255, Math.round(value))));
  });
}

function buildGlb() {
  createCity();
  const binaryChunks = [];
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  let binaryLength = 0;

  function appendBuffer(arrayBuffer, target, componentType, type, count, min, max) {
    const bytes = Buffer.from(arrayBuffer);
    const pad = (4 - (binaryLength % 4)) % 4;
    if (pad) { binaryChunks.push(Buffer.alloc(pad)); binaryLength += pad; }
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length, target });
    binaryChunks.push(bytes); binaryLength += bytes.length;
    const accessor = accessors.length;
    accessors.push({ bufferView: view, componentType, count, type, min, max });
    return accessor;
  }

  for (const [materialIndex, [name]] of materials.entries()) {
    const data = groups.get(name);
    if (!data.indices.length) continue;
    const positions = new Float32Array(data.positions);
    const normals = new Float32Array(data.normals);
    const uvs = new Float32Array(data.uvs);
    const indices = new Uint32Array(data.indices);
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis], positions[index + axis]); max[axis] = Math.max(max[axis], positions[index + axis]); }
    }
    const positionAccessor = appendBuffer(positions.buffer, 34962, 5126, "VEC3", positions.length / 3, min, max);
    const normalAccessor = appendBuffer(normals.buffer, 34962, 5126, "VEC3", normals.length / 3);
    const uvAccessor = appendBuffer(uvs.buffer, 34962, 5126, "VEC2", uvs.length / 2);
    const indexAccessor = appendBuffer(indices.buffer, 34963, 5125, "SCALAR", indices.length, [0], [indices.length - 1]);
    primitives.push({ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor }, indices: indexAccessor, material: materialIndex, mode: 4 });
  }

  let binary = Buffer.concat(binaryChunks);
  const json = {
    asset: { version: "2.0", generator: "Caracatoa original procedural town generator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Praca de Valedourada", mesh: 0 }],
    meshes: [{ name: "CaracatoaTown", primitives }],
    materials: materials.map(([name], index) => ({
      name,
      pbrMetallicRoughness: {
        // The palette is already baked into baseColorTexture; multiplying it
        // again here darkened the town a second time in Defold's model shader.
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index, texCoord: 0 },
        metallicFactor: name === "TownGold" ? 0.48 : name === "TownWater" ? 0.12 : 0.04,
        roughnessFactor: name === "TownGold" || name === "TownWater" ? 0.38 : 0.82,
      },
      doubleSided: true,
    })),
    textures: materials.map((_, index) => ({ sampler: index, source: index })),
    samplers: materials.map(() => ({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 })),
    images: materials.map(([, file]) => ({ uri: `town-textures/${file}` })),
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors,
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - jsonBytes.length % 4) % 4;
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - binary.length % 4) % 4;
  if (binaryPadding) binary = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(paddedJson.length, 0); jsonHeader.write("JSON", 4);
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.write("BIN\0", 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]);
}

await mkdir(TEXTURE_ROOT, { recursive: true });
const textureModes = ["stone", "trim", "shadow", "plaster", "timber", "roofRed", "roofBlue", "gold", "banner", "blueBanner", "glass", "cobble", "grass", "water", "leaf", "torch"];
const irregularStoneProfiles = new Map([
  ["TownStone", { seed: 20261030, tone: "basalt" }],
  ["TownTrim", { seed: 20261038, tone: "warm" }],
  ["TownShadow", { seed: 20261039, tone: "recess" }],
  ["TownCobble", { seed: 20261042, tone: "paving" }],
]);
for (const [index, [, file]] of materials.entries()) {
  const [name] = materials[index];
  if (irregularStoneProfiles.has(name)) {
    const image = generateTownStoneV4(irregularStoneProfiles.get(name));
    await writeFile(join(TEXTURE_ROOT, file), encodeOrganicPng(image));
  } else if (name === "TownRoofRed" || name === "TownRoofBlue") {
    const image = generateRoofShinglesV4({ seed: 20261034, color: name === "TownRoofRed" ? "crimson" : "slate" });
    await writeFile(join(TEXTURE_ROOT, file), encodeOrganicPng(image));
  } else {
    await writeFile(join(TEXTURE_ROOT, file), stoneTexture(textureModes[index]));
  }
}
const glb = buildGlb();
await writeFile(join(MODEL_ROOT, "caracatoa_town.glb"), glb);
const model = [
  'mesh: "/assets/models/caracatoa_town.glb"',
  'name: "caracatoa_town"',
  ...materials.flatMap(([name, file]) => [
    "materials {", `  name: "${name}"`, '  material: "/assets/materials/caracatoa_town.material"',
    "  textures {", '    sampler: "tex0"', `    texture: "/assets/models/town-textures/${file}"`, "  }", "}",
  ]),
  "",
].join("\n");
await writeFile(join(MODEL_ROOT, "caracatoa_town.model"), model);
const manifest = {
  schemaVersion: 1,
  scene: "Praça de Valedourada",
  style: "fantasia medieval Caracatoa, alvenaria biselada, arcadas, torres redondas, telhas e mosaicos",
  glbBytes: glb.length,
  materials: materials.map(([name, file]) => ({ name, texture: file })),
  generation: "determinística; toda geometria e textura pertence ao projeto Caracatoa",
};
await writeFile(join(ROOT, "assets", "caracatoa-town-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated the Caracatoa starting town: ${glb.length} GLB bytes, ${materials.length} textured material groups.`);
