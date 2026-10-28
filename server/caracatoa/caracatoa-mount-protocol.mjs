export const CARACATOA_MOUNT_REQUEST_OPCODE = 0x7f0c;
export const CARACATOA_MOUNT_STATE_OPCODE = 0x7f0d;
export const CARACATOA_MOUNT_PROTOCOL_VERSION = 1;
export const CARACATOA_MOUNT_REQUEST_BYTES = 48;
export const CARACATOA_MOUNT_HEADER_BYTES = 16;
export const CARACATOA_MOUNT_ENTRY_BYTES = 84;
export const CARACATOA_MOUNT_MAX_ENTRIES = 20;

export const CARACATOA_MOUNT_ACTION = Object.freeze({
  list: 0,
  incubate: 1,
  feed: 2,
  evolve: 3,
  select: 4,
  ride: 5,
  dismount: 6,
});

export const CARACATOA_MOUNT_STATUS = Object.freeze({
  snapshot: 0,
  applied: 1,
  rejected: 2,
  waiting: 3,
  missingItem: 4,
});

export const CARACATOA_MOUNT_REASON = Object.freeze({
  none: 0,
  notReady: 1,
  missingDust: 2,
  missingRation: 3,
  levelRequirement: 4,
  mountState: 5,
  storageUnavailable: 6,
  invalidAction: 7,
});

const ACTION_NAMES = new Map(Object.entries(CARACATOA_MOUNT_ACTION).map(([name, id]) => [id, name]));
const SPECIES_IDS = Object.freeze({
  equus: 1,
  tigre: 2,
  lobo: 3,
  grifo: 4,
  hipogrifo: 5,
  pegaso: 6,
  dragao: 7,
  fentris: 8,
});
const SPECIES_BY_ID = new Map(Object.entries(SPECIES_IDS).map(([id, numeric]) => [numeric, id]));
const STAGES = Object.freeze({ egg: 0, juvenile: 1, adult: 2, dead: 3 });
const STAGES_BY_ID = new Map(Object.entries(STAGES).map(([id, numeric]) => [numeric, id]));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function writeUuid(body, offset, mountId) {
  const value = mountId ?? "00000000-0000-0000-0000-000000000000";
  if (typeof value !== "string" || (value !== "00000000-0000-0000-0000-000000000000" && !UUID_PATTERN.test(value))) {
    throw new TypeError("ID de montaria inválido.");
  }
  body.write(value.toLowerCase(), offset, 36, "ascii");
}

function readUuid(body, offset) {
  return body.toString("ascii", offset, offset + 36);
}

/** Private Caracatoa command. Client time is diagnostic only; rules use server time. */
export function buildCaracatoaMountRequestBody({
  clientId,
  timestamp = Date.now() >>> 0,
  action,
  mountId = null,
  inventorySlot = 0xff,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  if (!Object.values(CARACATOA_MOUNT_ACTION).includes(action)) {
    throw new RangeError("Ação de montaria inválida.");
  }
  const itemAction = [CARACATOA_MOUNT_ACTION.incubate, CARACATOA_MOUNT_ACTION.feed, CARACATOA_MOUNT_ACTION.evolve].includes(action);
  assertInteger(inventorySlot, itemAction ? 0 : 0xff, itemAction ? 59 : 0xff, "inventorySlot");
  if (action === CARACATOA_MOUNT_ACTION.list) {
    if (mountId !== null) throw new TypeError("Snapshot de montarias não recebe ID.");
  } else if (typeof mountId !== "string" || !UUID_PATTERN.test(mountId)) {
    throw new TypeError("Ação de montaria exige ID UUID válido.");
  }

  const body = Buffer.alloc(CARACATOA_MOUNT_REQUEST_BYTES);
  body.writeUInt16LE(CARACATOA_MOUNT_REQUEST_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_MOUNT_PROTOCOL_VERSION, 8);
  body.writeUInt8(action, 9);
  body.writeUInt8(inventorySlot, 10);
  body.writeUInt8(0, 11);
  writeUuid(body, 12, mountId);
  return body;
}

export function parseCaracatoaMountRequestBody(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== CARACATOA_MOUNT_REQUEST_BYTES) {
    return { malformed: true, reason: "invalid-length" };
  }
  const clientId = body.readUInt16LE(2);
  const actionId = body.readUInt8(9);
  const action = ACTION_NAMES.get(actionId);
  const inventorySlot = body.readUInt8(10);
  const mountId = readUuid(body, 12);
  const zeroId = mountId === "00000000-0000-0000-0000-000000000000";
  const itemAction = actionId === CARACATOA_MOUNT_ACTION.incubate ||
    actionId === CARACATOA_MOUNT_ACTION.feed || actionId === CARACATOA_MOUNT_ACTION.evolve;
  if (
    body.readUInt16LE(0) !== CARACATOA_MOUNT_REQUEST_OPCODE ||
    clientId === 0 ||
    body.readUInt8(8) !== CARACATOA_MOUNT_PROTOCOL_VERSION ||
    action === undefined ||
    body.readUInt8(11) !== 0 ||
    (itemAction ? inventorySlot > 59 : inventorySlot !== 0xff) ||
    (actionId === CARACATOA_MOUNT_ACTION.list ? !zeroId : !UUID_PATTERN.test(mountId))
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    action,
    actionId,
    inventorySlot: itemAction ? inventorySlot : null,
    mountId: zeroId ? null : mountId,
  };
}

