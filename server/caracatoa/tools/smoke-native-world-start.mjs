import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

async function allocateLoopbackPort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const [httpPort, gamePort] = await Promise.all([
  allocateLoopbackPort(),
  allocateLoopbackPort(),
]);
if (httpPort === gamePort) throw new Error("As portas locais coincidiram.");

const isolatedRoot = await mkdtemp(join(tmpdir(), "caracatoa-native-nav-smoke-"));
const child = spawn(process.execPath, [join(APP_DIR, "server.mjs")], {
  cwd: APP_DIR,
  env: {
    ...process.env,
    CARACATOA_PORT: String(httpPort),
    CARACATOA_GAME_PORT: String(gamePort),
    CARACATOA_GAME_ASSET_DIR: "",
    CARACATOA_DATA_DIR: join(APP_DIR, "data", "catalogs"),
    CARACATOA_STATE_DIR: join(isolatedRoot, "state"),
    CARACATOA_ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
  },
  stdio: ["ignore", "pipe", "ignore"],
});

let exited = false;
let sawNativeNavigation = false;
let sawLiveGolemCatalog = false;
let sawGameListener = false;
const stdoutLines = createInterface({ input: child.stdout });
stdoutLines.on("line", (line) => {
  if (line.startsWith("[jogo] navegação Caracatoa ativa: mapa=1,")) {
    sawNativeNavigation = true;
  }
  if (line.startsWith("[jogo] catálogo espacial: 10 mapas, 20 spawns, 1 ativos, 0 suspensos")) {
    sawLiveGolemCatalog = true;
  }
  if (line.startsWith(`Servidor WYD Caracatoa em 127.0.0.1:${gamePort};`)) {
    sawGameListener = true;
  }
});
child.once("close", () => { exited = true; });

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timeout aguardando a inicialização local do jogo.")),
      15000,
    );
    const complete = () => {
      if (!sawNativeNavigation || !sawLiveGolemCatalog || !sawGameListener) return;
      clearTimeout(timeout);
      resolve();
    };
    stdoutLines.on("line", complete);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (sawNativeNavigation && sawLiveGolemCatalog && sawGameListener) return;
      clearTimeout(timeout);
      reject(new Error(`Servidor encerrou antes do bootstrap (código ${code}).`));
    });
    complete();
  });
  console.log(
    `PASS: mapa 001 nativo, Golem ativo e listener loopback iniciaram; ` +
      `HTTP=${httpPort}, jogo=${gamePort}.`,
  );
} finally {
  stdoutLines.close();
  if (!exited) {
    child.kill();
    await new Promise((resolveExit) => {
      const timer = setTimeout(resolveExit, 2000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
    if (!exited) child.kill();
  }
  const tempRoot = resolve(tmpdir());
  const targetRoot = resolve(isolatedRoot);
  if (
    !targetRoot.startsWith(`${tempRoot}${sep}`) ||
    !basename(targetRoot).startsWith("caracatoa-native-nav-smoke-")
  ) {
    throw new Error("Diretório temporário do smoke fora do escopo esperado.");
  }
  await rm(targetRoot, { recursive: true, force: true });
}
