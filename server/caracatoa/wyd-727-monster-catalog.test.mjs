import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WYD727_CLASS_WORLD_STATS } from "./wyd-727-class-catalog.mjs";
import {
  buildWyd727CreateMobBody,
  getWyd727MonstersForWorld,
  validateWyd727MonsterCatalog,
  WYD727_MOB_FRAME_LENGTH,
} from "./wyd-727-monster-catalog.mjs";

const ENTRY = {
  id: "goblin-sintetico",
  name: "Goblin_01",
  description: "Fixture de protocolo sem modelo proprietário.",
  enabled: true,
  properties: {
    clientEntityId: 5000,
    equipModelIds: [1001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    spawnPosition: { x: 322, y: 123 },
    level: 4,
    startingStats: {
      ...DEFAULT_WYD727_CLASS_WORLD_STATS,
      damage: 18,
      maxHp: 120,
      currentHp: 120,
      str: 23,
    },
  },
};

function catalog(entries = [structuredClone(ENTRY)]) {
  return { schemaVersion: 1, kind: "monsters", entries };
}

const walkability = {
  isWalkablePosition(x, y) {
    return !(x === 324 && y === 124);
  },
};

test("builds the public 0x364 CreateMob frame from a catalog creature", () => {
  const body = buildWyd727CreateMobBody({
    clientId: 77,
    timestamp: 0x10203040,
    entry: structuredClone(ENTRY),
  });
  assert.equal(body.length, WYD727_MOB_FRAME_LENGTH - 4);
  assert.equal(body.length + 4, 256);
  assert.equal(body.readUInt16LE(0), 0x364);
  assert.equal(body.readUInt16LE(2), 77);
  assert.equal(body.readUInt32LE(4), 0x10203040);
  assert.equal(body.readInt16LE(8), 322);
  assert.equal(body.readInt16LE(10), 123);
  assert.equal(body.readUInt16LE(12), 5000);
  assert.equal(body.toString("ascii", 14, 30).replace(/\0+$/, ""), "Goblin_01");
  assert.equal(body.readUInt16LE(30), 1001);
  assert.equal(body.readUInt16LE(32), 0);
  assert.equal(body.readInt32LE(136), 4);
  assert.equal(body.readInt32LE(144), 18);
  assert.equal(
    body.readUInt8(148),
    0,
    "merchant byte keeps the client discriminator on monster",
  );
  assert.equal(body.readInt32LE(152), 120);
  assert.equal(body.readInt32LE(160), 120);
  assert.equal(body.readUInt16LE(168), 23);
});

test("selects only enabled nearby monsters and requires their spawn tile to be walkable", () => {
  const distant = structuredClone(ENTRY);
  distant.id = "distant-monster";
  distant.properties.clientEntityId = 5001;
  distant.properties.spawnPosition = { x: 400, y: 400 };
  const disabled = structuredClone(ENTRY);
  disabled.id = "disabled-monster";
  disabled.properties.clientEntityId = 5002;
  disabled.enabled = false;
  assert.deepEqual(
    getWyd727MonstersForWorld(
      catalog([distant, disabled, structuredClone(ENTRY)]),
      { x: 321, y: 123 },
      walkability,
    ).map(({ id }) => id),
    ["goblin-sintetico"],
  );
  const blocked = structuredClone(ENTRY);
  blocked.properties.spawnPosition = { x: 324, y: 124 };
  assert.throws(() =>
    getWyd727MonstersForWorld(
      catalog([blocked]),
      { x: 321, y: 123 },
      walkability,
    ),
  );
});

test("rejects IDs or fields that the WYDBot would classify as a player or NPC", () => {
  const invalidStats = structuredClone(ENTRY);
  invalidStats.properties.startingStats.merchant = 2;
  assert.throws(() => validateWyd727MonsterCatalog(catalog([invalidStats])));
  const invalidBodyModel = structuredClone(ENTRY);
  invalidBodyModel.properties.equipModelIds[0] = 0x43;
  assert.throws(() =>
    validateWyd727MonsterCatalog(catalog([invalidBodyModel])),
  );
  assert.throws(() =>
    buildWyd727CreateMobBody({
      clientId: ENTRY.properties.clientEntityId,
      timestamp: 0,
      entry: structuredClone(ENTRY),
    }),
  );
});

test("validates an optional catalog-backed monster drop", () => {
  const withDrop = structuredClone(ENTRY);
  withDrop.properties.drop = {
    catalogItemId: "demo-tonico",
    quantity: 2,
    chanceBasisPoints: 2500,
  };
  const data = catalog([withDrop]);
  assert.equal(validateWyd727MonsterCatalog(data), data);

  for (const invalidDrop of [
    { ...withDrop.properties.drop, quantity: 0 },
    { ...withDrop.properties.drop, chanceBasisPoints: 10_001 },
    { ...withDrop.properties.drop, catalogItemId: "Bad ID" },
    { ...withDrop.properties.drop, extra: true },
  ]) {
    const invalid = structuredClone(withDrop);
    invalid.properties.drop = invalidDrop;
    assert.throws(() => validateWyd727MonsterCatalog(catalog([invalid])));
  }
});
