import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PlayerAccountConflictError,
  PlayerAccountInputError,
  PlayerCharacterAccountError,
  PlayerCharacterInputError,
  PlayerCharacterLimitError,
  PlayerCharacterNameConflictError,
  PlayerCharacterPositionError,
  PlayerCharacterSlotConflictError,
  PlayerAccountStore,
} from "./player-account-store.mjs";
import { authenticateWyd727LoginPacket } from "./wyd-727-login-auth.mjs";
import { authenticateWyd727TokenPacket } from "./wyd-727-token-auth.mjs";

function syntheticLoginBody(accountId, password) {
  const body = Buffer.alloc(124 - 4);
  body.writeUInt16LE(0x20d, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  Buffer.from(password, "ascii").copy(body, 8);
  Buffer.from(accountId, "ascii").copy(body, 20);
  return body;
}

function syntheticTokenBody(token, isChanging = 0) {
  const body = Buffer.alloc(32 - 4);
  body.writeUInt16LE(0xfde, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  Buffer.from(token, "ascii").copy(body, 8);
  body.writeInt32LE(isChanging, 24);
  return body;
}

async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-player-accounts-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new PlayerAccountStore({ databasePath });
      return store;
    },
  };
}

function removeItemizationV13Schema(database) {
  database.exec(`
    DROP TABLE player_shop_purchase_receipts;
    DROP TABLE player_shop_audit_events;
    DROP TABLE player_shop_listings;
    DROP INDEX player_character_inventory_shop_listing_unique;
    ALTER TABLE player_character_inventory DROP COLUMN shop_listing_id;
    DROP TABLE player_character_stage_events;
    ALTER TABLE player_characters DROP COLUMN progression_stage;
    DROP TABLE player_guild_members;
    DROP TABLE player_guilds;
    DROP TABLE player_account_bank_items;
    DROP TABLE player_account_banks;
    DROP TABLE player_character_mounts;
    DROP TABLE itemization_audit_events;
    DROP TABLE player_character_itemization_kills;
    DROP TABLE player_character_item_affixes;
    DROP TABLE player_character_item_rolls;
    DROP INDEX player_character_inventory_instance_unique;
    ALTER TABLE player_character_inventory DROP COLUMN item_instance_id;
  `);
}

test("stores player credentials separately as scrypt hashes and authenticates the WYD 0x20D fields", async (t) => {
  const fixture = await temporaryStore(t);
  const created = await fixture.store.createAccount(
    "TestPlayer",
    "SYNTHPASS",
    "135790",
  );
  assert.deepEqual(Object.keys(created).sort(), [
    "accountId",
    "createdAt",
    "enabled",
    "tokenConfigured",
  ]);
  assert.equal(created.accountId, "testplayer");
  assert.equal(created.tokenConfigured, true);

  const packet = syntheticLoginBody("TESTPLAYER", "SYNTHPASS");
  const authenticated = await authenticateWyd727LoginPacket(
    fixture.store,
    packet,
  );
  assert.equal(authenticated.accountId, "testplayer");
  assert.equal(authenticated.enabled, true);
  assert.equal(packet.readUInt16LE(0), 0x20d);
  assert.deepEqual(
    packet.subarray(8, 20),
    Buffer.alloc(12),
    "password field is scrubbed after authentication",
  );

  const tokenPacket = syntheticTokenBody("135790");
  const tokenAuthenticated = await authenticateWyd727TokenPacket(
    fixture.store,
    "testplayer",
    tokenPacket,
  );
  assert.equal(tokenAuthenticated.accountId, "testplayer");
  assert.deepEqual(
    tokenPacket.subarray(8, 14),
    Buffer.alloc(6),
    "token bytes are scrubbed after authentication",
  );

  const inspection = new DatabaseSync(fixture.databasePath, { readOnly: true });
  try {
    const row = inspection
      .prepare(
        "SELECT password_salt, password_hash, token_salt, token_hash FROM player_accounts WHERE account_id = ?",
      )
      .get("testplayer");
    assert.equal(Buffer.from(row.password_salt).length, 16);
    assert.equal(Buffer.from(row.password_hash).length, 64);
    assert.equal(Buffer.from(row.token_salt).length, 16);
    assert.equal(Buffer.from(row.token_hash).length, 64);
    assert.equal(
      Buffer.from(row.password_hash).includes(Buffer.from("SYNTHPASS")),
      false,
    );
    assert.equal(
      Buffer.from(row.token_hash).includes(Buffer.from("135790")),
      false,
    );
  } finally {
    inspection.close();
  }
});

test("rechecks account suspension after asynchronous password and token hashing", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");

  const passwordAuthentication = fixture.store.authenticate(
    "testplayer",
    "SYNTHPASS",
  );
  fixture.store.setEnabled("testplayer", false);
  assert.equal(
    await passwordAuthentication,
    null,
    "suspensão durante scrypt não deve aceitar senha com linha antiga",
  );

  fixture.store.setEnabled("testplayer", true);
  const tokenAuthentication = fixture.store.authenticateToken(
    "testplayer",
    "135790",
  );
  fixture.store.setEnabled("testplayer", false);
  assert.equal(
    await tokenAuthentication,
    null,
    "suspensão durante scrypt não deve aceitar token com linha antiga",
  );
});

