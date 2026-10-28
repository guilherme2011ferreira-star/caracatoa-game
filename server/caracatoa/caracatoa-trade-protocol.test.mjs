import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaTradeRequestBody,
  buildCaracatoaTradeStateBody,
  CARACATOA_TRADE_HEADER_BYTES,
  CARACATOA_TRADE_MAX_PAYLOAD_BYTES,
  CARACATOA_TRADE_REQUEST_OPCODE,
  CARACATOA_TRADE_STATE_OPCODE,
  parseCaracatoaTradeRequestBody,
  parseCaracatoaTradeStateBody,
} from "./caracatoa-trade-protocol.mjs";

const TRADE_ID = "00000000-0000-4000-8000-000000000001";

test("protocolo de troca round-trip valida ações, limites e estado por participante", () => {
  const request = buildCaracatoaTradeRequestBody({
    clientId: 0x2345,
    timestamp: 0x11223344,
    action: "offer",
    tradeId: TRADE_ID,
    inventorySlot: 59,
    gold: 2_147_483_647,
  });
  assert.equal(request.readUInt16LE(0), CARACATOA_TRADE_REQUEST_OPCODE);
  assert.equal(request.readUInt16LE(2), 0x2345);
  assert.equal(request.readUInt32LE(4), 0x11223344);
  assert.equal(request.readUInt8(8), 1);
  assert.equal(request.readUInt8(9), 0);
  assert.equal(request.length, CARACATOA_TRADE_HEADER_BYTES + request.readUInt16LE(10));
  assert.deepEqual(parseCaracatoaTradeRequestBody(request), {
    malformed: false,
    opcode: CARACATOA_TRADE_REQUEST_OPCODE,
    clientId: 0x2345,
    timestamp: 0x11223344,
    request: { action: "offer", tradeId: TRADE_ID, inventorySlot: 59, gold: 2_147_483_647 },
  });

  const stateBody = buildCaracatoaTradeStateBody({
    clientId: 0x2345,
    timestamp: 7,
    status: "offering",
    message: "Confirme a mesma revisão.",
    goldBalance: 900,
    trade: {
      tradeId: TRADE_ID,
      state: "offering",
      revision: 4,
      incoming: true,
      remainingMs: 30_000,
      selfName: "Beta",
      partnerName: "Alpha",
      selfOffer: { inventorySlot: null, itemClientId: null, gold: 25, ready: false },
      partnerOffer: { inventorySlot: 2, itemClientId: 7001, gold: 75, ready: true },
    },
  });
  assert.equal(stateBody.readUInt16LE(0), CARACATOA_TRADE_STATE_OPCODE);
  assert.equal(parseCaracatoaTradeStateBody(stateBody).trade.revision, 4);
  assert.equal(parseCaracatoaTradeStateBody(stateBody).trade.partnerOffer.itemClientId, 7001);
});

test("protocolo de troca recusa cabeçalhos, payloads e revisões malformados", () => {
  const valid = buildCaracatoaTradeRequestBody({
    clientId: 1,
    action: "invite",
    targetName: "Knight_01",
  });
  const wrongOpcode = Buffer.from(valid);
  wrongOpcode.writeUInt16LE(0x7f21, 0);
  assert.equal(parseCaracatoaTradeRequestBody(wrongOpcode).malformed, true);

  const wrongLength = Buffer.from(valid);
  wrongLength.writeUInt16LE(wrongLength.readUInt16LE(10) + 1, 10);
  assert.equal(parseCaracatoaTradeRequestBody(wrongLength).malformed, true);

  const invalidAction = buildCaracatoaTradeRequestBody({
    clientId: 1,
    action: "invite",
    targetName: "Knight_01",
  });
  const payloadOffset = CARACATOA_TRADE_HEADER_BYTES;
  invalidAction[payloadOffset] = 0xff;
  assert.equal(parseCaracatoaTradeRequestBody(invalidAction).malformed, true);

  assert.throws(() => buildCaracatoaTradeRequestBody({
    clientId: 1,
    action: "invite",
    targetName: "Knight Name",
  }));
  assert.throws(() => buildCaracatoaTradeRequestBody({
    clientId: 1,
    action: "ready",
    tradeId: TRADE_ID,
    revision: 0,
  }));
  assert.throws(() => buildCaracatoaTradeStateBody({
    clientId: 1,
    status: "offering",
    message: "x".repeat(121),
  }));
  assert.ok(CARACATOA_TRADE_MAX_PAYLOAD_BYTES >= 512);
});
