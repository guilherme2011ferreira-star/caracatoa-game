import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ROOT = join(ROOT, "assets", "models");
const TEXTURE_ROOT = join(MODEL_ROOT, "altar-textures");
const materials = [
  ["AltarStone", "kersef-limestone.png", 0.04, 0.82],
  ["AltarTrim", "ivory-marble.png", 0.12, 0.54],
  ["AltarDark", "blue-slate.png", 0.02, 0.9],
  ["AltarGold", "etched-brass.png", 0.56, 0.34],
  ["AltarCurtain", "crimson-velvet.png", 0.0, 0.92],
  ["AltarBlue", "royal-velvet.png", 0.0, 0.92],
  ["AltarFloor", "marble-mosaic.png", 0.08, 0.58],
  ["AltarGlass", "sanctuary-glass.png", 0.24, 0.29],
  ["AltarEmber", "amber-lantern.png", 0.08, 0.42],
];
const groups = new Map(materials.map(([name]) => [name, { positions: [], normals: [], uvs: [], indices: [] }]));

function seeded(x, y, salt = 0) {
  let value = Math.imul((x + 1) | 0, 374761393) + Math.imul((y + 3) | 0, 668265263) + Math.imul(salt + 7, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
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

function altarTexture(kind) {
  const size = 256;
  const palettes = {
    stone: [151, 145, 132], trim: [207, 193, 160], dark: [38, 48, 65], gold: [184, 123, 42],
    red: [92, 17, 31], blue: [24, 40, 76], floor: [127, 119, 107], glass: [59, 101, 136], ember: [225, 124, 36],
  };
  const base = palettes[kind];
  return makePng(size, size, (x, y) => {
    const noise = (salt, amount = 1) => (seeded(x >> 2, y >> 2, salt) - 0.5) * amount;
    let shade = 0;
    let mortar = false;
    let accent = false;
    if (kind === "stone") {
      const course = Math.floor(y / 64);
      const localY = y % 64;
      const offset = course % 2 ? 44 : 0;
      const localX = (x + offset) % 112;
      mortar = localX < 5 || localX > 106 || localY < 5 || localY > 59;
      shade = localY < 12 ? 12 : localY > 52 ? -13 : (localX < 13 ? 5 : 0);
      accent = !mortar && localY > 20 && localY < 25 && seeded(x >> 4, y >> 4, 13) > 0.73;
    } else if (kind === "trim") {
      const vein = Math.sin(x * 0.045 + Math.sin(y * 0.031) * 2.4) + Math.sin(y * 0.081 - x * 0.022) * 0.3;
      shade = vein * 4 + (x % 64 < 2 ? 3 : 0);
    } else if (kind === "dark") {
      const grain = Math.sin(x * 0.12 + y * 0.05) * 3 + Math.sin(y * 0.1) * 2;
      shade = grain + noise(19, 16);
      accent = (x + y) % 83 < 2;
    } else if (kind === "gold") {
      const lx = x % 64; const ly = y % 64;
      const medallion = Math.abs(lx - 32) + Math.abs(ly - 32);
      shade = 7 * Math.sin(y * 0.11) + noise(23, 10);
      accent = medallion < 6 || (Math.abs(lx - 32) < 2 && ly > 13 && ly < 51) || (Math.abs(ly - 32) < 2 && lx > 13 && lx < 51);
    } else if (kind === "red" || kind === "blue") {
      const fold = Math.cos(x * Math.PI * 2 / 46) * 15 + Math.cos(x * Math.PI * 2 / 92) * 7;
      const border = x % 64 < 4 || x % 64 > 59;
      const embroidery = (Math.abs((x % 48) - 24) < 2 && y % 48 < 33) || (y % 48 < 2 && x % 48 < 22);
      shade = fold + noise(31, 9);
      accent = embroidery || border;
    } else if (kind === "floor") {
      const xx = x % 64; const yy = y % 64;
      const row = Math.floor(y / 64);
      const shifted = (xx + (row % 2) * 32) % 64;
      mortar = shifted < 4 || shifted > 60 || yy < 4 || yy > 60;
      const diamond = Math.abs(shifted - 32) + Math.abs(yy - 32);
      shade = yy < 14 ? 9 : yy > 54 ? -9 : 0;
      accent = diamond > 23 && diamond < 26;
    } else if (kind === "glass") {
      const panel = Math.floor(x / 64);
      const colors = [[76, 45, 105], [34, 112, 140], [128, 70, 32], [45, 91, 95]][panel];
      const lead = x % 64 < 4 || y % 64 < 4 || Math.abs((x % 64) - 32) < 3 || Math.abs((y % 64) - 32) < 2;
      const glint = Math.max(0, 1 - Math.hypot(x % 64 - 18, y % 64 - 15) / 63);
      return lead ? [45, 45, 55] : colors.map((value) => Math.min(230, value + glint * 32 + noise(47, 8)));
    } else if (kind === "ember") {
      const glow = Math.max(0, 1 - Math.hypot(x - 128, y - 126) / 174);
      shade = glow * 26 + noise(53, 8);
    }
    if (mortar) return [65, 62, 59, 255];
    const brightness = shade + noise(61, kind === "stone" ? 13 : 7);
    return base.map((value, channel) => {
      const pigment = accent && (kind === "gold" || kind === "red" || kind === "blue") ? (kind === "gold" ? 34 : 23) : 0;
      const highlight = accent && kind === "floor" ? (channel === 0 ? 26 : channel === 1 ? 22 : 13) : 0;
      return Math.max(0, Math.min(255, Math.round(value + brightness + pigment + highlight)));
    });
  });
}

function normalFor(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...n) || 1;
  return n.map((value) => value / length);
}

function triangle(material, a, b, c) {
  const group = groups.get(material);
  const normal = normalFor(a, b, c);
  for (const point of [a, b, c]) {
    group.positions.push(...point);
    group.normals.push(...normal);
    if (Math.abs(normal[1]) > 0.68) group.uvs.push(point[0] * 0.28, point[2] * 0.28);
    else group.uvs.push(point[0] * 0.34, point[1] * 0.34);
    group.indices.push(group.indices.length);
  }
}

function quad(material, a, b, c, d) {
  triangle(material, a, b, c);
  triangle(material, a, c, d);
}

function prism(cx, y, cz, width, height, depth, material, bevel = 0.12) {
  const hx = width / 2;
  const hz = depth / 2;
  const cut = Math.min(hx, hz) * bevel;
  const ring = [
    [cx - hx + cut, cz - hz], [cx + hx - cut, cz - hz],
    [cx + hx, cz - hz + cut], [cx + hx, cz + hz - cut],
    [cx + hx - cut, cz + hz], [cx - hx + cut, cz + hz],
    [cx - hx, cz + hz - cut], [cx - hx, cz - hz + cut],
  ];
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    quad(material,
      [ring[index][0], y, ring[index][1]], [ring[next][0], y, ring[next][1]],
      [ring[next][0], y + height, ring[next][1]], [ring[index][0], y + height, ring[index][1]]);
    triangle(material, [cx, y + height, cz],
      [ring[next][0], y + height, ring[next][1]], [ring[index][0], y + height, ring[index][1]]);
  }
}