test("denies incorrect, unknown, disabled, empty, or malformed login attempts without returning account details", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  const wrongPassword = syntheticLoginBody("testplayer", "WRONGPASS");
  assert.equal(
    await authenticateWyd727LoginPacket(fixture.store, wrongPassword),
    null,
  );
  assert.deepEqual(wrongPassword.subarray(8, 20), Buffer.alloc(12));
  assert.equal(
    await authenticateWyd727LoginPacket(
      fixture.store,
      syntheticLoginBody("unknown", "SYNTHPASS"),
    ),
    null,
  );
  assert.equal(
    await authenticateWyd727LoginPacket(
      fixture.store,
      syntheticLoginBody("testplayer", ""),
    ),
    null,
  );

  fixture.store.setEnabled("testplayer", false);
  assert.equal(
    await authenticateWyd727LoginPacket(
      fixture.store,
      syntheticLoginBody("testplayer", "SYNTHPASS"),
    ),
    null,
  );

  const malformed = syntheticLoginBody("testplayer", "SYNTHPASS");
  malformed.writeUInt16LE(0x213, 0);
  assert.equal(
    await authenticateWyd727LoginPacket(fixture.store, malformed),
    null,
  );
  assert.deepEqual(malformed.subarray(8, 20), Buffer.alloc(12));
});

test("authenticates the 0xFDE numeric token and refuses wrong, malformed, or changing-token packets", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  assert.equal(
    (
      await authenticateWyd727TokenPacket(
        fixture.store,
        "testplayer",
        syntheticTokenBody("135790"),
      )
    ).accountId,
    "testplayer",
  );
  assert.equal(
    await authenticateWyd727TokenPacket(
      fixture.store,
      "testplayer",
      syntheticTokenBody("246810"),
    ),
    null,
  );
  assert.equal(
    await authenticateWyd727TokenPacket(
      fixture.store,
      "unknown",
      syntheticTokenBody("135790"),
    ),
    null,
  );
  assert.equal(
    await authenticateWyd727TokenPacket(
      fixture.store,
      "testplayer",
      syntheticTokenBody("135790", 1),
    ),
    null,
  );

  const malformed = syntheticTokenBody("13A790");
  assert.equal(
    await authenticateWyd727TokenPacket(fixture.store, "testplayer", malformed),
    null,
  );
  assert.deepEqual(malformed.subarray(8, 14), Buffer.alloc(6));
  assert.equal(
    await fixture.store.authenticateToken("testplayer", "123"),
    null,
  );
});

test("preserves player accounts and token verification across store reopen and normalizes duplicate IDs", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  await assert.rejects(
    fixture.store.createAccount("testplayer", "OTHERPASS", "246810"),
    PlayerAccountConflictError,
  );

  const reopened = fixture.reopen();
  const account = await reopened.authenticate("TESTPLAYER", "SYNTHPASS");
  assert.equal(account.accountId, "testplayer");
  assert.equal(
    (await reopened.authenticateToken("TESTPLAYER", "135790")).accountId,
    "testplayer",
  );
  assert.equal(reopened.setEnabled("testplayer", false).enabled, false);
  assert.equal(await reopened.authenticateToken("testplayer", "135790"), null);
});

test("persists characters by account and slot, enforces class/name bounds, and normalizes duplicate names", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  await fixture.store.createAccount("OtherPlayer", "OTHERPASS", "246810");

  const created = fixture.store.createCharacter("TESTPLAYER", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });
  assert.deepEqual(created, {
    slot: 2,
    name: "Magic_01",
    classId: 1,
    level: 1,
    gold: 0,
  });
  assert.deepEqual(fixture.store.listCharacters("testplayer"), [
    { ...created, progressionStage: "mortal" },
  ]);
  assert.deepEqual(fixture.store.getCharacterBySlot("testplayer", 2), {
    ...created,
    progressionStage: "mortal",
    experience: 0,
    currentHp: null,
    currentMp: null,
    worldX: null,
    worldY: null,
  });
  assert.equal(fixture.store.getCharacterBySlot("testplayer", 1), null);
  assert.equal(fixture.store.getCharacterBySlot("testplayer", 4), null);
  assert.deepEqual(fixture.store.listCharacters("otherplayer"), []);
  assert.deepEqual(fixture.store.getCharacterAttributes("testplayer", 2), {
    availablePoints: 5,
    allocated: { str: 0, int: 0, dex: 0, con: 0 },
  });
  assert.throws(
    () =>
      fixture.store.createCharacter("otherplayer", {
        slot: 0,
        classId: 0,
        name: "mAgIc_01",
      }),
    PlayerCharacterNameConflictError,
  );
  assert.throws(
    () =>
      fixture.store.createCharacter("testplayer", {
        slot: 2,
        classId: 0,
        name: "Different",
      }),
    PlayerCharacterSlotConflictError,
  );
  assert.throws(
    () =>
      fixture.store.createCharacter("testplayer", {
        slot: 1,
        classId: 4,
        name: "Different",
      }),
    PlayerCharacterInputError,
  );
  assert.throws(
    () =>
      fixture.store.createCharacter("testplayer", {
        slot: 1,
        classId: 0,
        name: "contains space",
      }),
    PlayerCharacterInputError,
  );

  const reopened = fixture.reopen();
  assert.deepEqual(reopened.listCharacters("testplayer"), [
    { ...created, progressionStage: "mortal" },
  ]);
  reopened.createCharacter("testplayer", {
    slot: 0,
    classId: 0,
    name: "NewChar",
  });
  reopened.createCharacter("testplayer", {
    slot: 1,
    classId: 2,
    name: "OtherChar",
  });
  reopened.createCharacter("testplayer", {
    slot: 3,
    classId: 3,
    name: "LastChar",
  });
  assert.throws(
    () =>
      reopened.createCharacter("testplayer", {
        slot: 0,
        classId: 0,
        name: "FifthChar",
      }),
    PlayerCharacterLimitError,
  );

  reopened.setEnabled("testplayer", false);
  assert.equal(
    reopened.getCharacterBySlot("testplayer", 2),
    null,
    "disabled player accounts cannot enter with stored characters",
  );
  assert.throws(
    () =>
      reopened.createCharacter("testplayer", {
        slot: 0,
        classId: 0,
        name: "Blocked",
      }),
    PlayerCharacterAccountError,
  );
});

