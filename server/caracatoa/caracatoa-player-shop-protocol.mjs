export const CARACATOA_PLAYER_SHOP_REQUEST_OPCODE = 0x7f22;
export const CARACATOA_PLAYER_SHOP_STATE_OPCODE = 0x7f23;
export const CARACATOA_PLAYER_SHOP_PROTOCOL_VERSION = 1;
export const CARACATOA_PLAYER_SHOP_HEADER_BYTES = 12;
export const CARACATOA_PLAYER_SHOP_MAX_PAYLOAD_BYTES = 4096;
export const CARACATOA_PLAYER_SHOP_MAX_GOLD = 2_147_483_647;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_ITEM_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NAME = /^[A-Za-z0-9_]{1,16}$/;
const ACTIONS = new Set(["list", "mine", "create", "buy", "cancel"]);
const encoder = new TextEncoder();

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function checkedUuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${label} inválido.`);
  return value.toLowerCase();
}

function checkedClientId(value) {
  integer(value, 1, 0xffff, "clientId");
}

function checkedRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !ACTIONS.has(payload.action)) {
    throw new TypeError("Pedido do mercado inválido.");
  }
  const fields = {
    list: ["action"],
    mine: ["action"],
    create: ["action", "inventorySlot", "askingGold"],
    buy: ["action", "listingId", "requestId"],
    cancel: ["action", "listingId"],
  }[payload.action];
  if (Object.keys(payload).some((key) => !fields.includes(key)) ||
      fields.some((field) => !Object.hasOwn(payload, field))) {
    throw new TypeError("Campos do pedido do mercado inválidos.");
  }
  if (payload.action === "create") {
    integer(payload.inventorySlot, 0, 59, "inventorySlot");
    integer(payload.askingGold, 1, CARACATOA_PLAYER_SHOP_MAX_GOLD, "askingGold");
    return { action: "create", inventorySlot: payload.inventorySlot, askingGold: payload.askingGold };
  }
  if (payload.action === "buy") {
    return {
      action: "buy",
      listingId: checkedUuid(payload.listingId, "listingId"),
      requestId: checkedUuid(payload.requestId, "requestId"),
    };
  }
  if (payload.action === "cancel") {
    return { action: "cancel", listingId: checkedUuid(payload.listingId, "listingId") };
  }
  return { action: payload.action };
}

function encodeJsonBody(opcode, clientId, timestamp, payload) {
  checkedClientId(clientId);
  integer(timestamp, 0, 0xffffffff, "timestamp");
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  if (payloadBytes.length < 2 || payloadBytes.length > CARACATOA_PLAYER_SHOP_MAX_PAYLOAD_BYTES) {
    throw new RangeError("Payload do mercado excede o limite do protocolo.");
  }
  const body = Buffer.alloc(CARACATOA_PLAYER_SHOP_HEADER_BYTES + payloadBytes.length);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_PLAYER_SHOP_PROTOCOL_VERSION, 8);
  body.writeUInt8(0, 9);
  body.writeUInt16LE(payloadBytes.length, 10);
  Buffer.from(payloadBytes).copy(body, CARACATOA_PLAYER_SHOP_HEADER_BYTES);
  return body;
}

function decodeJsonBody(input, expectedOpcode) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) return { malformed: true, reason: "invalid-buffer" };
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < CARACATOA_PLAYER_SHOP_HEADER_BYTES) return { malformed: true, reason: "invalid-length" };
  const payloadLength = body.readUInt16LE(10);
  if (body.readUInt16LE(0) !== expectedOpcode || body.readUInt16LE(2) === 0 ||
      body.readUInt8(8) !== CARACATOA_PLAYER_SHOP_PROTOCOL_VERSION || body.readUInt8(9) !== 0 ||
      payloadLength < 2 || payloadLength > CARACATOA_PLAYER_SHOP_MAX_PAYLOAD_BYTES ||
      body.length !== CARACATOA_PLAYER_SHOP_HEADER_BYTES + payloadLength) {
    return { malformed: true, reason: "invalid-header" };
  }
  const bytes = body.subarray(CARACATOA_PLAYER_SHOP_HEADER_BYTES);
  let payload;
  try {
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) return { malformed: true, reason: "invalid-utf8" };
    payload = JSON.parse(text);
  } catch {
    return { malformed: true, reason: "invalid-json" };
  }
  return {
    malformed: false,
    opcode: expectedOpcode,
    clientId: body.readUInt16LE(2),
    timestamp: body.readUInt32LE(4),
    payload,
  };
}

export function buildCaracatoaPlayerShopRequestBody({
  clientId,
  timestamp = Date.now() >>> 0,
  ...request
}) {
  return encodeJsonBody(
    CARACATOA_PLAYER_SHOP_REQUEST_OPCODE,
    clientId,
    timestamp,
    checkedRequest(request),
  );
}

export function parseCaracatoaPlayerShopRequestBody(input) {
  const frame = decodeJsonBody(input, CARACATOA_PLAYER_SHOP_REQUEST_OPCODE);
  if (frame.malformed) return frame;
  try {
    frame.request = checkedRequest(frame.payload);
    delete frame.payload;
    return frame;
  } catch {
    return { malformed: true, reason: "invalid-request" };
  }
}

function checkedListing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Anúncio inválido.");
  const listingId = checkedUuid(value.listingId, "listingId");
  if (typeof value.sellerName !== "string" || !NAME.test(value.sellerName) ||
      typeof value.catalogItemId !== "string" || !ACCOUNT_ITEM_ID.test(value.catalogItemId) ||
      !Number.isInteger(value.clientItemId) || value.clientItemId < 1 || value.clientItemId > 0xffff ||
      (value.itemInstanceId !== null && !UUID.test(value.itemInstanceId)) ||
      typeof value.own !== "boolean") throw new TypeError("Identificação do anúncio inválida.");
  integer(value.stackCount, 1, 500, "stackCount");
  integer(value.askingGold, 1, CARACATOA_PLAYER_SHOP_MAX_GOLD, "askingGold");
  integer(value.createdAtMs, 0, Number.MAX_SAFE_INTEGER, "createdAtMs");
  integer(value.expiresAtMs, value.createdAtMs + 1, Number.MAX_SAFE_INTEGER, "expiresAtMs");
  const nullableInteger = (item, min, max, label) => {
    if (item !== null) integer(item, min, max, label);
  };
  if (value.rarity !== null && !["normal", "mystic", "arcane", "legendary", "ancient"].includes(value.rarity)) {
    throw new TypeError("Raridade do anúncio inválida.");
  }
  nullableInteger(value.itemLevel, 1, 400, "itemLevel");
  nullableInteger(value.refinementLevel, 0, 15, "refinementLevel");
  return {
    listingId,
    sellerName: value.sellerName,
    catalogItemId: value.catalogItemId,
    clientItemId: value.clientItemId,
    itemInstanceId: value.itemInstanceId,
    stackCount: value.stackCount,
    askingGold: value.askingGold,
    rarity: value.rarity,
    itemLevel: value.itemLevel,
    refinementLevel: value.refinementLevel,
    createdAtMs: value.createdAtMs,
    expiresAtMs: value.expiresAtMs,
    own: value.own,
  };
}

function checkedReceipt(receipt) {
  if (receipt === null) return null;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new TypeError("Recibo inválido.");
  checkedUuid(receipt.listingId, "receipt.listingId");
  if (typeof receipt.catalogItemId !== "string" || !ACCOUNT_ITEM_ID.test(receipt.catalogItemId) ||
      !Number.isInteger(receipt.clientItemId) || receipt.clientItemId < 1 || receipt.clientItemId > 0xffff ||
      (receipt.itemInstanceId !== null && !UUID.test(receipt.itemInstanceId)) ||
      typeof receipt.sellerName !== "string" || !NAME.test(receipt.sellerName)) {
    throw new TypeError("Identidade do recibo inválida.");
  }
  integer(receipt.stackCount, 1, 500, "receipt.stackCount");
  integer(receipt.inventorySlot, 0, 59, "receipt.inventorySlot");
  integer(receipt.askingGold, 1, CARACATOA_PLAYER_SHOP_MAX_GOLD, "receipt.askingGold");
  integer(receipt.buyerGoldBalance, 0, CARACATOA_PLAYER_SHOP_MAX_GOLD, "receipt.buyerGoldBalance");
  return {
    listingId: receipt.listingId,
    catalogItemId: receipt.catalogItemId,
    clientItemId: receipt.clientItemId,
    itemInstanceId: receipt.itemInstanceId,
    stackCount: receipt.stackCount,
    inventorySlot: receipt.inventorySlot,
    askingGold: receipt.askingGold,
    sellerName: receipt.sellerName,
    buyerGoldBalance: receipt.buyerGoldBalance,
  };
}

export function buildCaracatoaPlayerShopStateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  message = "",
  reason = null,
  view = "market",
  goldBalance = null,
  listings = [],
  receipt = null,
}) {
  if (!["ok", "rejected"].includes(status) || typeof message !== "string" || message.length > 140 ||
      (reason !== null && (typeof reason !== "string" || reason.length > 48)) ||
      !["market", "mine"].includes(view) || !Array.isArray(listings) || listings.length > 8) {
    throw new TypeError("Estado do mercado inválido.");
  }
  if (goldBalance !== null) integer(goldBalance, 0, CARACATOA_PLAYER_SHOP_MAX_GOLD, "goldBalance");
  const checkedListings = listings.map(checkedListing);
  const checkedBuyReceipt = checkedReceipt(receipt);
  const body = encodeJsonBody(CARACATOA_PLAYER_SHOP_STATE_OPCODE, clientId, timestamp, {
    status, message, reason, view, goldBalance,
    listings: checkedListings,
    receipt: checkedBuyReceipt,
  });
  return body;
}

export function parseCaracatoaPlayerShopStateBody(input) {
  const frame = decodeJsonBody(input, CARACATOA_PLAYER_SHOP_STATE_OPCODE);
  if (frame.malformed) return frame;
  const value = frame.payload;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !["ok", "rejected"].includes(value.status) || typeof value.message !== "string" || value.message.length > 140 ||
        (value.reason !== null && (typeof value.reason !== "string" || value.reason.length > 48)) ||
        !["market", "mine"].includes(value.view) || !Array.isArray(value.listings) || value.listings.length > 8) {
      throw new TypeError("Resposta do mercado inválida.");
    }
    if (value.goldBalance !== null) integer(value.goldBalance, 0, CARACATOA_PLAYER_SHOP_MAX_GOLD, "goldBalance");
    frame.state = {
      status: value.status,
      message: value.message,
      reason: value.reason,
      view: value.view,
      goldBalance: value.goldBalance,
      listings: value.listings.map(checkedListing),
      receipt: checkedReceipt(value.receipt),
    };
    delete frame.payload;
    return frame;
  } catch {
    return { malformed: true, reason: "invalid-state" };
  }
}
