export const CARACATOA_TRADE_REQUEST_OPCODE = 0x7f20;
export const CARACATOA_TRADE_STATE_OPCODE = 0x7f21;
export const CARACATOA_TRADE_PROTOCOL_VERSION = 1;
export const CARACATOA_TRADE_HEADER_BYTES = 12;
export const CARACATOA_TRADE_MAX_PAYLOAD_BYTES = 1024;
export const CARACATOA_TRADE_MAX_GOLD = 2_147_483_647;
export const CARACATOA_TRADE_MAX_NAME_LENGTH = 16;

export const CARACATOA_TRADE_ACTIONS = Object.freeze({
  invite: "invite",
  accept: "accept",
  decline: "decline",
  offer: "offer",
  ready: "ready",
  cancel: "cancel",
});

export const CARACATOA_TRADE_STATUSES = Object.freeze({
  idle: "idle",
  invited: "invited",
  offering: "offering",
  committed: "committed",
  rejected: "rejected",
  cancelled: "cancelled",
});

const TRADE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const encoder = new TextEncoder();

function checkedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function checkedClientId(clientId) {
  checkedInteger(clientId, 1, 0xffff, "clientId");
}

function checkedAction(action) {
  if (!Object.values(CARACATOA_TRADE_ACTIONS).includes(action)) {
    throw new RangeError("Ação de troca inválida.");
  }
}

function checkedTradeId(value) {
  if (typeof value !== "string" || !TRADE_ID_PATTERN.test(value)) {
    throw new TypeError("ID da troca inválido.");
  }
  return value.toLowerCase();
}

function checkedRequestPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Pedido de troca inválido.");
  }
  const { action } = payload;
  checkedAction(action);
  const permitted = {
    invite: ["action", "targetName"],
    accept: ["action", "tradeId"],
    decline: ["action", "tradeId"],
    offer: ["action", "tradeId", "inventorySlot", "gold"],
    ready: ["action", "tradeId", "revision"],
    cancel: ["action", "tradeId"],
  }[action];
  if (Object.keys(payload).some((key) => !permitted.includes(key)) ||
      permitted.some((key) => !Object.hasOwn(payload, key))) {
    throw new TypeError("Campos do pedido de troca inválidos.");
  }
  if (action === "invite") {
    if (typeof payload.targetName !== "string" || !NAME_PATTERN.test(payload.targetName)) {
      throw new TypeError("Nome do destinatário inválido.");
    }
    return { action, targetName: payload.targetName };
  }
  const tradeId = checkedTradeId(payload.tradeId);
  if (action === "offer") {
    const { inventorySlot, gold } = payload;
    if (inventorySlot !== null) checkedInteger(inventorySlot, 0, 59, "inventorySlot");
    checkedInteger(gold, 0, CARACATOA_TRADE_MAX_GOLD, "gold");
    return { action, tradeId, inventorySlot, gold };
  }
  if (action === "ready") {
    checkedInteger(payload.revision, 1, 0x7fffffff, "revision");
    return { action, tradeId, revision: payload.revision };
  }
  return { action, tradeId };
}

function encodeJsonFrame({ opcode, clientId, timestamp, payload }) {
  checkedClientId(clientId);
  checkedInteger(timestamp, 0, 0xffffffff, "timestamp");
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length === 0 || bytes.length > CARACATOA_TRADE_MAX_PAYLOAD_BYTES) {
    throw new RangeError("Payload de troca excede o limite do protocolo.");
  }
  const body = Buffer.alloc(CARACATOA_TRADE_HEADER_BYTES + bytes.length);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_TRADE_PROTOCOL_VERSION, 8);
  body.writeUInt8(0, 9);
  body.writeUInt16LE(bytes.length, 10);
  Buffer.from(bytes).copy(body, CARACATOA_TRADE_HEADER_BYTES);
  return body;
}

