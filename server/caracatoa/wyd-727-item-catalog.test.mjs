import assert from "node:assert/strict";
import test from "node:test";
import {
  getWyd727InventoryAttackDamageBonus,
  getWyd727StarterCatalogIds,
  getWyd727StarterInventoryItems,
  resolveWyd727InventoryItems,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";

const ITEM = {
  id: "caracatoa-potion",
  name: "Poção de teste",
  description: "Fixture sem asset proprietário.",
  enabled: true,
  properties: {
    clientItemId: 1234,
    stackCount: 5,
    field04: 7,
    effects: [
      { index: 1, value: 2 },
      { index: 3, value: 4 },
      { index: 5, value: 6 },
    ],
    starter: true,
  },
};

function catalog(entries = [structuredClone(ITEM)]) {
  return { schemaVersion: 1, kind: "items", entries };
}

test("validates client item fields, sorts starter IDs and resolves persisted slots", () => {
  const second = structuredClone(ITEM);
  second.id = "a-small-potion";
  second.properties.clientItemId = 4321;
  const data = catalog([structuredClone(ITEM), second]);
  assert.equal(validateWyd727ItemCatalog(data), data);
  assert.deepEqual(getWyd727StarterCatalogIds(data), [
    "a-small-potion",
    "caracatoa-potion",
  ]);
  assert.deepEqual(getWyd727StarterInventoryItems(data), [
    { catalogItemId: "a-small-potion", stackCount: 5 },
    { catalogItemId: "caracatoa-potion", stackCount: 5 },
  ]);
  assert.deepEqual(
    resolveWyd727InventoryItems([{ slot: 2, catalogItemId: ITEM.id }], data),
    [{ slot: 2, ...ITEM.properties }],
  );
});

test("rejects client ID collisions, malformed effects and more than 60 starters", () => {
  const duplicate = structuredClone(ITEM);
  duplicate.id = "other-item";
  assert.throws(() => validateWyd727ItemCatalog(catalog([ITEM, duplicate])));

  const malformed = structuredClone(ITEM);
  malformed.properties.effects.pop();
  assert.throws(() => validateWyd727ItemCatalog(catalog([malformed])));

  const tooMany = Array.from({ length: 61 }, (_, index) => ({
    ...structuredClone(ITEM),
    id: `item-${index}`,
    properties: {
      ...structuredClone(ITEM.properties),
      clientItemId: index + 1,
    },
  }));
  assert.throws(() => validateWyd727ItemCatalog(catalog(tooMany)));
});

test("does not resolve missing definitions or duplicate persisted slots", () => {
  assert.throws(() =>
    resolveWyd727InventoryItems(
      [{ slot: 0, catalogItemId: "missing" }],
      catalog(),
    ),
  );
  assert.throws(() =>
    resolveWyd727InventoryItems(
      [
        { slot: 0, catalogItemId: ITEM.id },
        { slot: 0, catalogItemId: ITEM.id },
      ],
      catalog(),
    ),
  );
});

test("validates and totals Caracatoa attack bonuses from persistent inventory slots", () => {
  const charm = structuredClone(ITEM);
  charm.id = "caracatoa-attack-charm";
  charm.properties.clientItemId = 2345;
  charm.properties.stackCount = 1;
  charm.properties.combatEffect = {
    kind: "flat-attack-damage",
    amount: 5,
  };
  const secondCharm = structuredClone(charm);
  secondCharm.id = "caracatoa-second-charm";
  secondCharm.properties.clientItemId = 2346;
  secondCharm.properties.combatEffect.amount = 7;
  const data = catalog([charm, secondCharm]);
  const inventory = resolveWyd727InventoryItems(
    [
      { slot: 3, catalogItemId: charm.id },
      { slot: 4, catalogItemId: secondCharm.id },
    ],
    data,
  );

  assert.equal(getWyd727InventoryAttackDamageBonus(inventory), 12);
  assert.equal(getWyd727InventoryAttackDamageBonus([]), 0);

  const disabledCharm = structuredClone(charm);
  disabledCharm.enabled = false;
  const disabledInventory = resolveWyd727InventoryItems(
    [{ slot: 3, catalogItemId: disabledCharm.id }],
    catalog([disabledCharm]),
  );
  assert.equal(getWyd727InventoryAttackDamageBonus(disabledInventory), 0);
});

test("rejects unsupported attack-effect shapes, values, and stackable charms", () => {
  const charm = structuredClone(ITEM);
  charm.properties.combatEffect = {
    kind: "flat-attack-damage",
    amount: 5,
  };
  assert.throws(() => validateWyd727ItemCatalog(catalog([charm])));

  charm.properties.stackCount = 1;
  charm.properties.combatEffect.kind = "heal";
  assert.throws(() => validateWyd727ItemCatalog(catalog([charm])));
  charm.properties.combatEffect.kind = "flat-attack-damage";
  charm.properties.combatEffect.amount = 1001;
  assert.throws(() => validateWyd727ItemCatalog(catalog([charm])));
  assert.throws(() =>
    getWyd727InventoryAttackDamageBonus([
      {
        slot: 0,
        stackCount: 2,
        combatEffect: {
          kind: "flat-attack-damage",
          amount: 5,
        },
      },
    ]),
  );
});

test("rejects an item that combines a persistent passive effect and a consumable effect", () => {
  const mixedEffects = structuredClone(ITEM);
  mixedEffects.properties.stackCount = 1;
  mixedEffects.properties.combatEffect = {
    kind: "flat-attack-damage",
    amount: 5,
  };
  mixedEffects.properties.useEffect = {
    kind: "next-basic-attack-damage",
    amount: 10,
  };

  assert.throws(() => validateWyd727ItemCatalog(catalog([mixedEffects])));
});
