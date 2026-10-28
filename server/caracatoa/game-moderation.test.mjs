import assert from "node:assert/strict";
import test from "node:test";
import {
  createWyd727GameModerationService,
  GameModerationError,
} from "./game-moderation.mjs";

const actor = { id: "moderator", role: "moderator" };
const before = {
  clientEntityId: 5000,
  position: { x: 322, y: 123 },
  currentHp: 70,
  maxHp: 70,
  respawnAt: 0,
  activeSessions: 1,
};
const request = {
  action: "kill",
  clientEntityId: 5000,
  position: { x: 322, y: 123 },
};

function createService({ monsters = [before], moderateMonster, audit } = {}) {
  const events = [];
  const gameListener = {
    listWorldMonsters: () => structuredClone(monsters),
    moderateMonster:
      moderateMonster ??
      (() => ({ ...before, currentHp: 0, respawnAt: 61_000 })),
  };
  return {
    events,
    service: createWyd727GameModerationService({
      gameListener,
      audit:
        audit ??
        (async (...event) => {
          events.push(event);
        }),
    }),
  };
}

test("admin and moderator can read loaded monster state", () => {
  const { service } = createService();
  assert.deepEqual(service.listMonsters(actor), [before]);
  assert.deepEqual(service.listMonsters({ id: "admin", role: "admin" }), [
    before,
  ]);
});

test("player roles cannot read or change live game state", async () => {
  const { service, events } = createService();
  assert.throws(
    () => service.listMonsters({ id: "player", role: "player" }),
    (error) => error instanceof GameModerationError && error.status === 403,
  );
  await assert.rejects(
    service.moderateMonster({ id: "player", role: "player" }, request),
    (error) => error instanceof GameModerationError && error.status === 403,
  );
  assert.equal(events.length, 0);
});

test("moderation persists request and result audit around the live command", async () => {
  const { service, events } = createService();
  const result = await service.moderateMonster(actor, request);
  assert.equal(result.currentHp, 0);
  assert.deepEqual(
    events.map((event) => [event[1], event[3], event[5].status]),
    [
      ["game.monster.action.requested", "5000:322:123", "requested"],
      ["game.monster.action.applied", "5000:322:123", "applied"],
    ],
  );
  assert.equal(events[0][0], actor);
  assert.deepEqual(events[0][4], before);
  assert.equal(events[1][5].currentHp, 0);
});

test("rejects malformed, unloaded, inactive, and unchanged targets", async () => {
  const { service } = createService();
  await assert.rejects(
    service.moderateMonster(actor, { ...request, unexpected: true }),
    (error) => error instanceof GameModerationError && error.status === 400,
  );

  const unloaded = createService({ monsters: [] }).service;
  await assert.rejects(
    unloaded.moderateMonster(actor, request),
    (error) => error instanceof GameModerationError && error.status === 404,
  );

  const inactive = createService({
    monsters: [{ ...before, activeSessions: 0 }],
  }).service;
  await assert.rejects(
    inactive.moderateMonster(actor, request),
    (error) => error instanceof GameModerationError && error.status === 409,
  );

  const unchanged = createService({
    monsters: [{ ...before, currentHp: 0, respawnAt: 61_000 }],
  }).service;
  await assert.rejects(
    unchanged.moderateMonster(actor, request),
    (error) => error instanceof GameModerationError && error.status === 409,
  );
});

test("records failed live actions after the authorized request", async () => {
  const { service, events } = createService({
    moderateMonster() {
      const error = new Error("not active");
      error.code = "monster-not-active";
      throw error;
    },
  });
  await assert.rejects(
    service.moderateMonster(actor, request),
    (error) => error instanceof GameModerationError && error.status === 409,
  );
  assert.deepEqual(
    events.map((event) => [event[1], event[5].status]),
    [
      ["game.monster.action.requested", "requested"],
      ["game.monster.action.failed", "failed"],
    ],
  );
});
