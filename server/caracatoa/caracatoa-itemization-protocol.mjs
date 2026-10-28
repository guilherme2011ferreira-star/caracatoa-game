export const CARACATOA_ITEMIZATION_DETAIL_OPCODE = 0x7f0a;
export const CARACATOA_ITEMIZATION_DETAIL_BODY_LENGTH = 58;
export const CARACATOA_ITEMIZATION_DETAIL_STATUS = Object.freeze({
  snapshot: 0,
  updated: 1,
  removed: 2,
});

const RARITIES = ["normal", "mystic", "arcane", "legendary", "ancient"];
const STAT_FIELDS = [
  "physicalDamage",
  "magicAttack",
  "physicalDefense",
  "maxHp",
  "maxMp",
];

function assertInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

export function buildCaracatoaItemizationDetailBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status = CARACATOA_ITEMIZATION_DETAIL_STATUS.updated,
  slot,
  itemization = null,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(slot, 0, 59, "slot");
  if (!Object.values(CARACATOA_ITEMIZATION_DETAIL_STATUS).includes(status)) {
    throw new RangeError("status de itemização inválido.");
  }
  if (status === CARACATOA_ITEMIZATION_DETAIL_STATUS.removed) {
    if (itemization !== null) throw new RangeError("Remoção não pode carregar detalhes.");
  } else if (!itemization || typeof itemization !== "object") {
    throw new TypeError("Detalhes de itemização ausentes.");
  }

  const body = Buffer.alloc(CARACATOA_ITEMIZATION_DETAIL_BODY_LENGTH);
  body.writeUInt16LE(CARACATOA_ITEMIZATION_DETAIL_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(1, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(slot, 10);
  if (status === CARACATOA_ITEMIZATION_DETAIL_STATUS.removed) return body;

  const rarityId = RARITIES.indexOf(itemization.rarity);
  assertInteger(rarityId, 0, RARITIES.length - 1, "rarity");
  assertInteger(itemization.itemLevel, 1, 400, "itemLevel");
  const refinementLevel = itemization.refinementLevel ?? 0;
  assertInteger(refinementLevel, 0, 15, "refinementLevel");
  assertInteger(itemization.clientItemId, 1, 0xffff, "itemization.clientItemId");
  if (!itemization.baseStats || typeof itemization.baseStats !== "object") {
    throw new TypeError("baseStats inválido.");
  }
  if (!Array.isArray(itemization.affixes) || itemization.affixes.length > 4) {
    throw new TypeError("affixes precisa conter até quatro linhas.");
  }
  body.writeUInt8(rarityId + 1, 11);
  body.writeUInt16LE(itemization.clientItemId, 12);
  body.writeUInt16LE(itemization.itemLevel, 14);
  STAT_FIELDS.forEach((field, index) => {
    const value = itemization.baseStats[field];
    assertInteger(value, 0, 0x7fffffff, `baseStats.${field}`);
    body.writeInt32LE(value, 16 + index * 4);
  });
  body.writeUInt8(itemization.affixes.length, 36);
  body.writeUInt8(refinementLevel, 37);
  const usedAffixIds = new Set();
  const usedStats = new Set();
  itemization.affixes.forEach((affix, index) => {
    assertInteger(affix.clientAffixId, 1, 0xff, "clientAffixId");
    assertInteger(affix.value, 0, 100_000, "affix.value");
    if (usedAffixIds.has(affix.clientAffixId) || usedStats.has(affix.stat)) {
      throw new Error("Afixo repetido no snapshot de item.");
    }
    usedAffixIds.add(affix.clientAffixId);
    usedStats.add(affix.stat);
    const offset = 38 + index * 5;
    body.writeUInt8(affix.clientAffixId, offset);
    body.writeInt32LE(affix.value, offset + 1);
  });
  return body;
}

export function parseCaracatoaItemizationDetailBody(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    return { malformed: true, reason: "invalid-buffer" };
  }
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (body.length !== CARACATOA_ITEMIZATION_DETAIL_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== CARACATOA_ITEMIZATION_DETAIL_OPCODE) {
    return { malformed: true, reason: "invalid-opcode" };
  }
  const status = body.readUInt8(9);
  const slot = body.readUInt8(10);
  const rarity = body.readUInt8(11);
  const clientItemId = body.readUInt16LE(12);
  const itemLevel = body.readUInt16LE(14);
  const affixCount = body.readUInt8(36);
  const refinementLevel = body.readUInt8(37);
  if (
    body.readUInt8(8) !== 1 ||
    !Object.values(CARACATOA_ITEMIZATION_DETAIL_STATUS).includes(status) ||
    slot > 59 || refinementLevel > 15 || affixCount > 4 ||
    (status === CARACATOA_ITEMIZATION_DETAIL_STATUS.removed
      ? rarity !== 0 || clientItemId !== 0 || itemLevel !== 0 || affixCount !== 0
      : rarity < 1 || rarity > RARITIES.length || clientItemId === 0 || itemLevel < 1 || itemLevel > 400)
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  const baseStats = Object.fromEntries(
    STAT_FIELDS.map((field, index) => [field, body.readInt32LE(16 + index * 4)]),
  );
  const affixes = [];
  const usedIds = new Set();
  for (let index = 0; index < 4; index += 1) {
    const offset = 38 + index * 5;
    const clientAffixId = body.readUInt8(offset);
    const value = body.readInt32LE(offset + 1);
    if (index < affixCount) {
      if (clientAffixId === 0 || value < 0 || value > 100_000 || usedIds.has(clientAffixId)) {
        return { malformed: true, reason: "invalid-affix" };
      }
      usedIds.add(clientAffixId);
      affixes.push({ clientAffixId, value });
    } else if (clientAffixId !== 0 || value !== 0) {
      return { malformed: true, reason: "nonzero-unused-affix" };
    }
  }
  return {
    malformed: false,
    clientId: body.readUInt16LE(2),
    timestamp: body.readUInt32LE(4),
    status,
    slot,
    rarity: rarity === 0 ? null : RARITIES[rarity - 1],
    clientItemId,
    itemLevel,
    refinementLevel,
    baseStats,
    affixes,
  };
}
