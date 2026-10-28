import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(PROJECT, "..", "..", "docs", "art", "concept", "portao-astral-3d-v1");
const MODEL_PATH = resolve(OUTPUT, "models", "portao-astral-v1.glb");
const PI = Math.PI;

const materialDefs = [
  ["BasaltoNoturno", [0.25, 0.29, 0.34, 1], 0.04, 0.88, "stone"],
  ["BasaltoFrio", [0.15, 0.19, 0.24, 1], 0.08, 0.82, "stoneDark"],
  ["ArenitoVelho", [0.43, 0.40, 0.34, 1], 0.03, 0.92, "limestone"],
  ["FerroForjado", [0.10, 0.12, 0.15, 1], 0.78, 0.43, "iron"],
  ["BronzeEnvelhecido", [0.43, 0.24, 0.11, 1], 0.82, 0.34, "bronze"],
  ["DouradoContido", [0.72, 0.48, 0.20, 1], 0.74, 0.29, "gold"],
  ["ArdosiaAzul", [0.08, 0.12, 0.18, 1], 0.18, 0.69, "slate"],
  ["CarvalhoEscuro", [0.20, 0.10, 0.055, 1], 0.02, 0.82, "wood"],
  ["VeludoCarmesim", [0.28, 0.018, 0.036, 1], 0.04, 0.91, "crimson"],
  ["VidroLunar", [0.075, 0.20, 0.31, 1], 0.28, 0.24, "glassBlue"],
  ["VidroBrasa", [0.53, 0.105, 0.025, 1], 0.12, 0.30, "glassAmber", [0.32, 0.075, 0.012]],
  ["LuzDeBraseiro", [0.96, 0.32, 0.055, 1], 0.05, 0.33, "flame", [1.0, 0.27, 0.025]],
  ["PavimentoMolhado", [0.19, 0.21, 0.23, 1], 0.24, 0.44, "paving"],
  ["OuroDoTapete", [0.62, 0.37, 0.12, 1], 0.76, 0.32, "gold"],
];
const groups = new Map(materialDefs.map(([name]) => [name, { positions: [], normals: [], uvs: [], indices: [] }]));

function hashNoise(x, y, salt = 0) {
  let n = Math.imul((x + 31) | 0, 0x45d9f3b) ^ Math.imul((y + 67) | 0, 0x119de1f3) ^ Math.imul(salt + 11, 0x3449);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function normalOf(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const l = Math.hypot(...n);
  if (l < 1e-12) return [0, 1, 0];
  return n.map((value) => value / l);
}

function uvFor(point, normal) {
  if (Math.abs(normal[1]) > 0.62) return [point[0] * 0.22, point[2] * 0.22];
  return Math.abs(normal[0]) > Math.abs(normal[2])
    ? [point[2] * 0.30, point[1] * 0.30]
    : [point[0] * 0.30, point[1] * 0.30];
}

function tri(material, a, b, c, uv = null) {
  const group = groups.get(material);
  const normal = normalOf(a, b, c);
  const points = [a, b, c];
  const texcoords = uv ?? points.map((point) => uvFor(point, normal));
  for (let i = 0; i < 3; i += 1) {
    group.positions.push(...points[i]);
    group.normals.push(...normal);
    group.uvs.push(...texcoords[i]);
    group.indices.push(group.indices.length);
  }
}

function quad(material, a, b, c, d) {
  tri(material, a, b, c);
  tri(material, a, c, d);
}

function bevelBox(cx, y, cz, width, height, depth, material, bevel = 0.10, yaw = 0) {
  const hw = width / 2;
  const hd = depth / 2;
  const cut = Math.max(0.005, Math.min(hw, hd) * bevel);
  const corners = [
    [-hw + cut, -hd], [hw - cut, -hd], [hw, -hd + cut], [hw, hd - cut],
    [hw - cut, hd], [-hw + cut, hd], [-hw, hd - cut], [-hw, -hd + cut],
  ];
  const point = (x, yy, z) => [cx + x * Math.cos(yaw) - z * Math.sin(yaw), yy, cz + x * Math.sin(yaw) + z * Math.cos(yaw)];
  const bottom = corners.map(([x, z]) => point(x, y, z));
  const top = corners.map(([x, z]) => point(x, y + height, z));
  for (let i = 0; i < corners.length; i += 1) {
    const j = (i + 1) % corners.length;
    quad(material, bottom[i], bottom[j], top[j], top[i]);
  }
  for (let i = 0; i < corners.length; i += 1) {
    const j = (i + 1) % corners.length;
    tri(material, top[0], top[i], top[j]);
    tri(material, bottom[0], bottom[j], bottom[i]);
  }
}

function cylinder(cx, y, cz, radius, height, material, sides = 24, topRadius = radius, yaw = 0) {
  const bottom = [];
  const top = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = 2 * PI * i / sides + yaw;
    bottom.push([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
    top.push([cx + Math.cos(angle) * topRadius, y + height, cz + Math.sin(angle) * topRadius]);
  }
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    quad(material, bottom[i], bottom[j], top[j], top[i]);
    tri(material, [cx, y + height, cz], top[i], top[j]);
    tri(material, [cx, y, cz], bottom[j], bottom[i]);
  }
}

function cone(cx, y, cz, radius, height, material, sides = 24, topRadius = 0.04) {
  const bottom = [];
  const top = [];
  for (let i = 0; i < sides; i += 1) {
    const a = 2 * PI * i / sides;
    bottom.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
    top.push([cx + Math.cos(a) * topRadius, y + height, cz + Math.sin(a) * topRadius]);
  }
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    quad(material, bottom[i], bottom[j], top[j], top[i]);
    tri(material, [cx, y + height, cz], top[i], top[j]);
  }
}

