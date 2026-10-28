import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";
import {
  CaracatoaMountError,
  calculateCaracatoaMountBonuses,
  getCaracatoaMountCatalog,
  validateCaracatoaMountCatalog,
} from "./caracatoa-mount-store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-mounts-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.createAccount("rider", "SYNTHPASS", "123456");
  store.createCharacter("rider", { slot: 0, classId: 0, name: "Rider" });
  return {
    databasePath,
    get store() { return store; },
    reopen() {
      store.close();
      store = new PlayerAccountStore({ databasePath });
      return store;
    },
  };
}

function addItem(databasePath, slot, itemId, count) {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(`
      INSERT INTO player_character_inventory
        (account_id, character_slot, inventory_slot, catalog_item_id, stack_count)
      VALUES ('rider', 0, ?, ?, ?)
    `).run(slot, itemId, count);
  } finally {
    database.close();
  }
}

test("mount catalog has bounded, unique species and server bonuses", () => {
  const catalog = getCaracatoaMountCatalog();
  assert.equal(validateCaracatoaMountCatalog(catalog).entries.length, 8);
  assert.equal(catalog.entries.find((entry) => entry.id === "fentris").incubationCritical, 9);
  assert.deepEqual(calculateCaracatoaMountBonuses({
    speciesId: "equus", stage: "juvenile", level: 1, vitality: 100,
  }), {
    hp: 20, physicalAttack: 0, magicAttack: 0, defense: 2,
    moveSpeedBps: 250, absorptionBps: 0,
  });
  catalog.entries[0].id = catalog.entries[1].id;
  assert.throws(() => validateCaracatoaMountCatalog(catalog));
});

test("egg incubation consumes the correct dust atomically and persists through reopen", async (t) => {
  const fixtureState = await fixture(t);
  const { databasePath } = fixtureState;
  addItem(databasePath, 2, "caracatoa-poeira-de-oriharucon", 4);
  addItem(databasePath, 3, "caracatoa-fragmento-de-lactolerium", 2);
  const egg = fixtureState.store.grantCharacterMountEgg("rider", {
    characterSlot: 0, speciesId: "equus", sourceEventId: "quest:equus:001", nowMs: 0,
  });
  assert.equal(egg.stage, "egg");
  assert.equal(egg.incubationRemaining, 3);
  assert.equal(fixtureState.store.grantCharacterMountEgg("rider", {
    characterSlot: 0, speciesId: "equus", sourceEventId: "quest:equus:001", nowMs: 1,
  }).id, egg.id);
  assert.equal(fixtureState.store.listCharacterMounts("rider", 0).length, 1);

  const first = fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs: 0,
  });
  assert.equal(first.status, "incubating");
  assert.equal(first.mount.incubationRemaining, 2);
  assert.equal(fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs: 59999,
  }).status, "waiting");
  assert.equal(fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 3, nowMs: 60000,
  }).status, "missing-dust");
  fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs: 60000,
  });
  const hatched = fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs: 120000,
  });
  assert.equal(hatched.status, "hatched");
  assert.equal(hatched.mount.hunger, 180);
  assert.equal(hatched.mount.vitality, 100);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 17);
    assert.equal(db.prepare(`
      SELECT stack_count FROM player_character_inventory
      WHERE account_id = 'rider' AND inventory_slot = 2
    `).get().stack_count, 1);
  } finally { db.close(); }
  fixtureState.reopen();
  assert.equal(fixtureState.store.listCharacterMounts("rider", 0)[0].stage, "juvenile");

  const advanced = fixtureState.store.grantCharacterMountEgg("rider", {
    characterSlot: 0, speciesId: "fentris", sourceEventId: "quest:fentris:001", nowMs: 130000,
  });
  assert.equal(fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: advanced.id, inventorySlot: 2, nowMs: 130000,
  }).requiredItemId, "caracatoa-fragmento-de-lactolerium");
  assert.equal(fixtureState.store.incubateCharacterMountEgg("rider", {
    characterSlot: 0, mountId: advanced.id, inventorySlot: 3, nowMs: 130000,
  }).mount.incubationRemaining, 8);
});

test("feeding, growth, mounting, partial time, and permanent death stay server authoritative", async (t) => {
  const fixtureState = await fixture(t);
  const { databasePath } = fixtureState;
  addItem(databasePath, 2, "caracatoa-poeira-de-oriharucon", 4);
  addItem(databasePath, 3, "caracatoa-racao-de-campo", 2);
  const egg = fixtureState.store.grantCharacterMountEgg("rider", {
    characterSlot: 0, speciesId: "equus", sourceEventId: "loot:equus:001", nowMs: 0,
  });
  for (const nowMs of [0, 60000, 120000]) {
    fixtureState.store.incubateCharacterMountEgg("rider", {
      characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs,
    });
  }
  const grown = fixtureState.store.awardCharacterMountExperience("rider", {
    characterSlot: 0, mountId: egg.id, amount: 28500,
  });
  assert.equal(grown.level, 10);
  assert.equal(fixtureState.store.evolveCharacterMount("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 2, nowMs: 120001,
  }).mount.stage, "adult");
  assert.equal(fixtureState.store.selectCharacterMount("rider", {
    characterSlot: 0, mountId: egg.id,
  }).active, true);
  const start = fixtureState.store.startCharacterMountRide("rider", {
    characterSlot: 0, mountId: egg.id, nowMs: 200000,
  });
  assert.equal(start.bonuses.hp, 23);
  assert.throws(() => fixtureState.store.selectCharacterMount("rider", {
    characterSlot: 0, mountId: null,
  }), (error) => error instanceof CaracatoaMountError && error.code === "RIDE_ACTIVE");
  const stop = fixtureState.store.stopCharacterMountRide("rider", {
    characterSlot: 0, mountId: egg.id, nowMs: 259000,
  });
  assert.equal(stop.hunger, 180);
  fixtureState.store.startCharacterMountRide("rider", {
    characterSlot: 0, mountId: egg.id, nowMs: 260000,
  });
  const oneMinute = fixtureState.store.tickCharacterMountRide("rider", {
    characterSlot: 0, mountId: egg.id, nowMs: 261000,
  });
  assert.equal(oneMinute.hunger, 179);
  const fed = fixtureState.store.feedCharacterMount("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 3, nowMs: 261000,
  });
  assert.equal(fed.status, "fed");
  assert.equal(fed.mount.hunger, 180);
  const dead = fixtureState.store.tickCharacterMountRide("rider", {
    characterSlot: 0, mountId: egg.id, nowMs: 261000 + 280 * 60000,
  });
  assert.equal(dead.stage, "dead");
  assert.equal(dead.vitality, 0);
  assert.equal(dead.active, false);
  assert.equal(dead.riding, false);
  assert.throws(() => fixtureState.store.feedCharacterMount("rider", {
    characterSlot: 0, mountId: egg.id, inventorySlot: 3, nowMs: 261000 + 280 * 60000,
  }), (error) => error instanceof CaracatoaMountError && error.code === "NOT_FEEDABLE");
  fixtureState.reopen();
  assert.equal(fixtureState.store.listCharacterMounts("rider", 0)[0].stage, "dead");
});
