import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientHandshake, decodeFrame, encodeFrame, StreamDecoder } from '../../../server/caracatoa/protocol.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(projectRoot, '..', '..');
const tableDocument = JSON.parse(await readFile(resolve(repoRoot, 'server/caracatoa/protocol-tables.json'), 'utf8'));
const generatedTables = await readFile(resolve(projectRoot, 'main', 'protocol_tables.lua'), 'utf8');
const generatedFixtures = await readFile(resolve(projectRoot, 'main', 'protocol_fixtures.lua'), 'utf8');
const fixtureDocument = JSON.parse(await readFile(resolve(projectRoot, 'tests/fixtures/frame-vectors.synthetic.json'), 'utf8'));
const sessionFixturePath = resolve(repoRoot, 'work/client-references/wydbot-parser-harness/fixtures/wyd727-session-requests.synthetic.json');
const sessionDocument = JSON.parse(await readFile(sessionFixturePath, 'utf8'));
const generatedSessionFixtures = await readFile(resolve(projectRoot, 'main', 'wyd_session_fixtures.lua'), 'utf8');

function readLuaArray(field) {
  const match = new RegExp(`${field} = \\{([^}]+)\\}`, 's').exec(generatedTables);
  assert.ok(match, `generated Lua module must contain ${field}`);
  return match[1].match(/\d+/g).map(Number);
}

assert.deepEqual(readLuaArray('table_a'), tableDocument.tableA);
assert.deepEqual(readLuaArray('table_b'), tableDocument.tableB);
assert.equal(fixtureDocument.credentials, false);
assert.equal(fixtureDocument.vectors.length, 5);

for (const vector of fixtureDocument.vectors) {
  const body = Buffer.from(vector.bodyHex, 'hex');
  const wire = Buffer.from(vector.wireHex, 'hex');
  assert.equal(body.readUInt16LE(0), 0x7b01, 'fixture opcode is a synthetic non-session marker');
  assert.equal(wire.length, vector.frameLength);
  assert.equal(wire.readUInt16LE(0), vector.frameLength, `${vector.name} header length`);
  assert.equal(wire[2], vector.sequence, `${vector.name} sequence header`);
  assert.deepEqual(encodeFrame(body, vector.sequence), wire, `${vector.name} matches the server encoder`);
  const decoded = decodeFrame(wire);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.frame.sequence, vector.sequence);
  assert.deepEqual(decoded.frame.body, body);
  assert.ok(generatedFixtures.includes(`name = "${vector.name}"`));
  assert.ok(generatedFixtures.includes(`body_hex = "${vector.bodyHex}"`));
  assert.ok(generatedFixtures.includes(`wire_hex = "${vector.wireHex}"`));
}

const stream = new StreamDecoder({ expectHandshake: true });
const allWires = Buffer.concat(fixtureDocument.vectors.map((vector) => Buffer.from(vector.wireHex, 'hex')));
const handshake = clientHandshake();
assert.deepEqual(stream.feed(handshake.subarray(0, 2)), {
  frames: [], handshakeCompleted: false, error: '',
});
const first = stream.feed(Buffer.concat([handshake.subarray(2), allWires.subarray(0, 7)]));
assert.equal(first.handshakeCompleted, true);
assert.equal(first.frames.length, 0);
const rest = stream.feed(allWires.subarray(7));
assert.equal(rest.error, '');
assert.equal(rest.frames.length, fixtureDocument.vectors.length);
assert.deepEqual(rest.frames.map((frame) => frame.body), fixtureDocument.vectors.map((vector) => Buffer.from(vector.bodyHex, 'hex')));
assert.equal(stream.finish(), '', 'complete coalesced stream must finish cleanly');

