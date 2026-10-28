import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { clientHandshake, decodeFrame, encodeFrame } from "../../server/caracatoa/protocol.mjs";
import { computeWyd727ClineVersion } from "../../server/caracatoa/wyd-727-character-entry.mjs";
import { createWebPreviewServer } from "./web-preview-server.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverRoot = join(repoRoot, "server", "caracatoa");
const bridgeInjectorPath = join(repoRoot, "work", "caracatoa-defold-prototype", "tools", "inject-caracatoa-html5-bridge.mjs");

async function readInjectedBridgeSource() {
  const injector = await readFile(bridgeInjectorPath, "utf8");
  const marker = "const bridge = String.raw`";
  const markerIndex = injector.indexOf(marker);
  assert.notEqual(markerIndex, -1, "HTML5 bridge injector must contain the production browser bridge");
  const sourceStart = markerIndex + marker.length;
  const sourceEnd = injector.indexOf("`;", sourceStart);
  assert.notEqual(sourceEnd, -1, "HTML5 browser bridge template must be terminated");
  return injector.slice(sourceStart, sourceEnd)
    .replace(/^\s*<script>\s*/, "")
    .replace(/\s*<\/script>\s*$/, "");
}

function waitForRegistrationBridge(bridge, requestId) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const serialized = bridge.pollRegistration(requestId);
      if (serialized) {
        const result = JSON.parse(serialized);
        if (result.completed) return resolve(result);
      }
      if (Date.now() - startedAt >= 4000) return reject(new Error("Browser bridge registration did not complete."));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(httpPort, gamePort, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error("Isolated Caracatoa server exited before readiness.");
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/`);
      if (response.status === 200) {
        const socket = createConnection({ host: "127.0.0.1", port: gamePort });
        await new Promise((resolveConnect, reject) => {
          socket.once("connect", resolveConnect);
          socket.once("error", reject);
        });
        socket.destroy();
        return;
      }
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 125));
  }
  throw new Error("Isolated Caracatoa server did not become ready on loopback.");
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => true);
  child.kill();
  let timeout;
  const stopped = await Promise.race([
    exited,
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5000); }),
  ]);
  clearTimeout(timeout);
  assert.equal(stopped, true, "Isolated Caracatoa server must stop before restart.");
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
  return (opcode) => {
    const index = frames.findIndex((entry) => entry.body.readUInt16LE(0) === opcode);
    if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { opcode, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        const queued = frames.map((entry) => `0x${entry.body.readUInt16LE(0).toString(16)}`);
        reject(new Error(
          `Timed out waiting for Caracatoa response 0x${opcode.toString(16)}; ` +
          `queued opcodes=${queued.join(",") || "none"}.`,
        ));
      }, 4000);
      waiters.push(waiter);
    });
  };
}

function browserBridgeFrameReader(bridge, getDiagnostic = () => "") {
  let pending = Buffer.alloc(0);
  const frames = [];
  const waiters = [];
  let bridgeError = null;
  const pollTimer = setInterval(() => {
    let events;
    try {
      events = JSON.parse(bridge.poll());
    } catch (error) {
      bridgeError = error;
      return;
    }
    for (const event of events) {
      if (event.type === "close" || event.type === "error") {
        bridgeError = new Error(`Production HTML5 bridge emitted ${event.type} before session response. ${getDiagnostic()}`);
      }
      if (event.type !== "message") continue;
      pending = Buffer.concat([pending, Buffer.from(event.hex, "hex")]);
      while (pending.length >= 4) {
        const length = pending.readUInt16LE(0);
        if (length < 12) {
          bridgeError = new Error("Production HTML5 bridge returned an invalid game frame length.");
          pending = Buffer.alloc(0);
          break;
        }
        if (pending.length < length) break;
        const decoded = decodeFrame(pending.subarray(0, length));
        assert.equal(decoded.ok, true, decoded.error);
        frames.push(decoded.frame);
        pending = pending.subarray(length);
      }
    }
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const frameIndex = frames.findIndex((entry) => entry.body.readUInt16LE(0) === waiter.opcode);
      if (frameIndex >= 0) {
        clearTimeout(waiter.timer);
        const [frame] = frames.splice(frameIndex, 1);
        waiters.splice(index, 1);
        waiter.resolve(frame);
      } else if (bridgeError) {
        clearTimeout(waiter.timer);
        waiters.splice(index, 1);
        waiter.reject(bridgeError);
      }
    }
  }, 10);
  return {
    waitFor(opcode) {
      const frameIndex = frames.findIndex((entry) => entry.body.readUInt16LE(0) === opcode);
      if (frameIndex >= 0) return Promise.resolve(frames.splice(frameIndex, 1)[0]);
      if (bridgeError) return Promise.reject(bridgeError);
      return new Promise((resolve, reject) => {
        const waiter = { opcode, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for bridge response 0x${opcode.toString(16)}.`));
        }, 4000);
        waiters.push(waiter);
      });
    },
    close() {
      clearInterval(pollTimer);
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Bridge frame reader closed."));
      }
    },
  };
}