test("allocates one attribute point atomically and persists the sheet", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 0,
    classId: 1,
    name: "Foema_01",
  });
  assert.deepEqual(
    fixture.store.allocateCharacterAttributePoint("testplayer", 0, "int", 5),
    {
      status: "applied",
      availablePoints: 4,
      allocated: { str: 0, int: 1, dex: 0, con: 0 },
    },
  );
  assert.deepEqual(
    fixture.store.allocateCharacterAttributePoint("testplayer", 0, "str", 0),
    {
      status: "capped",
      availablePoints: 4,
      allocated: { str: 0, int: 1, dex: 0, con: 0 },
    },
  );
  const reopened = fixture.reopen();
  assert.deepEqual(reopened.getCharacterAttributes("testplayer", 0), {
    availablePoints: 4,
    allocated: { str: 0, int: 1, dex: 0, con: 0 },
  });
  assert.equal(reopened.awardCharacterExperience("testplayer", 0, 10).level, 2);
  assert.deepEqual(reopened.getCharacterAttributes("testplayer", 0), {
    availablePoints: 9,
    allocated: { str: 0, int: 1, dex: 0, con: 0 },
  });
  assert.deepEqual(reopened.getCharacterSkillState("testplayer", 0), {
    availablePoints: 2,
    classId: 1,
    level: 2,
    learned: [],
  });
  reopened.setEnabled("testplayer", false);
  assert.equal(reopened.getCharacterAttributes("testplayer", 0), null);
  assert.equal(
    reopened.allocateCharacterAttributePoint("testplayer", 0, "int", 5),
    null,
  );
});

test("learns catalog skills with points, class, level, prerequisites, and persistence", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 0,
    classId: 1,
    name: "Foema_01",
  });
  const primary = {
    catalogSkillId: "caracatoa-corte",
    clientSkillId: 25,
    classId: 1,
    pointCost: 1,
    requiredLevel: 1,
    prerequisites: [],
  };
  const advanced = {
    catalogSkillId: "caracatoa-impacto-celeste",
    clientSkillId: 26,
    classId: 1,
    pointCost: 1,
    requiredLevel: 2,
    prerequisites: ["caracatoa-corte"],
  };
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, {
      ...advanced,
      requiredLevel: 1,
    }).status,
    "prerequisite-locked",
  );
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, {
      ...primary,
      classId: 0,
    }).status,
    "wrong-class",
  );
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, {
      ...primary,
      requiredLevel: 2,
    }).status,
    "level-locked",
  );
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, primary).status,
    "learned",
  );
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, primary).status,
    "already-learned",
  );
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, advanced).status,
    "level-locked",
  );
  assert.deepEqual(fixture.store.getCharacterSkillState("testplayer", 0), {
    availablePoints: 0,
    classId: 1,
    level: 1,
    learned: [
      { catalogSkillId: "caracatoa-corte", clientSkillId: 25 },
    ],
  });

  fixture.store.awardCharacterExperience("testplayer", 0, 10);
  assert.equal(
    fixture.store.learnCharacterSkill("testplayer", 0, advanced).status,
    "learned",
  );
  const reopened = fixture.reopen();
  assert.deepEqual(reopened.getCharacterSkillState("testplayer", 0), {
    availablePoints: 0,
    classId: 1,
    level: 2,
    learned: [
      { catalogSkillId: "caracatoa-corte", clientSkillId: 25 },
      { catalogSkillId: "caracatoa-impacto-celeste", clientSkillId: 26 },
    ],
  });
  reopened.setEnabled("testplayer", false);
  assert.equal(reopened.getCharacterSkillState("testplayer", 0), null);
  assert.equal(reopened.learnCharacterSkill("testplayer", 0, primary), null);
});

test("migrates v10 characters to the skill tree without granting legacy points", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-player-skill-migration-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  store.createCharacter("testplayer", {
    slot: 1,
    classId: 1,
    name: "LegacyFoema",
  });
  store.close();
  store = null;
  const legacy = new DatabaseSync(databasePath);
  removeItemizationV13Schema(legacy);
  legacy.exec(`
    DROP TABLE player_character_skills;
    DROP INDEX player_character_equipment_slot_unique;
    ALTER TABLE player_character_inventory DROP COLUMN equipment_slot;
    ALTER TABLE player_characters DROP COLUMN skill_points;
    PRAGMA user_version = 10;
  `);
  legacy.close();

  store = new PlayerAccountStore({ databasePath });
  assert.deepEqual(store.getCharacterSkillState("testplayer", 1), {
    availablePoints: 0,
    classId: 1,
    level: 1,
    learned: [],
  });
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, 17);
    assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    inspection.close();
  }
});

