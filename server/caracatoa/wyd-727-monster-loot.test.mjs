import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WYD727_CLASS_WORLD_STATS } from "./wyd-727-class-catalog.mjs";
import { awardWyd727MonsterLoot } from "./wyd-727-monster-loot.mjs";

const itemCatalog = {
  schemaVersion: 1,
  kind: "items",
  entries: [
    {
      id: "demo-tonico",
      name: "Tônico Caracatoa",
      description: "Item sintético de teste.",
      enabled: true,
      properties: {
        clientItemId: 2345,
        stackCount: 3,
        field04: 7,
        effects: [
          { index: 1, value: 2 },
          { index: 3, value: 4 },
          { index: 5, value: 6 },
        ],
        starter: true,
      },
    },
  ],
};

const monsterCatalog = {
  schemaVersion: 1,
  kind: "monsters",
  entries: [
    {
      id: "alvo-teste",
      name: "Alvo_01",
      description: "Monstro sintético de teste.",
      enabled: true,
      properties: {
        clientEntityId: 60000,
        equipModelIds: [5001, ...Array(15).fill(0)],
        spawnPosition: { x: 10, y: 10 },
        level: 1,
        startingStats: {
          ...DEFAULT_WYD727_CLASS_WORLD_STATS,
          maxHp: 30,
          currentHp: 30,
        },
        drop: {
          catalogItemId: "demo-tonico",
          quantity: 2,
          chanceBasisPoints: 10_000,
        },
      },
    },
  ],
};

test("resolves a configured drop and awards the persisted slot snapshot", () => {
  const calls = [];
  const result = awardWyd727MonsterLoot({
    accountStore: {
      awardCharacterInventoryItem(input) {
        calls.push(input);
        return {
          granted: true,
          slots: [
            {
              slot: 4,
              catalogItemId: "demo-tonico",
              stackCount: 5,
            },
          ],
        };
      },
    },
    accountId: "player01",
    characterSlot: 2,
    monsterEntityId: 60000,
    monsterCatalog,
    itemCatalog,
    random: () => 0.9999,
  });

  assert.deepEqual(calls, [
    {
      accountId: "player01",
      characterSlot: 2,
      catalogItemId: "demo-tonico",
      quantity: 2,
      baseStackCount: 3,
    },
  ]);
  assert.deepEqual(result, {
    awarded: true,
    catalogItemId: "demo-tonico",
    quantity: 2,
    slots: [
      {
        slot: 4,
        clientItemId: 2345,
        stackCount: 5,
        field04: 7,
        effects: [
          { index: 1, value: 2 },
          { index: 3, value: 4 },
          { index: 5, value: 6 },
        ],
        starter: true,
      },
    ],
  });
});

test("a missed loot roll leaves the inventory untouched", () => {
  let awards = 0;
  const monster = structuredClone(monsterCatalog.entries[0]);
  monster.properties.drop.chanceBasisPoints = 1;
  assert.deepEqual(
    awardWyd727MonsterLoot({
      accountStore: {
        awardCharacterInventoryItem() {
          awards += 1;
          return null;
        },
      },
      accountId: "player01",
      characterSlot: 2,
      monsterEntityId: 60000,
      monsterCatalog: { ...monsterCatalog, entries: [monster] },
      itemCatalog,
      random: () => 0.5,
    }),
    { awarded: false, reason: "chance-missed" },
  );
  assert.equal(awards, 0);
});

test("rejects a drop whose item is missing or disabled", () => {
  const disabled = structuredClone(itemCatalog);
  disabled.entries[0].enabled = false;
  assert.throws(
    () =>
      awardWyd727MonsterLoot({
        accountStore: { awardCharacterInventoryItem: () => null },
        accountId: "player01",
        characterSlot: 2,
        monsterEntityId: 60000,
        monsterCatalog,
        itemCatalog: disabled,
        random: () => 0,
      }),
    /Item habilitado demo-tonico do drop não existe/,
  );
});
