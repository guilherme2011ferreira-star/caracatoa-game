import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createConnection, createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../..");
const serverRoot = join(repoRoot, "server", "caracatoa");
const maxWebSocketMessageBytes = 1024 * 1024;
export const PERSISTENT_LOCAL_PREVIEW_TARGET = Object.freeze({
  host: "127.0.0.1",
  gamePort: 8289,
  registrationPort: 8765,
});

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".data", "application/octet-stream"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".json", "application/json; charset=utf-8"],
  [".ico", "image/x-icon"],
]);

function websocketFrame(opcode, payload = Buffer.alloc(0)) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function closePayload(code, reason = "") {
  const text = Buffer.from(reason, "utf8").subarray(0, 123);
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return payload;
}

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

async function serveStatic(request, response, webRoot, previewInfo) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400).end("Bad request\n");
    return;
  }
  if (pathname.includes("\0")) {
    response.writeHead(400).end("Bad request\n");
    return;
  }
  let target = resolve(webRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
  const rootPrefix = resolve(webRoot) + sep;
  if (target !== resolve(webRoot) && !target.startsWith(rootPrefix)) {
    response.writeHead(404).end("Not found\n");
    return;
  }
  try {
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }
    if (!info.isFile()) throw new Error("not a file");
    const isEntryPoint = pathname === "/" || pathname === "/index.html";
    let entryPoint = null;
    if (isEntryPoint && extname(target).toLowerCase() === ".html") {
      const source = await readFile(target);
      const suffix = previewInfo.mode === "persistent-local"
        ? " · PRÉVIA LOCAL · DADOS PERSISTENTES"
        : ` · PRÉVIA ISOLADA · DADOS TEMPORÁRIOS · ${previewInfo.instanceId}`;
      const html = source.toString("utf8").replace(
        /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i,
        (_match, open, title, close) => `${open}${title.trim()}${suffix}${close}`,
      );
      entryPoint = Buffer.from(html, "utf8");
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES.get(extname(target).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": entryPoint?.length ?? info.size,
      "Cache-Control": extname(target) === ".wasm" ? "public, max-age=3600" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Caracatoa-Preview-Mode": previewInfo.mode,
      "X-Caracatoa-Preview-Instance": previewInfo.instanceId,
    });
    if (request.method === "HEAD") response.end();
    else if (entryPoint) response.end(entryPoint);
    else createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404).end("Not found\n");
  }
}

async function proxyRegistration(request, response, registrationPort) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end("Method not allowed\n");
    return;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) {
      response.writeHead(413).end("Payload too large\n");
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: registrationPort,
      path: "/api/v1/player-registration",
      method: "POST",
      headers: {
        "Content-Type": request.headers["content-type"] ?? "application/json",
        "Content-Length": body.length,
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, {
        "Content-Type": upstreamResponse.headers["content-type"] ?? "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end('{"error":"Servidor local indisponível."}');
  });
  upstream.end(body);
}

function attachWebSocket(socket, gamePort, liveSockets) {
  const upstream = createConnection({ host: "127.0.0.1", port: gamePort });
  liveSockets.add(socket);
  liveSockets.add(upstream);
  let buffer = Buffer.alloc(0);
  let finished = false;

  const shutdown = (closeCode = 1001, reason = "") => {
    if (finished) return;
    finished = true;
    if (!socket.destroyed && socket.writable) socket.write(websocketFrame(0x8, closePayload(closeCode, reason)));
    upstream.destroy();
    socket.end();
  };

  upstream.on("connect", () => {});
  upstream.on("data", (data) => {
    if (!finished && !socket.destroyed) socket.write(websocketFrame(0x2, data));
  });
  upstream.on("error", () => shutdown(1011, "Local game service unavailable"));
  upstream.on("end", () => shutdown(1001, "Local game service closed"));
  upstream.on("close", () => liveSockets.delete(upstream));
  socket.on("data", (chunk) => {
    if (finished) return;
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!fin || !masked) return shutdown(1002, "Invalid local frame");
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const longLength = buffer.readBigUInt64BE(2);
        if (longLength > BigInt(maxWebSocketMessageBytes)) return shutdown(1009, "Local frame too large");
        length = Number(longLength);
        offset = 10;
      }
      if (length > maxWebSocketMessageBytes) return shutdown(1009, "Local frame too large");
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];

      if (opcode === 0x8) {
        if (!socket.destroyed) socket.write(websocketFrame(0x8, payload));
        finished = true;
        upstream.end();
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        if (!socket.destroyed) socket.write(websocketFrame(0x0a, payload));
        continue;
      }
      if (opcode === 0x2 && payload.length > 0) {
        if (!upstream.destroyed && !upstream.write(payload)) socket.pause();
        continue;
      }
      if (opcode === 0x2 && payload.length === 0) continue;
      return shutdown(1003, "Binary frames only");
    }
  });
  upstream.on("drain", () => socket.resume());
  socket.on("error", () => {
    finished = true;
    upstream.destroy();
  });
  socket.on("close", () => {
    liveSockets.delete(socket);
    if (!finished) upstream.destroy();
  });
}