test("migrates v6 characters through experience and HP storage, applying damage transactionally", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "caracatoa-player-experience-migration-"),
  );
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(() => {
    store?.close();
    return rm(directory, { recursive: true, force: true });
  });
  await store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });

  store.close();
  store = null;
  const legacy = new DatabaseSync(databasePath);
  removeItemizationV13Schema(legacy);
  legacy.exec(`
    ALTER TABLE player_characters DROP COLUMN attribute_con;
    ALTER TABLE player_characters DROP COLUMN attribute_dex;
    ALTER TABLE player_characters DROP COLUMN attribute_int;
    ALTER TABLE player_characters DROP COLUMN attribute_str;
    DROP TABLE player_character_skills;
    DROP INDEX player_character_equipment_slot_unique;
    ALTER TABLE player_character_inventory DROP COLUMN equipment_slot;
    ALTER TABLE player_characters DROP COLUMN skill_points;
    ALTER TABLE player_characters DROP COLUMN attribute_points;
    ALTER TABLE player_characters DROP COLUMN current_hp;
    ALTER TABLE player_characters DROP COLUMN current_mp;
    ALTER TABLE player_characters DROP COLUMN experience;
    PRAGMA user_version = 6;
  `);
  legacy.close();

  store = new PlayerAccountStore({ databasePath });
  assert.equal(store.getCharacterBySlot("testplayer", 2).experience, 0);
  assert.equal(store.getCharacterBySlot("testplayer", 2).currentHp, null);
  assert.deepEqual(store.awardCharacterExperience("testplayer", 2, 40), {
    gained: 40,
    experience: 40,
    previousLevel: 1,
    level: 3,
    levelsGained: 2,
    skillPoints: 2,
  });
  assert.equal(store.getCharacterBySlot("testplayer", 2).experience, 40);
  assert.equal(store.getCharacterBySlot("testplayer", 2).level, 3);
  assert.deepEqual(store.getCharacterAttributes("testplayer", 2), {
    availablePoints: 10,
    allocated: { str: 0, int: 0, dex: 0, con: 0 },
  });
  assert.deepEqual(store.listCharacters("testplayer"), [
    { slot: 2, name: "Magic_01", classId: 1, level: 3, gold: 0, progressionStage: "mortal" },
  ]);
  assert.deepEqual(
    store.initializeCharacterHitPoints("testplayer", 2, 100, 180),
    { currentHp: 100 },
  );
  assert.deepEqual(store.applyCharacterDamage("testplayer", 2, 18), {
    damage: 18,
    currentHp: 82,
  });
  assert.deepEqual(store.applyCharacterDamage("testplayer", 2, 100), {
    damage: 82,
    currentHp: 0,
  });
  assert.equal(store.applyCharacterDamage("testplayer", 2, 1), null);
  store.close();
  store = new PlayerAccountStore({ databasePath });
  assert.equal(store.getCharacterBySlot("testplayer", 2).experience, 40);
  assert.equal(store.getCharacterBySlot("testplayer", 2).level, 3);
  assert.equal(store.listCharacters("testplayer")[0].level, 3);
  assert.equal(store.getCharacterBySlot("testplayer", 2).currentHp, 0);
  assert.deepEqual(
    store.initializeCharacterHitPoints("testplayer", 2, 100, 180),
    { currentHp: 180 },
  );

  store.setEnabled("testplayer", false);
  assert.equal(store.awardCharacterExperience("testplayer", 2, 10), null);
  assert.equal(
    store.initializeCharacterHitPoints("testplayer", 2, 90, 100),
    null,
  );
  assert.equal(store.applyCharacterDamage("testplayer", 2, 5), null);
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      inspection.prepare("PRAGMA user_version").get().user_version,
      17,
    );
  } finally {
    inspection.close();
  }
});

test("persists mana, spends it transactionally, and keeps zero MP across relogin", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });

  assert.deepEqual(
    fixture.store.initializeCharacterMana("testplayer", 2, 100, 140),
    { currentMp: 100 },
  );
  assert.deepEqual(fixture.store.spendCharacterMana("testplayer", 2, 7), {
    spent: 7,
    currentMp: 93,
  });
  assert.deepEqual(fixture.store.spendCharacterMana("testplayer", 2, 93), {
    spent: 93,
    currentMp: 0,
  });
  assert.equal(fixture.store.spendCharacterMana("testplayer", 2, 1), null);
  assert.equal(fixture.store.getCharacterBySlot("testplayer", 2).currentMp, 0);

  const reopened = fixture.reopen();
  assert.deepEqual(
    reopened.initializeCharacterMana("testplayer", 2, 100, 140),
    { currentMp: 0 },
    "zero mana is a stored state, not an uninitialized marker",
  );
  assert.deepEqual(reopened.refundCharacterMana("testplayer", 2, 7, 140), {
    currentMp: 7,
  });
  assert.deepEqual(
    reopened.initializeCharacterMana("testplayer", 2, 5, 5),
    { currentMp: 5 },
    "current mana clamps to a newly reduced class maximum",
  );
  assert.throws(
    () => reopened.spendCharacterMana("testplayer", 2, -1),
    PlayerCharacterInputError,
  );
});

test("persists clamped HP and MP together after an equipment limit changes", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });
  fixture.store.initializeCharacterHitPoints("testplayer", 2, 100, 100);
  fixture.store.initializeCharacterMana("testplayer", 2, 50, 100);

  assert.deepEqual(
    fixture.store.setCharacterResources("testplayer", 2, 90, 45),
    { currentHp: 90, currentMp: 45 },
  );
  const reopened = fixture.reopen();
  assert.equal(reopened.getCharacterBySlot("testplayer", 2).currentHp, 90);
  assert.equal(reopened.getCharacterBySlot("testplayer", 2).currentMp, 45);
  assert.throws(
    () => reopened.setCharacterResources("testplayer", 2, -1, 0),
    PlayerCharacterInputError,
  );
});

