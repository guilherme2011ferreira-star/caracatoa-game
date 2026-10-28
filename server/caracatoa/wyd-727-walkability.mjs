/**
 * WYD 7.27 walkability data for the local Caracatoa server.
 *
 * The map format and height rules mirror the MIT-licensed WYDBot 7.27 fork at
 * commit 0679d0b5f81ac08bb088b2d9fe5b4f3da779531d:
 * src/main/game-assets/{walkability-builder,heightmap-bake}.ts and
 * src/main/game-assets/parsers/{trn-parser,dat-parser,object-bin-parser}.ts.
 * Keep the fork's LICENSE and copyright notice with redistributed source.
 * Game assets are read from a user-provided local directory; they are not
 * bundled or copied into Caracatoa.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const WYD727_WORLD_SIZE = 4096;
export const WYD727_BLOCKED_SENTINEL = 0x7f;
export const WYD727_HEIGHT_TOLERANCE = 8;

const HEIGHTMAP_SIZE = WYD727_WORLD_SIZE * WYD727_WORLD_SIZE;
const SECTORS_PER_AXIS = 32;
const SECTOR_TILES = 128;
const TRN_CELLS_PER_AXIS = 64;
const TRN_CELL_STRIDE = 12;
const TRN_CELL_COUNT = TRN_CELLS_PER_AXIS * TRN_CELLS_PER_AXIS;
const TRN_GRID_BYTES = TRN_CELL_COUNT * TRN_CELL_STRIDE;
const ATTRIBUTE_GRID_SIZE = 1024;
const ATTRIBUTE_MAP_BYTES = ATTRIBUTE_GRID_SIZE * ATTRIBUTE_GRID_SIZE;
const ATTRIBUTE_WALL_BIT = 0x02;
const ATTRIBUTE_CELL_TILES = 4;
const OBJECT_BIN_BYTES = 0x100000;
const OBJECT_MODEL_COUNT = 0x1000;
const OBJECT_MODEL_STRIDE = 0x100;
const OBJECT_MODEL_DIM = 16;
const OBJECT_MODEL_CENTER = (OBJECT_MODEL_DIM - 1) / 2;
const OBJECT_MODEL_PIVOT = OBJECT_MODEL_DIM / 2 - 1;
const FIELD_BASE_STRIDE = 0x1c;
const FIELD_WIDE_STRIDE = 0x24;
const MAX_FIELD_RECORDS = 0x1000;
const TRN_FILENAME_RE = /^Field(\d{2})(\d{2})\.trn$/;
const DAT_FILENAME_RE = /^Field(\d{2})(\d{2})\.dat$/;

const OBJECT_BIN_KEY = [
  177, 221, 176, 173, 187, 234, 195, 163, 190, 198, 176, 161, 192, 218, 192,
  207, 184, 184, 192, 204, 195, 181, 186, 192, 186, 188, 188, 246, 183, 207,
  190, 198, 184, 167, 180, 228, 176, 237, 189, 197, 186, 241, 199, 207, 177,
  184, 179, 170, 191, 236, 184, 174, 179, 170, 182, 243, 193, 193, 192, 186,
  179, 170, 182, 243, 187, 245, 179, 170, 182, 243, 192, 199, 190, 238, 184,
  176, 192, 204, 180, 194, 192, 207, 194, 239, 192, 207, 190, 238, 179, 179,
  180, 207, 180, 217, 192, 225, 178, 217, 183, 175, 177, 226, 190, 248, 180,
  194, 179, 170, 182, 243, 191, 236, 184, 174, 179, 170, 182, 243, 193, 193,
  192, 186, 179, 170, 182, 243, 185, 171, 177, 195, 200, 173, 185, 171, 177,
  195, 200, 173, 191, 236, 184, 174, 179, 170, 182, 243, 178, 201, 187, 239,
  195, 181, 184, 174, 176, 173, 187, 234, 191, 161, 191, 236, 184, 174, 179,
  170, 182, 243, 178, 201,
];

const IS_WIDE_FIELD_TYPE = (type) =>
  (type >= 0x1f5 && type <= 0x1fa) ||
  (type >= 0x1ff && type <= 0x206) ||
  (type >= 0x208 && type <= 0x257);

const sectorKey = (sectorX, sectorY) => sectorY * SECTORS_PER_AXIS + sectorX;

export const WYD727_DIRECTION_DELTAS = Object.freeze({
  0x31: Object.freeze({ x: -1, y: -1 }),
  0x32: Object.freeze({ x: 0, y: -1 }),
  0x33: Object.freeze({ x: 1, y: -1 }),
  0x34: Object.freeze({ x: -1, y: 0 }),
  0x36: Object.freeze({ x: 1, y: 0 }),
  0x37: Object.freeze({ x: -1, y: 1 }),
  0x38: Object.freeze({ x: 0, y: 1 }),
  0x39: Object.freeze({ x: 1, y: 1 }),
});

export function parseWyd727Trn(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
    throw new Error("Field*.trn vazio ou inválido.");
  }

  const nameLength = buffer.readUInt8(0);
  if (nameLength !== 0 && nameLength !== 5) {
    throw new Error(
      `Field*.trn tem comprimento de nome não suportado: ${nameLength}.`,
    );
  }
  const gridOffset = 3 + nameLength;
  const expectedSize = gridOffset + TRN_GRID_BYTES;
  if (buffer.length !== expectedSize) {
    throw new Error(
      `Field*.trn tem ${buffer.length} bytes; eram esperados ${expectedSize}.`,
    );
  }

  const heights = new Int8Array(TRN_CELL_COUNT);
  for (let cell = 0; cell < TRN_CELL_COUNT; cell++) {
    heights[cell] = buffer.readInt8(gridOffset + cell * TRN_CELL_STRIDE);
  }
  return {
    name: nameLength === 0 ? "" : buffer.toString("ascii", 1, 1 + nameLength),
    sectorX: buffer.readUInt8(1 + nameLength),
    sectorY: buffer.readUInt8(2 + nameLength),
    heights,
  };
}

export function parseWyd727FieldDat(buffer) {
  if (!Buffer.isBuffer(buffer))
    throw new TypeError("Field*.dat precisa ser um Buffer.");
  const objects = [];
  let offset = 0;

  while (offset < buffer.length && objects.length < MAX_FIELD_RECORDS) {
    if (offset + FIELD_BASE_STRIDE > buffer.length) {
      throw new Error(
        `Field*.dat contém registro truncado no offset ${offset}.`,
      );
    }
    const type = buffer.readUInt32LE(offset);
    const object = {
      type,
      x: buffer.readFloatLE(offset + 4),
      y: buffer.readFloatLE(offset + 8),
      z: buffer.readFloatLE(offset + 0x0c),
      rotation: buffer.readFloatLE(offset + 0x10),
      modelId: buffer.readUInt32LE(offset + 0x18),
    };
    if (
      ![object.x, object.y, object.z, object.rotation].every(Number.isFinite)
    ) {
      throw new Error(
        `Field*.dat contém coordenada não finita no offset ${offset}.`,
      );
    }
    objects.push(object);
    offset += IS_WIDE_FIELD_TYPE(type) ? FIELD_WIDE_STRIDE : FIELD_BASE_STRIDE;
  }

  if (offset !== buffer.length)
    throw new Error(`Field*.dat contém bytes excedentes no offset ${offset}.`);
  return objects;
}

export function parseWyd727ObjectBin(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < OBJECT_BIN_BYTES) {
    throw new Error(
      `object.bin truncado; são necessários ao menos ${OBJECT_BIN_BYTES} bytes.`,
    );
  }
  const silhouettes = new Uint8Array(OBJECT_BIN_BYTES);
  for (let index = 0; index < OBJECT_BIN_BYTES; index++) {
    silhouettes[index] =
      (buffer[index] -
        OBJECT_BIN_KEY[index % OBJECT_BIN_KEY.length] -
        (index & 0xff)) &
      0xff;
  }
  return { silhouettes, modelCount: OBJECT_MODEL_COUNT };
}

export function bakeWyd727AttributeWalls(heightmap, attributeMap) {
  if (
    !(heightmap instanceof Int8Array) ||
    heightmap.length !== HEIGHTMAP_SIZE
  ) {
    throw new RangeError(
      `heightmap precisa ter ${HEIGHTMAP_SIZE} células Int8.`,
    );
  }
  if (
    !Buffer.isBuffer(attributeMap) ||
    attributeMap.length < ATTRIBUTE_MAP_BYTES
  ) {
    throw new RangeError(
      `AttributeMap.dat precisa ter ao menos ${ATTRIBUTE_MAP_BYTES} bytes.`,
    );
  }

  let blockedCells = 0;
  for (let cellY = 0; cellY < ATTRIBUTE_GRID_SIZE; cellY++) {
    const baseY = cellY * ATTRIBUTE_CELL_TILES;
    for (let cellX = 0; cellX < ATTRIBUTE_GRID_SIZE; cellX++) {
      if (
        (attributeMap[cellX + cellY * ATTRIBUTE_GRID_SIZE] &
          ATTRIBUTE_WALL_BIT) ===
        0
      )
        continue;
      const baseX = cellX * ATTRIBUTE_CELL_TILES;
      for (let dy = 0; dy < ATTRIBUTE_CELL_TILES; dy++) {
        const row = (baseY + dy) * WYD727_WORLD_SIZE + baseX;
        for (let dx = 0; dx < ATTRIBUTE_CELL_TILES; dx++) {
          heightmap[row + dx] = WYD727_BLOCKED_SENTINEL;
          blockedCells++;
        }
      }
    }
  }
  return blockedCells;
}

export function bakeWyd727ObjectWalls(
  heightmap,
  getFieldObjects,
  getSilhouette,
) {
  if (
    !(heightmap instanceof Int8Array) ||
    heightmap.length !== HEIGHTMAP_SIZE
  ) {
    throw new RangeError(
      `heightmap precisa ter ${HEIGHTMAP_SIZE} células Int8.`,
    );
  }
  if (
    typeof getFieldObjects !== "function" ||
    typeof getSilhouette !== "function"
  ) {
    throw new TypeError(
      "Consultas de objetos e silhuetas precisam ser funções.",
    );
  }

  let stampedCells = 0;
  for (let sectorY = 0; sectorY < SECTORS_PER_AXIS; sectorY++) {
    for (let sectorX = 0; sectorX < SECTORS_PER_AXIS; sectorX++) {
      const objects = getFieldObjects(sectorX, sectorY);
      for (const object of objects) {
        if (object.type >= 0x137 && object.type <= 0x142) continue;
        const silhouette = getSilhouette(object.modelId);
        if (!silhouette) continue;
        if (
          !(silhouette instanceof Uint8Array) ||
          silhouette.length < OBJECT_MODEL_STRIDE
        ) {
          throw new Error(
            `Silhueta do modelo ${object.modelId} tem formato inválido.`,
          );
        }

        const originX = sectorX * SECTOR_TILES + (Math.trunc(object.x) & 0x7f);
        const originY = sectorY * SECTOR_TILES + (Math.trunc(object.y) & 0x7f);
        const angle = Math.PI + object.rotation;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        const zBias = object.z / 0.1;
        const zRound = object.z > 0 ? 1 : 0;

        for (let row = 0; row < OBJECT_MODEL_DIM; row++) {
          for (let column = 0; column < OBJECT_MODEL_DIM; column++) {
            const u = column - OBJECT_MODEL_PIVOT;
            const v = row - OBJECT_MODEL_PIVOT;
            const low = Math.trunc(cosine * u - sine * v + OBJECT_MODEL_CENTER);
            const high = Math.trunc(
              sine * u + cosine * v + OBJECT_MODEL_CENTER,
            );
            if (
              low < 0 ||
              low >= OBJECT_MODEL_DIM ||
              high < 0 ||
              high >= OBJECT_MODEL_DIM
            )
              continue;
            const raw = silhouette[high * OBJECT_MODEL_DIM + low];
            if (raw === 0) continue;

            const cell = (raw << 24) >> 24;
            const bakedHeight = Math.min(
              Math.trunc(3 * cell + zBias) + zRound,
              WYD727_BLOCKED_SENTINEL,
            );
            const worldX = originX - OBJECT_MODEL_PIVOT + column;
            const worldY = originY - OBJECT_MODEL_PIVOT + row;
            if (
              worldX < 0 ||
              worldX >= WYD727_WORLD_SIZE ||
              worldY < 0 ||
              worldY >= WYD727_WORLD_SIZE
            ) {
              continue;
            }
            const index = worldY * WYD727_WORLD_SIZE + worldX;
            if (bakedHeight > heightmap[index]) {
              heightmap[index] = bakedHeight;
              stampedCells++;
            }
          }
        }
      }
    }
  }
  return stampedCells;
}

const stampTrnSector = (heightmap, sectorX, sectorY, heights) => {
  const baseX = sectorX * SECTOR_TILES;
  const baseY = sectorY * SECTOR_TILES;
  for (let cellY = 0; cellY < TRN_CELLS_PER_AXIS; cellY++) {
    const worldY = baseY + cellY * 2;
    const row0 = worldY * WYD727_WORLD_SIZE + baseX;
    const row1 = row0 + WYD727_WORLD_SIZE;
    const sourceRow = cellY * TRN_CELLS_PER_AXIS;
    for (let cellX = 0; cellX < TRN_CELLS_PER_AXIS; cellX++) {
      const height = heights[sourceRow + cellX];
      const worldX = cellX * 2;
      heightmap[row0 + worldX] = height;
      heightmap[row0 + worldX + 1] = height;
      heightmap[row1 + worldX] = height;
      heightmap[row1 + worldX + 1] = height;
    }
  }
};

const assertAssetCoordinate = (match, filename) => {
  const sectorX = Number(match[1]);
  const sectorY = Number(match[2]);
  if (sectorX >= SECTORS_PER_AXIS || sectorY >= SECTORS_PER_AXIS) return null;
  return { filename, sectorX, sectorY };
};

export async function buildWyd727WorldHeightmap(assetRoot) {
  if (typeof assetRoot !== "string" || assetRoot.trim().length === 0) {
    throw new TypeError(
      "CARACATOA_GAME_ASSET_DIR precisa indicar uma pasta local de recursos.",
    );
  }
  const root = resolve(assetRoot);
  const mapsDirectory = join(root, "maps");
  let entries;
  try {
    entries = await readdir(mapsDirectory);
  } catch {
    throw new Error(
      "Não foi possível ler a pasta local de mapas em CARACATOA_GAME_ASSET_DIR.",
    );
  }

  const trnSources = entries
    .filter((filename) => TRN_FILENAME_RE.test(filename))
    .map((filename) =>
      assertAssetCoordinate(TRN_FILENAME_RE.exec(filename), filename),
    )
    .filter(Boolean)
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (trnSources.length === 0) {
    throw new Error(
      "A pasta local de mapas não contém setores FieldXXYY.trn utilizáveis.",
    );
  }

  const heightmap = new Int8Array(HEIGHTMAP_SIZE);
  heightmap.fill(WYD727_BLOCKED_SENTINEL);
  for (const source of trnSources) {
    let bytes;
    try {
      bytes = await readFile(join(mapsDirectory, source.filename));
    } catch {
      throw new Error(`Não foi possível ler o setor local ${source.filename}.`);
    }
    const parsed = parseWyd727Trn(bytes);
    stampTrnSector(heightmap, source.sectorX, source.sectorY, parsed.heights);
  }

  let objectBuffer;
  let attributeBuffer;
  try {
    [objectBuffer, attributeBuffer] = await Promise.all([
      readFile(join(root, "object.bin")),
      readFile(join(root, "AttributeMap.dat")),
    ]);
  } catch {
    throw new Error(
      "Walkability exige object.bin e AttributeMap.dat da pasta local de recursos.",
    );
  }
  const objectBin = parseWyd727ObjectBin(objectBuffer);
  if (attributeBuffer.length < ATTRIBUTE_MAP_BYTES) {
    throw new Error(
      `AttributeMap.dat truncado; são necessários ${ATTRIBUTE_MAP_BYTES} bytes.`,
    );
  }

  const fieldObjects = new Map();
  const datSources = entries
    .filter((filename) => DAT_FILENAME_RE.test(filename))
    .map((filename) =>
      assertAssetCoordinate(DAT_FILENAME_RE.exec(filename), filename),
    )
    .filter(Boolean)
    .sort((left, right) => left.filename.localeCompare(right.filename));
  let objectCount = 0;
  for (const source of datSources) {
    let bytes;
    try {
      bytes = await readFile(join(mapsDirectory, source.filename));
    } catch {
      throw new Error(
        `Não foi possível ler o setor de objetos local ${source.filename}.`,
      );
    }
    const objects = parseWyd727FieldDat(bytes);
    fieldObjects.set(sectorKey(source.sectorX, source.sectorY), objects);
    objectCount += objects.length;
  }

  const objectWallCells = bakeWyd727ObjectWalls(
    heightmap,
    (sectorX, sectorY) => fieldObjects.get(sectorKey(sectorX, sectorY)) ?? [],
    (modelId) => {
      if (
        !Number.isInteger(modelId) ||
        modelId < 0 ||
        modelId >= objectBin.modelCount
      )
        return null;
      const start = modelId * OBJECT_MODEL_STRIDE;
      return objectBin.silhouettes.subarray(start, start + OBJECT_MODEL_STRIDE);
    },
  );
  const attributeWallCells = bakeWyd727AttributeWalls(
    heightmap,
    attributeBuffer,
  );
  const hash = createHash("sha256")
    .update(heightmap)
    .digest("hex")
    .slice(0, 16);

  return Object.freeze({
    heightmap,
    hash,
    sectorsLoaded: trnSources.length,
    objectSectorsLoaded: datSources.length,
    objectsLoaded: objectCount,
    objectWallCells,
    attributeWallCells,
  });
}

export function createWyd727Walkability(heightmap) {
  if (
    !(heightmap instanceof Int8Array) ||
    heightmap.length !== HEIGHTMAP_SIZE
  ) {
    throw new RangeError(
      `heightmap precisa ter ${HEIGHTMAP_SIZE} células Int8.`,
    );
  }
  const isWalkablePosition = (x, y) =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < WYD727_WORLD_SIZE &&
    y < WYD727_WORLD_SIZE &&
    heightmap[y * WYD727_WORLD_SIZE + x] !== WYD727_BLOCKED_SENTINEL;

  const canStep = (fromX, fromY, toX, toY) => {
    if (!isWalkablePosition(fromX, fromY) || !isWalkablePosition(toX, toY))
      return false;
    const fromHeight = heightmap[fromY * WYD727_WORLD_SIZE + fromX];
    const toHeight = heightmap[toY * WYD727_WORLD_SIZE + toX];
    const difference = toHeight - fromHeight;
    return (
      difference < WYD727_HEIGHT_TOLERANCE &&
      difference > -WYD727_HEIGHT_TOLERANCE
    );
  };

  return Object.freeze({ isWalkablePosition, canStep });
}
