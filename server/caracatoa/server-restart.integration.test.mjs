import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import test from "node:test";
import { clientHandshake, decodeFrame, encodeFrame } from "./protocol.mjs";
import { computeWyd727ClineVersion } from "./wyd-727-character-entry.mjs";
import { createCaracatoaLocalBackup, restoreCaracatoaLocalBackup } from "./local-state-backup.mjs";
import { buildCaracatoaEquipmentRequest } from "./wyd-727-item-equipment.mjs";
import { buildCaracatoaPlayerShopRequestBody, parseCaracatoaPlayerShopStateBody } from "./caracatoa-player-shop-protocol.mjs";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { getWyd727StarterInventoryItems } from "./wyd-727-item-catalog.mjs";
import {
  CARACATOA_MOUNT_ACTION,
  parseCaracatoaMountStateBody,
  buildCaracatoaMountRequestBody,
} from "./caracatoa-mount-protocol.mjs";

const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const SERVER_PATH = fileURLToPath(new URL("./server.mjs", import.meta.url));
const ADMIN_PASSWORD = "SyntheticRestartAdmin!";
const PLAYER_ID = "restartplayer";
const PLAYER_PASSWORD = "Rstart9Pass";
const PLAYER_PIN = "482691";
const CHARACTER_NAME = "RestartHunt";

async function unusedLoopbackPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function launchServer(directory, port, gamePort) {
  const serverUrl = JSON.stringify(pathToFileURL(SERVER_PATH).href);
  const bootstrap = `
process.once("message", (message) => {
  const signal = message?.signal;
  if (message?.type !== "caracatoa-test-signal" || !["SIGINT", "SIGTERM"].includes(signal)) return;
  process.emit(signal);
  if (process.connected) process.disconnect();
});
await import(${serverUrl});
`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", bootstrap],
    {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      CARACATOA_ADMIN_PASSWORD: ADMIN_PASSWORD,
      CARACATOA_PORT: String(port),
      CARACATOA_GAME_PORT: String(gamePort),
      CARACATOA_DATA_DIR: join(directory, "catalogs"),
      CARACATOA_STATE_DIR: join(directory, "state"),
    },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  return { process: child, output: () => stdout + stderr };
}

async function waitForService(instance, baseUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (instance.process.exitCode !== null) {
      throw new Error(`Servidor encerrou com código ${instance.process.exitCode}.`);
    }
    try {
      const response = await fetch(new URL("/healthz", baseUrl));
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Servidor Caracatoa não iniciou no prazo do teste.\n${instance.output()}`,
  );
}

async function loginAdmin(baseUrl) {
  const response = await fetch(new URL("/api/v1/session", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ id: "admin", password: ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  assert.ok(cookie, "admin login must issue a local session cookie");
  return cookie.split(";", 1)[0];
}

async function adminRequest(baseUrl, cookie, path, { method = "GET", body } = {}) {
  const headers = { Cookie: cookie };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.Origin = baseUrl;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    response,
    payload: response.status === 204 ? null : await response.json(),
  };
}

async function stopServer(instance, { graceful = false, signal = "SIGTERM" } = {}) {
  if (!instance) return null;
  if (
    instance.process.exitCode !== null ||
    instance.process.signalCode !== null
  ) {
    return {
      code: instance.process.exitCode,
      signal: instance.process.signalCode,
    };
  }
  const exited = once(instance.process, "exit").then(([code, signal]) => ({
    code,
    signal,
  }));
  let gracefulMessageSent = false;
  if (graceful && instance.process.connected) {
    gracefulMessageSent = await new Promise((resolve) => {
      instance.process.send({ type: "caracatoa-test-signal", signal }, (error) => {
        resolve(!error);
      });
    });
  }
  if (!gracefulMessageSent) instance.process.kill("SIGTERM");
  let result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  if (result) return result;

  instance.process.kill("SIGTERM");
  result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  if (!result) {
    instance.process.stdout.destroy();
    instance.process.stderr.destroy();
    instance.process.unref();
  }
  return result;
}

function createGameFrameReader(socket) {
  let pending = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  const monsters = new Map();
  const findFrameIndex = (opcode, predicate) => frames.findIndex(
    ({ body }) => body.readUInt16LE(0) === opcode && predicate(body),
  );
  const observeMonster = ({ body }) => {
    const opcode = body.readUInt16LE(0);
    if (opcode === 0x364 && body.length >= 164) {
      const entityId = body.readUInt16LE(12);
      if (entityId !== 0) {
        monsters.set(entityId, {
          entityId,
          position: { x: body.readInt16LE(8), y: body.readInt16LE(10) },
          maxHp: body.readInt32LE(152),
          currentHp: body.readInt32LE(160),
        });
      }
    } else if (opcode === 0x366 && body.length >= 48) {
      const entityId = body.readUInt16LE(2);
      const monster = monsters.get(entityId);
      if (monster) {
        monster.position = { x: body.readInt16LE(44), y: body.readInt16LE(46) };
      }
    } else if (opcode === 0x39d && body.length >= 64) {
      const monster = monsters.get(body.readUInt16LE(56));
      if (monster) {
        monster.currentHp = Math.max(0, monster.currentHp - body.readInt32LE(60));
      }
    }
  };
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt16LE(0);
      if (length < 12 || pending.length < length) break;
      const decoded = decodeFrame(pending.subarray(0, length));
      assert.equal(decoded.ok, true, decoded.error);
      frames.push(decoded.frame);
      observeMonster(decoded.frame);
      pending = pending.subarray(length);
    }
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const frameIndex = findFrameIndex(waiter.opcode, waiter.predicate);
      if (frameIndex < 0) continue;
      clearTimeout(waiter.timer);
      const [frame] = frames.splice(frameIndex, 1);
      waiters.splice(index, 1);
      waiter.resolve(frame);
    }
  });
  function nextMatching(opcode, predicate, timeoutMs) {
    const index = findFrameIndex(opcode, predicate);
    if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { opcode, predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error(`timeout aguardando opcode 0x${opcode.toString(16)}.`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }
  return {
    next(opcode, timeoutMs = 4000) {
      return nextMatching(opcode, () => true, timeoutMs);
    },
    nextMatching(opcode, predicate, timeoutMs = 4000) {
      return nextMatching(opcode, predicate, timeoutMs);
    },
    monster(entityId) {
      const monster = monsters.get(entityId);
      return monster ? structuredClone(monster) : null;
    },
  };
}

function buildBasicAttackRequest({ clientId, source, target, timestamp }) {
  const body = Buffer.alloc(68);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt16LE(source.x, 30);
  body.writeUInt16LE(source.y, 32);
  body.writeUInt16LE(target.x, 34);
  body.writeUInt16LE(target.y, 36);
  body.writeUInt16LE(clientId, 38);
  body.writeUInt8(4, 42);
  body.writeInt16LE(-1, 52);
  body.writeUInt16LE(target.entityId, 56);
  body.writeInt32LE(-2, 60);
  return body;
}

function isAdjacent(first, second) {
  return Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)) === 1;
}

async function waitForAdjacentMonster(reader, entityId, playerPosition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const monster = reader.monster(entityId);
    if (monster && monster.currentHp > 0 && isAdjacent(monster.position, playerPosition)) {
      return monster;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Monstro ${entityId} não chegou a uma casa adjacente no prazo.`);
}

