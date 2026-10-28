import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW = resolve(ROOT, "..", "..", "docs", "art", "concept", "portao-astral-3d-v1");
const GLB_PATH = resolve(PREVIEW, "models", "portao-astral-v1.glb");
const OUTPUT_PATH = resolve(PREVIEW, "portao-astral-preview-render.png");
const WIDTH = 1600; const HEIGHT = 1000; const FOCAL = HEIGHT * 1.12;

const palettes = {
  BasaltoNoturno: [80, 89, 101], BasaltoFrio: [48, 57, 68], ArenitoVelho: [119, 108, 89],
  FerroForjado: [43, 49, 57], BronzeEnvelhecido: [118, 71, 39], DouradoContido: [173, 119, 51],
  ArdosiaAzul: [34, 48, 66], CarvalhoEscuro: [65, 37, 22], VeludoCarmesim: [91, 12, 24],
  VidroLunar: [25, 67, 91], VidroBrasa: [142, 43, 9], LuzDeBraseiro: [241, 80, 15], PavimentoMolhado: [71, 76, 81], OuroDoTapete: [173, 119, 51],
};
const textures = {
  BasaltoNoturno: "stone", BasaltoFrio: "stoneDark", ArenitoVelho: "limestone", FerroForjado: "iron",
  BronzeEnvelhecido: "bronze", DouradoContido: "gold", ArdosiaAzul: "slate", CarvalhoEscuro: "wood",
  VeludoCarmesim: "crimson", VidroLunar: "glassBlue", VidroBrasa: "glassAmber", LuzDeBraseiro: "flame", PavimentoMolhado: "paving", OuroDoTapete: "gold",
};

function hashNoise(x, y, salt = 0) {
  let n = Math.imul((x + 31) | 0, 0x45d9f3b) ^ Math.imul((y + 67) | 0, 0x119de1f3) ^ Math.imul(salt + 11, 0x3449);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function sample(name, x, y) {
  const base = palettes[name] ?? [190, 180, 160];
  const kind = textures[name] ?? "stone";
  let amount = (hashNoise(Math.floor(x / 3), Math.floor(y / 3), kind.length) - 0.5) * ((kind === "stone" || kind === "stoneDark") ? 26 : 18);
  let seam = false;
  if (["stone", "stoneDark", "limestone"].includes(kind)) {
    const row = Math.floor(y / 30); const shifted = (x + (row % 2) * 24) % 48;
    seam = shifted < 2 || y % 30 < 2;
  } else if (kind === "slate") seam = y % 24 < 2 || ((x + (Math.floor(y / 24) % 2) * 20) % 40 < 2);
  else if (kind === "crimson") { amount += Math.sin(x * 0.33) * 8 + Math.cos(x * 0.13 + y * 0.08) * 4; seam = x % 24 === 0; }
  else if (kind === "bronze" || kind === "gold") amount += Math.sin((x + y * 0.22) * 0.40) * 7;
  else if (kind === "paving") { const row = Math.floor(y / 26); const sx = (x + (row % 2) * 16) % 32; const sy = y % 26; seam = sx < 2 || sx > 29 || sy < 2 || sy > 23; amount += sy < 7 ? 8 : 0; }
  else if (kind === "wood") { amount += Math.sin(y * 0.22) * 8 + Math.sin(y * 0.08 + x * 0.035) * 9; seam = x % 48 < 2; }
  else if (kind === "glassBlue" || kind === "glassAmber") { amount += Math.sin((x + y) * 0.08) * 20; seam = x % 48 < 2 || y % 48 < 2; }
  if (seam) return base.map((value) => value * 0.50);
  return base.map((value) => Math.max(0, Math.min(255, value + amount)));
}

function pngChunk(name, data) {
  const type = Buffer.from(name, "ascii"); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePng(pixels) {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * (WIDTH * 4 + 1); raw[row] = 0;
    pixels.copy(raw, row + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw, { level: 8 })), pngChunk("IEND", Buffer.alloc(0))]);
}

function vecSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vecDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vecNorm(v) { const len = Math.hypot(...v) || 1; return v.map((n) => n / len); }
function edge(a, b, x, y) { return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x); }