function checkedMountEntry(entry, nowMs) {
  const { mount, species, bonuses = null } = entry ?? {};
  if (!mount || !species || typeof mount.id !== "string" || !UUID_PATTERN.test(mount.id)) {
    throw new TypeError("Montaria do snapshot inválida.");
  }
  const speciesId = SPECIES_IDS[mount.speciesId];
  const stageId = STAGES[mount.stage];
  if (!speciesId || stageId === undefined) throw new RangeError("Espécie ou estágio de montaria inválido.");
  const fields = {
    level: [mount.level, 1, 50],
    experience: [mount.experience, 0, 0x7fffffff],
    hunger: [mount.hunger, 0, 0xffff],
    maxHunger: [mount.maxHunger, 1, 0xffff],
    vitality: [mount.vitality, 0, 0xffff],
    maxVitality: [mount.maxVitality, 1, 0xffff],
    incubationRemaining: [mount.incubationRemaining, 0, 0xffff],
    requiredLevel: [species.requiredLevel, 1, 400],
  };
  for (const [name, [value, min, max]] of Object.entries(fields)) assertInteger(value, min, max, `mount.${name}`);
  const waitMs = mount.stage === "egg" ? Math.max(0, mount.incubationReadyAtMs - nowMs) : 0;
  const remainingLifetimeMs = mount.expiresAtMs === null ? 0 : Math.max(0, mount.expiresAtMs - nowMs);
  assertInteger(waitMs, 0, 0xffffffff, "incubationWaitMs");
  assertInteger(remainingLifetimeMs, 0, 0xffffffff, "remainingLifetimeMs");
  const stat = (value, label) => {
    const result = value ?? 0;
    assertInteger(result, 0, 0x7fffffff, label);
    return result;
  };
  const basisPoints = (value, label) => {
    const result = value ?? 0;
    assertInteger(result, 0, 0xffff, label);
    return result;
  };
  return {
    mount,
    speciesId,
    stageId,
    waitMs,
    remainingLifetimeMs,
    bonuses: mount.stage === "egg" || mount.stage === "dead" ? null : bonuses,
    hp: stat(bonuses?.hp, "bonus.hp"),
    physicalAttack: stat(bonuses?.physicalAttack, "bonus.physicalAttack"),
    magicAttack: stat(bonuses?.magicAttack, "bonus.magicAttack"),
    defense: stat(bonuses?.defense, "bonus.defense"),
    moveSpeedBps: basisPoints(bonuses?.moveSpeedBps, "bonus.moveSpeedBps"),
    absorptionBps: basisPoints(bonuses?.absorptionBps, "bonus.absorptionBps"),
  };
}

/** Server-authored snapshot/result; bonus values and timers never come from the client. */
export function buildCaracatoaMountStateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status = CARACATOA_MOUNT_STATUS.snapshot,
  action = CARACATOA_MOUNT_ACTION.list,
  reason = CARACATOA_MOUNT_REASON.none,
  mounts = [],
  nowMs = Date.now(),
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(status, 0, 4, "status");
  assertInteger(action, 0, 6, "action");
  assertInteger(reason, 0, 7, "reason");
  assertInteger(nowMs, 0, Number.MAX_SAFE_INTEGER, "nowMs");
  if (!Array.isArray(mounts) || mounts.length > CARACATOA_MOUNT_MAX_ENTRIES) {
    throw new RangeError("Quantidade de montarias fora do limite.");
  }
  const body = Buffer.alloc(CARACATOA_MOUNT_HEADER_BYTES + mounts.length * CARACATOA_MOUNT_ENTRY_BYTES);
  body.writeUInt16LE(CARACATOA_MOUNT_STATE_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_MOUNT_PROTOCOL_VERSION, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(action, 10);
  body.writeUInt8(mounts.length, 11);
  body.writeUInt16LE(reason, 12);
  body.writeUInt16LE(0, 14);
  const ids = new Set();
  mounts.forEach((entry, index) => {
    const value = checkedMountEntry(entry, nowMs);
    if (ids.has(value.mount.id)) throw new Error("Snapshot contém ID de montaria duplicado.");
    ids.add(value.mount.id);
    const offset = CARACATOA_MOUNT_HEADER_BYTES + index * CARACATOA_MOUNT_ENTRY_BYTES;
    body.write(value.mount.id.toLowerCase(), offset, 36, "ascii");
    body.writeUInt8(value.speciesId, offset + 36);
    body.writeUInt8(value.stageId, offset + 37);
    body.writeUInt8(value.mount.level, offset + 38);
    body.writeUInt8((value.mount.active ? 1 : 0) | (value.mount.riding ? 2 : 0), offset + 39);
    body.writeUInt32LE(value.mount.experience, offset + 40);
    body.writeUInt16LE(value.mount.hunger, offset + 44);
    body.writeUInt16LE(value.mount.maxHunger, offset + 46);
    body.writeUInt16LE(value.mount.vitality, offset + 48);
    body.writeUInt16LE(value.mount.maxVitality, offset + 50);
    body.writeUInt16LE(value.mount.incubationRemaining, offset + 52);
    body.writeUInt16LE(entry.species.requiredLevel, offset + 54);
    body.writeUInt32LE(value.waitMs, offset + 56);
    body.writeInt32LE(value.hp, offset + 60);
    body.writeInt32LE(value.physicalAttack, offset + 64);
    body.writeInt32LE(value.magicAttack, offset + 68);
    body.writeInt32LE(value.defense, offset + 72);
    body.writeUInt16LE(value.moveSpeedBps, offset + 76);
    body.writeUInt16LE(value.absorptionBps, offset + 78);
    body.writeUInt32LE(value.remainingLifetimeMs, offset + 80);
  });
  return body;
}