async function defeatMonster(reader, socket, { clientId, entityId, playerPosition, sequence }) {
  let monster = await waitForAdjacentMonster(reader, entityId, playerPosition);
  let timestamp = 0x10203050;
  let nextSequence = sequence;
  while (monster.currentHp > 0) {
    monster = await waitForAdjacentMonster(reader, entityId, playerPosition);
    const request = buildBasicAttackRequest({
      clientId,
      source: playerPosition,
      target: { ...monster.position, entityId },
      timestamp: timestamp++,
    });
    socket.write(encodeFrame(request, nextSequence++ & 0xff));
    const result = await reader.nextMatching(
      0x39d,
      (body) => body.length >= 64 && body.readUInt16LE(56) === entityId,
      5000,
    );
    assert.equal(result.body.readUInt16LE(2), clientId);
    const damage = result.body.readInt32LE(60);
    assert.ok(damage > 0, "servidor deve publicar dano positivo no resultado do ataque");
    assert.equal(reader.monster(entityId).currentHp, Math.max(0, monster.currentHp - damage));
    monster = reader.monster(entityId);
    if (monster.currentHp > 0) await new Promise((resolve) => setTimeout(resolve, 1025));
  }
  return { sequence: nextSequence, currentHp: monster.currentHp };
}

function gameBody(opcode, frameLength) {
  const body = Buffer.alloc(frameLength - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  return body;
}

async function openPlayerSession(
  gamePort,
  sequence,
  { accountId = PLAYER_ID, password = PLAYER_PASSWORD, pin = PLAYER_PIN } = {},
) {
  const socket = createConnection({ host: "127.0.0.1", port: gamePort });
  const reader = createGameFrameReader(socket);
  await once(socket, "connect");

  const login = gameBody(0x20d, 124);
  Buffer.from(password, "ascii").copy(login, 8);
  Buffer.from(accountId, "ascii").copy(login, 20);
  socket.write(Buffer.concat([clientHandshake(), encodeFrame(login, sequence)]));
  const loginReply = await reader.next(0x10a);
  const clientId = loginReply.body.readUInt16LE(2);
  assert.ok(clientId > 0);

  const token = gameBody(0xfde, 32);
  token.writeUInt16LE(clientId, 2);
  Buffer.from(pin, "ascii").copy(token, 8);
  socket.write(encodeFrame(token, loginReply.body[8] ^ 0xff));
  const tokenReply = await reader.next(0xfde);
  assert.equal(tokenReply.body.readUInt16LE(0), 0xfde);
  const roster = await reader.next(0x110);
  return { socket, reader, clientId, roster };
}

function enterCharacter(clientId, slot, sequence) {
  const body = gameBody(0x213, 36);
  body.writeUInt16LE(clientId, 2);
  body.writeInt32LE(slot, 8);
  body.writeUInt32LE(computeWyd727ClineVersion(1), 16);
  return encodeFrame(body, sequence);
}

async function closeSocket(socket) {
  if (socket.destroyed) return;
  const closed = once(socket, "close");
  socket.destroy();
  await closed;
}

test("account and gameplay state survive backup restoration and a full server restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-server-restart-"));
  const initialRoot = join(directory, "initial");
  const catalogs = join(initialRoot, "catalogs");
  await cp(fileURLToPath(new URL("./data/catalogs/", import.meta.url)), catalogs, {
    recursive: true,
  });
  const itemizationPath = join(catalogs, "itemization.json");
  const itemization = JSON.parse(await readFile(itemizationPath, "utf8"));
  const guaranteedTestDrop = itemization.lootTables["field-common"].entries[0];
  guaranteedTestDrop.baseChanceBps = 10_000;
  guaranteedTestDrop.minCount = 1;
  guaranteedTestDrop.maxCount = 1;
  await writeFile(itemizationPath, `${JSON.stringify(itemization, null, 2)}\n`);

  const port = await unusedLoopbackPort();
  let gamePort = await unusedLoopbackPort();
  while (gamePort === port) gamePort = await unusedLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let instance = launchServer(initialRoot, port, gamePort);
  let gameSocket = null;
  const instances = [instance];

  t.after(async () => {
    await closeSocket(gameSocket).catch(() => {});
    await stopServer(instance, { graceful: true });
    await rm(directory, { recursive: true, force: true });
    const output = instances.map((entry) => entry.output()).join("\n");
    for (const secret of [ADMIN_PASSWORD, PLAYER_PASSWORD, PLAYER_PIN]) {
      assert.equal(output.includes(secret), false, "logs must not contain credentials");
    }
  });

  await waitForService(instance, baseUrl);
  const registration = await fetch(new URL("/api/v1/player-registration", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: PLAYER_ID,
      password: PLAYER_PASSWORD,
      token: PLAYER_PIN,
    }),
  });
  assert.equal(registration.status, 201);
  await registration.arrayBuffer();

  const firstSession = await openPlayerSession(gamePort, 0x61);
  gameSocket = firstSession.socket;
  assert.equal(firstSession.roster.body.readUInt16LE(0), 0x110);
  const create = gameBody(0x7f00, 36);
  create.writeUInt16LE(firstSession.clientId, 2);
  create.writeUInt16LE(1, 8);
  create.writeUInt8(0, 10);
  create.writeUInt8(3, 11);
  const name = Buffer.from(CHARACTER_NAME, "ascii");
  create.writeUInt8(name.length, 12);
  name.copy(create, 14);
  gameSocket.write(encodeFrame(create, 0x62));
  const created = await firstSession.reader.next(0x7f01);
  assert.equal(created.body.readUInt8(9), 0);
  const populatedRoster = await firstSession.reader.next(0x110);
  assert.equal(
    populatedRoster.body.subarray(28, 44).toString("ascii").replace(/\0.*$/s, ""),
    CHARACTER_NAME,
  );

  gameSocket.write(enterCharacter(firstSession.clientId, 0, 0x63));
  const firstWorld = await firstSession.reader.next(0x114);
  assert.equal(
    firstWorld.body.subarray(12, 28).toString("ascii").replace(/\0.*$/s, ""),
    CHARACTER_NAME,
  );
  assert.deepEqual(
    { x: firstWorld.body.readInt16LE(8), y: firstWorld.body.readInt16LE(10) },
    { x: 128, y: 128 },
  );
  assert.equal(firstWorld.body.readUInt16LE(368), 7001, "0x114 contains the starter blade in inventory slot 0");
  assert.equal(firstWorld.body.readUInt16LE(380), 7002, "0x114 contains the starter mantle in inventory slot 1");
  assert.equal(firstWorld.body.readUInt16LE(404), 8101, "0x114 contains the starter ration in inventory slot 3");
  assert.equal(firstWorld.body.readInt16LE(406), 1);
  const firstProgression = await firstSession.reader.next(0x7f02);
  assert.equal(firstProgression.body.readBigInt64LE(16), 0n, "new character starts without monster EXP");

  const initialAttributes = (await firstSession.reader.next(0x7f04)).body;
  assert.equal(initialAttributes.readUInt8(9), 3, "world entry sends an attribute snapshot");
  const initialStrength = initialAttributes.readUInt16LE(16);
  const allocation = Buffer.alloc(16);
  allocation.writeUInt16LE(0x7f03, 0);
  allocation.writeUInt16LE(firstSession.clientId, 2);
  allocation.writeUInt32LE(0x10203040, 4);
  allocation.writeUInt8(1, 8);
  allocation.writeUInt8(0, 9);
  allocation.writeUInt8(1, 10);
  gameSocket.write(encodeFrame(allocation.subarray(0, 12), 0x64));
  const allocatedAttributes = (await firstSession.reader.next(0x7f04)).body;
  assert.equal(allocatedAttributes.readUInt8(9), 0, "server accepted one attribute point");
  assert.equal(allocatedAttributes.readUInt8(10), 0, "server identifies the allocated STR");
  assert.equal(allocatedAttributes.readUInt16LE(16), initialStrength + 1);
  assert.equal(allocatedAttributes.readUInt32LE(12), 4);

  const initialSkills = (await firstSession.reader.next(0x7f06)).body;
  assert.equal(initialSkills.readUInt8(9), 0, "world entry sends a skill snapshot");
  const learnSkill = Buffer.alloc(12);
  learnSkill.writeUInt16LE(0x7f05, 0);
  learnSkill.writeUInt16LE(firstSession.clientId, 2);
  learnSkill.writeUInt32LE(0x10203042, 4);
  learnSkill.writeUInt8(1, 8);
  learnSkill.writeUInt8(73, 9); // Huntress: Flecha Perfurante.
  gameSocket.write(encodeFrame(learnSkill, 0x65));
  const learnedSkills = (await firstSession.reader.next(0x7f06)).body;
  assert.equal(learnedSkills.readUInt8(9), 1, "server learned the Huntress skill");
  assert.equal(learnedSkills.readUInt8(10), 73);
  assert.equal(learnedSkills.readUInt32LE(12), 0);
  assert.equal(learnedSkills[16 + Math.floor((73 - 1) / 8)] & (1 << ((73 - 1) % 8)), 1);

  const initialMountState = parseCaracatoaMountStateBody(
    (await firstSession.reader.next(0x7f0d)).body,
  );
  assert.equal(initialMountState.malformed, false);
  assert.equal(initialMountState.clientId, firstSession.clientId);
  assert.equal(initialMountState.status, 0);
  assert.equal(initialMountState.action, "list");
  assert.equal(initialMountState.mounts.length, 1, "world entry grants one tutorial mount");
  const tutorialMount = initialMountState.mounts[0];
  assert.equal(tutorialMount.speciesId, "equus");
  assert.equal(tutorialMount.stage, "egg");
  assert.equal(tutorialMount.incubationRemaining, 1);
  assert.equal(firstWorld.body.readUInt16LE(392), 8102, "slot 2 contains the catalog incubation dust");
  assert.equal(firstWorld.body.readInt16LE(394), 1);

  gameSocket.write(encodeFrame(buildCaracatoaMountRequestBody({
    clientId: firstSession.clientId,
    timestamp: 0x10203043,
    action: CARACATOA_MOUNT_ACTION.incubate,
    mountId: tutorialMount.id,
    inventorySlot: 2,
  }), 0x66));
  const incubatedMountState = parseCaracatoaMountStateBody(
    (await firstSession.reader.next(0x7f0d)).body,
  );
  assert.equal(incubatedMountState.status, 1);
  assert.equal(incubatedMountState.action, "incubate");
  assert.equal(incubatedMountState.mounts.length, 1);
  assert.equal(incubatedMountState.mounts[0].id, tutorialMount.id);
  assert.equal(incubatedMountState.mounts[0].stage, "juvenile");
  const consumedMountDust = await firstSession.reader.nextMatching(
    0x182,
    (body) => body.readInt16LE(10) === 2,
  );
  assert.equal(consumedMountDust.body.readUInt16LE(12), 0, "hatching consumes the final dust unit");

  gameSocket.write(encodeFrame(buildCaracatoaMountRequestBody({
    clientId: firstSession.clientId,
    timestamp: 0x10203044,
    action: CARACATOA_MOUNT_ACTION.select,
    mountId: tutorialMount.id,
  }), 0x67));
  const selectedMountState = parseCaracatoaMountStateBody(
    (await firstSession.reader.next(0x7f0d)).body,
  );
  assert.equal(selectedMountState.status, 1);
  assert.equal(selectedMountState.action, "select");
  assert.equal(selectedMountState.mounts.length, 1);
  assert.equal(selectedMountState.mounts[0].id, tutorialMount.id);
  assert.equal(selectedMountState.mounts[0].stage, "juvenile");
  assert.equal(selectedMountState.mounts[0].active, true);
  assert.equal(selectedMountState.mounts[0].riding, false);

  const initialEquipmentSnapshots = [];
  for (let index = 0; index < 6; index += 1) {
    initialEquipmentSnapshots.push((await firstSession.reader.next(0x7f08)).body);
  }
  const initialWeapon = initialEquipmentSnapshots.find((body) => body.readUInt8(5) === 0);
  assert.ok(initialWeapon);
  assert.equal(initialWeapon.readUInt8(4), 2, "weapon slot begins with an empty equipment snapshot");

  const equipWeapon = buildCaracatoaEquipmentRequest({
    clientId: firstSession.clientId,
    equipmentSlot: 0,
    inventorySlot: 0,
    timestamp: 0x10203043,
  });
  gameSocket.write(encodeFrame(equipWeapon, 0x68));
  const equippedWeapon = (await firstSession.reader.next(0x7f08)).body;
  assert.equal(equippedWeapon.readUInt8(4), 0, "server accepted the starter blade");
  assert.equal(equippedWeapon.readUInt8(5), 0);
  assert.equal(equippedWeapon.readUInt8(6), 0);
  assert.equal(equippedWeapon.readUInt16LE(8), 7001);
  assert.equal(equippedWeapon.readUInt16LE(10), 5);
  assert.equal(equippedWeapon.readUInt16LE(14), 5);

  const movement = Buffer.alloc(48);
  movement.writeUInt16LE(0x36c, 0);
  movement.writeUInt16LE(firstSession.clientId, 2);
  movement.writeUInt32LE(0x10203041, 4);
  movement.writeInt16LE(128, 8);
  movement.writeInt16LE(128, 10);
  movement.writeUInt32LE(3, 16);
  movement.writeUInt8(0x36, 20);
  movement.writeInt16LE(129, 44);
  movement.writeInt16LE(128, 46);
  gameSocket.write(encodeFrame(movement, 0x69));
  const moved = await firstSession.reader.next(0x366);
  assert.deepEqual(
    { x: moved.body.readInt16LE(44), y: moved.body.readInt16LE(46) },
    { x: 129, y: 128 },
  );

  const golemSpawn = await firstSession.reader.nextMatching(
    0x364,
    (body) => body.length >= 164 && body.readUInt16LE(12) === 64000,
  );
  assert.equal(golemSpawn.body.readInt32LE(160), 50, "world spawn publishes the Golem's catalog HP");
  const fight = await defeatMonster(firstSession.reader, gameSocket, {
    clientId: firstSession.clientId,
    entityId: 64000,
    playerPosition: { x: 129, y: 128 },
    sequence: 0x6a,
  });
  assert.equal(fight.currentHp, 0);
  const lootDelta = await firstSession.reader.nextMatching(
    0x182,
    (body) => body.length >= 20 && body.readUInt16LE(12) === 8101,
  );
  const lootSlot = lootDelta.body.readInt16LE(10);
  assert.equal(lootDelta.body.readInt16LE(14), 2, "guaranteed synthetic loot stacks one ration onto the starter ration");
  const death = await firstSession.reader.nextMatching(
    0x338,
    (body) => body.length >= 24 && body.readUInt16LE(12) === 64000,
  );
  assert.equal(death.body.readUInt16LE(14), firstSession.clientId, "death identifies the player as killer");
  assert.equal(death.body.readBigInt64LE(20), 10n, "death response reports the level-one EXP reward");
  const gainedProgression = await firstSession.reader.nextMatching(
    0x7f02,
    (body) => body.length >= 24 && body.readBigInt64LE(16) === 10n,
  );
  assert.ok(gainedProgression.body.readUInt32LE(12) >= 2, "server advances the character after the first Golem kill");
  assert.equal(lootDelta.body.readUInt16LE(12), 8101, "the catalog ID on the inventory delta is Ração de Campo");

  const adminCookie = await loginAdmin(baseUrl);
  const loadedMonsters = await adminRequest(
    baseUrl,
    adminCookie,
    "/api/v1/game/monsters",
  );
  assert.equal(loadedMonsters.response.status, 200);
  const defeatedGolem = loadedMonsters.payload.monsters.find(
    (monster) => monster.clientEntityId === 64000,
  );
  assert.ok(defeatedGolem, "staff can inspect the loaded Golem while a player is online");
  assert.equal(defeatedGolem.currentHp, 0);
  assert.equal(defeatedGolem.activeSessions, 1);
  const reviveGolem = await adminRequest(
    baseUrl,
    adminCookie,
    "/api/v1/game/monsters",
    {
      method: "POST",
      body: {
        action: "revive",
        clientEntityId: 64000,
        position: defeatedGolem.position,
      },
    },
  );
  assert.equal(reviveGolem.response.status, 200);
  assert.equal(reviveGolem.payload.monster.currentHp, defeatedGolem.maxHp);
  const revivedGolemFrame = await firstSession.reader.nextMatching(
    0x364,
    (body) => body.length >= 164 && body.readUInt16LE(12) === 64000 && body.readInt32LE(160) === defeatedGolem.maxHp,
  );
  assert.equal(revivedGolemFrame.body.readInt32LE(152), defeatedGolem.maxHp);

  const firstSessionEnded = once(gameSocket, "end");
  const firstSessionClosed = once(gameSocket, "close");
  const stopped = await stopServer(instance, { graceful: true, signal: "SIGINT" });
  await firstSessionEnded;
  gameSocket.end();
  await firstSessionClosed;
  gameSocket = null;
  assert.deepEqual(stopped, { code: 130, signal: null });
  assert.match(instance.output(), /\[servidor\] encerramento gracioso solicitado \(SIGINT\)\./);

  const backupDirectory = join(directory, "verified-backup");
  await createCaracatoaLocalBackup({
    stateDirectory: join(initialRoot, "state"),
    catalogDirectory: catalogs,
    outputDirectory: backupDirectory,
  });
  const restored = await restoreCaracatoaLocalBackup({
    backupDirectory,
    outputRoot: join(directory, "restored"),
  });
  instance = launchServer(restored.outputRoot, port, gamePort);
  instances.push(instance);
  await waitForService(instance, baseUrl);
  const duplicateRegistration = await fetch(
    new URL("/api/v1/player-registration", baseUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: PLAYER_ID,
        password: PLAYER_PASSWORD,
        token: PLAYER_PIN,
      }),
    },
  );
  assert.equal(duplicateRegistration.status, 409);

  const resumedSession = await openPlayerSession(gamePort, 0x71);
  gameSocket = resumedSession.socket;
  assert.equal(
    resumedSession.roster.body.subarray(28, 44).toString("ascii").replace(/\0.*$/s, ""),
    CHARACTER_NAME,
  );
  gameSocket.write(enterCharacter(resumedSession.clientId, 0, 0x72));
  const resumedWorld = await resumedSession.reader.next(0x114);
  assert.deepEqual(
    { x: resumedWorld.body.readInt16LE(8), y: resumedWorld.body.readInt16LE(10) },
    { x: 129, y: 128 },
  );
  const restoredInventoryIds = Array.from(
    { length: 60 },
    (_, index) => resumedWorld.body.readUInt16LE(368 + index * 12),
  );
  assert.ok(restoredInventoryIds.includes(8101), "restored world includes the dropped ration in the backpack");
  assert.equal(resumedWorld.body.readUInt16LE(368 + lootSlot * 12), 8101, "the dropped ration remains in its persisted slot");
  assert.equal(resumedWorld.body.readInt16LE(370 + lootSlot * 12), 2, "the restored ration stack includes the monster drop");
  assert.equal(restoredInventoryIds.includes(8102), false, "incubation dust stays consumed after restoration");
  const restoredGolem = await resumedSession.reader.nextMatching(
    0x364,
    (body) => body.length >= 164 && body.readUInt16LE(12) === 64000,
  );
  assert.equal(
    restoredGolem.body.readInt32LE(160),
    defeatedGolem.maxHp,
    "the moderator-revived Golem remains alive after backup restoration",
  );
  const restoredExperience = await resumedSession.reader.nextMatching(
    0x7f02,
    (body) => body.length >= 24 && body.readBigInt64LE(16) === 10n,
  );
  assert.ok(restoredExperience.body.readUInt32LE(12) >= 2);
  const restoredAttributes = (await resumedSession.reader.next(0x7f04)).body;
  assert.equal(restoredAttributes.readUInt8(9), 3, "restored world sends the attribute snapshot");
  assert.equal(restoredAttributes.readUInt16LE(16), initialStrength + 1);
  assert.equal(restoredAttributes.readUInt32LE(12), 9, "the Golem's level-up adds five attribute points");
  const restoredSkills = (await resumedSession.reader.next(0x7f06)).body;
  assert.equal(restoredSkills.readUInt8(9), 0, "restored world sends the skill snapshot");
  assert.equal(restoredSkills.readUInt32LE(12), 1, "the Golem's level-up adds one skill point");
  assert.equal(restoredSkills[16 + Math.floor((73 - 1) / 8)] & (1 << ((73 - 1) % 8)), 1);
  const restoredMountState = parseCaracatoaMountStateBody(
    (await resumedSession.reader.next(0x7f0d)).body,
  );
  assert.equal(restoredMountState.malformed, false);
  assert.equal(restoredMountState.clientId, resumedSession.clientId);
  assert.equal(restoredMountState.status, 0);
  assert.equal(restoredMountState.action, "list");
  assert.equal(restoredMountState.mounts.length, 1, "restored entry does not duplicate the tutorial egg");
  assert.equal(restoredMountState.mounts[0].id, tutorialMount.id, "the mount keeps its persisted ID");
  assert.equal(restoredMountState.mounts[0].speciesId, "equus");
  assert.equal(restoredMountState.mounts[0].stage, "juvenile");
  assert.equal(restoredMountState.mounts[0].active, true);
  assert.equal(restoredMountState.mounts[0].riding, false, "the selected tutorial mount is not ridden");
  const restoredEquipment = [];
  for (let index = 0; index < 6; index += 1) {
    restoredEquipment.push((await resumedSession.reader.next(0x7f08)).body);
  }
  const restoredWeapon = restoredEquipment.find((body) => body.readUInt8(5) === 0);
  assert.ok(restoredWeapon);
  assert.equal(restoredWeapon.readUInt8(4), 2, "restored world publishes the equipment snapshot");
  assert.equal(restoredWeapon.readUInt8(6), 0);
  assert.equal(restoredWeapon.readUInt16LE(8), 7001);
  assert.equal(restoredWeapon.readUInt16LE(10), 5);
  assert.equal(restoredWeapon.readUInt16LE(14), 5);
  assert.equal(resumedWorld.body.readInt32LE(112), 17, "STR, the equipped weapon and level two affect restored combat stats");

  const restoredAuditBeforeKill = await readFile(
    join(restored.stateDirectory, "audit.jsonl"),
    "utf8",
  );
  const restoredReviveAudit = restoredAuditBeforeKill
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.entity === "world-monster" && event.targetId.startsWith("64000:"));
  assert.deepEqual(
    restoredReviveAudit.map((event) => [event.action, event.after.action, event.after.status]),
    [
      ["game.monster.action.requested", "revive", "requested"],
      ["game.monster.action.applied", "revive", "applied"],
    ],
    "the revive request and result are present immediately after restoring the audit log",
  );
  assert.equal(restoredReviveAudit[1].after.currentHp, defeatedGolem.maxHp);

  const restoredAdminCookie = await loginAdmin(baseUrl);
  const restoredMonsters = await adminRequest(
    baseUrl,
    restoredAdminCookie,
    "/api/v1/game/monsters",
  );
  assert.equal(restoredMonsters.response.status, 200);
  const currentGolem = restoredMonsters.payload.monsters.find(
    (monster) => monster.clientEntityId === 64000,
  );
  assert.ok(currentGolem);
  assert.equal(currentGolem.currentHp, defeatedGolem.maxHp);
  const killGolem = await adminRequest(
    baseUrl,
    restoredAdminCookie,
    "/api/v1/game/monsters",
    {
      method: "POST",
      body: {
        action: "kill",
        clientEntityId: 64000,
        position: currentGolem.position,
      },
    },
  );
  assert.equal(killGolem.response.status, 200);
  assert.equal(killGolem.payload.monster.currentHp, 0);
  const moderatedDeath = await resumedSession.reader.nextMatching(
    0x338,
    (body) => body.length >= 24 && body.readUInt16LE(12) === 64000 && body.readUInt16LE(14) === 0,
  );
  assert.equal(moderatedDeath.body.readUInt16LE(14), 0, "moderator-triggered death has no player killer");

  const audit = await readFile(
    join(restored.stateDirectory, "audit.jsonl"),
    "utf8",
  );
  assert.equal(audit.includes(PLAYER_PASSWORD), false);
  assert.equal(audit.includes(PLAYER_PIN), false);
  assert.equal(audit.includes("player-account.self-register"), true);
  const moderationAudit = audit
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.entity === "world-monster" && event.targetId.startsWith("64000:"));
  assert.deepEqual(
    moderationAudit.map((event) => [event.action, event.after.action, event.after.status]),
    [
      ["game.monster.action.requested", "revive", "requested"],
      ["game.monster.action.applied", "revive", "applied"],
      ["game.monster.action.requested", "kill", "requested"],
      ["game.monster.action.applied", "kill", "applied"],
    ],
    "restore retains the revive audit and the later kill is recorded",
  );
  assert.ok(moderationAudit.every((event) => event.actor.id === "admin" && event.actor.role === "admin"));
  assert.equal(moderationAudit[1].after.currentHp, defeatedGolem.maxHp);
  assert.equal(moderationAudit[3].after.currentHp, 0);

  const gameEnded = once(gameSocket, "end");
  const gameClosed = once(gameSocket, "close");
  const gracefulStop = stopServer(instance, { graceful: true, signal: "SIGTERM" });
  await gameEnded;
  gameSocket.end();
  const gracefulResult = await gracefulStop;
  await gameClosed;
  gameSocket = null;
  assert.deepEqual(gracefulResult, { code: 143, signal: null });
  assert.match(
    instance.output(),
    /\[servidor\] encerramento gracioso solicitado \(SIGTERM\)\./,
  );
  assert.match(
    instance.output(),
    /\[servidor\] listeners, sessões e bancos locais encerrados\./,
  );
});

