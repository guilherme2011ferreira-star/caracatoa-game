import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCaracatoaNativeWalkability } from "./caracatoa-native-navigation.mjs";
import {
  buildCaracatoaTradeRequestBody,
  parseCaracatoaTradeStateBody,
} from "./caracatoa-trade-protocol.mjs";
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

function sendTrade(socket, clientId, request, sequence) {
  sendBody(socket, buildCaracatoaTradeRequestBody({
    clientId,
    timestamp: 1000 + sequence,
    ...request,
  }), sequence & 0xff);
}

function sendMove(socket, clientId, from, directionCode, deltaX, deltaY, steps, sequence) {
  const body = Buffer.alloc(48);
  body.writeUInt16LE(0x36c, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(2000 + sequence, 4);
  body.writeInt16LE(from.x, 8);
  body.writeInt16LE(from.y, 10);
  body.writeUInt32LE(0, 12);
  body.writeUInt32LE(3, 16);
  for (let index = 0; index < steps; index += 1) body.writeUInt8(directionCode, 20 + index);
  body.writeInt16LE(from.x + deltaX * steps, 44);
  body.writeInt16LE(from.y + deltaY * steps, 46);
  sendBody(socket, body, sequence & 0xff);
}

async function nextTrade(reader) {
  const parsed = parseCaracatoaTradeStateBody((await reader.next(0x7f21)).body);
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

test("duas sessões trocam item e gold; movimento fora de alcance e desconexão cancelam convites", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-trade-gameplay-"));
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
    now: () => 1000,
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

  await store.createAccount("tradealpha", "ALPHAPASS", "135790");
  await store.createAccount("tradebeta", "BETAPASS", "246810");
  store.createCharacter("tradealpha", { slot: 0, classId: 0, name: "TraderAlpha" });
  store.createCharacter("tradebeta", { slot: 0, classId: 1, name: "TraderBeta" });
  seedGold(databasePath, { tradealpha: 100, tradebeta: 25 });

  const port = await listen(listener);
  const alphaSocket = createConnection({ host: "127.0.0.1", port });
  sockets.push(alphaSocket);
  await once(alphaSocket, "connect");
  const alphaReader = frameReader(alphaSocket);
  const alpha = await enterWorld({ socket: alphaSocket, reader: alphaReader, accountId: "tradealpha", password: "ALPHAPASS", pin: "135790" });
  const betaSocket = createConnection({ host: "127.0.0.1", port });
  sockets.push(betaSocket);
  await once(betaSocket, "connect");
  const betaReader = frameReader(betaSocket);
  const beta = await enterWorld({ socket: betaSocket, reader: betaReader, accountId: "tradebeta", password: "BETAPASS", pin: "246810" });
  assert.deepEqual(alpha.position, beta.position);

  sendTrade(alphaSocket, alpha.clientId, { action: "invite", targetName: "TraderBeta" }, 1);
  const [alphaInvite, betaInvite] = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  const tradeId = alphaInvite.trade.tradeId;
  assert.equal(alphaInvite.status, "invited");
  assert.equal(betaInvite.trade.incoming, true);
  assert.equal(betaInvite.trade.partnerName, "TraderAlpha");

  sendTrade(betaSocket, beta.clientId, { action: "accept", tradeId }, 2);
  const accepted = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  assert.equal(accepted[0].trade.state, "offering");
  assert.equal(accepted[1].trade.revision, 1);

  const initialAlpha = store.initializeCharacterInventory("tradealpha", 0, getWyd727StarterInventoryItems(itemCatalog));
  const initialBeta = store.initializeCharacterInventory("tradebeta", 0, getWyd727StarterInventoryItems(itemCatalog));
  const alphaOfferedItem = initialAlpha.find((item) => item.slot === 0).catalogItemId;
  const betaOfferedItem = initialBeta.find((item) => item.slot === 1).catalogItemId;

  sendTrade(alphaSocket, alpha.clientId, { action: "offer", tradeId, inventorySlot: 0, gold: 40 }, 3);
  const alphaOfferUpdate = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  assert.equal(alphaOfferUpdate[0].trade.revision, 2);
  assert.equal(alphaOfferUpdate[1].trade.partnerOffer.itemClientId, 7001);

  sendTrade(betaSocket, beta.clientId, { action: "offer", tradeId, inventorySlot: 1, gold: 5 }, 4);
  const betaOfferUpdate = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  assert.equal(betaOfferUpdate[0].trade.revision, 3);
  assert.equal(betaOfferUpdate[1].trade.selfOffer.itemClientId, 7002);
  assert.equal(betaOfferUpdate[1].trade.selfOffer.ready, false);

  sendTrade(alphaSocket, alpha.clientId, { action: "ready", tradeId, revision: 2 }, 5);
  const staleConfirmation = await nextTrade(alphaReader);
  assert.equal(staleConfirmation.status, "rejected");
  assert.equal(staleConfirmation.trade.revision, 3);

  sendTrade(alphaSocket, alpha.clientId, { action: "ready", tradeId, revision: 3 }, 6);
  const firstConfirmation = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  assert.equal(firstConfirmation[0].status, "offering");
  assert.equal(firstConfirmation[1].trade.selfOffer.ready, false);

  sendTrade(betaSocket, beta.clientId, { action: "ready", tradeId, revision: 3 }, 7);
  const committed = await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  assert.equal(committed[0].status, "committed");
  assert.equal(committed[0].goldBalance, 65);
  assert.equal(committed[1].goldBalance, 60);
  const [alphaInventoryDeltas, betaInventoryDeltas] = await Promise.all([
    Promise.all(Array.from({ length: 60 }, () => alphaReader.next(0x182))),
    Promise.all(Array.from({ length: 60 }, () => betaReader.next(0x182))),
  ]);
  assert.equal(alphaInventoryDeltas.length, 60);
  assert.equal(betaInventoryDeltas.length, 60);
  assert.ok(alphaInventoryDeltas.every((frame) => frame.body.readInt16LE(10) >= 0 && frame.body.readInt16LE(10) < 60));
  assert.equal(store.getCharacterBySlot("tradealpha", 0).gold, 65);
  assert.equal(store.getCharacterBySlot("tradebeta", 0).gold, 60);
  const alphaInventory = store.initializeCharacterInventory("tradealpha", 0, getWyd727StarterInventoryItems(itemCatalog));
  const betaInventory = store.initializeCharacterInventory("tradebeta", 0, getWyd727StarterInventoryItems(itemCatalog));
  assert.ok(alphaInventory.some((item) => item.catalogItemId === betaOfferedItem));
  assert.ok(betaInventory.some((item) => item.catalogItemId === alphaOfferedItem));
  const auditDatabase = new DatabaseSync(databasePath);
  try {
    assert.equal(auditDatabase.prepare("SELECT count(*) AS count FROM itemization_audit_events WHERE action='trade' AND source_id=?").get(tradeId).count, 2);
  } finally {
    auditDatabase.close();
  }

  sendTrade(alphaSocket, alpha.clientId, { action: "invite", targetName: "TraderBeta" }, 8);
  await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  sendMove(alphaSocket, alpha.clientId, alpha.position, 0x36, 1, 0, 6, 9);
  const [moveResponse, [alphaRangeEnded, betaRangeEnded]] = await Promise.all([
    alphaReader.next(0x366),
    Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]),
  ]);
  assert.equal(moveResponse.body.readInt16LE(44), alpha.position.x + 6);
  assert.equal(alphaRangeEnded.status, "cancelled");
  assert.equal(betaRangeEnded.status, "cancelled");
  assert.match(alphaRangeEnded.message, /afastaram/i);

  sendMove(alphaSocket, alpha.clientId, { x: alpha.position.x + 6, y: alpha.position.y }, 0x34, -1, 0, 6, 10);
  const returnedMove = await alphaReader.next(0x366);
  assert.equal(returnedMove.body.readInt16LE(44), alpha.position.x);
  sendTrade(alphaSocket, alpha.clientId, { action: "invite", targetName: "TraderBeta" }, 11);
  await Promise.all([nextTrade(alphaReader), nextTrade(betaReader)]);
  const betaClosed = once(betaSocket, "close");
  betaSocket.destroy();
  await Promise.race([betaClosed, new Promise((resolve) => setTimeout(resolve, 1000))]);
  const disconnected = await nextTrade(alphaReader);
  assert.equal(disconnected.status, "cancelled");
  assert.match(disconnected.message, /desconectou/i);
});
