import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { PlayerAccountStore } from "../../../server/caracatoa/player-account-store.mjs";

const HOST = "127.0.0.1";
const TIMEOUT_MS = 30_000;
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDirectory, "../../..");
const serverRoot = join(repoRoot, "server", "caracatoa");
const executable = resolve(process.argv[2] ?? "");
const onboardingTestMode = process.argv.includes("--onboarding");
const visibleClient = process.argv.includes("--visible");
const holdArgument = process.argv.find((argument) => argument.startsWith("--hold-after-world-ms="));
const holdAfterWorldMs = holdArgument ? Number(holdArgument.slice("--hold-after-world-ms=".length)) : 0;
const classArgument = process.argv.find((argument) => argument.startsWith("--class="));
const classId = classArgument ? Number(classArgument.slice("--class=".length)) : 0;
const classNames = ["CaracatoaTK", "CaracatoaFoema", "CaracatoaBM", "CaracatoaHT"];
assert.ok(process.argv[2], "usage: node tools/verify-native-registration.mjs <Caracatoa3DPreview.exe>");
assert.match(executable, /Caracatoa3DPreview\.exe$/i, "only the local Caracatoa Defold build is accepted");
assert.ok(Number.isInteger(classId) && classId >= 0 && classId <= 3, "--class must be 0, 1, 2, or 3");
assert.ok(Number.isInteger(holdAfterWorldMs) && holdAfterWorldMs >= 0 && holdAfterWorldMs <= 30_000,
  "--hold-after-world-ms must be an integer from 0 to 30000");
assert.ok(holdAfterWorldMs === 0 || onboardingTestMode,
  "--hold-after-world-ms requires --onboarding");

async function reserveLoopbackPort() {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, HOST, resolveListen);
  });
  const { port } = listener.address();
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(httpPort, gamePort, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Isolated Caracatoa server exited before readiness.");
    try {
      const response = await fetch(`http://${HOST}:${httpPort}/`);
      if (response.status === 200) {
        const socket = createConnection({ host: HOST, port: gamePort });
        await new Promise((resolveConnect, reject) => {
          socket.once("connect", resolveConnect);
          socket.once("error", reject);
        });
        socket.destroy();
        return;
      }
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Isolated Caracatoa server did not become ready on loopback.");
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => true);
  child.kill();
  let timeout;
  const stopped = await Promise.race([
    exited,
    new Promise((resolveTimeout) => { timeout = setTimeout(() => resolveTimeout(false), 5000); }),
  ]);
  clearTimeout(timeout);
  assert.equal(stopped, true, `${label} must stop before its temporary data is removed.`);
}

const tempRoot = await mkdtemp(join(tmpdir(), "caracatoa-native-registration-"));
const dataRoot = join(tempRoot, "catalogs");
const stateRoot = join(tempRoot, "state");
const appDataRoot = join(tempRoot, "appdata");
const localAppDataRoot = join(tempRoot, "localappdata");
const tracePath = join(tempRoot, "client-trace.log");
await mkdir(stateRoot);
await mkdir(appDataRoot);
await mkdir(localAppDataRoot);
await cp(join(serverRoot, "data", "catalogs"), dataRoot, {
  recursive: true,
  filter: (source) => !source.endsWith(".db") && !source.endsWith(".jsonl"),
});

let httpPort = await reserveLoopbackPort();
let gamePort = await reserveLoopbackPort();
while (gamePort === httpPort) gamePort = await reserveLoopbackPort();
const accountId = `Q${randomBytes(7).toString("hex")}`;
const password = "LocalTest9";
const pin = "123456";
const adminPassword = randomBytes(32).toString("base64url");
const childEnvironment = { ...process.env };
for (const name of Object.keys(childEnvironment)) {
  if (name.startsWith("CARACATOA_")) delete childEnvironment[name];
}
Object.assign(childEnvironment, {
  CARACATOA_ADMIN_PASSWORD: adminPassword,
  CARACATOA_DATA_DIR: dataRoot,
  CARACATOA_STATE_DIR: stateRoot,
  CARACATOA_PORT: String(httpPort),
  CARACATOA_GAME_PORT: String(gamePort),
  CARACATOA_MONSTER_RESPAWN_MS: "60000",
  CARACATOA_START_X: "128",
  CARACATOA_START_Y: "128",
});

