import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  combineCaracatoaDamageAbsorptionBps,
  computeCaracatoaDamage,
  computeCaracatoaDamageAfterAbsorption,
  computeCaracatoaMagicAttackPower,
} from "./caracatoa-combat.mjs";
import { encodeFrame, StreamDecoder } from "./protocol.mjs";
import { inspectWyd727ClientFrame } from "./wyd-727-profile.mjs";
import { authenticateWyd727LoginPacket } from "./wyd-727-login-auth.mjs";
import { authenticateWyd727TokenPacket } from "./wyd-727-token-auth.mjs";
import { Wyd727AttemptLimiter } from "./wyd-727-attempt-limiter.mjs";
import {
  CARACATOA_CREATE_CHARACTER_STATUS,
  parseCaracatoaCreateCharacterRequest,
} from "./caracatoa-character-protocol.mjs";
import {
  CARACATOA_ATTRIBUTE_SYNC_STATUS,
  buildCaracatoaAttributeSyncBody,
  parseCaracatoaAttributeAllocationRequest,
} from "./caracatoa-attributes.mjs";
import {
  CARACATOA_SKILL_EFFECT_STATUS,
  CARACATOA_SKILL_EFFECT_TYPE,
  buildCaracatoaSkillEffectResultBody,
  CARACATOA_SKILL_SYNC_STATUS,
  buildCaracatoaSkillStateBody,
  parseCaracatoaSkillLearnRequest,
} from "./caracatoa-skills.mjs";
import {
  PlayerCharacterAccountError,
  PlayerCharacterInputError,
  PlayerCharacterLimitError,
  PlayerCharacterNameConflictError,
  PlayerCharacterSlotConflictError,
} from "./player-account-store.mjs";
import {
  buildCaracatoaCharacterCreateResultBody,
  buildWyd727CharacterListUpdateBody,
  buildWyd727LoginDeniedBody,
  buildWyd727LoginSuccessfulBody,
  buildWyd727TokenResultBody,
} from "./wyd-727-session-responses.mjs";
import { parseWyd727CharacterEntryRequest } from "./wyd-727-character-entry.mjs";
import { buildWyd727CharacterToWorldBody } from "./wyd-727-world-entry.mjs";
import {
  DEFAULT_WYD727_CLASS_CATALOG,
  getWyd727ClassEntry,
} from "./wyd-727-class-catalog.mjs";
import {
  buildWyd727MoveResponseBody,
  parseWyd727KeepAliveRequest,
  parseWyd727MoveRequest,
} from "./wyd-727-world-commands.mjs";
import {
  CARACATOA_BASIC_ATTACK_COOLDOWN_MS,
  buildWyd727BasicAttackResultBody,
  buildWyd727MonsterDeathBody,
  buildWyd727MonsterRespawnStateBody,
  buildWyd727PlayerHpMpSyncBody,
  computeCaracatoaBasicAttackDamage,
  computeCaracatoaMonsterCounterattackDamage,
  computeCaracatoaMonsterExperienceReward,
  isCaracatoaSkillTargetInRange,
  isWyd727BasicAttackInRange,
  parseWyd727BasicAttackRequest,
  parseWyd727SingleTargetSkillAttackRequest,
  readWyd727MonsterCombatState,
} from "./wyd-727-monster-combat.mjs";
import { findWyd727MonsterStep } from "./wyd-727-monster-ai.mjs";
import { getWyd727EquipmentCombatBonuses } from "./wyd-727-item-catalog.mjs";
import { computeCaracatoaSkillManaCost } from "./caracatoa-mana.mjs";
import { computeCaracatoaSkillCooldownMs } from "./caracatoa-cooldowns.mjs";
import { computeCaracatoaRewardWithEquipmentBonus } from "./caracatoa-rewards.mjs";
import {
  getWyd727LearnedSkillMask,
  getWyd727SkillsForClass,
} from "./wyd-727-skill-catalog.mjs";
import { DEFAULT_MONSTER_RESPAWN_MS } from "./wyd-727-monster-state-store.mjs";
import {
  buildWyd727InventorySlotDeltaBody,
  parseWyd727ItemUseRequest,
} from "./wyd-727-item-use.mjs";
import {
  buildCaracatoaItemizationDetailBody,
  CARACATOA_ITEMIZATION_DETAIL_STATUS,
} from "./caracatoa-itemization-protocol.mjs";
import {
  CARACATOA_EQUIPMENT_SLOTS,
  CARACATOA_EQUIPMENT_SYNC_STATUS,
  buildCaracatoaEquipmentSyncBody,
  parseCaracatoaEquipmentRequest,
} from "./wyd-727-item-equipment.mjs";
import { WYD727_DIRECTION_DELTAS } from "./wyd-727-walkability.mjs";
import {
  calculateCaracatoaMountBonuses,
  getCaracatoaMountCatalog,
} from "./caracatoa-mount-store.mjs";
import {
  buildCaracatoaMountStateBody,
  CARACATOA_MOUNT_ACTION,
  CARACATOA_MOUNT_REASON,
  CARACATOA_MOUNT_STATUS,
  parseCaracatoaMountRequestBody,
} from "./caracatoa-mount-protocol.mjs";
import {
  buildCaracatoaTradeStateBody,
  CARACATOA_TRADE_MAX_GOLD,
  CARACATOA_TRADE_REQUEST_OPCODE,
  parseCaracatoaTradeRequestBody,
} from "./caracatoa-trade-protocol.mjs";
import {
  buildCaracatoaPlayerShopStateBody,
  CARACATOA_PLAYER_SHOP_REQUEST_OPCODE,
  parseCaracatoaPlayerShopRequestBody,
} from "./caracatoa-player-shop-protocol.mjs";
import {
  buildCaracatoaRefinementResultBody,
  buildCaracatoaStageStateBody,
  CARACATOA_REFINEMENT_REASON,
  CARACATOA_REFINEMENT_STATUS,
  CARACATOA_STAGE_REASON,
  CARACATOA_STAGE_STATUS,
  parseCaracatoaRefinementRequest,
  parseCaracatoaStageRequest,
} from "./caracatoa-advancement-protocol.mjs";
import {
  buildCaracatoaProgressionSyncBody,
  CARACATOA_DAMAGE_PER_LEVEL,
  CARACATOA_HP_PER_LEVEL,
  CARACATOA_MP_PER_LEVEL,
  getCaracatoaStatsWithAttributes,
} from "./caracatoa-character-progression.mjs";
const DEFAULT_MAX_CONNECTIONS = 16;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_AUTH_FAILURES = 5;
const DEFAULT_AUTH_WINDOW_MS = 60_000;
const CARACATOA_START_MOVEMENT_SPEED = 3;
const MONSTER_RESPAWN_STORAGE_RETRY_MS = 1000;
const DEFAULT_MONSTER_AI_INTERVAL_MS = 1000;
const DEFAULT_MONSTER_ATTACK_INTERVAL_MS = 1000;
const DEFAULT_MOUNT_TICK_INTERVAL_MS = 60_000;
const CARACATOA_TRADE_RANGE = 5;
const CARACATOA_TRADE_LIFETIME_MS = 60_000;
const MAX_MONSTER_TARGET_CANDIDATES = 4;
const MOUNT_CATALOG = getCaracatoaMountCatalog();
const MOUNT_SPECIES = new Map(MOUNT_CATALOG.entries.map((entry) => [entry.id, entry]));

function randomClientId() {
  const bytes = randomBytes(2);
  const value = bytes.readUInt16LE(0) || 1;
  bytes.fill(0);
  return value;
}

function randomHashKeyTable() {
  const table = randomBytes(16);
  if (table[0] === 0) {
    const firstByte = randomBytes(1);
    table[0] = firstByte[0] || 1;
    firstByte.fill(0);
  }
  return table;
}

function randomResponseSequence() {
  const value = randomBytes(1)[0];
  return value || 1;
}

function moderationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Create a local WYD TCP listener. Without an account store it remains passive;
 * with authentication enabled it handles login, token, the private Caracatoa
 * create-character extension, and a minimal persisted-character world bootstrap.
 */