function createBrowserWebSocketConstructor(origin) {
  return class LocalBrowserWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static lastDiagnostic = "";

    constructor(endpoint) {
      this.readyState = LocalBrowserWebSocket.CONNECTING;
      this.binaryType = "blob";
      this.buffer = Buffer.alloc(0);
      this.upgraded = false;
      this.socket = createConnection({ host: "127.0.0.1", port: Number(new URL(endpoint).port) });
      this.key = randomBytes(16).toString("base64");
      this.socket.once("connect", () => {
        this.socket.write(
          `GET /game HTTP/1.1\r\nHost: 127.0.0.1:${new URL(endpoint).port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${this.key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`,
        );
      });
      this.socket.on("data", (chunk) => this.#onData(chunk));
      this.socket.on("error", (error) => {
        LocalBrowserWebSocket.lastDiagnostic = `local WebSocket socket error ${error.code ?? error.name}`;
        if (this.readyState !== LocalBrowserWebSocket.CLOSED) this.onerror?.({ type: "error" });
      });
      this.socket.on("close", () => this.#finishClose(1006, "socket closed"));
    }

    send(value) {
      if (this.readyState !== LocalBrowserWebSocket.OPEN) throw new Error("WebSocket is not open");
      const payload = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      const mask = randomBytes(4);
      let header;
      if (payload.length < 126) {
        header = Buffer.from([0x82, 0x80 | payload.length]);
      } else if (payload.length <= 0xffff) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      const masked = Buffer.from(payload);
      for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index & 3];
      this.socket.write(Buffer.concat([header, mask, masked]));
    }

    close(code = 1000, reason = "") {
      if (this.readyState >= LocalBrowserWebSocket.CLOSING) return;
      this.readyState = LocalBrowserWebSocket.CLOSING;
      const reasonBytes = Buffer.from(reason);
      const payload = Buffer.alloc(2 + reasonBytes.length);
      payload.writeUInt16BE(code, 0);
      reasonBytes.copy(payload, 2);
      const mask = randomBytes(4);
      const masked = Buffer.from(payload);
      for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index & 3];
      this.socket.end(Buffer.concat([Buffer.from([0x88, 0x80 | payload.length]), mask, masked]));
      this.#finishClose(code, reason);
    }

    #finishClose(code, reason) {
      if (this.readyState === LocalBrowserWebSocket.CLOSED) return;
      this.readyState = LocalBrowserWebSocket.CLOSED;
      LocalBrowserWebSocket.lastDiagnostic = `local WebSocket closed ${code}${reason ? `: ${reason}` : ""}`;
      this.onclose?.({ code, reason });
    }

    #onData(chunk) {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (!this.upgraded) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const response = this.buffer.subarray(0, headerEnd).toString("latin1");
        const expectedAccept = createHash("sha1")
          .update(`${this.key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        if (!response.startsWith("HTTP/1.1 101 ") || !response.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
          LocalBrowserWebSocket.lastDiagnostic = `local WebSocket upgrade rejected: ${response.split("\r\n", 1)[0]}`;
          this.onerror?.({ type: "error" });
          this.socket.destroy();
          return;
        }
        this.buffer = this.buffer.subarray(headerEnd + 4);
        this.upgraded = true;
        this.readyState = LocalBrowserWebSocket.OPEN;
        this.onopen?.({ type: "open" });
      }
      while (this.buffer.length >= 2) {
        const opcode = this.buffer[0] & 0x0f;
        const masked = (this.buffer[1] & 0x80) !== 0;
        let length = this.buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (this.buffer.length < 4) return;
          length = this.buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (this.buffer.length < 10) return;
          const longLength = this.buffer.readBigUInt64BE(2);
          if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large in test harness");
          length = Number(longLength);
          offset = 10;
        }
        const maskBytes = masked ? 4 : 0;
        if (this.buffer.length < offset + maskBytes + length) return;
        const payload = Buffer.from(this.buffer.subarray(offset + maskBytes, offset + maskBytes + length));
        if (masked) {
          const mask = this.buffer.subarray(offset, offset + 4);
          for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3];
        }
        this.buffer = this.buffer.subarray(offset + maskBytes + length);
        if (opcode === 0x2) {
          const exact = Uint8Array.from(payload);
          this.onmessage?.({ data: exact.buffer });
        } else if (opcode === 0x8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
          const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
          this.#finishClose(code, reason);
          return;
        } else if (opcode === 0x9) {
          const mask = randomBytes(4);
          const maskedPayload = Buffer.from(payload);
          for (let index = 0; index < maskedPayload.length; index += 1) maskedPayload[index] ^= mask[index & 3];
          this.socket.write(Buffer.concat([Buffer.from([0x8a, 0x80 | payload.length]), mask, maskedPayload]));
        }
      }
    }
  };
}

function loginBody(accountId, password) {
  const body = Buffer.alloc(120);
  body.writeUInt16LE(0x20d, 0);
  body.writeUInt16LE(0, 2);
  body.writeUInt32LE(0x10203040, 4);
  Buffer.from(password, "ascii").copy(body, 8);
  Buffer.from(accountId, "ascii").copy(body, 20);
  body.writeUInt32LE(0x0c9c9301, 88);
  body.writeInt32LE(1, 92);
  return body;
}

function tokenBody(clientId, token) {
  const body = Buffer.alloc(28);
  body.writeUInt16LE(0xfde, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(0x10203040, 4);
  Buffer.from(token, "ascii").copy(body, 8);
  body.writeInt32LE(0, 24);
  return body;
}

test("HTML5 registration creates an account that authenticates through the game listener", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "caracatoa-preview-registration-"));
  const webRoot = join(tempRoot, "web");
  const dataRoot = join(tempRoot, "catalogs");
  const stateRoot = join(tempRoot, "state");
  await mkdir(webRoot);
  await mkdir(stateRoot);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Caracatoa registration integration</title>");
  await writeFile(join(webRoot, "engine.wasm"), Buffer.from([0, 97, 115, 109]));
  await cp(join(serverRoot, "data", "catalogs"), dataRoot, {
    recursive: true,
    filter: (source) => !source.endsWith(".db") && !source.endsWith(".jsonl"),
  });

  const registrationPort = await reserveLoopbackPort();
  let gamePort = await reserveLoopbackPort();
  while (gamePort === registrationPort) gamePort = await reserveLoopbackPort();
  const childEnvironment = { ...process.env };
  for (const name of Object.keys(childEnvironment)) {
    if (name.startsWith("CARACATOA_")) delete childEnvironment[name];
  }
  const adminPassword = randomBytes(32).toString("base64url");
  Object.assign(childEnvironment, {
    CARACATOA_ADMIN_PASSWORD: adminPassword,
    CARACATOA_DATA_DIR: dataRoot,
    CARACATOA_STATE_DIR: stateRoot,
    CARACATOA_PORT: String(registrationPort),
    CARACATOA_GAME_PORT: String(gamePort),
    CARACATOA_MONSTER_RESPAWN_MS: "60000",
    CARACATOA_START_X: "128",
    CARACATOA_START_Y: "128",
  });
  const spawnIsolatedServer = () => {
    const child = spawn(process.execPath, [join(serverRoot, "server.mjs")], {
      cwd: serverRoot,
      env: { ...childEnvironment, CARACATOA_ADMIN_PASSWORD: adminPassword },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => {});
    return child;
  };
  let child = spawnIsolatedServer();

  let bridge;
  let socket;
  let staleSocket;
  try {
    await waitForServer(registrationPort, gamePort, child);
    bridge = createWebPreviewServer({ webRoot, gamePort, registrationPort });
    const address = await bridge.listen();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const accountId = `C${randomBytes(6).toString("hex")}`;
    const payload = JSON.stringify({ accountId, password: "TestPass9", token: "123456" });
    const bridgeFetchErrors = [];
    const bridgeContext = {
      window: { location: { origin: baseUrl } },
      TextEncoder,
      ArrayBuffer,
      Uint8Array,
      WebSocket: createBrowserWebSocketConstructor(baseUrl),
      fetch: (url, request) => {
        try {
          return fetch(new URL(url, baseUrl), request).catch((error) => {
            bridgeFetchErrors.push(`${error.name}: ${error.message}`);
            throw error;
          });
        } catch (error) {
          bridgeFetchErrors.push(`${error.name}: ${error.message}`);
          throw error;
        }
      },
    };
    new Script(await readInjectedBridgeSource(), { filename: "caracatoa-html5-bridge.js" }).runInNewContext(bridgeContext);
    const browserBridge = bridgeContext.window.CaracatoaLocalBridge;
    const payloadHex = Buffer.from(payload).toString("hex");
    assert.equal(browserBridge.registerHex(payloadHex, 1), true, "The production browser bridge must queue account creation.");
    const created = await waitForRegistrationBridge(browserBridge, 1);
    assert.equal(created.status, 201, bridgeFetchErrors.join("; "));
    const result = JSON.parse(Buffer.from(created.bodyHex, "hex").toString("utf8"));
    assert.equal(result.registered, true);
    assert.equal(result.accountId, accountId.toLowerCase());
    assert.equal(browserBridge.acknowledgeRegistration(1), true);

    const browserFrames = browserBridgeFrameReader(browserBridge, () => bridgeContext.WebSocket.lastDiagnostic);
    try {
      assert.equal(browserBridge.connect(), true, "The production HTML5 bridge must open the game tunnel.");
      assert.equal(browserBridge.sendHex(clientHandshake().toString("hex")), true, "The bridge must queue the public client handshake.");
      assert.equal(
        browserBridge.sendHex(encodeFrame(loginBody(accountId, "TestPass9"), 0x5a).toString("hex")),
        true,
        "The bridge must queue the same account login frame used by the HTML5 client.",
      );
      const browserLogin = await browserFrames.waitFor(0x10a);
      const browserClientId = browserLogin.body.readUInt16LE(2);
      assert.ok(browserClientId > 0, "A newly registered account must authenticate through the production WebSocket tunnel.");
      assert.equal(browserLogin.body.length + 4, 2808);

      const browserPin = tokenBody(browserClientId, "123456");
      browserBridge.sendHex(encodeFrame(browserPin, browserLogin.body[8] ^ 0xff).toString("hex"));
      const browserPinResult = await browserFrames.waitFor(0xfde);
      assert.equal(browserPinResult.body.length + 4, 12);
      assert.equal(browserPinResult.body.readUInt32LE(4), 0, "The newly registered account PIN must be accepted through WebSocket.");
      const browserRoster = await browserFrames.waitFor(0x110);
      assert.equal(browserRoster.body.length + 4, 1224);
    } finally {
      browserFrames.close();
      browserBridge.close();
      await new Promise((resolveClose) => setTimeout(resolveClose, 25));
    }

    socket = createConnection({ host: "127.0.0.1", port: gamePort });
    await once(socket, "connect");
    const nextFrame = frameReader(socket);
    socket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(loginBody(accountId, "WrongPass9"), 0x31),
    ]));
    const deniedLogin = await nextFrame(0x105);
    assert.equal(deniedLogin.body.length + 4, 16);

    const login = loginBody(accountId, "TestPass9");
    socket.write(encodeFrame(login, 0x32));
    const acceptedLogin = await nextFrame(0x10a);
    const clientId = acceptedLogin.body.readUInt16LE(2);
    assert.ok(clientId > 0, "The registered account must authenticate through the game listener.");
    assert.equal(acceptedLogin.body.length + 4, 2808);

    const tokenSeed = acceptedLogin.body[8] ^ 0xff;
    socket.write(encodeFrame(tokenBody(clientId, "123456"), tokenSeed));
    const acceptedPin = await nextFrame(0xfde);
    assert.equal(acceptedPin.body.length + 4, 12);
    const roster = await nextFrame(0x110);
    assert.equal(roster.body.length + 4, 1224);

    const characterName = `Hero${randomBytes(4).toString("hex")}`;
    const characterRequest = Buffer.alloc(32);
    characterRequest.writeUInt16LE(0x7f00, 0);
    characterRequest.writeUInt16LE(clientId, 2);
    characterRequest.writeUInt32LE(0x10203040, 4);
    characterRequest.writeUInt16LE(1, 8);
    characterRequest.writeUInt8(0, 10);
    characterRequest.writeUInt8(0, 11);
    characterRequest.writeUInt8(characterName.length, 12);
    Buffer.from(characterName, "ascii").copy(characterRequest, 14);
    socket.write(encodeFrame(characterRequest, 0x42));
    const characterCreated = await nextFrame(0x7f01);
    assert.equal(characterCreated.body.length + 4, 16);
    assert.equal(characterCreated.body.readUInt8(9), 0);
    const createdRoster = await nextFrame(0x110);
    assert.equal(
      createdRoster.body.subarray(28, 44).toString("ascii").replace(/\0.*$/s, ""),
      characterName,
    );

    const enterRequest = Buffer.alloc(32);
    enterRequest.writeUInt16LE(0x213, 0);
    enterRequest.writeUInt16LE(clientId, 2);
    enterRequest.writeUInt32LE(0x10203040, 4);
    enterRequest.writeInt32LE(0, 8);
    enterRequest.writeUInt32LE(computeWyd727ClineVersion(1), 16);
    socket.write(encodeFrame(enterRequest, 0x43));
    const worldEntry = await nextFrame(0x114);
    assert.equal(worldEntry.body.length + 4, 2104);
    assert.equal(
      worldEntry.body.subarray(12, 28).toString("ascii").replace(/\0.*$/s, ""),
      characterName,
    );

    staleSocket = createConnection({ host: "127.0.0.1", port: gamePort });
    await once(staleSocket, "connect");
    const staleReader = frameReader(staleSocket);
    staleSocket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(loginBody(accountId, "TestPass9"), 0x50),
    ]));
    const staleLogin = await staleReader(0x10a);
    const staleClientId = staleLogin.body.readUInt16LE(2);
    staleSocket.write(encodeFrame(
      tokenBody(staleClientId, "123456"),
      staleLogin.body[8] ^ 0xff,
    ));
    await staleReader(0xfde);
    await staleReader(0x110);
    const staleEntry = Buffer.alloc(32);
    staleEntry.writeUInt16LE(0x213, 0);
    staleEntry.writeUInt16LE(staleClientId, 2);
    staleEntry.writeUInt32LE(0x10203040, 4);
    staleEntry.writeInt32LE(0, 8);
    staleEntry.writeUInt32LE(computeWyd727ClineVersion(1), 16);
    staleSocket.write(encodeFrame(staleEntry, 0x51));
    const staleWorldEntry = await staleReader(0x114);
    assert.deepEqual(
      { x: staleWorldEntry.body.readInt16LE(8), y: staleWorldEntry.body.readInt16LE(10) },
      { x: 128, y: 128 },
      "Both sessions must start from the same persisted position before the race.",
    );

    const movementRequest = Buffer.alloc(48);
    movementRequest.writeUInt16LE(0x36c, 0);
    movementRequest.writeUInt16LE(clientId, 2);
    movementRequest.writeUInt32LE(0x10203041, 4);
    movementRequest.writeInt16LE(128, 8);
    movementRequest.writeInt16LE(128, 10);
    movementRequest.writeUInt32LE(0, 12);
    movementRequest.writeUInt32LE(3, 16);
    movementRequest.writeUInt8(0x36, 20);
    movementRequest.writeInt16LE(129, 44);
    movementRequest.writeInt16LE(128, 46);
    socket.write(encodeFrame(movementRequest, 0x44));
    const acceptedMovement = await nextFrame(0x366);
    assert.deepEqual(
      {
        fromX: acceptedMovement.body.readInt16LE(8),
        fromY: acceptedMovement.body.readInt16LE(10),
        toX: acceptedMovement.body.readInt16LE(44),
        toY: acceptedMovement.body.readInt16LE(46),
      },
      { fromX: 128, fromY: 128, toX: 129, toY: 128 },
      "The authoritative server must accept and persist the one-tile move.",
    );

    const staleMovementRequest = Buffer.alloc(48);
    staleMovementRequest.writeUInt16LE(0x36c, 0);
    staleMovementRequest.writeUInt16LE(staleClientId, 2);
    staleMovementRequest.writeUInt32LE(0x10203042, 4);
    staleMovementRequest.writeInt16LE(128, 8);
    staleMovementRequest.writeInt16LE(128, 10);
    staleMovementRequest.writeUInt32LE(0, 12);
    staleMovementRequest.writeUInt32LE(3, 16);
    staleMovementRequest.writeUInt8(0x34, 20);
    staleMovementRequest.writeInt16LE(127, 44);
    staleMovementRequest.writeInt16LE(128, 46);
    staleSocket.write(encodeFrame(staleMovementRequest, 0x52));
    const correctedStaleMovement = await staleReader(0x366);
    assert.deepEqual(
      {
        fromX: correctedStaleMovement.body.readInt16LE(8),
        fromY: correctedStaleMovement.body.readInt16LE(10),
        toX: correctedStaleMovement.body.readInt16LE(44),
        toY: correctedStaleMovement.body.readInt16LE(46),
      },
      { fromX: 129, fromY: 128, toX: 129, toY: 128 },
      "A stale concurrent session must be corrected to the latest persisted position.",
    );

    const postCorrectionMovement = Buffer.alloc(48);
    postCorrectionMovement.writeUInt16LE(0x36c, 0);
    postCorrectionMovement.writeUInt16LE(staleClientId, 2);
    postCorrectionMovement.writeUInt32LE(0x10203043, 4);
    postCorrectionMovement.writeInt16LE(129, 8);
    postCorrectionMovement.writeInt16LE(128, 10);
    postCorrectionMovement.writeUInt32LE(0, 12);
    postCorrectionMovement.writeUInt32LE(3, 16);
    postCorrectionMovement.writeUInt8(0x38, 20);
    postCorrectionMovement.writeInt16LE(129, 44);
    postCorrectionMovement.writeInt16LE(129, 46);
    staleSocket.write(encodeFrame(postCorrectionMovement, 0x53));
    const acceptedPostCorrectionMovement = await staleReader(0x366);
    assert.deepEqual(
      {
        fromX: acceptedPostCorrectionMovement.body.readInt16LE(8),
        fromY: acceptedPostCorrectionMovement.body.readInt16LE(10),
        toX: acceptedPostCorrectionMovement.body.readInt16LE(44),
        toY: acceptedPostCorrectionMovement.body.readInt16LE(46),
      },
      { fromX: 129, fromY: 128, toX: 129, toY: 129 },
      "The corrected session must accept its next move from the synchronized position.",
    );

    const forgedMovementRequest = Buffer.alloc(48);
    forgedMovementRequest.writeUInt16LE(0x36c, 0);
    forgedMovementRequest.writeUInt16LE(staleClientId, 2);
    forgedMovementRequest.writeUInt32LE(0x10203044, 4);
    forgedMovementRequest.writeInt16LE(129, 8);
    forgedMovementRequest.writeInt16LE(129, 10);
    forgedMovementRequest.writeUInt32LE(0, 12);
    forgedMovementRequest.writeUInt32LE(3, 16);
    forgedMovementRequest.writeUInt8(0x36, 20);
    forgedMovementRequest.writeInt16LE(130, 44);
    forgedMovementRequest.writeInt16LE(130, 46);
    staleSocket.write(encodeFrame(forgedMovementRequest, 0x54));
    const correctedForgedMovement = await staleReader(0x366);
    assert.deepEqual(
      {
        fromX: correctedForgedMovement.body.readInt16LE(8),
        fromY: correctedForgedMovement.body.readInt16LE(10),
        toX: correctedForgedMovement.body.readInt16LE(44),
        toY: correctedForgedMovement.body.readInt16LE(46),
      },
      { fromX: 129, fromY: 129, toX: 129, toY: 129 },
      "A forged destiny must be corrected without changing the authoritative position.",
    );

    const staleSocketClosed = once(staleSocket, "close");
    staleSocket.destroy();
    await staleSocketClosed;
    staleSocket = null;

    assert.equal(browserBridge.registerHex(payloadHex, 2), true, "The bridge must accept a second request ID after acknowledgement.");
    const duplicate = await waitForRegistrationBridge(browserBridge, 2);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(
      JSON.parse(Buffer.from(duplicate.bodyHex, "hex").toString("utf8")),
      { error: "Já existe uma conta com esse ID." },
    );
    assert.equal(browserBridge.acknowledgeRegistration(2), true);

    const invalidPayload = JSON.stringify({ accountId: "bad id", password: "TestPass9", token: "123456" });
    assert.equal(browserBridge.registerHex(Buffer.from(invalidPayload).toString("hex"), 3), true);
    const invalidThroughBridge = await waitForRegistrationBridge(browserBridge, 3);
    assert.equal(invalidThroughBridge.status, 400);
    assert.deepEqual(
      JSON.parse(Buffer.from(invalidThroughBridge.bodyHex, "hex").toString("utf8")),
      { error: "ID deve ter de 1 a 15 letras, números, ponto, hífen ou sublinhado." },
    );
    assert.equal(browserBridge.acknowledgeRegistration(3), true);

    for (let attempt = 0; attempt < 2; attempt++) {
      const invalid = await fetch(`${baseUrl}/api/v1/player-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: invalidPayload,
      });
      assert.equal(invalid.status, 400);
    }

    assert.equal(browserBridge.registerHex(payloadHex, 4), true);
    const throttled = await waitForRegistrationBridge(browserBridge, 4);
    assert.equal(throttled.status, 429);
    assert.deepEqual(
      JSON.parse(Buffer.from(throttled.bodyHex, "hex").toString("utf8")),
      { error: "Muitas tentativas de cadastro. Aguarde alguns minutos." },
    );
    assert.equal(browserBridge.acknowledgeRegistration(4), true);

    await new Promise((resolveClose) => {
      socket.once("close", resolveClose);
      socket.destroy();
    });
    socket = null;
    await stopServer(child);
    child = spawnIsolatedServer();
    await waitForServer(registrationPort, gamePort, child);

    socket = createConnection({ host: "127.0.0.1", port: gamePort });
    await once(socket, "connect");
    const afterRestart = frameReader(socket);
    socket.write(Buffer.concat([
      clientHandshake(),
      encodeFrame(loginBody(accountId, "TestPass9"), 0x34),
    ]));
    const restartedLogin = await afterRestart(0x10a);
    const restartedClientId = restartedLogin.body.readUInt16LE(2);
    socket.write(encodeFrame(
      tokenBody(restartedClientId, "123456"),
      restartedLogin.body[8] ^ 0xff,
    ));
    await afterRestart(0xfde);
    const restartedRoster = await afterRestart(0x110);
    assert.equal(
      restartedRoster.body.subarray(28, 44).toString("ascii").replace(/\0.*$/s, ""),
      characterName,
      "Character roster must survive a full server process restart.",
    );

    const restartEntry = Buffer.alloc(32);
    restartEntry.writeUInt16LE(0x213, 0);
    restartEntry.writeUInt16LE(restartedClientId, 2);
    restartEntry.writeUInt32LE(0x10203040, 4);
    restartEntry.writeInt32LE(0, 8);
    restartEntry.writeUInt32LE(computeWyd727ClineVersion(1), 16);
    socket.write(encodeFrame(restartEntry, 0x35));
    const worldAfterRestart = await afterRestart(0x114);
    assert.equal(
      worldAfterRestart.body.subarray(12, 28).toString("ascii").replace(/\0.*$/s, ""),
      characterName,
      "World entry must restore the character after a full server process restart.",
    );
    assert.deepEqual(
      { x: worldAfterRestart.body.readInt16LE(8), y: worldAfterRestart.body.readInt16LE(10) },
      { x: 129, y: 129 },
      "The restarted server must restore the last accepted character position.",
    );
  } finally {
    staleSocket?.destroy();
    socket?.destroy();
    if (bridge) await bridge.close();
    await stopServer(child).catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
});
