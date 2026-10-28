const WORLD_SIZE = 4096;
const MAX_LEVEL = 400;

function fail(label) {
  throw new Error(`${label} inválido no catálogo espacial Caracatoa.`);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
}

function exactKeys(value, keys, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    fail(label);
  }
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(label);
}

function shortText(value, label, max = 120) {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max) {
    fail(label);
  }
}

function point(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(label);
  integer(value[0], 0, WORLD_SIZE - 1, `${label}.x`);
  integer(value[1], 0, WORLD_SIZE - 1, `${label}.y`);
}

function rectangle(value, label) {
  if (!Array.isArray(value) || value.length !== 4) fail(label);
  value.forEach((coordinate, i) => integer(coordinate, 0, WORLD_SIZE - 1, `${label}[${i}]`));
  if (value[0] > value[2] || value[1] > value[3]) fail(label);
}

export function pointInWorldRect(position, bounds) {
  return position[0] >= bounds[0] && position[0] <= bounds[2] &&
    position[1] >= bounds[1] && position[1] <= bounds[3];
}

function rectanglesOverlap(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function validateZones(zones, mapBounds, label) {
  if (!Array.isArray(zones) || zones.length < 1 || zones.length > 32) fail(label);
  const ids = new Set();
  for (const zone of zones) {
    exactKeys(zone, ["id", "bounds"], `${label}.zone`);
    if (typeof zone.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(zone.id) || ids.has(zone.id)) {
      fail(`${label}.id`);
    }
    ids.add(zone.id);
    rectangle(zone.bounds, `${label}.bounds`);
    if (!pointInWorldRect(zone.bounds.slice(0, 2), mapBounds) ||
        !pointInWorldRect(zone.bounds.slice(2, 4), mapBounds)) fail(`${label}.bounds`);
  }
}

function validateMap(entry) {
  exactKeys(entry, ["mapId", "slug", "name", "recommendedLevels", "bounds", "entry",
    "safeZones", "huntZones", "portals", "architecture", "biome"], "mapa");
  integer(entry.mapId, 1, 255, "mapId");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)) fail("slug");
  shortText(entry.name, "name", 64);
  if (!Array.isArray(entry.recommendedLevels) || entry.recommendedLevels.length !== 2) {
    fail("recommendedLevels");
  }
  integer(entry.recommendedLevels[0], 1, MAX_LEVEL, "recommendedLevels.min");
  integer(entry.recommendedLevels[1], entry.recommendedLevels[0], MAX_LEVEL, "recommendedLevels.max");
  rectangle(entry.bounds, "map.bounds");
  point(entry.entry, "map.entry");
  if (!pointInWorldRect(entry.entry, entry.bounds)) fail("map.entry");
  validateZones(entry.safeZones, entry.bounds, "safeZones");
  validateZones(entry.huntZones, entry.bounds, "huntZones");
  if (!entry.safeZones.some((zone) => pointInWorldRect(entry.entry, zone.bounds))) fail("entry.safeZone");
  for (const safe of entry.safeZones) {
    for (const hunt of entry.huntZones) {
      if (rectanglesOverlap(safe.bounds, hunt.bounds)) fail("safe/hunt overlap");
    }
  }
  if (!Array.isArray(entry.portals) || entry.portals.length > 16) fail("portals");
  for (const portal of entry.portals) {
    exactKeys(portal, ["toMapId", "at", "arrival"], "portal");
    integer(portal.toMapId, 1, 255, "portal.toMapId");
    point(portal.at, "portal.at");
    point(portal.arrival, "portal.arrival");
    if (!pointInWorldRect(portal.at, entry.bounds)) fail("portal.at");
  }
  exactKeys(entry.architecture, ["style", "masonry", "woodwork"], "architecture");
  for (const key of ["style", "masonry", "woodwork"]) shortText(entry.architecture[key], `architecture.${key}`);
  exactKeys(entry.biome, ["type", "climate", "lighting", "fog", "vegetation", "palette"], "biome");
  for (const key of ["type", "climate", "lighting", "fog", "vegetation"]) {
    shortText(entry.biome[key], `biome.${key}`);
  }
  if (!Array.isArray(entry.biome.palette) || entry.biome.palette.length !== 3 ||
      entry.biome.palette.some((color) => typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    fail("biome.palette");
  }
}

