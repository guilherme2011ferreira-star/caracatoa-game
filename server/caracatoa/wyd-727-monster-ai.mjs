import { WYD727_DIRECTION_DELTAS } from "./wyd-727-walkability.mjs";

const DIRECTIONS = Object.entries(WYD727_DIRECTION_DELTAS).map(
  ([code, delta]) => ({ code: Number(code), delta }),
);
const MAX_INT16 = 0x7fff;
const MIN_INT16 = -0x8000;
export const DEFAULT_CARACATOA_MONSTER_AGGRO_RANGE = 8;
const MAX_SEARCHED_TILES = 512;

function validatePosition(position, label) {
  if (
    !position ||
    !Number.isInteger(position.x) ||
    position.x < MIN_INT16 ||
    position.x > MAX_INT16 ||
    !Number.isInteger(position.y) ||
    position.y < MIN_INT16 ||
    position.y > MAX_INT16
  ) {
    throw new RangeError(`${label} precisa conter coordenadas Int16.`);
  }
}

function positionKey(position) {
  return `${position.x},${position.y}`;
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/**
 * Find one deterministic WYD direction toward a player without entering the
 * player's tile, occupied tiles, or terrain rejected by the shared walk grid.
 */
export function findWyd727MonsterStep({
  origin,
  target,
  occupiedPositions = [],
  walkability,
  aggroRange = DEFAULT_CARACATOA_MONSTER_AGGRO_RANGE,
}) {
  validatePosition(origin, "origin");
  validatePosition(target, "target");
  if (
    !Number.isInteger(aggroRange) ||
    aggroRange < 1 ||
    aggroRange > DEFAULT_CARACATOA_MONSTER_AGGRO_RANGE
  ) {
    throw new RangeError("aggroRange precisa ficar entre 1 e 8.");
  }
  if (typeof walkability?.canStep !== "function") {
    throw new TypeError("walkability precisa fornecer canStep.");
  }
  if (!Array.isArray(occupiedPositions)) {
    throw new TypeError("occupiedPositions precisa ser uma lista.");
  }
  for (const position of occupiedPositions) {
    validatePosition(position, "occupiedPosition");
  }

  const initialDistance = chebyshevDistance(origin, target);
  if (initialDistance <= 1 || initialDistance > aggroRange) return null;

  const occupied = new Set(occupiedPositions.map(positionKey));
  occupied.add(positionKey(target));
  occupied.delete(positionKey(origin));

  const visited = new Set([positionKey(origin)]);
  const queue = [{ position: origin, firstDirectionCode: null, depth: 0 }];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];
    if (current.depth >= aggroRange) continue;

    for (const { code, delta } of DIRECTIONS) {
      const next = {
        x: current.position.x + delta.x,
        y: current.position.y + delta.y,
      };
      if (
        next.x < MIN_INT16 ||
        next.x > MAX_INT16 ||
        next.y < MIN_INT16 ||
        next.y > MAX_INT16 ||
        chebyshevDistance(origin, next) > aggroRange ||
        occupied.has(positionKey(next))
      ) {
        continue;
      }
      const nextKey = positionKey(next);
      if (visited.has(nextKey)) continue;
      if (
        !walkability.canStep(
          current.position.x,
          current.position.y,
          next.x,
          next.y,
        )
      ) {
        continue;
      }
      visited.add(nextKey);

      const firstDirectionCode = current.firstDirectionCode ?? code;
      const depth = current.depth + 1;
      if (chebyshevDistance(next, target) === 1) {
        const firstDelta = WYD727_DIRECTION_DELTAS[firstDirectionCode];
        return {
          directionCode: firstDirectionCode,
          destination: {
            x: origin.x + firstDelta.x,
            y: origin.y + firstDelta.y,
          },
          pathLength: depth,
        };
      }
      if (visited.size >= MAX_SEARCHED_TILES) return null;
      queue.push({ position: next, firstDirectionCode, depth });
    }
  }
  return null;
}
