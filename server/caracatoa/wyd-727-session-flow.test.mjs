import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import test from 'node:test';
import { inspectWyd727ClientFrame, inspectWyd727ServerFrame } from './wyd-727-profile.mjs';
import { clientHandshake, decodeFrame, encodeFrame, StreamDecoder } from './protocol.mjs';
import { CARACATOA_LOGIN_DENIED_CODE, buildWyd727LoginDeniedBody, buildWyd727LoginSuccessfulBody, buildWyd727TokenResultBody } from './wyd-727-session-responses.mjs';

function syntheticPacket(opcode, frameLength) {
  const body = Buffer.alloc(frameLength - 4);
  body.writeUInt16LE(opcode, 0);
  return body;
}

class SyntheticPacketWriter {
  constructor(opcode, frameLength) {
    this.body = Buffer.alloc(frameLength - 4);
    this.body.writeUInt16LE(opcode, 0);
    this.body.writeUInt16LE(0x1234, 2); // synthetic client ID in packet header
    this.body.writeUInt32LE(0x10203040, 4); // synthetic timestamp in packet header
    this.offset = 8; // first eight bytes of the 12-byte packet header are in the frame prefix
  }

  u8(value) { this.body.writeUInt8(value & 0xff, this.offset); this.offset += 1; }
  i16(value) { this.body.writeInt16LE(value, this.offset); this.offset += 2; }
  u16(value) { this.body.writeUInt16LE(value & 0xffff, this.offset); this.offset += 2; }
  i32(value) { this.body.writeInt32LE(value, this.offset); this.offset += 4; }
  u32(value) { this.body.writeUInt32LE(value >>> 0, this.offset); this.offset += 4; }
  i64(value) { this.body.writeBigInt64LE(BigInt(value), this.offset); this.offset += 8; }

  fixedString(value, width) {
    const bytes = Buffer.from(value, 'ascii');
    bytes.copy(this.body, this.offset, 0, Math.min(bytes.length, width - 1));
    this.offset += width;
  }

  bytes(values) {
    const bytes = Buffer.from(values);
    bytes.copy(this.body, this.offset);
    this.offset += bytes.length;
  }

  skip(count) { this.offset += count; }

  finish(expectedLength) {
    assert.equal(this.offset, this.body.length, `writer cursor for opcode 0x${this.body.readUInt16LE(0).toString(16)}`);
    assert.equal(this.body.length + 4, expectedLength);
    return this.body;
  }
}

function writeSyntheticItem(writer, index) {
  writer.u16(index);
  writer.i16(1 + (index % 500));
  writer.u16(index ^ 0x5a5a);
  for (let effect = 0; effect < 3; effect += 1) {
    writer.u8(index + effect);
    writer.u8(index + effect + 64);
  }
}

function writeSyntheticScore(writer, index) {
  writer.i32(1000 + index); // level
  writer.i32(2000 + index); // defense
  writer.i32(3000 + index); // damage
  writer.u8(4 + (index % 4)); // merchant
  writer.u8(5); // movement speed, within the client clamp
  writer.u8(index % 8); // direction
  writer.u8(index % 100); // chaos rate
  writer.i32(4000 + index); // max HP
  writer.i32(5000 + index); // max MP
  writer.i32(3500 + index); // current HP
  writer.i32(4500 + index); // current MP
  writer.u16(10 + index); // STR
  writer.u16(20 + index); // INT
  writer.u16(30 + index); // DEX
  writer.u16(40 + index); // CON
  for (let stat = 0; stat < 4; stat += 1) writer.u16(50 + index + stat);
}

function writeSyntheticSelection(writer) {
  for (let slot = 0; slot < 4; slot += 1) writer.i16(100 + slot); // posX[4]
  for (let slot = 0; slot < 4; slot += 1) writer.i16(200 + slot); // posY[4]
  for (let slot = 0; slot < 4; slot += 1) writer.fixedString(`SLOT_${slot}`, 16);
  for (let slot = 0; slot < 4; slot += 1) writeSyntheticScore(writer, slot);
  for (let slot = 0; slot < 4; slot += 1) {
    for (let equipment = 0; equipment < 18; equipment += 1) {
      writeSyntheticItem(writer, 0x1000 + slot * 18 + equipment);
    }
  }
  for (let slot = 0; slot < 4; slot += 1) writer.u16(0x200 + slot); // transform IDs
  for (let slot = 0; slot < 4; slot += 1) writer.i32(0x300 + slot); // guilds
  for (let slot = 0; slot < 4; slot += 1) writer.i32(10000 + slot); // coins
  for (let slot = 0; slot < 4; slot += 1) writer.i64(0x100000n + BigInt(slot)); // exp
}