function validateSpawn(entry, mapsById, liveMonsters, allowMissingLiveMonsters) {
  exactKeys(entry, ["spawnId", "mapId", "monsterId", "name", "level", "at", "radius",
    "respawnMs", "ai", "attackType", "tier", "status"], "spawn");
  integer(entry.spawnId, 1, 0x7fffffff, "spawnId");
  integer(entry.mapId, 1, 255, "spawn.mapId");
  const map = mapsById.get(entry.mapId);
  if (!map) fail("spawn.mapId");
  if (typeof entry.monsterId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.monsterId)) {
    fail("spawn.monsterId");
  }
  shortText(entry.name, "spawn.name", 64);
  integer(entry.level, map.recommendedLevels[0], map.recommendedLevels[1], "spawn.level");
  point(entry.at, "spawn.at");
  if (!map.huntZones.some((zone) => pointInWorldRect(entry.at, zone.bounds))) fail("spawn.huntZone");
  integer(entry.radius, 0, 32, "spawn.radius");
  integer(entry.respawnMs, 1000, 86_400_000, "spawn.respawnMs");
  if (!["passive", "aggressive"].includes(entry.ai)) fail("spawn.ai");
  if (!["physical", "magic", "area"].includes(entry.attackType)) fail("spawn.attackType");
  if (!["common", "elite", "boss"].includes(entry.tier)) fail("spawn.tier");
  if (!["live", "planned"].includes(entry.status)) fail("spawn.status");
  if (entry.status === "live") {
    const monster = liveMonsters.get(entry.monsterId);
    if ((!monster || !monster.enabled) && allowMissingLiveMonsters) return false;
    if (!monster?.enabled || monster.properties.level !== entry.level ||
        monster.properties.spawnPosition.x !== entry.at[0] ||
        monster.properties.spawnPosition.y !== entry.at[1]) fail("spawn.liveMonster");
    return true;
  }
  return false;
}

/** Map IDs are original Caracatoa IDs, never asserted to equal WYD map numbers. */
export function validateCaracatoaWorldCatalog(maps, spawns, monsterCatalog, {
  allowMissingLiveMonsters = false,
} = {}) {
  if (typeof allowMissingLiveMonsters !== "boolean") fail("options");
  exactKeys(maps, ["schemaVersion", "kind", "coordinateSystem", "entries"], "maps");
  exactKeys(spawns, ["schemaVersion", "kind", "entries"], "spawns");
  if (maps.schemaVersion !== 1 || maps.kind !== "caracatoa-maps" ||
      maps.coordinateSystem !== "world-grid-4096-v1" || !Array.isArray(maps.entries) ||
      maps.entries.length < 1 || maps.entries.length > 255) fail("maps.header");
  if (spawns.schemaVersion !== 1 || spawns.kind !== "caracatoa-spawns" ||
      !Array.isArray(spawns.entries)) fail("spawns.header");
  const mapsById = new Map();
  const slugs = new Set();
  for (const map of maps.entries) {
    validateMap(map);
    if (mapsById.has(map.mapId) || slugs.has(map.slug)) fail("map.duplicate");
    for (const other of mapsById.values()) {
      if (rectanglesOverlap(map.bounds, other.bounds)) fail("map.boundsOverlap");
    }
    mapsById.set(map.mapId, map);
    slugs.add(map.slug);
  }
  for (const map of maps.entries) {
    for (const portal of map.portals) {
      const target = mapsById.get(portal.toMapId);
      if (!target || !pointInWorldRect(portal.arrival, target.bounds) ||
          !target.safeZones.some((zone) => pointInWorldRect(portal.arrival, zone.bounds))) {
        fail("portal.arrival");
      }
    }
  }
  const liveMonsters = new Map((monsterCatalog?.entries ?? []).map((entry) => [entry.id, entry]));
  const spawnIds = new Set();
  let liveSpawnCount = 0;
  for (const spawn of spawns.entries) {
    if (validateSpawn(spawn, mapsById, liveMonsters, allowMissingLiveMonsters)) {
      liveSpawnCount += 1;
    }
    if (spawnIds.has(spawn.spawnId)) fail("spawn.duplicate");
    spawnIds.add(spawn.spawnId);
  }
  return { mapCount: maps.entries.length, spawnCount: spawns.entries.length,
    liveSpawnCount, suspendedLiveSpawnCount: spawns.entries.filter((entry) =>
      entry.status === "live").length - liveSpawnCount };
}

export function getCaracatoaMap(maps, mapId) {
  return maps.entries.find((entry) => entry.mapId === mapId) ?? null;
}

export function getCaracatoaMapSpawns(spawns, mapId, status = "live") {
  return spawns.entries.filter((entry) => entry.mapId === mapId && entry.status === status);
}