function decodeJsonFrame(input, expectedOpcode) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < CARACATOA_TRADE_HEADER_BYTES) {
    return { malformed: true, reason: "invalid-length" };
  }
  const payloadLength = body.readUInt16LE(10);
  if (body.readUInt16LE(0) !== expectedOpcode ||
      body.readUInt16LE(2) === 0 ||
      body.readUInt8(8) !== CARACATOA_TRADE_PROTOCOL_VERSION ||
      body.readUInt8(9) !== 0 ||
      payloadLength === 0 || payloadLength > CARACATOA_TRADE_MAX_PAYLOAD_BYTES ||
      body.length !== CARACATOA_TRADE_HEADER_BYTES + payloadLength) {
    return { malformed: true, reason: "invalid-header" };
  }
  const payloadBytes = body.subarray(CARACATOA_TRADE_HEADER_BYTES);
  let payloadText;
  let payload;
  try {
    payloadText = payloadBytes.toString("utf8");
    if (!Buffer.from(payloadText, "utf8").equals(payloadBytes)) {
      return { malformed: true, reason: "invalid-utf8" };
    }
    payload = JSON.parse(payloadText);
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

export function buildCaracatoaTradeRequestBody({
  clientId,
  timestamp = Date.now() >>> 0,
  ...request
}) {
  return encodeJsonFrame({
    opcode: CARACATOA_TRADE_REQUEST_OPCODE,
    clientId,
    timestamp,
    payload: checkedRequestPayload(request),
  });
}

export function parseCaracatoaTradeRequestBody(input) {
  const frame = decodeJsonFrame(input, CARACATOA_TRADE_REQUEST_OPCODE);
  if (frame.malformed) return frame;
  try {
    frame.request = checkedRequestPayload(frame.payload);
    delete frame.payload;
    return frame;
  } catch {
    return { malformed: true, reason: "invalid-request" };
  }
}

function checkedOffer(offer) {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
    throw new TypeError("Oferta de troca inválida.");
  }
  const { inventorySlot, itemClientId, gold, ready } = offer;
  if (inventorySlot !== null) checkedInteger(inventorySlot, 0, 59, "offer.inventorySlot");
  if (itemClientId !== null) checkedInteger(itemClientId, 1, 0xffff, "offer.itemClientId");
  checkedInteger(gold, 0, CARACATOA_TRADE_MAX_GOLD, "offer.gold");
  if (typeof ready !== "boolean") throw new TypeError("offer.ready inválido.");
  return { inventorySlot, itemClientId, gold, ready };
}

function checkedTrade(trade) {
  if (trade === null) return null;
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
    throw new TypeError("Estado de troca inválido.");
  }
  const {
    tradeId, state, revision, incoming, remainingMs,
    selfName, partnerName, selfOffer, partnerOffer,
  } = trade;
  checkedTradeId(tradeId);
  if (!Object.hasOwn(CARACATOA_TRADE_STATUSES, state) ||
      !Number.isSafeInteger(revision) || revision < 0 || revision > 0x7fffffff ||
      typeof incoming !== "boolean" ||
      !Number.isSafeInteger(remainingMs) || remainingMs < 0 || remainingMs > 60_000 ||
      typeof selfName !== "string" || !NAME_PATTERN.test(selfName) ||
      typeof partnerName !== "string" || !NAME_PATTERN.test(partnerName)) {
    throw new TypeError("Cabeçalho do estado de troca inválido.");
  }
  return {
    tradeId: tradeId.toLowerCase(), state, revision, incoming, remainingMs,
    selfName, partnerName,
    selfOffer: checkedOffer(selfOffer),
    partnerOffer: checkedOffer(partnerOffer),
  };
}

export function buildCaracatoaTradeStateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  message = "",
  trade = null,
  goldBalance = null,
}) {
  if (!Object.hasOwn(CARACATOA_TRADE_STATUSES, status)) {
    throw new RangeError("Estado de resposta de troca inválido.");
  }
  if (typeof message !== "string" || message.length > 120) {
    throw new RangeError("Mensagem de troca inválida.");
  }
  if (goldBalance !== null) checkedInteger(goldBalance, 0, Number.MAX_SAFE_INTEGER, "goldBalance");
  return encodeJsonFrame({
    opcode: CARACATOA_TRADE_STATE_OPCODE,
    clientId,
    timestamp,
    payload: {
      status,
      message,
      trade: checkedTrade(trade),
      goldBalance,
    },
  });
}

export function parseCaracatoaTradeStateBody(input) {
  const frame = decodeJsonFrame(input, CARACATOA_TRADE_STATE_OPCODE);
  if (frame.malformed) return frame;
  const { payload } = frame;
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join(",") !== "goldBalance,message,status,trade" ||
        !Object.hasOwn(CARACATOA_TRADE_STATUSES, payload.status) ||
        typeof payload.message !== "string" || payload.message.length > 120 ||
        (payload.goldBalance !== null && (!Number.isSafeInteger(payload.goldBalance) || payload.goldBalance < 0))) {
      throw new TypeError("Estado de troca inválido.");
    }
    return {
      malformed: false,
      clientId: frame.clientId,
      timestamp: frame.timestamp,
      ...payload,
      trade: checkedTrade(payload.trade),
    };
  } catch {
    return { malformed: true, reason: "invalid-state" };
  }
}