function ellipsoid(cx, cy, cz, rx, ry, rz, material, rings = 10, segments = 16) {
  const point = (ring, segment) => {
    const phi = PI * ring / rings;
    const theta = PI * 2 * segment / segments;
    return [cx + rx * Math.sin(phi) * Math.cos(theta), cy + ry * Math.cos(phi), cz + rz * Math.sin(phi) * Math.sin(theta)];
  };
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = point(r, s); const b = point(r + 1, s);
      const c = point(r + 1, s + 1); const d = point(r, s + 1);
      if (r > 0) tri(material, a, b, d);
      if (r < rings - 1) tri(material, b, c, d);
    }
  }
}

function archPoint(cx, baseY, width, height, u, expand = 0) {
  const clamped = Math.max(-0.9999, Math.min(0.9999, u));
  return [cx + clamped * (width / 2 + expand), baseY + (height + expand * 0.82) * (1 - Math.pow(Math.abs(clamped), 1.42))];
}

function gabledRoof(cx, y, cz, width, depth, height, material) {
  const x0 = cx - width / 2; const x1 = cx + width / 2;
  const z0 = cz - depth / 2; const z1 = cz + depth / 2;
  const ridge0 = [cx, y + height, z0]; const ridge1 = [cx, y + height, z1];
  quad(material, [x0, y, z0], [cx, y, z0], ridge0, ridge1);
  quad(material, [cx, y, z0], [x1, y, z0], ridge0, ridge1);
  quad(material, [x1, y, z1], [cx, y, z1], ridge1, ridge0);
  quad(material, [cx, y, z1], [x0, y, z1], ridge1, ridge0);
  tri("ArenitoVelho", [x0, y, z0], [x1, y, z0], ridge0);
  tri("ArenitoVelho", [x1, y, z1], [x0, y, z1], ridge1);
}

function archBand(cx, baseY, cz, width, height, band, depth, material, segments = 28) {
  const zFront = cz + depth / 2;
  const zBack = cz - depth / 2;
  for (let i = 0; i < segments; i += 1) {
    const u0 = -1 + 2 * i / segments;
    const u1 = -1 + 2 * (i + 1) / segments;
    const o0 = archPoint(cx, baseY, width, height, u0, band);
    const o1 = archPoint(cx, baseY, width, height, u1, band);
    const i0 = archPoint(cx, baseY, width, height, u0, 0);
    const i1 = archPoint(cx, baseY, width, height, u1, 0);
    quad(material, [o0[0], o0[1], zFront], [o1[0], o1[1], zFront], [i1[0], i1[1], zFront], [i0[0], i0[1], zFront]);
    quad(material, [i0[0], i0[1], zBack], [i1[0], i1[1], zBack], [o1[0], o1[1], zBack], [o0[0], o0[1], zBack]);
    quad(material, [o0[0], o0[1], zBack], [o1[0], o1[1], zBack], [o1[0], o1[1], zFront], [o0[0], o0[1], zFront]);
    quad(material, [i1[0], i1[1], zBack], [i0[0], i0[1], zBack], [i0[0], i0[1], zFront], [i1[0], i1[1], zFront]);
  }
}

function pointedWindow(cx, baseY, cz, width, height, depth, glassMaterial) {
  const z = cz + depth / 2;
  bevelBox(cx, baseY, cz, width + 0.42, height + 0.12, depth, "BasaltoFrio", 0.16);
  bevelBox(cx, baseY + 0.20, z + 0.035, width - 0.24, height - 0.10, 0.05, glassMaterial, 0.08);
  archBand(cx, baseY + height - 0.64, z + 0.06, width - 0.24, 0.82, 0.16, 0.20, "BronzeEnvelhecido", 20);
  cylinder(cx, baseY + 0.22, z + 0.16, 0.035, height - 0.38, "BronzeEnvelhecido", 8);
  bevelBox(cx, baseY + 0.58, z + 0.16, width - 0.32, 0.045, 0.045, "BronzeEnvelhecido", 0.08);
}

function roseWindow(cx, cy, z) {
  const radius = 1.46;
  const segments = 20;
  for (let i = 0; i < segments; i += 1) {
    const a0 = 2 * PI * i / segments;
    const a1 = 2 * PI * (i + 1) / segments;
    const aMid = (a0 + a1) / 2;
    const mat = i % 4 === 0 ? "VidroBrasa" : i % 2 === 0 ? "VidroLunar" : "VidroBrasa";
    tri(mat, [cx, cy, z], [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, z], [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, z]);
    cylinder(cx + Math.cos(aMid) * radius * 0.58, cy + Math.sin(aMid) * radius * 0.58, z + 0.05, 0.045, 0.08, "BronzeEnvelhecido", 8, 0.035);
  }
  cylinder(cx, cy, z + 0.09, 0.28, 0.12, "BronzeEnvelhecido", 20, 0.22);
  for (let i = 0; i < 12; i += 1) {
    const angle = 2 * PI * i / 12;
    const x = cx + Math.cos(angle) * radius * 0.73;
    const y = cy + Math.sin(angle) * radius * 0.73;
    cylinder(x, y, z + 0.07, 0.05, 0.1, "DouradoContido", 8, 0.04);
  }
}

