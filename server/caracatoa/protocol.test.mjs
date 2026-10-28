import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { clientHandshake, decodeFrame, encodeFrame, StreamDecoder } from './protocol.mjs';

const fixtureBody = Buffer.from([0x0a, 0x01, 0x34, 0x12, 0x00, 0x00, 0x78, 0x56]);
const fixtureWire = Buffer.from('0c002a0616fd740c4af10453', 'hex');

test('codec matches the local C++ implementation vector', () => {
  assert.deepEqual(encodeFrame(fixtureBody, 0x2a), fixtureWire);
  const decoded = decodeFrame(fixtureWire);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.frame.sequence, 0x2a);
  assert.deepEqual(decoded.frame.body, fixtureBody);
});

test('codec matches C++ vectors at seed zero and at a second seed across byte positions', () => {
  const zeroSeedWire = Buffer.from('0c00001004f2b80bcaf06c50', 'hex');
  assert.deepEqual(encodeFrame(fixtureBody, 0x00), zeroSeedWire);
  const body = Buffer.from(Array.from({ length: 20 }, (_, index) => (index * 37 + 11) & 0xff));
  const highSeedWire = Buffer.from('1800ffedfd146175bbb5e10b9149119fc1dd55335371c1c7', 'hex');
  assert.deepEqual(encodeFrame(body, 0xff), highSeedWire);
  assert.deepEqual(decodeFrame(highSeedWire).frame.body, body);
});

test('codec handles byte values across the full range and rejects bad checksum', () => {
  const body = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const wire = encodeFrame(body, 0xff);
  assert.equal(
    createHash('sha256').update(wire).digest('hex'),
    'f124a460dbfbce113bb11f65789173634fd0b4b2aaf126541aa47b04e85b9cdb',
  );
  const decoded = decodeFrame(wire);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.frame.body, body);
  wire[3] ^= 1;
  assert.deepEqual(decodeFrame(wire), { ok: false, error: 'frame checksum mismatch' });
});

test('stream decoder accepts a fragmented handshake and coalesced frames', () => {
  const decoder = new StreamDecoder();
  const marker = clientHandshake();
  assert.equal(decoder.feed(marker.subarray(0, 2)).handshakeCompleted, false);
  const part = decoder.feed(Buffer.concat([marker.subarray(2), fixtureWire.subarray(0, 7)]));
  assert.equal(part.handshakeCompleted, true);
  assert.deepEqual(part.frames, []);
  assert.equal(part.error, '');

  const secondBody = Buffer.from([0x10, 0x01, 1, 2, 3, 4, 5, 6]);
  const frames = decoder.feed(Buffer.concat([
    fixtureWire.subarray(7),
    encodeFrame(secondBody, 0x4c),
  ]));
  assert.equal(frames.error, '');
  assert.equal(frames.frames.length, 2);
  assert.deepEqual(frames.frames[0].body, fixtureBody);
  assert.deepEqual(frames.frames[1].body, secondBody);
  assert.equal(decoder.finish(), '');
});

test('stream decoder accepts every pair of TCP split boundaries across handshake and two frames', () => {
  const secondBody = Buffer.from([0x10, 0x01, 1, 2, 3, 4, 5, 6]);
  const secondWire = encodeFrame(secondBody, 0x4c);
  const stream = Buffer.concat([clientHandshake(), fixtureWire, secondWire]);

  for (let firstCut = 0; firstCut <= stream.length; firstCut += 1) {
    for (let secondCut = firstCut; secondCut <= stream.length; secondCut += 1) {
      const decoder = new StreamDecoder();
      const chunks = [
        stream.subarray(0, firstCut),
        stream.subarray(firstCut, secondCut),
        stream.subarray(secondCut),
      ];
      const frames = [];
      let handshakeCount = 0;

      for (const chunk of chunks) {
        const result = decoder.feed(chunk);
        assert.equal(result.error, '', `split ${firstCut}/${secondCut} rejected valid bytes`);
        handshakeCount += Number(result.handshakeCompleted);
        frames.push(...result.frames);
      }

      assert.equal(handshakeCount, 1, `split ${firstCut}/${secondCut} must complete handshake once`);
      assert.equal(frames.length, 2, `split ${firstCut}/${secondCut} must yield both frames`);
      assert.equal(frames[0].sequence, 0x2a);
      assert.deepEqual(frames[0].body, fixtureBody);
      assert.equal(frames[1].sequence, 0x4c);
      assert.deepEqual(frames[1].body, secondBody);
      assert.equal(decoder.finish(), '');
    }
  }
});

test('stream decoder rejects invalid markers, short frames, and incomplete EOF', () => {
  const wrongMarker = new StreamDecoder();
  assert.equal(wrongMarker.feed(Buffer.from([0, 0, 0, 0])).error, 'unexpected client handshake');
  assert.equal(wrongMarker.failed(), true);

  const shortFrame = new StreamDecoder({ expectHandshake: false });
  assert.equal(shortFrame.feed(Buffer.from([8, 0])).error, 'invalid frame length in TCP stream');

  const incomplete = new StreamDecoder({ expectHandshake: false });
  assert.equal(incomplete.feed(fixtureWire.subarray(0, 4)).error, '');
  assert.equal(incomplete.finish(), 'TCP stream ended with an incomplete frame');
});

test('stream decoder bounds retained data and enters failed state', () => {
  const decoder = new StreamDecoder({ maxBufferedBytes: 0xffff + 4 });
  const result = decoder.feed(Buffer.alloc(0x10000 + 4));
  assert.equal(result.error, 'buffered TCP data exceeds configured limit');
  assert.equal(decoder.failed(), true);
});