export function createWebPreviewServer({
  webRoot,
  gamePort,
  registrationPort,
  host = "127.0.0.1",
  port = 0,
  previewMode = "isolated",
} = {}) {
  if (previewMode !== "isolated" && previewMode !== "persistent-local") {
    throw new TypeError("previewMode must be isolated or persistent-local");
  }
  const previewInfo = Object.freeze({
    mode: previewMode,
    instanceId: randomBytes(3).toString("hex").toUpperCase(),
  });
  const liveSockets = new Set();
  const server = createHttpServer((request, response) => {
    if (request.url?.split("?", 1)[0] === "/api/v1/player-registration") {
      void proxyRegistration(request, response, registrationPort);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed\n");
      return;
    }
    void serveStatic(request, response, webRoot, previewInfo);
  });
  server.on("upgrade", (request, socket) => {
    const origin = request.headers.origin;
    let sameLoopbackOrigin = false;
    try {
      const parsed = new URL(origin ?? "");
      const expectedPort = String(server.address()?.port ?? port);
      sameLoopbackOrigin =
        ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
        parsed.port === expectedPort &&
        parsed.protocol === "http:";
    } catch {}
    if (
      request.url !== "/game" ||
      !sameLoopbackOrigin ||
      request.headers["sec-websocket-version"] !== "13" ||
      typeof request.headers["sec-websocket-key"] !== "string"
    ) {
      rejectUpgrade(socket, "403 Forbidden", "Forbidden");
      return;
    }
    const key = request.headers["sec-websocket-key"];
    let decodedKey;
    try {
      decodedKey = Buffer.from(key, "base64");
    } catch {}
    if (!decodedKey || decodedKey.length !== 16) {
      rejectUpgrade(socket, "400 Bad Request", "Bad WebSocket key");
      return;
    }
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    attachWebSocket(socket, gamePort, liveSockets);
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  const listen = () => new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolveListen(server.address());
    });
  });
  const close = async () => {
    for (const socket of liveSockets) socket.destroy();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  };
  return { server, listen, close, previewInfo };
}

export function createPersistentLocalPreviewServer({
  webRoot,
  port = 0,
  gamePort = PERSISTENT_LOCAL_PREVIEW_TARGET.gamePort,
  registrationPort = PERSISTENT_LOCAL_PREVIEW_TARGET.registrationPort,
} = {}) {
  return createWebPreviewServer({
    webRoot,
    port,
    gamePort,
    registrationPort,
    host: PERSISTENT_LOCAL_PREVIEW_TARGET.host,
    previewMode: "persistent-local",
  });
}

function freeLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForLocalGame(gamePort, registrationPort, child = null) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child && child.exitCode !== null) throw new Error("O servidor Caracatoa encerrou antes de ficar pronto.");
    try {
      const response = await fetch(`http://127.0.0.1:${registrationPort}/`);
      if (response.status === 200) {
        const client = createConnection({ host: "127.0.0.1", port: gamePort });
        await new Promise((resolveConnect, reject) => {
          client.once("connect", resolveConnect);
          client.once("error", reject);
        });
        client.destroy();
        return;
      }
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`O servidor Caracatoa em loopback não ficou pronto nas portas ${registrationPort}/${gamePort}.`);
}