function heraldicStar(cx, cy, z, scale = 1, material = "DouradoContido") {
  const points = [
    [cx, cy + scale, z], [cx + scale * 0.22, cy + scale * 0.22, z],
    [cx + scale, cy, z], [cx + scale * 0.22, cy - scale * 0.22, z],
    [cx, cy - scale, z], [cx - scale * 0.22, cy - scale * 0.22, z],
    [cx - scale, cy, z], [cx - scale * 0.22, cy + scale * 0.22, z],
  ];
  for (let i = 0; i < points.length; i += 1) tri(material, [cx, cy, z + 0.05], points[i], points[(i + 1) % points.length]);
  cylinder(cx, cy, z + 0.08, scale * 0.13, 0.12, "BronzeEnvelhecido", 12, scale * 0.10);
}

function banner(cx, y, cz, width = 1.72, height = 4.0) {
  cylinder(cx, y, cz, 0.055, height + 0.8, "BronzeEnvelhecido", 10);
  cylinder(cx, y + height + 0.73, cz, 0.07, 0.38, "DouradoContido", 10, 0.025);
  bevelBox(cx, y + height + 0.55, cz, width + 0.22, 0.12, 0.18, "DouradoContido", 0.14);
  const rows = 18; const columns = 12;
  const top = y + height + 0.50;
  const hem = y + 0.48;
  const cloth = (u, v) => {
    const wave = Math.sin(u * PI * 5 + v * 1.7) * 0.15 + Math.sin(u * PI * 9 - v * 2) * 0.035;
    const edge = Math.abs(u - 0.5) * 0.13;
    return [cx + (u - 0.5) * width, top * (1 - v) + (hem + edge) * v, cz + wave];
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const u0 = col / columns; const u1 = (col + 1) / columns;
      const v0 = row / rows; const v1 = (row + 1) / rows;
      quad("VeludoCarmesim", cloth(u0, v0), cloth(u1, v0), cloth(u1, v1), cloth(u0, v1));
    }
  }
  for (const side of [-1, 1]) bevelBox(cx + side * (width / 2 - 0.055), y + height * 0.50, cz + 0.10, 0.09, height * 0.96, 0.08, "DouradoContido", 0.10);
  heraldicStar(cx, y + height * 0.56, cz + 0.20, 0.54, "DouradoContido");
  for (let i = 0; i < 5; i += 1) {
    cylinder(cx + (i - 2) * 0.29, hem + 0.12, cz + 0.14, 0.035, 0.18, "DouradoContido", 8, 0.025);
  }
}