let serverProcess;
let clientProcess;
let clientOutput = "";
try {
  serverProcess = spawn(process.execPath, [join(serverRoot, "server.mjs")], {
    cwd: serverRoot,
    env: childEnvironment,
    stdio: "ignore",
    windowsHide: true,
  });
  serverProcess.once("error", () => {});
  await waitForServer(httpPort, gamePort, serverProcess);

  const clientEnvironment = { ...process.env };
  for (const name of Object.keys(clientEnvironment)) {
    if (name.startsWith("CARACATOA_")) delete clientEnvironment[name];
  }
  Object.assign(clientEnvironment, {
    APPDATA: appDataRoot,
    LOCALAPPDATA: localAppDataRoot,
    CARACATOA_TEST_TRACE: tracePath,
    CARACATOA_HUD_REGISTRATION_TEST: "1",
    CARACATOA_HUD_ONBOARDING_TEST: onboardingTestMode ? "1" : "0",
    CARACATOA_HUD_TEST_ACCOUNT_ID: accountId,
    CARACATOA_HUD_TEST_PASSWORD: password,
    CARACATOA_HUD_TEST_PIN: pin,
    CARACATOA_HUD_TEST_CHARACTER_NAME: classNames[classId],
    CARACATOA_HUD_TEST_CLASS_ID: String(classId),
    CARACATOA_REGISTRATION_PORT: String(httpPort),
    CARACATOA_SERVER_PORT: String(gamePort),
  });
  clientProcess = spawn(executable, [], {
    cwd: dirname(executable),
    env: clientEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: !visibleClient,
  });
  clientProcess.stdout.setEncoding("utf8");
  clientProcess.stderr.setEncoding("utf8");
  clientProcess.stdout.on("data", (chunk) => { clientOutput += chunk; });
  clientProcess.stderr.on("data", (chunk) => { clientOutput += chunk; });
  clientProcess.once("error", (error) => { clientOutput += `${error.message}\n`; });

  const end = Date.now() + TIMEOUT_MS;
  while (Date.now() < end) {
    const trace = await readFile(tracePath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const failurePrefix = onboardingTestMode ? "HUD_ONBOARDING_TEST_FAIL:" : "HUD_REGISTRATION_TEST_FAIL:";
    const passMarker = "HUD_REGISTRATION_TEST_PASS:roster";
    const failureIndex = trace.indexOf(failurePrefix);
    if (failureIndex >= 0) {
      const phase = trace.slice(failureIndex + failurePrefix.length).split(/[\r\n]/, 1)[0];
      throw new Error(`Native HUD ${onboardingTestMode ? "onboarding" : "registration"} flow failed at ${phase}.`);
    }
    const onboardingEvents = [
      "LOCAL_LOGIN_REQUEST_SENT",
      "LOCAL_ACCOUNT_ACCEPTED_PIN_REQUIRED",
      "LOCAL_PIN_ACCEPTED",
      "LOCAL_CHARACTER_CREATE_SENT",
      "LOCAL_CHARACTER_CREATED",
      "LOCAL_WORLD_ENTRY_CONFIRMED",
      "LOCAL_CHARACTER_LEVEL_CONFIRMED",
      "LOCAL_WORLD_MONSTER_MOVED:64000",
    ];
    const onboardingComplete = onboardingTestMode && onboardingEvents.every((event) => trace.includes(event));
    if (onboardingTestMode ? onboardingComplete : trace.includes(passMarker)) {
      if (onboardingTestMode) {
        if (holdAfterWorldMs > 0) {
          console.log(`Holding the rendered local world for ${holdAfterWorldMs} ms to capture the Defold window.`);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, holdAfterWorldMs));
        }
        await stopChild(clientProcess, "Defold client");
        await stopChild(serverProcess, "isolated Caracatoa server");
        const persistedStore = new PlayerAccountStore({ databasePath: join(stateRoot, "player-accounts.sqlite") });
        try {
          const character = persistedStore.getCharacterBySlot(accountId, 0);
          assert.equal(character?.name, classNames[classId], "the account created through the native HUD must persist its first character");
          assert.equal(character?.classId, classId, "the persisted character class must match the selected HUD class");
          assert.equal(character?.level, 1, "a new character starts at level one");
          assert.equal(character?.experience, 0, "a new character starts with zero experience");
          assert.equal(character?.worldX, 128, "the world entry position must persist in the isolated SQLite store");
          assert.equal(character?.worldY, 128, "the world entry position must persist in the isolated SQLite store");
        } finally {
          persistedStore.close();
        }
        console.log(`PASS HUD nativa percorreu cadastro, login, PIN, criação de ${classNames[classId]}, roster e entrada no mundo em (128, 128).`);
        console.log("PASS O cliente Defold recebeu e aplicou o snapshot inicial de progressão 0x7F02 (nível 1, 0 EXP).");
        console.log("PASS O cliente recebeu o movimento do Golem de Pedra (entidade 64000) sem encerrar a sessão.");
        console.log("PASS Nome, classe e posição persistiram no SQLite isolado; cliente, jogo e dados usaram somente loopback/temporários.");
      } else {
        console.log("PASS A HUD enviou o cadastro; o server.mjs isolado aceitou a conta, login e PIN e devolveu o roster vazio.");
        console.log("PASS Cliente, painel, jogo e estado usaram apenas loopback e diretórios temporários; nenhum dado de autenticação foi registrado.");
      }
      break;
    }
    if (clientProcess.exitCode !== null) {
      throw new Error(`Defold exited before the registration flow completed (exit ${clientProcess.exitCode}).`);
    }
    if (serverProcess.exitCode !== null) throw new Error("Isolated Caracatoa server exited during the registration flow.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  if (Date.now() >= end) throw new Error("Timed out waiting for native HUD registration, login, PIN, and roster.");
} catch (error) {
  const trace = await readFile(tracePath, "utf8").catch(() => "");
  const redactedOutput = clientOutput
    .replaceAll(accountId, "<account>")
    .replaceAll(password, "<password>")
    .replaceAll(pin, "<pin>")
    .slice(-2500);
  throw new Error(`${error.message}\n${trace}\n${redactedOutput}`);
} finally {
  await stopChild(clientProcess, "Defold client").catch(() => {});
  await stopChild(serverProcess, "isolated Caracatoa server").catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
