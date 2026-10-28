import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { calculateBaseItemStats } from "./item-affix-system.mjs";
import { createLocalGameListener } from "./game-listener.mjs";
import { clientHandshake, decodeFrame, encodeFrame } from "./protocol.mjs";
import { getWyd727StarterInventoryItems, resolveWyd727InventoryItems } from "./wyd-727-item-catalog.mjs";
import { DEFAULT_WYD727_CLASS_CATALOG, getWyd727ClassEntry } from "./wyd-727-class-catalog.mjs";
import { computeWyd727ClineVersion } from "./wyd-727-character-entry.mjs";
import { createCaracatoaNativeWalkability } from "./caracatoa-native-navigation.mjs";
import { getCaracatoaMap, pointInWorldRect } from "./caracatoa-world-catalog.mjs";
import {
  computeCaracatoaDamageAfterAbsorption,
} from "./caracatoa-combat.mjs";
import { computeCaracatoaMonsterCounterattackDamage } from "./wyd-727-monster-combat.mjs";
import { awardCaracatoaItemizedMonsterLoot } from "./caracatoa-itemized-monster-loot.mjs";
import {
  applyCaracatoaEquipmentRequest,
  resolveCaracatoaCharacterEquipment,
} from "./wyd-727-item-equipment.mjs";
import {
  buildCaracatoaMountRequestBody,
  parseCaracatoaMountStateBody,
  CARACATOA_MOUNT_ACTION,
} from "./caracatoa-mount-protocol.mjs";
import {
  buildCaracatoaRefinementRequestBody,
  buildCaracatoaStageRequestBody,
  parseCaracatoaRefinementResult,
  parseCaracatoaStageState,
} from "./caracatoa-advancement-protocol.mjs";

async function listen(listener) {
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  return listener.address().port;
}

