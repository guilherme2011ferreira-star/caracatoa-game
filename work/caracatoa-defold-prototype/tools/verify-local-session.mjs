import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createLocalGameListener } from '../../../server/caracatoa/game-listener.mjs';
import { awardCaracatoaItemizedMonsterLoot } from '../../../server/caracatoa/caracatoa-itemized-monster-loot.mjs';
import { PlayerAccountStore } from '../../../server/caracatoa/player-account-store.mjs';
import { createWyd727Walkability, WYD727_WORLD_SIZE } from '../../../server/caracatoa/wyd-727-walkability.mjs';
import { getWyd727SkillsForClass } from '../../../server/caracatoa/wyd-727-skill-catalog.mjs';
import {
  getWyd727StarterInventoryItems,
  resolveWyd727InventoryItems,
} from '../../../server/caracatoa/wyd-727-item-catalog.mjs';
import {
  applyCaracatoaEquipmentRequest,
  resolveCaracatoaCharacterEquipment,
} from '../../../server/caracatoa/wyd-727-item-equipment.mjs';

const HOST = '127.0.0.1';
const PORT = 0;
const TIMEOUT_MS = 15000;
const SYNTHETIC_MONSTER_ID = 0x4567;
const executable = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'usage: node tools/verify-local-session.mjs <CaracatoaDefoldSpike.exe>');
assert.match(executable, /Caracatoa3DPreview\.exe$/i, 'only the local Caracatoa 3D preview build is accepted');
const classArgument = process.argv.find((argument) => argument.startsWith('--class='));
const classId = classArgument ? Number(classArgument.slice('--class='.length)) : 1;
assert.ok(Number.isInteger(classId) && classId >= 0 && classId <= 3, '--class must be 0 (TK), 1 (Foema), 2 (BM), or 3 (HT)');
const skillCatalog = JSON.parse(await readFile(new URL('../../../server/caracatoa/data/catalogs/skills.json', import.meta.url), 'utf8'));
const classSkills = getWyd727SkillsForClass(skillCatalog, classId);
assert.ok(classSkills.length > 0, `no Caracatoa skills are registered for class ${classId}`);
const skillArgument = process.argv.find((argument) => argument.startsWith('--skill='));
const selectedSkillId = skillArgument ? Number(skillArgument.slice('--skill='.length)) : classSkills[0].properties.clientSkillId;
const selectedSkill = classSkills.find(({ properties }) => properties.clientSkillId === selectedSkillId);
assert.ok(selectedSkill, `skill ${selectedSkillId} does not belong to class ${classId}`);
const testAttributeId = { str: 0, int: 1, dex: 2, con: 3 }[selectedSkill.properties.scalingAttribute];
assert.notEqual(testAttributeId, undefined, `unsupported scale ${selectedSkill.properties.scalingAttribute}`);
const itemizedVitalsMode = process.argv.includes('--itemized-vitals');
const itemizedEquipmentMode = process.argv.includes('--itemized-equipment') || itemizedVitalsMode;
const hudInputTestMode = process.argv.includes('--hud-input');
const equipmentAttackBonus = itemizedEquipmentMode ? 3 : 5;
const equipmentDefenseBonus = itemizedVitalsMode ? 1 : itemizedEquipmentMode ? 4 : 2;
const classSkillDamage = 10 + equipmentAttackBonus + selectedSkill.properties.damageBonus + 1;
const itemCatalog = JSON.parse(await readFile(new URL('../../../server/caracatoa/data/catalogs/items.json', import.meta.url), 'utf8'));
const itemizationConfig = JSON.parse(await readFile(new URL('../../../server/caracatoa/data/catalogs/itemization.json', import.meta.url), 'utf8'));
const monsterCatalog = JSON.parse(await readFile(new URL('../../../server/caracatoa/data/catalogs/monsters.json', import.meta.url), 'utf8'));

const directory = await mkdtemp(join(tmpdir(), 'caracatoa-defold-session-'));
const accountStore = new PlayerAccountStore({ databasePath: join(directory, 'players.sqlite') });
const accountId = 'A'.repeat(12);
const password = 'P'.repeat(9);
const pin = '7'.repeat(6);
await accountStore.createAccount(accountId, password, pin);

