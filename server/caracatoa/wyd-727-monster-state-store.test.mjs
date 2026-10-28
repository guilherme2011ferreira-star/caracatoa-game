import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Wyd727MonsterStateStore } from "./wyd-727-monster-state-store.mjs";

const monsterFixture = {
  clientEntityId: 0xfff0,
  position: { x: 322, y: 123 },
  defense: 5,
  maxHp: 70,
  currentHp: 70,
};

async function temporaryStateStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-monster-state-"));
  const databasePath = join(directory, "world-monsters.sqlite");
  let store = new Wyd727MonsterStateStore({ databasePath });
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Wyd727MonsterStateStore({ databasePath });
      return store;
    },
  };
}

test("initializes one shared monster row from catalog values", async (t) => {
  const fixture = await temporaryStateStore(t);
  assert.deepEqual(fixture.store.initialize(monsterFixture, 1_000), {
    ...monsterFixture,
    respawnAt: 0,
    respawned: false,
  });
  assert.deepEqual(fixture.store.initialize(monsterFixture, 2_000), {
    ...monsterFixture,
    respawnAt: 0,
    respawned: false,
  });
});

test("persists shared damage and death across store reopen", async (t) => {
  const fixture = await temporaryStateStore(t);
  fixture.store.initialize(monsterFixture, 1_000);
  const firstHit = fixture.store.applyDamage(monsterFixture, 36, 1_000, 60_000);
  assert.equal(firstHit.damage, 36);
  assert.equal(firstHit.currentHp, 34);
  assert.equal(firstHit.died, false);

  fixture.reopen();
  const lethalHit = fixture.store.applyDamage(
    { ...monsterFixture, currentHp: 34 },
    41,
    2_000,
    60_000,
  );
  assert.equal(lethalHit.damage, 34);
  assert.equal(lethalHit.currentHp, 0);
  assert.equal(lethalHit.died, true);
  assert.equal(lethalHit.respawnAt, 62_000);
  fixture.reopen();
  const beforeRespawn = fixture.store.initialize(monsterFixture, 61_999);
  assert.equal(beforeRespawn.currentHp, 0);
  assert.equal(beforeRespawn.respawnAt, 62_000);
});

test("respawns once when due and preserves the catalog's current combat stats", async (t) => {
  const fixture = await temporaryStateStore(t);
  fixture.store.initialize(monsterFixture, 1_000);
  fixture.store.applyDamage(monsterFixture, 70, 1_000, 60_000);

  assert.equal(fixture.store.respawn(monsterFixture, 60_999), null);
  const respawned = fixture.store.respawn(monsterFixture, 61_000);
  assert.equal(respawned.currentHp, 70);
  assert.equal(respawned.maxHp, 70);
  assert.equal(respawned.respawnAt, 0);
  assert.equal(respawned.respawned, true);
  assert.equal(fixture.store.respawn(monsterFixture, 61_001), null);

  const changedCatalog = {
    ...monsterFixture,
    maxHp: 50,
    currentHp: 50,
    defense: 9,
  };
  const persisted = fixture.store.initialize(changedCatalog, 62_000);
  assert.equal(persisted.currentHp, 50);
  assert.equal(persisted.maxHp, 50);
  assert.equal(persisted.defense, 9);
});

test("does not let a dead monster take further damage", async (t) => {
  const fixture = await temporaryStateStore(t);
  fixture.store.initialize(monsterFixture, 1_000);
  fixture.store.applyDamage(monsterFixture, 70, 1_000, 60_000);
  const ignored = fixture.store.applyDamage(
    { ...monsterFixture, currentHp: 0 },
    10,
    2_000,
    60_000,
  );
  assert.equal(ignored.damage, 0);
  assert.equal(ignored.currentHp, 0);
  assert.equal(ignored.died, false);
});

test("persists moderator kill and revive as authoritative HP changes", async (t) => {
  const fixture = await temporaryStateStore(t);
  fixture.store.initialize(monsterFixture, 1_000);

  const killed = fixture.store.applyModeration(
    monsterFixture,
    "kill",
    1_000,
    60_000,
  );
  assert.equal(killed.changed, true);
  assert.equal(killed.before.currentHp, 70);
  assert.equal(killed.after.currentHp, 0);
  assert.equal(killed.after.respawnAt, 61_000);

  const repeatedKill = fixture.store.applyModeration(
    { ...monsterFixture, currentHp: 0 },
    "kill",
    2_000,
    60_000,
  );
  assert.equal(repeatedKill.changed, false);
  assert.equal(repeatedKill.after.respawnAt, 61_000);

  fixture.reopen();
  const revived = fixture.store.applyModeration(
    { ...monsterFixture, currentHp: 0 },
    "revive",
    2_000,
    60_000,
  );
  assert.equal(revived.before.currentHp, 0);
  assert.equal(revived.after.currentHp, 70);
  assert.equal(revived.after.respawnAt, 0);

  fixture.reopen();
  const restored = fixture.store.initialize(monsterFixture, 3_000);
  assert.equal(restored.currentHp, 70);
  assert.equal(restored.respawnAt, 0);
});

test("keeps persistent HP keyed by spawn while AI position moves temporarily", async (t) => {
  const fixture = await temporaryStateStore(t);
  const movedMonster = {
    ...monsterFixture,
    spawnPosition: { ...monsterFixture.position },
    position: { x: 323, y: 123 },
  };
  fixture.store.initialize(movedMonster, 1_000);

  const damaged = fixture.store.applyDamage(movedMonster, 20, 2_000, 60_000);
  assert.equal(damaged.currentHp, 50);
  assert.deepEqual(damaged.position, movedMonster.position);

  fixture.reopen();
  const restored = fixture.store.initialize(monsterFixture, 3_000);
  assert.equal(restored.currentHp, 50);
  assert.deepEqual(restored.position, monsterFixture.position);

  const killed = fixture.store.applyDamage(movedMonster, 50, 4_000, 1000);
  assert.equal(killed.currentHp, 0);
  const respawned = fixture.store.respawn(movedMonster, 5_000);
  assert.equal(respawned.currentHp, 70);
  assert.deepEqual(respawned.position, monsterFixture.position);
});

test("rejects malformed persistent monster state", async (t) => {
  const fixture = await temporaryStateStore(t);
  assert.throws(
    () => fixture.store.initialize({ ...monsterFixture, currentHp: 71 }, 1_000),
    /currentHp fora do intervalo/,
  );
  assert.throws(
    () => fixture.store.applyDamage(monsterFixture, 1, -1, 60_000),
    /now fora do intervalo/,
  );
});
