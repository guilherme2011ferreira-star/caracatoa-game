import { createServer } from "node:http";
import { createLocalGameListener } from "./game-listener.mjs";
import {
  createWyd727GameModerationService,
  GameModerationError,
} from "./game-moderation.mjs";
import {
  createWyd727PlayerModerationService,
  PlayerModerationError,
} from "./player-moderation.mjs";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PlayerAccountConflictError,
  PlayerAccountInputError,
  PlayerAccountStore,
} from "./player-account-store.mjs";
import {
  DEFAULT_MONSTER_RESPAWN_MS,
  Wyd727MonsterStateStore,
} from "./wyd-727-monster-state-store.mjs";
import {
  DEFAULT_WYD727_CLASS_CATALOG,
  getWyd727ClassEntry,
  validateWyd727ClassCatalog,
} from "./wyd-727-class-catalog.mjs";
import {
  EMPTY_WYD727_ITEM_CATALOG,
  getWyd727StarterInventoryItems,
  resolveWyd727InventoryItems,
  validateWyd727ItemCatalog,
} from "./wyd-727-item-catalog.mjs";
import { consumeWyd727CatalogItem } from "./wyd-727-item-use.mjs";
import {
  applyCaracatoaEquipmentRequest,
  resolveCaracatoaCharacterEquipment,
} from "./wyd-727-item-equipment.mjs";
import { awardWyd727MonsterLoot } from "./wyd-727-monster-loot.mjs";
import { awardCaracatoaItemizedMonsterLoot } from "./caracatoa-itemized-monster-loot.mjs";
import { validateItemizationConfig } from "./item-affix-system.mjs";
import { buildCaracatoaItemizationDetailBody } from "./caracatoa-itemization-protocol.mjs";
import {
  buildWyd727CreateMobBody,
  EMPTY_WYD727_MONSTER_CATALOG,
  getWyd727MonstersForWorld,
  validateWyd727MonsterCatalog,
} from "./wyd-727-monster-catalog.mjs";
import {
  DEFAULT_WYD727_SKILL_CATALOG,
  getWyd727SkillsForClass,
  validateWyd727SkillCatalog,
} from "./wyd-727-skill-catalog.mjs";
import {
  buildWyd727WorldHeightmap,
  createWyd727Walkability,
} from "./wyd-727-walkability.mjs";
import { createCaracatoaNativeWalkability } from "./caracatoa-native-navigation.mjs";
import {
  getCaracatoaMap,
  getCaracatoaMapSpawns,
  pointInWorldRect,
  validateCaracatoaWorldCatalog,
} from "./caracatoa-world-catalog.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(
  process.env.CARACATOA_DATA_DIR ?? join(APP_DIR, "data", "catalogs"),
);
const STATE_DIR = resolve(
  process.env.CARACATOA_STATE_DIR ?? join(APP_DIR, "data", "state"),
);
const WEB_DIR = join(APP_DIR, "public");
const PORT = Number(process.env.CARACATOA_PORT ?? "8765");
const GAME_PORT = Number(process.env.CARACATOA_GAME_PORT ?? "8289");
const GAME_ASSET_DIR = process.env.CARACATOA_GAME_ASSET_DIR?.trim() ?? "";
const MONSTER_RESPAWN_MS = Number(
  process.env.CARACATOA_MONSTER_RESPAWN_MS ?? DEFAULT_MONSTER_RESPAWN_MS,
);
const WORLD_START_X = Number(process.env.CARACATOA_START_X ?? "128");
const WORLD_START_Y = Number(process.env.CARACATOA_START_Y ?? "128");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_HASH_BYTES = 64;
const scryptAsync = promisify(scrypt);
const PLAYER_REGISTRATION_WINDOW_MS = 10 * 60 * 1000;
const PLAYER_REGISTRATION_MAX_ATTEMPTS = 5;
const playerRegistrationAttempts = new Map();
const KINDS = ["items", "characters", "monsters", "classes", "skills"];
const LABELS = {
  items: "Itens",
  characters: "Personagens",
  monsters: "Monstros",
  classes: "Classes",
  skills: "Habilidades",
};
const locks = new Map();
const sessions = new Map();
let auditQueue = Promise.resolve();
const ACCOUNT_FILE = join(STATE_DIR, "accounts.json");
const AUDIT_FILE = join(STATE_DIR, "audit.jsonl");
let playerAccountStore;
let worldMonsterStateStore;
let gameModerationService;
let playerModerationService;

class InputError extends Error {}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function validKind(kind) {
  return KINDS.includes(kind);
}

function assertJsonValue(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH)
    throw new InputError("JSON excede a profundidade máxima.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new InputError("Números precisam ser finitos.");
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertJsonValue(child, depth + 1);
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const child of Object.values(value)) assertJsonValue(child, depth + 1);
    return;
  }
  throw new InputError("O conteúdo precisa conter apenas valores JSON.");
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new InputError("O registro precisa ser um objeto JSON.");
  }
  const allowed = new Set([
    "id",
    "name",
    "description",
    "enabled",
    "properties",
  ]);
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new InputError(
      `Campo não previsto: ${unknown.join(", ")}. Use properties para dados específicos.`,
    );
  if (
    typeof entry.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.id)
  ) {
    throw new InputError(
      "id deve ter de 1 a 64 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.",
    );
  }
  if (
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    entry.name.length > 128
  ) {
    throw new InputError("name deve ter de 1 a 128 caracteres.");
  }
  if (
    typeof entry.description !== "string" ||
    entry.description.length > 2048
  ) {
    throw new InputError("description deve ser texto com até 2048 caracteres.");
  }
  if (typeof entry.enabled !== "boolean")
    throw new InputError("enabled deve ser true ou false.");
  if (
    !entry.properties ||
    typeof entry.properties !== "object" ||
    Array.isArray(entry.properties)
  ) {
    throw new InputError("properties deve ser um objeto JSON.");
  }
  assertJsonValue(entry.properties);
}

function validateCatalog(catalog, expectedKind) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("Arquivo de catálogo inválido.");
  }
  if (
    catalog.schemaVersion !== 1 ||
    catalog.kind !== expectedKind ||
    !Array.isArray(catalog.entries)
  ) {
    throw new Error("Cabeçalho do catálogo inválido.");
  }
  const ids = new Set();
  for (const entry of catalog.entries) {
    validateEntry(entry);
    if (ids.has(entry.id)) throw new Error(`id duplicado: ${entry.id}.`);
    ids.add(entry.id);
  }
  if (expectedKind === "classes") {
    try {
      validateWyd727ClassCatalog(catalog);
    } catch (error) {
      throw new InputError(error.message);
    }
  }
  if (expectedKind === "items") {
    try {
      validateWyd727ItemCatalog(catalog);
    } catch (error) {
      throw new InputError(error.message);
    }
  }
  if (expectedKind === "monsters") {
    try {
      validateWyd727MonsterCatalog(catalog);
    } catch (error) {
      throw new InputError(error.message);
    }
  }
  if (expectedKind === "skills") {
    try {
      validateWyd727SkillCatalog(catalog);
    } catch (error) {
      throw new InputError(error.message);
    }
  }
  return catalog;
}

