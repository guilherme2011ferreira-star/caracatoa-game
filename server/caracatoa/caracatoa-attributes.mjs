export const CARACATOA_ATTRIBUTE_REQUEST_OPCODE = 0x7f03;
export const CARACATOA_ATTRIBUTE_SYNC_OPCODE = 0x7f04;
export const CARACATOA_ATTRIBUTE_PROTOCOL_VERSION = 1;
export const CARACATOA_ATTRIBUTE_SYNC_BYTES = 48;

export const CARACATOA_ATTRIBUTE_NAMES = Object.freeze([
  "str",
  "int",
  "dex",
  "con",
]);

export const CARACATOA_ATTRIBUTE_SYNC_STATUS = Object.freeze({
  applied: 0,
  noPoints: 1,
  capped: 2,
  snapshot: 3,
});

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

/** Private Caracatoa request: 12-byte body, one point into one attribute. */
export function parseCaracatoaAttributeAllocationRequest(body) {
  if (!Buffer.isBuffer(body) || body.length !== 12) {
    return { malformed: true, reason: "invalid-length" };
  }
  const opcode = body.readUInt16LE(0);
  const clientId = body.readUInt16LE(2);
  const version = body.readUInt8(8);
  const attributeId = body.readUInt8(9);
  const pointCount = body.readUInt8(10);
  const reserved = body.readUInt8(11);
  if (
    opcode !== CARACATOA_ATTRIBUTE_REQUEST_OPCODE ||
    clientId === 0 ||
    version !== CARACATOA_ATTRIBUTE_PROTOCOL_VERSION ||
    attributeId >= CARACATOA_ATTRIBUTE_NAMES.length ||
    pointCount !== 1 ||
    reserved !== 0
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    attributeId,
    attribute: CARACATOA_ATTRIBUTE_NAMES[attributeId],
    pointCount,
  };
}

/**
 * Private Caracatoa snapshot/result: 48-byte body. The payload carries all
 * four final attributes plus derived combat/resource values for the HUD.
 */
export function buildCaracatoaAttributeSyncBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  attributeId = 0xff,
  availablePoints,
  stats,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(status, 0, 3, "status");
  assertInteger(attributeId, 0, 0xff, "attributeId");
  if (status === CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot && attributeId !== 0xff) {
    throw new RangeError("Snapshot inicial deve usar attributeId 0xFF.");
  }
  if (status !== CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot && attributeId === 0xff) {
    throw new RangeError("Resultado de alocação precisa identificar o atributo.");
  }
  if (attributeId !== 0xff) {
    assertInteger(attributeId, 0, CARACATOA_ATTRIBUTE_NAMES.length - 1, "attributeId");
  }
  assertInteger(availablePoints, 0, 0xffffffff, "availablePoints");
  if (!stats || typeof stats !== "object") {
    throw new TypeError("stats precisa ser um objeto.");
  }
  for (const field of CARACATOA_ATTRIBUTE_NAMES) {
    assertInteger(stats[field], 0, 0xffff, `stats.${field}`);
  }
  for (const field of ["maxHp", "maxMp", "damage", "defense"]) {
    assertInteger(stats[field], 0, 0x7fffffff, `stats.${field}`);
  }
  assertInteger(stats.currentHp, 0, stats.maxHp, "stats.currentHp");
  assertInteger(stats.currentMp, 0, stats.maxMp, "stats.currentMp");

  const body = Buffer.alloc(CARACATOA_ATTRIBUTE_SYNC_BYTES);
  body.writeUInt16LE(CARACATOA_ATTRIBUTE_SYNC_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_ATTRIBUTE_PROTOCOL_VERSION, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(attributeId, 10);
  body.writeUInt32LE(availablePoints, 12);
  body.writeUInt16LE(stats.str, 16);
  body.writeUInt16LE(stats.int, 18);
  body.writeUInt16LE(stats.dex, 20);
  body.writeUInt16LE(stats.con, 22);
  body.writeInt32LE(stats.currentHp, 24);
  body.writeInt32LE(stats.maxHp, 28);
  body.writeInt32LE(stats.currentMp, 32);
  body.writeInt32LE(stats.maxMp, 36);
  body.writeInt32LE(stats.damage, 40);
  body.writeInt32LE(stats.defense, 44);
  return body;
}
