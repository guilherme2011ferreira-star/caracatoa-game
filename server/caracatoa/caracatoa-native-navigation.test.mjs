import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCaracatoaNativeWalkability } from "./caracatoa-native-navigation.mjs";
import { createCaracatoaNavigationFromTownLayout } from "./caracatoa-town-layout.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

test("mapa nativo do Bastião limita o movimento à praça e bloqueia estruturas", async () => {
  const [navigation, maps, spawns, layout] = await Promise.all([
    readFile(join(APP_DIR, "data/world/navigation.json"), "utf8").then(JSON.parse),
    readFile(join(APP_DIR, "data/world/maps.json"), "utf8").then(JSON.parse),
    readFile(join(APP_DIR, "data/world/spawns.json"), "utf8").then(JSON.parse),
    readFile(join(APP_DIR, "data/world/bastiao-layout.json"), "utf8").then(JSON.parse),
  ]);
  const map = maps.entries.find((entry) => entry.mapId === 1);
  assert.deepEqual(createCaracatoaNavigationFromTownLayout(layout, map.bounds), navigation);
  const walkability = createCaracatoaNativeWalkability(navigation, 1);
  const start = map.entry;
  const activeSpawns = spawns.entries.filter((entry) => entry.mapId === 1 && entry.status === "live");

  assert.equal(walkability.isWalkablePosition(...start), true);
  assert.equal(walkability.isWalkablePosition(130, 128), true);
  assert.equal(walkability.isWalkablePosition(125, 120), true);
  assert.equal(walkability.isWalkablePosition(144, 121), false);
  assert.equal(walkability.isWalkablePosition(120, 124), false);
  assert.equal(walkability.isWalkablePosition(108, 125), false);
  assert.equal(walkability.isWalkablePosition(128, 154), true);
  assert.equal(walkability.isWalkablePosition(128, 155), false);
  assert.equal(walkability.isWalkablePosition(128, 156), false);
  assert.equal(walkability.canStep(128, 154, 128, 155), false);
  assert.equal(walkability.isWalkablePosition(120, 155), true);
  assert.equal(walkability.isWalkablePosition(120, 156), false);
  assert.equal(walkability.canStep(120, 155, 120, 156), false);
  assert.equal(walkability.isWalkablePosition(107, 130), false);
  assert.equal(walkability.isWalkablePosition(100, 128), false);
  assert.equal(walkability.isWalkablePosition(156, 128), false);
  assert.equal(walkability.canStep(128, 128, 129, 128), true);
  assert.equal(walkability.canStep(128, 128, 125, 120), true);
  assert.deepEqual(activeSpawns.map((spawn) => spawn.at), [[130, 128]]);
});

test("navegação do Bastião deriva limites, obstáculos e coordenadas do layout 3D", async () => {
  const [layout, maps, collection] = await Promise.all([
    readFile(join(APP_DIR, "data/world/bastiao-layout.json"), "utf8").then(JSON.parse),
    readFile(join(APP_DIR, "data/world/maps.json"), "utf8").then(JSON.parse),
    readFile(join(APP_DIR, "../../work/caracatoa-defold-prototype/main/main.collection"), "utf8"),
  ]);
  const map = maps.entries.find((entry) => entry.mapId === layout.mapId);
  const navigation = createCaracatoaNavigationFromTownLayout(layout, map.bounds);
  const entry = navigation.entries[0];

  assert.equal(entry.source, layout.layoutRevision);
  assert.deepEqual(entry.walkableBounds, [101, 101, 155, 155]);
  assert.equal(entry.blockedZones.length, 22);
  assert.deepEqual(
    entry.blockedZones.find((zone) => zone.id === layout.landmarks.astralGate.id)?.bounds,
    [121, 155, 135, 155],
  );
  const gateInstance = collection.match(/embedded_instances \{\s*id: "portao_astral"([\s\S]*?)\n\}/)?.[1];
  assert.ok(gateInstance, "instância do Portão Astral precisa existir na cena Defold");
  const gatePosition = gateInstance.match(/position \{([^}]*)\}/)?.[1] ?? "";
  const gateScale = gateInstance.match(/scale3 \{([^}]*)\}/)?.[1] ?? "";
  const readField = (block, field) => Number(
    block.match(new RegExp("\\b" + field + "\\s*:\\s*(-?\\d+(?:\\.\\d+)?)"))?.[1] ?? 0,
  );
  assert.deepEqual(
    [readField(gatePosition, "x"), readField(gatePosition, "z")],
    layout.landmarks.astralGate.instanceSceneXZ,
  );
  for (const axis of ["x", "y", "z"]) {
    assert.equal(readField(gateScale, axis), layout.landmarks.astralGate.uniformScale);
  }
  assert.throws(
    () => createCaracatoaNavigationFromTownLayout(layout, [0, 0, 120, 120]),
    /precisa caber dentro dos limites/,
  );
});

test("navegação nativa rejeita configuração inválida e mapas ainda planejados", () => {
  assert.throws(() => createCaracatoaNativeWalkability({}, 1), /inválido/);
  assert.throws(() => createCaracatoaNativeWalkability({
    schemaVersion: 1,
    kind: "caracatoa-navigation",
    coordinateSystem: "world-grid-4096-v1",
    entries: [{ mapId: 2, walkableBounds: [0, 0, 10, 10], blockedZones: [] }],
  }, 3), /Não há navegação/);
  assert.throws(() => createCaracatoaNativeWalkability({
    schemaVersion: 1,
    kind: "caracatoa-navigation",
    coordinateSystem: "world-grid-4096-v1",
    entries: [{
      mapId: 1,
      walkableBounds: [0, 0, 10, 10],
      blockedZones: [{ id: "fora", bounds: [-1, 0, 1, 1] }],
    }],
  }, 1), /Zona bloqueada inválida/);
  assert.throws(() => createCaracatoaNativeWalkability({
    schemaVersion: 1,
    kind: "caracatoa-navigation",
    coordinateSystem: "world-grid-4096-v1",
    entries: [
      { mapId: 1, walkableBounds: [0, 0, 10, 10], blockedZones: [] },
      { mapId: 1, walkableBounds: [0, 0, 10, 10], blockedZones: [] },
    ],
  }, 1), /IDs de mapa duplicados/);
});