function cylinder(cx, y, cz, radius, height, material, sides = 24, topRadius = radius) {
  const bottom = [];
  const top = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = index * Math.PI * 2 / sides;
    bottom.push([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
    top.push([cx + Math.cos(angle) * topRadius, y + height, cz + Math.sin(angle) * topRadius]);
  }
  const topCenter = [cx, y + height, cz];
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    quad(material, bottom[index], bottom[next], top[next], top[index]);
    triangle(material, topCenter, top[next], top[index]);
  }
}

function cone(cx, y, cz, radius, height, material, sides = 16, tipRadius = 0.02) {
  const bottom = [];
  const top = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = index * Math.PI * 2 / sides;
    bottom.push([cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius]);
    top.push([cx + Math.cos(angle) * tipRadius, y + height, cz + Math.sin(angle) * tipRadius]);
  }
  for (let index = 0; index < sides; index += 1) {
    quad(material, bottom[index], bottom[(index + 1) % sides], top[(index + 1) % sides], top[index]);
  }
}

function arch(cx, baseY, cz, radius, band, depth, material, segments = 24) {
  const front = cz + depth / 2;
  const back = cz - depth / 2;
  for (let index = 0; index < segments; index += 1) {
    const a0 = Math.PI * index / segments;
    const a1 = Math.PI * (index + 1) / segments;
    const outer0 = [cx + Math.cos(a0) * (radius + band), baseY + Math.sin(a0) * (radius + band)];
    const outer1 = [cx + Math.cos(a1) * (radius + band), baseY + Math.sin(a1) * (radius + band)];
    const inner0 = [cx + Math.cos(a0) * radius, baseY + Math.sin(a0) * radius];
    const inner1 = [cx + Math.cos(a1) * radius, baseY + Math.sin(a1) * radius];
    quad(material, [outer0[0], outer0[1], front], [outer1[0], outer1[1], front], [inner1[0], inner1[1], front], [inner0[0], inner0[1], front]);
    quad(material, [inner0[0], inner0[1], back], [inner1[0], inner1[1], back], [outer1[0], outer1[1], back], [outer0[0], outer0[1], back]);
    quad(material, [outer0[0], outer0[1], back], [outer1[0], outer1[1], back], [outer1[0], outer1[1], front], [outer0[0], outer0[1], front]);
    quad(material, [inner1[0], inner1[1], back], [inner0[0], inner0[1], back], [inner0[0], inner0[1], front], [inner1[0], inner1[1], front]);
  }
}