test("heals HP and spends mana atomically without charging rejected casts", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });
  fixture.store.initializeCharacterHitPoints("testplayer", 2, 100, 100);
  fixture.store.initializeCharacterMana("testplayer", 2, 50, 100);
  fixture.store.applyCharacterDamage("testplayer", 2, 65);

  assert.deepEqual(
    fixture.store.applyCharacterHealAndSpendMana("testplayer", 2, {
      healingAmount: 40,
      maxHp: 100,
      manaCost: 10,
    }),
    { status: "healed", healed: 40, spent: 10, currentHp: 75, currentMp: 40 },
  );
  assert.deepEqual(
    fixture.store.applyCharacterHealAndSpendMana("testplayer", 2, {
      healingAmount: 50,
      maxHp: 100,
      manaCost: 10,
    }),
    { status: "healed", healed: 25, spent: 10, currentHp: 100, currentMp: 30 },
    "healing clamps at max HP",
  );
  assert.deepEqual(
    fixture.store.applyCharacterHealAndSpendMana("testplayer", 2, {
      healingAmount: 40,
      maxHp: 100,
      manaCost: 10,
    }),
    { status: "full-health", currentHp: 100, currentMp: 30 },
  );
  fixture.store.applyCharacterDamage("testplayer", 2, 20);
  fixture.store.spendCharacterMana("testplayer", 2, 29);
  assert.deepEqual(
    fixture.store.applyCharacterHealAndSpendMana("testplayer", 2, {
      healingAmount: 40,
      maxHp: 100,
      manaCost: 10,
    }),
    { status: "insufficient-mana", currentHp: 80, currentMp: 1 },
    "insufficient mana does not partially heal or spend",
  );
  fixture.store.applyCharacterDamage("testplayer", 2, 100);
  assert.deepEqual(
    fixture.store.applyCharacterHealAndSpendMana("testplayer", 2, {
      healingAmount: 40,
      maxHp: 100,
      manaCost: 10,
    }),
    { status: "dead", currentHp: 0, currentMp: 1 },
  );
  assert.equal(fixture.store.getCharacterBySlot("testplayer", 2).currentHp, 0);
  assert.equal(fixture.store.getCharacterBySlot("testplayer", 2).currentMp, 1);
});

test("migrates an existing schema v8 player database through mana and attribute schemas", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-player-v8-mana-"));
  const databasePath = join(directory, "players.sqlite");
  let store = new PlayerAccountStore({ databasePath });
  t.after(() => {
    store?.close();
    return rm(directory, { recursive: true, force: true });
  });
  await store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });
  store.close();
  store = null;
  const legacy = new DatabaseSync(databasePath);
  removeItemizationV13Schema(legacy);
  legacy.exec(`
    ALTER TABLE player_characters DROP COLUMN attribute_con;
    ALTER TABLE player_characters DROP COLUMN attribute_dex;
    ALTER TABLE player_characters DROP COLUMN attribute_int;
    ALTER TABLE player_characters DROP COLUMN attribute_str;
    DROP TABLE player_character_skills;
    DROP INDEX player_character_equipment_slot_unique;
    ALTER TABLE player_character_inventory DROP COLUMN equipment_slot;
    ALTER TABLE player_characters DROP COLUMN skill_points;
    ALTER TABLE player_characters DROP COLUMN attribute_points;
    ALTER TABLE player_characters DROP COLUMN current_mp;
    PRAGMA user_version = 8;
  `);
  legacy.close();

  store = new PlayerAccountStore({ databasePath });
  assert.equal(store.getCharacterBySlot("testplayer", 2).currentMp, null);
  assert.deepEqual(store.initializeCharacterMana("testplayer", 2, 80, 100), {
    currentMp: 80,
  });
});

test("initializes, compares, and persists authoritative character world positions", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 2,
    classId: 1,
    name: "Magic_01",
  });

  const initial = fixture.store.initializeCharacterPosition("testplayer", 2, {
    x: 321,
    y: -123,
  });
  assert.deepEqual(
    { x: initial.worldX, y: initial.worldY },
    { x: 321, y: -123 },
  );
  const unchanged = fixture.store.initializeCharacterPosition("testplayer", 2, {
    x: 10,
    y: 20,
  });
  assert.deepEqual(
    { x: unchanged.worldX, y: unchanged.worldY },
    { x: 321, y: -123 },
  );

  const competitor = new PlayerAccountStore({
    databasePath: fixture.databasePath,
  });
  t.after(() => competitor.close());
  assert.equal(
    fixture.store.saveCharacterPosition(
      "testplayer",
      2,
      { x: 321, y: -123 },
      { x: 323, y: -122 },
    ),
    true,
  );
  assert.equal(
    competitor.saveCharacterPosition(
      "testplayer",
      2,
      { x: 321, y: -123 },
      { x: 322, y: -123 },
    ),
    false,
  );
  assert.deepEqual(
    {
      x: competitor.getCharacterBySlot("testplayer", 2).worldX,
      y: competitor.getCharacterBySlot("testplayer", 2).worldY,
    },
    { x: 323, y: -122 },
  );
  assert.throws(
    () =>
      fixture.store.saveCharacterPosition(
        "testplayer",
        2,
        { x: 323, y: -122 },
        { x: 32768, y: 0 },
      ),
    PlayerCharacterPositionError,
  );

  competitor.close();
  const reopened = fixture.reopen();
  assert.deepEqual(
    {
      x: reopened.getCharacterBySlot("testplayer", 2).worldX,
      y: reopened.getCharacterBySlot("testplayer", 2).worldY,
    },
    { x: 323, y: -122 },
  );
  reopened.setEnabled("testplayer", false);
  assert.equal(
    reopened.saveCharacterPosition(
      "testplayer",
      2,
      { x: 323, y: -122 },
      { x: 324, y: -122 },
    ),
    false,
  );
  assert.equal(
    reopened.initializeCharacterPosition("testplayer", 2, { x: 0, y: 0 }),
    null,
  );
});