function tower(cx, cz, radius = 2.65, shaftHeight = 11.4) {
  cylinder(cx, 0.18, cz, radius + 0.26, 0.42, "ArenitoVelho", 32);
  cylinder(cx, 0.58, cz, radius + 0.06, shaftHeight, "BasaltoNoturno", 32);
  cylinder(cx, 0.68, cz, radius + 0.18, 0.16, "BronzeEnvelhecido", 32);
  for (let row = 0; row < 8; row += 1) {
    const y = 1.0 + row * 1.25;
    const count = 16;
    for (let block = 0; block < count; block += 1) {
      const a = 2 * PI * (block + (row % 2) * 0.5) / count;
      const r = radius + 0.02;
      const stone = (row + block) % 7 === 0 ? "ArenitoVelho" : (row + block) % 3 === 0 ? "BasaltoFrio" : "BasaltoNoturno";
      bevelBox(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0.93, 1.14, 0.25, stone, 0.10, a + PI / 2);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = 2 * PI * i / 8;
    const x = cx + Math.cos(angle) * (radius - 0.12);
    const z = cz + Math.sin(angle) * (radius - 0.12);
    bevelBox(x, 0.75, z, 0.72, shaftHeight - 0.1, 0.78, "ArenitoVelho", 0.20, angle + PI / 2);
    bevelBox(x, 1.05, z + 0.34, 0.25, shaftHeight - 0.5, 0.12, "BronzeEnvelhecido", 0.12, angle + PI / 2);
  }
  for (const winY of [3.2, 7.5]) pointedWindow(cx, winY, cz + radius - 0.12, 0.82, 2.2, 0.18, winY > 5 ? "VidroBrasa" : "VidroLunar");
  cylinder(cx, shaftHeight + 0.56, cz, radius + 0.53, 0.56, "ArenitoVelho", 32, radius + 0.24);
  cylinder(cx, shaftHeight + 1.14, cz, radius + 0.46, 0.18, "DouradoContido", 32);
  for (let i = 0; i < 16; i += 1) {
    const angle = 2 * PI * i / 16;
    const x = cx + Math.cos(angle) * (radius + 0.42);
    const z = cz + Math.sin(angle) * (radius + 0.42);
    bevelBox(x, shaftHeight + 1.31, z, 0.54, 0.94, 0.58, "BasaltoNoturno", 0.18, angle + PI / 2);
    cylinder(x, shaftHeight + 2.20, z, 0.11, 0.22, "BronzeEnvelhecido", 10, 0.07);
  }
  cone(cx, shaftHeight + 1.35, cz, radius + 0.57, 4.9, "ArdosiaAzul", 32, 0.08);
  cylinder(cx, shaftHeight + 6.18, cz, 0.09, 0.82, "DouradoContido", 10, 0.02);
  for (let i = 0; i < 8; i += 1) {
    const angle = i * PI / 4;
    const x = cx + Math.cos(angle) * (radius + 0.22);
    const z = cz + Math.sin(angle) * (radius + 0.22);
    bevelBox(x, 0.78, z, 0.42, 6.3, 0.48, "ArenitoVelho", 0.17, angle + PI / 2);
    cylinder(x, 6.92, z, 0.14, 0.62, "DouradoContido", 10, 0.04);
  }
}

function brazier(cx, cz, height = 2.6) {
  bevelBox(cx, 0.14, cz, 1.12, 0.34, 1.12, "ArenitoVelho", 0.25);
  bevelBox(cx, 0.46, cz, 0.82, 0.30, 0.82, "BasaltoFrio", 0.25);
  cylinder(cx, 0.72, cz, 0.25, height - 0.8, "BronzeEnvelhecido", 12, 0.17);
  cylinder(cx, height - 0.12, cz, 0.68, 0.22, "FerroForjado", 16, 0.54);
  cylinder(cx, height + 0.08, cz, 0.51, 0.10, "DouradoContido", 16, 0.44);
  for (let i = 0; i < 8; i += 1) {
    const a = 2 * PI * i / 8;
    bevelBox(cx + Math.cos(a) * 0.54, height - 0.22, cz + Math.sin(a) * 0.54, 0.12, 0.54, 0.12, "BronzeEnvelhecido", 0.14, a);
  }
  ellipsoid(cx, height + 0.48, cz, 0.34, 0.75, 0.34, "LuzDeBraseiro", 9, 14);
  ellipsoid(cx - 0.14, height + 0.70, cz + 0.03, 0.17, 0.52, 0.17, "LuzDeBraseiro", 8, 12);
}

function masonryWing(side) {
  const xStart = side < 0 ? -12.0 : 4.0;
  const xEnd = side < 0 ? -4.0 : 12.0;
  for (let row = 0; row < 7; row += 1) {
    const y = 0.62 + row * 1.38;
    for (let x = xStart; x < xEnd; x += 2.2) {
      const offset = row % 2 ? 1.05 : 0;
      const cx = x + 1.04 + offset;
      if (side < 0 && cx > -3.8 || side > 0 && cx < 3.8) continue;
      const mat = (Math.floor(cx * 2) + row) % 5 === 0 ? "ArenitoVelho" : (row + Math.floor(cx)) % 3 === 0 ? "BasaltoFrio" : "BasaltoNoturno";
      bevelBox(cx, y, -4.0, 2.08, 1.30, 2.18, mat, 0.12);
    }
  }
  for (const x of [side * 4.1, side * 7.8, side * 11.35]) {
    bevelBox(x, 0.76, -2.77, 0.66, 9.6, 0.34, "ArenitoVelho", 0.16);
    bevelBox(x, 0.94, -2.55, 0.18, 8.7, 0.16, "BronzeEnvelhecido", 0.12);
    for (const y of [1.20, 9.95]) cylinder(x, y, -2.45, 0.40, 0.14, "DouradoContido", 12, 0.34);
  }
  for (let i = 0; i < 9; i += 1) {
    const x = side * (4.7 + i * 0.84);
    bevelBox(x, 10.36, -3.95, 0.62, 0.88, 1.38, "BasaltoNoturno", 0.18);
    cylinder(x, 11.23, -3.9, 0.11, 0.25, "BronzeEnvelhecido", 10, 0.04);
  }
}

function gateAndCourtyard() {
  // A confined threshold scene: real stone thickness, a 4.8 m opening and two keep towers.
  bevelBox(0, -0.20, 0.4, 40, 0.42, 43, "PavimentoMolhado", 0.02);
  for (let row = 0; row < 10; row += 1) {
    const z = -20 + row * 3.7;
    for (let col = 0; col < 10; col += 1) {
      const x = -18 + col * 4.0 + (row % 2) * 1.1;
      bevelBox(x, 0.02, z, 3.78, 0.10, 3.35, (row + col) % 8 === 0 ? "ArenitoVelho" : "PavimentoMolhado", 0.025);
    }
  }
  // Main wall with a genuine central void, layered stone courses, and the outer curtain wall.
  bevelBox(-8.15, 0.55, -5.0, 7.7, 10.1, 2.9, "BasaltoNoturno", 0.08);
  bevelBox(8.15, 0.55, -5.0, 7.7, 10.1, 2.9, "BasaltoNoturno", 0.08);
  bevelBox(0, 9.08, -5.0, 9.4, 2.95, 2.9, "BasaltoNoturno", 0.08);
  masonryWing(-1); masonryWing(1);
  bevelBox(0, 10.96, -5.0, 27.0, 0.30, 3.32, "DouradoContido", 0.07);
  tower(-14.6, -5.0, 2.72, 10.3);
  tower(14.6, -5.0, 2.72, 10.3);
  // Two higher keep towers establish the stepped skyline from the approved entry art.
  tower(-5.65, -9.15, 2.32, 15.6);
  tower(5.65, -9.15, 2.32, 15.6);
  bevelBox(0, 11.0, -9.2, 9.25, 7.15, 3.0, "BasaltoNoturno", 0.08);
  for (const side of [-1, 1]) {
    bevelBox(side * 4.45, 11.28, -7.62, 0.52, 6.55, 0.34, "ArenitoVelho", 0.16);
    bevelBox(side * 4.45, 11.55, -7.37, 0.16, 5.98, 0.12, "BronzeEnvelhecido", 0.12);
  }
  pointedWindow(0, 12.0, -7.62, 2.70, 4.40, 0.24, "VidroBrasa");
  archBand(0, 16.30, -7.46, 3.15, 1.04, 0.16, 0.36, "DouradoContido", 28);
  gabledRoof(0, 18.15, -9.2, 12.0, 5.8, 4.25, "ArdosiaAzul");
  bevelBox(0, 18.16, -6.20, 12.1, 0.24, 0.28, "DouradoContido", 0.14);
  // Heavy portal: three recessed archivolts, carved key stones, timber doors and an iron portcullis.
  bevelBox(-2.70, 0.56, -3.34, 0.42, 8.48, 1.45, "ArenitoVelho", 0.18);
  bevelBox(2.70, 0.56, -3.34, 0.42, 8.48, 1.45, "ArenitoVelho", 0.18);
  archBand(0, 8.25, -3.30, 5.40, 2.10, 0.56, 1.52, "ArenitoVelho", 32);
  archBand(0, 8.30, -2.45, 4.58, 1.83, 0.25, 1.42, "BronzeEnvelhecido", 32);
  archBand(0, 8.33, -1.68, 3.98, 1.57, 0.12, 0.65, "DouradoContido", 32);
  for (let i = 0; i <= 16; i += 1) {
    const u = -0.94 + i * 1.88 / 16;
    const [x, y] = archPoint(0, 8.31, 4.58, 1.83, u, 0.36);
    cylinder(x, y, -1.48, 0.075, 0.13, "DouradoContido", 10, 0.06);
  }
  bevelBox(-1.12, 0.62, -4.55, 2.20, 7.92, 0.42, "CarvalhoEscuro", 0.05);
  bevelBox(1.12, 0.62, -4.55, 2.20, 7.92, 0.42, "CarvalhoEscuro", 0.05);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i += 1) {
      bevelBox(side * (0.33 + i * 0.30), 0.80, -4.30, 0.08, 7.48, 0.08, "BronzeEnvelhecido", 0.11);
    }
    for (let row = 0; row < 9; row += 1) {
      for (const x of [side * 0.33, side * 1.92]) cylinder(x, 1.00 + row * 0.82, -4.22, 0.065, 0.09, "FerroForjado", 10, 0.055);
    }
  }
  cylinder(0, 4.14, -4.20, 0.15, 0.16, "DouradoContido", 14, 0.12);
  for (let i = -5; i <= 5; i += 1) cylinder(i * 0.43, 0.68, -2.82, 0.065, 7.8, "FerroForjado", 10, 0.045);
  for (const y of [1.55, 4.30, 7.02]) bevelBox(0, y, -2.80, 4.64, 0.12, 0.13, "FerroForjado", 0.12);
  for (let i = 0; i < 13; i += 1) {
    const x = -2.50 + i * 0.42;
    bevelBox(x, 8.52, -2.78, 0.09, 0.70, 0.12, "FerroForjado", 0.18);
    cone(x, 9.18, -2.78, 0.11, 0.30, "BronzeEnvelhecido", 8, 0.01);
  }
  roseWindow(0, 10.65, -3.16);
  archBand(0, 9.20, -3.10, 3.65, 1.12, 0.15, 0.60, "BronzeEnvelhecido", 24);
  // Two matching banners flank the door; carved crest remains original to Caracatoa.
  banner(-5.30, 3.15, -2.80, 1.62, 4.35);
  banner(5.30, 3.15, -2.80, 1.62, 4.35);
  // Six broad stone steps and a runner with separate bronze selvage and embroidered medallions.
  for (let i = 0; i < 8; i += 1) {
    const y = i * 0.21;
    const z = 10.0 - i * 1.60;
    bevelBox(0, y, z, 21.0 - i * 0.12, 0.42, 1.76, i % 2 === 0 ? "ArenitoVelho" : "BasaltoNoturno", 0.08);
    bevelBox(-2.38, y + 0.25, z, 0.10, 0.035, 1.44, "DouradoContido", 0.14);
    bevelBox(2.38, y + 0.25, z, 0.10, 0.035, 1.44, "DouradoContido", 0.14);
    bevelBox(0, y + 0.25, z + 0.06, 3.75, 0.035, 1.44, "VeludoCarmesim", 0.02);
    for (const edge of [-1, 1]) bevelBox(edge * 1.82, y + 0.27, z + 0.06, 0.055, 0.028, 1.44, "DouradoContido", 0.10);
  }
  // Bounded forecourt pavements and warm lamps define the human-scale approach.
  for (const x of [-8.2, -3.9, 3.9, 8.2]) {
    const z = x === -3.9 || x === 3.9 ? 3.0 : 8.0;
    bevelBox(x, 0.12, z, 1.42, 1.46, 1.40, "BasaltoFrio", 0.20);
    bevelBox(x, 1.55, z, 0.94, 0.18, 0.94, "BronzeEnvelhecido", 0.18);
    brazier(x, z, 2.0);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      bevelBox(side * 18.3, 0.08, -13.4 + i * 6.0, 1.30, 2.55, 1.36, "BasaltoNoturno", 0.18);
      bevelBox(side * 18.3, 2.60, -13.4 + i * 6.0, 1.58, 0.27, 1.62, "ArenitoVelho", 0.20);
    }
    banner(side * 18.3, 2.80, 4.6, 1.38, 3.6);
  }
  // Relief and ironwork at the entrance respond to light as the player approaches.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      const y = 1.55 + i * 1.36;
      bevelBox(side * 3.42, y, -2.45, 0.34, 0.86, 0.16, "DouradoContido", 0.26, side * 0.05);
      cylinder(side * 3.42, y + 0.36, -2.31, 0.13, 0.08, "BronzeEnvelhecido", 12, 0.10);
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