function pointedArch(cx, baseY, cz, width, height, band, depth, material, segments = 18) {
  const front = cz + depth / 2;
  const back = cz - depth / 2;
  const pathPoint = (side, t, expanded) => {
    const angle = t * Math.PI / 2;
    const radius = width / 2 + expanded;
    const rise = height + expanded * 0.8;
    return [cx + side * radius * Math.cos(angle), baseY + rise * Math.sin(angle)];
  };
  for (const side of [-1, 1]) {
    for (let index = 0; index < segments; index += 1) {
      const t0 = index / segments;
      const t1 = (index + 1) / segments;
      const inner0 = pathPoint(side, t0, 0);
      const inner1 = pathPoint(side, t1, 0);
      const outer0 = pathPoint(side, t0, band);
      const outer1 = pathPoint(side, t1, band);
      quad(material,
        [outer0[0], outer0[1], front], [outer1[0], outer1[1], front],
        [inner1[0], inner1[1], front], [inner0[0], inner0[1], front]);
      quad(material,
        [inner0[0], inner0[1], back], [inner1[0], inner1[1], back],
        [outer1[0], outer1[1], back], [outer0[0], outer0[1], back]);
      quad(material,
        [outer0[0], outer0[1], back], [outer1[0], outer1[1], back],
        [outer1[0], outer1[1], front], [outer0[0], outer0[1], front]);
      quad(material,
        [inner1[0], inner1[1], back], [inner0[0], inner0[1], back],
        [inner0[0], inner0[1], front], [inner1[0], inner1[1], front]);
    }
  }
}

function pilaster(cx, cz, height = 8.4, width = 0.76) {
  prism(cx, 0.12, cz, width + 0.72, 0.5, 1.08, "AltarTrim", 0.22);
  prism(cx, 0.58, cz, width + 0.34, height - 1.0, 0.78, "AltarStone", 0.22);
  for (const offset of [-0.2, 0.2]) {
    prism(cx + offset, 0.82, cz + 0.405, 0.045, height - 1.55, 0.045, "AltarTrim", 0.14);
  }
  prism(cx, height - 0.42, cz, width + 0.56, 0.28, 0.98, "AltarGold", 0.24);
  prism(cx, height - 0.12, cz, width + 0.92, 0.34, 1.22, "AltarTrim", 0.2);
}

