import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import test from "node:test";
import { clientHandshake, decodeFrame, encodeFrame } from "./protocol.mjs";
import { computeWyd727ClineVersion } from "./wyd-727-character-entry.mjs";
import { PlayerAccountStore } from "./player-account-store.mjs";
import { DEFAULT_WYD727_CLASS_WORLD_STATS } from "./wyd-727-class-catalog.mjs";

const PANEL_PASSWORD = "SyntheticPanelPass!";
const PLAYER_PASSWORD = "SYNTHPASS";
const MODERATOR_PASSWORD = "SyntheticModeratorPass!";

async function unusedLoopbackPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startService(child, baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Serviço terminou na inicialização: ${child.exitCode}`);
    try {
      const response = await fetch(new URL("/healthz", baseUrl));
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Serviço Caracatoa não iniciou dentro do prazo do teste.");
}

async function login(baseUrl, id, password) {
  const response = await fetch(new URL("/api/v1/session", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ id, password }),
  });
  assert.equal(response.status, 200);
  const cookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  assert.ok(cookie, "login deve emitir cookie de sessão");
  return cookie.split(";", 1)[0];
}

async function request(baseUrl, cookie, path, { method = "GET", body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method))
    headers.Origin = baseUrl;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

function gameFrameReader(socket) {
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
      const frameIndex = frames.findIndex(({ body }) => body.readUInt16LE(0) === waiter.opcode);
      if (frameIndex < 0) continue;
      clearTimeout(waiter.timer);
      const [frame] = frames.splice(frameIndex, 1);
      waiters.splice(index, 1);
      waiter.resolve(frame);
    }
  });
  return {
    next(opcode, { timeoutMs = 4000 } = {}) {
      const index = frames.findIndex(({ body }) => body.readUInt16LE(0) === opcode);
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { opcode, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          const queued = frames.map(({ body }) => `0x${body.readUInt16LE(0).toString(16)}`);
          reject(new Error(
            `timeout waiting for game opcode 0x${opcode.toString(16)}; ` +
            `queued opcodes=${queued.join(",") || "none"}`,
          ));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

function gameLoginBody(opcode, frameLength) {
  const body = Buffer.alloc(frameLength - 4);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  return body;
}

function sendGameBody(socket, body, sequence) {
  socket.write(encodeFrame(body, sequence));
}

function gameMovementBody({ clientId, from, to }) {
  const body = Buffer.alloc(48);
  body.writeUInt16LE(0x36c, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeInt16LE(from.x, 8);
  body.writeInt16LE(from.y, 10);
  body.writeUInt32LE(0, 12);
  body.writeUInt32LE(3, 16);
  body.writeUInt8(0x36, 20);
  body.writeInt16LE(to.x, 44);
  body.writeInt16LE(to.y, 46);
  return body;
}

test("administra contas de jogador somente com papel admin e audita sem registrar credenciais", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-player-admin-"));
  const catalogDirectory = join(directory, "catalogs");
  await mkdir(catalogDirectory, { recursive: true });
  await copyFile(
    fileURLToPath(new URL("./data/catalogs/itemization.json", import.meta.url)),
    join(catalogDirectory, "itemization.json"),
  );
  const port = await unusedLoopbackPort();
  let gamePort = await unusedLoopbackPort();
  while (gamePort === port) gamePort = await unusedLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: {
      ...process.env,
      CARACATOA_ADMIN_PASSWORD: PANEL_PASSWORD,
      CARACATOA_PORT: String(port),
      CARACATOA_GAME_PORT: String(gamePort),
      CARACATOA_DATA_DIR: catalogDirectory,
      CARACATOA_STATE_DIR: join(directory, "state"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const testCredentials = new Set([
    PANEL_PASSWORD,
    MODERATOR_PASSWORD,
    PLAYER_PASSWORD,
  ]);
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const recentGameDiagnostics = () =>
    [stdout, stderr]
      .flatMap((output) => output.split(/\r?\n/))
      .filter((line) => line.includes("[jogo]"))
      .slice(-24)
      .map((line) =>
        line
          .replaceAll(PLAYER_PASSWORD, "[redacted]")
          .replaceAll("NEWPLAYER9", "[redacted]")
          .replaceAll("864210", "[redacted]"),
      )
      .join("\n");
  const waitForWorld = async (reader, phase) => {
    try {
      return await reader.next(0x114);
    } catch (error) {
      const details = recentGameDiagnostics();
      throw new Error(
        `${phase}: ${error.message}${details ? `\n${details}` : ""}`,
        { cause: error },
      );
    }
  };
  let playerStore;

  t.after(async () => {
    playerStore?.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await rm(directory, { recursive: true, force: true });
    for (const credential of testCredentials) {
      assert.equal(
        stdout.includes(credential),
        false,
        "server stdout must not contain credentials",
      );
      assert.equal(
        stderr.includes(credential),
        false,
        "server stderr must not contain credentials",
      );
    }
  });

  await startService(child, baseUrl).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });

  const unauthenticated = await request(
    baseUrl,
    null,
    "/api/v1/player-accounts",
  );
  assert.equal(unauthenticated.response.status, 401);

  const adminCookie = await login(baseUrl, "admin", PANEL_PASSWORD);
  const created = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts",
    {
      method: "POST",
      body: {
        accountId: "TestPlayer",
        password: PLAYER_PASSWORD,
        token: "135790",
      },
    },
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.account.accountId, "testplayer");
  assert.equal(created.payload.account.enabled, true);
  assert.equal(created.payload.account.tokenConfigured, true);
  assert.equal(
    JSON.stringify(created.payload).includes(PLAYER_PASSWORD),
    false,
  );
  assert.equal(JSON.stringify(created.payload).includes("135790"), false);
  assert.deepEqual(Object.keys(created.payload.account).sort(), [
    "accountId",
    "createdAt",
    "enabled",
    "tokenConfigured",
  ]);

  const duplicate = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts",
    {
      method: "POST",
      body: {
        accountId: "testplayer",
        password: PLAYER_PASSWORD,
        token: "135790",
      },
    },
  );
  assert.equal(duplicate.response.status, 409);

  const invalidPassword = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts",
    {
      method: "POST",
      body: {
        accountId: "toolong",
        password: "SyntheticPasswordTooLong",
        token: "135790",
      },
    },
  );
  assert.equal(invalidPassword.response.status, 400);
  assert.equal(
    invalidPassword.payload.error.includes("SyntheticPasswordTooLong"),
    false,
  );

  const staffCreated = await request(baseUrl, adminCookie, "/api/v1/accounts", {
    method: "POST",
    body: {
      id: "moderator",
      displayName: "Moderador sintético",
      role: "moderator",
      password: MODERATOR_PASSWORD,
    },
  });
  assert.equal(staffCreated.response.status, 201);
  const moderatorCookie = await login(baseUrl, "moderator", MODERATOR_PASSWORD);
  const unauthenticatedPlayers = await request(
    baseUrl,
    null,
    "/api/v1/game/player-sessions",
  );
  assert.equal(unauthenticatedPlayers.response.status, 401);
  const onlinePlayers = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/game/player-sessions",
  );
  assert.equal(onlinePlayers.response.status, 200);
  assert.deepEqual(onlinePlayers.payload.players, []);
  const invalidSuspend = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/game/player-sessions/suspend",
    {
      method: "POST",
      body: { accountId: "testplayer", reason: "ok", extra: true },
    },
  );
  assert.equal(invalidSuspend.response.status, 400);
  const offlineSuspend = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/game/player-sessions/suspend",
    {
      method: "POST",
      body: { accountId: "testplayer", reason: "motivo sintético" },
    },
  );
  assert.equal(offlineSuspend.response.status, 409);
  assert.equal(
    (await request(baseUrl, adminCookie, "/api/v1/player-accounts")).payload
      .accounts[0].enabled,
    true,
  );
  const unauthenticatedModeration = await request(
    baseUrl,
    null,
    "/api/v1/game/monsters",
  );
  assert.equal(unauthenticatedModeration.response.status, 401);
  const activeMonsters = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/game/monsters",
  );
  assert.equal(activeMonsters.response.status, 200);
  assert.deepEqual(activeMonsters.payload.monsters, []);
  const malformedModeration = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/game/monsters",
    {
      method: "POST",
      body: {
        action: "kill",
        clientEntityId: 5000,
        position: { x: 322, y: 123 },
        unexpected: true,
      },
    },
  );
  assert.equal(malformedModeration.response.status, 400);
  const forbidden = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/player-accounts",
  );
  assert.equal(forbidden.response.status, 403);

  const classes = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/classes",
  );
  assert.equal(classes.response.status, 200);
  assert.deepEqual(
    classes.payload.entries.map((entry) => entry.id),
    ["0", "1", "2", "3"],
  );
  const foema = structuredClone(classes.payload.entries[1]);
  foema.properties.startingStats.damage = 41;
  foema.properties.startingStats.movementSpeed = 5;
  foema.properties.startingStats.maxHp = 180;
  foema.properties.startingStats.currentHp = 170;
  foema.properties.startingStats.str = 22;
  const classUpdated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/classes/1",
    {
      method: "PUT",
      body: foema,
    },
  );
  assert.equal(classUpdated.response.status, 200);
  assert.equal(
    classUpdated.payload.entries[1].properties.startingStats.damage,
    41,
  );

  const invalidClass = structuredClone(classUpdated.payload.entries[1]);
  invalidClass.properties.startingStats.movementSpeed = 8;
  const rejectedClass = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/classes/1",
    {
      method: "PUT",
      body: invalidClass,
    },
  );
  assert.equal(rejectedClass.response.status, 400);
  const stillUpdated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/classes",
  );
  assert.equal(
    stillUpdated.payload.entries[1].properties.startingStats.movementSpeed,
    5,
  );

  const emptyItems = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items",
  );
  assert.equal(emptyItems.response.status, 200);
  assert.deepEqual(emptyItems.payload.entries, []);
  const item = {
    id: "sintetico-pocao",
    name: "Poção sintética",
    description: "Fixture de teste sem asset proprietário.",
    enabled: true,
    properties: {
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
  };
  const itemCreated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items",
    { method: "POST", body: item },
  );
  assert.equal(itemCreated.response.status, 201);
  const editedItem = structuredClone(itemCreated.payload.entries[0]);
  editedItem.properties.stackCount = 6;
  const itemUpdated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    { method: "PUT", body: editedItem },
  );
  assert.equal(itemUpdated.response.status, 200);
  assert.equal(itemUpdated.payload.entries[0].properties.stackCount, 6);
  const invalidItem = structuredClone(itemUpdated.payload.entries[0]);
  invalidItem.properties.stackCount = 501;
  const rejectedItem = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    { method: "PUT", body: invalidItem },
  );
  assert.equal(rejectedItem.response.status, 400);

  const emptyMonsters = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/monsters",
  );
  assert.equal(emptyMonsters.response.status, 200);
  assert.deepEqual(emptyMonsters.payload.entries, []);
  const monster = {
    id: "goblin-sintetico",
    name: "Goblin_01",
    description: "Fixture de protocolo sem modelo proprietário.",
    enabled: true,
    properties: {
      clientEntityId: 5000,
      equipModelIds: [5001, ...Array(15).fill(0)],
      spawnPosition: { x: 322, y: 123 },
      level: 4,
      drop: {
        catalogItemId: "sintetico-pocao",
        quantity: 1,
        chanceBasisPoints: 10_000,
      },
      startingStats: {
        ...DEFAULT_WYD727_CLASS_WORLD_STATS,
        damage: 18,
        maxHp: 120,
        currentHp: 120,
        str: 23,
      },
    },
  };
  const monsterCreated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/monsters",
    { method: "POST", body: monster },
  );
  assert.equal(monsterCreated.response.status, 201);
  const unknownDropMonster = structuredClone(monster);
  unknownDropMonster.id = "drop-invalido";
  unknownDropMonster.properties.drop.catalogItemId = "item-ausente";
  const rejectedDropMonster = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/monsters",
    { method: "POST", body: unknownDropMonster },
  );
  assert.equal(rejectedDropMonster.response.status, 400);
  const editedMonster = structuredClone(monsterCreated.payload.entries[0]);
  editedMonster.properties.startingStats.damage = 19;
  const monsterUpdated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/monsters/goblin-sintetico",
    { method: "PUT", body: editedMonster },
  );
  assert.equal(monsterUpdated.response.status, 200);
  assert.equal(
    monsterUpdated.payload.entries[0].properties.startingStats.damage,
    19,
  );
  const invalidMonster = structuredClone(monsterUpdated.payload.entries[0]);
  invalidMonster.properties.startingStats.merchant = 2;
  const rejectedMonster = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/monsters/goblin-sintetico",
    { method: "PUT", body: invalidMonster },
  );
  assert.equal(rejectedMonster.response.status, 400);
  const disabledLootItem = structuredClone(itemUpdated.payload.entries[0]);
  disabledLootItem.enabled = false;
  const rejectedLootItem = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    { method: "PUT", body: disabledLootItem },
  );
  assert.equal(rejectedLootItem.response.status, 400);

  const emptySkills = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/skills",
  );
  assert.equal(emptySkills.response.status, 200);
  assert.deepEqual(emptySkills.payload.entries, []);
  const skill = {
    id: "caracatoa-corte",
    name: "Caracatoa Corte",
    description: "Habilidade single-target sintética.",
    enabled: true,
    properties: {
      clientSkillId: 25,
      branchId: "magia-negra",
      scalingAttribute: "int",
      effectType: "damage",
      skillPointCost: 1,
      requiredLevel: 1,
      prerequisites: [],
      damageBonus: 6,
      healAmount: 0,
      defenseBonus: 0,
      durationMs: 0,
      manaCost: 7,
      cooldownMs: 3000,
      rangeTiles: 1,
    },
  };
  const skillCreated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/skills",
    { method: "POST", body: skill },
  );
  assert.equal(skillCreated.response.status, 201);
  const editedSkill = structuredClone(skillCreated.payload.entries[0]);
  editedSkill.properties.damageBonus = 8;
  const skillUpdated = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/skills/caracatoa-corte",
    { method: "PUT", body: editedSkill },
  );
  assert.equal(skillUpdated.response.status, 200);
  assert.equal(skillUpdated.payload.entries[0].properties.damageBonus, 8);
  const invalidSkill = structuredClone(skillUpdated.payload.entries[0]);
  invalidSkill.properties.clientSkillId = 96;
  const rejectedSkill = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/skills/caracatoa-corte",
    { method: "PUT", body: invalidSkill },
  );
  assert.equal(rejectedSkill.response.status, 400);

  const disabled = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts/testplayer",
    {
      method: "PUT",
      body: { enabled: false },
    },
  );
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.payload.account.enabled, false);
  const listed = await request(baseUrl, adminCookie, "/api/v1/player-accounts");
  assert.equal(listed.payload.accounts.length, 1);
  assert.equal(listed.payload.accounts[0].enabled, false);

  playerStore = new PlayerAccountStore({
    databasePath: join(directory, "state", "player-accounts.sqlite"),
  });
  assert.equal(
    await playerStore.authenticate("testplayer", PLAYER_PASSWORD),
    null,
    "conta desativada não autentica",
  );
  assert.equal(
    await playerStore.authenticateToken("testplayer", "135790"),
    null,
    "token de conta desativada não autentica",
  );
  const enabled = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts/testplayer",
    {
      method: "PUT",
      body: { enabled: true },
    },
  );
  assert.equal(enabled.payload.account.enabled, true);
  assert.equal(
    (await playerStore.authenticate("testplayer", PLAYER_PASSWORD)).accountId,
    "testplayer",
  );
  assert.equal(
    (await playerStore.authenticateToken("testplayer", "135790")).accountId,
    "testplayer",
  );

  const resetToken = await request(
    baseUrl,
    adminCookie,
    "/api/v1/player-accounts/testplayer",
    {
      method: "PUT",
      body: { token: "246810" },
    },
  );
  assert.equal(resetToken.response.status, 200);
  assert.equal(JSON.stringify(resetToken.payload).includes("246810"), false);
  assert.equal(
    await playerStore.authenticateToken("testplayer", "135790"),
    null,
  );
  assert.equal(
    (await playerStore.authenticateToken("testplayer", "246810")).accountId,
    "testplayer",
  );

  playerStore.createCharacter("testplayer", {
    slot: 0,
    classId: 1,
    name: "Inventory01",
  });
  playerStore.initializeCharacterInventory("testplayer", 0, [
    "sintetico-pocao",
  ]);
  const moderatorDelete = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    { method: "DELETE" },
  );
  assert.equal(moderatorDelete.response.status, 409);
  const itemDelete = await request(
    baseUrl,
    adminCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    { method: "DELETE" },
  );
  assert.equal(itemDelete.response.status, 409);
  const itemRename = await request(
    baseUrl,
    moderatorCookie,
    "/api/v1/catalogs/items/sintetico-pocao",
    {
      method: "PUT",
      body: { ...editedItem, id: "renamed-potion" },
    },
  );
  assert.equal(itemRename.response.status, 409);

  const audit = await request(baseUrl, adminCookie, "/api/v1/audit?limit=200");
  assert.equal(audit.response.status, 200);
  const playerEvents = audit.payload.events.filter(
    (event) => event.entity === "player-account",
  );
  assert.deepEqual(
    playerEvents.map((event) => event.action),
    [
      "player-account.token-reset",
      "player-account.update",
      "player-account.update",
      "player-account.create",
    ],
  );
  assert.ok(playerEvents.every((event) => event.actor.id === "admin"));
  const classEvents = audit.payload.events.filter(
    (event) => event.entity === "classes",
  );
  assert.equal(classEvents.length, 1);
  assert.equal(classEvents[0].action, "catalog.update");
  assert.equal(classEvents[0].actor.id, "moderator");
  assert.equal(classEvents[0].after.properties.startingStats.damage, 41);
  const itemEvents = audit.payload.events.filter(
    (event) => event.entity === "items",
  );
  assert.equal(itemEvents.length, 2);
  assert.deepEqual(
    itemEvents.map((event) => event.action),
    ["catalog.update", "catalog.create"],
  );
  assert.ok(itemEvents.every((event) => event.actor.id === "moderator"));
  assert.equal(itemEvents[0].after.properties.stackCount, 6);
  const monsterEvents = audit.payload.events.filter(
    (event) => event.entity === "monsters",
  );
  assert.equal(monsterEvents.length, 2);
  assert.deepEqual(
    monsterEvents.map((event) => event.action),
    ["catalog.update", "catalog.create"],
  );
  assert.ok(monsterEvents.every((event) => event.actor.id === "moderator"));
  assert.equal(monsterEvents[0].after.properties.startingStats.damage, 19);

  const registrationPassword = "NEWPLAYER9";
  const registrationPin = "864210";
  const characterNames = [
    "PortalKnight",
    "PortalFoema",
    "PortalBeast",
    "PortalHunt",
  ];
  testCredentials.add(registrationPassword);
  testCredentials.add(registrationPin);
  testCredentials.add("000000");
  const verifyFullServerWorldEntry = async (slot, sequence) => {
    const socket = createConnection({ host: "127.0.0.1", port: gamePort });
    const reader = gameFrameReader(socket);
    try {
      await once(socket, "connect");
      const loginBody = gameLoginBody(0x20d, 124);
      Buffer.from(registrationPassword, "ascii").copy(loginBody, 8);
      Buffer.from("newlocalplayer", "ascii").copy(loginBody, 20);
      socket.write(Buffer.concat([
        clientHandshake(),
        encodeFrame(loginBody, sequence),
      ]));
      const loginReply = await reader.next(0x10a);
      const clientId = loginReply.body.readUInt16LE(2);
      const tokenBody = gameLoginBody(0xfde, 32);
      tokenBody.writeUInt16LE(clientId, 2);
      Buffer.from(registrationPin, "ascii").copy(tokenBody, 8);
      sendGameBody(socket, tokenBody, loginReply.body[8] ^ 0xff);
      await reader.next(0xfde);
      const roster = await reader.next(0x110);
      const rosterOffset = 28 + slot * 16;
      assert.equal(
        roster.body
          .subarray(rosterOffset, rosterOffset + 16)
          .toString("ascii")
          .replace(/\0.*$/s, ""),
        characterNames[slot],
      );

      const enterBody = gameLoginBody(0x213, 36);
      enterBody.writeUInt16LE(clientId, 2);
      enterBody.writeInt32LE(slot, 8);
      enterBody.writeUInt32LE(computeWyd727ClineVersion(1), 16);
      sendGameBody(socket, enterBody, sequence + 1);
      const world = await waitForWorld(
        reader,
        `${characterNames[slot]} world entry`,
      );
      assert.equal(
        world.body.subarray(12, 28).toString("ascii").replace(/\0.*$/s, ""),
        characterNames[slot],
      );
      assert.deepEqual(
        { x: world.body.readInt16LE(8), y: world.body.readInt16LE(10) },
        { x: 128, y: 128 },
      );
      const closed = once(socket, "close");
      socket.end();
      await closed;
    } finally {
      socket.destroy();
    }
  };
  const registrationResponse = await fetch(
    new URL("/api/v1/player-registration", baseUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "newlocalplayer",
        password: registrationPassword,
        token: registrationPin,
      }),
    },
  );
  assert.equal(registrationResponse.status, 201);
  const registrationResult = await registrationResponse.json();
  assert.deepEqual(registrationResult, {
    registered: true,
    accountId: "newlocalplayer",
  });
  assert.equal(
    await playerStore.authenticate("newlocalplayer", registrationPassword).then(Boolean),
    true,
  );
  assert.equal(
    await playerStore.authenticateToken("newlocalplayer", registrationPin).then(Boolean),
    true,
  );
  const duplicateRegistration = await fetch(
    new URL("/api/v1/player-registration", baseUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "newlocalplayer",
        password: registrationPassword,
        token: registrationPin,
      }),
    },
  );
  assert.equal(duplicateRegistration.status, 409);
  const invalidRegistration = await fetch(
    new URL("/api/v1/player-registration", baseUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "bad", password: "short", token: "12" }),
    },
  );
  assert.equal(invalidRegistration.status, 400);

  const concurrentRegistrationRequests = await Promise.all([
    fetch(new URL("/api/v1/player-registration", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "RacePlayer",
        password: registrationPassword,
        token: registrationPin,
      }),
    }),
    fetch(new URL("/api/v1/player-registration", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "raceplayer",
        password: registrationPassword,
        token: registrationPin,
      }),
    }),
  ]);
  const concurrentRegistrationResults = await Promise.all(
    concurrentRegistrationRequests.map(async (response) => ({
      status: response.status,
      body: await response.json(),
    })),
  );
  assert.deepEqual(
    concurrentRegistrationResults.map(({ status }) => status).sort(),
    [201, 409],
  );
  assert.equal(
    concurrentRegistrationResults.filter(({ body }) => body.registered === true)
      .length,
    1,
  );
  assert.equal(
    await playerStore.authenticate("RACEPLAYER", registrationPassword).then(Boolean),
    true,
  );
  assert.equal(
    await playerStore.authenticateToken("RACEPLAYER", registrationPin).then(Boolean),
    true,
  );

  const auditText = await readFile(
    join(directory, "state", "audit.jsonl"),
    "utf8",
  );
  assert.equal(auditText.includes(PLAYER_PASSWORD), false);
  assert.equal(auditText.includes("135790"), false);
  assert.equal(auditText.includes("246810"), false);
  assert.equal(auditText.includes(registrationPassword), false);
  assert.equal(auditText.includes(registrationPin), false);
  assert.equal(auditText.includes("player-account.self-register"), true);
  assert.equal(auditText.split('"player-account.self-register"').length - 1, 2);
  assert.equal(auditText.includes("passwordHash"), false);

  // A wrong secondary PIN must receive a denial without unlocking the roster.
  const deniedSocket = createConnection({ host: "127.0.0.1", port: gamePort });
  const deniedReader = gameFrameReader(deniedSocket);
  try {
    await once(deniedSocket, "connect");
    const deniedLogin = gameLoginBody(0x20d, 124);
    Buffer.from(registrationPassword, "ascii").copy(deniedLogin, 8);
    Buffer.from("newlocalplayer", "ascii").copy(deniedLogin, 20);
    deniedSocket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(deniedLogin, 0x30),
    ]));
    const deniedLoginReply = await deniedReader.next(0x10a);
    const incorrectPin = gameLoginBody(0xfde, 32);
    incorrectPin.writeUInt16LE(deniedLoginReply.body.readUInt16LE(2), 2);
    Buffer.from("000000", "ascii").copy(incorrectPin, 8);
    sendGameBody(deniedSocket, incorrectPin, deniedLoginReply.body[8] ^ 0xff);
    const deniedToken = await deniedReader.next(0xfdf);
    assert.equal(deniedToken.body.length + 4, 12);
    await assert.rejects(
      deniedReader.next(0x110, { timeoutMs: 100 }),
      /timeout waiting for game opcode 0x110/,
    );
  } finally {
    deniedSocket.destroy();
  }

  // Join the real self-registration HTTP endpoint to the game listener owned
  // by the same temporary server.mjs process and SQLite state.
  const gameSocket = createConnection({ host: "127.0.0.1", port: gamePort });
  const reader = gameFrameReader(gameSocket);
  let reconnectSocket = null;
  try {
    await once(gameSocket, "connect");
    const loginBody = gameLoginBody(0x20d, 124);
    Buffer.from(registrationPassword, "ascii").copy(loginBody, 8);
    Buffer.from("newlocalplayer", "ascii").copy(loginBody, 20);
    gameSocket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(loginBody, 0x31),
    ]));
    const loginReply = await reader.next(0x10a);
    const clientId = loginReply.body.readUInt16LE(2);
    assert.ok(clientId > 0);

    const tokenBody = gameLoginBody(0xfde, 32);
    tokenBody.writeUInt16LE(clientId, 2);
    Buffer.from(registrationPin, "ascii").copy(tokenBody, 8);
    sendGameBody(gameSocket, tokenBody, loginReply.body[8] ^ 0xff);
    await reader.next(0xfde);
    const emptyRoster = await reader.next(0x110);
    assert.equal(emptyRoster.body.length + 4, 1224);
    assert.deepEqual(playerStore.listCharacters("newlocalplayer"), []);

    let populatedRoster;
    for (let classId = 0; classId < characterNames.length; classId += 1) {
      const slot = classId;
      const createBody = gameLoginBody(0x7f00, 36);
      createBody.writeUInt16LE(clientId, 2);
      createBody.writeUInt16LE(1, 8);
      createBody.writeUInt8(slot, 10);
      createBody.writeUInt8(classId, 11);
      const characterName = Buffer.from(characterNames[classId], "ascii");
      createBody.writeUInt8(characterName.length, 12);
      characterName.copy(createBody, 14);
      sendGameBody(gameSocket, createBody, 0x42 + slot);
      const createReply = await reader.next(0x7f01);
      assert.equal(createReply.body.readUInt8(9), 0);
      assert.equal(createReply.body.readUInt8(10), slot);
      assert.equal(createReply.body.readUInt8(11), classId);
      populatedRoster = await reader.next(0x110);
      const rosterOffset = 28 + slot * 16;
      assert.equal(
        populatedRoster.body
          .subarray(rosterOffset, rosterOffset + 16)
          .toString("ascii")
          .replace(/\0.*$/s, ""),
        characterNames[classId],
      );
      assert.equal(
        playerStore.getCharacterBySlot("newlocalplayer", slot).classId,
        classId,
      );
    }
    assert.equal(playerStore.listCharacters("newlocalplayer").length, 4);

    const enterBody = gameLoginBody(0x213, 36);
    enterBody.writeUInt16LE(clientId, 2);
    enterBody.writeInt32LE(1, 8);
    enterBody.writeUInt32LE(computeWyd727ClineVersion(1), 16);
    sendGameBody(gameSocket, enterBody, 0x43);
    const world = await waitForWorld(reader, "first world entry");
    assert.equal(
      world.body.subarray(12, 28).toString("ascii").replace(/\0.*$/s, ""),
      "PortalFoema",
    );
    assert.deepEqual(
      { x: world.body.readInt16LE(8), y: world.body.readInt16LE(10) },
      { x: 128, y: 128 },
    );

    sendGameBody(gameSocket, gameMovementBody({
      clientId,
      from: { x: 128, y: 128 },
      to: { x: 129, y: 128 },
    }), 0x44);
    const moved = await reader.next(0x366);
    assert.deepEqual(
      { x: moved.body.readInt16LE(44), y: moved.body.readInt16LE(46) },
      { x: 129, y: 128 },
    );
    assert.deepEqual(
      { x: playerStore.getCharacterBySlot("newlocalplayer", 1).worldX,
        y: playerStore.getCharacterBySlot("newlocalplayer", 1).worldY },
      { x: 129, y: 128 },
    );

    const firstClose = once(gameSocket, "close");
    gameSocket.end();
    await firstClose;

    for (const slot of [0, 2, 3]) {
      await verifyFullServerWorldEntry(slot, 0x50 + slot * 2);
    }

    reconnectSocket = createConnection({ host: "127.0.0.1", port: gamePort });
    const reconnectReader = gameFrameReader(reconnectSocket);
    await once(reconnectSocket, "connect");
    const reconnectLogin = gameLoginBody(0x20d, 124);
    Buffer.from(registrationPassword, "ascii").copy(reconnectLogin, 8);
    Buffer.from("newlocalplayer", "ascii").copy(reconnectLogin, 20);
    reconnectSocket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(reconnectLogin, 0x45),
    ]));
    const reconnectLoginReply = await reconnectReader.next(0x10a);
    const reconnectClientId = reconnectLoginReply.body.readUInt16LE(2);
    const reconnectToken = gameLoginBody(0xfde, 32);
    reconnectToken.writeUInt16LE(reconnectClientId, 2);
    Buffer.from(registrationPin, "ascii").copy(reconnectToken, 8);
    sendGameBody(reconnectSocket, reconnectToken, reconnectLoginReply.body[8] ^ 0xff);
    await reconnectReader.next(0xfde);
    const persistedRoster = await reconnectReader.next(0x110);
    assert.equal(
      persistedRoster.body.subarray(44, 60).toString("ascii").replace(/\0.*$/s, ""),
      "PortalFoema",
    );
    const reconnectEnter = gameLoginBody(0x213, 36);
    reconnectEnter.writeUInt16LE(reconnectClientId, 2);
    reconnectEnter.writeInt32LE(1, 8);
    reconnectEnter.writeUInt32LE(computeWyd727ClineVersion(1), 16);
    sendGameBody(reconnectSocket, reconnectEnter, 0x46);
    const reconnectWorld = await waitForWorld(
      reconnectReader,
      "reconnected world entry",
    );
    assert.deepEqual(
      { x: reconnectWorld.body.readInt16LE(8), y: reconnectWorld.body.readInt16LE(10) },
      { x: 129, y: 128 },
    );
  } finally {
    gameSocket.destroy();
    reconnectSocket?.destroy();
  }
});