function pngChunk(name, data) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, check]);
}

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const c = pixel(x, y); const p = row + 1 + x * 4;
      raw[p] = c[0]; raw[p + 1] = c[1]; raw[p + 2] = c[2]; raw[p + 3] = c[3] ?? 255;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

function texture(kind) {
  const size = 192;
  const palettes = {
    stone: [80, 89, 101], stoneDark: [48, 57, 68], limestone: [119, 108, 89], iron: [43, 49, 57],
    bronze: [118, 71, 39], gold: [173, 119, 51], slate: [34, 48, 66], wood: [65, 37, 22],
    crimson: [91, 12, 24], glassBlue: [25, 67, 91], glassAmber: [142, 43, 9], flame: [241, 80, 15], paving: [71, 76, 81],
  };
  const base = palettes[kind];
  return png(size, size, (x, y) => {
    const noise = (hashNoise(Math.floor(x / 3), Math.floor(y / 3), kind.length) - 0.5) * (kind === "stone" || kind === "stoneDark" ? 26 : 18);
    let seam = false; let amount = noise;
    if (kind === "stone" || kind === "stoneDark" || kind === "limestone") {
      const row = Math.floor(y / 30); const shiftedX = (x + (row % 2) * 24) % 48;
      seam = shiftedX < 2 || y % 30 < 2;
      if (((x * 7 + y * 11) % 137) < 2) amount -= 20;
    } else if (kind === "slate") {
      seam = (y % 24 < 2) || ((x + (Math.floor(y / 24) % 2) * 20) % 40 < 2);
    } else if (kind === "crimson") {
      amount += Math.sin(x * 0.33) * 8 + Math.cos(x * 0.13 + y * 0.08) * 4;
      seam = x % 24 === 0;
    } else if (kind === "bronze" || kind === "gold") {
      amount += Math.sin((x + y * 0.22) * 0.40) * 7;
    } else if (kind === "paving") {
      const row = Math.floor(y / 26); const sx = (x + (row % 2) * 16) % 32; const sy = y % 26;
      seam = sx < 2 || sx > 29 || sy < 2 || sy > 23;
      amount += sy < 7 ? 8 : 0;
    } else if (kind === "wood") {
      amount += Math.sin(y * 0.22) * 8 + Math.sin(y * 0.08 + x * 0.035) * 9;
      seam = x % 48 < 2;
    } else if (kind === "glassBlue" || kind === "glassAmber") {
      amount += Math.sin((x + y) * 0.08) * 20;
      seam = x % 48 < 2 || y % 48 < 2;
    }
    if (seam) return [Math.max(0, base[0] * 0.50), Math.max(0, base[1] * 0.50), Math.max(0, base[2] * 0.48), 255];
    return base.map((channel) => Math.max(0, Math.min(255, Math.round(channel + amount)))).concat(255);
  });
}