function lancetWindow(cx, baseY, cz, width = 2.5, height = 4.4) {
  prism(cx, baseY, cz - 0.02, width * 0.72, height * 0.77, 0.08, "AltarDark", 0.14);
  prism(cx, baseY + 0.13, cz + 0.04, width * 0.64, height * 0.71, 0.06, "AltarGlass", 0.1);
  pointedArch(cx, baseY + height * 0.69, cz + 0.12, width * 0.68, height * 0.3, 0.16, 0.12, "AltarGold", 14);
  for (const side of [-1, 1]) {
    prism(cx + side * width * 0.35, baseY + 0.1, cz + 0.15, 0.16, height * 0.73, 0.18, "AltarTrim", 0.18);
  }
  prism(cx, baseY + height * 0.37, cz + 0.19, width * 0.65, 0.1, 0.2, "AltarGold", 0.2);
  prism(cx, baseY + 0.12, cz + 0.19, width * 0.72, 0.22, 0.24, "AltarTrim", 0.18);
}

function sidePointedArch(side, wallX, baseY, centerZ, width, height, band, depth, material, segments = 16) {
  const frontX = wallX + side * depth / 2;
  const backX = wallX - side * depth / 2;
  const point = (direction, t, expanded, x) => {
    const angle = t * Math.PI / 2;
    const radius = width / 2 + expanded;
    return [x, baseY + (height + expanded * 0.75) * Math.sin(angle), centerZ + direction * radius * Math.cos(angle)];
  };
  for (const direction of [-1, 1]) {
    for (let index = 0; index < segments; index += 1) {
      const t0 = index / segments;
      const t1 = (index + 1) / segments;
      const i0 = point(direction, t0, 0, frontX);
      const i1 = point(direction, t1, 0, frontX);
      const o0 = point(direction, t0, band, frontX);
      const o1 = point(direction, t1, band, frontX);
      quad(material, o0, o1, i1, i0);
      quad(material,
        point(direction, t1, 0, backX), point(direction, t0, 0, backX),
        point(direction, t0, band, backX), point(direction, t1, band, backX));
      quad(material, point(direction, t0, band, backX), point(direction, t1, band, backX), o1, o0);
    }
  }
}

function sideLancetWindow(side, wallX, centerZ, width = 2.2, height = 4.2) {
  const faceX = wallX - side * 0.32;
  prism(faceX, 1.85, centerZ, 0.08, height * 0.7, width * 0.72, "AltarDark", 0.12);
  prism(faceX - side * 0.035, 1.98, centerZ, 0.07, height * 0.65, width * 0.62, "AltarGlass", 0.12);
  for (const offset of [-1, 1]) {
    prism(faceX - side * 0.09, 1.92, centerZ + offset * width * 0.36, 0.15, height * 0.74, 0.16, "AltarTrim", 0.18);
  }
  prism(faceX - side * 0.09, 1.92, centerZ, 0.18, height * 0.7, 0.13, "AltarGold", 0.16);
  prism(faceX - side * 0.09, 3.15, centerZ, 0.18, 0.12, width * 0.66, "AltarGold", 0.16);
  prism(faceX - side * 0.09, 1.82, centerZ, 0.2, 0.24, width * 0.78, "AltarTrim", 0.18);
  sidePointedArch(side, faceX - side * 0.09, 4.05, centerZ, width * 0.64, 0.82, 0.18, 0.14, "AltarGold", 14);
  sidePointedArch(side, faceX - side * 0.1, 4.06, centerZ, width * 0.55, 0.73, 0.045, 0.08, "AltarTrim", 14);
}