function syntheticLoginSuccessful() {
  const writer = new SyntheticPacketWriter(0x10a, 2808);
  writer.bytes(Array.from({ length: 16 }, (_, index) => 0x41 + index));
  writer.i32(0x12345678);
  writeSyntheticSelection(writer);
  for (let item = 0; item < 128; item += 1) writeSyntheticItem(writer, 0x4000 + item);
  writer.i32(987654);
  writer.fixedString('SYNTH', 16);
  writer.bytes(Array.from({ length: 12 }, (_, index) => 0xa0 + index));
  return writer.finish(2808);
}

function syntheticResendCharList() {
  const writer = new SyntheticPacketWriter(0x110, 1224);
  writer.i32(0x10203040); // unknown field; bytes are synthetic and not interpreted
  writeSyntheticSelection(writer);
  return writer.finish(1224);
}

function syntheticCharToWorld() {
  const writer = new SyntheticPacketWriter(0x114, 2104);
  writer.i16(300); // position x
  writer.i16(400); // position y
  writer.fixedString('WORLD_FIXTURE', 18);
  writer.u16(0x2345); // guild index
  writer.u8(0); // TK class ID
  writer.skip(3);
  writer.i32(7654321); // gold
  writer.skip(4);
  writer.i64(0x0102030405060708n); // exp
  writer.skip(4);
  writeSyntheticScore(writer, 4); // base score
  writeSyntheticScore(writer, 5); // final score
  for (let item = 0; item < 18; item += 1) writeSyntheticItem(writer, 0x2000 + item);
  for (let item = 0; item < 60; item += 1) writeSyntheticItem(writer, 0x3000 + item);
  writeSyntheticItem(writer, 3467); // known bag-unlock token ID
  writeSyntheticItem(writer, 0); // second unlock slot empty
  writer.skip(24);
  writer.u32(0x40000000); // learned skill bit used as the celestial flag
  writer.u32(0x12345678);
  writer.u16(12); // status points
  writer.u16(13); // CP points
  writer.u16(14); // skill points
  writer.u8(15); // critical rate
  writer.u8(16); // save mana
  writer.u32(0x01020304); // first skill bar
  writer.skip(2);
  writer.i16(1000); // attack speed
  writer.i16(21); // critical damage bonus
  writer.i16(22); // critical damage reduction
  writer.skip(180); // unmapped/server-only block
  writer.skip(22); // unknown block
  for (let resist = 0; resist < 4; resist += 1) writer.i16(30 + resist);
  writer.skip(6);
  writer.skip(2);
  writer.u16(0x3456); // mob index
  writer.u16(2); // game mode
  for (let slot = 1; slot <= 4; slot += 1) writer.u32(0x50000000 + slot);
  writer.skip(2);
  writer.i32(456789); // contribution points
  writer.skip(284);
  for (let effect = 0; effect < 47; effect += 1) {
    writer.u8(effect + 1);
    writer.u8(effect + 2);
    writer.u16(100 + effect);
    writer.u32(1000 + effect);
  }
  writer.skip(4);
  writer.u32(1700000000); // server time
  writer.skip(24);
  const body = writer.finish(2104);
  body[165 - 4] = 1; // documented evolved flag byte; remains synthetic
  return body;
}

function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeLoopbackServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

