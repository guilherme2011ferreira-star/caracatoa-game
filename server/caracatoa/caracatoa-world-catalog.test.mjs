import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getCaracatoaMap,
  getCaracatoaMapSpawns,
  pointInWorldRect,
  validateCaracatoaWorldCatalog,
} from "./caracatoa-world-catalog.mjs";

const load = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const maps = load("./data/world/maps.json");
const spawns = load("./data/world/spawns.json");
const monsters = load("./data/catalogs/monsters.json");

test("Caracatoa map IDs, zones, portals and spawn ecology are consistent", () => {
  assert.deepEqual(validateCaracatoaWorldCatalog(maps, spawns, monsters), {
    mapCount: 10, spawnCount: 20, liveSpawnCount: 1, suspendedLiveSpawnCount: 0,
  });
  assert.equal(getCaracatoaMap(maps, 1).name, "Bastião do Amanhecer");
  assert.equal(getCaracatoaMapSpawns(spawns, 1)[0].monsterId, "golem-pedra");
  assert.equal(getCaracatoaMapSpawns(spawns, 8).length, 0);
  assert.equal(getCaracatoaMapSpawns(spawns, 8, "planned").length, 2);
  assert.equal(pointInWorldRect([128, 128], maps.entries[0].safeZones[0].bounds), true);
});

test("an empty editable monster catalog suspends live rows without blocking the admin service", () => {
  assert.deepEqual(validateCaracatoaWorldCatalog(maps, spawns, {
    schemaVersion: 1, kind: "monsters", entries: [],
  }, { allowMissingLiveMonsters: true }), {
    mapCount: 10, spawnCount: 20, liveSpawnCount: 0, suspendedLiveSpawnCount: 1,
  });
});

test("world catalog rejects portals outside target safe zones", () => {
  const invalid = structuredClone(maps);
  invalid.entries[0].portals[0].arrival = [300, 128];
  assert.throws(() => validateCaracatoaWorldCatalog(invalid, spawns, monsters),
    /portal\.arrival/);
});

test("world catalog rejects spawns inside safe zones and mismatched live monsters", () => {
  const unsafe = structuredClone(spawns);
  unsafe.entries[0].at = [128, 128];
  assert.throws(() => validateCaracatoaWorldCatalog(maps, unsafe, monsters),
    /spawn\.huntZone/);
  const mismatched = structuredClone(spawns);
  mismatched.entries[0].level = 2;
  assert.throws(() => validateCaracatoaWorldCatalog(maps, mismatched, monsters),
    /spawn\.liveMonster/);
});