function vaultedCeiling() {
  const frontZ = 10.6;
  const backZ = -10.9;
  const columns = 32;
  const rows = 14;
  const yAt = (x) => 6.0 + 4.75 * Math.max(0, 1 - (x / 11.1) ** 2);
  for (let row = 0; row < rows; row += 1) {
    const z0 = frontZ + (backZ - frontZ) * row / rows;
    const z1 = frontZ + (backZ - frontZ) * (row + 1) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x0 = -10.8 + 21.6 * column / columns;
      const x1 = -10.8 + 21.6 * (column + 1) / columns;
      quad("AltarDark", [x0, yAt(x0), z0], [x1, yAt(x1), z0], [x1, yAt(x1), z1], [x0, yAt(x0), z1]);
    }
  }
  for (const z of [8.5, 2.4, -3.7, -9.7]) {
    pointedArch(0, 5.85, z, 21.0, 4.85, 0.22, 0.32, "AltarTrim", 28);
    cylinder(0, 10.54, z, 0.22, 0.12, "AltarGold", 16, 0.22);
  }
  for (const side of [-1, 1]) {
    prism(side * 9.35, 9.48, -0.45, 0.2, 0.12, 21.6, "AltarGold", 0.18);
  }
}

function floorSeal(cx, cz) {
  cylinder(cx, 0.03, cz, 2.45, 0.035, "AltarDark", 48);
  cylinder(cx, 0.058, cz, 2.26, 0.035, "AltarGold", 48);
  cylinder(cx, 0.084, cz, 2.02, 0.035, "AltarFloor", 48);
  cylinder(cx, 0.11, cz, 1.5, 0.035, "AltarGold", 40);
  cylinder(cx, 0.137, cz, 1.31, 0.035, "AltarGlass", 40);
  for (let index = 0; index < 8; index += 1) {
    const angle = index * Math.PI / 4;
    const x = cx + Math.cos(angle) * 1.77;
    const z = cz + Math.sin(angle) * 1.77;
    prism(x, 0.13, z, 0.42, 0.05, 0.42, "AltarGold", 0.42);
  }
  cylinder(cx, 0.16, cz, 0.47, 0.04, "AltarTrim", 24);
  cylinder(cx, 0.19, cz, 0.28, 0.04, "AltarGlass", 24);
}

function curtainPanel(startX, endX, bottomStartX, bottomEndX, topY, bottomY, z, material, phase = 0) {
  const columns = 28;
  const rows = 8;
  for (let column = 0; column < columns; column += 1) {
    const u0 = column / columns;
    const u1 = (column + 1) / columns;
    for (let row = 0; row < rows; row += 1) {
      const v0 = row / rows;
      const v1 = (row + 1) / rows;
      const point = (u, v) => {
        const topX = startX + (endX - startX) * u;
        const bottomX = bottomStartX + (bottomEndX - bottomStartX) * u;
        const x = topX * (1 - v) + bottomX * v;
        const y = topY * (1 - v) + bottomY * v - Math.sin(u * Math.PI * 12 + phase) * Math.sin(v * Math.PI) * 0.18;
        const folds = Math.cos(u * Math.PI * 18 + phase) * (0.17 + 0.09 * v);
        return [x, y, z + folds];
      };
      quad(material, point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1));
    }
  }
}

function column(cx, cz, height = 8.2) {
  cylinder(cx, 0.05, cz, 0.9, 0.46, "AltarTrim", 28, 0.84);
  cylinder(cx, 0.51, cz, 0.72, height - 1.0, "AltarStone", 28, 0.64);
  for (let groove = 0; groove < 8; groove += 1) {
    const angle = groove * Math.PI / 4;
    const x = cx + Math.cos(angle) * 0.67;
    const z = cz + Math.sin(angle) * 0.67;
    cylinder(x, 0.75, z, 0.038, height - 1.5, "AltarTrim", 8);
  }
  cylinder(cx, height - 0.48, cz, 0.86, 0.22, "AltarGold", 28, 0.9);
  prism(cx, height - 0.24, cz, 2.0, 0.34, 1.8, "AltarTrim", 0.18);
}

