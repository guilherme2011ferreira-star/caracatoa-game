import {
  DEFAULT_WYD727_CLASS_WORLD_STATS,
  validateWyd727ClassWorldStats,
} from "./wyd-727-class-catalog.mjs";

const FRAME_LENGTH = 2104;
const BODY_LENGTH = FRAME_LENGTH - 4;
const EQUIP_COUNT = 18;
const ITEM_SIZE = 12;
const INVENTORY_COUNT = 60;
const AFFECT_COUNT = 47;
const AFFECT_SIZE = 8;

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function writeScore(body, offset, level, stats) {
  body.writeInt32LE(level, offset);
  body.writeInt32LE(stats.defense, offset + 4);
  body.writeInt32LE(stats.damage, offset + 8);
  body.writeUInt8(stats.merchant, offset + 12);
  body.writeUInt8(stats.movementSpeed, offset + 13);
  body.writeUInt8(stats.direction, offset + 14);
  body.writeUInt8(stats.chaosRate, offset + 15);
  body.writeInt32LE(stats.maxHp, offset + 16);
  body.writeInt32LE(stats.maxMp, offset + 20);
  body.writeInt32LE(stats.currentHp, offset + 24);
  body.writeInt32LE(stats.currentMp, offset + 28);
  body.writeUInt16LE(stats.str, offset + 32);
  body.writeUInt16LE(stats.int, offset + 34);
  body.writeUInt16LE(stats.dex, offset + 36);
  body.writeUInt16LE(stats.con, offset + 38);
  // Four UInt16 special stats remain zero in the newly-created Caracatoa profile.
}

function writeItem(
  body,
  offset,
  index,
  stackCount = 0,
  field04 = 0,
  effects = [
    { index: 0, value: 0 },
    { index: 0, value: 0 },
    { index: 0, value: 0 },
  ],
) {
  body.writeUInt16LE(index, offset);
  body.writeInt16LE(stackCount, offset + 2);
  body.writeUInt16LE(field04, offset + 4);
  for (let effect = 0; effect < 3; effect += 1) {
    body.writeUInt8(effects[effect].index, offset + 6 + effect * 2);
    body.writeUInt8(effects[effect].value, offset + 7 + effect * 2);
  }
}

/** Build the WYDBot 7.27 0x114 body; all offsets are full-frame offsets minus 4. */
export function buildWyd727CharacterToWorldBody({
  clientId,
  mobIndex = clientId,
  timestamp = Date.now() >>> 0,
  serverTime = Math.floor(Date.now() / 1000) >>> 0,
  character,
  classStats = DEFAULT_WYD727_CLASS_WORLD_STATS,
  position = { x: 0, y: 0 },
  inventoryItems = [],
  learnedSkill = [0, 0],
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(mobIndex, 1, 0xffff, "mobIndex");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(serverTime, 0, 0xffffffff, "serverTime");
  if (!character || !/^[A-Za-z0-9_]{1,16}$/.test(character.name)) {
    throw new TypeError("personagem não corresponde ao perfil Caracatoa.");
  }
  validateWyd727ClassWorldStats(classStats);
  assertInteger(character.classId, 0, 3, "classId");
  assertInteger(character.level, 1, 0x7fffffff, "level");
  assertInteger(character.gold, 0, 0x7fffffff, "gold");
  const experience = character.experience ?? 0;
  assertInteger(experience, 0, Number.MAX_SAFE_INTEGER, "experience");
  assertInteger(position?.x, -0x8000, 0x7fff, "position.x");
  assertInteger(position?.y, -0x8000, 0x7fff, "position.y");
  if (
    !Array.isArray(inventoryItems) ||
    inventoryItems.length > INVENTORY_COUNT
  ) {
    throw new TypeError("inventoryItems precisa conter até 60 itens.");
  }
  if (
    !Array.isArray(learnedSkill) ||
    learnedSkill.length !== 2 ||
    learnedSkill.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 0xffffffff,
    )
  ) {
    throw new TypeError("learnedSkill precisa conter dois UInt32.");
  }
  const itemsBySlot = new Map();
  for (const item of inventoryItems) {
    assertInteger(item?.slot, 0, INVENTORY_COUNT - 1, "inventory.slot");
    assertInteger(item?.clientItemId, 1, 0xffff, "inventory.clientItemId");
    assertInteger(item?.stackCount, 1, 500, "inventory.stackCount");
    assertInteger(item?.field04, 0, 0xffff, "inventory.field04");
    if (itemsBySlot.has(item.slot)) {
      throw new RangeError("inventory.slot duplicado.");
    }
    if (!Array.isArray(item.effects) || item.effects.length !== 3) {
      throw new TypeError("inventory.effects precisa conter três pares.");
    }
    for (const effect of item.effects) {
      assertInteger(effect?.index, 0, 0xff, "inventory.effect.index");
      assertInteger(effect?.value, 0, 0xff, "inventory.effect.value");
    }
    itemsBySlot.set(item.slot, item);
  }

  const body = Buffer.alloc(BODY_LENGTH);
  body.writeUInt16LE(0x114, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeInt16LE(position.x, 8);
  body.writeInt16LE(position.y, 10);
  Buffer.from(character.name, "ascii").copy(body, 12);
  body.writeUInt16LE(0, 30); // guild
  body.writeUInt8(character.classId, 32);
  body.writeInt32LE(character.gold, 36);
  body.writeBigInt64LE(BigInt(experience), 44);

  // MScore.level is zero-based in WYDBot; its player store displays level + 1.
  const wireLevel = character.level - 1;
  writeScore(body, 56, wireLevel, classStats); // BaseScore @ packet +60
  writeScore(body, 104, wireLevel, classStats); // FinalScore @ packet +108

  // Equipment[0] carries the class/body tag consumed by WYDBot's renderer.
  for (let item = 0; item < EQUIP_COUNT; item += 1) {
    writeItem(
      body,
      152 + item * ITEM_SIZE,
      item === 0 ? character.classId * 10 : 0,
    );
  }
  for (let item = 0; item < INVENTORY_COUNT; item += 1) {
    const inventoryItem = itemsBySlot.get(item);
    writeItem(
      body,
      368 + item * ITEM_SIZE,
      inventoryItem?.clientItemId ?? 0,
      inventoryItem?.stackCount ?? 0,
      inventoryItem?.field04 ?? 0,
      inventoryItem?.effects,
    );
  }
  for (let item = 0; item < 2; item += 1) {
    writeItem(body, 1088 + item * ITEM_SIZE, 0);
  }

  body.writeUInt16LE(mobIndex, 1382); // MobIndex @ packet +1386
  body.writeUInt32LE(learnedSkill[0] >>> 0, 1136); // Learn[0] @ packet +1140
  body.writeUInt32LE(learnedSkill[1] >>> 0, 1140); // Learn[1] @ packet +1144
  body.writeUInt32LE(serverTime >>> 0, 2072); // ServerTime @ packet +2076
  // Skill points, skill bar, modifiers, resistances, affects and unknown gaps stay zero.
  if (AFFECT_COUNT * AFFECT_SIZE !== 376)
    throw new Error("layout interno de MAffect inválido.");
  return body;
}