test("grants starter inventory once per character and persists catalog item references", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 1,
    classId: 2,
    name: "Beast_01",
  });

  assert.deepEqual(
    fixture.store.initializeCharacterInventory("testplayer", 1, [
      "caracatoa-potion",
      "starter-weapon",
    ]),
    [
      { slot: 0, catalogItemId: "caracatoa-potion", stackCount: 0 },
      { slot: 1, catalogItemId: "starter-weapon", stackCount: 0 },
    ],
  );
  assert.deepEqual(
    fixture.store.initializeCharacterInventory("testplayer", 1, [
      "later-starter",
    ]),
    [
      { slot: 0, catalogItemId: "caracatoa-potion", stackCount: 0 },
      { slot: 1, catalogItemId: "starter-weapon", stackCount: 0 },
    ],
  );
  assert.equal(fixture.store.isCatalogItemInUse("caracatoa-potion"), true);
  assert.equal(fixture.store.isCatalogItemInUse("unowned-item"), false);
  assert.throws(
    () =>
      fixture.store.initializeCharacterInventory("testplayer", 1, ["Bad ID"]),
    PlayerCharacterInputError,
  );

  const reopened = fixture.reopen();
  assert.deepEqual(reopened.initializeCharacterInventory("testplayer", 1, []), [
    { slot: 0, catalogItemId: "caracatoa-potion", stackCount: 0 },
    { slot: 1, catalogItemId: "starter-weapon", stackCount: 0 },
  ]);
});

test("equips one persistent inventory item per slot and supports transactional swap and removal", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 0,
    classId: 0,
    name: "StarterTK",
  });
  fixture.store.initializeCharacterInventory("testplayer", 0, [
    "practice-sword",
    "iron-sword",
  ]);

  assert.deepEqual(
    fixture.store.setCharacterEquipment({
      accountId: "testplayer",
      characterSlot: 0,
      equipmentSlot: 0,
      inventorySlot: 0,
    }),
    { accepted: true, inventorySlot: 0 },
  );
  assert.deepEqual(fixture.store.listCharacterEquipment("testplayer", 0), [
    { equipmentSlot: 0, inventorySlot: 0, catalogItemId: "practice-sword", stackCount: 0 },
  ]);

  fixture.store.setCharacterEquipment({
    accountId: "testplayer",
    characterSlot: 0,
    equipmentSlot: 0,
    inventorySlot: 1,
  });
  assert.deepEqual(fixture.store.listCharacterEquipment("testplayer", 0), [
    { equipmentSlot: 0, inventorySlot: 1, catalogItemId: "iron-sword", stackCount: 0 },
  ]);
  const reopened = fixture.reopen();
  assert.deepEqual(reopened.listCharacterEquipment("testplayer", 0), [
    { equipmentSlot: 0, inventorySlot: 1, catalogItemId: "iron-sword", stackCount: 0 },
  ]);

  assert.deepEqual(
    reopened.setCharacterEquipment({
      accountId: "testplayer",
      characterSlot: 0,
      equipmentSlot: 0,
      inventorySlot: null,
    }),
    { accepted: true, inventorySlot: null },
  );
  assert.deepEqual(reopened.listCharacterEquipment("testplayer", 0), []);
  assert.throws(
    () => reopened.setCharacterEquipment({
      accountId: "testplayer",
      characterSlot: 0,
      equipmentSlot: 6,
      inventorySlot: 1,
    }),
    PlayerCharacterInputError,
  );
});

test("enforces fixed-width WYD account/password bounds and prints no supplied secret in errors", async (t) => {
  const fixture = await temporaryStore(t);
  await assert.rejects(
    fixture.store.createAccount(
      "player-name-is-too-long",
      "SYNTHPASS",
      "123456",
    ),
    PlayerAccountInputError,
  );
  await assert.rejects(
    fixture.store.createAccount("validplayer", "PASSWORD-TOO-LONG", "123456"),
    PlayerAccountInputError,
  );
  await assert.rejects(
    fixture.store.createAccount("validplayer", "non-ascii-ç", "123456"),
    (error) => {
      assert.ok(error instanceof PlayerAccountInputError);
      assert.equal(error.message.includes("non-ascii"), false);
      return true;
    },
  );

  await assert.rejects(
    fixture.store.createAccount("plaincheck", "SYNTHPASS", "12A456"),
    PlayerAccountInputError,
  );
  await fixture.store.createAccount("plaincheck", "SYNTHPASS", "123456");
  fixture.store.close();
  const databaseBytes = await readFile(fixture.databasePath);
  assert.equal(databaseBytes.includes(Buffer.from("SYNTHPASS")), false);
  assert.equal(databaseBytes.includes(Buffer.from("123456")), false);
});