function createAltar() {
  prism(0, -0.52, -1.6, 23.5, 0.4, 28, "AltarDark", 0.08);
  prism(0, -0.16, -1.6, 22, 0.14, 26.5, "AltarFloor", 0.07);
  prism(0, -0.005, -1.0, 6.4, 0.045, 21.7, "AltarGold", 0.08);
  prism(0, 0.02, -1.0, 5.9, 0.04, 21.4, "AltarCurtain", 0.08);
  prism(-3.17, 0.02, -1.0, 0.12, 0.06, 21.6, "AltarGold", 0.12);
  prism(3.17, 0.02, -1.0, 0.12, 0.06, 21.6, "AltarGold", 0.12);

  prism(0, 0.02, -11.6, 21, 9.7, 0.76, "AltarStone", 0.05);
  prism(0, 0.14, -11.12, 20.4, 0.42, 0.2, "AltarTrim", 0.12);
  prism(0, 9.15, -11.12, 20.4, 0.5, 0.22, "AltarTrim", 0.12);
  prism(0, 6.25, -11.12, 20.7, 0.18, 0.2, "AltarGold", 0.12);
  for (const x of [-9.7, -4.4, 4.4, 9.7]) pilaster(x, -11.13, 8.75, 0.66);
  for (const side of [-1, 1]) {
    column(side * 8.1, -10.65, 8.7);
    prism(side * 6.95, 0.55, -10.55, 0.16, 7.9, 0.18, "AltarGold", 0.14);
    prism(side * 6.95, 0.55, -10.42, 1.5, 0.14, 0.18, "AltarTrim", 0.14);
    prism(side * 6.95, 8.25, -10.42, 1.5, 0.14, 0.18, "AltarTrim", 0.14);
  }

  prism(0, 1.0, -10.96, 5.8, 6.5, 0.12, "AltarDark", 0.08);
  pointedArch(0, 3.7, -10.28, 5.1, 2.55, 0.34, 0.55, "AltarGold", 24);
  pointedArch(0, 3.7, -10.14, 4.34, 2.2, 0.13, 0.28, "AltarTrim", 24);
  for (const x of [-2.55, 2.55]) {
    prism(x, 0.75, -10.25, 0.28, 4.7, 0.34, "AltarGold", 0.2);
    for (const y of [1.0, 2.0, 3.0, 4.0, 5.0]) prism(x, y, -10.03, 0.44, 0.09, 0.12, "AltarTrim", 0.2);
  }
  prism(-2.68, 0.9, -10.3, 0.56, 3.2, 0.5, "AltarTrim", 0.2);
  prism(2.68, 0.9, -10.3, 0.56, 3.2, 0.5, "AltarTrim", 0.2);

  curtainPanel(-7.25, -2.42, -5.72, -2.9, 8.25, 2.7, -9.62, "AltarCurtain", 0.25);
  curtainPanel(2.42, 7.25, 2.9, 5.72, 8.25, 2.7, -9.62, "AltarCurtain", 0.85);
  curtainPanel(-7.25, -6.85, -5.72, -5.72, 8.25, 2.7, -9.42, "AltarBlue", 0.65);
  curtainPanel(6.85, 7.25, 5.72, 5.72, 8.25, 2.7, -9.42, "AltarBlue", 0.35);
  curtainPanel(-7.25, 7.25, -6.9, 6.9, 8.55, 7.35, -9.58, "AltarCurtain", 0.0);
  prism(0, 8.58, -9.53, 15.5, 0.22, 0.42, "AltarGold", 0.2);
  for (const side of [-1, 1]) {
    prism(side * 6.65, 2.55, -9.38, 0.12, 4.7, 0.14, "AltarGold", 0.2);
    prism(side * 6.45, 1.78, -9.38, 0.44, 0.16, 0.14, "AltarGold", 0.2);
    for (const y of [2.0, 3.2, 4.4, 5.6, 6.8]) {
      prism(side * 6.45, y, -9.35, 0.24, 0.28, 0.12, "AltarGold", 0.42);
    }
  }

  for (const side of [-1, 1]) {
    prism(side * 10.75, 0.05, -1.6, 0.65, 9.1, 27.7, "AltarStone", 0.1);
    prism(side * 10.36, 0.12, -1.6, 0.14, 0.4, 27.2, "AltarTrim", 0.18);
    prism(side * 10.36, 6.72, -1.6, 0.18, 0.22, 27.2, "AltarGold", 0.18);
    prism(side * 10.36, 8.63, -1.6, 0.24, 0.34, 27.2, "AltarTrim", 0.18);
    for (const z of [-9.5, -3.3, 2.9, 9.1]) {
      prism(side * 10.28, 0.12, z, 0.78, 8.55, 0.86, "AltarStone", 0.22);
      prism(side * 10.13, 0.64, z, 0.16, 7.45, 0.13, "AltarTrim", 0.16);
      prism(side * 10.13, 0.64, z + 0.2, 0.14, 7.45, 0.13, "AltarGold", 0.16);
      prism(side * 10.13, 0.48, z, 1.06, 0.2, 1.12, "AltarTrim", 0.2);
      prism(side * 10.13, 8.55, z, 1.08, 0.22, 1.12, "AltarGold", 0.2);
    }
    for (const z of [-6.4, 0.3, 7.0]) sideLancetWindow(side, side * 10.42, z, 2.2, 4.2);
  }

  vaultedCeiling();

  for (const z of [-2.8, -4.1, -5.4]) {
    const stepIndex = Math.abs(z + 2.8) / 1.3;
    prism(0, 0.1 + stepIndex * 0.22, z, 10.2 - stepIndex * 0.7, 0.36, 1.45, "AltarTrim", 0.16);
    prism(0, 0.46 + stepIndex * 0.22, z + 0.08, 9.7 - stepIndex * 0.7, 0.12, 1.3, "AltarStone", 0.18);
  }
  prism(0, 0.85, -6.55, 6.8, 0.24, 1.2, "AltarGold", 0.2);
  prism(0, 1.1, -7.15, 4.3, 0.38, 1.15, "AltarTrim", 0.22);

  prism(0, 1.45, -8.2, 2.35, 2.8, 0.7, "AltarCurtain", 0.17);
  prism(0, 1.22, -7.72, 2.5, 0.58, 1.08, "AltarGold", 0.2);
  prism(0, 1.37, -7.65, 2.18, 0.32, 0.92, "AltarTrim", 0.23);
  prism(-1.28, 1.05, -7.8, 0.24, 1.1, 0.86, "AltarGold", 0.2);
  prism(1.28, 1.05, -7.8, 0.24, 1.1, 0.86, "AltarGold", 0.2);
  pointedArch(0, 3.6, -7.98, 2.7, 1.35, 0.2, 0.42, "AltarGold", 18);
  prism(0, 4.8, -8.12, 0.22, 0.48, 0.3, "AltarGlass", 0.2);
  cone(0, 5.22, -8.12, 0.18, 0.56, "AltarGold", 16, 0.015);

  for (const side of [-1, 1]) {
    cylinder(side * 6.05, 0.12, -5.2, 0.16, 3.0, "AltarTrim", 18);
    cylinder(side * 6.05, 3.05, -5.2, 0.48, 0.34, "AltarGold", 20);
    prism(side * 6.05, 3.36, -5.2, 0.72, 0.86, 0.72, "AltarEmber", 0.16);
    cone(side * 6.05, 4.22, -5.2, 0.55, 0.48, "AltarGold", 18, 0.03);
  }
  for (let index = -4; index <= 4; index += 1) {
    const x = index * 1.65;
    prism(x, 8.72, -10.95, 0.84, 0.12, 0.2, index % 2 === 0 ? "AltarGold" : "AltarTrim", 0.16);
    if (index % 2 === 0) prism(x, 7.6, -10.88, 0.08, 1.05, 0.12, "AltarGold", 0.12);
  }

  floorSeal(0, 5.2);

  for (const x of [-9.3, 9.3]) {
    for (const z of [-5, 0, 5]) {
      cylinder(x, 0.08, z, 0.58, 0.2, "AltarTrim", 20, 0.48);
      cylinder(x, 0.28, z, 0.18, 2.65, "AltarGold", 14, 0.1);
      prism(x, 2.95, z, 0.7, 0.14, 0.7, "AltarEmber", 0.16);
      cone(x, 3.08, z, 0.39, 0.32, "AltarGold", 18, 0.02);
    }
  }
}

