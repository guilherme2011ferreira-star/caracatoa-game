export const CARACATOA_REFINEMENT_REQUEST_OPCODE = 0x7f10;
export const CARACATOA_REFINEMENT_RESULT_OPCODE = 0x7f11;
export const CARACATOA_STAGE_REQUEST_OPCODE = 0x7f12;
export const CARACATOA_STAGE_STATE_OPCODE = 0x7f13;
export const CARACATOA_ADVANCEMENT_REQUEST_BODY_LENGTH = 48;
export const CARACATOA_REFINEMENT_RESULT_BODY_LENGTH = 24;
export const CARACATOA_STAGE_STATE_BODY_LENGTH = 36;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = ["mortal", "arch", "celestial", "sub-celestial"];

export const CARACATOA_REFINEMENT_STATUS = Object.freeze({
  success: 0,
  failed: 1,
  rejected: 2,
  duplicate: 3,
});

export const CARACATOA_REFINEMENT_REASON = Object.freeze({
  none: 0,
  emptySlot: 1,
  notItemizedEquipment: 2,
  itemLevelTooHigh: 3,
  maximumRefinement: 4,
  missingCatalyst: 5,
  missingDivineDust: 6,
  divineLevelTooLow: 7,
  invalidStack: 8,
  storageUnavailable: 9,
  eventConflict: 10,
});

export const CARACATOA_STAGE_STATUS = Object.freeze({ snapshot: 0, promoted: 1, rejected: 2 });
export const CARACATOA_STAGE_REASON = Object.freeze({
  none: 0,
  levelCapRequired: 1,
  missingMaterial: 2,
  maximumStage: 3,
  storageUnavailable: 4,
  pointsCap: 5,
  eventConflict: 6,
});

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function readRequest(input, expectedOpcode) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== CARACATOA_ADVANCEMENT_REQUEST_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== expectedOpcode) return { malformed: true, reason: "invalid-opcode" };
  if (body.readUInt8(8) !== 1) {
    return { malformed: true, reason: "invalid-fields" };
  }
  const clientId = body.readUInt16LE(2);
  if (clientId === 0) return { malformed: true, reason: "invalid-client-id" };
  const requestId = body.toString("ascii", 12, 48);
  if (!UUID_PATTERN.test(requestId)) return { malformed: true, reason: "invalid-request-id" };
  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    requestId: requestId.toLowerCase(),
  };
}

function writeHeader(body, opcode, clientId, timestamp) {
  integer(clientId, 1, 0xffff, "clientId");
  integer(timestamp, 0, 0xffffffff, "timestamp");
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(1, 8);
}

function buildAdvancementRequest({ opcode, clientId, timestamp, requestId, byte9, byte10 = 0 }) {
  integer(clientId, 1, 0xffff, "clientId");
  integer(timestamp, 0, 0xffffffff, "timestamp");
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
    throw new RangeError("requestId precisa ser UUID.");
  }
  const body = Buffer.alloc(CARACATOA_ADVANCEMENT_REQUEST_BODY_LENGTH);
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(1, 8);
  body.writeUInt8(byte9, 9);
  body.writeUInt8(byte10, 10);
  body.write(requestId.toLowerCase(), 12, 36, "ascii");
  return body;
}

export function buildCaracatoaRefinementRequestBody({
  clientId,
  timestamp = Date.now() >>> 0,
  inventorySlot,
  useDivineDust = false,
  requestId,
}) {
  integer(inventorySlot, 0, 59, "inventorySlot");
  if (useDivineDust !== true && useDivineDust !== false) throw new RangeError("useDivineDust inválido.");
  return buildAdvancementRequest({
    opcode: CARACATOA_REFINEMENT_REQUEST_OPCODE,
    clientId,
    timestamp,
    requestId,
    byte9: inventorySlot,
    byte10: useDivineDust ? 1 : 0,
  });
}