function createFrameReader(socket) {
  const decoder = new StreamDecoder({ expectHandshake: false });
  const frames = [];
  const waiters = [];
  let failure;

  function fail(error) {
    failure ??= error;
    while (waiters.length) waiters.shift().reject(failure);
  }

  function deliver() {
    while (frames.length && waiters.length) waiters.shift().resolve(frames.shift());
  }

  socket.on('data', (chunk) => {
    const result = decoder.feed(chunk);
    if (result.error) {
      fail(new Error(`synthetic client stream decode failed: ${result.error}`));
      return;
    }
    frames.push(...result.frames);
    deliver();
  });
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('loopback responder closed before the expected frame')));

  return {
    next(timeoutMs = 3000) {
      if (frames.length) return Promise.resolve(frames.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(frame) {
            clearTimeout(timer);
            resolve(frame);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error('timed out waiting for a synthetic loopback response'));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    finish() {
      return decoder.finish();
    },
  };
}

test('models the source-derived login, token, character-entry, and world-response order', () => {
  // Zero-filled fixture bodies carry no credentials or session secrets. This is
  // a profile fixture, not an implementation of the server's response logic.
  const transcript = [
    ['client', 0x20d, 124],
    ['server', 0x10a, 2808],
    ['client', 0xfde, 32],
    ['server', 0xfde, 12],
    ['client', 0x213, 36],
    ['server', 0x114, 2104],
  ].map(([direction, opcode, frameLength]) => {
    const body = syntheticPacket(opcode, frameLength);
    const inspected = direction === 'client'
      ? inspectWyd727ClientFrame(body)
      : inspectWyd727ServerFrame(body);
    return { direction, frameLength, inspected };
  });

  assert.deepEqual(transcript.map(({ direction, frameLength, inspected }) => ({
    direction,
    opcode: inspected.opcode,
    name: inspected.name,
    frameLength,
    lengthValid: inspected.lengthValid,
  })), [
    { direction: 'client', opcode: 0x20d, name: 'account-login', frameLength: 124, lengthValid: true },
    { direction: 'server', opcode: 0x10a, name: 'login-successful', frameLength: 2808, lengthValid: true },
    { direction: 'client', opcode: 0xfde, name: 'token', frameLength: 32, lengthValid: true },
    { direction: 'server', opcode: 0xfde, name: 'token-accepted', frameLength: 12, lengthValid: null },
    { direction: 'client', opcode: 0x213, name: 'request-character-entry', frameLength: 36, lengthValid: true },
    { direction: 'server', opcode: 0x114, name: 'character-to-world', frameLength: 2104, lengthValid: true },
  ]);
});

test('serves the synthetic session sequence over loopback without enabling the production listener', async (t) => {
  const expected = [
    { opcode: 0x20d, frameLength: 124, replyOpcode: 0x10a, replyLength: 2808, replySeed: 0x50, reply: syntheticLoginSuccessful },
    { opcode: 0xfde, frameLength: 32, replyOpcode: 0xfde, replyLength: 12, replySeed: 0x51, reply: () => syntheticPacket(0xfde, 12) },
    { opcode: 0x213, frameLength: 36, replyOpcode: 0x114, replyLength: 2104, replySeed: 0x52, reply: syntheticCharToWorld },
  ];
  const transcript = [];
  const failures = [];
  let step = 0;
  const serverSockets = new Set();
  const server = createServer((socket) => {
    serverSockets.add(socket);
    socket.once('close', () => serverSockets.delete(socket));
    const decoder = new StreamDecoder();
    socket.on('data', (chunk) => {
      try {
        const result = decoder.feed(chunk);
        assert.equal(result.error, '', 'client stream must pass framing and checksum validation');
        if (result.handshakeCompleted) transcript.push({ direction: 'client', type: 'handshake' });
        for (const frame of result.frames) {
          assert.ok(transcript.some((entry) => entry.type === 'handshake'), 'handshake precedes packets');
          const request = expected[step];
          assert.ok(request, 'responder receives no packets after the fixture sequence');
          const parsed = inspectWyd727ClientFrame(frame.body);
          assert.equal(parsed.opcode, request.opcode);
          assert.equal(parsed.frameLength, request.frameLength);
          assert.equal(parsed.lengthValid, true);
          if (step === 1) assert.equal(frame.sequence, 0xbe, 'token key follows the synthetic 0x10A hash table');
          transcript.push({
            direction: 'client', type: 'packet', opcode: parsed.opcode,
            frameLength: parsed.frameLength, sequence: frame.sequence, checksumValid: true,
          });

          const responseBody = request.reply();
          const response = inspectWyd727ServerFrame(responseBody);
          assert.equal(response.opcode, request.replyOpcode);
          assert.equal(response.frameLength, request.replyLength);
          if (response.opcode !== 0xfde) assert.equal(response.lengthValid, true);
          else assert.equal(response.lengthValid, null, 'token response length is undocumented');
          const responseWire = encodeFrame(responseBody, request.replySeed);
          transcript.push({
            direction: 'server', type: 'packet', opcode: response.opcode,
            frameLength: response.frameLength, sequence: request.replySeed, checksumValid: true,
          });
          step += 1;
          socket.write(responseWire);
        }
      } catch (error) {
        failures.push(error);
        socket.destroy();
      }
    });
    socket.on('error', (error) => failures.push(error));
  });

  t.after(async () => {
    for (const socket of serverSockets) socket.destroy();
    await closeLoopbackServer(server);
  });

  const port = await listenLoopback(server);
  const client = createConnection({ host: '127.0.0.1', port });
  t.after(() => client.destroy());
  await once(client, 'connect');
  const reader = createFrameReader(client);
  const requests = [
    { body: syntheticPacket(0x20d, 124), seed: 0x31 },
    { body: syntheticPacket(0xfde, 32), seed: syntheticLoginSuccessful().readUInt8(8) ^ 0xff },
    { body: syntheticPacket(0x213, 36), seed: 0x33 },
  ];

  client.write(Buffer.concat([clientHandshake(), encodeFrame(requests[0].body, requests[0].seed)]));
  for (const [index, request] of requests.entries()) {
    if (index > 0) client.write(encodeFrame(request.body, request.seed));
    const responseFrame = await reader.next();
    const parsed = inspectWyd727ServerFrame(responseFrame.body);
    assert.equal(parsed.opcode, expected[index].replyOpcode);
    assert.equal(parsed.frameLength, expected[index].replyLength);
    assert.equal(responseFrame.sequence, expected[index].replySeed);
    assert.equal(failures.length, 0, failures[0]?.message);
  }

  assert.equal(step, expected.length);
  assert.equal(reader.finish(), '');
  assert.deepEqual(transcript.map(({ direction, type, opcode, frameLength }) => ({
    direction, type, opcode, frameLength,
  })), [
    { direction: 'client', type: 'handshake', opcode: undefined, frameLength: undefined },
    { direction: 'client', type: 'packet', opcode: 0x20d, frameLength: 124 },
    { direction: 'server', type: 'packet', opcode: 0x10a, frameLength: 2808 },
    { direction: 'client', type: 'packet', opcode: 0xfde, frameLength: 32 },
    { direction: 'server', type: 'packet', opcode: 0xfde, frameLength: 12 },
    { direction: 'client', type: 'packet', opcode: 0x213, frameLength: 36 },
    { direction: 'server', type: 'packet', opcode: 0x114, frameLength: 2104 },
  ]);
  assert.ok(transcript.filter((entry) => entry.type === 'packet').every((entry) => entry.checksumValid));
  assert.equal(failures.length, 0, failures[0]?.message);
  client.end();
  await once(client, 'close');
});

test('carries the synthetic login hash table into the first client token key byte', () => {
  const hashTable = Buffer.from(Array.from({ length: 16 }, (_, index) => 0x41 + index));

  // 0x10A: packet header occupies 12 bytes; HashKeyTable begins immediately
  // after it (offset 8 in this body, which starts after the four-byte frame prefix).
  const loginBody = Buffer.alloc(2808 - 4);
  loginBody.writeUInt16LE(0x10a, 0);
  hashTable.copy(loginBody, 8);

  const loginWire = encodeFrame(loginBody, 0x37);
  const loginDecoded = decodeFrame(loginWire);
  assert.equal(loginDecoded.ok, true);
  assert.deepEqual(loginDecoded.frame.body.subarray(8, 24), hashTable);
  assert.equal(inspectWyd727ServerFrame(loginDecoded.frame.body).lengthValid, true);

  // WYDBot PacketWriter uses hashTable[0] XOR 0xFF for the first post-login
  // packet; a zero-filled synthetic token body contains no credentials.
  const tokenBody = Buffer.alloc(32 - 4);
  tokenBody.writeUInt16LE(0xfde, 0);
  const firstTokenKey = hashTable[0] ^ 0xff;
  const tokenWire = encodeFrame(tokenBody, firstTokenKey);
  const tokenDecoded = decodeFrame(tokenWire);

  assert.equal(tokenDecoded.ok, true);
  assert.equal(tokenDecoded.frame.sequence, firstTokenKey);
  assert.equal(inspectWyd727ClientFrame(tokenDecoded.frame.body).lengthValid, true);
});

test('round-trips synthetic sentinels at documented login, list, and world offsets', () => {
  const login = syntheticPacket(0x10a, 2808);
  Buffer.from(Array.from({ length: 16 }, (_, index) => 0x41 + index))
    .copy(login, 8);
  login.writeInt32LE(0x12345678, 24); // packet offset 28: Offset28
  login.writeInt16LE(321, 28); // SelChar.posX[0], packet offset 32
  login.writeInt16LE(654, 36); // SelChar.posY[0], packet offset 40
  login.write('FIXTURE_CHAR', 44, 'ascii'); // first 16-byte name, packet offset 48
  login.writeUInt16LE(0x2345, 1236); // first cargo item index, packet offset 1240
  login.writeInt32LE(987654, 2772); // CargoCoin, packet offset 2776
  login.write('SYNTH', 2776, 'ascii'); // AccName, packet offset 2780
  login.fill(0x5c, 2792, 2804); // Keys, packet offset 2796

  const loginFrame = decodeFrame(encodeFrame(login, 0x35));
  assert.equal(loginFrame.ok, true);
  assert.equal(inspectWyd727ServerFrame(loginFrame.frame.body).frameLength, 2808);
  assert.equal(loginFrame.frame.body.readInt32LE(24), 0x12345678);
  assert.equal(loginFrame.frame.body.readInt16LE(28), 321);
  assert.equal(loginFrame.frame.body.readInt16LE(36), 654);
  assert.equal(loginFrame.frame.body.toString('ascii', 44, 56), 'FIXTURE_CHAR');
  assert.equal(loginFrame.frame.body.readUInt16LE(1236), 0x2345);
  assert.equal(loginFrame.frame.body.readInt32LE(2772), 987654);
  assert.equal(loginFrame.frame.body.toString('ascii', 2776, 2781), 'SYNTH');
  assert.deepEqual(loginFrame.frame.body.subarray(2792, 2804), Buffer.alloc(12, 0x5c));

  const charList = syntheticPacket(0x110, 1224);
  charList.writeInt32LE(0x10203040, 8); // packet offset 12: Unknown4
  charList.writeInt16LE(111, 12); // SelChar.posX[0], packet offset 16
  charList.writeInt16LE(222, 20); // SelChar.posY[0], packet offset 24
  charList.write('LIST_FIXTURE', 28, 'ascii'); // first name, packet offset 32

  const listFrame = decodeFrame(encodeFrame(charList, 0x36));
  assert.equal(listFrame.ok, true);
  assert.equal(inspectWyd727ServerFrame(listFrame.frame.body).frameLength, 1224);
  assert.equal(listFrame.frame.body.readInt32LE(8), 0x10203040);
  assert.equal(listFrame.frame.body.readInt16LE(12), 111);
  assert.equal(listFrame.frame.body.readInt16LE(20), 222);
  assert.equal(listFrame.frame.body.toString('ascii', 28, 40), 'LIST_FIXTURE');

  const world = syntheticPacket(0x114, 2104);
  world.writeInt16LE(300, 8); // packet offset 12: Position.x
  world.writeInt16LE(400, 10); // packet offset 14: Position.y
  world.write('WORLD_FIXTURE', 12, 'ascii'); // packet offset 16: Name
  world.writeUInt8(0, 32); // packet offset 36: TK class ID
  world.writeInt32LE(7654321, 36); // packet offset 40: Gold
  world.writeBigInt64LE(0x0102030405060708n, 44); // packet offset 48: Exp
  world.writeUInt16LE(0x3456, 1382); // packet offset 1386: MobIndex
  world.writeUInt16LE(2, 1384); // packet offset 1388: GameMode
  world.writeUInt32LE(1700000000, 2072); // packet offset 2076: ServerTime

  const worldFrame = decodeFrame(encodeFrame(world, 0x37));
  assert.equal(worldFrame.ok, true);
  assert.equal(inspectWyd727ServerFrame(worldFrame.frame.body).frameLength, 2104);
  assert.equal(worldFrame.frame.body.readInt16LE(8), 300);
  assert.equal(worldFrame.frame.body.readInt16LE(10), 400);
  assert.equal(worldFrame.frame.body.toString('ascii', 12, 25), 'WORLD_FIXTURE');
  assert.equal(worldFrame.frame.body.readUInt8(32), 0);
  assert.equal(worldFrame.frame.body.readInt32LE(36), 7654321);
  assert.equal(worldFrame.frame.body.readBigInt64LE(44), 0x0102030405060708n);
  assert.equal(worldFrame.frame.body.readUInt16LE(1382), 0x3456);
  assert.equal(worldFrame.frame.body.readUInt16LE(1384), 2);
  assert.equal(worldFrame.frame.body.readUInt32LE(2072), 1700000000);
});

test('lays out nested MSelChar, MScore, MItem and world affect arrays to parser bounds', () => {
  const login = decodeFrame(encodeFrame(syntheticLoginSuccessful(), 0x35));
  assert.equal(login.ok, true);
  assert.equal(inspectWyd727ServerFrame(login.frame.body).frameLength, 2808);
  // Last selection slot: the arrays are grouped by field, not interleaved by slot.
  assert.equal(login.frame.body.toString('ascii', 92, 98), 'SLOT_3');
  assert.equal(login.frame.body.readInt32LE(252), 1003); // MScore.level[3]
  assert.equal(login.frame.body.readUInt16LE(1152), 0x1000 + 3 * 18 + 17); // final equip index
  assert.equal(login.frame.body.readUInt16LE(1154), 1 + ((0x1000 + 3 * 18 + 17) % 500));
  assert.equal(login.frame.body.readUInt16LE(1170), 0x203); // transform ID[3]
  assert.equal(login.frame.body.readInt32LE(1184), 0x303); // guild[3]
  assert.equal(login.frame.body.readInt32LE(1200), 10003); // coins[3]
  assert.equal(login.frame.body.readBigInt64LE(1228), 0x100003n); // exp[3]
  assert.equal(login.frame.body.readUInt16LE(2760), 0x4000 + 127); // final cargo item
  assert.equal(login.frame.body.readInt32LE(2772), 987654);
  assert.equal(login.frame.body.toString('ascii', 2776, 2781), 'SYNTH');
  assert.deepEqual(login.frame.body.subarray(2792, 2804), Buffer.from(
    Array.from({ length: 12 }, (_, index) => 0xa0 + index),
  ));

  const list = decodeFrame(encodeFrame(syntheticResendCharList(), 0x36));
  assert.equal(list.ok, true);
  assert.equal(inspectWyd727ServerFrame(list.frame.body).frameLength, 1224);
  assert.equal(list.frame.body.toString('ascii', 76, 82), 'SLOT_3'); // names[3]
  assert.equal(list.frame.body.readInt32LE(236), 1003); // MScore.level[3]
  assert.equal(list.frame.body.readUInt16LE(1136), 0x1000 + 3 * 18 + 17); // final equip
  assert.equal(list.frame.body.readBigInt64LE(1212), 0x100003n); // final exp slot

  const world = decodeFrame(encodeFrame(syntheticCharToWorld(), 0x37));
  assert.equal(world.ok, true);
  assert.equal(inspectWyd727ServerFrame(world.frame.body).frameLength, 2104);
  assert.equal(world.frame.body.readInt32LE(56), 1004); // baseScore.level
  assert.equal(world.frame.body.readInt32LE(104), 1005); // finalScore.level
  assert.equal(world.frame.body.readUInt16LE(356), 0x2000 + 17); // final equipment item
  assert.equal(world.frame.body.readUInt16LE(1076), 0x3000 + 59); // final inventory item
  assert.equal(world.frame.body.readUInt16LE(1088), 3467); // bag unlock token
  assert.equal(world.frame.body.readUInt32LE(1136), 0x40000000); // learned skill flags
  assert.equal(world.frame.body.readUInt16LE(1382), 0x3456); // MobIndex
  assert.equal(world.frame.body.readUInt16LE(1384), 2); // GameMode
  assert.equal(world.frame.body.readUInt32LE(1404), 456789); // CP
  assert.equal(world.frame.body.readUInt8(2060), 47); // final affect type
  assert.equal(world.frame.body.readUInt32LE(2064), 1046); // final affect time
  assert.equal(world.frame.body.readUInt32LE(2072), 1700000000); // ServerTime
});

test('builds synthetic login denial and token results matching the WYDBot response dispatch', () => {
  const loginDenied = buildWyd727LoginDeniedBody();
  assert.equal(loginDenied.length + 4, 16);
  assert.deepEqual(inspectWyd727ServerFrame(loginDenied), {
    recognized: true,
    malformed: false,
    opcode: 0x105,
    name: 'server-message',
    frameLength: 16,
    expectedFrameLength: 16,
    lengthKnown: true,
    lengthValid: true,
  });
  assert.equal(loginDenied.readUInt8(8), 0);
  assert.equal(loginDenied.readUInt8(9), 0);
  assert.equal(loginDenied.readInt16LE(10), CARACATOA_LOGIN_DENIED_CODE);
  assert.equal(CARACATOA_LOGIN_DENIED_CODE + 1000, 33767, 'the Caracatoa code stays out of the 2000-entry client string table');

  const loginWire = encodeFrame(loginDenied, 0x5c);
  const decodedLogin = decodeFrame(loginWire);
  assert.equal(decodedLogin.ok, true);
  assert.equal(decodedLogin.frame.body.readUInt16LE(0), 0x105);
  assert.equal(decodedLogin.frame.body.readUInt8(8), 0);
  assert.equal(decodedLogin.frame.body.readInt16LE(10), CARACATOA_LOGIN_DENIED_CODE);

  for (const accepted of [true, false]) {
    const body = buildWyd727TokenResultBody(accepted);
    assert.equal(body.length + 4, 12);
    const decoded = decodeFrame(encodeFrame(body, accepted ? 0x5d : 0x5e));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.frame.body.readUInt16LE(0), accepted ? 0xfde : 0xfdf);
    assert.equal(inspectWyd727ServerFrame(decoded.frame.body).lengthValid, null);
  }
});

