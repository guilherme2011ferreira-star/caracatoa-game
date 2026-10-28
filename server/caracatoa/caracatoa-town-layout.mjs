import { pointInWorldRect } from "./caracatoa-world-catalog.mjs";

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} precisa ser finito.`);
}

function nonNegative(value, label) {
  finite(value, label);
  if (value < 0) throw new TypeError(`${label} não pode ser negativo.`);
}

function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new TypeError(`${label} precisa ser positivo.`);
}

function vector2(value, label, { positiveValues = false } = {}) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${label} precisa conter duas coordenadas.`);
  }
  value.forEach((coordinate, index) => {
    finite(coordinate, `${label}[${index}]`);
    if (positiveValues) positive(coordinate, `${label}[${index}]`);
  });
}

function isRect(rect) {
  return Array.isArray(rect) && rect.length === 4 &&
    rect.every(Number.isInteger) && rect[0] <= rect[2] && rect[1] <= rect[3];
}

function transformPoint([x, z], transform) {
  return [
    transform.origin[0] + (x * transform.sceneXToWorldX) / transform.tileSize,
    transform.origin[1] + (z * transform.sceneZToWorldY) / transform.tileSize,
  ];
}

function sceneRectBounds(center, size, padding, transform) {
  const [centerX, centerZ] = center;
  const [width, depth] = size;
  const points = [
    [centerX - width / 2 - padding, centerZ - depth / 2 - padding],
    [centerX - width / 2 - padding, centerZ + depth / 2 + padding],
    [centerX + width / 2 + padding, centerZ - depth / 2 - padding],
    [centerX + width / 2 + padding, centerZ + depth / 2 + padding],
  ].map((point) => transformPoint(point, transform));
  return [
    Math.floor(Math.min(...points.map(([x]) => x))),
    Math.floor(Math.min(...points.map(([, y]) => y))),
    Math.ceil(Math.max(...points.map(([x]) => x))),
    Math.ceil(Math.max(...points.map(([, y]) => y))),
  ];
}

function sceneGroundBounds(ground, transform) {
  const [centerX, centerZ] = ground.center;
  const [width, depth] = ground.size;
  const points = [
    [centerX - width / 2, centerZ - depth / 2],
    [centerX - width / 2, centerZ + depth / 2],
    [centerX + width / 2, centerZ - depth / 2],
    [centerX + width / 2, centerZ + depth / 2],
  ].map((point) => transformPoint(point, transform));
  return [
    Math.ceil(Math.min(...points.map(([x]) => x))),
    Math.ceil(Math.min(...points.map(([, y]) => y))),
    Math.floor(Math.max(...points.map(([x]) => x))),
    Math.floor(Math.max(...points.map(([, y]) => y))),
  ];
}

function makeBlockedZone(id, center, size, padding, transform, walkableBounds) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("Cada obstáculo precisa de um ID estável.");
  }
  vector2(center, `${id}.center`);
  vector2(size, `${id}.size`, { positiveValues: true });
  nonNegative(padding, `${id}.padding`);
  const bounds = sceneRectBounds(center, size, padding, transform);
  const clipped = [
    Math.max(bounds[0], walkableBounds[0]),
    Math.max(bounds[1], walkableBounds[1]),
    Math.min(bounds[2], walkableBounds[2]),
    Math.min(bounds[3], walkableBounds[3]),
  ];
  if (clipped[0] > clipped[2] || clipped[1] > clipped[3]) return null;
  return { id, bounds: clipped };
}

