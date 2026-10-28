import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCaracatoaNativeWalkability } from "./caracatoa-native-navigation.mjs";
import {
  buildCaracatoaPlayerShopRequestBody,
  parseCaracatoaPlayerShopStateBody,
} from "./caracatoa-player-shop-protocol.mjs";
import { getCaracatoaMap, pointInWorldRect } from "./caracatoa-world-catalog.mjs";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { createLocalGameListener } from "./game-listener.mjs";
import { clientHandshake, decodeFrame, encodeFrame } from "./protocol.mjs";
import { getWyd727StarterInventoryItems, resolveWyd727InventoryItems } from "./wyd-727-item-catalog.mjs";
import { DEFAULT_WYD727_CLASS_CATALOG, getWyd727ClassEntry } from "./wyd-727-class-catalog.mjs";
import { computeWyd727ClineVersion } from "./wyd-727-character-entry.mjs";

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
    next(opcode, timeoutMs = 4000) {
      const index = frames.findIndex((entry) => entry.body.readUInt16LE(0) === opcode);
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { opcode, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`timeout waiting for opcode 0x${opcode.toString(16)}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

function loginBody(opcode, byteLength) {
  const body = Buffer.alloc(byteLength - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  return body;
}

function sendBody(socket, body, sequence) {
  socket.write(encodeFrame(body, sequence));
}

async function enterWorld({ socket, reader, accountId, password, pin }) {
  const login = loginBody(0x20d, 124);
  Buffer.from(password, "ascii").copy(login, 8);
  Buffer.from(accountId, "ascii").copy(login, 20);
  socket.write(Buffer.concat([clientHandshake(), encodeFrame(login, 0x31)]));
  const loginReply = await reader.next(0x10a);
  const clientId = loginReply.body.readUInt16LE(2);
  const token = loginBody(0xfde, 32);
  Buffer.from(pin, "ascii").copy(token, 8);
  sendBody(socket, token, loginReply.body[8] ^ 0xff);
  await reader.next(0xfde);
  await reader.next(0x110);
  const enter = loginBody(0x213, 36);
  enter.writeUInt16LE(clientId, 2);
  enter.writeInt32LE(0, 8);
  enter.writeUInt32LE(computeWyd727ClineVersion(1), 16);
  sendBody(socket, enter, 0x33);
  const world = await reader.next(0x114);
  return { clientId, position: { x: world.body.readInt16LE(8), y: world.body.readInt16LE(10) } };
}

function sendShop(socket, clientId, request, sequence) {
  sendBody(socket, buildCaracatoaPlayerShopRequestBody({
    clientId,
    timestamp: Date.now() >>> 0,
    ...request,
  }), sequence & 0xff);
}

async function nextShop(reader) {
  const parsed = parseCaracatoaPlayerShopStateBody((await reader.next(0x7f23)).body);
  assert.equal(parsed.malformed, false, parsed.reason);
  return parsed;
}

function seedGold(databasePath, values) {
  const database = new DatabaseSync(databasePath);
  try {
    for (const [accountId, gold] of Object.entries(values)) {
      database.prepare("UPDATE player_characters SET gold = ? WHERE account_id = ? AND slot = 0")
        .run(gold, accountId);
    }
  } finally {
    database.close();
  }
}

test("compradora consulta e compra anúncio depois que a vendedora desconecta", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-shop-gameplay-"));
  const databasePath = join(directory, "players.sqlite");
  const store = new PlayerAccountStore({ databasePath });
  const itemCatalog = JSON.parse(await readFile(new URL("./data/catalogs/items.json", import.meta.url), "utf8"));
  const navigationCatalog = JSON.parse(await readFile(new URL("./data/world/navigation.json", import.meta.url), "utf8"));
  const worldCatalog = JSON.parse(await readFile(new URL("./data/world/maps.json", import.meta.url), "utf8"));
  const map = getCaracatoaMap(worldCatalog, 1);
  const walkability = createCaracatoaNativeWalkability(navigationCatalog, map.mapId, map.bounds);
  const listener = createLocalGameListener({
    accountStore: store,
    characterStore: store,
    idleTimeoutMs: 0,
    worldStartPosition: { x: map.entry[0], y: map.entry[1] },
    walkability,
    isPlayablePosition: (x, y) => pointInWorldRect([x, y], map.bounds),
    async getClassDefinition(classId) { return getWyd727ClassEntry(DEFAULT_WYD727_CLASS_CATALOG, classId); },
    async getCharacterSkills() { return []; },
    async getWorldMonsterBodies() { return []; },
    async getCharacterEquipment() { return []; },
    async getCharacterInventory(accountId, slot) {
      const inventory = store.initializeCharacterInventory(accountId, slot, getWyd727StarterInventoryItems(itemCatalog));
      assert.ok(inventory);
      return resolveWyd727InventoryItems(inventory, itemCatalog);
    },
  });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) {
      if (!socket.destroyed) {
        const closed = once(socket, "close");
        socket.destroy();
        await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
      }
    }
    if (listener.listening) await new Promise((resolve) => listener.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  await store.createAccount("shopalpha", "ALPHAPASS", "135790");
  await store.createAccount("shopbeta", "BETAPASS", "246810");
  store.createCharacter("shopalpha", { slot: 0, classId: 0, name: "LojaAlpha" });
  store.createCharacter("shopbeta", { slot: 0, classId: 1, name: "LojaBeta" });
  store.initializeCharacterInventory("shopalpha", 0, getWyd727StarterInventoryItems(itemCatalog));
  const itemInstanceId = randomUUID();
  const seedResult = store.awardCharacterItemizationLoot({
    accountId: "shopalpha",
    characterSlot: 0,
    lootEventId: "market-fixture:bronze-armor",
    now: Date.now(),
    drops: [{
      kind: "equipment",
      catalogItemId: "caracatoa-bronze-couraca-elos-da-sentinela",
      clientItemId: 8221,
      instanceId: itemInstanceId,
      rarity: "mystic",
      itemLevel: 1,
      baseStats: { physicalDamage: 0, magicAttack: 0, physicalDefense: 5, maxHp: 10, maxMp: 0 },
      affixes: [{
        clientAffixId: 1,
        id: "market-fixture-defense",
        stat: "physicalDefenseFlat",
        value: 2,
        valueUnit: "flat",
      }],
    }],
  });
  assert.equal(seedResult.granted, true);
  seedGold(databasePath, { shopalpha: 50, shopbeta: 5000 });

  const port = await listen(listener);
  const alphaSocket = createConnection({ host: "127.0.0.1", port });
  sockets.push(alphaSocket);
  await once(alphaSocket, "connect");
  const alphaReader = frameReader(alphaSocket);
  const alpha = await enterWorld({ socket: alphaSocket, reader: alphaReader, accountId: "shopalpha", password: "ALPHAPASS", pin: "135790" });
  const betaSocket = createConnection({ host: "127.0.0.1", port });
  sockets.push(betaSocket);
  await once(betaSocket, "connect");
  const betaReader = frameReader(betaSocket);
  const beta = await enterWorld({ socket: betaSocket, reader: betaReader, accountId: "shopbeta", password: "BETAPASS", pin: "246810" });
  assert.deepEqual(alpha.position, beta.position);

  sendShop(alphaSocket, alpha.clientId, { action: "create", inventorySlot: 4, askingGold: 1200 }, 1);
  const published = await nextShop(alphaReader);
  assert.equal(published.state.status, "ok");
  assert.equal(published.state.listings[0].sellerName, "LojaAlpha");
  assert.equal(published.state.listings[0].clientItemId, 8221);
  assert.equal(published.state.listings[0].own, true);
  const listingId = published.state.listings[0].listingId;

  alphaSocket.end();
  await once(alphaSocket, "close");

  sendShop(betaSocket, beta.clientId, { action: "list" }, 2);
  const market = await nextShop(betaReader);
  assert.equal(market.state.status, "ok");
  assert.equal(market.state.listings[0].listingId, listingId);
  assert.equal(market.state.listings[0].own, false);

  sendShop(betaSocket, beta.clientId, { action: "buy", listingId, requestId: "00000000-0000-4000-8000-000000000099" }, 3);
  const buyerResult = await nextShop(betaReader);
  assert.equal(buyerResult.state.status, "ok");
  assert.equal(buyerResult.state.receipt.askingGold, 1200);
  assert.equal(buyerResult.state.receipt.buyerGoldBalance, 3800);
  const buyerDeltas = await Promise.all(Array.from({ length: 60 }, () => betaReader.next(0x182)));
  assert.equal(buyerDeltas.length, 60);
  assert.equal(store.getCharacterBySlot("shopalpha", 0).gold, 1250);
  assert.equal(store.getCharacterBySlot("shopbeta", 0).gold, 3800);
  const buyerItemization = store.getCharacterItemizationDetails("shopbeta", 0);
  assert.equal(buyerItemization.length, 1);
  assert.equal(buyerItemization[0].slot, 4);
  assert.equal(buyerItemization[0].instanceId, itemInstanceId);
  assert.equal(buyerItemization[0].instanceId, buyerResult.state.receipt.itemInstanceId);
  assert.equal(store.listPlayerShopListings("shopalpha", { characterSlot: 0, view: "mine" }).listings.length, 0);
});