test("migrates version 1 accounts without tokens and allows admin token setup afterward", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "caracatoa-player-migration-"),
  );
  const databasePath = join(directory, "players.sqlite");
  const legacy = new DatabaseSync(databasePath);
  const passwordSalt = Buffer.alloc(16, 0x11);
  const passwordHash = scryptSync(Buffer.from("LEGACYPASS"), passwordSalt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  legacy.exec(`
    CREATE TABLE player_accounts (
      account_id TEXT PRIMARY KEY NOT NULL,
      password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
      password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  legacy
    .prepare("INSERT INTO player_accounts VALUES (?, ?, ?, 1, ?)")
    .run("legacy", passwordSalt, passwordHash, new Date().toISOString());
  legacy.close();

  const store = new PlayerAccountStore({ databasePath });
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(store.getAccount("legacy").tokenConfigured, false);
  assert.equal(
    (await store.authenticate("legacy", "LEGACYPASS")).accountId,
    "legacy",
  );
  assert.equal(await store.authenticateToken("legacy", "135790"), null);
  const afterSetup = await store.setToken("legacy", "135790");
  assert.equal(afterSetup.tokenConfigured, true);
  assert.equal(
    (await store.authenticateToken("legacy", "135790")).accountId,
    "legacy",
  );
  assert.equal((await store.getAccount("legacy")).tokenConfigured, true);
});

test("migrates version 3 characters without losing rows and initializes their first world position", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "caracatoa-player-position-migration-"),
  );
  const databasePath = join(directory, "players.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE player_accounts (
      account_id TEXT PRIMARY KEY NOT NULL,
      password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
      password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
      token_salt BLOB CHECK (token_salt IS NULL OR length(token_salt) = 16),
      token_hash BLOB CHECK (token_hash IS NULL OR length(token_hash) = 64),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE player_characters (
      account_id TEXT NOT NULL REFERENCES player_accounts(account_id) ON DELETE CASCADE,
      slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
      normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 16),
      class_id INTEGER NOT NULL CHECK (class_id BETWEEN 0 AND 3),
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (account_id, slot)
    ) STRICT;
    CREATE INDEX player_characters_by_account ON player_characters(account_id, slot);
    PRAGMA user_version = 3;
  `);
  legacy
    .prepare(
      `
    INSERT INTO player_accounts
      (account_id, password_salt, password_hash, token_salt, token_hash, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
    )
    .run(
      "testplayer",
      Buffer.alloc(16, 1),
      Buffer.alloc(64, 2),
      Buffer.alloc(16, 3),
      Buffer.alloc(64, 4),
      "2026-10-25T00:00:00.000Z",
    );
  legacy
    .prepare(
      `
    INSERT INTO player_characters (account_id, slot, name, normalized_name, class_id, level, gold, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      "testplayer",
      2,
      "Magic_01",
      "magic_01",
      1,
      7,
      900,
      "2026-10-25T00:00:00.000Z",
    );
  legacy.close();

  const store = new PlayerAccountStore({ databasePath });
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  assert.deepEqual(store.listCharacters("testplayer"), [
    { slot: 2, name: "Magic_01", classId: 1, level: 7, gold: 900, progressionStage: "mortal" },
  ]);
  assert.deepEqual(
    {
      x: store.getCharacterBySlot("testplayer", 2).worldX,
      y: store.getCharacterBySlot("testplayer", 2).worldY,
    },
    { x: null, y: null },
  );
  const initialized = store.initializeCharacterPosition("testplayer", 2, {
    x: 50,
    y: -60,
  });
  assert.deepEqual(
    { x: initialized.worldX, y: initialized.worldY },
    { x: 50, y: -60 },
  );
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      inspection.prepare("PRAGMA user_version").get().user_version,
      17,
    );
  } finally {
    inspection.close();
  }
});