export function createCaracatoaNavigationFromTownLayout(layout, mapBounds = null) {
  if (
    !layout ||
    layout.schemaVersion !== 1 ||
    layout.kind !== "caracatoa-town-layout" ||
    !Number.isSafeInteger(layout.mapId) ||
    layout.mapId < 1 ||
    typeof layout.layoutRevision !== "string" ||
    layout.layoutRevision.length === 0
  ) {
    throw new TypeError("Layout do Bastião inválido.");
  }

  const transform = layout.sceneToWorld;
  if (!transform || !Array.isArray(transform.origin) || transform.origin.length !== 2 ||
    !transform.origin.every(Number.isInteger)) {
    throw new TypeError("Origem do Bastião inválida.");
  }
  positive(transform.tileSize, "sceneToWorld.tileSize");
  finite(transform.sceneXToWorldX, "sceneToWorld.sceneXToWorldX");
  finite(transform.sceneZToWorldY, "sceneToWorld.sceneZToWorldY");
  if (transform.sceneXToWorldX === 0 || transform.sceneZToWorldY === 0) {
    throw new TypeError("Escalas de coordenadas do Bastião não podem ser zero.");
  }

  if (
    !layout.terrain?.foundation ||
    !Array.isArray(layout.houses) ||
    !Array.isArray(layout.marketStalls) ||
    !Array.isArray(layout.trees) ||
    !Array.isArray(layout.lanterns) ||
    !Array.isArray(layout.perimeterWalls) ||
    !layout.fountain ||
    !layout.navigation
  ) {
    throw new TypeError("Layout do Bastião não descreve todos os elementos de navegação.");
  }

  const foundation = layout.terrain.foundation;
  vector2(foundation.center, "terrain.foundation.center");
  vector2(foundation.size, "terrain.foundation.size", { positiveValues: true });
  let walkableBounds = sceneGroundBounds(foundation, transform);
  if (!isRect(walkableBounds)) throw new RangeError("A fundação do Bastião não contém tiles caminháveis.");
  if (mapBounds !== null && (!isRect(mapBounds) ||
    !pointInWorldRect([walkableBounds[0], walkableBounds[1]], mapBounds) ||
    !pointInWorldRect([walkableBounds[2], walkableBounds[3]], mapBounds))) {
    throw new RangeError("A fundação do Bastião precisa caber dentro dos limites do mapa.");
  }

  const padding = layout.navigation.footprintPadding;
  nonNegative(padding, "navigation.footprintPadding");
  const gate = layout.landmarks?.astralGate;
  let gateSceneCenter = null;
  let gateSceneSize = null;
  if (gate?.closed) {
    vector2(gate.instanceSceneXZ, "landmarks.astralGate.instanceSceneXZ");
    positive(gate.uniformScale, "landmarks.astralGate.uniformScale");
    vector2(gate.wallFootprintLocal?.center, "landmarks.astralGate.wallFootprintLocal.center");
    vector2(gate.wallFootprintLocal?.size, "landmarks.astralGate.wallFootprintLocal.size", { positiveValues: true });
    gateSceneCenter = [
      gate.instanceSceneXZ[0] + gate.wallFootprintLocal.center[0] * gate.uniformScale,
      gate.instanceSceneXZ[1] + gate.wallFootprintLocal.center[1] * gate.uniformScale,
    ];
    gateSceneSize = gate.wallFootprintLocal.size.map((value) => value * gate.uniformScale);
    const unboundedThreshold = makeBlockedZone(
      gate.id,
      gateSceneCenter,
      gateSceneSize,
      0,
      transform,
      walkableBounds,
    );
    if (!unboundedThreshold) throw new RangeError("O portão fechado não cruza a fundação caminhável.");
    if (layout.navigation.clipBeyondClosedAstralGate) {
      walkableBounds = [
        walkableBounds[0],
        walkableBounds[1],
        walkableBounds[2],
        Math.min(walkableBounds[3], unboundedThreshold.bounds[1]),
      ];
      if (!isRect(walkableBounds)) throw new RangeError("O limite do portão eliminou a área caminhável.");
    }
  } else if (layout.navigation.clipBeyondClosedAstralGate) {
    throw new TypeError("O limite além do portão exige que landmarks.astralGate.closed seja true.");
  }

  const blockedZones = [];
  const append = (zone) => { if (zone) blockedZones.push(zone); };

  if (gate?.closed) {
    append(makeBlockedZone(gate.id, gateSceneCenter, gateSceneSize, 0, transform, walkableBounds));
  }
  for (const wall of layout.perimeterWalls) {
    append(makeBlockedZone(wall.id, wall.center, [wall.width, wall.depth], padding, transform, walkableBounds));
  }
  for (const house of layout.houses) {
    const expansion = layout.navigation.houseFoundationExpansion ?? 0;
    nonNegative(expansion, "navigation.houseFoundationExpansion");
    append(makeBlockedZone(
      house.id,
      house.center,
      [house.width + 0.52, house.depth + 0.52],
      padding + expansion,
      transform,
      walkableBounds,
    ));
  }
  append(makeBlockedZone(
    layout.fountain.id,
    layout.fountain.center,
    layout.fountain.size,
    padding,
    transform,
    walkableBounds,
  ));
  if (layout.navigation.blockMarketCounters) {
    for (const stall of layout.marketStalls) {
      append(makeBlockedZone(stall.id, stall.center, stall.counterSize, padding, transform, walkableBounds));
    }
  }
  if (layout.navigation.blockTreeTrunks) {
    for (const tree of layout.trees) {
      const diameter = tree.trunkRadius * 2;
      append(makeBlockedZone(tree.id, tree.center, [diameter, diameter], padding, transform, walkableBounds));
    }
  }
  if (layout.navigation.blockLanternBases) {
    for (const lantern of layout.lanterns) {
      const diameter = lantern.baseRadius * 2;
      append(makeBlockedZone(lantern.id, lantern.center, [diameter, diameter], padding, transform, walkableBounds));
    }
  }

  const zoneIds = blockedZones.map(({ id }) => id);
  if (new Set(zoneIds).size !== zoneIds.length) throw new TypeError("IDs de obstáculos duplicados no layout do Bastião.");

  return {
    schemaVersion: 1,
    kind: "caracatoa-navigation",
    coordinateSystem: "world-grid-4096-v1",
    entries: [{
      mapId: layout.mapId,
      source: layout.layoutRevision,
      walkableBounds,
      blockedZones,
    }],
  };
}
