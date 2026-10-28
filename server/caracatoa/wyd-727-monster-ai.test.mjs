import assert from "node:assert/strict";
import test from "node:test";
import { findWyd727MonsterStep } from "./wyd-727-monster-ai.mjs";

const openGrid = { canStep: () => true };

test("monster pathfinder chooses the shortest first WYD step toward a player", () => {
  assert.deepEqual(
    findWyd727MonsterStep({
      origin: { x: 5, y: 5 },
      target: { x: 8, y: 5 },
      walkability: openGrid,
    }),
    {
      directionCode: 0x33,
      destination: { x: 6, y: 4 },
      pathLength: 2,
    },
  );
});

test("monster pathfinder routes around blocked terrain and occupied tiles", () => {
  const movement = findWyd727MonsterStep({
    origin: { x: 5, y: 5 },
    target: { x: 8, y: 5 },
    occupiedPositions: [{ x: 6, y: 5 }],
    walkability: {
      canStep: (_x, _y, nextX, nextY) => !(nextX === 6 && nextY === 4),
    },
  });
  assert.ok(movement);
  assert.notDeepEqual(movement.destination, { x: 6, y: 5 });
  assert.notDeepEqual(movement.destination, { x: 6, y: 4 });
  assert.equal(
    Math.max(
      Math.abs(8 - movement.destination.x),
      Math.abs(5 - movement.destination.y),
    ),
    2,
  );
});

test("monster does not enter the player's tile or move when adjacent/out of range", () => {
  assert.equal(
    findWyd727MonsterStep({
      origin: { x: 5, y: 5 },
      target: { x: 6, y: 5 },
      walkability: openGrid,
    }),
    null,
  );
  assert.equal(
    findWyd727MonsterStep({
      origin: { x: 5, y: 5 },
      target: { x: 14, y: 5 },
      walkability: openGrid,
    }),
    null,
  );
  const approach = findWyd727MonsterStep({
    origin: { x: 5, y: 5 },
    target: { x: 8, y: 5 },
    walkability: openGrid,
  });
  assert.notDeepEqual(approach.destination, { x: 8, y: 5 });
});

test("monster pathfinder stops when no valid adjacent tile is reachable", () => {
  assert.equal(
    findWyd727MonsterStep({
      origin: { x: 5, y: 5 },
      target: { x: 8, y: 5 },
      walkability: { canStep: () => false },
    }),
    null,
  );
});