test("migrates a v4 world character to inventory v6 without changing its position", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "caracatoa-player-inventory-migration-"),
  );
  const databasePath = join(directory, "players.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE player_accounts (
      account_id TEXT PRIMARY KEY NOT NULL,
      password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
      password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
      token_salt BLOB CHECK (token_salt IS NULL OR length(token_salt) = 16),
      token_hash BLOB CHECK (token_hash IS NULL OR length(token_hash) = 64),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE player_characters (
      account_id TEXT NOT NULL REFERENCES player_accounts(account_id) ON DELETE CASCADE,
      slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
      normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 16),
      class_id INTEGER NOT NULL CHECK (class_id BETWEEN 0 AND 3),
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
      created_at TEXT NOT NULL,
      world_x INTEGER CHECK (world_x IS NULL OR world_x BETWEEN -32768 AND 32767),
      world_y INTEGER CHECK (world_y IS NULL OR world_y BETWEEN -32768 AND 32767),
      PRIMARY KEY (account_id, slot)
    ) STRICT;
    CREATE INDEX player_characters_by_account ON player_characters(account_id, slot);
    PRAGMA user_version = 4;
  `);
  legacy
    .prepare(
      `INSERT INTO player_accounts
       (account_id, password_salt, password_hash, token_salt, token_hash, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      "testplayer",
      Buffer.alloc(16, 1),
      Buffer.alloc(64, 2),
      Buffer.alloc(16, 3),
      Buffer.alloc(64, 4),
      "2026-10-25T00:00:00.000Z",
    );
  legacy
    .prepare(
      `INSERT INTO player_characters
       (account_id, slot, name, normalized_name, class_id, level, gold, created_at, world_x, world_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "testplayer",
      2,
      "Magic_01",
      "magic_01",
      1,
      7,
      900,
      "2026-10-25T00:00:00.000Z",
      321,
      -123,
    );
  legacy.close();

  const store = new PlayerAccountStore({ databasePath });
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  const character = store.getCharacterBySlot("testplayer", 2);
  assert.deepEqual(
    { x: character.worldX, y: character.worldY },
    { x: 321, y: -123 },
  );
  assert.deepEqual(
    store.initializeCharacterInventory("testplayer", 2, ["legacy-starter"]),
    [{ slot: 0, catalogItemId: "legacy-starter", stackCount: 0 }],
  );
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      inspection.prepare("PRAGMA user_version").get().user_version,
      17,
    );
  } finally {
    inspection.close();
  }
});

test("migrates v5 inventory rows with inherited catalog quantities and persists the first use", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "caracatoa-player-stack-migration-"),
  );
  const databasePath = join(directory, "players.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE player_accounts (
      account_id TEXT PRIMARY KEY NOT NULL,
      password_salt BLOB NOT NULL CHECK (length(password_salt) = 16),
      password_hash BLOB NOT NULL CHECK (length(password_hash) = 64),
      token_salt BLOB CHECK (token_salt IS NULL OR length(token_salt) = 16),
      token_hash BLOB CHECK (token_hash IS NULL OR length(token_hash) = 64),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE player_characters (
      account_id TEXT NOT NULL REFERENCES player_accounts(account_id) ON DELETE CASCADE,
      slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3),
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 16),
      normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 1 AND 16),
      class_id INTEGER NOT NULL CHECK (class_id BETWEEN 0 AND 3),
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
      created_at TEXT NOT NULL,
      world_x INTEGER CHECK (world_x IS NULL OR world_x BETWEEN -32768 AND 32767),
      world_y INTEGER CHECK (world_y IS NULL OR world_y BETWEEN -32768 AND 32767),
      inventory_seeded INTEGER NOT NULL DEFAULT 0 CHECK (inventory_seeded IN (0, 1)),
      PRIMARY KEY (account_id, slot)
    ) STRICT;
    CREATE INDEX player_characters_by_account ON player_characters(account_id, slot);
    CREATE TABLE player_character_inventory (
      account_id TEXT NOT NULL,
      character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
      inventory_slot INTEGER NOT NULL CHECK (inventory_slot BETWEEN 0 AND 59),
      catalog_item_id TEXT NOT NULL CHECK (length(catalog_item_id) BETWEEN 1 AND 64),
      PRIMARY KEY (account_id, character_slot, inventory_slot),
      FOREIGN KEY (account_id, character_slot)
        REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX player_character_inventory_by_catalog_item
      ON player_character_inventory(catalog_item_id);
    PRAGMA user_version = 5;
  `);
  legacy
    .prepare(
      `INSERT INTO player_accounts
       (account_id, password_salt, password_hash, token_salt, token_hash, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      "testplayer",
      Buffer.alloc(16, 1),
      Buffer.alloc(64, 2),
      Buffer.alloc(16, 3),
      Buffer.alloc(64, 4),
      "2026-10-25T00:00:00.000Z",
    );
  legacy
    .prepare(
      `INSERT INTO player_characters
       (account_id, slot, name, normalized_name, class_id, created_at, world_x, world_y, inventory_seeded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      "testplayer",
      2,
      "Magic_01",
      "magic_01",
      1,
      "2026-10-25T00:00:00.000Z",
      321,
      -123,
    );
  legacy
    .prepare(
      `INSERT INTO player_character_inventory
       (account_id, character_slot, inventory_slot, catalog_item_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run("testplayer", 2, 4, "legacy-tonic");
  legacy.close();

  const store = new PlayerAccountStore({ databasePath });
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  assert.deepEqual(store.initializeCharacterInventory("testplayer", 2, []), [
    { slot: 4, catalogItemId: "legacy-tonic", stackCount: 0 },
  ]);
  assert.deepEqual(
    store.consumeCharacterInventoryItem({
      accountId: "testplayer",
      characterSlot: 2,
      inventorySlot: 4,
      catalogItemId: "legacy-tonic",
      expectedStackCount: 5,
    }),
    { consumed: true, stackCount: 4 },
  );
  assert.deepEqual(store.initializeCharacterInventory("testplayer", 2, []), [
    { slot: 4, catalogItemId: "legacy-tonic", stackCount: 4 },
  ]);
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      inspection.prepare("PRAGMA user_version").get().user_version,
      17,
    );
  } finally {
    inspection.close();
  }
});

test("awards loot into existing and new stacks atomically and persists it", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 1,
    classId: 1,
    name: "Loot_01",
  });
  fixture.store.initializeCharacterInventory("testplayer", 1, ["demo-tonico"]);

  assert.deepEqual(
    fixture.store.awardCharacterInventoryItem({
      accountId: "testplayer",
      characterSlot: 1,
      catalogItemId: "demo-tonico",
      quantity: 2,
      baseStackCount: 3,
    }),
    {
      granted: true,
      slots: [{ slot: 0, catalogItemId: "demo-tonico", stackCount: 5 }],
    },
  );
  assert.deepEqual(
    fixture.store.awardCharacterInventoryItem({
      accountId: "testplayer",
      characterSlot: 1,
      catalogItemId: "demo-tonico",
      quantity: 500,
      baseStackCount: 3,
    }),
    {
      granted: true,
      slots: [
        { slot: 0, catalogItemId: "demo-tonico", stackCount: 500 },
        { slot: 1, catalogItemId: "demo-tonico", stackCount: 5 },
      ],
    },
  );

  const reopened = fixture.reopen();
  assert.deepEqual(reopened.initializeCharacterInventory("testplayer", 1, []), [
    { slot: 0, catalogItemId: "demo-tonico", stackCount: 500 },
    { slot: 1, catalogItemId: "demo-tonico", stackCount: 5 },
  ]);
});

test("does not partially grant loot when every inventory slot is occupied", async (t) => {
  const fixture = await temporaryStore(t);
  await fixture.store.createAccount("TestPlayer", "SYNTHPASS", "135790");
  fixture.store.createCharacter("testplayer", {
    slot: 0,
    classId: 1,
    name: "Full_01",
  });
  const fullInventory = Array.from(
    { length: 60 },
    (_, index) => `starter-${index.toString().padStart(2, "0")}`,
  );
  fixture.store.initializeCharacterInventory("testplayer", 0, fullInventory);

  assert.deepEqual(
    fixture.store.awardCharacterInventoryItem({
      accountId: "testplayer",
      characterSlot: 0,
      catalogItemId: "new-drop",
      quantity: 1,
      baseStackCount: 1,
    }),
    { granted: false, reason: "inventory-full", slots: [] },
  );
  assert.equal(
    fixture.store.initializeCharacterInventory("testplayer", 0, fullInventory)
      .length,
    60,
  );
});