function validateAccountStore(store) {
  if (!store || store.schemaVersion !== 1 || !Array.isArray(store.accounts)) {
    throw new Error("Arquivo de contas inválido.");
  }
  const ids = new Set();
  for (const account of store.accounts) {
    if (!account || typeof account !== "object" || Array.isArray(account))
      throw new Error("Registro de conta inválido.");
    if (
      typeof account.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(account.id)
    )
      throw new Error("ID de conta inválido.");
    if (
      typeof account.displayName !== "string" ||
      !account.displayName.trim() ||
      account.displayName.length > 80
    )
      throw new Error(`Nome inválido na conta ${account.id}.`);
    if (!["admin", "moderator"].includes(account.role))
      throw new Error(`Papel inválido na conta ${account.id}.`);
    if (typeof account.enabled !== "boolean")
      throw new Error(`Estado inválido na conta ${account.id}.`);
    if (
      typeof account.passwordHash !== "string" ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.passwordHash)
    )
      throw new Error(`Hash inválido na conta ${account.id}.`);
    if (
      typeof account.createdAt !== "string" ||
      !Number.isFinite(Date.parse(account.createdAt))
    )
      throw new Error(`Data inválida na conta ${account.id}.`);
    if (ids.has(account.id))
      throw new Error(`ID de conta duplicado: ${account.id}.`);
    ids.add(account.id);
  }
  if (
    !store.accounts.some(
      (account) => account.role === "admin" && account.enabled,
    )
  ) {
    throw new Error("É necessário manter ao menos uma conta admin habilitada.");
  }
  return store;
}

async function withKindLock(kind, operation) {
  const previous = locks.get(kind) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  locks.set(
    kind,
    current.catch(() => {}),
  );
  return current;
}

async function withStateLock(operation) {
  const key = "state";
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  locks.set(
    key,
    current.catch(() => {}),
  );
  return current;
}

async function readCatalogFile(kind) {
  const path = join(DATA_DIR, `${kind}.json`);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && kind === "items") {
      return structuredClone(EMPTY_WYD727_ITEM_CATALOG);
    }
    if (error.code === "ENOENT" && kind === "monsters") {
      return structuredClone(EMPTY_WYD727_MONSTER_CATALOG);
    }
    if (error.code === "ENOENT")
      throw new Error(`Catálogo ${kind} não existe.`);
    throw error;
  }
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error(`O arquivo do catálogo ${kind} não contém JSON válido.`);
  }
  return validateCatalog(catalog, kind);
}

async function loadItemizationConfig() {
  const text = await readFile(join(DATA_DIR, "itemization.json"), "utf8");
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error("O catálogo itemization não contém JSON válido.");
  }
  return validateItemizationConfig(config) && config;
}

function validateMonsterLootReferences(monsterCatalog, itemCatalog) {
  const itemsById = new Map(
    itemCatalog.entries.map((entry) => [entry.id, entry]),
  );
  for (const monster of monsterCatalog.entries) {
    const drop = monster.enabled ? monster.properties.drop : null;
    if (!drop) continue;
    const item = itemsById.get(drop.catalogItemId);
    if (!item?.enabled) {
      throw new InputError(
        `Drop do monstro ${monster.id} precisa apontar para um item habilitado.`,
      );
    }
  }
}

async function loadCatalog(kind) {
  const catalog = await readCatalogFile(kind);
  if (kind === "monsters") {
    validateMonsterLootReferences(catalog, await readCatalogFile("items"));
  }
  return catalog;
}

async function atomicWrite(path, text, prefix) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${prefix}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveCatalog(kind, catalog) {
  validateCatalog(catalog, kind);
  await withKindLock("catalog-reference-write", async () => {
    if (kind === "monsters") {
      validateMonsterLootReferences(catalog, await readCatalogFile("items"));
    } else if (kind === "items") {
      validateMonsterLootReferences(await readCatalogFile("monsters"), catalog);
    }
    await atomicWrite(
      join(DATA_DIR, `${kind}.json`),
      `${JSON.stringify(catalog, null, 2)}\n`,
      kind,
    );
  });
}

async function ensureGameplayClassCatalog() {
  const path = join(DATA_DIR, "classes.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveCatalog("classes", structuredClone(DEFAULT_WYD727_CLASS_CATALOG));
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error("O arquivo do catálogo classes não contém JSON válido.");
  }

  // Migrate the previous empty v1 file once; retain and validate all nonempty data.
  if (
    catalog?.schemaVersion === 1 &&
    catalog?.kind === "classes" &&
    Array.isArray(catalog.entries) &&
    catalog.entries.length === 0
  ) {
    await saveCatalog("classes", structuredClone(DEFAULT_WYD727_CLASS_CATALOG));
    return;
  }
  validateCatalog(catalog, "classes");
}

async function ensureGameplayItemCatalog() {
  const path = join(DATA_DIR, "items.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveCatalog("items", structuredClone(EMPTY_WYD727_ITEM_CATALOG));
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error("O arquivo do catálogo items não contém JSON válido.");
  }
  validateCatalog(catalog, "items");
  validateMonsterLootReferences(await readCatalogFile("monsters"), catalog);
}

async function ensureGameplayMonsterCatalog() {
  const path = join(DATA_DIR, "monsters.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveCatalog(
      "monsters",
      structuredClone(EMPTY_WYD727_MONSTER_CATALOG),
    );
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error("O arquivo do catálogo monsters não contém JSON válido.");
  }
  validateCatalog(catalog, "monsters");
  validateMonsterLootReferences(catalog, await readCatalogFile("items"));
}

