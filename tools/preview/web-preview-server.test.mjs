import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPersistentLocalPreviewServer,
  createWebPreviewServer,
} from "./web-preview-server.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

function clientFrame(payload) {
  const bytes = Buffer.from(payload);
  const mask = randomBytes(4);
  const header = Buffer.from([0x82, 0x80 | bytes.length]);
  const masked = Buffer.from(bytes);
  for (let index = 0; index < masked.length; index++) masked[index] ^= mask[index & 3];
  return Buffer.concat([header, mask, masked]);
}

async function createFixture({ persistentLocal = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "caracatoa-web-preview-test-"));
  const webRoot = join(root, "web");
  await mkdir(webRoot);
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><html><head><title>Caracatoa 3D Preview 1.0</title></head><body><main>local preview</main></body></html>",
  );
  await writeFile(join(webRoot, "engine.wasm"), Buffer.from([0, 97, 115, 109]));

  const api = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ accepted: request.url === "/api/v1/player-registration", bytes: Buffer.concat(chunks).length }));
  });
  const registrationPort = await listen(api);

  const game = createNetServer((socket) => socket.pipe(socket));
  const gamePort = await listen(game);
  const bridge = persistentLocal
    ? createPersistentLocalPreviewServer({ webRoot, gamePort, registrationPort })
    : createWebPreviewServer({ webRoot, gamePort, registrationPort });
  const address = await bridge.listen();
  let bridgeClosed = false;
  let upstreamsClosed = false;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    address,
    gamePort,
    registrationPort,
    async closeBridge() {
      if (bridgeClosed) return;
      bridgeClosed = true;
      await bridge.close();
    },
    async closeUpstreams() {
      if (upstreamsClosed) return;
      upstreamsClosed = true;
      await new Promise((resolve) => api.close(resolve));
      await new Promise((resolve) => game.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
    async close() {
      await this.closeBridge();
      await this.closeUpstreams();
    },
  };
}

test("persistent-local preview binds to loopback and does not own its Caracatoa services", async () => {
  const fixture = await createFixture({ persistentLocal: true });
  try {
    assert.equal(fixture.address.address, "127.0.0.1");
    const page = await fetch(fixture.baseUrl);
    assert.equal(page.headers.get("x-caracatoa-preview-mode"), "persistent-local");
    const instanceId = page.headers.get("x-caracatoa-preview-instance");
    assert.match(instanceId, /^[0-9A-F]{6}$/);
    assert.match(await page.text(), /PRÉVIA LOCAL · DADOS PERSISTENTES/);

    const registration = await fetch(`${fixture.baseUrl}/api/v1/player-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "SyntheticPreview", password: "synthetic", token: "123456" }),
    });
    assert.equal(registration.status, 201);

    await fixture.closeBridge();
    const stillRunningHttp = await fetch(`http://127.0.0.1:${fixture.registrationPort}/`, {
      method: "POST",
      body: "synthetic",
    });
    assert.equal(stillRunningHttp.status, 201);
    const stillRunningGame = createConnection({ host: "127.0.0.1", port: fixture.gamePort });
    await new Promise((resolve, reject) => {
      stillRunningGame.once("connect", resolve);
      stillRunningGame.once("error", reject);
    });
    stillRunningGame.destroy();
  } finally {
    await fixture.close();
  }
});

test("serve a Defold HTML5 bundle with the WebAssembly MIME type", async () => {
  const fixture = await createFixture();
  try {
    const page = await fetch(fixture.baseUrl);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-caracatoa-preview-mode"), "isolated");
    const instanceId = page.headers.get("x-caracatoa-preview-instance");
    assert.match(instanceId, /^[0-9A-F]{6}$/);
    const html = await page.text();
    assert.match(html, /local preview/);
    assert.match(html, new RegExp(`PRÉVIA ISOLADA · DADOS TEMPORÁRIOS · ${instanceId}`));
    const index = await fetch(`${fixture.baseUrl}/index.html`);
    assert.equal(index.headers.get("x-caracatoa-preview-instance"), instanceId);
    const wasm = await fetch(`${fixture.baseUrl}/engine.wasm`);
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
    assert.equal(await wasm.arrayBuffer().then((buffer) => buffer.byteLength), 4);
    assert.equal((await fetch(`${fixture.baseUrl}/..%2fsecret`)).status, 404);
  } finally {
    await fixture.close();
  }
});

test("proxy registration to the isolated Caracatoa HTTP listener", async () => {
  const fixture = await createFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/api/v1/player-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "PreviewTest", password: "synthetic", token: "123456" }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { accepted: true, bytes: 67 });
  } finally {
    await fixture.close();
  }
});

test("bridge binary WebSocket frames to the Caracatoa TCP listener", async () => {
  const fixture = await createFixture();
  try {
    const socket = createConnection({ host: "127.0.0.1", port: fixture.port });
    const key = randomBytes(16).toString("base64");
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const payload = Buffer.from([0x43, 0x41, 0x52, 0x41, 0x00, 0xff]);

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket bridge timed out")), 3000);
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!upgraded) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const header = buffer.subarray(0, headerEnd).toString("latin1");
          assert.match(header, /^HTTP\/1\.1 101 /);
          const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
          assert.ok(header.toLowerCase().includes(`sec-websocket-accept: ${accept.toLowerCase()}`));
          buffer = buffer.subarray(headerEnd + 4);
          upgraded = true;
          socket.write(clientFrame(payload));
        }
        if (upgraded && buffer.length >= 2) {
          const length = buffer[1] & 0x7f;
          if (length >= 126) return reject(new Error("Fixture echo exceeded the compact frame size"));
          if (buffer.length < 2 + length) return;
          const opcode = buffer[0] & 0x0f;
          assert.equal(opcode, 0x2);
          const echoed = buffer.subarray(2, 2 + length);
          clearTimeout(timeout);
          resolve(echoed);
        }
      });
      socket.once("connect", () => {
        socket.write(
          `GET /game HTTP/1.1\r\nHost: 127.0.0.1:${fixture.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${fixture.baseUrl}\r\n\r\n`,
        );
      });
    });
    assert.deepEqual(result, payload);
    socket.destroy();
  } finally {
    await fixture.close();
  }
});