test("anúncio de feira e compra itemizada sobrevivem a restore e reinício do servidor", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-shop-restart-"));
  const initialRoot = join(directory, "initial");
  const catalogs = join(initialRoot, "catalogs");
  const stateDirectory = join(initialRoot, "state");
  await cp(fileURLToPath(new URL("./data/catalogs/", import.meta.url)), catalogs, {
    recursive: true,
  });
  const itemCatalog = JSON.parse(await readFile(join(catalogs, "items.json"), "utf8"));
  const sellerPassword = "Seller9Pass";
  const sellerPin = "135790";
  const buyerPassword = "Buyer9Pass";
  const buyerPin = "246810";
  const sellerId = "shopseller";
  const buyerId = "shopbuyer";
  const databasePath = join(stateDirectory, "player-accounts.sqlite");
  const seedStore = new PlayerAccountStore({ databasePath });
  const itemInstanceId = "11111111-2222-4333-8444-555555555555";
  try {
    await seedStore.createAccount(sellerId, sellerPassword, sellerPin);
    await seedStore.createAccount(buyerId, buyerPassword, buyerPin);
    seedStore.createCharacter(sellerId, { slot: 0, classId: 0, name: "LojaSeller" });
    seedStore.createCharacter(buyerId, { slot: 0, classId: 1, name: "LojaBuyer" });
    seedStore.initializeCharacterInventory(
      sellerId,
      0,
      getWyd727StarterInventoryItems(itemCatalog),
    );
    seedStore.initializeCharacterInventory(
      buyerId,
      0,
      getWyd727StarterInventoryItems(itemCatalog),
    );
    const awarded = seedStore.awardCharacterItemizationLoot({
      accountId: sellerId,
      characterSlot: 0,
      lootEventId: "restart-market-fixture:bronze-armor",
      now: 1_000,
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
          id: "restart-market-defense",
          stat: "physicalDefenseFlat",
          value: 2,
          valueUnit: "flat",
        }],
      }],
    });
    assert.equal(awarded.granted, true);
  } finally {
    seedStore.close();
  }
  const seedDatabase = new DatabaseSync(databasePath);
  try {
    seedDatabase.prepare("UPDATE player_characters SET gold = 50 WHERE account_id = ? AND slot = 0").run(sellerId);
    seedDatabase.prepare("UPDATE player_characters SET gold = 5000 WHERE account_id = ? AND slot = 0").run(buyerId);
    assert.equal(
      seedDatabase.prepare("SELECT inventory_slot AS slot FROM player_character_inventory WHERE item_instance_id = ?").get(itemInstanceId).slot,
      4,
    );
  } finally {
    seedDatabase.close();
  }

  const port = await unusedLoopbackPort();
  let gamePort = await unusedLoopbackPort();
  while (gamePort === port) gamePort = await unusedLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const instances = [];
  const sockets = [];
  let instance = launchServer(initialRoot, port, gamePort);
  instances.push(instance);
  t.after(async () => {
    for (const socket of sockets) await closeSocket(socket).catch(() => {});
    for (const child of instances) await stopServer(child, { graceful: true });
    await rm(directory, { recursive: true, force: true });
    const output = instances.map((child) => child.output()).join("\n");
    for (const secret of [ADMIN_PASSWORD, sellerPassword, sellerPin, buyerPassword, buyerPin]) {
      assert.equal(output.includes(secret), false, "logs must not contain fixture credentials");
    }
  });

  await waitForService(instance, baseUrl);
  const seller = await openPlayerSession(gamePort, 0x31, {
    accountId: sellerId,
    password: sellerPassword,
    pin: sellerPin,
  });
  sockets.push(seller.socket);
  seller.socket.write(enterCharacter(seller.clientId, 0, 0x32));
  await seller.reader.next(0x114);
  const buyerBeforeRestart = await openPlayerSession(gamePort, 0x41, {
    accountId: buyerId,
    password: buyerPassword,
    pin: buyerPin,
  });
  sockets.push(buyerBeforeRestart.socket);
  buyerBeforeRestart.socket.write(enterCharacter(buyerBeforeRestart.clientId, 0, 0x42));
  await buyerBeforeRestart.reader.next(0x114);

  seller.socket.write(encodeFrame(buildCaracatoaPlayerShopRequestBody({
    clientId: seller.clientId,
    timestamp: 0x10203040,
    action: "create",
    inventorySlot: 4,
    askingGold: 1200,
  }), 0x43));
  const listingResponse = parseCaracatoaPlayerShopStateBody(
    (await seller.reader.next(0x7f23)).body,
  );
  assert.equal(listingResponse.malformed, false, listingResponse.reason);
  assert.equal(listingResponse.state.status, "ok");
  const listing = listingResponse.state.listings.find(
    (entry) => entry.itemInstanceId === itemInstanceId,
  );
  assert.ok(listing);
  assert.equal(listing.clientItemId, 8221);
  assert.equal(listing.sellerName, "LojaSeller");
  assert.equal(listing.own, true);
  const listingId = listing.listingId;

  await closeSocket(seller.socket);
  await closeSocket(buyerBeforeRestart.socket);
  const firstStop = await stopServer(instance, { graceful: true, signal: "SIGINT" });
  assert.deepEqual(firstStop, { code: 130, signal: null });
  assert.match(instance.output(), /\[servidor\] listeners, sessões e bancos locais encerrados\./);

  const backupDirectory = join(directory, "verified-backup");
  await createCaracatoaLocalBackup({ stateDirectory, catalogDirectory: catalogs, outputDirectory: backupDirectory });
  const restored = await restoreCaracatoaLocalBackup({ backupDirectory, outputRoot: join(directory, "restored") });
  instance = launchServer(restored.outputRoot, port, gamePort);
  instances.push(instance);
  await waitForService(instance, baseUrl);

  const buyer = await openPlayerSession(gamePort, 0x51, {
    accountId: buyerId,
    password: buyerPassword,
    pin: buyerPin,
  });
  sockets.push(buyer.socket);
  buyer.socket.write(enterCharacter(buyer.clientId, 0, 0x52));
  await buyer.reader.next(0x114);
  buyer.socket.write(encodeFrame(buildCaracatoaPlayerShopRequestBody({
    clientId: buyer.clientId,
    timestamp: 0x10203050,
    action: "list",
  }), 0x53));
  const marketResponse = parseCaracatoaPlayerShopStateBody(
    (await buyer.reader.next(0x7f23)).body,
  );
  assert.equal(marketResponse.malformed, false, marketResponse.reason);
  assert.equal(marketResponse.state.status, "ok");
  const restoredListing = marketResponse.state.listings.find((entry) => entry.listingId === listingId);
  assert.ok(restoredListing, "offline seller's listing is still visible after process restart");
  assert.equal(restoredListing.itemInstanceId, itemInstanceId);
  assert.equal(restoredListing.own, false);
  assert.equal(restoredListing.askingGold, 1200);

  const purchaseRequestId = "00000000-0000-4000-8000-000000000099";
  buyer.socket.write(encodeFrame(buildCaracatoaPlayerShopRequestBody({
    clientId: buyer.clientId,
    timestamp: 0x10203051,
    action: "buy",
    listingId,
    requestId: purchaseRequestId,
  }), 0x54));
  const purchaseResponse = parseCaracatoaPlayerShopStateBody(
    (await buyer.reader.next(0x7f23)).body,
  );
  assert.equal(purchaseResponse.malformed, false, purchaseResponse.reason);
  assert.equal(purchaseResponse.state.status, "ok");
  assert.equal(purchaseResponse.state.receipt.askingGold, 1200);
  assert.equal(purchaseResponse.state.receipt.buyerGoldBalance, 3800);
  assert.equal(purchaseResponse.state.receipt.itemInstanceId, itemInstanceId);
  const inventoryDeltas = await Promise.all(
    Array.from({ length: 60 }, () => buyer.reader.next(0x182)),
  );
  const purchasedItemDelta = inventoryDeltas.find((frame) => frame.body.readInt16LE(10) === 4);
  assert.ok(purchasedItemDelta, "purchase refreshes the buyer inventory over the game protocol");
  assert.equal(purchasedItemDelta.body.readUInt16LE(12), 8221);
  assert.equal(purchasedItemDelta.body.readInt16LE(14), 1);

  await closeSocket(buyer.socket);
  const secondStop = await stopServer(instance, { graceful: true, signal: "SIGTERM" });
  assert.deepEqual(secondStop, { code: 143, signal: null });

  instance = launchServer(restored.outputRoot, port, gamePort);
  instances.push(instance);
  await waitForService(instance, baseUrl);
  const retriedBuyer = await openPlayerSession(gamePort, 0x61, {
    accountId: buyerId,
    password: buyerPassword,
    pin: buyerPin,
  });
  sockets.push(retriedBuyer.socket);
  retriedBuyer.socket.write(enterCharacter(retriedBuyer.clientId, 0, 0x62));
  await retriedBuyer.reader.next(0x114);
  retriedBuyer.socket.write(encodeFrame(buildCaracatoaPlayerShopRequestBody({
    clientId: retriedBuyer.clientId,
    timestamp: 0x10203061,
    action: "buy",
    listingId,
    requestId: purchaseRequestId,
  }), 0x63));
  const replayResponse = parseCaracatoaPlayerShopStateBody(
    (await retriedBuyer.reader.next(0x7f23)).body,
  );
  assert.equal(replayResponse.malformed, false, replayResponse.reason);
  assert.equal(replayResponse.state.status, "ok");
  assert.equal(replayResponse.state.receipt.itemInstanceId, itemInstanceId);
  assert.equal(replayResponse.state.receipt.buyerGoldBalance, 3800);
  const replayDeltas = await Promise.all(
    Array.from({ length: 60 }, () => retriedBuyer.reader.next(0x182)),
  );
  const replayedItemDelta = replayDeltas.find((frame) => frame.body.readInt16LE(10) === 4);
  assert.ok(replayedItemDelta, "idempotent purchase retry refreshes the already-owned item");
  assert.equal(replayedItemDelta.body.readUInt16LE(12), 8221);
  assert.equal(replayedItemDelta.body.readInt16LE(14), 1);
  await closeSocket(retriedBuyer.socket);
  const retryStop = await stopServer(instance, { graceful: true, signal: "SIGINT" });
  assert.deepEqual(retryStop, { code: 130, signal: null });

  const restoredStore = new PlayerAccountStore({
    databasePath: join(restored.stateDirectory, "player-accounts.sqlite"),
  });
  try {
    const snapshotDb = new DatabaseSync(join(restored.stateDirectory, "player-accounts.sqlite"), { readOnly: true });
    const restoredBalances = snapshotDb
      .prepare("SELECT account_id AS accountId, slot, gold FROM player_characters ORDER BY account_id, slot")
      .all()
      .map((row) => ({ ...row }));
    snapshotDb.close();
    assert.deepEqual(restoredBalances, [
      { accountId: buyerId, slot: 0, gold: 3800 },
      { accountId: sellerId, slot: 0, gold: 1250 },
    ], "completed purchase balances persist after retry and the third server stop");
    assert.equal(
      restoredStore.getCharacterBySlot(sellerId, 0)?.gold,
      1250,
      JSON.stringify(restoredStore.getCharacterBySlot(sellerId, 0)),
    );
    assert.equal(
      restoredStore.getCharacterBySlot(buyerId, 0)?.gold,
      3800,
      JSON.stringify(restoredStore.getCharacterBySlot(buyerId, 0)),
    );
    assert.equal(restoredStore.getCharacterItemizationDetails(sellerId, 0).length, 0);
    const purchasedRoll = restoredStore.getCharacterItemizationDetails(buyerId, 0);
    assert.equal(purchasedRoll.length, 1);
    assert.equal(purchasedRoll[0].slot, 4);
    assert.equal(purchasedRoll[0].instanceId, itemInstanceId);
    assert.equal(purchasedRoll[0].rarity, "mystic");
    assert.equal(purchasedRoll[0].affixes[0].value, 2);
    assert.equal(
      restoredStore.listPlayerShopListings(sellerId, { characterSlot: 0, view: "mine" }).listings.length,
      0,
    );
  } finally {
    restoredStore.close();
  }

  const shopAuditDatabase = new DatabaseSync(join(restored.stateDirectory, "player-accounts.sqlite"), { readOnly: true });
  try {
    const shopAudit = shopAuditDatabase.prepare(`
      SELECT action, account_id AS accountId, item_instance_id AS itemInstanceId, asking_gold AS askingGold
      FROM player_shop_audit_events WHERE listing_id = ? ORDER BY rowid
    `).all(listingId);
    assert.deepEqual(shopAudit.map((event) => [event.action, event.accountId]), [
      ["listed", sellerId],
      ["purchased", buyerId],
      ["sold", sellerId],
    ]);
    assert.ok(shopAudit.every((event) => event.itemInstanceId === itemInstanceId && event.askingGold === 1200));
    assert.equal(
      shopAuditDatabase.prepare("SELECT COUNT(*) AS count FROM player_shop_purchase_receipts").get().count,
      1,
      "retry after a process restart does not create another receipt",
    );
  } finally {
    shopAuditDatabase.close();
  }
});