async function ensureGameplaySkillCatalog() {
  const path = join(DATA_DIR, "skills.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveCatalog("skills", structuredClone(DEFAULT_WYD727_SKILL_CATALOG));
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error("O arquivo do catálogo skills não contém JSON válido.");
  }
  validateCatalog(catalog, "skills");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, PASSWORD_HASH_BYTES, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt.toString("hex")}:${Buffer.from(derived).toString("hex")}`;
}

async function passwordMatches(password, encoded) {
  const [saltHex, hashHex] = encoded.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = Buffer.from(
    await scryptAsync(password, salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function loadAccounts() {
  let text;
  try {
    text = await readFile(ACCOUNT_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("Arquivo de contas ainda não foi criado.");
    throw error;
  }
  try {
    return validateAccountStore(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("O arquivo de contas não contém JSON válido.");
    throw error;
  }
}

async function saveAccounts(store) {
  validateAccountStore(store);
  await atomicWrite(
    ACCOUNT_FILE,
    `${JSON.stringify(store, null, 2)}\n`,
    "accounts",
  );
}

async function initializeAccounts() {
  await mkdir(STATE_DIR, { recursive: true });
  try {
    await loadAccounts();
    return;
  } catch (error) {
    if (!error.message.startsWith("Arquivo de contas ainda não foi criado."))
      throw error;
  }
  const password = process.env.CARACATOA_ADMIN_PASSWORD;
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new Error(
      "Primeira execução: defina CARACATOA_ADMIN_PASSWORD com uma senha de 12 a 128 caracteres para criar o admin local.",
    );
  }
  const store = {
    schemaVersion: 1,
    accounts: [
      {
        id: "admin",
        displayName: "Administrador",
        role: "admin",
        enabled: true,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      },
    ],
  };
  await saveAccounts(store);
  console.log(
    "Conta admin local criada em data/state/accounts.json. A senha não foi salva em texto puro.",
  );
}

async function readRequestJson(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = request.headers["content-type"]
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new InputError("Envie o corpo com Content-Type application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes)
      throw new InputError("Corpo excede o limite permitido.");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("Corpo não contém JSON válido.");
  }
  return body;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function requestIsSameOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      parsed.host.toLowerCase() ===
        String(request.headers.host ?? "").toLowerCase()
    );
  } catch {
    return false;
  }
}

function readSessionToken(request) {
  const cookie = request.headers.cookie ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "caracatoa_session") return value.join("=");
  }
  return null;
}

function publicAccount(account) {
  return {
    id: account.id,
    displayName: account.displayName,
    role: account.role,
    enabled: account.enabled,
    createdAt: account.createdAt,
  };
}

async function currentAccount(request) {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const store = await loadAccounts();
  const account = store.accounts.find(
    (entry) => entry.id === session.accountId && entry.enabled,
  );
  if (!account) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return account;
}

async function appendAudit(
  actor,
  action,
  entity,
  targetId,
  before = null,
  after = null,
) {
  const event = {
    at: new Date().toISOString(),
    actor: { id: actor.id, role: actor.role },
    action,
    entity,
    targetId,
    before,
    after,
  };
  await mkdir(STATE_DIR, { recursive: true });
  const write = auditQueue.then(() =>
    appendFile(AUDIT_FILE, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      flag: "a",
    }),
  );
  auditQueue = write.catch(() => {});
  await write;
}

async function readAudit(limit) {
  let text;
  try {
    text = await readFile(AUDIT_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-limit);
  return lines.map((line) => JSON.parse(line)).reverse();
}

async function routeApi(request, response, url) {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeSegment);
  if (parts.some((part) => part === null))
    return sendError(response, 400, "Caminho inválido.");
  if (parts[0] !== "api" || parts[1] !== "v1")
    return sendError(response, 404, "Rota não encontrada.");

  if (parts.length === 3 && parts[2] === "player-registration") {
    if (request.method !== "POST")
      return sendError(response, 405, "Método não permitido.");
    const address = request.socket.remoteAddress ?? "";
    if (address !== "127.0.0.1" && address !== "::ffff:127.0.0.1")
      return sendError(response, 403, "Cadastro disponível somente nesta máquina.");
    const now = Date.now();
    const bucket = playerRegistrationAttempts.get(address);
    if (!bucket || bucket.expiresAt <= now) {
      playerRegistrationAttempts.set(address, {
        count: 1,
        expiresAt: now + PLAYER_REGISTRATION_WINDOW_MS,
      });
    } else if (bucket.count >= PLAYER_REGISTRATION_MAX_ATTEMPTS) {
      return sendError(response, 429, "Muitas tentativas de cadastro. Aguarde alguns minutos.");
    } else {
      bucket.count += 1;
    }
    if (playerRegistrationAttempts.size > 64) {
      for (const [key, value] of playerRegistrationAttempts) {
        if (value.expiresAt <= now) playerRegistrationAttempts.delete(key);
      }
    }
    try {
      const body = await readRequestJson(request, 2048);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new InputError("Informe ID, senha e PIN.");
      const unknown = Object.keys(body).filter(
        (key) => !["accountId", "password", "token"].includes(key),
      );
      if (unknown.length) throw new InputError("O cadastro contém campos não previstos.");
      if (
        typeof body.accountId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/.test(body.accountId)
      )
        throw new InputError("ID deve ter de 1 a 15 letras, números, ponto, hífen ou sublinhado.");
      if (
        typeof body.password !== "string" ||
        !/^[\x20-\x7e]{8,11}$/.test(body.password)
      )
        throw new InputError("A senha deve ter de 8 a 11 caracteres ASCII imprimíveis.");
      if (typeof body.token !== "string" || !/^\d{4,6}$/.test(body.token))
        throw new InputError("O PIN deve ter de 4 a 6 dígitos.");
      const account = await playerAccountStore.createAccount(
        body.accountId,
        body.password,
        body.token,
      );
      await appendAudit(
        { id: "local-player-registration", role: "system" },
        "player-account.self-register",
        "player-account",
        account.accountId,
        null,
        account,
      );
      return sendJson(response, 201, {
        registered: true,
        accountId: account.accountId,
      });
    } catch (error) {
      if (error instanceof PlayerAccountConflictError)
        return sendError(response, 409, "Já existe uma conta com esse ID.");
      if (error instanceof PlayerAccountInputError || error instanceof InputError)
        return sendError(response, 400, error.message);
      return sendError(response, 500, "Não foi possível criar a conta local.");
    }
  }

  if (
    parts.length === 3 &&
    parts[2] === "session" &&
    request.method === "GET"
  ) {
    try {
      const account = await currentAccount(request);
      return sendJson(response, 200, {
        authenticated: Boolean(account),
        account: account ? publicAccount(account) : null,
      });
    } catch {
      return sendError(
        response,
        500,
        "Não foi possível consultar a sessão local.",
      );
    }
  }

  if (
    parts.length === 3 &&
    parts[2] === "session" &&
    request.method === "POST"
  ) {
    if (!requestIsSameOrigin(request))
      return sendError(response, 403, "Origem da solicitação não permitida.");
    try {
      const body = await readRequestJson(request);
      if (
        !body ||
        typeof body.id !== "string" ||
        typeof body.password !== "string" ||
        body.password.length > 128
      ) {
        throw new InputError("Informe ID e senha.");
      }
      const store = await loadAccounts();
      const account = store.accounts.find(
        (entry) => entry.id === body.id && entry.enabled,
      );
      const matches = account
        ? await passwordMatches(body.password, account.passwordHash)
        : false;
      if (!matches) return sendError(response, 401, "ID ou senha inválidos.");
      for (const [existingToken, session] of sessions)
        if (session.expiresAt <= Date.now()) sessions.delete(existingToken);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, {
        accountId: account.id,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      response.setHeader(
        "Set-Cookie",
        `caracatoa_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      );
      return sendJson(response, 200, {
        authenticated: true,
        account: publicAccount(account),
      });
    } catch (error) {
      const status = error instanceof InputError ? 400 : 500;
      return sendError(response, status, error.message);
    }
  }

  if (
    parts.length === 3 &&
    parts[2] === "session" &&
    request.method === "DELETE"
  ) {
    if (!requestIsSameOrigin(request))
      return sendError(response, 403, "Origem da solicitação não permitida.");
    const token = readSessionToken(request);
    if (token) sessions.delete(token);
    response.setHeader(
      "Set-Cookie",
      "caracatoa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    response.writeHead(204, { "Cache-Control": "no-store" });
    return response.end();
  }

  let actor;
  try {
    actor = await currentAccount(request);
  } catch {
    return sendError(
      response,
      500,
      "Não foi possível consultar a conta local.",
    );
  }
  if (!actor)
    return sendError(response, 401, "Entre com uma conta do painel local.");
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutating && !requestIsSameOrigin(request))
    return sendError(response, 403, "Origem da solicitação não permitida.");

  if (parts.length === 4 && parts[2] === "game" && parts[3] === "monsters") {
    if (!["admin", "moderator"].includes(actor.role)) {
      return sendError(
        response,
        403,
        "Somente admin ou moderador pode usar ações de jogo.",
      );
    }
    if (request.method === "GET") {
      try {
        return sendJson(response, 200, {
          monsters: gameModerationService.listMonsters(actor),
        });
      } catch (error) {
        return sendError(
          response,
          error instanceof GameModerationError ? error.status : 500,
          error instanceof GameModerationError
            ? error.message
            : "Não foi possível consultar monstros no jogo.",
        );
      }
    }
    if (request.method === "POST") {
      try {
        const monster = await gameModerationService.moderateMonster(
          actor,
          await readRequestJson(request),
        );
        return sendJson(response, 200, { monster });
      } catch (error) {
        return sendError(
          response,
          error instanceof GameModerationError
            ? error.status
            : error instanceof InputError
              ? 400
              : 500,
          error instanceof GameModerationError
            ? error.message
            : error instanceof InputError
              ? error.message
              : "Não foi possível registrar a ação de moderação.",
        );
      }
    }
    return sendError(response, 405, "Método não permitido.");
  }

  if (
    parts.length === 4 &&
    parts[2] === "game" &&
    parts[3] === "player-sessions"
  ) {
    if (!["admin", "moderator"].includes(actor.role)) {
      return sendError(
        response,
        403,
        "Somente admin ou moderador pode consultar sessões de jogo.",
      );
    }
    if (request.method === "GET") {
      try {
        return sendJson(response, 200, {
          players: playerModerationService.listOnlinePlayers(actor),
        });
      } catch (error) {
        return sendError(
          response,
          error instanceof PlayerModerationError ? error.status : 500,
          error instanceof PlayerModerationError
            ? error.message
            : "Não foi possível consultar jogadores online.",
        );
      }
    }
    return sendError(response, 405, "Método não permitido.");
  }

  if (
    parts.length === 5 &&
    parts[2] === "game" &&
    parts[3] === "player-sessions" &&
    parts[4] === "suspend"
  ) {
    if (!["admin", "moderator"].includes(actor.role)) {
      return sendError(
        response,
        403,
        "Somente admin ou moderador pode suspender jogador online.",
      );
    }
    if (request.method === "POST") {
      try {
        const result = await playerModerationService.suspendAndDisconnect(
          actor,
          await readRequestJson(request),
        );
        return sendJson(response, 200, result);
      } catch (error) {
        return sendError(
          response,
          error instanceof PlayerModerationError
            ? error.status
            : error instanceof InputError
              ? 400
              : 500,
          error instanceof PlayerModerationError || error instanceof InputError
            ? error.message
            : "Não foi possível suspender e desconectar a conta.",
        );
      }
    }
    return sendError(response, 405, "Método não permitido.");
  }

  if (
    parts.length === 3 &&
    parts[2] === "catalogs" &&
    request.method === "GET"
  ) {
    return sendJson(response, 200, {
      schemaVersion: 1,
      catalogs: KINDS.map((kind) => ({ kind, label: LABELS[kind] })),
    });
  }

  if (parts.length === 3 && parts[2] === "accounts") {
    if (actor.role !== "admin")
      return sendError(response, 403, "Somente admin pode gerenciar contas.");
    if (request.method === "GET") {
      try {
        const store = await loadAccounts();
        return sendJson(response, 200, {
          accounts: store.accounts.map(publicAccount),
        });
      } catch (error) {
        return sendError(response, 500, error.message);
      }
    }
    if (request.method === "POST") {
      try {
        const body = await readRequestJson(request);
        if (
          !body ||
          typeof body.id !== "string" ||
          !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(body.id)
        )
          throw new InputError(
            "ID deve ter até 32 caracteres minúsculos, números, ponto, hífen ou sublinhado.",
          );
        if (
          typeof body.displayName !== "string" ||
          !body.displayName.trim() ||
          body.displayName.length > 80
        )
          throw new InputError("Informe um nome com até 80 caracteres.");
        if (!["admin", "moderator"].includes(body.role))
          throw new InputError("Papel deve ser admin ou moderator.");
        if (
          typeof body.password !== "string" ||
          body.password.length < 12 ||
          body.password.length > 128
        )
          throw new InputError("A senha deve ter entre 12 e 128 caracteres.");
        const result = await withStateLock(async () => {
          const store = await loadAccounts();
          if (store.accounts.some((account) => account.id === body.id))
            return { conflict: true };
          const account = {
            id: body.id,
            displayName: body.displayName.trim(),
            role: body.role,
            enabled: true,
            passwordHash: await hashPassword(body.password),
            createdAt: new Date().toISOString(),
          };
          store.accounts.push(account);
          await saveAccounts(store);
          await appendAudit(
            actor,
            "account.create",
            "account",
            account.id,
            null,
            publicAccount(account),
          );
          return { account: publicAccount(account) };
        });
        if (result.conflict)
          return sendError(response, 409, "Já existe uma conta com esse ID.");
        return sendJson(response, 201, result);
      } catch (error) {
        return sendError(
          response,
          error instanceof InputError ? 400 : 500,
          error.message,
        );
      }
    }
    return sendError(response, 405, "Método não permitido.");
  }

  if (parts[2] === "player-accounts") {
    if (actor.role !== "admin")
      return sendError(
        response,
        403,
        "Somente admin pode gerenciar contas de jogador.",
      );
    if (parts.length === 3 && request.method === "GET") {
      return sendJson(response, 200, {
        accounts: playerAccountStore.listAccounts(),
      });
    }
    if (parts.length === 3 && request.method === "POST") {
      try {
        const body = await readRequestJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new InputError("Envie ID e senha de jogador.");
        const unknown = Object.keys(body).filter(
          (key) => !["accountId", "password", "token"].includes(key),
        );
        if (unknown.length)
          throw new InputError(`Campo não previsto: ${unknown.join(", ")}.`);
        if (typeof body.accountId !== "string")
          throw new InputError("ID de jogador inválido para WYD 7.27.");
        if (
          typeof body.password !== "string" ||
          !/^[\x20-\x7e]{8,11}$/.test(body.password)
        ) {
          throw new InputError(
            "A senha do jogo deve ter de 8 a 11 bytes ASCII imprimíveis.",
          );
        }
        if (typeof body.token !== "string" || !/^\d{4,6}$/.test(body.token)) {
          throw new InputError("O token do jogo deve ter de 4 a 6 dígitos.");
        }
        try {
          const account = await playerAccountStore.createAccount(
            body.accountId,
            body.password,
            body.token,
          );
          await appendAudit(
            actor,
            "player-account.create",
            "player-account",
            account.accountId,
            null,
            account,
          );
          return sendJson(response, 201, { account });
        } catch (error) {
          if (error instanceof PlayerAccountConflictError)
            return sendError(
              response,
              409,
              "Já existe uma conta de jogador com esse ID.",
            );
          if (error instanceof PlayerAccountInputError)
            throw new InputError(error.message);
          throw error;
        }
      } catch (error) {
        return sendError(
          response,
          error instanceof InputError ? 400 : 500,
          error instanceof InputError
            ? error.message
            : "Não foi possível criar a conta de jogador.",
        );
      }
    }
    if (parts.length === 4 && request.method === "PUT") {
      const accountId = parts[3];
      try {
        const body = await readRequestJson(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1
        ) {
          throw new InputError("Informe somente enabled ou token.");
        }
        const changingEnabled = typeof body.enabled === "boolean";
        const changingToken =
          typeof body.token === "string" && /^\d{4,6}$/.test(body.token);
        if (changingEnabled === changingToken)
          throw new InputError(
            "Informe enabled como booleano ou token com 4 a 6 dígitos.",
          );
        const before = playerAccountStore.getAccount(accountId);
        if (!before)
          return sendError(response, 404, "Conta de jogador não encontrada.");
        if (
          changingEnabled &&
          body.enabled === false &&
          playerModerationService
            .listOnlinePlayers(actor)
            .some((player) => player.accountId === before.accountId)
        ) {
          return sendError(
            response,
            409,
            "Conta conectada: use Moderação para informar o motivo e desconectar.",
          );
        }
        const after = changingEnabled
          ? playerAccountStore.setEnabled(accountId, body.enabled)
          : await playerAccountStore.setToken(accountId, body.token);
        if (!after)
          return sendError(response, 404, "Conta de jogador não encontrada.");
        await appendAudit(
          actor,
          changingEnabled
            ? "player-account.update"
            : "player-account.token-reset",
          "player-account",
          after.accountId,
          before,
          after,
        );
        return sendJson(response, 200, { account: after });
      } catch (error) {
        if (error instanceof PlayerAccountInputError)
          return sendError(response, 400, error.message);
        return sendError(
          response,
          500,
          "Não foi possível atualizar a conta de jogador.",
        );
      }
    }
    return sendError(response, 405, "Método não permitido.");
  }

  if (
    parts.length === 4 &&
    parts[2] === "accounts" &&
    request.method === "PUT"
  ) {
    if (actor.role !== "admin")
      return sendError(response, 403, "Somente admin pode gerenciar contas.");
    const id = parts[3];
    try {
      const body = await readRequestJson(request);
      const allowed = new Set(["displayName", "role", "enabled", "password"]);
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new InputError(
          "Envie um objeto JSON com as alterações da conta.",
        );
      const unknown = Object.keys(body ?? {}).filter(
        (key) => !allowed.has(key),
      );
      if (unknown.length)
        throw new InputError(
          `Campo de conta não previsto: ${unknown.join(", ")}.`,
        );
      if (
        body.displayName !== undefined &&
        (typeof body.displayName !== "string" ||
          !body.displayName.trim() ||
          body.displayName.length > 80)
      )
        throw new InputError("Nome inválido.");
      if (
        body.role !== undefined &&
        !["admin", "moderator"].includes(body.role)
      )
        throw new InputError("Papel deve ser admin ou moderator.");
      if (body.enabled !== undefined && typeof body.enabled !== "boolean")
        throw new InputError("enabled deve ser true ou false.");
      if (
        body.password !== undefined &&
        (typeof body.password !== "string" ||
          body.password.length < 12 ||
          body.password.length > 128)
      )
        throw new InputError("A senha deve ter entre 12 e 128 caracteres.");
      const result = await withStateLock(async () => {
        const store = await loadAccounts();
        const account = store.accounts.find((entry) => entry.id === id);
        if (!account) return { missing: true };
        const before = publicAccount(account);
        if (body.displayName !== undefined)
          account.displayName = body.displayName.trim();
        if (body.role !== undefined) account.role = body.role;
        if (body.enabled !== undefined) account.enabled = body.enabled;
        if (body.password !== undefined)
          account.passwordHash = await hashPassword(body.password);
        if (account.id === actor.id && !account.enabled)
          throw new InputError(
            "Não é possível desabilitar a própria conta durante a sessão.",
          );
        if (
          !store.accounts.some(
            (entry) => entry.role === "admin" && entry.enabled,
          )
        )
          throw new InputError(
            "É necessário manter ao menos uma conta admin habilitada.",
          );
        validateAccountStore(store);
        await saveAccounts(store);
        await appendAudit(
          actor,
          "account.update",
          "account",
          account.id,
          before,
          publicAccount(account),
        );
        if (body.password !== undefined) {
          for (const [token, session] of sessions)
            if (session.accountId === account.id) sessions.delete(token);
        }
        if (!account.enabled || account.role !== "admin") {
          for (const [token, session] of sessions)
            if (session.accountId === account.id) sessions.delete(token);
        }
        return { account: publicAccount(account) };
      });
      if (result.missing)
        return sendError(response, 404, "Conta não encontrada.");
      return sendJson(response, 200, result);
    } catch (error) {
      return sendError(
        response,
        error instanceof InputError ? 400 : 500,
        error.message,
      );
    }
  }

  if (parts.length === 3 && parts[2] === "audit" && request.method === "GET") {
    if (actor.role !== "admin")
      return sendError(
        response,
        403,
        "Somente admin pode consultar a auditoria.",
      );
    const requested = Number(url.searchParams.get("limit") ?? "100");
    if (!Number.isInteger(requested) || requested < 1 || requested > 200)
      return sendError(response, 400, "limit deve estar entre 1 e 200.");
    try {
      return sendJson(response, 200, { events: await readAudit(requested) });
    } catch {
      return sendError(
        response,
        500,
        "Não foi possível ler a auditoria local.",
      );
    }
  }

  if (parts.length < 4 || parts[2] !== "catalogs" || !validKind(parts[3])) {
    return sendError(response, 404, "Catálogo não encontrado.");
  }

  const kind = parts[3];
  if (parts.length === 4 && request.method === "GET") {
    try {
      return sendJson(response, 200, await loadCatalog(kind));
    } catch (error) {
      return sendError(response, 500, error.message);
    }
  }

  if (parts.length === 4 && request.method === "POST") {
    try {
      const entry = await readRequestJson(request);
      validateEntry(entry);
      const result = await withKindLock(kind, async () => {
        const catalog = await loadCatalog(kind);
        if (catalog.entries.some((current) => current.id === entry.id))
          return { conflict: true };
        catalog.entries.push(entry);
        await saveCatalog(kind, catalog);
        await appendAudit(actor, "catalog.create", kind, entry.id, null, entry);
        return { catalog };
      });
      if (result.conflict)
        return sendError(response, 409, "Já existe um registro com esse id.");
      return sendJson(response, 201, result.catalog);
    } catch (error) {
      const status = error instanceof InputError ? 400 : 500;
      return sendError(response, status, error.message);
    }
  }

  if (parts.length === 5 && ["PUT", "DELETE"].includes(request.method)) {
    const id = parts[4];
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
      return sendError(response, 400, "id no caminho é inválido.");
    try {
      if (request.method === "DELETE") {
        const result = await withKindLock(kind, async () => {
          const catalog = await loadCatalog(kind);
          const index = catalog.entries.findIndex((entry) => entry.id === id);
          if (index < 0) return { missing: true };
          if (kind === "items" && playerAccountStore?.isCatalogItemInUse(id))
            return { inUse: true };
          const [removed] = catalog.entries.splice(index, 1);
          await saveCatalog(kind, catalog);
          await appendAudit(actor, "catalog.delete", kind, id, removed, null);
          return { catalog };
        });
        if (result.missing)
          return sendError(response, 404, "Registro não encontrado.");
        if (result.inUse)
          return sendError(
            response,
            409,
            "O item está em inventários de personagens e não pode ser removido.",
          );
        response.writeHead(204, { "Cache-Control": "no-store" });
        return response.end();
      }

      const entry = await readRequestJson(request);
      validateEntry(entry);
      const result = await withKindLock(kind, async () => {
        const catalog = await loadCatalog(kind);
        const index = catalog.entries.findIndex((current) => current.id === id);
        if (index < 0) return { missing: true };
        const duplicate = catalog.entries.some(
          (current, currentIndex) =>
            currentIndex !== index && current.id === entry.id,
        );
        if (duplicate) return { conflict: true };
        if (
          kind === "items" &&
          entry.id !== id &&
          playerAccountStore?.isCatalogItemInUse(id)
        ) {
          return { inUse: true };
        }
        const before = catalog.entries[index];
        catalog.entries[index] = entry;
        await saveCatalog(kind, catalog);
        await appendAudit(actor, "catalog.update", kind, id, before, entry);
        return { catalog };
      });
      if (result.missing)
        return sendError(response, 404, "Registro não encontrado.");
      if (result.conflict)
        return sendError(response, 409, "Já existe um registro com esse id.");
      if (result.inUse)
        return sendError(
          response,
          409,
          "O ID do item está em inventários de personagens e não pode ser alterado.",
        );
      return sendJson(response, 200, result.catalog);
    } catch (error) {
      const status = error instanceof InputError ? 400 : 500;
      return sendError(response, status, error.message);
    }
  }
  return sendError(response, 405, "Método não permitido.");
}