export function parseCaracatoaMountStateBody(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) return { malformed: true, reason: "invalid-buffer" };
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length < CARACATOA_MOUNT_HEADER_BYTES || body.readUInt16LE(0) !== CARACATOA_MOUNT_STATE_OPCODE) {
    return { malformed: true, reason: "invalid-header" };
  }
  const status = body.readUInt8(9);
  const actionId = body.readUInt8(10);
  const count = body.readUInt8(11);
  const clientId = body.readUInt16LE(2);
  const reason = body.readUInt16LE(12);
  const expectedLength = CARACATOA_MOUNT_HEADER_BYTES + count * CARACATOA_MOUNT_ENTRY_BYTES;
  if (
    body.length !== expectedLength || clientId === 0 ||
    body.readUInt8(8) !== CARACATOA_MOUNT_PROTOCOL_VERSION ||
    status > 4 || !ACTION_NAMES.has(actionId) || count > CARACATOA_MOUNT_MAX_ENTRIES || reason > 7 ||
    body.readUInt16LE(14) !== 0
  ) return { malformed: true, reason: "invalid-fields" };
  const mounts = [];
  const ids = new Set();
  for (let index = 0; index < count; index += 1) {
    const offset = CARACATOA_MOUNT_HEADER_BYTES + index * CARACATOA_MOUNT_ENTRY_BYTES;
    const id = readUuid(body, offset);
    const speciesId = SPECIES_BY_ID.get(body.readUInt8(offset + 36));
    const stage = STAGES_BY_ID.get(body.readUInt8(offset + 37));
    const flags = body.readUInt8(offset + 39);
    const level = body.readUInt8(offset + 38);
    const experience = body.readUInt32LE(offset + 40);
    const hunger = body.readUInt16LE(offset + 44);
    const maxHunger = body.readUInt16LE(offset + 46);
    const vitality = body.readUInt16LE(offset + 48);
    const maxVitality = body.readUInt16LE(offset + 50);
    const requiredLevel = body.readUInt16LE(offset + 54);
    if (!UUID_PATTERN.test(id) || !speciesId || stage === undefined || flags > 3 ||
        level < 1 || level > 50 || experience > 0x7fffffff ||
        maxHunger < 1 || hunger > maxHunger || maxVitality < 1 || vitality > maxVitality ||
        ((flags & 2) !== 0 && (flags & 1) === 0) ||
        (stage === "dead" && flags !== 0) ||
        requiredLevel < 1 || requiredLevel > 400 || ids.has(id)) {
      return { malformed: true, reason: "invalid-mount-entry" };
    }
    ids.add(id);
    mounts.push({
      id,
      speciesId,
      stage,
      level,
      active: (flags & 1) !== 0,
      riding: (flags & 2) !== 0,
      experience,
      hunger,
      maxHunger,
      vitality,
      maxVitality,
      incubationRemaining: body.readUInt16LE(offset + 52),
      incubationWaitMs: body.readUInt32LE(offset + 56),
      bonuses: {
        hp: body.readInt32LE(offset + 60),
        physicalAttack: body.readInt32LE(offset + 64),
        magicAttack: body.readInt32LE(offset + 68),
        defense: body.readInt32LE(offset + 72),
        moveSpeedBps: body.readUInt16LE(offset + 76),
        absorptionBps: body.readUInt16LE(offset + 78),
      },
      requiredLevel,
      remainingLifetimeMs: body.readUInt32LE(offset + 80),
    });
  }
  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    status,
    actionId,
    action: ACTION_NAMES.get(actionId),
    reason,
    mounts,
  };
}
