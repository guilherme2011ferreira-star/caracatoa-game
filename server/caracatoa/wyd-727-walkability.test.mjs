import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bakeWyd727AttributeWalls,
  bakeWyd727ObjectWalls,
  buildWyd727WorldHeightmap,
  createWyd727Walkability,
  parseWyd727FieldDat,
  parseWyd727ObjectBin,
  parseWyd727Trn,
  WYD727_BLOCKED_SENTINEL,
  WYD727_WORLD_SIZE,
} from "./wyd-727-walkability.mjs";

const HEIGHTMAP_CELLS = WYD727_WORLD_SIZE * WYD727_WORLD_SIZE;
const TRN_BYTES = 3 + 64 * 64 * 12;

function trnFixture({
  cellHeights = new Map(),
  name = "",
  sectorX = 0,
  sectorY = 0,
} = {}) {
  const nameBytes = Buffer.from(name, "ascii");
  const buffer = Buffer.alloc(1 + nameBytes.length + 2 + 64 * 64 * 12);
  buffer.writeUInt8(nameBytes.length, 0);
  nameBytes.copy(buffer, 1);
  buffer.writeUInt8(sectorX, 1 + nameBytes.length);
  buffer.writeUInt8(sectorY, 2 + nameBytes.length);
  const gridOffset = 3 + nameBytes.length;
  for (const [cellIndex, height] of cellHeights) {
    buffer.writeInt8(height, gridOffset + cellIndex * 12);
  }
  return buffer;
}

function fieldRecord({
  type = 0,
  x = 0,
  y = 0,
  z = 0,
  rotation = 0,
  modelId = 0,
} = {}) {
  const stride =
    (type >= 0x1f5 && type <= 0x1fa) ||
    (type >= 0x1ff && type <= 0x206) ||
    (type >= 0x208 && type <= 0x257)
      ? 0x24
      : 0x1c;
  const buffer = Buffer.alloc(stride);
  buffer.writeUInt32LE(type, 0);
  buffer.writeFloatLE(x, 4);
  buffer.writeFloatLE(y, 8);
  buffer.writeFloatLE(z, 0x0c);
  buffer.writeFloatLE(rotation, 0x10);
  buffer.writeUInt32LE(modelId, 0x18);
  return buffer;
}

test("parses the WYDBot Field*.trn envelope and signed 64x64 heights", () => {
  const buffer = trnFixture({
    name: "Field",
    sectorX: 2,
    sectorY: 3,
    cellHeights: new Map([
      [0, -8],
      [63 * 64 + 63, 7],
    ]),
  });
  const parsed = parseWyd727Trn(buffer);
  assert.equal(parsed.name, "Field");
  assert.equal(parsed.sectorX, 2);
  assert.equal(parsed.sectorY, 3);
  assert.equal(parsed.heights.length, 4096);
  assert.equal(parsed.heights[0], -8);
  assert.equal(parsed.heights[4095], 7);
  assert.throws(() => parseWyd727Trn(buffer.subarray(0, -1)), /bytes/);
  assert.throws(() => parseWyd727Trn(Buffer.from([4, 0, 0])), /nome/);
});

test("parses base and wide Field*.dat records and rejects non-finite placements", () => {
  const parsed = parseWyd727FieldDat(
    Buffer.concat([
      fieldRecord({
        type: 0x10,
        x: 20.5,
        y: 31,
        z: 0.2,
        rotation: 1.5,
        modelId: 17,
      }),
      fieldRecord({ type: 0x1f5, x: 5, y: 6, modelId: 19 }),
    ]),
  );
  assert.deepEqual(parsed, [
    {
      type: 0x10,
      x: 20.5,
      y: 31,
      z: Math.fround(0.2),
      rotation: 1.5,
      modelId: 17,
    },
    { type: 0x1f5, x: 5, y: 6, z: 0, rotation: 0, modelId: 19 },
  ]);
  assert.throws(
    () => parseWyd727FieldDat(fieldRecord({ x: Number.NaN })),
    /não finita/,
  );
  assert.throws(() => parseWyd727FieldDat(Buffer.alloc(1)), /truncado/);
});

test("decodes the public object.bin silhouette table and fails on truncation", () => {
  const parsed = parseWyd727ObjectBin(Buffer.alloc(0x100000));
  assert.equal(parsed.modelCount, 4096);
  assert.equal(parsed.silhouettes.length, 0x100000);
  assert.deepEqual([...parsed.silhouettes.subarray(0, 3)], [79, 34, 78]);
  assert.throws(() => parseWyd727ObjectBin(Buffer.alloc(0x0fffff)), /truncado/);
});