async function route(request, response) {
  const host = (request.headers.host ?? "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (!["127.0.0.1", "localhost"].includes(host))
    return sendError(response, 421, "Use o painel pela máquina local.");

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api/")) return routeApi(request, response, url);
  if (request.method !== "GET" && request.method !== "HEAD")
    return sendError(response, 405, "Método não permitido.");
  if (url.pathname === "/healthz")
    return sendJson(response, 200, {
      status: "ok",
      service: "caracatoa-local-admin",
    });

  const webPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!["index.html", "app.js", "styles.css"].includes(webPath))
    return sendError(response, 404, "Arquivo não encontrado.");
  try {
    const body = await readFile(join(WEB_DIR, webPath));
    const types = {
      "index.html": "text/html; charset=utf-8",
      "app.js": "text/javascript; charset=utf-8",
      "styles.css": "text/css; charset=utf-8",
    };
    response.writeHead(200, {
      "Content-Type": types[webPath],
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    sendError(response, 500, "Não foi possível abrir os arquivos do painel.");
  }
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("CARACATOA_PORT precisa ser um número entre 1 e 65535.");
}
if (!Number.isInteger(GAME_PORT) || GAME_PORT < 1 || GAME_PORT > 65535) {
  throw new Error("CARACATOA_GAME_PORT precisa ser um número entre 1 e 65535.");
}
if (GAME_PORT === PORT)
  throw new Error(
    "CARACATOA_GAME_PORT e CARACATOA_PORT precisam ser diferentes.",
  );
if (
  !Number.isInteger(WORLD_START_X) ||
  WORLD_START_X < -0x8000 ||
  WORLD_START_X > 0x7fff ||
  !Number.isInteger(WORLD_START_Y) ||
  WORLD_START_Y < -0x8000 ||
  WORLD_START_Y > 0x7fff
) {
  throw new Error(
    "CARACATOA_START_X/Y precisam ser coordenadas Int16 assinadas.",
  );
}

await mkdir(DATA_DIR, { recursive: true });
await ensureGameplayClassCatalog();
await ensureGameplayItemCatalog();
await ensureGameplayMonsterCatalog();
await ensureGameplaySkillCatalog();
const worldMaps = JSON.parse(await readFile(join(APP_DIR, "data", "world", "maps.json"), "utf8"));
const worldSpawns = JSON.parse(await readFile(join(APP_DIR, "data", "world", "spawns.json"), "utf8"));
const worldMonsterCatalog = await readCatalogFile("monsters");
const worldSummary = validateCaracatoaWorldCatalog(
  worldMaps, worldSpawns, worldMonsterCatalog, { allowMissingLiveMonsters: true },
);
const initialMap = getCaracatoaMap(worldMaps, 1);
if (!initialMap) throw new Error("O mapa inicial Caracatoa 001 não está catalogado.");
let worldWalkability;
if (GAME_ASSET_DIR) {
  const worldMap = await buildWyd727WorldHeightmap(GAME_ASSET_DIR);
  worldWalkability = createWyd727Walkability(worldMap.heightmap);
  console.log(
    `[jogo] terreno local de referência carregado: setores=${worldMap.sectorsLoaded}, ` +
      `objetos=${worldMap.objectsLoaded}, hash=${worldMap.hash}.`,
  );
} else {
  const nativeNavigation = JSON.parse(
    await readFile(join(APP_DIR, "data", "world", "navigation.json"), "utf8"),
  );
  worldWalkability = createCaracatoaNativeWalkability(
    nativeNavigation,
    initialMap.mapId,
    initialMap.bounds,
  );
  console.log(
    `[jogo] navegação Caracatoa ativa: mapa=${worldWalkability.mapId}, ` +
      "sem dependência de assets de mapa externos.",
  );
}
if (!initialMap || !initialMap.safeZones.some((zone) =>
  pointInWorldRect([WORLD_START_X, WORLD_START_Y], zone.bounds))) {
  throw new Error("CARACATOA_START_X/Y precisam ficar na zona segura do mapa 001.");
}
const liveMonsterIds = new Set(getCaracatoaMapSpawns(worldSpawns, 1)
  .filter((spawn) => worldMonsterCatalog.entries.some((monster) =>
    monster.id === spawn.monsterId && monster.enabled))
  .map((spawn) => spawn.monsterId));
console.log(`[jogo] catálogo espacial: ${worldSummary.mapCount} mapas, ` +
  `${worldSummary.spawnCount} spawns, ${worldSummary.liveSpawnCount} ativos, ` +
  `${worldSummary.suspendedLiveSpawnCount} suspensos por falta/estado de catálogo.`);
await initializeAccounts();
delete process.env.CARACATOA_ADMIN_PASSWORD;
playerAccountStore = new PlayerAccountStore({
  databasePath: join(STATE_DIR, "player-accounts.sqlite"),
});
worldMonsterStateStore = new Wyd727MonsterStateStore({
  databasePath: join(STATE_DIR, "world-monsters.sqlite"),
});
let storesClosed = false;
function closeStores() {
  if (storesClosed) return;
  storesClosed = true;
  playerAccountStore?.close();
  worldMonsterStateStore?.close();
}
process.once("exit", closeStores);
const server = createServer((request, response) => {
  route(request, response).catch(() => {
    if (!response.headersSent)
      sendError(response, 500, "Erro interno do servidor local.");
    else response.destroy();
  });
});
const gameServer = createLocalGameListener({
  accountStore: playerAccountStore,
  worldMonsterStore: worldMonsterStateStore,
  monsterRespawnMs: MONSTER_RESPAWN_MS,
  authEnabled: true,
  worldStartPosition: { x: WORLD_START_X, y: WORLD_START_Y },
  walkability: worldWalkability,
  isPlayablePosition: (x, y) => pointInWorldRect([x, y], initialMap.bounds),
  async getClassDefinition(classId) {
    const catalog = await loadCatalog("classes");
    return getWyd727ClassEntry(catalog, classId);
  },
  async getCharacterSkills(classId) {
    return withKindLock("skills", async () => {
      const catalog = await loadCatalog("skills");
      return getWyd727SkillsForClass(catalog, classId);
    });
  },
  async getCharacterInventory(accountId, slot) {
    return withKindLock("items", async () => {
      const catalog = await loadCatalog("items");
      const starterItems = getWyd727StarterInventoryItems(catalog);
      const inventory = playerAccountStore.initializeCharacterInventory(
        accountId,
        slot,
        starterItems,
      );
      if (!inventory) throw new Error("Personagem indisponível.");
      const resolved = resolveWyd727InventoryItems(inventory, catalog);
      const itemizationBySlot = new Map(
        playerAccountStore
          .getCharacterItemizationDetails(accountId, slot)
          .map((item) => [item.slot, item]),
      );
      return resolved.map((item) => ({
        ...item,
        itemization: itemizationBySlot.get(item.slot) ?? null,
      }));
    });
  },
  async getCharacterEquipment(accountId, slot, classId) {
    return withKindLock("items", async () => {
      const catalog = await loadCatalog("items");
      const itemizationConfig = await loadItemizationConfig();
      return resolveCaracatoaCharacterEquipment({
        accountStore: playerAccountStore,
        accountId,
        characterSlot: slot,
        classId,
        catalog,
        itemizationConfig,
      }).equipment;
    });
  },
  async changeCharacterEquipment({
    accountId,
    characterSlot,
    classId,
    equipmentSlot,
    inventorySlot,
  }) {
    return withKindLock("items", async () => {
      const catalog = await loadCatalog("items");
      const itemizationConfig = await loadItemizationConfig();
      return applyCaracatoaEquipmentRequest({
        accountStore: playerAccountStore,
        accountId,
        characterSlot,
        classId,
        equipmentSlot,
        inventorySlot,
        catalog,
        itemizationConfig,
      });
    });
  },
  async refineCharacterItem({
    accountId,
    characterSlot,
    inventorySlot,
    eventId,
    useDivineDust,
  }) {
    return withKindLock("items", async () => {
      const itemCatalog = await loadCatalog("items");
      const itemizationConfig = await loadItemizationConfig();
      const result = playerAccountStore.refineCharacterItem({
        accountId,
        characterSlot,
        inventorySlot,
        eventId,
        useDivineDust,
        itemCatalog,
        itemizationConfig,
      });
      const inventoryRows = playerAccountStore.initializeCharacterInventory(
        accountId,
        characterSlot,
        getWyd727StarterInventoryItems(itemCatalog),
      );
      const resolvedInventory = resolveWyd727InventoryItems(inventoryRows, itemCatalog);
      const changes = new Map((result.inventoryChanges ?? []).map((change) => [change.slot, change]));
      result.inventoryChanges = [...changes.keys()].map((slot) => {
        const item = resolvedInventory.find((entry) => entry.slot === slot);
        return item
          ? { slot, clientItemId: item.clientItemId, stackCount: item.stackCount }
          : { slot, clientItemId: 0, stackCount: 0 };
      });
      const details = playerAccountStore.getCharacterItemizationDetails(accountId, characterSlot);
      const itemization = details.find((detail) => detail.instanceId === result.itemInstanceId);
      if (itemization) {
        result.slot = itemization.slot;
        result.itemization = itemization;
      }
      if (result.equipped && ["success", "failed", "duplicate"].includes(result.status)) {
        result.equipment = resolveCaracatoaCharacterEquipment({
          accountStore: playerAccountStore,
          accountId,
          characterSlot,
          classId: playerAccountStore.getCharacterBySlot(accountId, characterSlot)?.classId,
          catalog: itemCatalog,
          itemizationConfig,
        }).equipment;
      }
      return result;
    });
  },
  async consumeCharacterInventoryItem({
    accountId,
    characterSlot,
    inventorySlot,
  }) {
    return withKindLock("items", async () => {
      const catalog = await loadCatalog("items");
      return consumeWyd727CatalogItem({
        accountStore: playerAccountStore,
        accountId,
        characterSlot,
        inventorySlot,
        catalog,
      });
    });
  },
  async awardMonsterLoot({ accountId, characterSlot, monsterEntityId, lootEventId, playerLuckBonusBps = 0 }) {
    const monsterCatalog = await withKindLock("monsters", () =>
      loadCatalog("monsters"),
    );
    return withKindLock("items", async () => {
      const itemCatalog = await loadCatalog("items");
      const itemizationConfig = await loadItemizationConfig();
      const itemized = awardCaracatoaItemizedMonsterLoot({
        accountStore: playerAccountStore,
        accountId,
        characterSlot,
        monsterEntityId,
        lootEventId,
        monsterCatalog,
        itemCatalog,
        itemizationConfig,
        playerLuckBonusBps,
      });
      if (itemized.reason !== "no-itemization-table") return itemized;
      return awardWyd727MonsterLoot({
        accountStore: playerAccountStore,
        accountId,
        characterSlot,
        monsterEntityId,
        monsterCatalog,
        itemCatalog,
      });
    });
  },
  async getWorldMonsterBodies(clientId, playerPosition) {
    return withKindLock("monsters", async () => {
      const catalog = await loadCatalog("monsters");
      return getWyd727MonstersForWorld(
        { ...catalog, entries: catalog.entries.filter((entry) =>
          liveMonsterIds.has(entry.id)) },
        playerPosition,
        worldWalkability,
      )
        .filter((entry) => entry.properties.clientEntityId !== clientId)
        .map((entry) =>
          buildWyd727CreateMobBody({
            clientId,
            timestamp: Date.now() >>> 0,
            entry,
          }),
        );
    });
  },
  onEvent(event) {
    if (event.type === "connection-open")
      console.log("[jogo] conexão local aceita.");
    else if (event.type === "handshake")
      console.log("[jogo] marcador cliente→servidor confirmado.");
    else if (event.type === "frame") {
      console.log(
        `[jogo] quadro válido: sequência=${event.sequence}, corpo=${event.bodyLength} bytes.`,
      );
    } else if (event.type === "packet") {
      if (event.recognized && event.lengthValid) {
        console.log(
          `[jogo] pacote WYD 7.27 reconhecido: ${event.name} (opcode=0x${event.opcode.toString(16)}, ${event.frameLength} bytes).`,
        );
      } else if (event.recognized) {
        console.warn(
          `[jogo] pacote WYD 7.27 com tamanho inesperado: opcode=0x${event.opcode.toString(16)}, ${event.frameLength} bytes (esperado ${event.expectedFrameLength}); corpo omitido.`,
        );
      } else if (!event.malformed) {
        console.log(
          `[jogo] opcode ainda não mapeado: 0x${event.opcode.toString(16)}, ${event.frameLength} bytes; corpo omitido.`,
        );
      }
    } else if (event.type === "protocol-error")
      console.warn(`[jogo] fluxo encerrado: ${event.message}.`);
    else if (event.type === "connection-rejected")
      console.warn("[jogo] conexão local rejeitada: limite atingido.");
    else if (event.type === "login-denied")
      console.warn("[jogo] autenticação de senha recusada.");
    else if (event.type === "token-denied")
      console.warn("[jogo] autenticação de token recusada.");
    else if (event.type === "login-authenticated")
      console.log("[jogo] conta autenticada; quatro slots vazios enviados.");
    else if (event.type === "token-authenticated")
      console.log("[jogo] token autenticado; seleção de personagem liberada.");
    else if (event.type === "world-entry-accepted")
      console.log(
        `[jogo] personagem do slot ${event.slot}, classe ${event.classId}, recebeu estado inicial do mundo.`,
      );
    else if (event.type === "world-entry-denied")
      console.warn(`[jogo] entrada no mundo recusada: ${event.reason}.`);
    else if (event.type === "world-monster-state-storage-failed")
      console.warn(
        `[jogo] falha ao persistir respawn de monstro; nova tentativa em ${event.retryDelayMs ?? 1000} ms.`,
      );
    else if (event.type === "world-monster-experience-awarded")
      console.log(
        `[jogo] monstro derrotado: +${event.experienceGained} EXP (total ${event.totalExperience}).`,
      );
    else if (event.type === "world-monster-reward-storage-failed")
      console.warn("[jogo] não foi possível persistir a recompensa de EXP.");
    else if (event.type === "world-entry-malformed")
      console.warn("[jogo] pedido de entrada no mundo inválido.");
    else if (event.type === "world-entry-storage-failed")
      console.warn(
        `[jogo] entrada no mundo encerrada: falha de persistência (${event.stage ?? "unknown"}).`,
      );
    else if (event.type === "world-move-accepted")
      console.log(
        `[jogo] movimento autoritativo: (${event.from.x},${event.from.y}) → (${event.to.x},${event.to.y}), ${event.steps} passos.`,
      );
    else if (event.type === "world-move-corrected")
      console.warn(
        `[jogo] movimento corrigido pelo servidor: ${event.reason}.`,
      );
    else if (event.type === "world-move-rejected")
      console.warn(`[jogo] movimento recusado: ${event.reason}.`);
    else if (event.type === "world-move-terrain-failed")
      console.warn("[jogo] sessão encerrada: falha ao consultar terreno.");
    else if (event.type === "world-command-disabled")
      console.warn(
        `[jogo] comando de gameplay 0x${event.opcode.toString(16)} ainda não habilitado.`,
      );
    else if (event.type === "session-request-disabled")
      console.warn(
        `[jogo] pedido 0x${event.opcode.toString(16)} não habilitado nesta etapa.`,
      );
    else if (event.type === "session-error")
      console.warn(`[jogo] handler de sessão encerrado: ${event.code}.`);
    else if (event.type === "socket-error" || event.type === "listener-error") {
      console.warn(`[jogo] erro de socket: ${event.code}.`);
    }
  },
});
gameModerationService = createWyd727GameModerationService({
  gameListener: gameServer,
  audit: appendAudit,
});
playerModerationService = createWyd727PlayerModerationService({
  playerAccountStore,
  gameListener: gameServer,
  audit: appendAudit,
});

function listenOnLoopback(listener, port, label) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      listener.off("listening", onListening);
      reject(
        new Error(
          `Não foi possível iniciar ${label} em 127.0.0.1:${port}: ${error.code ?? error.message}`,
        ),
      );
    };
    const onListening = () => {
      listener.off("error", onError);
      resolve();
    };
    listener.once("error", onError);
    listener.once("listening", onListening);
    listener.listen(port, "127.0.0.1");
  });
}