function buildGlb() {
  const binaryChunks = [];
  let binaryLength = 0;
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  function appendBuffer(arrayBuffer, target, componentType, type, count, min, max) {
    const bytes = Buffer.from(arrayBuffer);
    const pad = (4 - (binaryLength % 4)) % 4;
    if (pad) { binaryChunks.push(Buffer.alloc(pad)); binaryLength += pad; }
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length, target });
    binaryChunks.push(bytes); binaryLength += bytes.length;
    const accessor = accessors.length;
    const value = { bufferView: view, componentType, count, type };
    if (min) value.min = min;
    if (max) value.max = max;
    accessors.push(value);
    return accessor;
  }
  for (const [materialIndex, [name]] of materials.entries()) {
    const data = groups.get(name);
    if (!data.indices.length) continue;
    const positions = new Float32Array(data.positions);
    const normals = new Float32Array(data.normals);
    const uvs = new Float32Array(data.uvs);
    const indices = new Uint32Array(data.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[index + axis]);
        max[axis] = Math.max(max[axis], positions[index + axis]);
      }
    }
    const position = appendBuffer(positions.buffer, 34962, 5126, "VEC3", positions.length / 3, min, max);
    const normal = appendBuffer(normals.buffer, 34962, 5126, "VEC3", normals.length / 3);
    const uv = appendBuffer(uvs.buffer, 34962, 5126, "VEC2", uvs.length / 2);
    const indicesAccessor = appendBuffer(indices.buffer, 34963, 5125, "SCALAR", indices.length, [0], [indices.length - 1]);
    primitives.push({ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices: indicesAccessor, material: materialIndex, mode: 4 });
  }
  let binary = Buffer.concat(binaryChunks);
  const json = {
    asset: { version: "2.0", generator: "Caracatoa original altar generator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Salão do Altar Caracatoa", mesh: 0 }],
    meshes: [{ name: "CaracatoaAltar", primitives }],
    materials: materials.map(([name, texture, metallicFactor, roughnessFactor], index) => ({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index, texCoord: 0 },
        metallicFactor,
        roughnessFactor,
      },
      doubleSided: true,
    })),
    textures: materials.map((_, index) => ({ sampler: index, source: index })),
    samplers: materials.map(() => ({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 })),
    images: materials.map(([, file]) => ({ uri: "altar-textures/" + file })),
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
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.write("JSON", 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.write("BIN\0", 4);
  return Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]);
}