assert.ok(sessionDocument.warning.includes('redacted'));
assert.equal(Object.keys(sessionDocument.packets).length, 4);
assert.equal(Object.keys(sessionDocument.responses).length, 6);
assert.equal(JSON.stringify(sessionDocument).includes('plaintext_body_hex'), false, 'session fixtures must not persist unredacted request bodies');
assert.equal(JSON.stringify(sessionDocument).includes('encoded_frame_hex'), false, 'session fixtures must not persist unredacted request frames');
for (const [name, packet] of Object.entries(sessionDocument.packets)) {
  const body = Buffer.from(packet.redacted_body_hex, 'hex');
  const wire = Buffer.from(packet.redacted_frame_hex, 'hex');
  assert.equal(body.length + 4, packet.packet_size, `${name} redacted body size`);
  assert.equal(wire.length, packet.packet_size, `${name} redacted frame size`);
  assert.equal(body.readUInt16LE(0), packet.opcode, `${name} opcode`);
  assert.deepEqual(encodeFrame(body, packet.sequence), wire, `${name} redacted frame follows server codec`);
  assert.ok(generatedSessionFixtures.includes(`name = "${name}"`));
  assert.ok(generatedSessionFixtures.includes(`redacted_body_hex = "${packet.redacted_body_hex}"`));
  assert.ok(generatedSessionFixtures.includes(`redacted_frame_hex = "${packet.redacted_frame_hex}"`));
  if (name === 'account_login_0x20d') {
    assert.ok(body.subarray(8, 36).every((value) => value === 0), 'login password/account identifier redacted');
    assert.ok(body.subarray(96, 118).every((value) => value === 0), 'adapter ID/MAC redacted');
  }
  if (name === 'token_0xfde') assert.ok(body.subarray(8, 14).every((value) => value === 0), 'PIN redacted');
}
for (const [name, packet] of Object.entries(sessionDocument.responses)) {
  const body = Buffer.from(packet.body_hex, 'hex');
  assert.equal(body.length + 4, packet.packet_size, `${name} response body size`);
  assert.equal(body.readUInt16LE(0), packet.opcode, `${name} response opcode`);
  const wire = encodeFrame(body, packet.sequence);
  const decoded = decodeFrame(wire);
  assert.equal(decoded.ok, true, `${name} response frame decodes`);
  assert.deepEqual(decoded.frame.body, body);
  assert.ok(generatedSessionFixtures.includes(`name = "${name}"`));
  assert.ok(generatedSessionFixtures.includes(`body_hex = "${packet.body_hex}"`));
}

const incomplete = new StreamDecoder({ expectHandshake: false });
incomplete.feed(allWires.subarray(0, 5));
assert.match(incomplete.finish(), /incomplete frame/);

const maximumBody = Buffer.alloc(0xffff - 4, 0x5a);
maximumBody.writeUInt16LE(0x7b01, 0);
const maximumWire = encodeFrame(maximumBody, 0x7e);
assert.equal(maximumWire.length, 0xffff);
assert.equal(decodeFrame(maximumWire).ok, true, 'maximum uint16 frame must decode');
assert.throws(() => encodeFrame(Buffer.alloc(0xffff - 3), 0x7e), /frame length outside observed bounds/);
assert.throws(() => encodeFrame(Buffer.alloc(7), 0x7e), /frame length outside observed bounds/);

const corrupted = Buffer.from(fixtureDocument.vectors[0].wireHex, 'hex');
corrupted[3] ^= 0x01;
assert.equal(decodeFrame(corrupted).ok, false, 'corrupt checksum header must be rejected');
const tooShort = Buffer.alloc(11);
tooShort.writeUInt16LE(tooShort.length, 0);
assert.equal(decodeFrame(tooShort).ok, false, 'frame below minimum size must be rejected');

console.log('PASS generated Lua tables match the Caracatoa protocol tables.');
console.log('PASS synthetic 12/124/1224/2104/2808-byte vectors match server encode/decode.');
console.log('PASS fragmented handshake/frame, coalesced vectors, and checksum rejection in server reference.');
console.log('PASS stream truncation and minimum/maximum frame boundaries in server reference.');
console.log('PASS session fixtures persist no password, account ID or PIN bytes; request frame vectors are redacted and response frames match server codec.');
console.log('NOTE this Node verifier checks generated data; Lua runtime execution is covered by Defold startup self-tests plus loopback harness.');
