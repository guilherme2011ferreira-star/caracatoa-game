import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { getWyd727StarterCatalogIds } from "./wyd-727-item-catalog.mjs";
import {
  buildWyd727InventorySlotDeltaBody,
  consumeWyd727CatalogItem,
  parseWyd727ItemUseRequest,
} from "./wyd-727-item-use.mjs";

function useBody({
  clientId = 0x1234,
  form = 1,
  slot = 7,
  reserved = 0,
  feedMarker = 0,
  x = 3200,
  y = 3300,
  destinationIndex = 0,
} = {}) {
  const body = Buffer.alloc(32);
  body.writeUInt16LE(0x373, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(form, 8);
  body.writeUInt32LE(slot, 12);
  body.writeUInt32LE(reserved, 16);
  body.writeUInt32LE(feedMarker, 20);
  body.writeInt16LE(x, 24);
  body.writeInt16LE(y, 26);
  body.writeUInt32LE(destinationIndex, 28);
  return body;
}

async function createInventoryFixture(t, { useEffect = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-item-use-"));
  const accountStore = new PlayerAccountStore({
    databasePath: join(directory, "players.sqlite"),
  });
  t.after(async () => {
    accountStore.close();
    await rm(directory, { recursive: true, force: true });
  });
  await accountStore.createAccount("consumertest", "SYNTHPASS", "123456");
  accountStore.createCharacter("consumertest", {
    slot: 0,
    classId: 0,
    name: "Caracatoa",
  });

  const properties = {
    clientItemId: 2346,
    stackCount: 2,
    field04: 7,
    effects: [
      { index: 1, value: 2 },
      { index: 3, value: 4 },
      { index: 5, value: 6 },
    ],
    starter: true,
  };
  if (useEffect) {
    properties.useEffect = {
      kind: "next-basic-attack-damage",
      amount: 10,
    };
  }
  const catalog = {
    schemaVersion: 1,
    kind: "items",
    entries: [
      {
        id: "caracatoa-tonic",
        name: "Tônico de teste",
        description: "Consumível sintético para fixture local.",
        enabled: true,
        properties,
      },
    ],
  };
  return { accountStore, catalog };
}

test("parses the WYDBot 0x373 Form A consumable request", () => {
  assert.deepEqual(parseWyd727ItemUseRequest(useBody()), {
    malformed: false,
    clientId: 0x1234,
    form: 1,
    slot: 7,
    reserved: 0,
    feedMarker: 0,
    position: { x: 3200, y: 3300 },
    destinationIndex: 0,
  });
});

test("keeps signed world coordinates and the highest inventory slot", () => {
  const parsed = parseWyd727ItemUseRequest(
    useBody({ slot: 59, x: -123, y: -32000 }),
  );
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.slot, 59);
  assert.deepEqual(parsed.position, { x: -123, y: -32000 });
});

test("rejects malformed lengths and reserved or unsupported discriminators", () => {
  assert.equal(
    parseWyd727ItemUseRequest(Buffer.alloc(31)).reason,
    "invalid-length",
  );
  assert.equal(parseWyd727ItemUseRequest(useBody({ form: 2 })).malformed, true);
  assert.equal(
    parseWyd727ItemUseRequest(useBody({ slot: 60 })).malformed,
    true,
  );
  assert.equal(
    parseWyd727ItemUseRequest(useBody({ reserved: 1 })).malformed,
    true,
  );
  assert.equal(
    parseWyd727ItemUseRequest(useBody({ feedMarker: 1 })).malformed,
    true,
  );
  assert.equal(
    parseWyd727ItemUseRequest(useBody({ clientId: 0 })).malformed,
    true,
  );
});

test("builds the public 0x182 inventory-slot delta for remaining or empty items", () => {
  const item = {
    clientItemId: 2346,
    stackCount: 2,
    field04: 7,
    effects: [
      { index: 1, value: 2 },
      { index: 3, value: 4 },
      { index: 5, value: 6 },
    ],
  };
  const body = buildWyd727InventorySlotDeltaBody({
    clientId: 0x1234,
    slot: 7,
    item,
  });
  assert.equal(body.length, 24);
  assert.equal(body.readUInt16LE(0), 0x182);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt16LE(8), 1);
  assert.equal(body.readInt16LE(10), 7);
  assert.equal(body.readUInt16LE(12), 2346);
  assert.equal(body.readInt16LE(14), 2);
  assert.equal(body.readUInt16LE(16), 7);
  assert.deepEqual([...body.subarray(18, 24)], [1, 2, 3, 4, 5, 6]);

  const empty = buildWyd727InventorySlotDeltaBody({
    clientId: 0x1234,
    slot: 7,
    item: null,
  });
  assert.deepEqual([...empty.subarray(12)], Array(12).fill(0));
});

test("consumes the persistent stack once, applies the configured effect and removes its empty slot", async (t) => {
  const { accountStore, catalog } = await createInventoryFixture(t);
  const consume = () =>
    consumeWyd727CatalogItem({
      accountStore,
      accountId: "consumertest",
      characterSlot: 0,
      inventorySlot: 0,
      catalog,
    });

  const first = consume();
  assert.deepEqual(first, {
    consumed: true,
    reason: null,
    useEffect: { kind: "next-basic-attack-damage", amount: 10 },
    stackCount: 1,
    item: {
      clientItemId: 2346,
      stackCount: 1,
      field04: 7,
      effects: [
        { index: 1, value: 2 },
        { index: 3, value: 4 },
        { index: 5, value: 6 },
      ],
    },
  });
  assert.deepEqual(
    accountStore.initializeCharacterInventory(
      "consumertest",
      0,
      getWyd727StarterCatalogIds(catalog),
    ),
    [{ slot: 0, catalogItemId: "caracatoa-tonic", stackCount: 1 }],
  );

  assert.deepEqual(
    accountStore.consumeCharacterInventoryItem({
      accountId: "consumertest",
      characterSlot: 0,
      inventorySlot: 0,
      catalogItemId: "caracatoa-tonic",
      expectedStackCount: 2,
    }),
    { consumed: false, stackCount: 1 },
    "a stale replay cannot consume another unit",
  );

  const final = consume();
  assert.equal(final.consumed, true);
  assert.equal(final.stackCount, 0);
  assert.equal(final.item, null);
  assert.deepEqual(consume(), {
    consumed: false,
    reason: "empty-slot",
    item: null,
  });
  assert.deepEqual(
    accountStore.initializeCharacterInventory(
      "consumertest",
      0,
      getWyd727StarterCatalogIds(catalog),
    ),
    [],
  );
});

test("refuses an ordinary catalog item without changing its stack", async (t) => {
  const { accountStore, catalog } = await createInventoryFixture(t, {
    useEffect: false,
  });
  assert.deepEqual(
    consumeWyd727CatalogItem({
      accountStore,
      accountId: "consumertest",
      characterSlot: 0,
      inventorySlot: 0,
      catalog,
    }),
    {
      consumed: false,
      reason: "item-not-usable",
      item: {
        clientItemId: 2346,
        stackCount: 2,
        field04: 7,
        effects: [
          { index: 1, value: 2 },
          { index: 3, value: 4 },
          { index: 5, value: 6 },
        ],
      },
    },
  );
  assert.deepEqual(
    accountStore.initializeCharacterInventory(
      "consumertest",
      0,
      getWyd727StarterCatalogIds(catalog),
    ),
    [{ slot: 0, catalogItemId: "caracatoa-tonic", stackCount: 2 }],
  );
});