const heightmap = new Int8Array(WYD727_WORLD_SIZE * WYD727_WORLD_SIZE);
const walkability = createWyd727Walkability(heightmap);
const serverEvents = [];

function createSyntheticMonsterBody({ entityId, x, y, hp, damage = 0 }) {
  const body = Buffer.alloc(252);
  body.writeUInt16LE(0x364, 0);
  body.writeInt16LE(x, 8);
  body.writeInt16LE(y, 10);
  body.writeUInt16LE(entityId, 12);
  body.write('Golem de Pedra', 14, 'ascii');
  body.writeInt32LE(1, 136);
  body.writeInt32LE(0, 140);
  body.writeInt32LE(damage, 144);
  body.writeUInt8(3, 149);
  body.writeInt32LE(hp, 152);
  body.writeInt32LE(hp, 160);
  return body;
}

const server = createLocalGameListener({
  accountStore,
  authEnabled: true,
  idleTimeoutMs: 0,
  worldStartPosition: { x: 321, y: 123 },
  walkability,
  getCharacterSkills: async (requestedClassId) => requestedClassId === classId ? classSkills : [],
  getCharacterInventory: async (account, slot) => {
    const inventory = accountStore.initializeCharacterInventory(
      account,
      slot,
      itemizedEquipmentMode ? [] : getWyd727StarterInventoryItems(itemCatalog),
    );
    const detailsBySlot = new Map(
      accountStore.getCharacterItemizationDetails(account, slot)
        .map((detail) => [detail.slot, detail]),
    );
    return resolveWyd727InventoryItems(inventory, itemCatalog).map((item) => ({
      ...item,
      itemization: detailsBySlot.get(item.slot) ?? null,
    }));
  },
  getCharacterEquipment: async (account, slot, requestedClassId) =>
    resolveCaracatoaCharacterEquipment({
      accountStore,
      accountId: account,
      characterSlot: slot,
      classId: requestedClassId,
      catalog: itemCatalog,
      itemizationConfig,
    }).equipment,
  changeCharacterEquipment: async ({ accountId, characterSlot, classId: requestedClassId, equipmentSlot, inventorySlot }) =>
    applyCaracatoaEquipmentRequest({
      accountStore,
      accountId,
      characterSlot,
      classId: requestedClassId,
      equipmentSlot,
      inventorySlot,
      catalog: itemCatalog,
      itemizationConfig,
    }),
  getWorldMonsterBodies: async () => [
    createSyntheticMonsterBody({ entityId: SYNTHETIC_MONSTER_ID, x: classId === 3 ? 327 : 323, y: 123, hp: selectedSkill.properties.effectType === 'defense' ? 10000 : classId === 1 ? 17 : 100, damage: selectedSkill.properties.effectType === 'defense' ? 80 : 0 }),
    createSyntheticMonsterBody({ entityId: 0x4568, x: classId === 1 ? 323 : 330, y: classId === 1 ? 124 : 130, hp: 50 }),
  ],
  monsterAiIntervalMs: 60_000,
  monsterAttackIntervalMs: 60_000,
  onEvent: (event) => {
    serverEvents.push(event);
    if (event.type === 'character-created') {
      if (itemizedEquipmentMode) {
        accountStore.initializeCharacterInventory(accountId, event.slot, []);
        for (const templateId of ['caracatoa-ferro-votivo', 'caracatoa-peitoral-de-cobre']) {
          const config = structuredClone(itemizationConfig);
          config.dropRules.equipmentChanceCapBps = 10_000;
          config.levelRules.affixScaleBaseBps = 10_000;
          config.affixes.find(({ id }) => id === 'warded').minValue = 3;
          config.monsterProfiles.common.maxAffixValueRollBps = 0;
          if (itemizedVitalsMode && templateId === 'caracatoa-peitoral-de-cobre') {
            config.rarities.mystic.affixCount = { min: 2, max: 2 };
            const vital = config.affixes.find(({ id }) => id === 'vital');
            const focused = config.affixes.find(({ id }) => id === 'focused');
            vital.minValue = 10;
            focused.minValue = 8;
            config.affixes = [
              vital,
              focused,
              ...config.affixes.filter(({ id }) => id !== 'vital' && id !== 'focused'),
            ];
          }
          config.itemPools.starter = [templateId];
          config.lootTables['field-common'].maxDropsPerKill = 1;
          config.lootTables['field-common'].entries = [{ kind: 'equipment', baseChanceBps: 10_000 }];
          let drawNumber = 0;
          const awarded = awardCaracatoaItemizedMonsterLoot({
            accountStore,
            accountId,
            characterSlot: event.slot,
            monsterEntityId: 64_000,
            lootEventId: `itemized-session:${templateId}`,
            monsterCatalog,
            itemCatalog,
            itemizationConfig: config,
            randomInt(min, max) {
              drawNumber += 1;
              if (drawNumber === 3 && min === 1 && max === 10_000) return 8_001;
              if (drawNumber === 5 && !itemizedVitalsMode && templateId === 'caracatoa-peitoral-de-cobre' && max > 600) return 601;
              if (drawNumber === 6 && min === 1 && max === 10_000) return 10_000;
              return min;
            },
          });
          assert.equal(awarded.awarded, true, `failed to award synthetic ${templateId}`);
          assert.equal(awarded.slots[0]?.itemization?.catalogItemId, templateId);
          if (itemizedVitalsMode && templateId === 'caracatoa-peitoral-de-cobre') {
            assert.deepEqual(awarded.slots[0].itemization.affixes.map(({ stat, value }) => ({ stat, value })), [
              { stat: 'maxHpFlat', value: 10 },
              { stat: 'maxMpFlat', value: 8 },
            ]);
          }
        }
      }
      if (selectedSkill.properties.effectType === 'heal') {
        accountStore.initializeCharacterHitPoints(accountId, event.slot, 10, 10);
      }
    }
  },
});

