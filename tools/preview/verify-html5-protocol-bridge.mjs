import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createConnection } from "node:net";

const previewUrl = new URL(process.argv[2] ?? "");
assert.equal(previewUrl.protocol, "http:", "Use the local HTTP preview link");
assert.equal(previewUrl.hostname, "127.0.0.1", "Only the IPv4 loopback preview is allowed");
assert.ok(previewUrl.port, "The local preview port is required");

function clientFrame(opcode, payload) {
  const bytes = Buffer.from(payload);
  const mask = randomBytes(4);
  assert.ok(bytes.length < 126);
  const header = Buffer.from([0x80 | opcode, 0x80 | bytes.length]);
  const masked = Buffer.from(bytes);
  for (let index = 0; index < masked.length; index++) masked[index] ^= mask[index & 3];
  return Buffer.concat([header, mask, masked]);
}

const socket = createConnection({ host: "127.0.0.1", port: Number(previewUrl.port) });
socket.setTimeout(3000);
try {
  const key = randomBytes(16).toString("base64");
  await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const fail = (error) => reject(error);
    socket.once("error", fail);
    socket.once("timeout", () => fail(new Error("Local WebSocket bridge timed out")));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const response = buffer.subarray(0, end).toString("latin1");
      const expected = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      if (!response.startsWith("HTTP/1.1 101 ") || !response.toLowerCase().includes(`sec-websocket-accept: ${expected.toLowerCase()}`)) {
        return fail(new Error("Local preview rejected the WebSocket upgrade"));
      }
      socket.removeListener("timeout", fail);
      resolve();
    });
    socket.once("connect", () => {
      socket.write(
        `GET /game HTTP/1.1\r\nHost: 127.0.0.1:${previewUrl.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${previewUrl.origin}\r\n\r\n`,
      );
    });
  });

  let closed = false;
  socket.once("close", () => { closed = true; });
  socket.write(clientFrame(0x2, Buffer.from([0x11, 0xf3, 0x11, 0x1f])));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(closed, false, "Caracatoa closed the stream after its synthetic handshake");
  console.log("Local WebSocket bridge accepted the Caracatoa handshake; no account or credential data was sent.");
} finally {
  if (!socket.destroyed) {
    socket.write(clientFrame(0x8, Buffer.from([0x03, 0xe8])));
    socket.destroy();
  }
}