test('builds a full blank-slot 0x10A login response for the public client parser', () => {
  const hashKeyTable = Buffer.from(Array.from({ length: 16 }, (_, index) => 0x41 + index));
  const body = buildWyd727LoginSuccessfulBody({ clientId: 0x1234, timestamp: 0x10203040, hashKeyTable });
  assert.equal(body.length + 4, 2808);
  assert.deepEqual(inspectWyd727ServerFrame(body), {
    recognized: true,
    malformed: false,
    opcode: 0x10a,
    name: 'login-successful',
    frameLength: 2808,
    expectedFrameLength: 2808,
    lengthKnown: true,
    lengthValid: true,
  });
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x10203040);
  assert.deepEqual(body.subarray(8, 24), hashKeyTable);
  assert.ok(body.subarray(24).every((byte) => byte === 0), 'the remaining character and storage fields form four empty slots');
  const defaultTimestamp = buildWyd727LoginSuccessfulBody({ clientId: 1, hashKeyTable });
  assert.equal(defaultTimestamp.length + 4, 2808);
  assert.ok(defaultTimestamp.readUInt32LE(4) >= 0);
  assert.throws(() => buildWyd727LoginSuccessfulBody({ clientId: 0, hashKeyTable }), /clientId/);
  assert.throws(() => buildWyd727LoginSuccessfulBody({ clientId: 1, timestamp: 1, hashKeyTable: Buffer.alloc(16) }), /hashKeyTable/);
});
