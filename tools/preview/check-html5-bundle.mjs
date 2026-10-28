import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Script } from "node:vm";

const bundleRoot = resolve(process.argv[2] ?? join("work", "caracatoa-defold-prototype", "build-stage1-html5", "bundle", "Caracatoa 3D Preview"));
const indexPath = join(bundleRoot, "index.html");
const html = await readFile(indexPath, "utf8");
const bridgeMarker = "window.CaracatoaLocalBridge =";
const bridgeIndex = html.indexOf(bridgeMarker);
assert.notEqual(bridgeIndex, -1, "HTML5 bundle is missing the local WebSocket bridge");
const scriptStart = html.lastIndexOf("<script>", bridgeIndex);
const scriptEnd = html.indexOf("</script>", bridgeIndex);
assert.notEqual(scriptStart, -1, "WebSocket bridge must be an inline script");
assert.notEqual(scriptEnd, -1, "WebSocket bridge script must close");
const bridgeSource = html.slice(scriptStart + "<script>".length, scriptEnd);
const bridgeScript = new Script(bridgeSource, { filename: "caracatoa-html5-bridge.js" });
const registrationRequests = [];
let resolveRegistrationFetch;
const context = {
  window: { location: { origin: "http://127.0.0.1:49123" } },
  WebSocket: class WebSocketMock {},
  Uint8Array,
  ArrayBuffer,
  TextEncoder,
  JSON,
  Promise,
  fetch: (url, request) => {
    registrationRequests.push({ url, request });
    return new Promise((resolveFetch) => { resolveRegistrationFetch = resolveFetch; });
  },
};
bridgeScript.runInNewContext(context);
const bridge = context.window.CaracatoaLocalBridge;
const syntheticRegistration = Buffer.from(JSON.stringify({ accountId: "PreviewCheck", password: "Synthetic9", token: "123456" }));
assert.equal(bridge.registerHex(syntheticRegistration.toString("hex"), 1), true, "browser registration request was not accepted");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
assert.equal(registrationRequests.length, 1, "browser bridge must dispatch exactly one registration request");
assert.equal(registrationRequests[0].url, "/api/v1/player-registration", "registration must use the same-origin proxy");
assert.equal(registrationRequests[0].request.method, "POST");
assert.equal(Buffer.from(registrationRequests[0].request.body).toString(), syntheticRegistration.toString(), "registration payload changed in the browser bridge");
const pendingResult = JSON.parse(bridge.pollRegistration(1));
assert.equal(pendingResult.completed, false, "bridge should preserve a pending request until its fetch resolves");
resolveRegistrationFetch({ status: 201, text: async () => '{"registered":true}' });
await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
const registrationResult = JSON.parse(bridge.pollRegistration(1));
assert.equal(registrationResult.type, "registration");
assert.equal(registrationResult.requestId, 1, "browser registration response lost its request ID");
assert.equal(registrationResult.completed, true);
assert.equal(registrationResult.status, 201);
assert.equal(Buffer.from(registrationResult.bodyHex, "hex").toString(), '{"registered":true}');
assert.deepEqual(JSON.parse(bridge.pollRegistration(1)), registrationResult, "polling must not consume a response before Lua acknowledges it");
assert.equal(bridge.acknowledgeRegistration(1), true);
assert.equal(bridge.pollRegistration(1), "", "acknowledged registration should be released from the bridge");

const files = await readdir(bundleRoot, { withFileTypes: true });
const wasmFiles = files.filter((file) => file.isFile() && file.name.endsWith(".wasm"));
assert.ok(wasmFiles.some((file) => file.name.endsWith(".wasm") && !file.name.includes("pthread")), "regular wasm-web engine missing");
const indexInfo = await stat(indexPath);
console.log(`HTML5 bundle checked: ${wasmFiles.length} wasm engines; index.html ${indexInfo.size} bytes; bridge parses and synthetic browser registration returns 201.`);