async function runPersistentLocalPreview(webRoot) {
  const { gamePort, registrationPort } = PERSISTENT_LOCAL_PREVIEW_TARGET;
  await waitForLocalGame(gamePort, registrationPort);
  const bridge = createPersistentLocalPreviewServer({ webRoot });
  try {
    const address = await bridge.listen();
    console.log(`Prévia HTML5 Caracatoa · dados persistentes [${bridge.previewInfo.instanceId}]: http://127.0.0.1:${address.port}/`);
    console.log(`Cadastro, personagens e progresso usam 127.0.0.1:${registrationPort}/${gamePort}.`);
    console.log("Ao encerrar, somente a ponte da prévia fecha; o servidor e os dados persistentes continuam ativos.");
    await new Promise((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
    });
  } finally {
    await bridge.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const persistentLocal = args[0] === "--persistent-local";
  const defaultWebRoot = join(repoRoot, "work", "caracatoa-defold-prototype", "build-stage1-html5", "bundle", "Caracatoa 3D Preview");
  const webRoot = resolve((persistentLocal ? args[1] : args[0]) ?? defaultWebRoot);
  const webIndex = join(webRoot, "index.html");
  await stat(webIndex);
  if (persistentLocal) {
    await runPersistentLocalPreview(webRoot);
    return;
  }
  const tempRoot = await mkdtemp(join(tmpdir(), "caracatoa-html5-preview-"));
  const dataRoot = join(tempRoot, "catalogs");
  const stateRoot = join(tempRoot, "state");
  const sourceCatalogs = join(serverRoot, "data", "catalogs");
  await mkdir(stateRoot, { recursive: true });
  await cp(sourceCatalogs, dataRoot, { recursive: true, filter: (source) => !source.endsWith(".db") && !source.endsWith(".jsonl") });
  const gamePort = await freeLoopbackPort();
  const registrationPort = await freeLoopbackPort();
  let childEnvironment = { ...process.env };
  for (const name of Object.keys(childEnvironment)) {
    if (name.startsWith("CARACATOA_")) delete childEnvironment[name];
  }
  Object.assign(childEnvironment, {
    CARACATOA_ADMIN_PASSWORD: randomBytes(32).toString("base64url"),
    CARACATOA_DATA_DIR: dataRoot,
    CARACATOA_STATE_DIR: stateRoot,
    CARACATOA_PORT: String(registrationPort),
    CARACATOA_GAME_PORT: String(gamePort),
    CARACATOA_MONSTER_RESPAWN_MS: "60000",
    CARACATOA_START_X: "128",
    CARACATOA_START_Y: "128",
  });
  const child = spawn(process.execPath, [join(serverRoot, "server.mjs")], {
    cwd: serverRoot,
    env: childEnvironment,
    stdio: "ignore",
    windowsHide: true,
  });
  childEnvironment.CARACATOA_ADMIN_PASSWORD = "";
  childEnvironment = null;
  let bridge;
  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (bridge) await bridge.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 5000)),
      ]);
    }
    await rm(tempRoot, { recursive: true, force: true });
  };
  try {
    child.once("error", () => {});
    await waitForLocalGame(gamePort, registrationPort, child);
    bridge = createWebPreviewServer({ webRoot, gamePort, registrationPort });
    const address = await bridge.listen();
    console.log(`Prévia HTML5 Caracatoa · dados temporários [${bridge.previewInfo.instanceId}]: http://127.0.0.1:${address.port}/`);
    console.log("Servidor isolado: loopback; conta, PIN e personagens ficam temporários.");
    console.log("Parar esta sessão encerra o servidor e remove o estado temporário.");
    await new Promise((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
      child.once("exit", resolveStop);
    });
  } finally {
    await cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
