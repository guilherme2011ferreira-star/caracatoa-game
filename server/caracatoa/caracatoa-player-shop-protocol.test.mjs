import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaPlayerShopRequestBody,
  buildCaracatoaPlayerShopStateBody,
  CARACATOA_PLAYER_SHOP_HEADER_BYTES,
  CARACATOA_PLAYER_SHOP_MAX_PAYLOAD_BYTES,
  CARACATOA_PLAYER_SHOP_REQUEST_OPCODE,
  CARACATOA_PLAYER_SHOP_STATE_OPCODE,
  parseCaracatoaPlayerShopRequestBody,
  parseCaracatoaPlayerShopStateBody,
} from "./caracatoa-player-shop-protocol.mjs";

const LISTING_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";

test("protocolo do mercado valida moldura, criação, compra e snapshot", () => {
  const request = buildCaracatoaPlayerShopRequestBody({
    clientId: 0x2345,
    timestamp: 0x11223344,
    action: "create",
    inventorySlot: 59,
    askingGold: 2_147_483_647,
  });
  assert.equal(request.readUInt16LE(0), CARACATOA_PLAYER_SHOP_REQUEST_OPCODE);
  assert.equal(request.readUInt16LE(2), 0x2345);
  assert.equal(request.readUInt32LE(4), 0x11223344);
  assert.equal(request.readUInt8(8), 1);
  assert.equal(request.readUInt8(9), 0);
  assert.equal(request.length, CARACATOA_PLAYER_SHOP_HEADER_BYTES + request.readUInt16LE(10));
  assert.deepEqual(parseCaracatoaPlayerShopRequestBody(request).request, {
    action: "create", inventorySlot: 59, askingGold: 2_147_483_647,
  });

  const buy = buildCaracatoaPlayerShopRequestBody({
    clientId: 0x2345, action: "buy", listingId: LISTING_ID, requestId: REQUEST_ID,
  });
  assert.deepEqual(parseCaracatoaPlayerShopRequestBody(buy).request, {
    action: "buy", listingId: LISTING_ID, requestId: REQUEST_ID,
  });

  const state = buildCaracatoaPlayerShopStateBody({
    clientId: 0x2345,
    timestamp: 9,
    status: "ok",
    message: "Feira atualizada.",
    view: "market",
    goldBalance: 9876,
    listings: [{
      listingId: LISTING_ID,
      sellerName: "Vendedora",
      catalogItemId: "astral-cuirass",
      clientItemId: 8221,
      itemInstanceId: null,
      stackCount: 1,
      askingGold: 1200,
      rarity: "legendary",
      itemLevel: 80,
      refinementLevel: 7,
      createdAtMs: 100,
      expiresAtMs: 604800100,
      own: false,
    }],
  });
  assert.equal(state.readUInt16LE(0), CARACATOA_PLAYER_SHOP_STATE_OPCODE);
  const parsed = parseCaracatoaPlayerShopStateBody(state);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.state.listings[0].askingGold, 1200);
  assert.equal(parsed.state.listings[0].rarity, "legendary");
  assert.ok(CARACATOA_PLAYER_SHOP_MAX_PAYLOAD_BYTES >= 2048);
});

test("protocolo do mercado rejeita headers e campos inválidos", () => {
  const valid = buildCaracatoaPlayerShopRequestBody({ clientId: 1, action: "list" });
  const wrongOpcode = Buffer.from(valid);
  wrongOpcode.writeUInt16LE(0x7f21, 0);
  assert.equal(parseCaracatoaPlayerShopRequestBody(wrongOpcode).malformed, true);
  const wrongVersion = Buffer.from(valid);
  wrongVersion.writeUInt8(2, 8);
  assert.equal(parseCaracatoaPlayerShopRequestBody(wrongVersion).malformed, true);
  const malformedJson = Buffer.from(valid);
  malformedJson[CARACATOA_PLAYER_SHOP_HEADER_BYTES] = 0xff;
  assert.equal(parseCaracatoaPlayerShopRequestBody(malformedJson).malformed, true);
  assert.throws(() => buildCaracatoaPlayerShopRequestBody({
    clientId: 1, action: "create", inventorySlot: 60, askingGold: 1,
  }));
  assert.throws(() => buildCaracatoaPlayerShopRequestBody({
    clientId: 1, action: "buy", listingId: LISTING_ID, requestId: "bad",
  }));
});