export function buildCaracatoaStageRequestBody({
  clientId,
  timestamp = Date.now() >>> 0,
  requestId,
}) {
  return buildAdvancementRequest({
    opcode: CARACATOA_STAGE_REQUEST_OPCODE,
    clientId,
    timestamp,
    requestId,
    byte9: 1,
  });
}

export function parseCaracatoaRefinementRequest(input) {
  const request = readRequest(input, CARACATOA_REFINEMENT_REQUEST_OPCODE);
  if (request.malformed) return request;
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const useDivineDust = body.readUInt8(10) === 1;
  // Refinement uses byte 10 for the divine-dust flag and byte 11 as reserved.
  if (body.readUInt8(9) > 59 || body.readUInt8(10) > 1 || body.readUInt8(11) !== 0) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { ...request, inventorySlot: body.readUInt8(9), useDivineDust };
}

export function parseCaracatoaStageRequest(input) {
  const request = readRequest(input, CARACATOA_STAGE_REQUEST_OPCODE);
  if (request.malformed) return request;
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.readUInt8(9) !== 1 || body.readUInt16LE(10) !== 0) return { malformed: true, reason: "invalid-action" };
  return request;
}

export function buildCaracatoaRefinementResultBody({
  clientId,
  timestamp = Date.now() >>> 0,
  result,
}) {
  if (!result || typeof result !== "object") throw new TypeError("Resultado de refinamento ausente.");
  const status = result.status === "success" ? CARACATOA_REFINEMENT_STATUS.success
    : result.status === "failed" ? CARACATOA_REFINEMENT_STATUS.failed
      : result.status === "duplicate" ? CARACATOA_REFINEMENT_STATUS.duplicate
        : CARACATOA_REFINEMENT_STATUS.rejected;
  const reasonName = result.reason ?? "none";
  const reasonKey = typeof reasonName === "string"
    ? reasonName.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
    : "storageUnavailable";
  const reason = CARACATOA_REFINEMENT_REASON[reasonKey] ?? CARACATOA_REFINEMENT_REASON.storageUnavailable;
  const slot = result.slot ?? 0;
  const oldLevel = result.oldLevel ?? 0;
  const targetLevel = result.targetLevel ?? 0;
  const newLevel = result.newLevel ?? 0;
  const chanceBps = result.chanceBps ?? 0;
  const materialClientItemId = result.materialClientItemId ?? 0;
  integer(slot, 0, 59, "slot");
  integer(oldLevel, 0, 15, "oldLevel");
  integer(targetLevel, 0, 15, "targetLevel");
  integer(newLevel, 0, 15, "newLevel");
  integer(chanceBps, 0, 10_000, "chanceBps");
  integer(materialClientItemId, 0, 0xffff, "materialClientItemId");
  const body = Buffer.alloc(CARACATOA_REFINEMENT_RESULT_BODY_LENGTH);
  writeHeader(body, CARACATOA_REFINEMENT_RESULT_OPCODE, clientId, timestamp);
  body.writeUInt8(status, 9);
  body.writeUInt8(slot, 10);
  body.writeUInt8(oldLevel, 11);
  body.writeUInt8(targetLevel, 12);
  body.writeUInt8(newLevel, 13);
  body.writeUInt8(result.success === true ? 1 : 0, 14);
  body.writeUInt8(reason, 15);
  body.writeUInt16LE(materialClientItemId, 16);
  body.writeUInt16LE(chanceBps, 18);
  body.writeUInt8(result.divineDustUsed === true ? 1 : 0, 20);
  return body;
}