test("bakes attribute and object walls into the client-compatible step-height grid", () => {
  const heightmap = new Int8Array(HEIGHTMAP_CELLS);
  const attributeMap = Buffer.alloc(1024 * 1024);
  attributeMap[5 + 5 * 1024] = 0x02;
  assert.equal(bakeWyd727AttributeWalls(heightmap, attributeMap), 16);

  const silhouette = new Uint8Array(256);
  silhouette.fill(3);
  const objectWalls = bakeWyd727ObjectWalls(
    heightmap,
    (sectorX, sectorY) =>
      sectorX === 0 && sectorY === 0
        ? [{ type: 1, x: 64, y: 64, z: 0, rotation: 0, modelId: 4 }]
        : [],
    (modelId) => (modelId === 4 ? silhouette : null),
  );
  assert.ok(objectWalls > 0);
  assert.equal(heightmap[64 * WYD727_WORLD_SIZE + 64], 9);

  const walkability = createWyd727Walkability(heightmap);
  assert.equal(walkability.isWalkablePosition(19, 20), true);
  assert.equal(walkability.isWalkablePosition(20, 20), false);
  assert.equal(walkability.isWalkablePosition(64, 64), true);
  assert.equal(walkability.canStep(56, 64, 57, 64), false);
  assert.equal(walkability.canStep(19, 20, 20, 20), false);
  assert.equal(walkability.canStep(-1, 0, 0, 0), false);

  const slopeMap = new Int8Array(HEIGHTMAP_CELLS);
  slopeMap[1] = 7;
  slopeMap[2] = 8;
  const slopeWalkability = createWyd727Walkability(slopeMap);
  assert.equal(slopeWalkability.canStep(0, 0, 1, 0), true);
  assert.equal(slopeWalkability.canStep(0, 0, 2, 0), false);
  assert.equal(slopeWalkability.isWalkablePosition(0, 0), true);
  assert.equal(slopeWalkability.isWalkablePosition(0, 1), true);
  const sentinelMap = new Int8Array(HEIGHTMAP_CELLS);
  sentinelMap[0] = WYD727_BLOCKED_SENTINEL;
  assert.equal(
    createWyd727Walkability(sentinelMap).isWalkablePosition(0, 0),
    false,
  );
});

test("builds the 4096 grid from local sectors and fails closed outside supplied terrain", async (t) => {
  const assetRoot = await mkdtemp(join(tmpdir(), "caracatoa-walkability-"));
  t.after(() => rm(assetRoot, { recursive: true, force: true }));
  await mkdir(join(assetRoot, "maps"));

  const trn = trnFixture();
  await writeFile(join(assetRoot, "maps", "Field0000.trn"), trn);
  await writeFile(
    join(assetRoot, "maps", "Field0000.dat"),
    fieldRecord({ modelId: 4096 }),
  );
  await writeFile(join(assetRoot, "object.bin"), Buffer.alloc(0x100000));
  const attributeMap = Buffer.alloc(1024 * 1024);
  attributeMap[1 + 1 * 1024] = 0x02;
  await writeFile(join(assetRoot, "AttributeMap.dat"), attributeMap);

  const loaded = await buildWyd727WorldHeightmap(assetRoot);
  assert.equal(loaded.heightmap.length, HEIGHTMAP_CELLS);
  assert.equal(loaded.sectorsLoaded, 1);
  assert.equal(loaded.objectSectorsLoaded, 1);
  assert.equal(loaded.objectsLoaded, 1);
  assert.equal(loaded.hash.length, 16);
  assert.equal(loaded.heightmap[0], 0);
  assert.equal(loaded.heightmap[127 * WYD727_WORLD_SIZE + 127], 0);
  assert.equal(loaded.heightmap[128], WYD727_BLOCKED_SENTINEL);
  assert.equal(
    loaded.heightmap[4 * WYD727_WORLD_SIZE + 4],
    WYD727_BLOCKED_SENTINEL,
  );

  const walkability = createWyd727Walkability(loaded.heightmap);
  assert.equal(walkability.isWalkablePosition(3, 4), true);
  assert.equal(walkability.canStep(3, 4, 4, 4), false);
  assert.equal(walkability.isWalkablePosition(128, 0), false);
  assert.equal(walkability.isWalkablePosition(4096, 0), false);
  await assert.rejects(
    buildWyd727WorldHeightmap(""),
    /CARACATOA_GAME_ASSET_DIR/,
  );
});
