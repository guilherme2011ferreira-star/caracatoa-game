import { pointInWorldRect } from "./caracatoa-world-catalog.mjs";

function isIntegerRect(rect) {
  return (
    Array.isArray(rect) &&
    rect.length === 4 &&
    rect.every((coordinate) =>
      Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 4095,
    ) &&
    rect[0] <= rect[2] &&
    rect[1] <= rect[3]
  );
}

export function createCaracatoaNativeWalkability(navigation, mapId, mapBounds = null) {
  if (
    !navigation ||
    navigation.schemaVersion !== 1 ||
    navigation.kind !== "caracatoa-navigation" ||
    navigation.coordinateSystem !== "world-grid-4096-v1" ||
    !Array.isArray(navigation.entries)
  ) {
    throw new TypeError("Catálogo de navegação nativa Caracatoa inválido.");
  }
  const mapIds = navigation.entries.map((candidate) => candidate?.mapId);
  if (
    mapIds.some((candidate) => !Number.isSafeInteger(candidate) || candidate < 1) ||
    new Set(mapIds).size !== mapIds.length
  ) {
    throw new TypeError("IDs de mapa duplicados ou inválidos na navegação nativa.");
  }

  const entry = navigation.entries.find((candidate) => candidate.mapId === mapId);
  if (!entry) {
    throw new RangeError(`Não há navegação nativa para o mapa ${mapId}.`);
  }
  if (!isIntegerRect(entry.walkableBounds)) {
    throw new TypeError("walkableBounds precisa conter limites inteiros válidos.");
  }
  if (
    mapBounds !== null &&
    (!isIntegerRect(mapBounds) ||
      !pointInWorldRect([entry.walkableBounds[0], entry.walkableBounds[1]], mapBounds) ||
      !pointInWorldRect([entry.walkableBounds[2], entry.walkableBounds[3]], mapBounds))
  ) {
    throw new RangeError("walkableBounds precisa ficar dentro do mapa Caracatoa.");
  }
  if (!Array.isArray(entry.blockedZones)) {
    throw new TypeError("blockedZones precisa ser uma lista.");
  }

  const zoneIds = new Set();
  const blockedRects = entry.blockedZones.map((zone) => {
    if (
      !zone ||
      typeof zone.id !== "string" ||
      zone.id.length === 0 ||
      zoneIds.has(zone.id) ||
      !isIntegerRect(zone.bounds) ||
      !pointInWorldRect([zone.bounds[0], zone.bounds[1]], entry.walkableBounds) ||
      !pointInWorldRect([zone.bounds[2], zone.bounds[3]], entry.walkableBounds)
    ) {
      throw new TypeError("Zona bloqueada inválida ou fora dos limites caminháveis.");
    }
    zoneIds.add(zone.id);
    return zone.bounds;
  });

  const isWalkablePosition = (x, y) =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    pointInWorldRect([x, y], entry.walkableBounds) &&
    !blockedRects.some((bounds) => pointInWorldRect([x, y], bounds));

  const canStep = (fromX, fromY, toX, toY) =>
    isWalkablePosition(fromX, fromY) && isWalkablePosition(toX, toY);

  return Object.freeze({
    mapId: entry.mapId,
    isWalkablePosition,
    canStep,
  });
}