function align4(buffer) {
  const padding = (4 - buffer.length % 4) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding)]) : buffer;
}

function buildGlb() {
  gateAndCourtyard();
  const binParts = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const images = [];
  const textures = [];
  const samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  const materials = [];
  let offset = 0;
  const addBuffer = (buffer, target = undefined) => {
    const padded = align4(buffer);
    const result = { buffer: 0, byteOffset: offset, byteLength: buffer.length };
    if (target) result.target = target;
    bufferViews.push(result); binParts.push(padded); offset += padded.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (view, componentType, count, type, min = null, max = null) => {
    const result = { bufferView: view, componentType, count, type, normalized: false };
    if (min) result.min = min;
    if (max) result.max = max;
    accessors.push(result);
    return accessors.length - 1;
  };
  for (const [name, color, metallic, roughness, textureName, emission] of materialDefs) {
    const imageView = addBuffer(texture(textureName));
    images.push({ name: name + "_BaseColor", bufferView: imageView, mimeType: "image/png" });
    textures.push({ sampler: 0, source: images.length - 1 });
    const material = {
      name,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: textures.length - 1 }, metallicFactor: metallic, roughnessFactor: roughness },
      doubleSided: true,
    };
    if (emission) material.emissiveFactor = emission;
    materials.push(material);
  }
  for (const [name, group] of groups) {
    if (!group.positions.length) continue;
    const posBuf = Buffer.alloc(group.positions.length * 4);
    const norBuf = Buffer.alloc(group.normals.length * 4);
    const uvBuf = Buffer.alloc(group.uvs.length * 4);
    const indBuf = Buffer.alloc(group.indices.length * 4);
    group.positions.forEach((v, i) => posBuf.writeFloatLE(v, i * 4));
    group.normals.forEach((v, i) => norBuf.writeFloatLE(v, i * 4));
    group.uvs.forEach((v, i) => uvBuf.writeFloatLE(v, i * 4));
    group.indices.forEach((v, i) => indBuf.writeUInt32LE(v, i * 4));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < group.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], group.positions[i + axis]);
        max[axis] = Math.max(max[axis], group.positions[i + axis]);
      }
    }
    const p = addAccessor(addBuffer(posBuf, 34962), 5126, group.positions.length / 3, "VEC3", min, max);
    const n = addAccessor(addBuffer(norBuf, 34962), 5126, group.normals.length / 3, "VEC3");
    const uv = addAccessor(addBuffer(uvBuf, 34962), 5126, group.uvs.length / 2, "VEC2");
    const indices = addAccessor(addBuffer(indBuf, 34963), 5125, group.indices.length, "SCALAR");
    meshes.push({ name: "PortaoAstral_" + name, primitives: [{ attributes: { POSITION: p, NORMAL: n, TEXCOORD_0: uv }, indices, material: materialDefs.findIndex((entry) => entry[0] === name), mode: 4 }] });
    nodes.push({ name: "PortaoAstral_" + name, mesh: meshes.length - 1 });
  }
  const binary = Buffer.concat(binParts);
  const document = {
    asset: { version: "2.0", generator: "Caracatoa Procedural Architecture Preview v1.0", copyright: "Caracatoa original procedural mesh and materials" },
    scene: 0, scenes: [{ name: "Entrada da Cidadela do Crepúsculo", nodes: nodes.map((_, index) => index) }], nodes, meshes,
    materials, textures, images, samplers, accessors, bufferViews,
    buffers: [{ byteLength: binary.length }],
    extras: { title: "Portão Astral de Valedourada", status: "isolated-review-preview", style: "gothic MMORPG fantasy, dark basalt, aged bronze, restrained gold, crimson fabric, amber embers and cool moonlight", scaleMeters: { width: 40, height: 24, depth: 43 }, proceduralTriangles: [...groups.values()].reduce((sum, group) => sum + group.indices.length / 3, 0) },
  };
  let json = Buffer.from(JSON.stringify(document), "utf8");
  const jsonPadding = (4 - json.length % 4) % 4;
  if (jsonPadding) json = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const glbHeader = Buffer.alloc(12); glbHeader.writeUInt32LE(0x46546c67, 0); glbHeader.writeUInt32LE(2, 4); glbHeader.writeUInt32LE(12 + jsonHeader.length + json.length + binHeader.length + binary.length, 8);
  return Buffer.concat([glbHeader, jsonHeader, json, binHeader, binary]);
}

