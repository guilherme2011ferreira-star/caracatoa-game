import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const bundleRoot = process.argv[2];
if (!bundleRoot) throw new Error("Informe a pasta da bundle HTML5.");

const indexPath = join(bundleRoot, "index.html");
const html = await readFile(indexPath, "utf8");
if (html.includes("CaracatoaLocalBridge")) {
  console.log("Ponte HTML5 Caracatoa já está presente.");
  process.exit(0);
}

const bridge = String.raw`<script>
window.CaracatoaLocalBridge = (function () {
  "use strict";
  var socket = null;
  var events = [];
  var registrationResults = Object.create(null);
  var pending = [];
  function push(event) {
    if (events.length < 64) events.push(event);
  }
  function bytesToHex(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var result = "";
    for (var i = 0; i < bytes.length; i++) result += bytes[i].toString(16).padStart(2, "0");
    return result;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex) || hex.length > 131072) return null;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  function flush() {
    while (socket && socket.readyState === WebSocket.OPEN && pending.length) socket.send(pending.shift());
  }
  return {
    connect: function () {
      if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return true;
      try {
        var endpoint = window.location.origin.replace(/^http/, "ws") + "/game";
        socket = new WebSocket(endpoint);
        socket.binaryType = "arraybuffer";
        socket.onopen = function () { push({ type: "open" }); flush(); };
        socket.onmessage = function (message) {
          if (message.data instanceof ArrayBuffer) push({ type: "message", hex: bytesToHex(message.data) });
          else push({ type: "error" });
        };
        socket.onerror = function () { push({ type: "error" }); };
        socket.onclose = function () { push({ type: "close" }); socket = null; };
        return true;
      } catch (_) {
        push({ type: "error" });
        return false;
      }
    },
    sendHex: function (hex) {
      if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return false;
      var bytes = hexToBytes(hex);
      if (!bytes) return false;
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
      else if (pending.length < 16) pending.push(bytes);
      else return false;
      return true;
    },
    registerHex: function (hex, requestId) {
      var body = hexToBytes(hex);
      if (!body || body.length > 8192 || !Number.isSafeInteger(requestId) || requestId < 1 || Object.keys(registrationResults).length >= 8) return false;
      var key = String(requestId);
      registrationResults[key] = { type: "registration", requestId: requestId, completed: false };
      try {
        fetch("/api/v1/player-registration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        }).then(function (response) {
          return response.text().then(function (text) {
            if (!registrationResults[key]) return;
            registrationResults[key] = { type: "registration", requestId: requestId, completed: true, status: response.status, bodyHex: bytesToHex(new TextEncoder().encode(text)) };
          });
        }).catch(function () {
          if (registrationResults[key]) registrationResults[key] = { type: "registration", requestId: requestId, completed: true, status: 0, bodyHex: "" };
        });
        return true;
      } catch (_) {
        if (registrationResults[key]) registrationResults[key] = { type: "registration", requestId: requestId, completed: true, status: 0, bodyHex: "" };
        return true;
      }
    },
    pollRegistration: function (requestId) {
      var result = registrationResults[String(requestId)];
      return result ? JSON.stringify(result) : "";
    },
    acknowledgeRegistration: function (requestId) {
      delete registrationResults[String(requestId)];
      return true;
    },
    poll: function () {
      var batch = events.splice(0, events.length);
      return JSON.stringify(batch);
    },
    close: function () {
      pending = [];
      registrationResults = Object.create(null);
      if (socket) {
        var current = socket;
        socket = null;
        if (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN) current.close(1000, "Caracatoa preview closed");
      }
      return true;
    }
  };
})();
</script>`;

const headEnd = html.toLowerCase().lastIndexOf("</head>");
if (headEnd < 0) throw new Error("Template HTML5 sem fechamento de head.");
const result = html.slice(0, headEnd) + bridge + "\n" + html.slice(headEnd);
await writeFile(indexPath, result, "utf8");
console.log("Ponte WebSocket local Caracatoa injetada no HTML5.");