function render() {
  const file = requireBuffer;
  const jsonSize = file.readUInt32LE(12);
  const document = JSON.parse(file.subarray(20, 20 + jsonSize).toString("utf8").trim());
  const binHeader = 20 + jsonSize;
  if (file.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error("GLB binary chunk missing");
  const binaryStart = binHeader + 8;
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const depth = new Float32Array(WIDTH * HEIGHT); depth.fill(Infinity);
  for (let y = 0; y < HEIGHT; y += 1) {
    const t = y / HEIGHT; const glow = Math.max(0, 1 - Math.abs(t - 0.78) / 0.40); const moon = Math.max(0, 1 - t / 0.60);
    for (let x = 0; x < WIDTH; x += 1) {
      const vignette = Math.max(0.55, 1 - Math.hypot((x - WIDTH / 2) / WIDTH, (y - HEIGHT / 2) / HEIGHT) * 0.55);
      const i = (y * WIDTH + x) * 4;
      pixels[i] = (15 + glow * 33 + moon * 8) * vignette;
      pixels[i + 1] = (22 + glow * 20 + moon * 11) * vignette;
      pixels[i + 2] = (34 + glow * 5 + moon * 22) * vignette; pixels[i + 3] = 255;
    }
  }
  const eye = [17, 18, 32]; const target = [0, 8.5, -4.5];
  const forward = vecNorm(vecSub(target, eye));
  const right = vecNorm([-forward[2], 0, forward[0]]);
  const up = vecNorm([right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]);
  const key = vecNorm([-0.42, 0.80, 0.58]); const cool = vecNorm([0.46, 0.42, -0.76]);
  const view = vecNorm(vecSub(eye, target)); const half = vecNorm(key.map((v, i) => v + view[i]));
  const project = (p) => {
    const rel = vecSub(p, eye); const z = vecDot(rel, forward);
    if (z <= 0.2) return null;
    return { x: WIDTH / 2 + vecDot(rel, right) * FOCAL / z, y: HEIGHT / 2 - vecDot(rel, up) * FOCAL / z, z };
  };
  const readVec = (accessorIndex) => {
    const accessor = document.accessors[accessorIndex]; const viewInfo = document.bufferViews[accessor.bufferView];
    const offset = binaryStart + viewInfo.byteOffset + (accessor.byteOffset ?? 0); const components = accessor.type === "VEC3" ? 3 : accessor.type === "VEC2" ? 2 : 1;
    const data = new Float32Array(accessor.count * components);
    for (let i = 0; i < data.length; i += 1) data[i] = file.readFloatLE(offset + i * 4);
    return data;
  };
  const readIndices = (accessorIndex) => {
    const accessor = document.accessors[accessorIndex]; const viewInfo = document.bufferViews[accessor.bufferView];
    const offset = binaryStart + viewInfo.byteOffset + (accessor.byteOffset ?? 0); const data = new Uint32Array(accessor.count);
    for (let i = 0; i < accessor.count; i += 1) data[i] = file.readUInt32LE(offset + i * 4);
    return data;
  };
  let triangleCount = 0;
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = readVec(primitive.attributes.POSITION); const normals = readVec(primitive.attributes.NORMAL); const uvs = readVec(primitive.attributes.TEXCOORD_0); const indices = readIndices(primitive.indices);
      const material = document.materials[primitive.material]; const name = material.name; const [metallic, roughness] = [material.pbrMetallicRoughness.metallicFactor, material.pbrMetallicRoughness.roughnessFactor];
      const screen = new Array(positions.length / 3);
      for (let i = 0; i < screen.length; i += 1) screen[i] = project([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      for (let i = 0; i < indices.length; i += 3) {
        const ids = [indices[i], indices[i + 1], indices[i + 2]]; const p = ids.map((id) => screen[id]);
        if (p.some((value) => !value)) continue;
        const minX = Math.max(0, Math.floor(Math.min(p[0].x, p[1].x, p[2].x))); const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(p[0].x, p[1].x, p[2].x)));
        const minY = Math.max(0, Math.floor(Math.min(p[0].y, p[1].y, p[2].y))); const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(p[0].y, p[1].y, p[2].y)));
        if (minX > maxX || minY > maxY) continue;
        const area = edge(p[0], p[1], p[2].x, p[2].y); if (Math.abs(area) < 0.001) continue;
        const world = ids.map((id) => [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]]);
        let n = vecNorm([normals[ids[0] * 3], normals[ids[0] * 3 + 1], normals[ids[0] * 3 + 2]]);
        if (vecDot(n, vecSub(eye, world[0])) < 0) n = n.map((v) => -v);
        const diffuse = 0.28 + Math.max(0, vecDot(n, key)) * 0.76 + Math.max(0, vecDot(n, cool)) * 0.15;
        const specular = Math.pow(Math.max(0, vecDot(n, half)), Math.max(8, 64 * (1 - roughness))) * metallic * 0.36;
        const fog = Math.max(0, Math.min(0.33, (p[0].z + p[1].z + p[2].z) / 3 - 25) / 105);
        const uv = ids.map((id) => [uvs[id * 2], uvs[id * 2 + 1]]);
        const emission = material.emissiveFactor ?? [0, 0, 0];
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const w0 = edge(p[1], p[2], x + 0.5, y + 0.5) / area; const w1 = edge(p[2], p[0], x + 0.5, y + 0.5) / area; const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * p[0].z + w1 * p[1].z + w2 * p[2].z; const offset = y * WIDTH + x;
            if (z >= depth[offset]) continue;
            depth[offset] = z;
            const u = w0 * uv[0][0] + w1 * uv[1][0] + w2 * uv[2][0]; const v = w0 * uv[0][1] + w1 * uv[1][1] + w2 * uv[2][1];
            const texX = Math.floor((((u % 1) + 1) % 1) * 192); const texY = Math.floor((((v % 1) + 1) % 1) * 192);
            const color = sample(name, texX, texY); const shade = Math.max(0.17, diffuse + specular); const pixel = offset * 4;
            const fogColor = [53, 68, 87];
            for (let c = 0; c < 3; c += 1) pixels[pixel + c] = color[c] * shade * (1 - fog) + fogColor[c] * fog + emission[c] * 110;
            pixels[pixel + 3] = 255;
          }
        }
        triangleCount += 1;
      }
    }
  }
  return { image: encodePng(pixels), triangleCount };
}

const requireBuffer = await readFile(GLB_PATH);
if (requireBuffer.readUInt32LE(0) !== 0x46546c67 || requireBuffer.readUInt32LE(4) !== 2) throw new Error("Expected a GLB v2 model");
const result = render();
await writeFile(OUTPUT_PATH, result.image);
console.log(JSON.stringify({ output: OUTPUT_PATH, width: WIDTH, height: HEIGHT, triangles: result.triangleCount, bytes: result.image.length }, null, 2));