function frameReader(socket) {
  let pending = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt16LE(0);
      if (length < 12 || pending.length < length) break;
      const decoded = decodeFrame(pending.subarray(0, length));
      assert.equal(decoded.ok, true, decoded.error);
      frames.push(decoded.frame);
      pending = pending.subarray(length);
    }
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const frameIndex = frames.findIndex((entry) => entry.body.readUInt16LE(0) === waiter.opcode);
      if (frameIndex < 0) continue;
      clearTimeout(waiter.timer);
      const [frame] = frames.splice(frameIndex, 1);
      waiters.splice(index, 1);
      waiter.resolve(frame);
    }
  });
  return {
    next(opcode, timeoutMs = 4000, label = null) {
      const index = frames.findIndex((entry) => entry.body.readUInt16LE(0) === opcode);
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { opcode, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`timeout waiting for ${label ?? `opcode 0x${opcode.toString(16)}`}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

function sendBody(socket, body, sequence) {
  socket.write(encodeFrame(body, sequence));
}

function loginBody(opcode, byteLength) {
  const body = Buffer.alloc(byteLength - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  return body;
}

function movementBody({ clientId, from, destiny, codes }) {
  const body = Buffer.alloc(48);
  body.writeUInt16LE(0x36c, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeInt16LE(from.x, 8);
  body.writeInt16LE(from.y, 10);
  body.writeUInt32LE(0, 12);
  body.writeUInt32LE(3, 16);
  codes.forEach((code, index) => body.writeUInt8(code, 20 + index));
  body.writeInt16LE(destiny.x, 44);
  body.writeInt16LE(destiny.y, 46);
  return body;
}

function monsterBody({ entityId, position, damage, level = 1, maxHp = 10_000, currentHp = maxHp }) {
  const body = Buffer.alloc(252);
  body.writeUInt16LE(0x364, 0);
  body.writeInt16LE(position.x, 8);
  body.writeInt16LE(position.y, 10);
  body.writeUInt16LE(entityId, 12);
  body.writeInt32LE(level, 136);
  body.writeInt32LE(0, 140);
  body.writeInt32LE(damage, 144);
  body.writeUInt8(1, 149);
  body.writeInt32LE(maxHp, 152);
  body.writeInt32LE(currentHp, 160);
  return body;
}

function basicAttackBody({ clientId, source, target, targetEntityId }) {
  const body = Buffer.alloc(68);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeUInt16LE(source.x, 30);
  body.writeUInt16LE(source.y, 32);
  body.writeUInt16LE(target.x, 34);
  body.writeUInt16LE(target.y, 36);
  body.writeUInt16LE(clientId, 38);
  body.writeUInt8(4, 42);
  body.writeInt16LE(-1, 52);
  body.writeUInt16LE(targetEntityId, 56);
  body.writeInt32LE(-2, 60);
  return body;
}

function skillAttackBody({ clientId, source, target, targetEntityId, skillId }) {
  const body = Buffer.alloc(68);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeUInt16LE(source.x, 30);
  body.writeUInt16LE(source.y, 32);
  body.writeUInt16LE(target.x, 34);
  body.writeUInt16LE(target.y, 36);
  body.writeUInt16LE(clientId, 38);
  body.writeUInt8(0xff, 42);
  body.writeInt32LE(-1, 48);
  body.writeUInt16LE(skillId, 52);
  body.writeUInt16LE(targetEntityId, 56);
  body.writeInt32LE(-1, 60);
  return body;
}

test("local gear applies PvE absorption, experience, and drop bonuses", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-mount-gameplay-"));
  const store = new PlayerAccountStore({ databasePath: join(directory, "players.sqlite") });
  const itemCatalog = JSON.parse(await readFile(new URL("./data/catalogs/items.json", import.meta.url), "utf8"));
  const itemizationConfig = JSON.parse(await readFile(new URL("./data/catalogs/itemization.json", import.meta.url), "utf8"));
  const skillCatalog = JSON.parse(await readFile(new URL("./data/catalogs/skills.json", import.meta.url), "utf8"));
  const monsterCatalog = JSON.parse(await readFile(new URL("./data/catalogs/monsters.json", import.meta.url), "utf8"));
  const navigationCatalog = JSON.parse(await readFile(new URL("./data/world/navigation.json", import.meta.url), "utf8"));
  const worldCatalog = JSON.parse(await readFile(new URL("./data/world/maps.json", import.meta.url), "utf8"));
  const combatEvents = [];
  const dealtDamageEvents = [];
  const experienceEvents = [];
  const manaSpendEvents = [];
  const cooldownRejectionEvents = [];
  const cooldownRejectionWaiters = [];
  const lootAwards = [];
  let worldClockMs = 1_000;
  const utilityLootConfig = structuredClone(itemizationConfig);
  utilityLootConfig.itemPools.starter = ["caracatoa-ferro-votivo"];
  utilityLootConfig.lootTables["field-common"].entries = [
    { kind: "equipment", baseChanceBps: 100 },
  ];
  const initialMap = getCaracatoaMap(worldCatalog, 1);
  const worldStartPosition = { x: initialMap.entry[0], y: initialMap.entry[1] };
  const walkability = createCaracatoaNativeWalkability(
    navigationCatalog,
    initialMap.mapId,
    initialMap.bounds,
  );
  const events = [];
  function waitForCooldownRejection() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for skill cooldown rejection")), 4_000);
      cooldownRejectionWaiters.push((event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }
  const listener = createLocalGameListener({
    accountStore: store,
    characterStore: store,
    idleTimeoutMs: 0,
    worldStartPosition,
    walkability,
    isPlayablePosition: (x, y) => pointInWorldRect([x, y], initialMap.bounds),
    async getClassDefinition(classId) { return getWyd727ClassEntry(DEFAULT_WYD727_CLASS_CATALOG, classId); },
    async getCharacterSkills(classId) {
      return skillCatalog.entries.filter(
        (entry) => Math.floor(entry.properties.clientSkillId / 24) === classId,
      );
    },
    async getWorldMonsterBodies() {
      return [
        monsterBody({ entityId: 64_000, position: { x: 128, y: 127 }, damage: 80 }),
        monsterBody({
          entityId: 64_002,
          position: { x: 130, y: 153 },
          damage: 0,
          maxHp: 1_000,
          currentHp: 1_000,
        }),
        monsterBody({
          entityId: 64_001,
          position: { x: 130, y: 154 },
          damage: 0,
          level: 9,
          maxHp: 1,
          currentHp: 1,
        }),
      ];
    },
    async awardMonsterLoot({ accountId, characterSlot, monsterEntityId, lootEventId, playerLuckBonusBps }) {
      const lootMonsterCatalog = structuredClone(monsterCatalog);
      lootMonsterCatalog.entries[0].properties.clientEntityId = monsterEntityId;
      lootMonsterCatalog.entries[0].properties.level = 9;
      const award = awardCaracatoaItemizedMonsterLoot({
        accountStore: store,
        accountId,
        characterSlot,
        monsterEntityId,
        lootEventId,
        monsterCatalog: lootMonsterCatalog,
        itemCatalog,
        itemizationConfig: utilityLootConfig,
        playerLuckBonusBps,
        randomInt: (min, max) => min === 1 && max === 10_000 ? 101 : min,
      });
      lootAwards.push({ playerLuckBonusBps, award });
      return award;
    },
    async getCharacterEquipment(accountId, characterSlot, classId) {
      return resolveCaracatoaCharacterEquipment({
        accountStore: store,
        accountId,
        characterSlot,
        classId,
        catalog: itemCatalog,
        itemizationConfig,
      }).equipment;
    },
    async getCharacterInventory(accountId, slot) {
      const initialized = store.initializeCharacterInventory(accountId, slot, getWyd727StarterInventoryItems(itemCatalog));
      assert.ok(initialized);
      return resolveWyd727InventoryItems(initialized, itemCatalog);
    },
    async refineCharacterItem(details) {
      return store.refineCharacterItem({ ...details, itemCatalog, itemizationConfig, nowMs: 1_001 });
    },
    monsterAiIntervalMs: 60_000,
    monsterAttackIntervalMs: 60_000,
    now: () => worldClockMs,
    onEvent(event) {
      events.push(event.type === "session-error" ? `${event.type}:${event.code}` : event.type);
      if (event.type === "world-player-damaged" && event.source === "player-retaliation") {
        combatEvents.push(event);
      }
      if (event.type === "world-monster-damaged") dealtDamageEvents.push(event);
      if (event.type === "world-monster-experience-awarded") experienceEvents.push(event);
      if (event.type === "world-skill-mana-spent") manaSpendEvents.push(event);
      if (event.type === "world-skill-rejected" && event.reason === "skill-cooldown") {
        cooldownRejectionEvents.push(event);
        cooldownRejectionWaiters.shift()?.(event);
      }
    },
  });
  let socket = null;
  t.after(async () => {
    if (socket && !socket.destroyed) {
      socket.destroy();
      await Promise.race([once(socket, "close"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (listener.listening) await new Promise((resolve) => listener.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  await store.createAccount("mounttester", "SYNTHPASS", "135790");
  store.createCharacter("mounttester", { slot: 0, classId: 1, name: "FoemaTeste" });
  for (let point = 0; point < 5; point += 1) {
    assert.equal(
      store.allocateCharacterAttributePoint("mounttester", 0, "int", 100).status,
      "applied",
    );
  }
  assert.equal(store.learnCharacterSkill("mounttester", 0, {
    catalogSkillId: "caracatoa-corte",
    clientSkillId: 25,
    classId: 1,
    pointCost: 1,
    requiredLevel: 1,
    prerequisites: [],
  }).status, "learned");
  const initialInventory = store.initializeCharacterInventory(
    "mounttester",
    0,
    getWyd727StarterInventoryItems(itemCatalog),
  );
  assert.ok(initialInventory);
  const armorDrop = {
    kind: "equipment",
    catalogItemId: "caracatoa-peitoral-de-cobre",
    clientItemId: 8006,
    instanceId: randomUUID(),
    rarity: "mystic",
    itemLevel: 1,
    baseStats: calculateBaseItemStats(itemizationConfig, "chest", 1, "normal"),
    affixes: [
      {
        id: "absorbing",
        clientAffixId: 12,
        stat: "damageAbsorptionBps",
        value: 100,
        valueUnit: "basis-points",
      },
      {
        id: "efficient",
        clientAffixId: 7,
        stat: "mpCostReductionBps",
        value: 500,
        valueUnit: "basis-points",
      },
    ],
  };
  const awardedArmor = store.awardCharacterItemizationLoot({
    accountId: "mounttester",
    characterSlot: 0,
    lootEventId: "m64000:d-fixture-absorption-001",
    drops: [armorDrop],
    now: 1_000,
  });
  assert.equal(awardedArmor.granted, true);
  const armor = awardedArmor.slots.find(({ itemization }) => itemization);
  assert.ok(armor);
  const equippedArmor = applyCaracatoaEquipmentRequest({
    accountStore: store,
    accountId: "mounttester",
    characterSlot: 0,
    classId: 1,
    equipmentSlot: 2,
    inventorySlot: armor.slot,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(equippedArmor.accepted, true, JSON.stringify(equippedArmor));
  assert.equal(equippedArmor.bonuses.absorptionBps, 100);
  const utilityDrop = {
    kind: "equipment",
    catalogItemId: "caracatoa-amuletos-da-fenda",
    clientItemId: 8011,
    instanceId: randomUUID(),
    rarity: "legendary",
    itemLevel: 1,
    baseStats: calculateBaseItemStats(itemizationConfig, "necklace", 1, "legendary"),
    affixes: [
      {
        id: "fortune",
        clientAffixId: 14,
        stat: "dropRateBps",
        value: 150,
        valueUnit: "basis-points",
      },
      {
        id: "scholar",
        clientAffixId: 15,
        stat: "experienceBonusBps",
        value: 150,
        valueUnit: "basis-points",
      },
      {
        id: "efficient",
        clientAffixId: 7,
        stat: "mpCostReductionBps",
        value: 500,
        valueUnit: "basis-points",
      },
      {
        id: "swiftcasting",
        clientAffixId: 6,
        stat: "cooldownReductionBps",
        value: 400,
        valueUnit: "basis-points",
      },
    ],
  };
  const awardedUtilityItem = store.awardCharacterItemizationLoot({
    accountId: "mounttester",
    characterSlot: 0,
    lootEventId: "m64000:d-fixture-utility-001",
    drops: [utilityDrop],
    now: 1_001,
  });
  assert.equal(awardedUtilityItem.granted, true);
  const utilityItem = awardedUtilityItem.slots.find(({ itemization }) => itemization);
  assert.ok(utilityItem);
  const equippedUtility = applyCaracatoaEquipmentRequest({
    accountStore: store,
    accountId: "mounttester",
    characterSlot: 0,
    classId: 1,
    equipmentSlot: 5,
    inventorySlot: utilityItem.slot,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(equippedUtility.accepted, true, JSON.stringify(equippedUtility));
  assert.equal(equippedUtility.bonuses.dropRateBps, 150);
  assert.equal(equippedUtility.bonuses.experienceBonusBps, 150);
  assert.equal(equippedUtility.bonuses.mpCostReductionBps, 1_000);
  assert.equal(equippedUtility.bonuses.cooldownReductionBps, 400);
  const staffDrop = {
    kind: "equipment",
    catalogItemId: "caracatoa-cajado-do-eco",
    clientItemId: 8004,
    instanceId: randomUUID(),
    rarity: "arcane",
    itemLevel: 1,
    baseStats: calculateBaseItemStats(itemizationConfig, "staff", 1, "arcane"),
    affixes: [
      {
        id: "spellwoven",
        clientAffixId: 5,
        stat: "magicAttackBps",
        value: 800,
        valueUnit: "basis-points",
      },
      {
        id: "efficient",
        clientAffixId: 7,
        stat: "mpCostReductionBps",
        value: 500,
        valueUnit: "basis-points",
      },
      {
        id: "swiftcasting",
        clientAffixId: 6,
        stat: "cooldownReductionBps",
        value: 400,
        valueUnit: "basis-points",
      },
    ],
  };
  const awardedStaff = store.awardCharacterItemizationLoot({
    accountId: "mounttester",
    characterSlot: 0,
    lootEventId: "m64000:d-fixture-magic-001",
    drops: [staffDrop],
    now: 1_002,
  });
  assert.equal(awardedStaff.granted, true);
  const staff = awardedStaff.slots.find(({ itemization }) => itemization);
  assert.ok(staff);
  const equippedStaff = applyCaracatoaEquipmentRequest({
    accountStore: store,
    accountId: "mounttester",
    characterSlot: 0,
    classId: 1,
    equipmentSlot: 0,
    inventorySlot: staff.slot,
    catalog: itemCatalog,
    itemizationConfig,
  });
  assert.equal(equippedStaff.accepted, true, JSON.stringify(equippedStaff));
  assert.equal(equippedStaff.bonuses.magicAttackBonus, 1);
  assert.equal(equippedStaff.bonuses.magicAttackBps, 800);
  assert.equal(equippedStaff.bonuses.mpCostReductionBps, 1_500);
  assert.equal(equippedStaff.bonuses.cooldownReductionBps, 800);
  assert.equal(equippedArmor.bonuses.mpCostReductionBps, 500);
  const port = await listen(listener);
  socket = createConnection({ host: "127.0.0.1", port });
  await once(socket, "connect");
  const reader = frameReader(socket);
  const login = loginBody(0x20d, 124);
  Buffer.from("SYNTHPASS", "ascii").copy(login, 8);
  Buffer.from("mounttester", "ascii").copy(login, 20);
  socket.write(Buffer.concat([clientHandshake(), encodeFrame(login, 0x31)]));

  const loginReply = await reader.next(0x10a);
  const clientId = loginReply.body.readUInt16LE(2);
  assert.ok(clientId > 0);
  const hashKeyTable = loginReply.body.subarray(8, 24);
  assert.equal(hashKeyTable.length, 16);

  const token = loginBody(0xfde, 32);
  Buffer.from("135790", "ascii").copy(token, 8);
  sendBody(socket, token, hashKeyTable[0] ^ 0xff);
  assert.equal((await reader.next(0xfde)).body.length + 4, 12);
  const characterList = await reader.next(0x110);
  assert.equal(characterList.body.length + 4, 1224);

  const enter = loginBody(0x213, 36);
  enter.writeUInt16LE(clientId, 2);
  enter.writeInt32LE(0, 8);
  enter.writeUInt32LE(computeWyd727ClineVersion(1), 16);
  sendBody(socket, enter, 0x33);
  const world = await reader.next(0x114).catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  });
  assert.equal(world.body.length + 4, 2104);
  assert.deepEqual(
    { x: world.body.readInt16LE(8), y: world.body.readInt16LE(10) },
    worldStartPosition,
  );

  const hpBeforeAttack = store.getCharacterBySlot("mounttester", 0).currentHp;
  sendBody(socket, basicAttackBody({
    clientId,
    source: worldStartPosition,
    target: { x: 128, y: 127 },
    targetEntityId: 64_000,
  }), 0x36);
  await reader.next(0x39d, 4000, "initial retaliatory basic attack").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  });
  const hpAfterRetaliation = await reader.next(0x181);
  assert.equal(combatEvents.length, 1);
  const retaliation = combatEvents[0];
  const rawRetaliationDamage = computeCaracatoaMonsterCounterattackDamage(
    80,
    retaliation.effectiveDefense,
  );
  const expectedRetaliationDamage = computeCaracatoaDamageAfterAbsorption(
    rawRetaliationDamage,
    100,
  );
  assert.ok(rawRetaliationDamage > 0);
  assert.equal(retaliation.damage, expectedRetaliationDamage);
  assert.ok(retaliation.damage < rawRetaliationDamage);
  assert.equal(hpAfterRetaliation.body.readInt32LE(8), hpBeforeAttack - expectedRetaliationDamage);
  assert.equal(store.getCharacterBySlot("mounttester", 0).currentHp, hpBeforeAttack - expectedRetaliationDamage);

  sendBody(socket, movementBody({
    clientId,
    from: worldStartPosition,
    destiny: { x: 129, y: 128 },
    codes: [0x36],
  }), 0x36);
  const moved = await reader.next(0x366);
  assert.equal(moved.body.readInt16LE(44), 129);
  assert.equal(moved.body.readInt16LE(46), 128);

  let position = { x: 129, y: 128 };
  let movementSequence = 0x38;
  for (const count of [12, 12, 2]) {
    const codes = Array(count).fill(0x38);
    const destiny = { x: position.x, y: position.y + count };
    sendBody(socket, movementBody({ clientId, from: position, destiny, codes }), movementSequence++);
    const response = await reader.next(0x366);
    assert.equal(response.body.readInt16LE(44), destiny.x);
    assert.equal(response.body.readInt16LE(46), destiny.y);
    position = destiny;
  }
  assert.deepEqual(position, { x: 129, y: 154 });
  sendBody(socket, movementBody({
    clientId,
    from: position,
    destiny: { x: position.x, y: position.y + 1 },
    codes: [0x38],
  }), movementSequence++);
  const gateCorrected = await reader.next(0x366);
  assert.equal(gateCorrected.body.readInt16LE(44), 129);
  assert.equal(gateCorrected.body.readInt16LE(46), 154);

  const initialAttributeBody = (await reader.next(0x7f04)).body;
  assert.equal(initialAttributeBody.readUInt16LE(0), 0x7f04);
  const initialMaxHp = initialAttributeBody.readInt32LE(28);
  await reader.next(0x7f06);
  const initialStateFrame = await reader.next(0x7f0d, 4000, "initial mount snapshot 0x7f0d").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  });
  const initialState = parseCaracatoaMountStateBody(initialStateFrame.body);
  assert.equal(initialState.malformed, false);
  assert.equal(initialState.mounts.length, 1);
  assert.equal(initialState.mounts[0].stage, "egg");
  const stageSnapshot = parseCaracatoaStageState((await reader.next(0x7f13)).body);
  assert.equal(stageSnapshot.malformed, false);
  assert.equal(stageSnapshot.stage, "mortal");
  assert.equal(stageSnapshot.level, 1);
  for (let slot = 0; slot < 6; slot += 1) await reader.next(0x7f08);

  sendBody(socket, buildCaracatoaStageRequestBody({
    clientId,
    timestamp: 1_001,
    requestId: "00000000-0000-4000-8000-000000000001",
  }), 0x34);
  const rejectedStage = parseCaracatoaStageState((await reader.next(0x7f13)).body);
  assert.equal(rejectedStage.status, 2);
  assert.equal(rejectedStage.reason, 1);
  assert.equal(rejectedStage.stage, "mortal");

  sendBody(socket, buildCaracatoaRefinementRequestBody({
    clientId,
    timestamp: 1_002,
    inventorySlot: 0,
    requestId: "00000000-0000-4000-8000-000000000002",
  }), 0x35);
  const rejectedRefinement = parseCaracatoaRefinementResult((await reader.next(0x7f11)).body);
  assert.equal(rejectedRefinement.malformed, false);
  assert.equal(rejectedRefinement.status, 2);
  assert.equal(rejectedRefinement.reason, 1);

  const eggId = initialState.mounts[0].id;
  const incubate = buildCaracatoaMountRequestBody({
    clientId,
    timestamp: 1001,
    action: CARACATOA_MOUNT_ACTION.incubate,
    mountId: eggId,
    inventorySlot: 2,
  });
  assert.equal(incubate.length, 48);
  sendBody(socket, incubate, 0x34);
  const hatched = parseCaracatoaMountStateBody((await reader.next(0x7f0d, 4000, "incubation result 0x7f0d").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  })).body);
  assert.equal(hatched.status, 1);
  assert.equal(hatched.mounts[0].stage, "juvenile");
  const inventoryDelta = await reader.next(0x182);
  assert.equal(inventoryDelta.body.readInt16LE(10), 2);

  const select = buildCaracatoaMountRequestBody({
    clientId,
    action: CARACATOA_MOUNT_ACTION.select,
    mountId: eggId,
  });
  sendBody(socket, select, 0x35);
  const selected = parseCaracatoaMountStateBody((await reader.next(0x7f0d, 4000, "selection result 0x7f0d").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  })).body);
  assert.equal(selected.status, 1);
  assert.equal(selected.mounts[0].active, true);

  const ride = buildCaracatoaMountRequestBody({
    clientId,
    action: CARACATOA_MOUNT_ACTION.ride,
    mountId: eggId,
  });
  sendBody(socket, ride, 0x36);
  const mountedAttributeBody = (await reader.next(0x7f04)).body;
  const mountedState = parseCaracatoaMountStateBody((await reader.next(0x7f0d, 4000, "ride result 0x7f0d").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  })).body);
  assert.equal(mountedState.status, 1);
  assert.equal(mountedState.mounts[0].riding, true);
  assert.equal(mountedState.mounts[0].bonuses.hp, 20);
  assert.equal(mountedAttributeBody.readInt32LE(28), initialMaxHp + 20);

  worldClockMs = 2_000;
  sendBody(socket, skillAttackBody({
    clientId,
    source: { x: 129, y: 154 },
    target: { x: 130, y: 153 },
    targetEntityId: 64_002,
    skillId: 25,
  }), 0x37);
  const magicSkillResult = await reader.next(0x39d, 4000, "Foema magic skill cast").catch((error) => {
    throw new Error(`${error.message}; events=${events.join(",")}`);
  });
  const manaSync = await reader.next(0x181, 4000, "reduced skill mana sync");
  assert.equal(manaSpendEvents.length, 1);
  assert.equal(manaSpendEvents[0].skillId, 25);
  assert.equal(manaSpendEvents[0].manaSpent, 6);
  assert.equal(manaSync.body.readInt32LE(12), store.getCharacterBySlot("mounttester", 0).currentMp);
  assert.equal(magicSkillResult.body.readUInt16LE(52), 25);
  assert.equal(magicSkillResult.body.readInt32LE(60), 23);
  assert.deepEqual(dealtDamageEvents.at(-1), {
    type: "world-monster-damaged",
    monsterEntityId: 64_002,
    damage: 23,
    currentHp: 977,
    maxHp: 1_000,
    skillId: 25,
  });

  worldClockMs = 4_759;
  const cooldownRejection = waitForCooldownRejection();
  sendBody(socket, skillAttackBody({
    clientId,
    source: { x: 129, y: 154 },
    target: { x: 130, y: 153 },
    targetEntityId: 64_002,
    skillId: 25,
  }), 0x38);
  assert.equal((await cooldownRejection).reason, "skill-cooldown");
  assert.equal(manaSpendEvents.length, 1);
  worldClockMs = 4_760;
  sendBody(socket, skillAttackBody({
    clientId,
    source: { x: 129, y: 154 },
    target: { x: 130, y: 153 },
    targetEntityId: 64_002,
    skillId: 25,
  }), 0x39);
  const recastResult = await reader.next(0x39d, 4000, "Foema skill cast after reduced cooldown");
  const recastManaSync = await reader.next(0x181, 4000, "recast mana sync");
  assert.equal(recastResult.body.readInt32LE(60), 23);
  assert.equal(recastManaSync.body.readInt32LE(12), store.getCharacterBySlot("mounttester", 0).currentMp);
  assert.equal(manaSpendEvents.length, 2);
  assert.equal(manaSpendEvents[1].manaSpent, 6);
  assert.equal(cooldownRejectionEvents.length, 1);
  assert.equal(dealtDamageEvents.at(-1).currentHp, 954);

  worldClockMs = 6_000;
  sendBody(socket, basicAttackBody({
    clientId,
    source: { x: 129, y: 154 },
    target: { x: 130, y: 154 },
    targetEntityId: 64_001,
  }), 0x37);
  await reader.next(0x39d, 4000, "utility-reward basic attack");
  const utilityDropDeath = await reader.next(0x338);
  assert.equal(utilityDropDeath.body.readBigInt64LE(20), 91n);
  const lootInventoryDelta = await reader.next(0x182);
  assert.equal(lootInventoryDelta.body.readInt16LE(10), lootAwards[0].award.slots[0].slot);
  await reader.next(0x7f0a);
  assert.deepEqual(lootAwards.map(({ playerLuckBonusBps }) => playerLuckBonusBps), [150]);
  assert.equal(lootAwards[0].award.awarded, true);
  assert.equal(lootAwards[0].award.slots.length, 1);
  assert.equal(lootAwards[0].award.catalogItemId, "caracatoa-ferro-votivo");
  assert.deepEqual(experienceEvents.map(({ baseExperience, experienceBonusBps, experienceGained }) => ({
    baseExperience,
    experienceBonusBps,
    experienceGained,
  })), [{ baseExperience: 90, experienceBonusBps: 150, experienceGained: 91 }]);
  assert.equal(store.getCharacterBySlot("mounttester", 0).experience, 91);

  assert.deepEqual(events.filter((type) => ["world-entry-accepted", "world-mount-tutorial-egg-granted", "world-mount-action"].includes(type)), [
    "world-mount-tutorial-egg-granted", "world-entry-accepted", "world-mount-action", "world-mount-action", "world-mount-action",
  ]);

  assert.equal(store.saveCharacterPosition(
    "mounttester",
    0,
    { x: 129, y: 154 },
    { x: 129, y: 155 },
  ), true);
  const previousSocket = socket;
  const previousSocketClosed = once(previousSocket, "close");
  previousSocket.destroy();
  await Promise.race([
    previousSocketClosed,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);

  socket = createConnection({ host: "127.0.0.1", port });
  await once(socket, "connect");
  const reconnectReader = frameReader(socket);
  const reconnectLogin = loginBody(0x20d, 124);
  Buffer.from("SYNTHPASS", "ascii").copy(reconnectLogin, 8);
  Buffer.from("mounttester", "ascii").copy(reconnectLogin, 20);
  socket.write(Buffer.concat([clientHandshake(), encodeFrame(reconnectLogin, 0x41)]));

  const reconnectLoginReply = await reconnectReader.next(0x10a);
  const reconnectClientId = reconnectLoginReply.body.readUInt16LE(2);
  const reconnectToken = loginBody(0xfde, 32);
  Buffer.from("135790", "ascii").copy(reconnectToken, 8);
  sendBody(socket, reconnectToken, 0x42);
  await reconnectReader.next(0xfde);
  await reconnectReader.next(0x110);
  const reconnectEnter = loginBody(0x213, 36);
  reconnectEnter.writeUInt16LE(reconnectClientId, 2);
  reconnectEnter.writeInt32LE(0, 8);
  reconnectEnter.writeUInt32LE(computeWyd727ClineVersion(1), 16);
  sendBody(socket, reconnectEnter, 0x43);
  const recoveredWorld = await reconnectReader.next(0x114);
  assert.deepEqual(
    { x: recoveredWorld.body.readInt16LE(8), y: recoveredWorld.body.readInt16LE(10) },
    worldStartPosition,
  );
  assert.equal(events.filter((type) => type === "world-entry-position-corrected").length, 1);
  const recoveredCharacter = store.getCharacterBySlot("mounttester", 0);
  assert.equal(recoveredCharacter.worldX, worldStartPosition.x);
  assert.equal(recoveredCharacter.worldY, worldStartPosition.y);
  socket.destroy();
});