let clientProcess;
let consoleOutput = '';
const tracePath = join(directory, 'client-trace.log');
const appData = join(directory, 'appdata');
const localAppData = join(directory, 'localappdata');

async function readTrace() {
  try { return await readFile(tracePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function waitForCompleteSession() {
  const expected = [
    'SESSION_FIXTURES_PASS',
    'SESSION_TEST_MODE_LOOPBACK',
    'SESSION_TEST_LOGIN_SENT',
    'SESSION_TEST_LOGIN_OK',
    'SESSION_TEST_TOKEN_OK',
    'SESSION_TEST_EMPTY_ROSTER_OK',
    'SESSION_TEST_CREATE_OK',
    'SESSION_TEST_ROSTER_OK',
    'SESSION_TEST_WORLD_ENTRY_PASS',
    'SESSION_TEST_INITIAL_PROGRESSION_PASS',
    'SESSION_TEST_MOUNT_SNAPSHOT_PASS',
    'SESSION_TEST_STAGE_SNAPSHOT_PASS',
    'SESSION_TEST_INVENTORY_PASS',
    'SESSION_TEST_ATTRIBUTE_SENT',
    'SESSION_TEST_ATTRIBUTE_PASS',
    'SESSION_TEST_EQUIPMENT_PASS',
    'SESSION_TEST_MOVE_PASS',
  ];
  if (itemizedEquipmentMode) expected.push('SESSION_TEST_ITEMIZATION_PASS');
  if (itemizedVitalsMode) expected.push('SESSION_TEST_ITEMIZED_RESOURCE_PASS');
  else if (itemizedEquipmentMode) expected.push('SESSION_TEST_ITEMIZED_EQUIPMENT_RESOURCE_PASS');
  if (classId === 1) {
    if (selectedSkill.properties.effectType === 'heal') {
      expected.push('SESSION_TEST_SKILL_HEAL_PASS');
    } else {
      expected.push(
        'SESSION_TEST_SKILL_SENT',
        'SESSION_TEST_SKILL_MANA_PASS',
        'SESSION_TEST_SKILL_CAST_PASS',
        'SESSION_TEST_MONSTER_KILL_PASS',
        'SESSION_TEST_LEVEL_UP_PASS',
        'SESSION_TEST_LEVEL_ATTRIBUTE_PASS',
        'SESSION_TEST_SKILL_CHAIN_LEARN_PASS',
        'SESSION_TEST_SKILL_CHAIN_MANA_PASS',
        'SESSION_TEST_SKILL_CHAIN_CAST_PASS',
      );
    }
  } else if (selectedSkill.properties.effectType === 'defense') {
    expected.push('SESSION_TEST_SKILL_DEFENSE_RESOURCE_PASS', 'SESSION_TEST_SKILL_DEFENSE_DAMAGE_PASS');
  } else {
    expected.push('SESSION_TEST_SKILL_SENT', 'SESSION_TEST_SKILL_MANA_PASS', 'SESSION_TEST_CLASS_SKILL_PASS');
  }
  const end = Date.now() + TIMEOUT_MS;
  while (Date.now() < end) {
    const trace = await readTrace();
    if (hudInputTestMode && trace.includes('HUD_INPUT_TEST_REGISTER_BUTTON_FAIL')) {
      throw new Error(`The Defold HUD did not route the registration button click.\n${trace}\n${consoleOutput}`);
    }
    if (trace.includes('SESSION_TEST_FAIL:')) {
      const events = serverEvents
        .map(({ type, code, reason }) => [type, code, reason].filter((value) => value !== undefined).join(':'))
        .join(' ');
      throw new Error(`O cliente Defold recusou a sessão sintética.\n${trace}\nserverEvents=${events}`);
    }
    if (expected.every((marker) => trace.includes(marker)) &&
      (!hudInputTestMode || trace.includes('HUD_INPUT_TEST_REGISTER_BUTTON_PASS'))) return trace;
    if (clientProcess?.exitCode !== null && clientProcess?.exitCode !== undefined) {
      throw new Error(`O cliente saiu antes do ingresso no mundo (exit ${clientProcess.exitCode}).\n${trace}\n${consoleOutput}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const eventSummary = serverEvents
    .map(({ type, code, reason, skillId, availablePoints }) =>
      [type, code, reason, skillId, availablePoints].filter(Boolean).join(":"),
    )
    .join(" ");
  throw new Error(`Timeout aguardando login→PIN→roster→mundo.\n${await readTrace()}\n${consoleOutput}\n${eventSummary}`);
}

try {
  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(PORT, HOST, resolveListen);
  });
  const sessionTestPort = server.address().port;

  clientProcess = spawn(executable, [], {
    cwd: dirname(executable),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      CARACATOA_TEST_TRACE: tracePath,
      CARACATOA_SESSION_TEST_MODE: '1',
      CARACATOA_HUD_INPUT_TEST: hudInputTestMode ? '1' : '0',
      CARACATOA_SESSION_TEST_ITEMIZED_EQUIPMENT: itemizedEquipmentMode ? '1' : '0',
      CARACATOA_SESSION_TEST_ITEMIZED_VITALS: itemizedVitalsMode ? '1' : '0',
      CARACATOA_SESSION_TEST_CLASS_ID: String(classId),
      CARACATOA_SESSION_TEST_SKILL_ID: String(selectedSkillId),
      CARACATOA_SESSION_TEST_ATTRIBUTE_ID: String(testAttributeId),
      CARACATOA_SERVER_PORT: String(sessionTestPort),
    },
  });
  clientProcess.stdout.setEncoding('utf8');
  clientProcess.stderr.setEncoding('utf8');
  clientProcess.stdout.on('data', (chunk) => { consoleOutput += chunk; });
  clientProcess.stderr.on('data', (chunk) => { consoleOutput += chunk; });
  clientProcess.once('error', (error) => { consoleOutput += `${error.message}\n`; });
  const trace = await waitForCompleteSession();
  const sessionEvents = serverEvents
    .filter(({ type }) => ['login-authenticated', 'token-authenticated', 'character-created', 'world-entry-accepted', 'world-mount-tutorial-egg-granted', 'world-skill-rejected', 'world-attribute-point-spent', 'world-equipment-changed', 'world-skill-learned', 'world-move-accepted', 'world-skill-mana-spent', 'world-skill-cast', 'world-skill-heal-applied', 'world-skill-defense-applied', 'world-player-damaged', 'world-monster-damaged', 'world-monster-experience-awarded', 'world-monster-killed'].includes(type));
  const requiredEvents = ['login-authenticated', 'token-authenticated', 'character-created', 'world-entry-accepted', 'world-mount-tutorial-egg-granted', 'world-skill-rejected', 'world-attribute-point-spent', 'world-equipment-changed', 'world-move-accepted'];
  const healScenario = selectedSkill.properties.effectType === 'heal';
  const defenseScenario = selectedSkill.properties.effectType === 'defense';
  if (healScenario) requiredEvents.push('world-skill-heal-applied');
  if (defenseScenario) requiredEvents.push('world-skill-defense-applied', 'world-player-damaged');
  else if (classId === 1 && !healScenario) requiredEvents.push('world-monster-experience-awarded', 'world-monster-killed');
  for (const type of requiredEvents) {
    assert.ok(sessionEvents.some((event) => event.type === type), `missing server event ${type}`);
  }
  const expectedSkillCount = classId === 1 && !healScenario ? 2 : 1;
  for (const type of ['world-skill-learned', 'world-skill-mana-spent', 'world-skill-cast']) {
    assert.equal(sessionEvents.filter((event) => event.type === type).length, expectedSkillCount, `expected ${expectedSkillCount} ${type} event(s)`);
  }
  assert.equal(sessionEvents.filter((event) => event.type === 'world-skill-heal-applied').length, healScenario ? 1 : 0);
  if (defenseScenario) {
    const applied = sessionEvents.find(({ type }) => type === 'world-skill-defense-applied');
    assert.equal(applied.defenseBonus, selectedSkill.properties.defenseBonus + 1);
    assert.equal(applied.durationMs, selectedSkill.properties.durationMs);
    const retaliation = sessionEvents.find(({ type, source }) => type === 'world-player-damaged' && source === 'player-retaliation');
    assert.equal(retaliation.effectiveDefense, retaliation.baseDefense + applied.defenseBonus);
    assert.equal(retaliation.damage, Math.max(0, 80 - retaliation.effectiveDefense));
    assert.ok(retaliation.damage < Math.max(0, 80 - retaliation.baseDefense), 'active guard must reduce damage compared with no buff');
  }
  assert.equal(sessionEvents.filter((event) => event.type === 'world-monster-damaged').length, healScenario ? 0 : expectedSkillCount);
  assert.equal(serverEvents.find(({ type }) => type === 'world-skill-rejected').reason, 'skill-not-learned');
  const attributeEvent = serverEvents.find(({ type }) => type === 'world-attribute-point-spent');
  assert.equal(attributeEvent.attribute, selectedSkill.properties.scalingAttribute);
  assert.equal(attributeEvent.availablePoints, 4);
  assert.equal(attributeEvent.allocated, 1);
  const equipmentEvents = serverEvents.filter(({ type }) => type === 'world-equipment-changed');
  assert.equal(equipmentEvents.length, 2);
  assert.deepEqual(
    equipmentEvents.map(({ equipmentSlot, inventorySlot, clientItemId, attackDamageBonus, defenseBonus }) => ({
      equipmentSlot, inventorySlot, clientItemId, attackDamageBonus, defenseBonus,
    })),
    itemizedEquipmentMode
      ? [
          { equipmentSlot: 0, inventorySlot: 0, clientItemId: 8001, attackDamageBonus: 3, defenseBonus: 0 },
          { equipmentSlot: 2, inventorySlot: 1, clientItemId: 8006, attackDamageBonus: 3, defenseBonus: equipmentDefenseBonus },
        ]
      : [
          { equipmentSlot: 0, inventorySlot: 0, clientItemId: 7001, attackDamageBonus: 5, defenseBonus: 0 },
          { equipmentSlot: 2, inventorySlot: 1, clientItemId: 7002, attackDamageBonus: 5, defenseBonus: 2 },
        ],
  );
  assert.deepEqual(accountStore.listCharacterEquipment('a'.repeat(12), 0), itemizedEquipmentMode
    ? [
        { equipmentSlot: 0, inventorySlot: 0, catalogItemId: 'caracatoa-ferro-votivo', stackCount: 1 },
        { equipmentSlot: 2, inventorySlot: 1, catalogItemId: 'caracatoa-peitoral-de-cobre', stackCount: 1 },
      ]
    : [
      { equipmentSlot: 0, inventorySlot: 0, catalogItemId: 'caracatoa-lamina-de-treino', stackCount: 1 },
      { equipmentSlot: 2, inventorySlot: 1, catalogItemId: 'caracatoa-manto-de-linho', stackCount: 1 },
      ]);
  if (itemizedEquipmentMode) {
    const itemInstances = accountStore.getCharacterItemizationDetails('a'.repeat(12), 0);
    assert.deepEqual(itemInstances.map(({ slot, catalogItemId }) => ({ slot, catalogItemId })), [
      { slot: 0, catalogItemId: 'caracatoa-ferro-votivo' },
      { slot: 1, catalogItemId: 'caracatoa-peitoral-de-cobre' },
    ]);
  }
  const skillEvents = serverEvents.filter(({ type }) => type === 'world-skill-learned');
  assert.deepEqual(skillEvents.map(({ skillId, availablePoints }) => ({ skillId, availablePoints })),
    classId === 1 && !healScenario
      ? [{ skillId: 25, availablePoints: 0 }, { skillId: 26, availablePoints: 0 }]
      : [{ skillId: selectedSkill.properties.clientSkillId, availablePoints: 0 }]);
  const skillState = accountStore.getCharacterSkillState('a'.repeat(12), 0);
  assert.equal(skillState.level, classId === 1 && !healScenario ? 2 : 1);
  assert.equal(skillState.availablePoints, 0);
  assert.deepEqual(skillState.learned,
    classId === 1 && !healScenario
      ? [
          { catalogSkillId: 'caracatoa-corte', clientSkillId: 25 },
          { catalogSkillId: 'caracatoa-impacto-celeste', clientSkillId: 26 },
        ]
      : [{ catalogSkillId: selectedSkill.id, clientSkillId: selectedSkill.properties.clientSkillId }]);
  const moveEvent = serverEvents.find(({ type }) => type === 'world-move-accepted');
  assert.deepEqual(moveEvent.from, { x: 321, y: 123 });
  assert.deepEqual(moveEvent.to, { x: 322, y: 123 });
  const manaEvents = serverEvents.filter(({ type }) => type === 'world-skill-mana-spent');
  assert.deepEqual(manaEvents.map(({ skillId, manaSpent, currentMp }) => ({ skillId, manaSpent, currentMp })),
    classId === 1 && !healScenario
      ? [{ skillId: 25, manaSpent: 7, currentMp: 93 }, { skillId: 26, manaSpent: 12, currentMp: 81 }]
      : [{ skillId: selectedSkill.properties.clientSkillId, manaSpent: selectedSkill.properties.manaCost, currentMp: 100 - selectedSkill.properties.manaCost }]);
  if (healScenario) {
    const healEvent = serverEvents.find(({ type }) => type === 'world-skill-heal-applied');
    assert.equal(accountStore.getCharacterBySlot('a'.repeat(12), 0).currentHp, healEvent.currentHp);
    assert.equal(accountStore.getCharacterBySlot('a'.repeat(12), 0).currentMp, 100 - selectedSkill.properties.manaCost);
  }
  const damageEvents = serverEvents.filter(({ type }) => type === 'world-monster-damaged');
  assert.deepEqual(damageEvents.map(({ monsterEntityId, damage, currentHp }) => ({ monsterEntityId, damage, currentHp })),
    healScenario
      ? []
      : defenseScenario
      ? [{ monsterEntityId: SYNTHETIC_MONSTER_ID, damage: 10 + equipmentAttackBonus, currentHp: 10_000 - (10 + equipmentAttackBonus) }]
      : classId === 1
      ? [{ monsterEntityId: SYNTHETIC_MONSTER_ID, damage: Math.min(17, classSkillDamage), currentHp: Math.max(0, 17 - classSkillDamage) }, { monsterEntityId: 0x4568, damage: 25, currentHp: 25 }]
      : [{ monsterEntityId: SYNTHETIC_MONSTER_ID, damage: classSkillDamage, currentHp: 100 - classSkillDamage }]);
  assert.match(trace, /SESSION_TEST_WORLD_ENTRY_PASS/);
  assert.match(trace, /SESSION_TEST_MOUNT_SNAPSHOT_PASS/);
  assert.match(trace, /SESSION_TEST_STAGE_SNAPSHOT_PASS/);
  assert.match(trace, /SESSION_TEST_ATTRIBUTE_PASS/);
  assert.match(trace, /SESSION_TEST_SKILL_LEARN_PASS/);
  assert.match(trace, /SESSION_TEST_MOVE_PASS/);
  if (classId === 1) {
    if (healScenario) {
      assert.match(trace, /SESSION_TEST_SKILL_HEAL_PASS/);
      const healEvent = serverEvents.find(({ type }) => type === 'world-skill-heal-applied');
      assert.equal(healEvent.skillId, 27);
      assert.equal(healEvent.currentHp, 10 + healEvent.healed);
      assert.equal(healEvent.currentHp, accountStore.getCharacterBySlot('a'.repeat(12), 0).currentHp);
      console.log(`PASS Foema curou ${healEvent.healed} HP com ${selectedSkill.properties.manaCost} MP; o SQLite persistiu HP ${healEvent.currentHp}/${healEvent.maxHp} e MP ${100 - selectedSkill.properties.manaCost}, somente em loopback.`);
    } else {
    assert.match(trace, /SESSION_TEST_SKILL_CAST_PASS/);
    assert.match(trace, /SESSION_TEST_LEVEL_UP_PASS/);
    assert.match(trace, /SESSION_TEST_SKILL_CHAIN_LEARN_PASS/);
    assert.match(trace, /SESSION_TEST_SKILL_CHAIN_CAST_PASS/);
    console.log('PASS Foema completou login/PIN, criação, movimento, abate/nível 2, Impacto Celeste persistido e segundo cast, somente em loopback.');
    console.log('PASS Impacto Celeste causou 25 de dano mágico; bônus físicos da arma e armadura não foram aplicados à magia.');
    }
  } else if (defenseScenario) {
    assert.match(trace, /SESSION_TEST_SKILL_DEFENSE_DAMAGE_PASS/);
    const retaliation = sessionEvents.find(({ type, source }) => type === 'world-player-damaged' && source === 'player-retaliation');
    console.log(`PASS TransKnight aplicou +${selectedSkill.properties.defenseBonus + 1} DEF por ${selectedSkill.properties.durationMs / 1000}s; retaliação reduziu o HP em ${retaliation.damage}, somente em loopback.`);
  } else {
    assert.match(trace, /SESSION_TEST_CLASS_SKILL_PASS/);
    console.log(`PASS Classe ${classId} equipou a Lâmina de Treino e o Manto de Linho, aprendeu ${selectedSkill.name}, moveu e causou ${classSkillDamage} de dano com alcance ${selectedSkill.properties.rangeTiles}; mana validada e aprendizado persistido.`);
  }
  console.log('PASS A sessão usou somente conta, personagem e mapa sintéticos em armazenamento temporário; nenhum dado de autenticação foi registrado.');
} finally {
  if (clientProcess && clientProcess.exitCode === null) {
    clientProcess.kill();
    await Promise.race([once(clientProcess, 'exit'), new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))]);
  }
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  accountStore.close();
  await rm(directory, { recursive: true, force: true });
}