function closeListener(listener) {
  return new Promise((resolve, reject) => {
    if (!listener.listening) return resolve();
    listener.close((error) => (error ? reject(error) : resolve()));
  });
}

try {
  await listenOnLoopback(server, PORT, "painel Caracatoa");
  await listenOnLoopback(gameServer, GAME_PORT, "listener WYD");
} catch (error) {
  await Promise.allSettled([closeListener(server), gameServer.shutdown(0)]);
  throw error;
}

console.log(`Painel Caracatoa disponível em http://127.0.0.1:${PORT}`);
console.log(
  `Servidor WYD Caracatoa em 127.0.0.1:${GAME_PORT}; ataque básico ativo e respawn de monstros em ${MONSTER_RESPAWN_MS} ms.`,
);
console.log(`Catálogos locais: ${DATA_DIR}`);
console.log(`Contas, auditoria e estado do mundo: ${STATE_DIR}`);

let shutdownPromise = null;
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  console.log(`[servidor] encerramento gracioso solicitado (${signal}).`);
  shutdownPromise = (async () => {
    try {
      const results = await Promise.allSettled([
        closeListener(server),
        gameServer.shutdown(),
      ]);
      const failedShutdown = results.find((result) => result.status === "rejected");
      if (failedShutdown) throw failedShutdown.reason;
    } finally {
      closeStores();
    }
    console.log("[servidor] listeners, sessões e bancos locais encerrados.");
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => {
        process.exitCode = signal === "SIGINT" ? 130 : 143;
      })
      .catch((error) => {
        console.error(
          `[servidor] falha no encerramento gracioso: ${error?.code ?? error?.name ?? "erro"}.`,
        );
        process.exitCode = 1;
      });
  });
}