async function main() {
  await mkdir(resolve(OUTPUT, "models"), { recursive: true });
  const glb = buildGlb();
  await writeFile(MODEL_PATH, glb);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8").trim());
  const vertexCount = json.accessors.filter((accessor) => accessor.type === "VEC3").reduce((sum, accessor) => sum + accessor.count, 0);
  const triangleCount = json.accessors.filter((accessor) => accessor.type === "SCALAR").reduce((sum, accessor) => sum + accessor.count / 3, 0);
  const manifest = {
    asset: "Portão Astral de Valedourada",
    revision: 1,
    status: "modelo aprovado pelo usuário e integrado ao cliente Defold; avaliação manual no mundo ainda pendente",
    dimensionsMeters: { width: 40, height: 24, depth: 43 },
    geometry: { vertices: vertexCount, triangles: triangleCount, materialSlots: json.materials.length, embeddedTextures: json.images.length },
    palette: ["basalto carvão", "arenito antigo", "ferro forjado", "bronze envelhecido", "ouro contido", "tecido carmesim", "vidro lunar", "brasa âmbar"],
    glbBytes: glb.length,
    integration: {
      model: "work/caracatoa-defold-prototype/assets/models/portao-astral.model",
      collection: "work/caracatoa-defold-prototype/main/main.collection",
      positionMeters: { x: 0, y: 0, z: -25 },
      uniformScale: 0.58,
      appearanceInClient: "14 slots de material e 14 texturas PNG mapeados ao shader original da cidade",
      validation: "Defold 1.14.0 Windows x86_64 archive build and bundle succeeded",
    },
    source: "gerador procedural original work/caracatoa-defold-prototype/tools/generate-gothic-gate-preview.mjs",
    referenceUsage: "A arte aprovada orienta composição, escala, paleta e iluminação. A malha, os ornamentos e o brasão são originais do Caracatoa.",
  };
  await writeFile(resolve(OUTPUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(resolve(OUTPUT, "README.md"), [
    "# Portão Astral de Valedourada — revisão 3D v1",
    "",
    "Módulo arquitetônico original do Caracatoa, criado a partir da direção visual aprovada. Depois da aprovação do usuário, a malha foi integrada à cidade inicial do cliente Defold.",
    "",
    "## Abrir a prévia",
    "",
    "1. Execute `node preview-server.mjs` nesta pasta; o servidor fica restrito a 127.0.0.1.",
    "2. Abra `http://127.0.0.1:48731/preview.html` em um navegador com conexão à internet.",
    "3. Arraste para orbitar, use a roda para aproximar e clique em `Baixar GLB` para guardar a malha.",
    "4. `models/portao-astral-v1.glb` também pode ser aberto em um visualizador GLB local.",
    "",
    "## Leitura de arte",
    "",
    "O conjunto é limitado a um pátio de 40 × 43 m: portal central de 4,8 m de vão, torreões com contrafortes, ameias, janelas em ogiva, roseta vítrea, grade de ferro, portas de carvalho, estandartes carmesim, escadaria, tapete e braseiros. A malha usa pedra basáltica fria, arenito claro, bronze envelhecido e luz âmbar com vidro azul lunar.",
    "",
    "Os materiais e os emblemas são próprios do Caracatoa. A imagem `portao-astral-preview-render.png` é um render por software da geometria deste GLB para revisão visual, não uma captura do jogo.",
    "",
    "## Integração no cliente",
    "",
    "O `integrate-gothic-gate.mjs` extrai os 14 PNGs embutidos e gera o recurso Model do Defold, preservando os nomes dos materiais. A instância fica no Bastião do Amanhecer em (0, 0, -25), escala uniforme 0,58; o antigo santuário simples e o pequeno dais foram removidos para abrir espaço ao conjunto. A build Defold 1.14.0 Windows x86_64 gerou archive e bundle com sucesso.",
    "",
    "A malha não tem rig, animação, colisão, LODs nem iluminação dinâmica. O build comprova importação e empacotamento, mas não substitui a revisão manual da leitura, escala e colisão dentro do mundo após entrar no cliente.",
    "",
    "## Dados da malha",
    "",
    "Consulte `manifest.json` para dimensões, número de triângulos, slots de material e tamanho do GLB.",
    "",
  ].join("\n"));
  await writeFile(resolve(OUTPUT, "preview.html"), [
    "<!doctype html>",
    "<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Caracatoa · Portão Astral</title>",
    "<script type=\"module\" src=\"https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js\"></script>",
    "<style>",
    "*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% 8%,#283341 0,#121923 48%,#080c12 100%);color:#e6d8ba;font:15px Georgia,serif;min-height:100vh;display:grid;place-items:center;padding:24px}.frame{width:min(1480px,100%);border:1px solid #987345;border-radius:20px;background:linear-gradient(135deg,#28221b,#11161d 18%,#0c1118 80%,#332416);box-shadow:0 18px 80px #000c,inset 0 0 0 4px #160f0a,inset 0 0 0 5px #70512e;padding:22px}.header{display:flex;justify-content:space-between;align-items:end;gap:20px;margin:0 10px 16px}.eyebrow{color:#ca9a4e;font:600 12px system-ui;letter-spacing:.22em;text-transform:uppercase}.title{font-size:clamp(26px,3vw,42px);margin:5px 0 0;color:#e4c27e;text-shadow:0 2px 7px #000}.pill{border:1px solid #846138;border-radius:99px;padding:8px 13px;color:#c4a36e;font:12px system-ui;white-space:nowrap}.viewer{height:min(72vh,820px);min-height:500px;border:1px solid #6f5637;border-radius:13px;background:radial-gradient(ellipse at 50% 88%,#a16a34 0%,#3c342e 17%,#1b222c 55%,#0c1118 100%);overflow:hidden;position:relative}.viewer:after{content:\"\";position:absolute;inset:0;pointer-events:none;background:linear-gradient(125deg,#87bfff14,transparent 42%,transparent 65%,#f39c3b10);box-shadow:inset 0 0 60px #0009}.viewer model-viewer{width:100%;height:100%;--poster-color:transparent}.status{position:absolute;z-index:2;left:16px;bottom:14px;padding:8px 12px;border:1px solid #987345;border-radius:99px;background:#10151ddd;color:#d6b676;font:12px system-ui}.footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 10px 0;color:#9299a4;font:13px/1.5 system-ui}.facts{display:flex;gap:18px;flex-wrap:wrap}.facts b{color:#d6b676;font-weight:600}.btn{display:inline-block;padding:11px 18px;border:1px solid #bb8c45;border-radius:10px;color:#f0dcae;text-decoration:none;background:linear-gradient(#51221c,#29120f);box-shadow:inset 0 1px #efc87955,0 4px 12px #0008;font:600 13px system-ui}.btn:hover{filter:brightness(1.2)}@media(max-width:720px){body{padding:10px}.frame{padding:14px}.header,.footer{align-items:flex-start;flex-direction:column}.viewer{height:68vh;min-height:420px}}",
    "</style></head><body><main class=\"frame\"><header class=\"header\"><div><div class=\"eyebrow\">Caracatoa · estudo de cenário 3D · v1</div><h1 class=\"title\">Portão Astral de Valedourada</h1></div><span class=\"pill\">PRÉVIA ISOLADA · ANTES DA INTEGRAÇÃO</span></header>",
    "<section class=\"viewer\"><model-viewer id=\"gate-model\" src=\"./models/portao-astral-v1.glb\" poster=\"./portao-astral-preview-render.png\" alt=\"Modelo 3D de uma entrada medieval gótica de pedra escura, bronze, estandartes carmesins e braseiros âmbar\" camera-controls touch-action=\"pan-y\" shadow-intensity=\"1.25\" shadow-softness=\"0.85\" exposure=\"1.0\" tone-mapping=\"aces\" environment-image=\"neutral\" camera-target=\"0m 10m -3m\" camera-orbit=\"18deg 70deg 47m\" min-camera-orbit=\"auto auto 22m\" max-camera-orbit=\"auto auto 75m\" interaction-prompt=\"auto\"></model-viewer><div class=\"status\" id=\"model-status\">Carregando malha 3D…</div></section>",
    "<footer class=\"footer\"><div class=\"facts\"><span><b>Composição:</b> portão, torres, pátio e escadaria</span><span><b>Materiais:</b> basalto, bronze, ferro e veludo</span><span><b>Luz:</b> brasa âmbar + vidro lunar</span><span><b>Malha:</b> geometria original Caracatoa</span></div><a class=\"btn\" href=\"./models/portao-astral-v1.glb\" download>Baixar GLB</a></footer></main><script>const gate=document.getElementById('gate-model');const status=document.getElementById('model-status');gate.addEventListener('load',()=>{status.textContent='3D ativo · arraste para orbitar'});gate.addEventListener('error',()=>{status.textContent='Malha GLB disponível para visualizador local'});</script></body></html>",
  ].join("\n"));
  await writeFile(resolve(OUTPUT, "preview-server.mjs"), [
    "import { createServer } from 'node:http';",
    "import { readFile, stat } from 'node:fs/promises';",
    "import { extname, resolve, sep } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "const root = resolve(fileURLToPath(new URL('.', import.meta.url)));",
    "const mime = { '.html':'text/html; charset=utf-8', '.glb':'model/gltf-binary', '.json':'application/json; charset=utf-8', '.png':'image/png', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };",
    "const server = createServer(async (request, response) => {",
    "  try {",
    "    if (request.method !== 'GET') { response.writeHead(405); response.end('Method not allowed'); return; }",
    "    const url = new URL(request.url, 'http://127.0.0.1:48731');",
    "    const relative = decodeURIComponent(url.pathname === '/' ? '/preview.html' : url.pathname);",
    "    const file = resolve(root, '.' + relative);",
    "    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }",
    "    const info = await stat(file);",
    "    if (!info.isFile()) { response.writeHead(404); response.end('Not found'); return; }",
    "    response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });",
    "    response.end(await readFile(file));",
    "  } catch { response.writeHead(404); response.end('Not found'); }",
    "});",
    "server.listen(48731, '127.0.0.1', () => console.log('Prévia local: http://127.0.0.1:48731/preview.html'));",
  ].join("\n") + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}

await main();