export function parseCaracatoaRefinementResult(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) return { malformed: true, reason: "invalid-buffer" };
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== CARACATOA_REFINEMENT_RESULT_BODY_LENGTH) return { malformed: true, reason: "invalid-length" };
  if (body.readUInt16LE(0) !== CARACATOA_REFINEMENT_RESULT_OPCODE) return { malformed: true, reason: "invalid-opcode" };
  const result = {
    clientId: body.readUInt16LE(2),
    timestamp: body.readUInt32LE(4),
    version: body.readUInt8(8),
    status: body.readUInt8(9),
    slot: body.readUInt8(10),
    oldLevel: body.readUInt8(11),
    targetLevel: body.readUInt8(12),
    newLevel: body.readUInt8(13),
    success: body.readUInt8(14) === 1,
    reason: body.readUInt8(15),
    materialClientItemId: body.readUInt16LE(16),
    chanceBps: body.readUInt16LE(18),
    divineDustUsed: body.readUInt8(20) === 1,
  };
  if (result.clientId === 0 || result.version !== 1 || result.status > 3 || result.slot > 59 ||
      result.oldLevel > 15 || result.targetLevel > 15 || result.newLevel > 15 ||
      body.readUInt8(14) > 1 || result.reason > 10 || result.chanceBps > 10_000 ||
      body.readUInt8(20) > 1 || body.readUInt8(21) !== 0 || body.readUInt16LE(22) !== 0) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { malformed: false, ...result };
}

export function buildCaracatoaStageStateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status = CARACATOA_STAGE_STATUS.snapshot,
  reason = CARACATOA_STAGE_REASON.none,
  state,
}) {
  if (!state || typeof state !== "object") throw new TypeError("Estado de estágio ausente.");
  const stageId = STAGES.indexOf(state.stage);
  if (stageId < 0) throw new RangeError("Estágio de personagem inválido.");
  integer(status, 0, 2, "status");
  integer(reason, 0, 6, "reason");
  integer(state.level, 1, 400, "stage level");
  integer(state.totalLevel, 1, 1600, "total level");
  integer(state.experience, 0, Number.MAX_SAFE_INTEGER, "experience");
  integer(state.availableAttributePoints, 0, 0xffffffff, "attribute points");
  integer(state.availableSkillPoints, 0, 0xffffffff, "skill points");
  integer(state.requiredMaterialClientItemId, 0, 0xffff, "required item");
  const body = Buffer.alloc(CARACATOA_STAGE_STATE_BODY_LENGTH);
  writeHeader(body, CARACATOA_STAGE_STATE_OPCODE, clientId, timestamp);
  body.writeUInt8(status, 9);
  body.writeUInt8(stageId, 10);
  body.writeUInt8(reason, 11);
  body.writeUInt16LE(state.level, 12);
  body.writeUInt16LE(state.totalLevel, 14);
  body.writeBigUInt64LE(BigInt(state.experience), 16);
  body.writeUInt32LE(state.availableAttributePoints, 24);
  body.writeUInt32LE(state.availableSkillPoints, 28);
  body.writeUInt16LE(state.requiredMaterialClientItemId, 32);
  return body;
}

export function parseCaracatoaStageState(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) return { malformed: true, reason: "invalid-buffer" };
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== CARACATOA_STAGE_STATE_BODY_LENGTH) return { malformed: true, reason: "invalid-length" };
  if (body.readUInt16LE(0) !== CARACATOA_STAGE_STATE_OPCODE) return { malformed: true, reason: "invalid-opcode" };
  const state = {
    clientId: body.readUInt16LE(2),
    timestamp: body.readUInt32LE(4),
    version: body.readUInt8(8),
    status: body.readUInt8(9),
    stage: STAGES[body.readUInt8(10)],
    reason: body.readUInt8(11),
    level: body.readUInt16LE(12),
    totalLevel: body.readUInt16LE(14),
    experience: Number(body.readBigUInt64LE(16)),
    availableAttributePoints: body.readUInt32LE(24),
    availableSkillPoints: body.readUInt32LE(28),
    requiredMaterialClientItemId: body.readUInt16LE(32),
  };
  if (state.clientId === 0 || state.version !== 1 || state.status > 2 || !state.stage ||
      state.reason > 6 || state.level < 1 || state.level > 400 || state.totalLevel < 1 || state.totalLevel > 1600 ||
      state.experience > Number.MAX_SAFE_INTEGER || body.readUInt16LE(34) !== 0) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return { malformed: false, ...state };
}