createAltar();
await mkdir(MODEL_ROOT, { recursive: true });
await mkdir(TEXTURE_ROOT, { recursive: true });
const textureKinds = ["stone", "trim", "dark", "gold", "red", "blue", "floor", "glass", "ember"];
for (const [index, [, file]] of materials.entries()) {
  await writeFile(join(TEXTURE_ROOT, file), altarTexture(textureKinds[index]));
}
const glb = buildGlb();
await writeFile(join(MODEL_ROOT, "caracatoa_altar.glb"), glb);
const model = [
  'mesh: "/assets/models/caracatoa_altar.glb"',
  'name: "caracatoa_altar"',
  ...materials.map(([name, file]) => [
    "materials {",
    "  name: " + JSON.stringify(name),
    '  material: "/assets/materials/caracatoa_town.material"',
    "  textures {",
    '    sampler: "tex0"',
    '    texture: "/assets/models/altar-textures/' + file + '"',
    "  }",
    "}",
  ].join("\n")),
  "",
].join("\n");
await writeFile(join(MODEL_ROOT, "caracatoa_altar.model"), model);
const manifest = {
  schemaVersion: 1,
  scene: "Salão do Altar Caracatoa",
  style: "salão cerimonial original com arco de pedra, veludo, passadeira e trono",
  glbBytes: glb.length,
  materials: materials.map(([name, file]) => ({ name, texture: file })),
  generation: "geometria própria determinística; texturas sintéticas já licenciadas no pacote Caracatoa",
};
await writeFile(join(ROOT, "assets", "caracatoa-altar-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Generated original Caracatoa altar: " + glb.length + " GLB bytes and " + materials.length + " material groups.");