export function createLocalGameListener({
  onEvent = () => {},
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  accountStore = null,
  characterStore = accountStore,
  authEnabled = Boolean(accountStore),
  maxAuthFailures = DEFAULT_AUTH_FAILURES,
  authWindowMs = DEFAULT_AUTH_WINDOW_MS,
  randomSequence = randomResponseSequence,
  worldStartPosition = { x: 0, y: 0 },
  walkability = null,
  isPlayablePosition = null,
  getClassDefinition = null,
  getCharacterSkills = null,
  getCharacterInventory = null,
  getCharacterEquipment = null,
  changeCharacterEquipment = null,
  refineCharacterItem = null,
  consumeCharacterInventoryItem = null,
  awardMonsterLoot = null,
  getWorldMonsterBodies = null,
  now = Date.now,
  worldMonsterStore = null,
  monsterRespawnMs = DEFAULT_MONSTER_RESPAWN_MS,
  monsterAiIntervalMs = DEFAULT_MONSTER_AI_INTERVAL_MS,
  monsterAttackIntervalMs = DEFAULT_MONSTER_ATTACK_INTERVAL_MS,
  mountTickIntervalMs = DEFAULT_MOUNT_TICK_INTERVAL_MS,
} = {}) {
  if (
    !Number.isInteger(maxConnections) ||
    maxConnections < 1 ||
    maxConnections > 256
  ) {
    throw new RangeError("maxConnections deve ficar entre 1 e 256.");
  }
  if (
    !Number.isInteger(idleTimeoutMs) ||
    idleTimeoutMs < 0 ||
    idleTimeoutMs > 3_600_000
  ) {
    throw new RangeError("idleTimeoutMs deve ficar entre 0 e 3600000.");
  }
  if (
    authEnabled &&
    (!accountStore ||
      typeof accountStore.authenticate !== "function" ||
      typeof accountStore.authenticateToken !== "function")
  ) {
    throw new TypeError(
      "autenticação de jogo exige um store de contas com senha e token.",
    );
  }
  if (typeof randomSequence !== "function")
    throw new TypeError("randomSequence precisa ser uma função.");
  if (typeof now !== "function")
    throw new TypeError("now precisa ser uma função.");
  if (isPlayablePosition !== null && typeof isPlayablePosition !== "function") {
    throw new TypeError("isPlayablePosition precisa ser uma função ou null.");
  }
  if (
    worldMonsterStore !== null &&
    (typeof worldMonsterStore?.initialize !== "function" ||
      typeof worldMonsterStore?.applyDamage !== "function" ||
      typeof worldMonsterStore?.respawn !== "function" ||
      typeof worldMonsterStore?.applyModeration !== "function")
  ) {
    throw new TypeError(
      "worldMonsterStore precisa fornecer initialize, applyDamage, applyModeration e respawn.",
    );
  }
  if (
    !Number.isInteger(monsterRespawnMs) ||
    monsterRespawnMs < 1000 ||
    monsterRespawnMs > 86_400_000
  ) {
    throw new RangeError(
      "monsterRespawnMs precisa ficar entre 1000 e 86400000.",
    );
  }
  if (
    !Number.isInteger(monsterAiIntervalMs) ||
    monsterAiIntervalMs < 10 ||
    monsterAiIntervalMs > 60_000
  ) {
    throw new RangeError("monsterAiIntervalMs precisa ficar entre 10 e 60000.");
  }
  if (
    !Number.isInteger(monsterAttackIntervalMs) ||
    monsterAttackIntervalMs < 10 ||
    monsterAttackIntervalMs > 60_000
  ) {
    throw new RangeError(
      "monsterAttackIntervalMs precisa ficar entre 10 e 60000.",
    );
  }
  if (
    !Number.isInteger(mountTickIntervalMs) ||
    mountTickIntervalMs < 1000 ||
    mountTickIntervalMs > 60_000
  ) {
    throw new RangeError("mountTickIntervalMs precisa ficar entre 1000 e 60000.");
  }
  if (getClassDefinition !== null && typeof getClassDefinition !== "function") {
    throw new TypeError("getClassDefinition precisa ser uma função ou null.");
  }
  if (getCharacterSkills !== null && typeof getCharacterSkills !== "function") {
    throw new TypeError("getCharacterSkills precisa ser uma função ou null.");
  }
  if (
    getCharacterInventory !== null &&
    typeof getCharacterInventory !== "function"
  ) {
    throw new TypeError(
      "getCharacterInventory precisa ser uma função ou null.",
    );
  }
  if (
    getCharacterEquipment !== null &&
    typeof getCharacterEquipment !== "function"
  ) {
    throw new TypeError("getCharacterEquipment precisa ser uma função ou null.");
  }
  if (
    changeCharacterEquipment !== null &&
    typeof changeCharacterEquipment !== "function"
  ) {
    throw new TypeError("changeCharacterEquipment precisa ser uma função ou null.");
  }
  if (refineCharacterItem !== null && typeof refineCharacterItem !== "function") {
    throw new TypeError("refineCharacterItem precisa ser uma função ou null.");
  }
  if (
    consumeCharacterInventoryItem !== null &&
    typeof consumeCharacterInventoryItem !== "function"
  ) {
    throw new TypeError(
      "consumeCharacterInventoryItem precisa ser uma função ou null.",
    );
  }
  if (awardMonsterLoot !== null && typeof awardMonsterLoot !== "function") {
    throw new TypeError("awardMonsterLoot precisa ser uma função ou null.");
  }
  if (
    getWorldMonsterBodies !== null &&
    typeof getWorldMonsterBodies !== "function"
  ) {
    throw new TypeError(
      "getWorldMonsterBodies precisa ser uma função ou null.",
    );
  }
  if (
    !worldStartPosition ||
    !Number.isInteger(worldStartPosition.x) ||
    worldStartPosition.x < -0x8000 ||
    worldStartPosition.x > 0x7fff ||
    !Number.isInteger(worldStartPosition.y) ||
    worldStartPosition.y < -0x8000 ||
    worldStartPosition.y > 0x7fff
  ) {
    throw new RangeError(
      "worldStartPosition precisa conter coordenadas Int16 assinadas.",
    );
  }
  if (
    walkability !== null &&
    (typeof walkability?.isWalkablePosition !== "function" ||
      typeof walkability?.canStep !== "function")
  ) {
    throw new TypeError(
      "walkability precisa fornecer isWalkablePosition e canStep.",
    );
  }

  const clients = new Set();
  const sessionsBySocket = new Map();
  let shutdownPromise = null;
  const worldSessions = new Set();
  const activeTrades = new Map();
  const tradeBySession = new WeakMap();
  const authenticatedSessions = new Set();
  const sessionSockets = new WeakMap();
  const sharedWorldMonsters = new Map();
  const monsterAttackCooldowns = new WeakMap();
  let monsterRespawnTimer = null;
  let monsterRespawnRetryPending = false;
  let monsterRespawnTimerClosed = false;
  let scheduleNextMonsterRespawn = () => {};
  let monsterAiTimer = null;
  let monsterAiTimerClosed = false;
  let scheduleNextMonsterAi = () => {};
  let mountTickTimer = null;
  let mountTickTimerClosed = false;
  let scheduleNextMountTick = () => {};
  const publish = (event) => onEvent(Object.freeze(event));
  const tradeOfferFor = (trade, session) =>
    trade.first === session ? trade.firstOffer : trade.secondOffer;
  const tradePartnerFor = (trade, session) =>
    trade.first === session ? trade.second : trade.first;
  const tradeOfferWire = (offer) => ({
    inventorySlot: offer.inventorySlot,
    itemClientId: offer.itemClientId,
    gold: offer.gold,
    ready: offer.ready,
  });
  const tradeViewFor = (trade, session) => {
    const selfIsFirst = trade.first === session;
    const partner = tradePartnerFor(trade, session);
    return {
      tradeId: trade.id,
      state: trade.state,
      revision: trade.revision,
      incoming: trade.state === "invited" && !selfIsFirst,
      remainingMs: Math.max(0, Math.min(
        CARACATOA_TRADE_LIFETIME_MS,
        trade.expiresAtMs - Math.max(0, now()),
      )),
      selfName: session.worldCharacterName,
      partnerName: partner.worldCharacterName,
      selfOffer: tradeOfferWire(tradeOfferFor(trade, session)),
      partnerOffer: tradeOfferWire(tradeOfferFor(trade, partner)),
    };
  };
  const sendTradeState = (session, status, message, trade = null, goldBalance = null) => {
    if (!session || session.phase === "closed" || typeof session.sendBody !== "function") return false;
    try {
      return session.sendBody(buildCaracatoaTradeStateBody({
        clientId: session.clientId,
        timestamp: Date.now() >>> 0,
        status,
        message,
        trade: trade ? tradeViewFor(trade, session) : null,
        goldBalance,
      }));
    } catch {
      publish({ type: "world-trade-response-failed" });
      return false;
    }
  };
  const notifyTrade = (trade, status, message) => {
    sendTradeState(trade.first, status, message, trade);
    sendTradeState(trade.second, status, message, trade);
  };
  const clearTrade = (trade, status, message) => {
    if (trade.timer) clearTimeout(trade.timer);
    activeTrades.delete(trade.id);
    tradeBySession.delete(trade.first);
    tradeBySession.delete(trade.second);
    trade.state = status;
    trade.committing = false;
    notifyTrade(trade, status, message);
  };
  const tradeIsWithinRange = (trade) => {
    const { first, second } = trade;
    return sessionIsUsableForTrade(first) && sessionIsUsableForTrade(second) &&
      first.worldMapId === second.worldMapId && first.worldPosition && second.worldPosition &&
      Math.max(
        Math.abs(first.worldPosition.x - second.worldPosition.x),
        Math.abs(first.worldPosition.y - second.worldPosition.y),
      ) <= CARACATOA_TRADE_RANGE;
  };
  const cancelTradeIfOutOfRange = (session) => {
    const trade = tradeBySession.get(session);
    if (!trade || activeTrades.get(trade.id) !== trade || tradeIsWithinRange(trade)) return false;
    clearTrade(trade, "cancelled", "A negociação foi encerrada porque as personagens se afastaram.");
    publish({ type: "world-trade-range-ended" });
    return true;
  };
  const armTradeExpiry = (trade) => {
    if (trade.timer) clearTimeout(trade.timer);
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      clearTrade(trade, "cancelled", "A negociação expirou.");
      return;
    }
    trade.expiresAtMs = currentTime + CARACATOA_TRADE_LIFETIME_MS;
    trade.timer = setTimeout(() => {
      if (activeTrades.get(trade.id) === trade) {
        clearTrade(trade, "cancelled", "O tempo para concluir a negociação terminou.");
        publish({ type: "world-trade-expired" });
      }
    }, CARACATOA_TRADE_LIFETIME_MS);
    trade.timer.unref?.();
  };
  const rejectTrade = (session, message, trade = null) => {
    publish({ type: "world-trade-request-rejected" });
    return sendTradeState(session, "rejected", message, trade);
  };
  const sendPlayerShopState = (session, {
    status = "ok", message = "", reason = null, view = "market",
    goldBalance = null, listings = [], receipt = null,
  } = {}) => {
    if (!session || session.phase !== "in-world" || typeof session.sendBody !== "function") return false;
    try {
      return session.sendBody(buildCaracatoaPlayerShopStateBody({
        clientId: session.clientId,
        timestamp: Date.now() >>> 0,
        status, message, reason, view, goldBalance, listings, receipt,
      }));
    } catch {
      publish({ type: "world-player-shop-response-failed" });
      return false;
    }
  };
  const playerShopReasonText = (reason) => ({
    "character-unavailable": "Personagem indisponível.",
    "inventory-not-ready": "O inventário ainda não está pronto.",
    "seller-inventory-not-ready": "O inventário do vendedor ainda não está pronto.",
    "item-missing": "O item anunciado mudou ou não está mais disponível.",
    "item-unlisted": "Esse item não faz parte do catálogo negociável.",
    "item-equipped": "Retire o equipamento antes de anunciá-lo.",
    "item-already-listed": "Esse item já está anunciado.",
    "invalid-item-stack": "A pilha desse item não pode ser anunciada.",
    "listing-limit": "Você já tem quatro anúncios ativos.",
    "listing-not-active": "O anúncio não está ativo ou não pertence a você.",
    "listing-not-found": "Anúncio não encontrado.",
    "listing-expired": "O prazo do anúncio terminou; o item foi devolvido.",
    "listing-closed": "Esse anúncio já foi encerrado.",
    "own-listing": "Não é possível comprar seu próprio anúncio.",
    "seller-unavailable": "O vendedor está indisponível.",
    "insufficient-gold": "Gold insuficiente para essa compra.",
    "seller-gold-limit": "O saldo do vendedor chegou ao limite permitido.",
    "inventory-full": "Não há espaço no seu inventário.",
    "request-id-reused": "Identificador de compra já usado em outra operação.",
  })[reason] ?? "O mercado não concluiu essa ação.";
  const tradeReasonText = (reason) => ({
    "empty-offer": "Ao menos uma oferta precisa conter item ou gold.",
    "character-unavailable": "Uma das personagens não está mais disponível.",
    "inventory-not-ready": "Um dos inventários ainda não foi inicializado.",
    "item-missing": "O item ofertado mudou ou não está mais no inventário.",
    "item-equipped": "Itens equipados não podem ser negociados.",
    "invalid-item-stack": "A pilha ofertada não pode ser transferida.",
    "insufficient-gold": "O saldo mudou e não cobre a oferta de gold.",
    "inventory-full": "A outra personagem não tem espaço no inventário.",
    "gold-limit": "O saldo resultante ultrapassaria o limite permitido.",
  })[reason] ?? "A troca foi recusada. Revise as ofertas e tente novamente.";
  const refreshCharacterInventory = async (session) => {
    if (!sessionIsUsableForTrade(session) || !getCharacterInventory) return false;
    const inventory = await getCharacterInventory(session.accountId, session.characterSlot);
    if (!Array.isArray(inventory) || inventory.length > 60) throw new Error("Inventário inválido após a troca.");
    const itemsBySlot = new Map(inventory.map((item) => [item.slot, item]));
    for (let slot = 0; slot < 60; slot += 1) {
      const item = itemsBySlot.get(slot);
      session.sendBody(buildWyd727InventorySlotDeltaBody({
        clientId: session.clientId,
        slot,
        item: item ?? null,
      }));
      session.sendBody(buildCaracatoaItemizationDetailBody({
        clientId: session.clientId,
        status: CARACATOA_ITEMIZATION_DETAIL_STATUS.removed,
        slot,
      }));
    }
    if (typeof characterStore?.getCharacterItemizationDetails === "function") {
      for (const detail of characterStore.getCharacterItemizationDetails(session.accountId, session.characterSlot)) {
        session.sendBody(buildCaracatoaItemizationDetailBody({
          clientId: session.clientId,
          status: CARACATOA_ITEMIZATION_DETAIL_STATUS.snapshot,
          slot: detail.slot,
          itemization: detail,
        }));
      }
    }
    return true;
  };
  function sessionIsUsableForTrade(session) {
    const socket = sessionSockets.get(session);
    return session.phase === "in-world" && socket && !socket.destroyed && !socket.writableEnded;
  }
  const completeTrade = (trade) => {
    if (activeTrades.get(trade.id) !== trade || trade.committing ||
        !trade.firstOffer.ready || !trade.secondOffer.ready) return;
    trade.committing = true;
    const committedAt = now();
    if (!Number.isSafeInteger(committedAt) || committedAt < 0 ||
        typeof characterStore?.executeCharacterTrade !== "function") {
      trade.committing = false;
      trade.firstOffer.ready = false;
      trade.secondOffer.ready = false;
      rejectTrade(trade.first, "O serviço de troca está indisponível.", trade);
      rejectTrade(trade.second, "O serviço de troca está indisponível.", trade);
      return;
    }
    let result;
    try {
      result = characterStore.executeCharacterTrade({
        tradeId: trade.id,
        now: committedAt,
        first: {
          accountId: trade.first.accountId,
          characterSlot: trade.first.characterSlot,
          inventorySlot: trade.firstOffer.inventorySlot,
          gold: trade.firstOffer.gold,
        },
        second: {
          accountId: trade.second.accountId,
          characterSlot: trade.second.characterSlot,
          inventorySlot: trade.secondOffer.inventorySlot,
          gold: trade.secondOffer.gold,
        },
      });
    } catch {
      trade.committing = false;
      trade.firstOffer.ready = false;
      trade.secondOffer.ready = false;
      rejectTrade(trade.first, "A gravação atômica falhou; confira as ofertas antes de confirmar novamente.", trade);
      rejectTrade(trade.second, "A gravação atômica falhou; confira as ofertas antes de confirmar novamente.", trade);
      publish({ type: "world-trade-storage-failed" });
      return;
    }
    if (!result?.accepted) {
      trade.committing = false;
      trade.firstOffer.ready = false;
      trade.secondOffer.ready = false;
      const message = tradeReasonText(result?.reason);
      rejectTrade(trade.first, message, trade);
      rejectTrade(trade.second, message, trade);
      publish({ type: "world-trade-rejected", reason: result?.reason ?? "storage-rejected" });
      return;
    }

    if (trade.timer) clearTimeout(trade.timer);
    trade.timer = null;
    activeTrades.delete(trade.id);
    tradeBySession.delete(trade.first);
    tradeBySession.delete(trade.second);
    trade.state = "committed";
    const balanceFor = (session, participantIndex) => {
      const participant = result.participants?.find((entry) =>
        entry.accountId === session.accountId && entry.characterSlot === session.characterSlot,
      ) ?? result.participants?.[participantIndex];
      if (Number.isSafeInteger(participant?.gold)) return participant.gold;
      return characterStore.getCharacterBySlot?.(session.accountId, session.characterSlot)?.gold ?? null;
    };
    sendTradeState(trade.first, "committed", "Troca concluída e salva pelo servidor.", trade, balanceFor(trade.first, 0));
    sendTradeState(trade.second, "committed", "Troca concluída e salva pelo servidor.", trade, balanceFor(trade.second, 1));
    publish({ type: "world-trade-committed" });
    for (const participant of [trade.first, trade.second]) {
      refreshCharacterInventory(participant).catch(() => {
        publish({ type: "world-trade-inventory-refresh-failed" });
      });
    }
  };
  const monsterKey = (monster) =>
    `${monster.clientEntityId}:${(monster.spawnPosition ?? monster.position).x}:${(monster.spawnPosition ?? monster.position).y}`;
  const registerWorldMonster = (monster, body, nowValue) => {
    const key = monsterKey(monster);
    const persisted = worldMonsterStore?.initialize(monster, nowValue) ?? null;
    let runtime = sharedWorldMonsters.get(key);
    let respawned = persisted?.respawned === true;
    if (!runtime) {
      runtime = {
        ...monster,
        ...(persisted ?? {}),
        spawnPosition: { ...monster.position },
        key,
        spawnBody: Buffer.from(body),
      };
      if (!persisted) runtime.respawnAt = 0;
    } else {
      runtime.spawnPosition ??= { ...monster.position };
      runtime.level = monster.level;
      runtime.defense = persisted?.defense ?? monster.defense;
      runtime.damage = monster.damage;
      runtime.movementSpeed = monster.movementSpeed;
      runtime.maxHp = persisted?.maxHp ?? monster.maxHp;
      runtime.currentHp =
        persisted?.currentHp ?? Math.min(runtime.currentHp, monster.maxHp);
      runtime.respawnAt = persisted?.respawnAt ?? runtime.respawnAt ?? 0;
      if (
        !worldMonsterStore &&
        runtime.currentHp === 0 &&
        runtime.respawnAt > 0 &&
        runtime.respawnAt <= nowValue
      ) {
        runtime.currentHp = runtime.maxHp;
        runtime.respawnAt = 0;
        runtime.position = { ...runtime.spawnPosition };
        respawned = true;
      }
      runtime.spawnBody.fill(0);
      runtime.spawnBody = Buffer.from(body);
    }
    sharedWorldMonsters.set(key, runtime);
    scheduleNextMonsterRespawn();
    return { runtime, respawned };
  };
  const buildMonsterSpawnBody = (monster, recipientClientId, timestamp) => {
    const body = Buffer.from(monster.spawnBody);
    body.writeUInt16LE(recipientClientId, 2);
    body.writeUInt32LE(timestamp >>> 0, 4);
    body.writeInt16LE(monster.position.x, 8);
    body.writeInt16LE(monster.position.y, 10);
    body.writeInt32LE(monster.currentHp, 160);
    return body;
  };
  const sessionsSeeingMonster = (monster) =>
    [...worldSessions].filter(
      (candidate) =>
        candidate.phase === "in-world" &&
        candidate.worldMonsters.includes(monster),
    );
  const sessionsForCharacter = (accountId, characterSlot) =>
    [...worldSessions].filter(
      (candidate) =>
        candidate.phase === "in-world" &&
        candidate.accountId === accountId &&
        candidate.characterSlot === characterSlot,
    );
  const applyMountBonusesToSession = (session, bonuses = null) => {
    session.worldMountBonuses = {
      hp: bonuses?.hp ?? 0,
      physicalAttack: bonuses?.physicalAttack ?? 0,
      magicAttack: bonuses?.magicAttack ?? 0,
      defense: bonuses?.defense ?? 0,
      moveSpeedBps: bonuses?.moveSpeedBps ?? 0,
      absorptionBps: bonuses?.absorptionBps ?? 0,
    };
    const mount = session.worldMountBonuses;
    session.worldDamageAbsorptionBps = combineCaracatoaDamageAbsorptionBps(
      session.worldEquipmentAbsorptionBps ?? 0,
      mount.absorptionBps,
    );
    session.worldMaxHp = Math.min(
      0x7fffffff,
      session.worldBaseMaxHp + session.worldEquipmentMaxHpBonus + mount.hp,
    );
    session.worldMaxMp = Math.min(
      0x7fffffff,
      session.worldBaseMaxMp + session.worldEquipmentMaxMpBonus,
    );
    const oldHp = session.worldCurrentHp;
    const oldMp = session.worldCurrentMp;
    session.worldCurrentHp = Math.min(oldHp, session.worldMaxHp);
    session.worldCurrentMp = Math.min(oldMp, session.worldMaxMp);
    if (
      (session.worldCurrentHp !== oldHp || session.worldCurrentMp !== oldMp) &&
      typeof characterStore?.setCharacterResources === "function" &&
      !characterStore.setCharacterResources(
        session.accountId,
        session.characterSlot,
        session.worldCurrentHp,
        session.worldCurrentMp,
      )
    ) {
      throw new Error("Não foi possível salvar os recursos após alterar a montaria.");
    }
    session.worldAttackDamage = Math.min(
      0x7fffffff,
      session.worldBaseDamage + session.worldEquipmentAttackDamageBonus + mount.physicalAttack,
    );
    session.worldPlayerDefense = Math.min(
      0x7fffffff,
      session.worldBaseDefense + session.worldEquipmentDefenseBonus + mount.defense,
    );
    session.worldSpeed = Math.max(
      1,
      Math.floor(session.worldBaseMovementSpeed * (10_000 + mount.moveSpeedBps) / 10_000),
    );
  };
  const applyDamageAbsorption = (session, incomingDamage) => {
    return computeCaracatoaDamageAfterAbsorption(
      incomingDamage,
      session.worldDamageAbsorptionBps ?? 0,
    );
  };
  const buildMountSnapshotEntries = (mounts) => mounts.map((mount) => {
    const species = MOUNT_SPECIES.get(mount.speciesId);
    if (!species) throw new Error("Espécie de montaria ausente do catálogo.");
    return {
      mount,
      species,
      bonuses: calculateCaracatoaMountBonuses(mount),
    };
  });
  const sendMountSnapshot = (recipient, mounts, {
    status = CARACATOA_MOUNT_STATUS.snapshot,
    action = CARACATOA_MOUNT_ACTION.list,
    reason = CARACATOA_MOUNT_REASON.none,
    nowMs,
  } = {}) => {
    recipient.sendBody(buildCaracatoaMountStateBody({
      clientId: recipient.clientId,
      timestamp: Date.now() >>> 0,
      status,
      action,
      reason,
      mounts: buildMountSnapshotEntries(mounts),
      nowMs,
    }));
  };
  const sendMountSnapshotToCharacter = (accountId, characterSlot, mounts, options) => {
    for (const recipient of sessionsForCharacter(accountId, characterSlot)) {
      try {
        sendMountSnapshot(recipient, mounts, options);
      } catch {
        publish({ type: "world-mount-sync-failed" });
        sessionSockets.get(recipient)?.destroy();
      }
    }
  };
  const sendStageSnapshot = (recipient, state, {
    status = CARACATOA_STAGE_STATUS.snapshot,
    reason = CARACATOA_STAGE_REASON.none,
  } = {}) => {
    if (!state) return;
    recipient.sendBody(buildCaracatoaStageStateBody({
      clientId: recipient.clientId,
      timestamp: Date.now() >>> 0,
      status,
      reason,
      state,
    }));
  };
  const closeCharacterSessions = (sessions) => {
    for (const recipient of sessions) {
      recipient.phase = "closed";
      sessionSockets.get(recipient)?.end();
    }
  };
  const characterSkillCooldowns = new Map();
  const characterDefenseBuffs = new Map();
  const skillCooldownKey = (accountId, characterSlot) =>
    `${accountId}\u0000${characterSlot}`;
  const getCharacterSkillCooldowns = (accountId, characterSlot) => {
    const key = skillCooldownKey(accountId, characterSlot);
    let cooldowns = characterSkillCooldowns.get(key);
    if (!cooldowns) {
      cooldowns = new Map();
      characterSkillCooldowns.set(key, cooldowns);
    }
    return cooldowns;
  };
  const getCharacterDefenseBonus = (accountId, characterSlot, currentTime) => {
    const key = skillCooldownKey(accountId, characterSlot);
    const buff = characterDefenseBuffs.get(key);
    if (!buff) return 0;
    if (currentTime >= buff.expiresAt) {
      clearTimeout(buff.expirationTimer);
      characterDefenseBuffs.delete(key);
      return 0;
    }
    return buff.amount;
  };
  const getEffectiveWorldDefense = (session, currentTime) =>
    Math.min(
      0x7fffffff,
      session.worldPlayerDefense +
        getCharacterDefenseBonus(session.accountId, session.characterSlot, currentTime),
    );
  const broadcastMonsterRespawn = (
    monster,
    timestamp,
    excludedSession = null,
  ) => {
    for (const recipient of sessionsSeeingMonster(monster)) {
      if (recipient === excludedSession) continue;
      recipient.sendBody(
        buildMonsterSpawnBody(monster, recipient.clientId, timestamp),
      );
      recipient.sendBody(
        buildWyd727MonsterRespawnStateBody({
          entityId: monster.clientEntityId,
          timestamp,
        }),
      );
    }
  };
  const refreshDueMonsterRespawns = () => {
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new Error("Relógio inválido ao verificar respawn de monstros.");
    }
    for (const monster of sharedWorldMonsters.values()) {
      if (
        monster.currentHp > 0 ||
        monster.respawnAt === 0 ||
        monster.respawnAt > currentTime
      ) {
        continue;
      }
      const respawned = worldMonsterStore
        ? worldMonsterStore.respawn(monster, currentTime)
        : {
            ...monster,
            position: { ...(monster.spawnPosition ?? monster.position) },
            currentHp: monster.maxHp,
            respawnAt: 0,
            respawned: true,
          };
      if (!respawned) continue;
      Object.assign(monster, respawned);
      monsterAttackCooldowns.delete(monster);
      publish({
        type: "world-monster-respawned",
        monsterEntityId: monster.clientEntityId,
        position: monster.position,
      });
      broadcastMonsterRespawn(monster, currentTime >>> 0);
    }
    monsterRespawnRetryPending = false;
    scheduleNextMonsterRespawn();
  };
  scheduleNextMonsterRespawn = () => {
    if (monsterRespawnTimer !== null) {
      clearTimeout(monsterRespawnTimer);
      monsterRespawnTimer = null;
    }
    if (monsterRespawnTimerClosed) return;

    let nextRespawnAt = Infinity;
    for (const monster of sharedWorldMonsters.values()) {
      if (
        monster.currentHp === 0 &&
        Number.isSafeInteger(monster.respawnAt) &&
        monster.respawnAt > 0
      ) {
        nextRespawnAt = Math.min(nextRespawnAt, monster.respawnAt);
      }
    }
    if (nextRespawnAt === Infinity) {
      monsterRespawnRetryPending = false;
      return;
    }

    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      publish({ type: "world-monster-state-storage-failed" });
      return;
    }
    const delay =
      nextRespawnAt <= currentTime
        ? MONSTER_RESPAWN_STORAGE_RETRY_MS
        : nextRespawnAt - currentTime;

    const runDueRespawns = () => {
      monsterRespawnTimer = null;
      if (monsterRespawnTimerClosed) return;
      try {
        refreshDueMonsterRespawns();
      } catch {
        if (!monsterRespawnRetryPending) {
          monsterRespawnRetryPending = true;
          publish({
            type: "world-monster-state-storage-failed",
            retryDelayMs: MONSTER_RESPAWN_STORAGE_RETRY_MS,
          });
        }
        monsterRespawnTimer = setTimeout(
          runDueRespawns,
          MONSTER_RESPAWN_STORAGE_RETRY_MS,
        );
        monsterRespawnTimer.unref?.();
      }
    };

    monsterRespawnTimer = setTimeout(runDueRespawns, delay);
    monsterRespawnTimer.unref?.();
  };
  const moveMonsterTowardPlayer = (monster) => {
    const visibleSessions = sessionsSeeingMonster(monster);
    if (
      !walkability ||
      monster.currentHp <= 0 ||
      visibleSessions.length === 0
    ) {
      return false;
    }
    const activePlayers = visibleSessions
      .filter(
        (candidate) =>
          candidate.phase === "in-world" &&
          candidate.worldPosition &&
          Math.max(
            Math.abs(candidate.worldPosition.x - monster.position.x),
            Math.abs(candidate.worldPosition.y - monster.position.y),
          ) <= 8,
      )
      .sort((left, right) => {
        const leftDistance = Math.max(
          Math.abs(left.worldPosition.x - monster.position.x),
          Math.abs(left.worldPosition.y - monster.position.y),
        );
        const rightDistance = Math.max(
          Math.abs(right.worldPosition.x - monster.position.x),
          Math.abs(right.worldPosition.y - monster.position.y),
        );
        return leftDistance - rightDistance || left.clientId - right.clientId;
      })
      .slice(0, MAX_MONSTER_TARGET_CANDIDATES);
    if (activePlayers.length === 0) return false;

    const occupiedPositions = [
      ...[...worldSessions]
        .filter(
          (candidate) =>
            candidate.phase === "in-world" && candidate.worldPosition,
        )
        .map((candidate) => candidate.worldPosition),
      ...[...sharedWorldMonsters.values()]
        .filter((candidate) => candidate !== monster && candidate.currentHp > 0)
        .map((candidate) => candidate.position),
    ];
    for (const target of activePlayers) {
      const movement = findWyd727MonsterStep({
        origin: monster.position,
        target: target.worldPosition,
        occupiedPositions,
        walkability,
      });
      if (!movement) continue;

      const from = { ...monster.position };
      monster.position = movement.destination;
      const timestamp = Date.now() >>> 0;
      for (const recipient of sessionsSeeingMonster(monster)) {
        try {
          recipient.sendBody(
            buildWyd727MoveResponseBody({
              clientId: monster.clientEntityId,
              timestamp,
              lastPosition: from,
              destiny: monster.position,
              moveType: 0,
              speedMove: monster.movementSpeed,
              directionCodes: [movement.directionCode],
            }),
          );
        } catch {
          publish({
            type: "world-monster-move-send-failed",
            monsterEntityId: monster.clientEntityId,
          });
        }
      }
      publish({
        type: "world-monster-moved",
        monsterEntityId: monster.clientEntityId,
        from,
        to: { ...monster.position },
        targetClientId: target.clientId,
        directionCode: movement.directionCode,
      });
      return true;
    }
    return false;
  };
  const attackAdjacentCharacter = (monster) => {
    if (monster.currentHp <= 0) return false;

    const candidates = sessionsSeeingMonster(monster)
      .filter(
        (candidate) =>
          candidate.worldPosition &&
          candidate.worldCurrentHp > 0 &&
          Number.isInteger(candidate.characterSlot) &&
          typeof candidate.accountId === "string" &&
          isWyd727BasicAttackInRange(monster.position, candidate.worldPosition),
      )
      .sort(
        (left, right) =>
          left.clientId - right.clientId ||
          left.accountId.localeCompare(right.accountId) ||
          left.characterSlot - right.characterSlot,
      );
    const seenCharacters = new Set();
    const target = candidates.find((candidate) => {
      const key = `${candidate.accountId}\u0000${candidate.characterSlot}`;
      if (seenCharacters.has(key)) return false;
      seenCharacters.add(key);
      return true;
    });
    if (!target) return false;

    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new Error("Relógio inválido ao atacar personagem.");
    }
    const lastAttackAt = monsterAttackCooldowns.get(monster);
    if (
      lastAttackAt !== undefined &&
      (currentTime < lastAttackAt ||
        currentTime - lastAttackAt < monsterAttackIntervalMs)
    ) {
      return false;
    }
    monsterAttackCooldowns.set(monster, currentTime);

    const effectiveDefense = getEffectiveWorldDefense(target, currentTime);
    const requestedDamage = applyDamageAbsorption(
      target,
      computeCaracatoaMonsterCounterattackDamage(monster.damage, effectiveDefense),
    );
    if (requestedDamage === 0) {
      publish({
        type: "world-monster-attack-blocked",
        monsterEntityId: monster.clientEntityId,
        clientId: target.clientId,
      });
      return true;
    }
    if (typeof characterStore?.applyCharacterDamage !== "function") {
      const characterSessions = sessionsForCharacter(
        target.accountId,
        target.characterSlot,
      );
      closeCharacterSessions(characterSessions);
      publish({ type: "world-player-health-unavailable" });
      return false;
    }

    let playerDamage;
    try {
      playerDamage = characterStore.applyCharacterDamage(
        target.accountId,
        target.characterSlot,
        requestedDamage,
      );
    } catch {
      const characterSessions = sessionsForCharacter(
        target.accountId,
        target.characterSlot,
      );
      closeCharacterSessions(characterSessions);
      publish({ type: "world-player-health-storage-failed" });
      return false;
    }
    const characterSessions = sessionsForCharacter(
      target.accountId,
      target.characterSlot,
    );
    if (!playerDamage) {
      closeCharacterSessions(characterSessions);
      publish({ type: "world-player-health-unavailable" });
      return false;
    }

    for (const recipient of characterSessions) {
      recipient.worldCurrentHp = playerDamage.currentHp;
      let hpSyncSent = false;
      let hpSyncFailed = false;
      try {
        hpSyncSent = recipient.sendBody(
          buildWyd727PlayerHpMpSyncBody({
            clientId: recipient.clientId,
            timestamp: currentTime >>> 0,
            currentHp: playerDamage.currentHp,
            currentMp: recipient.worldCurrentMp,
          }),
        );
        if (playerDamage.currentHp === 0 && hpSyncSent) {
          const deathSent = recipient.sendBody(
            buildWyd727MonsterDeathBody({
              clientId: recipient.clientId,
              timestamp: currentTime >>> 0,
              killed: recipient.clientId,
              killer: monster.clientEntityId,
            }),
          );
          if (!deathSent) hpSyncFailed = true;
        }
      } catch {
        hpSyncFailed = true;
      }
      if (hpSyncFailed || !hpSyncSent) {
        publish({
          type: "world-player-health-sync-failed",
          clientId: recipient.clientId,
          monsterEntityId: monster.clientEntityId,
        });
      }
    }

    const defeated = playerDamage.currentHp === 0;
    publish({
      type: defeated ? "world-player-defeated" : "world-player-damaged",
      source: "monster-ai",
      clientId: target.clientId,
      monsterEntityId: monster.clientEntityId,
      damage: playerDamage.damage,
      currentHp: playerDamage.currentHp,
      baseDefense: target.worldPlayerDefense,
      effectiveDefense,
    });
    if (defeated) closeCharacterSessions(characterSessions);
    return true;
  };
  const runMonsterAiTick = () => {
    monsterAiTimer = null;
    if (monsterAiTimerClosed || worldSessions.size === 0) return;
    for (const monster of sharedWorldMonsters.values()) {
      try {
        moveMonsterTowardPlayer(monster);
      } catch {
        publish({
          type: "world-monster-ai-failed",
          monsterEntityId: monster.clientEntityId,
        });
      }
      try {
        attackAdjacentCharacter(monster);
      } catch {
        publish({
          type: "world-monster-attack-failed",
          monsterEntityId: monster.clientEntityId,
        });
      }
    }
    scheduleNextMonsterAi();
  };
  scheduleNextMonsterAi = () => {
    if (monsterAiTimer !== null) {
      clearTimeout(monsterAiTimer);
      monsterAiTimer = null;
    }
    if (monsterAiTimerClosed || worldSessions.size === 0) {
      return;
    }
    monsterAiTimer = setTimeout(runMonsterAiTick, monsterAiIntervalMs);
    monsterAiTimer.unref?.();
  };
  const runMountTick = () => {
    mountTickTimer = null;
    if (mountTickTimerClosed || worldSessions.size === 0 ||
        typeof characterStore?.listCharacterMounts !== "function" ||
        typeof characterStore?.tickCharacterMountRide !== "function") return;
    const tickTime = now();
    if (!Number.isSafeInteger(tickTime) || tickTime < 0) {
      publish({ type: "world-mount-tick-failed", reason: "clock-failed" });
      scheduleNextMountTick();
      return;
    }
    const identities = new Map();
    for (const candidate of worldSessions) {
      if (candidate.phase !== "in-world" || candidate.characterSlot === null) continue;
      identities.set(`${candidate.accountId}\u0000${candidate.characterSlot}`, {
        accountId: candidate.accountId,
        characterSlot: candidate.characterSlot,
      });
    }
    for (const { accountId, characterSlot } of identities.values()) {
      try {
        const before = characterStore.listCharacterMounts(accountId, characterSlot);
        const riding = before.find((mount) => mount.riding);
        if (!riding) continue;
        const updated = characterStore.tickCharacterMountRide(accountId, {
          characterSlot,
          mountId: riding.id,
          nowMs: tickTime,
        });
        const bonuses = calculateCaracatoaMountBonuses(updated);
        for (const recipient of sessionsForCharacter(accountId, characterSlot)) {
          const oldHp = recipient.worldCurrentHp;
          const oldMp = recipient.worldCurrentMp;
          const oldBonuses = recipient.worldMountBonuses;
          applyMountBonusesToSession(recipient, bonuses);
          const mountStatsChanged = [
            "hp", "physicalAttack", "magicAttack", "defense", "moveSpeedBps", "absorptionBps",
          ].some((key) => oldBonuses?.[key] !== recipient.worldMountBonuses[key]);
          if (
            mountStatsChanged || oldHp !== recipient.worldCurrentHp ||
            oldMp !== recipient.worldCurrentMp
          ) {
            recipient.sendBody(buildCaracatoaAttributeSyncBody({
              clientId: recipient.clientId,
              timestamp: tickTime >>> 0,
              status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
              availablePoints: recipient.worldAvailableAttributePoints,
              stats: {
                str: recipient.worldStartingStats.str + recipient.worldAllocatedAttributes.str,
                int: recipient.worldStartingStats.int + recipient.worldAllocatedAttributes.int,
                dex: recipient.worldStartingStats.dex + recipient.worldAllocatedAttributes.dex,
                con: recipient.worldStartingStats.con + recipient.worldAllocatedAttributes.con,
                currentHp: recipient.worldCurrentHp,
                maxHp: recipient.worldMaxHp,
                currentMp: recipient.worldCurrentMp,
                maxMp: recipient.worldMaxMp,
                damage: recipient.worldAttackDamage,
                defense: recipient.worldPlayerDefense,
              },
            }));
          }
        }
        const mounts = characterStore.listCharacterMounts(accountId, characterSlot);
        sendMountSnapshotToCharacter(accountId, characterSlot, mounts, {
          status: CARACATOA_MOUNT_STATUS.snapshot,
          action: CARACATOA_MOUNT_ACTION.list,
          nowMs: tickTime,
        });
        publish({
          type: updated.stage === "dead" ? "world-mount-life-exhausted" : "world-mount-fed-state-ticked",
          characterSlot,
          speciesId: updated.speciesId,
          hunger: updated.hunger,
          vitality: updated.vitality,
          stage: updated.stage,
        });
      } catch {
        publish({ type: "world-mount-tick-failed", characterSlot });
      }
    }
    scheduleNextMountTick();
  };
  scheduleNextMountTick = () => {
    if (mountTickTimer !== null) {
      clearTimeout(mountTickTimer);
      mountTickTimer = null;
    }
    if (mountTickTimerClosed || worldSessions.size === 0) return;
    mountTickTimer = setTimeout(runMountTick, mountTickIntervalMs);
    mountTickTimer.unref?.();
  };
  const listWorldMonsters = () =>
    [...sharedWorldMonsters.values()]
      .map((monster) => ({
        clientEntityId: monster.clientEntityId,
        position: { x: monster.position.x, y: monster.position.y },
        currentHp: monster.currentHp,
        maxHp: monster.maxHp,
        respawnAt: monster.respawnAt ?? 0,
        activeSessions: sessionsSeeingMonster(monster).length,
      }))
      .sort(
        (left, right) =>
          left.clientEntityId - right.clientEntityId ||
          left.position.x - right.position.x ||
          left.position.y - right.position.y,
      );
  const moderateMonster = ({ clientEntityId, position, action } = {}) => {
    if (
      !Number.isInteger(clientEntityId) ||
      clientEntityId < 1000 ||
      clientEntityId > 0xffff ||
      !position ||
      !Number.isInteger(position.x) ||
      position.x < -0x8000 ||
      position.x > 0x7fff ||
      !Number.isInteger(position.y) ||
      position.y < -0x8000 ||
      position.y > 0x7fff ||
      !["kill", "revive"].includes(action)
    ) {
      throw moderationError(
        "invalid-input",
        "Alvo ou ação de moderação inválidos.",
      );
    }
    const target = [...sharedWorldMonsters.values()].find(
      (monster) =>
        monster.clientEntityId === clientEntityId &&
        monster.position.x === position.x &&
        monster.position.y === position.y,
    );
    if (!target) {
      throw moderationError(
        "monster-not-found",
        "Monstro não está carregado no mundo.",
      );
    }
    const recipients = sessionsSeeingMonster(target);
    if (recipients.length === 0) {
      throw moderationError(
        "monster-not-active",
        "Nenhuma sessão ativa está vendo este monstro.",
      );
    }
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw moderationError(
        "clock-error",
        "Relógio inválido ao moderar monstro.",
      );
    }
    let result;
    if (worldMonsterStore) {
      result = worldMonsterStore.applyModeration(
        target,
        action,
        currentTime,
        monsterRespawnMs,
      );
    } else {
      const before = {
        clientEntityId: target.clientEntityId,
        position: { ...target.position },
        maxHp: target.maxHp,
        currentHp: target.currentHp,
        defense: target.defense,
        respawnAt: target.respawnAt ?? 0,
        respawned: false,
      };
      if (action === "kill" && target.currentHp === 0) {
        throw moderationError("no-change", "O monstro já está morto.");
      }
      const currentHp = action === "kill" ? 0 : target.maxHp;
      const respawnAt = action === "kill" ? currentTime + monsterRespawnMs : 0;
      if (!Number.isSafeInteger(respawnAt)) {
        throw moderationError(
          "clock-error",
          "Prazo de respawn fora do intervalo seguro.",
        );
      }
      result = {
        before,
        after: { ...before, currentHp, respawnAt },
        changed:
          currentHp !== target.currentHp || respawnAt !== target.respawnAt,
      };
    }
    if (!result.changed) {
      throw moderationError(
        "no-change",
        action === "kill"
          ? "O monstro já está morto."
          : "O monstro já está com HP máximo.",
      );
    }
    Object.assign(target, result.after);
    scheduleNextMonsterRespawn();
    const timestamp = currentTime >>> 0;
    for (const recipient of recipients) {
      if (action === "kill") {
        recipient.sendBody(
          buildWyd727MonsterDeathBody({
            clientId: recipient.clientId,
            timestamp,
            killed: target.clientEntityId,
            killer: 0,
          }),
        );
      } else {
        recipient.sendBody(
          buildMonsterSpawnBody(target, recipient.clientId, timestamp),
        );
        recipient.sendBody(
          buildWyd727MonsterRespawnStateBody({
            entityId: target.clientEntityId,
            timestamp,
          }),
        );
      }
    }
    publish({
      type:
        action === "kill"
          ? "world-monster-moderator-killed"
          : "world-monster-moderator-revived",
      monsterEntityId: target.clientEntityId,
      position: target.position,
      currentHp: target.currentHp,
      maxHp: target.maxHp,
    });
    return {
      clientEntityId: target.clientEntityId,
      position: { x: target.position.x, y: target.position.y },
      currentHp: target.currentHp,
      maxHp: target.maxHp,
      respawnAt: target.respawnAt ?? 0,
      activeSessions: recipients.length,
    };
  };
  const listOnlinePlayers = () =>
    [...authenticatedSessions]
      .filter((session) => {
        const socket = sessionSockets.get(session);
        return (
          Boolean(session.accountId) &&
          session.phase !== "closed" &&
          socket &&
          !socket.destroyed &&
          !socket.writableEnded
        );
      })
      .map((session) => ({
        accountId: session.accountId,
        phase: session.phase,
        characterSlot: session.characterSlot,
        position: session.worldPosition
          ? { x: session.worldPosition.x, y: session.worldPosition.y }
          : null,
      }))
      .sort(
        (left, right) =>
          left.accountId.localeCompare(right.accountId) ||
          left.phase.localeCompare(right.phase) ||
          (left.characterSlot ?? -1) - (right.characterSlot ?? -1),
      );
  const disconnectPlayerAccount = (accountId) => {
    if (typeof accountId !== "string" || accountId.length === 0) return 0;
    let disconnectedSessions = 0;
    for (const session of authenticatedSessions) {
      if (session.accountId !== accountId || session.phase === "closed")
        continue;
      const socket = sessionSockets.get(session);
      if (!socket || socket.destroyed || socket.writableEnded) continue;
      session.phase = "closed";
      socket.destroy();
      disconnectedSessions += 1;
    }
    if (disconnectedSessions > 0)
      publish({
        type: "moderation-player-disconnected",
        sessionCount: disconnectedSessions,
      });
    return disconnectedSessions;
  };
  const resolveClassDefinition = async (classId) =>
    getClassDefinition
      ? getClassDefinition(classId)
      : getWyd727ClassEntry(DEFAULT_WYD727_CLASS_CATALOG, classId);
  const loginAttempts = new Wyd727AttemptLimiter({
    maxFailures: maxAuthFailures,
    windowMs: authWindowMs,
  });
  const tokenAttempts = new Wyd727AttemptLimiter({
    maxFailures: maxAuthFailures,
    windowMs: authWindowMs,
  });
  const server = createServer((socket) => {
    if (clients.size >= maxConnections) {
      publish({
        type: "connection-rejected",
        reason: "connection limit reached",
      });
      socket.destroy();
      return;
    }

    const decoder = new StreamDecoder();
    let protocolFailed = false;
    const session = {
      phase: authEnabled ? "await-login" : "passive",
      accountId: null,
      clientId: 0,
      worldPosition: null,
      worldMapId: null,
      worldCharacterName: null,
      worldSpeed: CARACATOA_START_MOVEMENT_SPEED,
      worldMonsters: [],
      worldLevel: 1,
      worldClassId: 0,
      worldAttackDamage: 0,
      worldBaseDamage: 0,
      worldBaseDefense: 0,
      worldCurrentHp: 0,
      worldMaxHp: 0,
      worldBaseMaxHp: 0,
      worldCurrentMp: 0,
      worldMaxMp: 0,
      worldBaseMaxMp: 0,
      worldPlayerDefense: 0,
      worldIntelligenceBonus: 0,
      worldStartingStats: null,
      worldAllocatedAttributes: { str: 0, int: 0, dex: 0, con: 0 },
      worldAvailableAttributePoints: 0,
      worldAvailableSkillPoints: 0,
      worldEquipment: [],
      worldEquipmentAttackDamageBonus: 0,
      worldEquipmentMagicAttackBonus: 0,
      worldEquipmentMagicAttackBps: 0,
      worldEquipmentDefenseBonus: 0,
      worldEquipmentMaxHpBonus: 0,
      worldEquipmentMaxMpBonus: 0,
      worldEquipmentAbsorptionBps: 0,
      worldEquipmentDropRateBps: 0,
      worldEquipmentExperienceBonusBps: 0,
      worldEquipmentMpCostReductionBps: 0,
      worldEquipmentCooldownReductionBps: 0,
      worldDamageAbsorptionBps: 0,
      worldMountBonuses: {
        hp: 0,
        physicalAttack: 0,
        magicAttack: 0,
        defense: 0,
        moveSpeedBps: 0,
        absorptionBps: 0,
      },
      worldSkills: new Map(),
      worldSkillCatalog: new Map(),
      worldSkillCooldowns: new Map(),
      nextBasicAttackDamageBonus: 0,
      lastBasicAttackAt: null,
      characterSlot: null,
      sendBody: null,
      packetQueue: Promise.resolve(),
    };
    const remoteAddress = socket.remoteAddress ?? "unknown";
    sessionSockets.set(session, socket);
    sessionsBySocket.set(socket, session);
    const sessionIsActive = () =>
      !socket.destroyed && !socket.writableEnded && session.phase !== "closed";
    const tokenAttemptKey = () => `${remoteAddress}\u0000${session.accountId}`;
    clients.add(socket);
    socket.setNoDelay(true);
    if (idleTimeoutMs > 0)
      socket.setTimeout(idleTimeoutMs, () => socket.destroy());
    publish({ type: "connection-open" });

    const closeForSessionError = (error) => {
      const code =
        typeof error?.code === "string" ? error.code : "SESSION_HANDLER_FAILED";
      publish({ type: "session-error", code });
      socket.destroy();
    };

    const sendBody = (body, { closeAfter = false } = {}) => {
      if (socket.destroyed || socket.writableEnded) {
        body.fill(0);
        return false;
      }
      let wire;
      try {
        wire = encodeFrame(body, randomSequence());
        publish({
          type: "server-frame",
          opcode: body.length >= 2 ? body.readUInt16LE(0) : null,
          frameLength: wire.length,
        });
      } finally {
        body.fill(0);
      }
      if (closeAfter) socket.end(wire);
      else socket.write(wire);
      return true;
    };
    session.sendBody = sendBody;

    const handleAuthenticatedFrame = async (frame, inspected) => {
      if (
        !authEnabled ||
        socket.destroyed ||
        socket.writableEnded ||
        session.phase === "closed"
      )
        return;
      const ipKey = remoteAddress;
      if (session.phase === "in-world") {
        try {
          refreshDueMonsterRespawns();
        } catch {
          publish({ type: "world-monster-state-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
      }

      if (inspected.opcode === 0x20d && session.phase === "await-login") {
        if (!loginAttempts.canAttempt(ipKey)) {
          publish({ type: "login-denied", reason: "attempt-limit" });
          session.phase = "closed";
          sendBody(buildWyd727LoginDeniedBody(), { closeAfter: true });
          return;
        }

        const account = await authenticateWyd727LoginPacket(
          accountStore,
          frame.body,
        );
        if (!sessionIsActive()) return;
        if (!account) {
          const failures = loginAttempts.recordFailure(ipKey);
          publish({ type: "login-denied", reason: "credentials" });
          if (failures >= maxAuthFailures) session.phase = "closed";
          sendBody(buildWyd727LoginDeniedBody(), {
            closeAfter: failures >= maxAuthFailures,
          });
          return;
        }

        loginAttempts.clear(ipKey);
        session.accountId = account.accountId;
        authenticatedSessions.add(session);
        session.clientId = randomClientId();
        session.phase = "await-token";
        const hashKeyTable = randomHashKeyTable();
        const response = buildWyd727LoginSuccessfulBody({
          clientId: session.clientId,
          timestamp: Date.now() >>> 0,
          hashKeyTable,
        });
        hashKeyTable.fill(0);
        publish({ type: "login-authenticated" });
        sendBody(response);
        return;
      }

      if (inspected.opcode === 0xfde && session.phase === "await-token") {
        const key = tokenAttemptKey();
        if (!tokenAttempts.canAttempt(key)) {
          publish({ type: "token-denied", reason: "attempt-limit" });
          session.phase = "closed";
          sendBody(buildWyd727TokenResultBody(false), { closeAfter: true });
          return;
        }

        const account = await authenticateWyd727TokenPacket(
          accountStore,
          session.accountId,
          frame.body,
        );
        if (!sessionIsActive()) return;
        if (!account) {
          const failures = tokenAttempts.recordFailure(key);
          publish({ type: "token-denied", reason: "credentials" });
          if (failures >= maxAuthFailures) session.phase = "closed";
          sendBody(buildWyd727TokenResultBody(false), {
            closeAfter: failures >= maxAuthFailures,
          });
          return;
        }

        let characters = [];
        try {
          characters =
            characterStore?.listCharacters?.(session.accountId) ?? [];
        } catch {
          publish({ type: "character-list-unavailable" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        tokenAttempts.clear(key);
        session.phase = "character-select";
        publish({ type: "token-authenticated" });
        sendBody(buildWyd727TokenResultBody(true));
        sendBody(
          buildWyd727CharacterListUpdateBody({
            clientId: session.clientId,
            characters,
          }),
        );
        return;
      }

      if (inspected.opcode === 0x7f00 && session.phase === "character-select") {
        if (inspected.lengthValid !== true) {
          publish({ type: "character-create-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const request = parseCaracatoaCreateCharacterRequest(frame.body);
        if (request.malformed) {
          publish({ type: "character-create-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        let status = request.status;
        if (status === CARACATOA_CREATE_CHARACTER_STATUS.created) {
          let classDefinition;
          try {
            classDefinition = await resolveClassDefinition(request.classId);
          } catch {
            publish({ type: "character-create-class-catalog-unavailable" });
            session.phase = "closed";
            socket.end();
            return;
          }
          if (!sessionIsActive()) return;
          if (
            !classDefinition ||
            classDefinition.id !== String(request.classId) ||
            !classDefinition.enabled
          ) {
            status = CARACATOA_CREATE_CHARACTER_STATUS.unsupportedClass;
          }
        }
        if (status === CARACATOA_CREATE_CHARACTER_STATUS.created) {
          if (
            !characterStore ||
            typeof characterStore.createCharacter !== "function" ||
            typeof characterStore.listCharacters !== "function"
          ) {
            status = CARACATOA_CREATE_CHARACTER_STATUS.storageFailure;
          } else {
            try {
              characterStore.createCharacter(session.accountId, {
                slot: request.slot,
                classId: request.classId,
                name: request.name,
              });
            } catch (error) {
              if (error instanceof PlayerCharacterAccountError) {
                publish({ type: "character-create-account-disabled" });
                session.phase = "closed";
                socket.destroy();
                return;
              }
              if (error instanceof PlayerCharacterInputError)
                status = CARACATOA_CREATE_CHARACTER_STATUS.invalidName;
              else if (error instanceof PlayerCharacterSlotConflictError)
                status = CARACATOA_CREATE_CHARACTER_STATUS.invalidSlot;
              else if (error instanceof PlayerCharacterNameConflictError)
                status = CARACATOA_CREATE_CHARACTER_STATUS.duplicateName;
              else if (error instanceof PlayerCharacterLimitError)
                status = CARACATOA_CREATE_CHARACTER_STATUS.accountLimit;
              else status = CARACATOA_CREATE_CHARACTER_STATUS.storageFailure;
            }
          }
        }

        const response = buildCaracatoaCharacterCreateResultBody({
          clientId: session.clientId,
          status,
          slot: request.slot,
          classId: request.classId,
        });
        sendBody(response);
        if (status === CARACATOA_CREATE_CHARACTER_STATUS.created) {
          const listResponse = buildWyd727CharacterListUpdateBody({
            clientId: session.clientId,
            characters: characterStore.listCharacters(session.accountId),
          });
          sendBody(listResponse);
          publish({
            type: "character-created",
            slot: request.slot,
            classId: request.classId,
          });
        } else {
          publish({ type: "character-create-rejected", status });
        }
        return;
      }

      if (inspected.opcode === 0x213 && session.phase === "character-select") {
        const request =
          inspected.lengthValid === true
            ? parseWyd727CharacterEntryRequest(frame.body)
            : { malformed: true };
        if (
          request.malformed ||
          !request.versionValid ||
          !request.reservedValid ||
          !request.paddingValid ||
          (request.clientId !== 0 && request.clientId !== session.clientId)
        ) {
          publish({ type: "world-entry-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        if (!walkability) {
          publish({
            type: "world-entry-denied",
            reason: "walkability-unavailable",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        let character;
        try {
          character =
            characterStore?.getCharacterBySlot?.(
              session.accountId,
              request.slot,
            ) ?? null;
        } catch {
          publish({ type: "world-entry-storage-failed", stage: "character-read" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!character) {
          publish({
            type: "world-entry-denied",
            reason: "character-not-found",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        if (!character) {
          publish({
            type: "world-entry-denied",
            reason: "character-not-found",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        let classDefinition;
        try {
          classDefinition = await resolveClassDefinition(character.classId);
        } catch {
          publish({
            type: "world-entry-denied",
            reason: "class-catalog-unavailable",
          });
          session.phase = "closed";
          socket.end();
          return;
        }
        if (!sessionIsActive()) return;
        if (
          !classDefinition ||
          classDefinition.id !== String(character.classId)
        ) {
          publish({
            type: "world-entry-denied",
            reason: "class-unsupported",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        const positionUninitialized =
          character.worldX === null && character.worldY === null;
        if (
          positionUninitialized &&
          ((isPlayablePosition && !isPlayablePosition(worldStartPosition.x, worldStartPosition.y)) ||
            !walkability.isWalkablePosition(
              worldStartPosition.x,
              worldStartPosition.y,
            ))
        ) {
          publish({
            type: "world-entry-denied",
            reason: "spawn-not-walkable",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        try {
          character =
            characterStore?.initializeCharacterPosition?.(
              session.accountId,
              request.slot,
              worldStartPosition,
            ) ?? null;
        } catch {
          publish({ type: "world-entry-storage-failed", stage: "position-initialize" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!character) {
          publish({
            type: "world-entry-denied",
            reason: "character-not-found",
          });
          session.phase = "closed";
          socket.end();
          return;
        }

        let persistedPosition = { x: character.worldX, y: character.worldY };
        if (
          !Number.isInteger(persistedPosition.x) ||
          persistedPosition.x < -0x8000 ||
          persistedPosition.x > 0x7fff ||
          !Number.isInteger(persistedPosition.y) ||
          persistedPosition.y < -0x8000 ||
          persistedPosition.y > 0x7fff
        ) {
          publish({ type: "world-entry-storage-failed", stage: "position-invalid" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const isPositionPlayable = (position) =>
          (!isPlayablePosition || isPlayablePosition(position.x, position.y)) &&
          walkability.isWalkablePosition(position.x, position.y);
        if (!isPositionPlayable(persistedPosition)) {
          const safePosition = {
            x: worldStartPosition.x,
            y: worldStartPosition.y,
          };
          if (!isPositionPlayable(safePosition)) {
            publish({
              type: "world-entry-denied",
              reason: "spawn-not-walkable",
            });
            session.phase = "closed";
            socket.end();
            return;
          }

          let positionRepaired = false;
          try {
            positionRepaired = Boolean(
              characterStore?.saveCharacterPosition?.(
                session.accountId,
                request.slot,
                persistedPosition,
                safePosition,
              ),
            );
          } catch {
            publish({ type: "world-entry-storage-failed", stage: "position-repair" });
            session.phase = "closed";
            socket.destroy();
            return;
          }

          if (positionRepaired) {
            persistedPosition = safePosition;
            publish({
              type: "world-entry-position-corrected",
              reason: "position-not-walkable",
            });
          } else {
            let latestCharacter;
            try {
              latestCharacter =
                characterStore?.getCharacterBySlot?.(
                  session.accountId,
                  request.slot,
                ) ?? null;
            } catch {
              publish({ type: "world-entry-storage-failed", stage: "position-reload" });
              session.phase = "closed";
              socket.destroy();
              return;
            }
            if (!latestCharacter) {
              publish({
                type: "world-entry-denied",
                reason: "character-not-found",
              });
              session.phase = "closed";
              socket.end();
              return;
            }
            const latestPosition = {
              x: latestCharacter.worldX,
              y: latestCharacter.worldY,
            };
            if (
              !Number.isInteger(latestPosition.x) ||
              latestPosition.x < -0x8000 ||
              latestPosition.x > 0x7fff ||
              !Number.isInteger(latestPosition.y) ||
              latestPosition.y < -0x8000 ||
              latestPosition.y > 0x7fff ||
              !isPositionPlayable(latestPosition)
            ) {
              publish({
                type: "world-entry-denied",
                reason: "position-not-walkable",
              });
              session.phase = "closed";
              socket.end();
              return;
            }
            character = latestCharacter;
            persistedPosition = latestPosition;
          }
        }

        const startingStats = classDefinition.properties.startingStats;
        const levelSteps = character.level - 1;
        let characterAttributes;
        try {
          characterAttributes =
            typeof characterStore?.getCharacterAttributes === "function"
              ? characterStore.getCharacterAttributes(
                  session.accountId,
                  request.slot,
                )
              : {
                  availablePoints: 0,
                  allocated: { str: 0, int: 0, dex: 0, con: 0 },
                };
          if (!characterAttributes) throw new Error("Ficha indisponível.");
        } catch {
          publish({ type: "world-entry-storage-failed", stage: "attributes-read" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const classStats = getCaracatoaStatsWithAttributes(
          startingStats,
          character.level,
          characterAttributes.allocated,
        );
        const startingHp =
          startingStats.currentHp > 0
            ? Math.min(
                startingStats.currentHp + levelSteps * CARACATOA_HP_PER_LEVEL,
                classStats.maxHp,
              )
            : classStats.maxHp;
        let characterCurrentHp =
          character.currentHp === null
            ? startingHp
            : character.currentHp <= 0
              ? classStats.maxHp
              : Math.min(character.currentHp, classStats.maxHp);
        try {
          if (
            typeof characterStore?.initializeCharacterHitPoints === "function"
          ) {
            const saved = characterStore.initializeCharacterHitPoints(
              session.accountId,
              request.slot,
              startingHp,
              classStats.maxHp,
            );
            if (!saved) throw new Error("Personagem indisponível.");
            characterCurrentHp = saved.currentHp;
          } else if (
            typeof characterStore?.setCharacterHitPoints === "function"
          ) {
            const saved = characterStore.setCharacterHitPoints(
              session.accountId,
              request.slot,
              characterCurrentHp,
            );
            if (!saved) throw new Error("Personagem indisponível.");
          }
        } catch {
          publish({ type: "world-entry-storage-failed", stage: "hp-initialize" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const startingMp =
          startingStats.currentMp + levelSteps * CARACATOA_MP_PER_LEVEL;
        let characterCurrentMp = startingMp;
        try {
          if (typeof characterStore?.initializeCharacterMana === "function") {
            const saved = characterStore.initializeCharacterMana(
              session.accountId,
              request.slot,
              startingMp,
              classStats.maxMp,
            );
            if (!saved) throw new Error("Personagem indisponível.");
            characterCurrentMp = saved.currentMp;
          } else if (character.currentMp !== null) {
            characterCurrentMp = Math.min(
              character.currentMp,
              classStats.maxMp,
            );
          }
        } catch {
          publish({ type: "world-entry-storage-failed", stage: "mp-initialize" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        let characterSkills = [];
        let learnedCharacterSkills = [];
        let characterSkillState = {
          availablePoints: 0,
          classId: character.classId,
          level: character.level,
          learned: [],
        };
        let learnedSkill = [0, 0];
        try {
          if (typeof characterStore?.getCharacterSkillState === "function") {
            characterSkillState = characterStore.getCharacterSkillState(
              session.accountId,
              request.slot,
            );
            if (
              !characterSkillState ||
              characterSkillState.classId !== character.classId ||
              characterSkillState.level !== character.level ||
              !Array.isArray(characterSkillState.learned)
            ) {
              throw new Error("Ficha de habilidades indisponível.");
            }
          }
          if (getCharacterSkills) {
            const candidateSkills = await getCharacterSkills(character.classId);
            const catalogSlice = {
              schemaVersion: 1,
              kind: "skills",
              entries: candidateSkills,
            };
            characterSkills = getWyd727SkillsForClass(
              catalogSlice,
              character.classId,
            );
            if (
              !Array.isArray(candidateSkills) ||
              candidateSkills.length > 24 ||
              characterSkills.length !== candidateSkills.length
            ) {
              throw new Error("Catálogo de habilidades por classe inválido.");
            }
            const learnedIds = new Set(
              characterSkillState.learned.map((skill) => skill.catalogSkillId),
            );
            learnedCharacterSkills = characterSkills.filter((skill) =>
              learnedIds.has(skill.id),
            );
            learnedSkill = getWyd727LearnedSkillMask(learnedCharacterSkills);
          }
        } catch {
          publish({
            type: "world-entry-denied",
            reason: "skill-content-unavailable",
          });
          session.phase = "closed";
          socket.end();
          return;
        }
        const classStatsForWorld = {
          ...classStats,
          currentHp: characterCurrentHp,
          currentMp: characterCurrentMp,
        };

        let monsterBodies = [];
        try {
          if (getWorldMonsterBodies) {
            monsterBodies = await getWorldMonsterBodies(
              session.clientId,
              persistedPosition,
            );
          }
          if (
            !Array.isArray(monsterBodies) ||
            monsterBodies.length > 60 ||
            monsterBodies.some(
              (body) => !Buffer.isBuffer(body) || body.length !== 252,
            )
          ) {
            throw new Error("Pacotes de monstro inválidos.");
          }
        } catch {
          publish({
            type: "world-entry-denied",
            reason: "world-content-unavailable",
          });
          session.phase = "closed";
          socket.end();
          return;
        }
        if (!sessionIsActive()) return;

        let inventoryItems = [];
        let characterEquipment = [];
        let characterMounts = [];
        let equipmentBonuses = {
          attackDamageBonus: 0,
          defenseBonus: 0,
          maxHpBonus: 0,
          maxMpBonus: 0,
          absorptionBps: 0,
        };
        let inventoryReadStage = "character-inventory";
        try {
          if (getCharacterInventory) {
            inventoryItems = await getCharacterInventory(
              session.accountId,
              request.slot,
            );
          } else if (characterStore?.initializeCharacterInventory) {
            const inventory = characterStore.initializeCharacterInventory(
              session.accountId,
              request.slot,
              [],
            );
            if (!inventory) throw new Error("Personagem indisponível.");
          }
          if (!Array.isArray(inventoryItems)) {
            throw new Error("Inventário do personagem inválido.");
          }
          inventoryReadStage = "character-equipment";
          if (getCharacterEquipment) {
            characterEquipment = await getCharacterEquipment(
              session.accountId,
              request.slot,
              character.classId,
            );
          }
          if (!Array.isArray(characterEquipment)) {
            throw new Error("Equipamento do personagem inválido.");
          }
          equipmentBonuses =
            getWyd727EquipmentCombatBonuses(characterEquipment);
          inventoryReadStage = "character-mounts";
          if (typeof characterStore?.listCharacterMounts === "function") {
            characterMounts = characterStore.listCharacterMounts(
              session.accountId,
              request.slot,
            );
            if (
              characterMounts.length === 0 &&
              typeof characterStore.grantCharacterMountEgg === "function"
            ) {
              const rewardTime = now();
              if (!Number.isSafeInteger(rewardTime) || rewardTime < 0) {
                throw new Error("Relógio inválido ao entregar o ovo inicial.");
              }
              const accountKey = createHash("sha256")
                .update(session.accountId)
                .digest("hex")
                .slice(0, 32);
              characterStore.grantCharacterMountEgg(session.accountId, {
                characterSlot: request.slot,
                speciesId: "equus",
                sourceEventId: `tutorial-equus:${accountKey}:${request.slot}`,
                incubationCritical: 1,
                nowMs: rewardTime,
              });
              characterMounts = characterStore.listCharacterMounts(
                session.accountId,
                request.slot,
              );
              publish({ type: "world-mount-tutorial-egg-granted" });
            }
          }
        } catch {
          publish({ type: "world-entry-storage-failed", stage: inventoryReadStage });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!sessionIsActive()) return;
        const ridingMount = characterMounts.find((mount) => mount.riding) ?? null;
        const initialMountBonuses = ridingMount
          ? calculateCaracatoaMountBonuses(ridingMount)
          : null;
        classStatsForWorld.maxHp = Math.min(
          0x7fffffff,
          classStats.maxHp + equipmentBonuses.maxHpBonus + (initialMountBonuses?.hp ?? 0),
        );
        classStatsForWorld.maxMp = Math.min(
          0x7fffffff,
          classStats.maxMp + equipmentBonuses.maxMpBonus,
        );
        classStatsForWorld.currentHp = Math.min(
          characterCurrentHp,
          classStatsForWorld.maxHp,
        );
        classStatsForWorld.currentMp = Math.min(
          characterCurrentMp,
          classStatsForWorld.maxMp,
        );
        if (
          (classStatsForWorld.currentHp !== characterCurrentHp ||
            classStatsForWorld.currentMp !== characterCurrentMp) &&
          (typeof characterStore?.setCharacterResources !== "function" ||
            !characterStore.setCharacterResources(
              session.accountId,
              request.slot,
              classStatsForWorld.currentHp,
              classStatsForWorld.currentMp,
            ))
        ) {
          publish({ type: "world-entry-storage-failed", stage: "resources-persist" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        classStatsForWorld.defense += equipmentBonuses.defenseBonus + (initialMountBonuses?.defense ?? 0);
        classStatsForWorld.damage = Math.min(
          0x7fffffff,
          classStats.damage + equipmentBonuses.attackDamageBonus + (initialMountBonuses?.physicalAttack ?? 0),
        );
        classStatsForWorld.movementSpeed = Math.max(
          1,
          Math.floor(classStats.movementSpeed * (10_000 + (initialMountBonuses?.moveSpeedBps ?? 0)) / 10_000),
        );

        const response = buildWyd727CharacterToWorldBody({
          clientId: session.clientId,
          mobIndex: session.clientId,
          timestamp: Date.now() >>> 0,
          serverTime: Math.floor(Date.now() / 1000) >>> 0,
          character,
          classStats: classStatsForWorld,
          position: persistedPosition,
          inventoryItems,
          learnedSkill,
        });
        let worldMonsters;
        const respawnedMonsters = [];
        try {
          const initializedAt = now();
          if (!Number.isSafeInteger(initializedAt) || initializedAt < 0) {
            throw new Error("Relógio inválido ao carregar monstros.");
          }
          worldMonsters = monsterBodies.map((body) => {
            const parsed = readWyd727MonsterCombatState(body);
            const registered = registerWorldMonster(
              parsed,
              body,
              initializedAt,
            );
            if (registered.respawned) {
              respawnedMonsters.push(registered.runtime);
            }
            return registered.runtime;
          });
        } catch {
          publish({
            type: "world-entry-denied",
            reason: "monster-state-unavailable",
          });
          session.phase = "closed";
          socket.end();
          response.fill(0);
          return;
        }
        session.characterSlot = request.slot;
        session.worldCharacterName = character.name;
        session.worldMapId = 1;
        session.worldLevel = character.level;
        session.worldClassId = character.classId;
        session.worldPosition = persistedPosition;
        session.worldMonsters = worldMonsters;
        session.worldCurrentHp = classStatsForWorld.currentHp;
        session.worldMaxHp = classStatsForWorld.maxHp;
        session.worldBaseMaxHp = classStats.maxHp;
        session.worldCurrentMp = classStatsForWorld.currentMp;
        session.worldMaxMp = classStatsForWorld.maxMp;
        session.worldBaseMaxMp = classStats.maxMp;
        session.worldBaseDefense = classStats.defense;
        session.worldPlayerDefense = classStatsForWorld.defense;
        session.worldIntelligenceBonus = characterAttributes.allocated.int;
        session.worldStartingStats = startingStats;
        session.worldAllocatedAttributes = characterAttributes.allocated;
        session.worldAvailableAttributePoints = characterAttributes.availablePoints;
        session.worldAvailableSkillPoints = characterSkillState.availablePoints;
        session.worldSkills = new Map(
          learnedCharacterSkills.map((entry) => [
            entry.properties.clientSkillId,
            entry,
          ]),
        );
        session.worldSkillCatalog = new Map(
          characterSkills.map((entry) => [
            entry.properties.clientSkillId,
            entry,
          ]),
        );
        session.worldSkillCooldowns = getCharacterSkillCooldowns(
          session.accountId,
          request.slot,
        );
        session.worldAttackDamage = Math.min(
          0x7fffffff,
          classStats.damage + equipmentBonuses.attackDamageBonus + (initialMountBonuses?.physicalAttack ?? 0),
        );
        session.worldBaseDamage = classStats.damage;
        session.worldEquipment = characterEquipment;
        session.worldEquipmentAttackDamageBonus =
          equipmentBonuses.attackDamageBonus;
        session.worldEquipmentMagicAttackBonus = equipmentBonuses.magicAttackBonus;
        session.worldEquipmentMagicAttackBps = equipmentBonuses.magicAttackBps;
        session.worldEquipmentDefenseBonus = equipmentBonuses.defenseBonus;
        session.worldEquipmentMaxHpBonus = equipmentBonuses.maxHpBonus;
        session.worldEquipmentMaxMpBonus = equipmentBonuses.maxMpBonus;
        session.worldEquipmentAbsorptionBps = equipmentBonuses.absorptionBps;
        session.worldEquipmentDropRateBps = equipmentBonuses.dropRateBps;
        session.worldEquipmentExperienceBonusBps = equipmentBonuses.experienceBonusBps;
        session.worldEquipmentMpCostReductionBps = equipmentBonuses.mpCostReductionBps;
        session.worldEquipmentCooldownReductionBps = equipmentBonuses.cooldownReductionBps;
        session.worldBaseMovementSpeed = classStats.movementSpeed;
        session.lastBasicAttackAt = null;
        applyMountBonusesToSession(
          session,
          initialMountBonuses,
        );
        session.phase = "in-world";
        worldSessions.add(session);
        scheduleNextMonsterAi();
        scheduleNextMountTick();
        publish({
          type: "world-entry-accepted",
          slot: request.slot,
          classId: character.classId,
          position: persistedPosition,
        });
        sendBody(response);
        sendBody(buildCaracatoaProgressionSyncBody({
          clientId: session.clientId,
          timestamp: Date.now() >>> 0,
          level: character.level,
          experience: character.experience ?? 0,
          currentHp: classStatsForWorld.currentHp,
          maxHp: classStatsForWorld.maxHp,
          currentMp: classStatsForWorld.currentMp,
          maxMp: classStatsForWorld.maxMp,
          damage: session.worldAttackDamage,
        }));
        for (const item of inventoryItems) {
          if (!item.itemization) continue;
          sendBody(buildCaracatoaItemizationDetailBody({
            clientId: session.clientId,
            status: CARACATOA_ITEMIZATION_DETAIL_STATUS.snapshot,
            slot: item.slot,
            itemization: item.itemization,
          }));
        }
        sendBody(
          buildCaracatoaAttributeSyncBody({
            clientId: session.clientId,
            timestamp: Date.now() >>> 0,
            status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
            availablePoints: characterAttributes.availablePoints,
            stats: classStatsForWorld,
          }),
        );
        sendBody(
          buildCaracatoaSkillStateBody({
            clientId: session.clientId,
            timestamp: Date.now() >>> 0,
            status: CARACATOA_SKILL_SYNC_STATUS.snapshot,
            availablePoints: characterSkillState.availablePoints,
            learnedSkills: learnedCharacterSkills,
          }),
        );
        sendMountSnapshot(session, characterMounts, {
          nowMs: now(),
        });
        const stageState = characterStore?.getCharacterStageState?.(
          session.accountId,
          session.characterSlot,
        );
        if (stageState) sendStageSnapshot(session, stageState);
        for (let equipmentSlot = 0;
          equipmentSlot < CARACATOA_EQUIPMENT_SLOTS.length;
          equipmentSlot += 1) {
          const equipment = characterEquipment.find(
            (item) => item.equipmentSlot === equipmentSlot,
          ) ?? null;
          sendBody(buildCaracatoaEquipmentSyncBody({
            clientId: session.clientId,
            status: CARACATOA_EQUIPMENT_SYNC_STATUS.snapshot,
            equipmentSlot,
            equipment,
            bonuses: equipmentBonuses,
          }));
        }
        for (let index = 0; index < monsterBodies.length; index += 1) {
          const monster = worldMonsters[index];
          const spawnEvent = {
            type: "world-monster-spawned",
            clientEntityId: monster.clientEntityId,
            position: monster.position,
            currentHp: monster.currentHp,
            maxHp: monster.maxHp,
          };
          sendBody(
            buildMonsterSpawnBody(monster, session.clientId, Date.now() >>> 0),
          );
          publish(spawnEvent);
          if (monster.currentHp === 0) {
            sendBody(
              buildWyd727MonsterDeathBody({
                clientId: session.clientId,
                timestamp: Date.now() >>> 0,
                killed: monster.clientEntityId,
                killer: 0,
              }),
            );
          }
        }
        for (const monster of respawnedMonsters) {
          broadcastMonsterRespawn(monster, Date.now() >>> 0, session);
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === CARACATOA_TRADE_REQUEST_OPCODE) {
        const request = parseCaracatoaTradeRequestBody(frame.body);
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-trade-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const { action } = request.request;
        const currentTime = now();
        if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
          rejectTrade(session, "O relógio do servidor está indisponível.");
          return;
        }
        const activeTrade = tradeBySession.get(session);
        if (action === "invite") {
          if (activeTrade) {
            rejectTrade(session, "Conclua ou cancele a negociação atual.", activeTrade);
            return;
          }
          const matching = [...worldSessions].filter((candidate) =>
            candidate !== session &&
            sessionIsUsableForTrade(candidate) &&
            candidate.worldMapId === session.worldMapId &&
            typeof candidate.worldCharacterName === "string" &&
            candidate.worldCharacterName.toLowerCase() === request.request.targetName.toLowerCase(),
          );
          if (matching.length !== 1) {
            rejectTrade(session, matching.length === 0
              ? "Personagem não está online neste mapa."
              : "Há mais de uma sessão com esse nome; a troca foi recusada.");
            return;
          }
          const target = matching[0];
          if (target.accountId === session.accountId) {
            rejectTrade(session, "A troca exige duas contas diferentes.");
            return;
          }
          if (!session.worldPosition || !target.worldPosition ||
              Math.max(
                Math.abs(session.worldPosition.x - target.worldPosition.x),
                Math.abs(session.worldPosition.y - target.worldPosition.y),
              ) > CARACATOA_TRADE_RANGE) {
            rejectTrade(session, `A outra personagem precisa estar a até ${CARACATOA_TRADE_RANGE} passos.`);
            return;
          }
          if (tradeBySession.has(target)) {
            rejectTrade(session, "A outra personagem já está negociando.");
            return;
          }
          const trade = {
            id: randomUUID(),
            state: "invited",
            revision: 0,
            first: session,
            second: target,
            firstOffer: { inventorySlot: null, itemClientId: null, gold: 0, ready: false },
            secondOffer: { inventorySlot: null, itemClientId: null, gold: 0, ready: false },
            expiresAtMs: currentTime + CARACATOA_TRADE_LIFETIME_MS,
            timer: null,
            pendingOfferSession: null,
            committing: false,
          };
          activeTrades.set(trade.id, trade);
          tradeBySession.set(session, trade);
          tradeBySession.set(target, trade);
          armTradeExpiry(trade);
          notifyTrade(trade, "invited", "Convite de troca enviado.");
          publish({ type: "world-trade-invited" });
          return;
        }

        if (!activeTrade || activeTrade.id !== request.request.tradeId ||
            activeTrades.get(activeTrade.id) !== activeTrade) {
          rejectTrade(session, "Esta negociação não está mais ativa.");
          return;
        }
        if (!tradeIsWithinRange(activeTrade)) {
          clearTrade(activeTrade, "cancelled", "A negociação foi encerrada porque as personagens se afastaram.");
          publish({ type: "world-trade-range-ended" });
          return;
        }
        if (activeTrade.committing) {
          rejectTrade(session, "A gravação da troca está em andamento.", activeTrade);
          return;
        }
        if (action === "accept") {
          if (session !== activeTrade.second || activeTrade.state !== "invited") {
            rejectTrade(session, "Este convite não pode ser aceito por esta sessão.", activeTrade);
            return;
          }
          activeTrade.state = "offering";
          activeTrade.revision = 1;
          armTradeExpiry(activeTrade);
          notifyTrade(activeTrade, "offering", "Oferta aberta. Alterar qualquer oferta remove as confirmações.");
          publish({ type: "world-trade-accepted" });
          return;
        }
        if (action === "decline") {
          if (session !== activeTrade.second || activeTrade.state !== "invited") {
            rejectTrade(session, "Só a pessoa convidada pode recusar este convite.", activeTrade);
            return;
          }
          clearTrade(activeTrade, "cancelled", "O convite de troca foi recusado.");
          publish({ type: "world-trade-declined" });
          return;
        }
        if (action === "cancel") {
          clearTrade(activeTrade, "cancelled", "Uma das personagens cancelou a troca.");
          publish({ type: "world-trade-cancelled" });
          return;
        }
        if (action === "offer") {
          if (activeTrade.state !== "offering" || activeTrade.pendingOfferSession) {
            rejectTrade(session, "A oferta ainda não pode ser alterada.", activeTrade);
            return;
          }
          const { inventorySlot, gold } = request.request;
          if (gold > CARACATOA_TRADE_MAX_GOLD) {
            rejectTrade(session, "Quantidade de gold fora do limite.", activeTrade);
            return;
          }
          if (activeTrade.revision >= 0x7ffffffe) {
            clearTrade(activeTrade, "cancelled", "A revisão da negociação chegou ao limite.");
            return;
          }
          activeTrade.revision += 1;
          activeTrade.firstOffer.ready = false;
          activeTrade.secondOffer.ready = false;
          activeTrade.pendingOfferSession = session;
          let itemClientId = null;
          if (inventorySlot !== null) {
            try {
              if (!getCharacterInventory) throw new Error("Inventário indisponível.");
              const inventory = await getCharacterInventory(session.accountId, session.characterSlot);
              if (activeTrades.get(activeTrade.id) !== activeTrade ||
                  activeTrade.pendingOfferSession !== session) return;
              const item = inventory.find((entry) => entry.slot === inventorySlot);
              if (!item || !Number.isInteger(item.clientItemId) || item.clientItemId < 1 || item.clientItemId > 0xffff) {
                activeTrade.pendingOfferSession = null;
                rejectTrade(session, "O slot escolhido está vazio ou mudou.", activeTrade);
                return;
              }
              if (session.worldEquipment.some((entry) => entry.inventorySlot === inventorySlot)) {
                activeTrade.pendingOfferSession = null;
                rejectTrade(session, "Itens equipados não podem ser ofertados.", activeTrade);
                return;
              }
              itemClientId = item.clientItemId;
            } catch {
              activeTrade.pendingOfferSession = null;
              rejectTrade(session, "Não foi possível conferir o item no inventário.", activeTrade);
              return;
            }
          }
          if (activeTrades.get(activeTrade.id) !== activeTrade ||
              activeTrade.pendingOfferSession !== session) return;
          const offer = tradeOfferFor(activeTrade, session);
          offer.inventorySlot = inventorySlot;
          offer.itemClientId = itemClientId;
          offer.gold = gold;
          offer.ready = false;
          activeTrade.pendingOfferSession = null;
          armTradeExpiry(activeTrade);
          notifyTrade(activeTrade, "offering", "Oferta atualizada. As duas pessoas precisam confirmar a mesma revisão.");
          publish({ type: "world-trade-offer-updated" });
          return;
        }
        if (action === "ready") {
          if (activeTrade.state !== "offering" || activeTrade.pendingOfferSession ||
              request.request.revision !== activeTrade.revision) {
            rejectTrade(session, "A oferta mudou. Atualize os dados antes de confirmar.", activeTrade);
            return;
          }
          tradeOfferFor(activeTrade, session).ready = true;
          if (activeTrade.firstOffer.ready && activeTrade.secondOffer.ready) {
            completeTrade(activeTrade);
          } else {
            notifyTrade(activeTrade, "offering", "Confirmação recebida; aguardando a outra pessoa.");
            publish({ type: "world-trade-ready" });
          }
          return;
        }
        rejectTrade(session, "Ação de troca inválida.", activeTrade);
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === CARACATOA_PLAYER_SHOP_REQUEST_OPCODE) {
        const request = inspected.lengthValid === true
          ? parseCaracatoaPlayerShopRequestBody(frame.body)
          : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-player-shop-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (session.characterSlot === null ||
            typeof characterStore?.listPlayerShopListings !== "function") {
          sendPlayerShopState(session, {
            status: "rejected", reason: "storage-unavailable",
            message: "O serviço do mercado está indisponível.",
          });
          return;
        }
        const actionTime = now();
        if (!Number.isSafeInteger(actionTime) || actionTime < 0) {
          publish({ type: "world-player-shop-request-rejected", reason: "clock-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const action = request.request.action;
        const view = action === "mine" ? "mine" : "market";
        let result;
        try {
          if (action === "list" || action === "mine") {
            result = characterStore.listPlayerShopListings(session.accountId, {
              characterSlot: session.characterSlot,
              view,
              nowMs: actionTime,
            });
          } else if (action === "create") {
            result = characterStore.createPlayerShopListing(session.accountId, {
              characterSlot: session.characterSlot,
              inventorySlot: request.request.inventorySlot,
              askingGold: request.request.askingGold,
              nowMs: actionTime,
            });
          } else if (action === "cancel") {
            result = characterStore.cancelPlayerShopListing(session.accountId, {
              characterSlot: session.characterSlot,
              listingId: request.request.listingId,
              nowMs: actionTime,
            });
          } else if (action === "buy") {
            result = characterStore.buyPlayerShopListing(session.accountId, {
              characterSlot: session.characterSlot,
              listingId: request.request.listingId,
              requestId: request.request.requestId,
              nowMs: actionTime,
            });
          }
        } catch {
          publish({ type: "world-player-shop-storage-failed", action });
          sendPlayerShopState(session, {
            status: "rejected", reason: "storage-failed", view,
            message: "A operação não foi salva. Confira o estado do mercado e tente novamente.",
          });
          return;
        }
        if (!result?.accepted) {
          const message = playerShopReasonText(result?.reason);
          sendPlayerShopState(session, {
            status: "rejected", reason: result?.reason ?? "storage-rejected",
            view, goldBalance: result?.goldBalance ?? null, message,
          });
          publish({ type: "world-player-shop-action-rejected", action, reason: result?.reason });
          return;
        }
        if (action === "list" || action === "mine") {
          sendPlayerShopState(session, {
            status: "ok", message: view === "mine" ? "Seus anúncios ativos." : "Feira de jogadores atualizada.",
            view, goldBalance: result.goldBalance, listings: result.listings,
          });
          publish({ type: "world-player-shop-viewed", view });
          return;
        }
        if (action === "buy") {
          const receipt = result.receipt;
          sendPlayerShopState(session, {
            status: "ok", message: `Compra concluída: ${receipt.catalogItemId} por ${receipt.askingGold} gold.`,
            view: "market", goldBalance: receipt.buyerGoldBalance, receipt,
          });
          if (typeof getCharacterInventory === "function") {
            refreshCharacterInventory(session).catch(() => {
              publish({ type: "world-player-shop-inventory-refresh-failed" });
            });
          }
          const sellerSessions = sessionsForCharacter(
            result.sellerAccount ?? "",
            result.sellerCharacterSlot ?? -1,
          );
          const sellerSession = sellerSessions.find(sessionIsUsableForTrade);
          if (sellerSession) {
            sendPlayerShopState(sellerSession, {
              status: "ok", message: `Seu anúncio ${receipt.catalogItemId} foi vendido por ${receipt.askingGold} gold.`,
              view: "market", goldBalance: receipt.sellerGoldBalance,
            });
            if (typeof getCharacterInventory === "function") {
              refreshCharacterInventory(sellerSession).catch(() => {
                publish({ type: "world-player-shop-inventory-refresh-failed" });
              });
            }
          }
          publish({ type: "world-player-shop-purchased" });
          return;
        }
        const followup = characterStore.listPlayerShopListings(session.accountId, {
          characterSlot: session.characterSlot,
          view: "market",
          nowMs: actionTime,
        });
        sendPlayerShopState(session, {
          status: "ok",
          message: action === "create" ? "Anúncio publicado por sete dias." : "Anúncio retirado; item devolvido ao inventário.",
          view: "market", goldBalance: followup.goldBalance, listings: followup.listings,
        });
        if (action === "create" || action === "cancel") {
          if (typeof getCharacterInventory === "function") {
            refreshCharacterInventory(session).catch(() => {
              publish({ type: "world-player-shop-inventory-refresh-failed" });
            });
          }
        }
        publish({ type: action === "create" ? "world-player-shop-listed" : "world-player-shop-cancelled" });
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f0c) {
        const request = inspected.lengthValid === true
          ? parseCaracatoaMountRequestBody(frame.body)
          : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-mount-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (session.characterSlot === null ||
            typeof characterStore?.listCharacterMounts !== "function") {
          session.sendBody(buildCaracatoaMountStateBody({
            clientId: session.clientId,
            status: CARACATOA_MOUNT_STATUS.rejected,
            action: request.actionId,
            reason: CARACATOA_MOUNT_REASON.storageUnavailable,
            mounts: [],
            nowMs: Math.max(0, now()),
          }));
          return;
        }
        const actionTime = now();
        if (!Number.isSafeInteger(actionTime) || actionTime < 0) {
          publish({ type: "world-mount-request-rejected", reason: "clock-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        let status = request.action === "list"
          ? CARACATOA_MOUNT_STATUS.snapshot
          : CARACATOA_MOUNT_STATUS.applied;
        let reason = CARACATOA_MOUNT_REASON.none;
        let mountBonuses = null;
        let inventoryChanged = false;
        let outcome = null;
        try {
          if (request.action === "incubate") {
            if (typeof characterStore.incubateCharacterMountEgg !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Incubação indisponível.");
            }
            outcome = characterStore.incubateCharacterMountEgg(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
              inventorySlot: request.inventorySlot,
              nowMs: actionTime,
            });
            inventoryChanged = outcome.status === "incubating" || outcome.status === "hatched";
            if (outcome.status === "waiting") {
              status = CARACATOA_MOUNT_STATUS.waiting;
              reason = CARACATOA_MOUNT_REASON.notReady;
            } else if (outcome.status === "missing-dust") {
              status = CARACATOA_MOUNT_STATUS.missingItem;
              reason = CARACATOA_MOUNT_REASON.missingDust;
            }
          } else if (request.action === "feed") {
            if (typeof characterStore.feedCharacterMount !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Alimentação indisponível.");
            }
            outcome = characterStore.feedCharacterMount(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
              inventorySlot: request.inventorySlot,
              nowMs: actionTime,
            });
            inventoryChanged = outcome.status === "fed";
            if (outcome.status === "missing-feed") {
              status = CARACATOA_MOUNT_STATUS.missingItem;
              reason = CARACATOA_MOUNT_REASON.missingRation;
            } else if (outcome.status === "full") {
              status = CARACATOA_MOUNT_STATUS.rejected;
              reason = CARACATOA_MOUNT_REASON.mountState;
            }
          } else if (request.action === "evolve") {
            if (typeof characterStore.evolveCharacterMount !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Evolução indisponível.");
            }
            outcome = characterStore.evolveCharacterMount(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
              inventorySlot: request.inventorySlot,
              nowMs: actionTime,
            });
            inventoryChanged = outcome.status === "evolved";
            if (outcome.status === "missing-dust") {
              status = CARACATOA_MOUNT_STATUS.missingItem;
              reason = CARACATOA_MOUNT_REASON.missingDust;
            }
          } else if (request.action === "select") {
            if (typeof characterStore.selectCharacterMount !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Seleção indisponível.");
            }
            outcome = characterStore.selectCharacterMount(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
            });
          } else if (request.action === "ride") {
            if (typeof characterStore.startCharacterMountRide !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Montaria indisponível.");
            }
            outcome = characterStore.startCharacterMountRide(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
              nowMs: actionTime,
            });
            mountBonuses = outcome.bonuses;
          } else if (request.action === "dismount") {
            if (typeof characterStore.stopCharacterMountRide !== "function") {
              throw moderationError("MOUNT_STORAGE_UNAVAILABLE", "Desmontar indisponível.");
            }
            outcome = characterStore.stopCharacterMountRide(session.accountId, {
              characterSlot: session.characterSlot,
              mountId: request.mountId,
              nowMs: actionTime,
            });
          }

          let mounts = characterStore.listCharacterMounts(
            session.accountId,
            session.characterSlot,
          );
          if (!Array.isArray(mounts)) throw new Error("Estado de montarias inválido.");
          if (request.action === "ride" || request.action === "dismount") {
            const recipients = sessionsForCharacter(session.accountId, session.characterSlot);
            for (const recipient of recipients) {
              try {
                applyMountBonusesToSession(recipient, mountBonuses);
                recipient.sendBody(buildCaracatoaAttributeSyncBody({
                  clientId: recipient.clientId,
                  timestamp: Date.now() >>> 0,
                  status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
                  availablePoints: recipient.worldAvailableAttributePoints,
                  stats: {
                    str: recipient.worldStartingStats.str + recipient.worldAllocatedAttributes.str,
                    int: recipient.worldStartingStats.int + recipient.worldAllocatedAttributes.int,
                    dex: recipient.worldStartingStats.dex + recipient.worldAllocatedAttributes.dex,
                    con: recipient.worldStartingStats.con + recipient.worldAllocatedAttributes.con,
                    currentHp: recipient.worldCurrentHp,
                    maxHp: recipient.worldMaxHp,
                    currentMp: recipient.worldCurrentMp,
                    maxMp: recipient.worldMaxMp,
                    damage: recipient.worldAttackDamage,
                    defense: recipient.worldPlayerDefense,
                  },
                }));
              } catch {
                publish({ type: "world-mount-effect-storage-failed" });
                recipient.phase = "closed";
                sessionSockets.get(recipient)?.destroy();
              }
            }
            mounts = characterStore.listCharacterMounts(
              session.accountId,
              session.characterSlot,
            );
          }
          sendMountSnapshotToCharacter(session.accountId, session.characterSlot, mounts, {
            status,
            action: request.actionId,
            reason,
            nowMs: actionTime,
          });
          if (inventoryChanged && typeof getCharacterInventory === "function") {
            try {
              const inventory = await getCharacterInventory(session.accountId, session.characterSlot);
              if (!Array.isArray(inventory)) throw new Error("Inventário indisponível após consumo de material.");
              const item = inventory.find((entry) => entry.slot === request.inventorySlot) ?? null;
              for (const recipient of sessionsForCharacter(session.accountId, session.characterSlot)) {
                recipient.sendBody(buildWyd727InventorySlotDeltaBody({
                  clientId: recipient.clientId,
                  slot: request.inventorySlot,
                  item,
                }));
              }
            } catch {
              publish({ type: "world-mount-inventory-sync-failed", action: request.action });
            }
          }
          publish({
            type: "world-mount-action",
            action: request.action,
            status,
            reason,
            mountId: request.mountId,
            mountStage: outcome?.mount?.stage ?? outcome?.stage ?? null,
          });
        } catch (error) {
          status = CARACATOA_MOUNT_STATUS.rejected;
          reason = error?.code === "MOUNT_STORAGE_UNAVAILABLE"
            ? CARACATOA_MOUNT_REASON.storageUnavailable
            : ["MOUNT_REQUIREMENT", "RIDE_REQUIREMENT", "EVOLUTION_REQUIREMENT"].includes(error?.code)
              ? CARACATOA_MOUNT_REASON.levelRequirement
              : CARACATOA_MOUNT_REASON.mountState;
          const mounts = characterStore.listCharacterMounts(
            session.accountId,
            session.characterSlot,
          );
          sendMountSnapshotToCharacter(session.accountId, session.characterSlot, mounts, {
            status,
            action: request.actionId,
            reason,
            nowMs: actionTime,
          });
          publish({ type: "world-mount-action-rejected", action: request.action, reason });
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f03) {
        const request =
          inspected.lengthValid === true
            ? parseCaracatoaAttributeAllocationRequest(frame.body)
            : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-attribute-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (
          session.characterSlot === null ||
          !session.worldStartingStats ||
          typeof characterStore?.allocateCharacterAttributePoint !== "function"
        ) {
          publish({ type: "world-attribute-storage-unavailable" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const maxAllocated = 0xffff - session.worldStartingStats[request.attribute];
        let result;
        try {
          result = characterStore.allocateCharacterAttributePoint(
            session.accountId,
            session.characterSlot,
            request.attribute,
            maxAllocated,
          );
        } catch {
          publish({ type: "world-attribute-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!result || !result.allocated) {
          publish({ type: "world-attribute-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const status =
          result.status === "applied"
            ? CARACATOA_ATTRIBUTE_SYNC_STATUS.applied
            : result.status === "no-points"
              ? CARACATOA_ATTRIBUTE_SYNC_STATUS.noPoints
              : CARACATOA_ATTRIBUTE_SYNC_STATUS.capped;
        const recipients = sessionsForCharacter(
          session.accountId,
          session.characterSlot,
        );
        for (const recipient of recipients) {
          if (result.status === "applied") {
            const updatedStats = getCaracatoaStatsWithAttributes(
              recipient.worldStartingStats,
              recipient.worldLevel,
              result.allocated,
            );
            recipient.worldAllocatedAttributes = result.allocated;
            recipient.worldAvailableAttributePoints = result.availablePoints;
            recipient.worldBaseMaxHp = updatedStats.maxHp;
            recipient.worldBaseMaxMp = updatedStats.maxMp;
            recipient.worldBaseDefense = updatedStats.defense;
            recipient.worldIntelligenceBonus = result.allocated.int;
            recipient.worldBaseDamage = updatedStats.damage;
            applyMountBonusesToSession(recipient, recipient.worldMountBonuses);
          }
          recipient.sendBody(
            buildCaracatoaAttributeSyncBody({
              clientId: recipient.clientId,
              timestamp: Date.now() >>> 0,
              status: recipient === session
                ? status
                : CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
              attributeId: recipient === session ? request.attributeId : 0xff,
              availablePoints: recipient.worldAvailableAttributePoints,
              stats: {
                str: recipient.worldStartingStats.str + recipient.worldAllocatedAttributes.str,
                int: recipient.worldStartingStats.int + recipient.worldAllocatedAttributes.int,
                dex: recipient.worldStartingStats.dex + recipient.worldAllocatedAttributes.dex,
                con: recipient.worldStartingStats.con + recipient.worldAllocatedAttributes.con,
                currentHp: recipient.worldCurrentHp,
                maxHp: recipient.worldMaxHp,
                currentMp: recipient.worldCurrentMp,
                maxMp: recipient.worldMaxMp,
                damage: recipient.worldAttackDamage,
                defense: recipient.worldPlayerDefense,
              },
            }),
          );
        }
        publish({
          type:
            result.status === "applied"
              ? "world-attribute-point-spent"
              : "world-attribute-point-rejected",
          attribute: request.attribute,
          availablePoints: result.availablePoints,
          allocated: result.allocated[request.attribute],
          reason: result.status === "applied" ? undefined : result.status,
        });
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f05) {
        const request =
          inspected.lengthValid === true
            ? parseCaracatoaSkillLearnRequest(frame.body)
            : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-skill-learn-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (
          session.characterSlot === null ||
          typeof characterStore?.learnCharacterSkill !== "function" ||
          typeof characterStore?.getCharacterSkillState !== "function"
        ) {
          publish({ type: "world-skill-storage-unavailable" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const skill = session.worldSkillCatalog.get(request.clientSkillId);
        let status;
        let result;
        try {
          if (!skill) {
            status = Math.floor(request.clientSkillId / 24) === session.worldClassId
              ? CARACATOA_SKILL_SYNC_STATUS.unknownSkill
              : CARACATOA_SKILL_SYNC_STATUS.wrongClass;
            result = characterStore.getCharacterSkillState(
              session.accountId,
              session.characterSlot,
            );
          } else {
            result = characterStore.learnCharacterSkill(
              session.accountId,
              session.characterSlot,
              {
                catalogSkillId: skill.id,
                clientSkillId: skill.properties.clientSkillId,
                classId: session.worldClassId,
                pointCost: skill.properties.skillPointCost,
                requiredLevel: skill.properties.requiredLevel,
                prerequisites: skill.properties.prerequisites,
              },
            );
            if (!result) throw new Error("Ficha de habilidades indisponível.");
            status = {
              learned: CARACATOA_SKILL_SYNC_STATUS.learned,
              "already-learned": CARACATOA_SKILL_SYNC_STATUS.alreadyLearned,
              "insufficient-points": CARACATOA_SKILL_SYNC_STATUS.insufficientPoints,
              "level-locked": CARACATOA_SKILL_SYNC_STATUS.levelLocked,
              "prerequisite-locked": CARACATOA_SKILL_SYNC_STATUS.prerequisiteLocked,
              "wrong-class": CARACATOA_SKILL_SYNC_STATUS.wrongClass,
            }[result.status];
            if (status === undefined) throw new Error("Resultado de aprendizado inválido.");
          }
          if (!result) throw new Error("Ficha de habilidades indisponível.");
        } catch {
          publish({ type: "world-skill-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const learnedCatalogIds = new Set(
          result.learned.map((known) => known.catalogSkillId),
        );
        const learnedEntries = [...session.worldSkillCatalog.values()].filter(
          (entry) => learnedCatalogIds.has(entry.id),
        );
        const recipients = sessionsForCharacter(
          session.accountId,
          session.characterSlot,
        );
        for (const recipient of recipients) {
          recipient.worldSkills = new Map(
            learnedEntries.map((entry) => [
              entry.properties.clientSkillId,
              entry,
            ]),
          );
          recipient.worldAvailableSkillPoints = result.availablePoints;
          recipient.sendBody(
            buildCaracatoaSkillStateBody({
              clientId: recipient.clientId,
              timestamp: Date.now() >>> 0,
              status: recipient === session
                ? status
                : CARACATOA_SKILL_SYNC_STATUS.snapshot,
              clientSkillId: recipient === session
                ? request.clientSkillId
                : 0xff,
              availablePoints: result.availablePoints,
              learnedSkills: learnedEntries,
            }),
          );
        }
        publish({
          type: status === CARACATOA_SKILL_SYNC_STATUS.learned
            ? "world-skill-learned"
            : "world-skill-learning-rejected",
          skillId: request.clientSkillId,
          reason: result.status,
          availablePoints: result.availablePoints,
        });
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f12) {
        const request = inspected.lengthValid === true
          ? parseCaracatoaStageRequest(frame.body)
          : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-stage-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        let result;
        try {
          result = session.characterSlot === null
            ? null
            : characterStore?.promoteCharacterStage?.(session.accountId, {
              characterSlot: session.characterSlot,
              eventId: request.requestId,
              nowMs: Math.max(0, now()),
            });
        } catch {
          publish({ type: "world-stage-storage-failed" });
          result = null;
        }
        const state = result?.state ?? characterStore?.getCharacterStageState?.(
          session.accountId,
          session.characterSlot,
        );
        if (!state) {
          publish({ type: "world-stage-state-unavailable" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const reasonByName = {
          "level-cap-required": CARACATOA_STAGE_REASON.levelCapRequired,
          "missing-material": CARACATOA_STAGE_REASON.missingMaterial,
          "maximum-stage": CARACATOA_STAGE_REASON.maximumStage,
          "points-cap": CARACATOA_STAGE_REASON.pointsCap,
          "event-conflict": CARACATOA_STAGE_REASON.eventConflict,
        };
        const promoted = result?.status === "promoted" || result?.status === "duplicate";
        const status = promoted ? CARACATOA_STAGE_STATUS.promoted : CARACATOA_STAGE_STATUS.rejected;
        const reason = promoted ? CARACATOA_STAGE_REASON.none
          : reasonByName[result?.reason] ?? CARACATOA_STAGE_REASON.storageUnavailable;
        if (promoted) {
          const recipients = sessionsForCharacter(session.accountId, session.characterSlot);
          for (const recipient of recipients) {
            const attributes = characterStore?.getCharacterAttributes?.(
              session.accountId,
              session.characterSlot,
            ) ?? { availablePoints: recipient.worldAvailableAttributePoints, allocated: recipient.worldAllocatedAttributes };
            const updatedStats = getCaracatoaStatsWithAttributes(
              recipient.worldStartingStats,
              state.totalLevel,
              attributes.allocated,
            );
            recipient.worldLevel = state.totalLevel;
            recipient.worldAllocatedAttributes = attributes.allocated;
            recipient.worldAvailableAttributePoints = attributes.availablePoints;
            recipient.worldBaseMaxHp = updatedStats.maxHp;
            recipient.worldBaseMaxMp = updatedStats.maxMp;
            recipient.worldBaseDefense = updatedStats.defense;
            recipient.worldBaseDamage = updatedStats.damage;
            recipient.worldIntelligenceBonus = attributes.allocated.int;
            applyMountBonusesToSession(recipient, recipient.worldMountBonuses);
            recipient.sendBody(buildCaracatoaProgressionSyncBody({
              clientId: recipient.clientId,
              timestamp: Date.now() >>> 0,
              level: state.totalLevel,
              experience: state.experience,
              currentHp: recipient.worldCurrentHp,
              maxHp: recipient.worldMaxHp,
              currentMp: recipient.worldCurrentMp,
              maxMp: recipient.worldMaxMp,
              damage: recipient.worldAttackDamage,
            }));
            recipient.sendBody(buildCaracatoaAttributeSyncBody({
              clientId: recipient.clientId,
              timestamp: Date.now() >>> 0,
              status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
              availablePoints: recipient.worldAvailableAttributePoints,
              stats: {
                str: recipient.worldStartingStats.str + attributes.allocated.str,
                int: recipient.worldStartingStats.int + attributes.allocated.int,
                dex: recipient.worldStartingStats.dex + attributes.allocated.dex,
                con: recipient.worldStartingStats.con + attributes.allocated.con,
                currentHp: recipient.worldCurrentHp,
                maxHp: recipient.worldMaxHp,
                currentMp: recipient.worldCurrentMp,
                maxMp: recipient.worldMaxMp,
                damage: recipient.worldAttackDamage,
                defense: recipient.worldPlayerDefense,
              },
            }));
            const skillState = characterStore?.getCharacterSkillState?.(
              session.accountId,
              session.characterSlot,
            );
            if (skillState) {
              recipient.worldAvailableSkillPoints = skillState.availablePoints;
              recipient.sendBody(buildCaracatoaSkillStateBody({
                clientId: recipient.clientId,
                timestamp: Date.now() >>> 0,
                status: CARACATOA_SKILL_SYNC_STATUS.snapshot,
                availablePoints: skillState.availablePoints,
                learnedSkills: skillState.learned,
              }));
            }
            sendStageSnapshot(recipient, state, { status, reason });
          }
          if (Number.isInteger(result.materialSlot) && typeof getCharacterInventory === "function") {
            try {
              const inventory = await getCharacterInventory(session.accountId, session.characterSlot);
              const item = inventory.find((entry) => entry.slot === result.materialSlot) ?? null;
              for (const recipient of recipients) {
                recipient.sendBody(buildWyd727InventorySlotDeltaBody({
                  clientId: recipient.clientId,
                  slot: result.materialSlot,
                  item,
                }));
              }
            } catch {
              publish({ type: "world-stage-inventory-sync-failed" });
            }
          }
          publish({ type: "world-stage-promoted", fromStage: result.fromStage, toStage: result.toStage, level: state.level });
        } else {
          sendStageSnapshot(session, state, { status, reason });
          publish({ type: "world-stage-ritual-rejected", reason: result?.reason });
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f10) {
        const request = inspected.lengthValid === true
          ? parseCaracatoaRefinementRequest(frame.body)
          : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-refinement-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        let result;
        try {
          result = session.characterSlot !== null && refineCharacterItem
            ? await refineCharacterItem({
              accountId: session.accountId,
              characterSlot: session.characterSlot,
              inventorySlot: request.inventorySlot,
              eventId: request.requestId,
              useDivineDust: request.useDivineDust,
            })
            : { status: "rejected", reason: "storage-unavailable", slot: request.inventorySlot };
        } catch {
          publish({ type: "world-refinement-storage-failed" });
          result = { status: "rejected", reason: "storage-unavailable", slot: request.inventorySlot };
        }
        if (!result || typeof result.status !== "string") {
          result = { status: "rejected", reason: "storage-unavailable", slot: request.inventorySlot };
        }
        if (!Number.isInteger(result.slot)) result.slot = request.inventorySlot;
        session.sendBody(buildCaracatoaRefinementResultBody({
          clientId: session.clientId,
          timestamp: Date.now() >>> 0,
          result,
        }));
        if (["success", "failed", "duplicate"].includes(result.status)) {
          const recipients = sessionsForCharacter(session.accountId, session.characterSlot);
          for (const recipient of recipients) {
            for (const changed of result.inventoryChanges ?? []) {
              recipient.sendBody(buildWyd727InventorySlotDeltaBody({
                clientId: recipient.clientId,
                slot: changed.slot,
                item: changed.clientItemId === 0 ? null : {
                  clientItemId: changed.clientItemId,
                  stackCount: changed.stackCount,
                },
              }));
            }
            if (result.itemization) {
              recipient.sendBody(buildCaracatoaItemizationDetailBody({
                clientId: recipient.clientId,
                status: CARACATOA_ITEMIZATION_DETAIL_STATUS.updated,
                slot: result.slot,
                itemization: result.itemization,
              }));
            }
            if (result.equipped && Array.isArray(result.equipment)) {
              const bonuses = getWyd727EquipmentCombatBonuses(result.equipment);
              recipient.worldEquipment = result.equipment;
              recipient.worldEquipmentAttackDamageBonus = bonuses.attackDamageBonus;
              recipient.worldEquipmentMagicAttackBonus = bonuses.magicAttackBonus;
              recipient.worldEquipmentMagicAttackBps = bonuses.magicAttackBps;
              recipient.worldEquipmentDefenseBonus = bonuses.defenseBonus;
              recipient.worldEquipmentMaxHpBonus = bonuses.maxHpBonus;
              recipient.worldEquipmentMaxMpBonus = bonuses.maxMpBonus;
              recipient.worldEquipmentAbsorptionBps = bonuses.absorptionBps;
              recipient.worldEquipmentDropRateBps = bonuses.dropRateBps;
              recipient.worldEquipmentExperienceBonusBps = bonuses.experienceBonusBps;
              recipient.worldEquipmentMpCostReductionBps = bonuses.mpCostReductionBps;
              recipient.worldEquipmentCooldownReductionBps = bonuses.cooldownReductionBps;
              applyMountBonusesToSession(recipient, recipient.worldMountBonuses);
              for (let equipmentSlot = 0; equipmentSlot < CARACATOA_EQUIPMENT_SLOTS.length; equipmentSlot += 1) {
                const equipped = result.equipment.find((entry) => entry.equipmentSlot === equipmentSlot) ?? null;
                recipient.sendBody(buildCaracatoaEquipmentSyncBody({
                  clientId: recipient.clientId,
                  status: CARACATOA_EQUIPMENT_SYNC_STATUS.snapshot,
                  equipmentSlot,
                  equipment: equipped,
                  bonuses,
                }));
              }
              recipient.sendBody(buildCaracatoaAttributeSyncBody({
                clientId: recipient.clientId,
                timestamp: Date.now() >>> 0,
                status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
                availablePoints: recipient.worldAvailableAttributePoints,
                stats: {
                  str: recipient.worldStartingStats.str + recipient.worldAllocatedAttributes.str,
                  int: recipient.worldStartingStats.int + recipient.worldAllocatedAttributes.int,
                  dex: recipient.worldStartingStats.dex + recipient.worldAllocatedAttributes.dex,
                  con: recipient.worldStartingStats.con + recipient.worldAllocatedAttributes.con,
                  currentHp: recipient.worldCurrentHp,
                  maxHp: recipient.worldMaxHp,
                  currentMp: recipient.worldCurrentMp,
                  maxMp: recipient.worldMaxMp,
                  damage: recipient.worldAttackDamage,
                  defense: recipient.worldPlayerDefense,
                },
              }));
            }
          }
          publish({
            type: result.status === "success" ? "world-item-refined" : "world-item-refinement-failed",
            inventorySlot: result.slot,
            oldLevel: result.oldLevel,
            newLevel: result.newLevel,
            chanceBps: result.chanceBps,
          });
        } else {
          publish({ type: "world-item-refinement-rejected", reason: result.reason });
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x7f07) {
        const request =
          inspected.lengthValid === true
            ? parseCaracatoaEquipmentRequest(frame.body)
            : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-equipment-request-malformed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        let result = { accepted: false, reason: "equipment-disabled" };
        try {
          if (changeCharacterEquipment && session.characterSlot !== null) {
            result = await changeCharacterEquipment({
              accountId: session.accountId,
              characterSlot: session.characterSlot,
              classId: session.worldClassId,
              equipmentSlot: request.equipmentSlot,
              inventorySlot: request.inventorySlot,
            });
          }
        } catch {
          publish({ type: "world-equipment-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!result || typeof result.accepted !== "boolean") {
          publish({ type: "world-equipment-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (result.accepted) {
          if (!Array.isArray(result.equipment)) {
            publish({ type: "world-equipment-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          const bonuses = getWyd727EquipmentCombatBonuses(result.equipment);
          const recipients = sessionsForCharacter(
            session.accountId,
            session.characterSlot,
          );
          const nextCurrentHp = Math.min(
            session.worldCurrentHp,
            Math.min(0x7fffffff,
              session.worldBaseMaxHp + bonuses.maxHpBonus + (session.worldMountBonuses?.hp ?? 0)),
          );
          const nextCurrentMp = Math.min(
            session.worldCurrentMp,
            Math.min(0x7fffffff, session.worldBaseMaxMp + bonuses.maxMpBonus),
          );
          if (
            (nextCurrentHp !== session.worldCurrentHp ||
              nextCurrentMp !== session.worldCurrentMp) &&
            (typeof characterStore?.setCharacterResources !== "function" ||
              !characterStore.setCharacterResources(
                session.accountId,
                session.characterSlot,
                nextCurrentHp,
                nextCurrentMp,
              ))
          ) {
            publish({ type: "world-equipment-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          for (const recipient of recipients) {
            const previousMaxHp = recipient.worldMaxHp;
            const previousMaxMp = recipient.worldMaxMp;
            const previousCurrentHp = recipient.worldCurrentHp;
            const previousCurrentMp = recipient.worldCurrentMp;
            recipient.worldEquipment = result.equipment;
            recipient.worldEquipmentAttackDamageBonus = bonuses.attackDamageBonus;
            recipient.worldEquipmentMagicAttackBonus = bonuses.magicAttackBonus;
            recipient.worldEquipmentMagicAttackBps = bonuses.magicAttackBps;
            recipient.worldEquipmentDefenseBonus = bonuses.defenseBonus;
            recipient.worldEquipmentMaxHpBonus = bonuses.maxHpBonus;
            recipient.worldEquipmentMaxMpBonus = bonuses.maxMpBonus;
            recipient.worldEquipmentAbsorptionBps = bonuses.absorptionBps;
            recipient.worldEquipmentDropRateBps = bonuses.dropRateBps;
            recipient.worldEquipmentExperienceBonusBps = bonuses.experienceBonusBps;
            recipient.worldEquipmentMpCostReductionBps = bonuses.mpCostReductionBps;
            recipient.worldEquipmentCooldownReductionBps = bonuses.cooldownReductionBps;
            applyMountBonusesToSession(recipient, recipient.worldMountBonuses);
            const equipped = result.equipment.find(
              (item) => item.equipmentSlot === request.equipmentSlot,
            ) ?? null;
            recipient.sendBody(buildCaracatoaEquipmentSyncBody({
              clientId: recipient.clientId,
              status: recipient === session
                ? CARACATOA_EQUIPMENT_SYNC_STATUS.applied
                : CARACATOA_EQUIPMENT_SYNC_STATUS.snapshot,
              equipmentSlot: request.equipmentSlot,
              equipment: equipped,
              bonuses,
            }));
            if (
              previousMaxHp !== recipient.worldMaxHp ||
              previousMaxMp !== recipient.worldMaxMp ||
              previousCurrentHp !== recipient.worldCurrentHp ||
              previousCurrentMp !== recipient.worldCurrentMp
            ) {
              recipient.sendBody(buildCaracatoaAttributeSyncBody({
                clientId: recipient.clientId,
                timestamp: Date.now() >>> 0,
                status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
                availablePoints: recipient.worldAvailableAttributePoints,
                stats: {
                  str: recipient.worldStartingStats.str + recipient.worldAllocatedAttributes.str,
                  int: recipient.worldStartingStats.int + recipient.worldAllocatedAttributes.int,
                  dex: recipient.worldStartingStats.dex + recipient.worldAllocatedAttributes.dex,
                  con: recipient.worldStartingStats.con + recipient.worldAllocatedAttributes.con,
                  currentHp: recipient.worldCurrentHp,
                  maxHp: recipient.worldMaxHp,
                  currentMp: recipient.worldCurrentMp,
                  maxMp: recipient.worldMaxMp,
                  damage: recipient.worldAttackDamage,
                  defense: recipient.worldPlayerDefense,
                },
              }));
            }
          }
          publish({
            type: "world-equipment-changed",
            equipmentSlot: request.equipmentSlot,
            inventorySlot: request.inventorySlot === 0xff ? null : request.inventorySlot,
            clientItemId: result.equipment.find(
              (item) => item.equipmentSlot === request.equipmentSlot,
            )?.clientItemId ?? null,
            attackDamageBonus: bonuses.attackDamageBonus,
            defenseBonus: bonuses.defenseBonus,
            maxHpBonus: bonuses.maxHpBonus,
            maxMpBonus: bonuses.maxMpBonus,
          });
        } else {
          const current = session.worldEquipment.find(
            (item) => item.equipmentSlot === request.equipmentSlot,
          ) ?? null;
          session.sendBody(buildCaracatoaEquipmentSyncBody({
            clientId: session.clientId,
            status: CARACATOA_EQUIPMENT_SYNC_STATUS.rejected,
            equipmentSlot: request.equipmentSlot,
            equipment: current,
            bonuses: {
              attackDamageBonus: session.worldEquipmentAttackDamageBonus,
              defenseBonus: session.worldEquipmentDefenseBonus,
            },
          }));
          publish({
            type: "world-equipment-change-rejected",
            equipmentSlot: request.equipmentSlot,
            inventorySlot: request.inventorySlot === 0xff ? null : request.inventorySlot,
            reason: result.reason ?? "rejected",
          });
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x3a0) {
        const request =
          inspected.lengthValid === true
            ? parseWyd727KeepAliveRequest(frame.body)
            : { malformed: true };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({ type: "world-keepalive-rejected" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        publish({ type: "world-keepalive-accepted" });
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x373) {
        const request =
          inspected.lengthValid === true
            ? parseWyd727ItemUseRequest(frame.body)
            : { malformed: true, reason: "invalid-length" };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({
            type: "world-item-use-rejected",
            reason: "malformed-or-wrong-player",
          });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (request.feedMarker !== 0 || request.destinationIndex !== 0) {
          publish({
            type: "world-item-use-rejected",
            reason: "unsupported-feed-or-destination",
            inventorySlot: request.slot,
          });
          return;
        }
        if (
          !session.worldPosition ||
          request.position.x !== session.worldPosition.x ||
          request.position.y !== session.worldPosition.y
        ) {
          publish({
            type: "world-item-use-rejected",
            reason: "stale-origin",
            inventorySlot: request.slot,
          });
          return;
        }
        if (!consumeCharacterInventoryItem || session.characterSlot === null) {
          publish({
            type: "world-item-use-rejected",
            reason: "item-use-disabled",
            inventorySlot: request.slot,
          });
          return;
        }

        let result;
        try {
          result = await consumeCharacterInventoryItem({
            accountId: session.accountId,
            characterSlot: session.characterSlot,
            inventorySlot: request.slot,
          });
        } catch {
          publish({ type: "world-item-use-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (
          !result ||
          typeof result.consumed !== "boolean" ||
          !Object.hasOwn(result, "item")
        ) {
          publish({ type: "world-item-use-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (result.consumed) {
          if (
            result.useEffect?.kind !== "next-basic-attack-damage" ||
            !Number.isInteger(result.useEffect.amount) ||
            result.useEffect.amount < 1 ||
            result.useEffect.amount > 1000
          ) {
            publish({ type: "world-item-use-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          session.nextBasicAttackDamageBonus = Math.min(
            0x7fffffff,
            session.nextBasicAttackDamageBonus + result.useEffect.amount,
          );
          publish({
            type: "world-item-consumed",
            inventorySlot: request.slot,
            stackCount: result.stackCount,
            pendingAttackDamageBonus: session.nextBasicAttackDamageBonus,
          });
        } else {
          publish({
            type: "world-item-use-rejected",
            reason: result.reason ?? "item-not-usable",
            inventorySlot: request.slot,
          });
        }

        try {
          sendBody(
            buildWyd727InventorySlotDeltaBody({
              clientId: session.clientId,
              slot: request.slot,
              item: result.item,
            }),
          );
        } catch {
          publish({ type: "world-item-use-response-failed" });
          session.phase = "closed";
          socket.destroy();
        }
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x36c) {
        const request =
          inspected.lengthValid === true
            ? parseWyd727MoveRequest(frame.body)
            : { malformed: true };
        if (request.malformed || request.clientId !== session.clientId) {
          publish({
            type: "world-move-rejected",
            reason: "malformed-or-wrong-player",
          });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const current = session.worldPosition;
        const originMatches =
          current &&
          request.lastPosition.x === current.x &&
          request.lastPosition.y === current.y;
        if (!request.pathValid || !originMatches) {
          const reason = !request.pathValid
            ? request.invalidReason
            : "stale-origin";
          publish({ type: "world-move-corrected", reason });
          sendBody(
            buildWyd727MoveResponseBody({
              clientId: session.clientId,
              timestamp: Date.now() >>> 0,
              lastPosition: current,
              destiny: current,
              moveType: 0,
              speedMove: session.worldSpeed,
            }),
          );
          return;
        }

        let routePosition = current;
        let blockedStepIndex = -1;
        let blockedStepReason = null;
        let blockedMonsterEntityId = null;
        try {
          for (
            let stepIndex = 0;
            stepIndex < request.directionCodes.length;
            stepIndex++
          ) {
            const delta =
              WYD727_DIRECTION_DELTAS[request.directionCodes[stepIndex]];
            if (!delta) {
              blockedStepIndex = stepIndex;
              break;
            }
            const nextStep = {
              x: routePosition.x + delta.x,
              y: routePosition.y + delta.y,
            };
            if (isPlayablePosition && !isPlayablePosition(nextStep.x, nextStep.y)) {
              blockedStepIndex = stepIndex;
              blockedStepReason = "map-boundary";
              break;
            }
            const occupyingMonster = session.worldMonsters.find(
              (monster) =>
                monster.currentHp > 0 &&
                monster.position.x === nextStep.x &&
                monster.position.y === nextStep.y,
            );
            if (occupyingMonster) {
              blockedStepIndex = stepIndex;
              blockedStepReason = "occupied-monster";
              blockedMonsterEntityId = occupyingMonster.clientEntityId;
              break;
            }
            if (
              !walkability.canStep(
                routePosition.x,
                routePosition.y,
                nextStep.x,
                nextStep.y,
              )
            ) {
              blockedStepIndex = stepIndex;
              blockedStepReason = "blocked-terrain";
              break;
            }
            routePosition = nextStep;
          }
        } catch {
          publish({ type: "world-move-terrain-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (blockedStepIndex !== -1) {
          publish({
            type: "world-move-corrected",
            reason: blockedStepReason ?? "blocked-terrain",
            stepIndex: blockedStepIndex,
            ...(blockedMonsterEntityId !== null
              ? { monsterEntityId: blockedMonsterEntityId }
              : {}),
          });
          sendBody(
            buildWyd727MoveResponseBody({
              clientId: session.clientId,
              timestamp: Date.now() >>> 0,
              lastPosition: current,
              destiny: current,
              moveType: 0,
              speedMove: session.worldSpeed,
            }),
          );
          return;
        }

        const nextPosition = request.replayedDestiny;
        let positionSaved;
        try {
          positionSaved =
            characterStore?.saveCharacterPosition?.(
              session.accountId,
              session.characterSlot,
              current,
              nextPosition,
            ) === true;
        } catch {
          publish({ type: "world-move-storage-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (!positionSaved) {
          let latestCharacter;
          try {
            latestCharacter =
              characterStore?.getCharacterBySlot?.(
                session.accountId,
                session.characterSlot,
              ) ?? null;
          } catch {
            publish({ type: "world-move-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          const latestPosition = latestCharacter && {
            x: latestCharacter.worldX,
            y: latestCharacter.worldY,
          };
          if (
            !latestPosition ||
            !Number.isInteger(latestPosition.x) ||
            latestPosition.x < -0x8000 ||
            latestPosition.x > 0x7fff ||
            !Number.isInteger(latestPosition.y) ||
            latestPosition.y < -0x8000 ||
            latestPosition.y > 0x7fff
          ) {
            publish({ type: "world-move-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          session.worldPosition = latestPosition;
          publish({
            type: "world-move-corrected",
            reason: "concurrent-position-change",
            position: latestPosition,
          });
          sendBody(
            buildWyd727MoveResponseBody({
              clientId: session.clientId,
              timestamp: Date.now() >>> 0,
              lastPosition: latestPosition,
              destiny: latestPosition,
              moveType: 0,
              speedMove: session.worldSpeed,
            }),
          );
          cancelTradeIfOutOfRange(session);
          return;
        }

        const response = buildWyd727MoveResponseBody({
          clientId: session.clientId,
          timestamp: Date.now() >>> 0,
          lastPosition: current,
          destiny: nextPosition,
          moveType: 0,
          speedMove: session.worldSpeed,
          directionCodes: request.directionCodes,
        });
        session.worldPosition = nextPosition;
        publish({
          type: "world-move-accepted",
          from: current,
          to: nextPosition,
          steps: request.directionCodes.length,
        });
        sendBody(response);
        cancelTradeIfOutOfRange(session);
        return;
      }

      if (session.phase === "in-world" && inspected.opcode === 0x39d) {
        const skillCast = frame.body?.[42] === 0xff;
        const request =
          inspected.lengthValid === true
            ? skillCast
              ? parseWyd727SingleTargetSkillAttackRequest(frame.body)
              : parseWyd727BasicAttackRequest(frame.body)
            : { malformed: true, reason: "invalid-length" };
        if (
          request.malformed ||
          request.clientId !== session.clientId ||
          request.sourceMobIndex !== session.clientId
        ) {
          publish({
            type: "world-attack-rejected",
            reason: "malformed-or-wrong-player",
          });
          session.phase = "closed";
          socket.destroy();
          return;
        }

        const skill = skillCast
          ? session.worldSkills.get(request.skillId)
          : null;
        if (skillCast && !skill) {
          publish({
            type: "world-skill-rejected",
            reason: "skill-not-learned",
            skillId: request.skillId,
          });
          return;
        }

        const currentTime = now();
        if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
          publish({ type: "world-attack-rejected", reason: "clock-failed" });
          session.phase = "closed";
          socket.destroy();
          return;
        }
        const skillCooldownMs = skill
          ? computeCaracatoaSkillCooldownMs(
              skill.properties.cooldownMs,
              session.worldEquipmentCooldownReductionBps,
            )
          : 0;
        if (
          !session.worldPosition ||
          request.sourcePosition.x !== session.worldPosition.x ||
          request.sourcePosition.y !== session.worldPosition.y
        ) {
          publish({
            type: "world-attack-rejected",
            reason: "stale-origin",
          });
          return;
        }

        if (skill?.properties.effectType === "heal") {
          const isSelfTarget =
            request.targetMobIndex === session.clientId &&
            request.targetPosition.x === session.worldPosition.x &&
            request.targetPosition.y === session.worldPosition.y;
          if (!isSelfTarget) {
            publish({
              type: "world-skill-rejected",
              reason: "heal-requires-self-target",
              skillId: request.skillId,
            });
            return;
          }
          if (
            currentTime < (session.worldSkillCooldowns.get(request.skillId) ?? 0)
          ) {
            publish({
              type: "world-skill-rejected",
              reason: "skill-cooldown",
              clientId: session.clientId,
              skillId: request.skillId,
            });
            return;
          }
          if (typeof characterStore?.applyCharacterHealAndSpendMana !== "function") {
            publish({
              type: "world-skill-rejected",
              reason: "heal-storage-unavailable",
              skillId: request.skillId,
            });
            return;
          }

          const scalingBonus =
            session.worldAllocatedAttributes[
              skill.properties.scalingAttribute ?? "int"
            ] ?? 0;
          const healingAmount = Math.min(
            0x7fffffff,
            skill.properties.healAmount + scalingBonus,
          );
          let healResult;
          try {
            healResult = characterStore.applyCharacterHealAndSpendMana(
              session.accountId,
              session.characterSlot,
              {
                healingAmount,
                maxHp: session.worldMaxHp,
                manaCost: computeCaracatoaSkillManaCost(
                  skill.properties.manaCost,
                  session.worldEquipmentMpCostReductionBps,
                ),
              },
            );
          } catch {
            publish({ type: "world-player-heal-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          if (!healResult) {
            publish({ type: "world-player-health-unavailable" });
            session.phase = "closed";
            socket.destroy();
            return;
          }

          const effectStatus = {
            healed: CARACATOA_SKILL_EFFECT_STATUS.applied,
            "full-health": CARACATOA_SKILL_EFFECT_STATUS.fullHealth,
            "insufficient-mana": CARACATOA_SKILL_EFFECT_STATUS.insufficientMana,
            dead: CARACATOA_SKILL_EFFECT_STATUS.dead,
          }[healResult.status];
          if (effectStatus === undefined) {
            publish({ type: "world-player-heal-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          if (healResult.status !== "healed") {
            publish({
              type: "world-skill-rejected",
              reason: healResult.status,
              clientId: session.clientId,
              skillId: request.skillId,
            });
            try {
              sendBody(
                buildCaracatoaSkillEffectResultBody({
                  clientId: session.clientId,
                  timestamp: currentTime >>> 0,
                  status: effectStatus,
                  clientSkillId: request.skillId,
                  effectType: CARACATOA_SKILL_EFFECT_TYPE.heal,
                  currentHp: healResult.currentHp,
                  maxHp: session.worldMaxHp,
                  currentMp: healResult.currentMp,
                }),
              );
            } catch {
              publish({ type: "world-player-heal-sync-failed" });
            }
            return;
          }

          session.worldSkillCooldowns.set(
            request.skillId,
            currentTime + skillCooldownMs,
          );
          const characterSessions = sessionsForCharacter(
            session.accountId,
            session.characterSlot,
          );
          for (const recipient of characterSessions) {
            recipient.worldCurrentHp = healResult.currentHp;
            recipient.worldCurrentMp = healResult.currentMp;
            try {
              recipient.sendBody(
                buildWyd727PlayerHpMpSyncBody({
                  clientId: recipient.clientId,
                  timestamp: currentTime >>> 0,
                  currentHp: healResult.currentHp,
                  currentMp: healResult.currentMp,
                }),
              );
            } catch {
              publish({
                type: "world-player-health-sync-failed",
                clientId: recipient.clientId,
                source: "skill-heal",
              });
            }
          }
          publish({
            type: "world-skill-mana-spent",
            skillId: request.skillId,
            manaSpent: healResult.spent,
            currentMp: healResult.currentMp,
          });
          publish({
            type: "world-skill-cast",
            skillId: request.skillId,
            targetMobIndex: session.clientId,
          });
          publish({
            type: "world-skill-heal-applied",
            skillId: request.skillId,
            clientId: session.clientId,
            healed: healResult.healed,
            currentHp: healResult.currentHp,
            maxHp: session.worldMaxHp,
          });
          try {
            sendBody(
              buildCaracatoaSkillEffectResultBody({
                clientId: session.clientId,
                timestamp: currentTime >>> 0,
                status: effectStatus,
                clientSkillId: request.skillId,
                effectType: CARACATOA_SKILL_EFFECT_TYPE.heal,
                amount: healResult.healed,
                currentHp: healResult.currentHp,
                maxHp: session.worldMaxHp,
                currentMp: healResult.currentMp,
              }),
            );
          } catch {
            publish({ type: "world-player-heal-sync-failed" });
          }
          return;
        }

        if (skill?.properties.effectType === "defense") {
          const isSelfTarget =
            request.targetMobIndex === session.clientId &&
            request.targetPosition.x === session.worldPosition.x &&
            request.targetPosition.y === session.worldPosition.y;
          if (!isSelfTarget) {
            publish({
              type: "world-skill-rejected",
              reason: "defense-requires-self-target",
              skillId: request.skillId,
            });
            return;
          }
          if (session.worldCurrentHp <= 0) {
            publish({ type: "world-skill-rejected", reason: "dead", skillId: request.skillId });
            sendBody(buildCaracatoaSkillEffectResultBody({
              clientId: session.clientId,
              timestamp: currentTime >>> 0,
              status: CARACATOA_SKILL_EFFECT_STATUS.dead,
              clientSkillId: request.skillId,
              effectType: CARACATOA_SKILL_EFFECT_TYPE.defense,
              currentHp: session.worldCurrentHp,
              maxHp: session.worldMaxHp,
              currentMp: session.worldCurrentMp,
            }));
            return;
          }
          if (currentTime < (session.worldSkillCooldowns.get(request.skillId) ?? 0)) {
            publish({
              type: "world-skill-rejected",
              reason: "skill-cooldown",
              clientId: session.clientId,
              skillId: request.skillId,
            });
            return;
          }
          if (typeof characterStore?.spendCharacterMana !== "function") {
            publish({ type: "world-skill-rejected", reason: "mana-storage-unavailable", skillId: request.skillId });
            return;
          }
          const conBonus = session.worldAllocatedAttributes.con ?? 0;
          const defenseBonus = Math.min(
            0x7fffffff,
            skill.properties.defenseBonus + conBonus,
          );
          const durationMs = skill.properties.durationMs;
          const expiresAt = currentTime + durationMs;
          if (!Number.isSafeInteger(expiresAt)) {
            publish({ type: "world-skill-rejected", reason: "invalid-buff-expiry", skillId: request.skillId });
            return;
          }
          let manaSpend;
          try {
            manaSpend = characterStore.spendCharacterMana(
              session.accountId,
              session.characterSlot,
              computeCaracatoaSkillManaCost(
                skill.properties.manaCost,
                session.worldEquipmentMpCostReductionBps,
              ),
            );
          } catch {
            publish({ type: "world-player-mana-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          if (!manaSpend) {
            publish({
              type: "world-skill-rejected",
              reason: "insufficient-mana",
              clientId: session.clientId,
              skillId: request.skillId,
            });
            sendBody(buildCaracatoaSkillEffectResultBody({
              clientId: session.clientId,
              timestamp: currentTime >>> 0,
              status: CARACATOA_SKILL_EFFECT_STATUS.insufficientMana,
              clientSkillId: request.skillId,
              effectType: CARACATOA_SKILL_EFFECT_TYPE.defense,
              currentHp: session.worldCurrentHp,
              maxHp: session.worldMaxHp,
              currentMp: session.worldCurrentMp,
            }));
            return;
          }

          const buffKey = skillCooldownKey(session.accountId, session.characterSlot);
          const defenseBuff = {
            amount: defenseBonus,
            expiresAt,
            skillId: request.skillId,
          };
          defenseBuff.expirationTimer = setTimeout(() => {
            if (characterDefenseBuffs.get(buffKey) === defenseBuff) {
              characterDefenseBuffs.delete(buffKey);
            }
          }, durationMs);
          defenseBuff.expirationTimer.unref?.();
          characterDefenseBuffs.set(buffKey, defenseBuff);
          session.worldSkillCooldowns.set(request.skillId, expiresAt + Math.max(0, skillCooldownMs - durationMs));
          const characterSessions = sessionsForCharacter(session.accountId, session.characterSlot);
          for (const recipient of characterSessions) {
            recipient.worldCurrentMp = manaSpend.currentMp;
            recipient.sendBody(buildWyd727PlayerHpMpSyncBody({
              clientId: recipient.clientId,
              timestamp: currentTime >>> 0,
              currentHp: recipient.worldCurrentHp,
              currentMp: manaSpend.currentMp,
            }));
          }
          publish({
            type: "world-skill-mana-spent",
            skillId: request.skillId,
            manaSpent: manaSpend.spent,
            currentMp: manaSpend.currentMp,
          });
          publish({
            type: "world-skill-cast",
            skillId: request.skillId,
            targetMobIndex: session.clientId,
          });
          publish({
            type: "world-skill-defense-applied",
            skillId: request.skillId,
            clientId: session.clientId,
            defenseBonus,
            durationMs,
            expiresAt,
          });
          sendBody(buildCaracatoaSkillEffectResultBody({
            clientId: session.clientId,
            timestamp: currentTime >>> 0,
            status: CARACATOA_SKILL_EFFECT_STATUS.applied,
            clientSkillId: request.skillId,
            effectType: CARACATOA_SKILL_EFFECT_TYPE.defense,
            amount: defenseBonus,
            durationMs,
            currentHp: session.worldCurrentHp,
            maxHp: session.worldMaxHp,
            currentMp: manaSpend.currentMp,
          }));
          return;
        }

        const target = session.worldMonsters.find(
          (monster) => monster.clientEntityId === request.targetMobIndex,
        );
        if (!target || target.currentHp <= 0) {
          publish({
            type: "world-attack-rejected",
            reason: "target-not-alive",
            targetMobIndex: request.targetMobIndex,
          });
          return;
        }
        if (
          request.targetPosition.x !== target.position.x ||
          request.targetPosition.y !== target.position.y
        ) {
          publish({
            type: "world-attack-rejected",
            reason: "target-position-mismatch",
            targetMobIndex: target.clientEntityId,
          });
          return;
        }
        const targetInRange = skill
          ? isCaracatoaSkillTargetInRange(
              session.worldPosition,
              target.position,
              skill.properties.rangeTiles,
            )
          : isWyd727BasicAttackInRange(session.worldPosition, target.position);
        if (!targetInRange) {
          publish({
            type: "world-attack-rejected",
            reason: "out-of-range",
            targetMobIndex: target.clientEntityId,
          });
          return;
        }
        if (
          session.lastBasicAttackAt !== null &&
          currentTime - session.lastBasicAttackAt <
            CARACATOA_BASIC_ATTACK_COOLDOWN_MS
        ) {
          publish({
            type: "world-attack-rejected",
            reason: "cooldown",
            targetMobIndex: target.clientEntityId,
          });
          return;
        }
        if (
          skill &&
          currentTime < (session.worldSkillCooldowns.get(request.skillId) ?? 0)
        ) {
          publish({
            type: "world-skill-rejected",
            reason: "skill-cooldown",
            clientId: session.clientId,
            skillId: request.skillId,
            targetMobIndex: target.clientEntityId,
          });
          return;
        }

        let manaSpend = null;
        if (skill) {
          if (
            typeof characterStore?.spendCharacterMana !== "function" ||
            typeof characterStore?.refundCharacterMana !== "function"
          ) {
            publish({
              type: "world-skill-rejected",
              reason: "mana-storage-unavailable",
              skillId: request.skillId,
            });
            return;
          }
          try {
            manaSpend = characterStore.spendCharacterMana(
              session.accountId,
              session.characterSlot,
              computeCaracatoaSkillManaCost(
                skill.properties.manaCost,
                session.worldEquipmentMpCostReductionBps,
              ),
            );
          } catch {
            publish({ type: "world-player-mana-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          if (!manaSpend) {
            publish({
              type: "world-skill-rejected",
              reason: "insufficient-mana",
              skillId: request.skillId,
            });
            return;
          }
        }

        const refundManaIfNeeded = () => {
          if (!skill || !manaSpend) return true;
          try {
            const refunded = characterStore.refundCharacterMana(
              session.accountId,
              session.characterSlot,
              manaSpend.spent,
              session.worldMaxMp,
            );
            if (!refunded) return false;
            for (const recipient of sessionsForCharacter(
              session.accountId,
              session.characterSlot,
            )) {
              recipient.worldCurrentMp = refunded.currentMp;
            }
            return true;
          } catch {
            return false;
          }
        };

        let damageResult;
        let magicSkill = false;
        try {
          magicSkill = skill?.properties.effectType === "damage" &&
            skill.properties.scalingAttribute === "int";
          const attackPower = Math.min(
            0x7fffffff,
            session.worldAttackDamage + session.nextBasicAttackDamageBonus,
          );
          const computedDamage = skill
            ? computeCaracatoaDamage({
                attackPower: magicSkill
                  ? computeCaracatoaMagicAttackPower({
                      baseAttack: Math.max(
                        0,
                        session.worldBaseDamage - session.worldAllocatedAttributes.str,
                      ),
                      intelligenceBonus: session.worldAllocatedAttributes.int,
                      equipmentMagicAttack: session.worldEquipmentMagicAttackBonus,
                      mountMagicAttack: session.worldMountBonuses.magicAttack,
                      magicAttackBps: session.worldEquipmentMagicAttackBps,
                    })
                  : Math.max(0, attackPower - session.worldAllocatedAttributes.str),
                defense: target.defense,
                skillBonus: skill.properties.damageBonus,
                attributeBonus: magicSkill ? 0 :
                  session.worldAllocatedAttributes[
                    skill.properties.scalingAttribute ?? "int"
                  ] ?? 0,
              })
            : computeCaracatoaBasicAttackDamage(attackPower, target.defense);
          if (worldMonsterStore) {
            damageResult = worldMonsterStore.applyDamage(
              target,
              computedDamage,
              currentTime,
              monsterRespawnMs,
            );
          } else {
            const damage = Math.min(target.currentHp, computedDamage);
            const currentHp = target.currentHp - damage;
            damageResult = {
              ...target,
              currentHp,
              respawnAt: currentHp === 0 ? currentTime + monsterRespawnMs : 0,
              damage,
              died: currentHp === 0,
            };
          }
        } catch {
          const manaRefunded = refundManaIfNeeded();
          publish({ type: "world-monster-state-storage-failed" });
          if (!manaRefunded) {
            publish({ type: "world-player-mana-storage-failed" });
          }
          session.phase = "closed";
          socket.destroy();
          return;
        }
        if (damageResult.damage === 0) {
          const manaRefunded = refundManaIfNeeded();
          if (!manaRefunded) {
            publish({ type: "world-player-mana-storage-failed" });
            session.phase = "closed";
            socket.destroy();
            return;
          }
          publish({
            type: "world-attack-rejected",
            reason: "target-not-alive",
            targetMobIndex: target.clientEntityId,
          });
          return;
        }
        // `damageResult.damage` is the damage dealt by this player hit. Keep
        // it separate from `target.damage`, which is the monster's attack
        // stat used by the retaliation that follows.
        const { damage: dealtDamage, ...updatedMonsterState } = damageResult;
        Object.assign(target, updatedMonsterState);
        scheduleNextMonsterRespawn();
        session.lastBasicAttackAt = currentTime;
        if (skill) {
          session.worldSkillCooldowns.set(
            request.skillId,
            currentTime + skillCooldownMs,
          );
          const characterSessions = sessionsForCharacter(
            session.accountId,
            session.characterSlot,
          );
          if (manaSpend.spent > 0) {
            for (const recipient of characterSessions) {
              recipient.worldCurrentMp = manaSpend.currentMp;
              recipient.sendBody(
                buildWyd727PlayerHpMpSyncBody({
                  clientId: recipient.clientId,
                  timestamp: currentTime >>> 0,
                  currentHp: recipient.worldCurrentHp,
                  currentMp: manaSpend.currentMp,
                }),
              );
            }
            publish({
              type: "world-skill-mana-spent",
              skillId: request.skillId,
              manaSpent: manaSpend.spent,
              currentMp: manaSpend.currentMp,
            });
          }
          publish({
            type: "world-skill-cast",
            skillId: request.skillId,
            targetMobIndex: target.clientEntityId,
          });
        }
        if (!magicSkill && session.nextBasicAttackDamageBonus > 0) {
          publish({
            type: "world-item-effect-applied",
            pendingAttackDamageBonus: session.nextBasicAttackDamageBonus,
            monsterEntityId: target.clientEntityId,
          });
          session.nextBasicAttackDamageBonus = 0;
        }
        publish({
          type: "world-monster-damaged",
          monsterEntityId: target.clientEntityId,
          damage: dealtDamage,
          currentHp: target.currentHp,
          maxHp: target.maxHp,
          skillId: skill?.properties.clientSkillId ?? 0,
        });
        const recipients = sessionsSeeingMonster(target);
        for (const recipient of recipients) {
          recipient.sendBody(
            buildWyd727BasicAttackResultBody({
              clientId: session.clientId,
              timestamp: currentTime >>> 0,
              targetMobIndex: target.clientEntityId,
              damage: dealtDamage,
              skillCode: skill?.properties.clientSkillId ?? 0,
            }),
          );
        }

        if (target.currentHp > 0) {
          const effectiveDefense = getEffectiveWorldDefense(session, currentTime);
          const retaliationDamage = applyDamageAbsorption(
            session,
            computeCaracatoaMonsterCounterattackDamage(target.damage, effectiveDefense),
          );
          if (
            retaliationDamage > 0 &&
            typeof characterStore?.applyCharacterDamage === "function"
          ) {
            let playerDamage;
            try {
              playerDamage = characterStore.applyCharacterDamage(
                session.accountId,
                session.characterSlot,
                retaliationDamage,
              );
            } catch {
              publish({ type: "world-player-health-storage-failed" });
              session.phase = "closed";
              socket.destroy();
              return;
            }
            if (!playerDamage) {
              publish({ type: "world-player-health-unavailable" });
              session.phase = "closed";
              socket.destroy();
              return;
            }
            const characterSessions = sessionsForCharacter(
              session.accountId,
              session.characterSlot,
            );
            for (const recipient of characterSessions) {
              recipient.worldCurrentHp = playerDamage.currentHp;
              recipient.sendBody(
                buildWyd727PlayerHpMpSyncBody({
                  clientId: recipient.clientId,
                  timestamp: currentTime >>> 0,
                  currentHp: playerDamage.currentHp,
                  currentMp: recipient.worldCurrentMp,
                }),
              );
              if (playerDamage.currentHp === 0) {
                recipient.sendBody(
                  buildWyd727MonsterDeathBody({
                    clientId: recipient.clientId,
                    timestamp: currentTime >>> 0,
                    killed: recipient.clientId,
                    killer: target.clientEntityId,
                  }),
                );
              }
            }
            publish({
              type:
                playerDamage.currentHp === 0
                  ? "world-player-defeated"
                  : "world-player-damaged",
              source: "player-retaliation",
              clientId: session.clientId,
              monsterEntityId: target.clientEntityId,
              damage: playerDamage.damage,
              currentHp: playerDamage.currentHp,
              baseDefense: session.worldPlayerDefense,
              effectiveDefense,
            });
            if (playerDamage.currentHp === 0) {
              for (const recipient of characterSessions) {
                recipient.phase = "closed";
                sessionSockets.get(recipient)?.end();
              }
            }
          }
        }

        if (target.currentHp === 0) {
          let experienceGained = 0;
          let progressionAward = null;
          if (typeof characterStore?.awardCharacterExperience === "function") {
            const baseExperience = computeCaracatoaMonsterExperienceReward(
              target.level,
            );
            const requestedExperience = computeCaracatoaRewardWithEquipmentBonus(
              baseExperience,
              session.worldEquipmentExperienceBonusBps ?? 0,
            );
            try {
              const award = characterStore.awardCharacterExperience(
                session.accountId,
                session.characterSlot,
                requestedExperience,
              );
              if (
                Number.isSafeInteger(award?.gained) &&
                award.gained > 0 &&
                award.gained <= requestedExperience &&
                Number.isSafeInteger(award.experience)
              ) {
                experienceGained = award.gained;
                progressionAward = award;
                publish({
                  type: "world-monster-experience-awarded",
                  monsterEntityId: target.clientEntityId,
                  killerClientId: session.clientId,
                  experienceGained,
                  baseExperience,
                  experienceBonusBps: session.worldEquipmentExperienceBonusBps ?? 0,
                  totalExperience: award.experience,
                  level: award.level,
                  levelsGained: award.levelsGained,
                });
              } else {
                publish({
                  type: "world-monster-reward-storage-failed",
                  monsterEntityId: target.clientEntityId,
                });
              }
            } catch {
              publish({
                type: "world-monster-reward-storage-failed",
                monsterEntityId: target.clientEntityId,
              });
            }
          }
          if (awardMonsterLoot && session.characterSlot !== null) {
            try {
              const loot = await awardMonsterLoot({
                accountId: session.accountId,
                characterSlot: session.characterSlot,
                monsterEntityId: target.clientEntityId,
                lootEventId: `m${target.clientEntityId}:d${target.respawnAt}`,
                playerLuckBonusBps: session.worldEquipmentDropRateBps ?? 0,
              });
              if (loot?.awarded === true && Array.isArray(loot.slots)) {
                const changedSlots = loot.slots.map((slotItem) => {
                  const { slot, ...item } = slotItem;
                  return { slot, item };
                });
                const characterSessions = sessionsForCharacter(
                  session.accountId,
                  session.characterSlot,
                );
                for (const recipient of characterSessions) {
                  for (const { slot, item } of changedSlots) {
                    recipient.sendBody(
                      buildWyd727InventorySlotDeltaBody({
                        clientId: recipient.clientId,
                        slot,
                        item,
                      }),
                    );
                    if (item.itemization) {
                      recipient.sendBody(buildCaracatoaItemizationDetailBody({
                        clientId: recipient.clientId,
                        status: CARACATOA_ITEMIZATION_DETAIL_STATUS.updated,
                        slot,
                        itemization: item.itemization,
                      }));
                    }
                  }
                }
                publish({
                  type: "world-monster-loot-awarded",
                  monsterEntityId: target.clientEntityId,
                  killerClientId: session.clientId,
                  catalogItemId: loot.catalogItemId,
                  quantity: loot.quantity,
                  inventorySlots: changedSlots.map(({ slot }) => slot),
                });
              } else if (loot?.reason === "inventory-full") {
                publish({
                  type: "world-monster-loot-inventory-full",
                  monsterEntityId: target.clientEntityId,
                  killerClientId: session.clientId,
                });
              }
            } catch {
              publish({
                type: "world-monster-loot-storage-failed",
                monsterEntityId: target.clientEntityId,
                killerClientId: session.clientId,
              });
            }
          }
          publish({
            type: "world-monster-killed",
            monsterEntityId: target.clientEntityId,
            killerClientId: session.clientId,
            respawnAt: target.respawnAt,
            experienceGained,
          });
          for (const recipient of recipients) {
            recipient.sendBody(
              buildWyd727MonsterDeathBody({
                clientId: session.clientId,
                timestamp: currentTime >>> 0,
                killed: target.clientEntityId,
                killer: session.clientId,
                experienceGained: recipient === session ? experienceGained : 0,
              }),
            );
          }
          if (
            progressionAward &&
            Number.isInteger(progressionAward.level) &&
            Number.isInteger(progressionAward.levelsGained) &&
            session.characterSlot !== null
          ) {
            for (const recipient of sessionsForCharacter(
              session.accountId,
              session.characterSlot,
            )) {
              const gainedLevels = Math.max(
                0,
                progressionAward.level - recipient.worldLevel,
              );
              if (gainedLevels > 0) {
                recipient.worldLevel = progressionAward.level;
                recipient.worldBaseMaxHp = Math.min(
                  0x7fffffff,
                  recipient.worldBaseMaxHp + gainedLevels * CARACATOA_HP_PER_LEVEL,
                );
                recipient.worldBaseMaxMp = Math.min(
                  0x7fffffff,
                  recipient.worldBaseMaxMp + gainedLevels * CARACATOA_MP_PER_LEVEL,
                );
                recipient.worldBaseDamage = Math.min(
                  0x7fffffff,
                  recipient.worldBaseDamage +
                    gainedLevels * CARACATOA_DAMAGE_PER_LEVEL,
                );
                applyMountBonusesToSession(recipient, recipient.worldMountBonuses);
              }
              recipient.sendBody(
                buildCaracatoaProgressionSyncBody({
                  clientId: recipient.clientId,
                  timestamp: currentTime >>> 0,
                  level: progressionAward.level,
                  experience: progressionAward.experience,
                  currentHp: recipient.worldCurrentHp,
                  maxHp: recipient.worldMaxHp,
                  currentMp: recipient.worldCurrentMp,
                  maxMp: recipient.worldMaxMp,
                  damage: recipient.worldAttackDamage,
                }),
              );
              const attributes =
                characterStore?.getCharacterAttributes?.(
                  session.accountId,
                  session.characterSlot,
                ) ?? {
                  availablePoints: recipient.worldAvailableAttributePoints,
                  allocated: recipient.worldAllocatedAttributes,
                };
              recipient.worldAvailableAttributePoints = attributes.availablePoints;
              recipient.sendBody(
                buildCaracatoaAttributeSyncBody({
                  clientId: recipient.clientId,
                  timestamp: currentTime >>> 0,
                  status: CARACATOA_ATTRIBUTE_SYNC_STATUS.snapshot,
                  availablePoints: attributes.availablePoints,
                  stats: {
                    str: recipient.worldStartingStats.str + attributes.allocated.str,
                    int: recipient.worldStartingStats.int + attributes.allocated.int,
                    dex: recipient.worldStartingStats.dex + attributes.allocated.dex,
                    con: recipient.worldStartingStats.con + attributes.allocated.con,
                    currentHp: recipient.worldCurrentHp,
                    maxHp: recipient.worldMaxHp,
                    currentMp: recipient.worldCurrentMp,
                    maxMp: recipient.worldMaxMp,
                    damage: recipient.worldAttackDamage,
                    defense: recipient.worldPlayerDefense,
                  },
                }),
              );
              if (gainedLevels > 0) {
                const skillState =
                  characterStore?.getCharacterSkillState?.(
                    session.accountId,
                    session.characterSlot,
                  ) ?? {
                    availablePoints: recipient.worldAvailableSkillPoints,
                    learned: [],
                  };
                if (!Array.isArray(skillState.learned)) {
                  publish({ type: "world-skill-state-storage-failed" });
                  recipient.phase = "closed";
                  sessionSockets.get(recipient)?.destroy();
                  continue;
                }
                recipient.worldAvailableSkillPoints = skillState.availablePoints;
                const learnedCatalogIds = new Set(
                  skillState.learned.map((known) => known.catalogSkillId),
                );
                const learnedEntries = [
                  ...recipient.worldSkillCatalog.values(),
                ].filter((entry) => learnedCatalogIds.has(entry.id));
                recipient.worldSkills = new Map(
                  learnedEntries.map((entry) => [
                    entry.properties.clientSkillId,
                    entry,
                  ]),
                );
                recipient.sendBody(
                  buildCaracatoaSkillStateBody({
                    clientId: recipient.clientId,
                    timestamp: currentTime >>> 0,
                    status: CARACATOA_SKILL_SYNC_STATUS.snapshot,
                    availablePoints: skillState.availablePoints,
                    learnedSkills: learnedEntries,
                  }),
                );
              }
            }
          }
        }
        return;
      }

      if (session.phase === "in-world") {
        publish({ type: "world-command-disabled", opcode: inspected.opcode });
      } else {
        publish({ type: "session-request-disabled", opcode: inspected.opcode });
      }
      session.phase = "closed";
      socket.end();
    };

    socket.on("data", (chunk) => {
      const result = decoder.feed(chunk);
      if (result.handshakeCompleted) publish({ type: "handshake" });
      for (const frame of result.frames) {
        const inspected = inspectWyd727ClientFrame(frame.body);
        publish({
          type: "frame",
          sequence: frame.sequence,
          bodyLength: frame.body.length,
        });
        publish({
          type: "packet",
          sequence: frame.sequence,
          ...inspected,
        });
        if (authEnabled) {
          session.packetQueue = session.packetQueue
            .then(() => handleAuthenticatedFrame(frame, inspected))
            .catch(closeForSessionError);
        }
      }
      if (result.error) {
        protocolFailed = true;
        publish({ type: "protocol-error", message: result.error });
        socket.destroy();
      }
    });

    socket.on("end", () => {
      if (protocolFailed) return;
      const error = decoder.finish();
      if (error) publish({ type: "protocol-error", message: error });
    });

    socket.on("error", (error) => {
      publish({
        type: "socket-error",
        code: typeof error.code === "string" ? error.code : "unknown",
      });
    });

    socket.on("close", (hadError) => {
      clients.delete(socket);
      sessionsBySocket.delete(socket);
      const disconnectedTrade = tradeBySession.get(session);
      if (disconnectedTrade && activeTrades.get(disconnectedTrade.id) === disconnectedTrade) {
        clearTrade(disconnectedTrade, "cancelled", "A negociação foi encerrada porque uma personagem desconectou.");
        publish({ type: "world-trade-disconnected" });
      }
      worldSessions.delete(session);
      if (session.characterSlot !== null &&
          sessionsForCharacter(session.accountId, session.characterSlot).length === 0 &&
          typeof characterStore?.listCharacterMounts === "function" &&
          typeof characterStore?.stopCharacterMountRide === "function") {
        try {
          const riding = characterStore.listCharacterMounts(
            session.accountId,
            session.characterSlot,
          ).find((mount) => mount.riding);
          if (riding) {
            const stoppedAt = now();
            if (Number.isSafeInteger(stoppedAt) && stoppedAt >= 0) {
              const stopped = characterStore.stopCharacterMountRide(session.accountId, {
                characterSlot: session.characterSlot,
                mountId: riding.id,
                nowMs: stoppedAt,
              });
              publish({
                type: stopped.stage === "dead" ? "world-mount-life-exhausted" : "world-mount-session-ended",
                characterSlot: session.characterSlot,
                speciesId: stopped.speciesId,
                hunger: stopped.hunger,
                vitality: stopped.vitality,
                stage: stopped.stage,
              });
            }
          }
        } catch {
          publish({ type: "world-mount-session-close-failed" });
        }
      }
      if (worldSessions.size === 0 && monsterAiTimer !== null) {
        clearTimeout(monsterAiTimer);
        monsterAiTimer = null;
      }
      if (worldSessions.size === 0 && mountTickTimer !== null) {
        clearTimeout(mountTickTimer);
        mountTickTimer = null;
      }
      authenticatedSessions.delete(session);
      publish({ type: "connection-close", hadError });
    });
  });

  server.on("error", (error) => {
    publish({
      type: "listener-error",
      code: typeof error.code === "string" ? error.code : "unknown",
    });
  });
  Object.defineProperties(server, {
    listWorldMonsters: { value: listWorldMonsters },
    moderateMonster: { value: moderateMonster },
    listOnlinePlayers: { value: listOnlinePlayers },
    disconnectPlayerAccount: { value: disconnectPlayerAccount },
    shutdown: {
      value: (timeoutMs = 5000) => {
        if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
          return Promise.reject(
            new RangeError("shutdown timeout deve ficar entre 0 e 60000 ms."),
          );
        }
        if (shutdownPromise) return shutdownPromise;

        shutdownPromise = (async () => {
          const acceptingConnections = server.listening
            ? new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
              })
            : Promise.resolve();
          const sockets = [...clients];
          const sessions = sockets
            .map((socket) => sessionsBySocket.get(socket))
            .filter(Boolean);

          for (const socket of sockets) socket.pause();
          await Promise.allSettled(sessions.map((session) => session.packetQueue));

          const socketClosed = sockets.map((socket) =>
            socket.destroyed
              ? Promise.resolve()
              : new Promise((resolve) => socket.once("close", resolve)),
          );
          for (const socket of sockets) {
            if (!socket.destroyed && !socket.writableEnded) socket.end();
          }

          let forceCloseTimer = null;
          if (sockets.length > 0) {
            await Promise.race([
              Promise.all(socketClosed),
              new Promise((resolve) => {
                forceCloseTimer = setTimeout(() => {
                  for (const socket of sockets) {
                    if (!socket.destroyed) socket.destroy();
                  }
                  resolve();
                }, timeoutMs);
              }),
            ]);
          }
          if (forceCloseTimer !== null) clearTimeout(forceCloseTimer);
          await Promise.all(socketClosed);
          await acceptingConnections;
        })();
        return shutdownPromise;
      },
    },
  });
  server.once("close", () => {
    for (const trade of [...activeTrades.values()]) {
      clearTrade(trade, "cancelled", "O servidor local foi encerrado.");
    }
    monsterRespawnTimerClosed = true;
    if (monsterRespawnTimer !== null) {
      clearTimeout(monsterRespawnTimer);
      monsterRespawnTimer = null;
    }
    monsterAiTimerClosed = true;
    if (monsterAiTimer !== null) {
      clearTimeout(monsterAiTimer);
      monsterAiTimer = null;
    }
    mountTickTimerClosed = true;
    if (mountTickTimer !== null) {
      clearTimeout(mountTickTimer);
      mountTickTimer = null;
    }
  });
  return server;
}
