import { createReadStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(APP_DIR, "..", "..");
const REPOSITORY_ROOT_REAL = await realpath(REPOSITORY_ROOT);

export const CARACATOA_LOCAL_BACKUP_FORMAT = "caracatoa-local-state";
export const CARACATOA_LOCAL_BACKUP_VERSION = 1;

const REQUIRED_DATABASES = [
  "player-accounts.sqlite",
  "world-monsters.sqlite",
];
const OPTIONAL_STATE_FILES = ["accounts.json", "audit.jsonl"];
const REQUIRED_CATALOG_FILES = [
  "advancement.json",
  "characters.json",
  "classes.json",
  "item-instance-schema-v13.sql",
  "itemization.json",
  "items.json",
  "monsters.json",
  "mounts.json",
  "skills.json",
];
const STATE_NAMES = new Set([
  ...REQUIRED_DATABASES,
  ...OPTIONAL_STATE_FILES,
  "player-accounts.sqlite-wal",
  "player-accounts.sqlite-shm",
  "world-monsters.sqlite-wal",
  "world-monsters.sqlite-shm",
]);
const SQLITE_SIDECARS = new Set([
  "player-accounts.sqlite-wal",
  "player-accounts.sqlite-shm",
  "world-monsters.sqlite-wal",
  "world-monsters.sqlite-shm",
]);
const MAX_MANIFEST_BYTES = 1024 * 1024;

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(".." + sep) &&
      !isAbsolute(pathFromParent))
  );
}

function assertOutsideRepository(path, label) {
  if (isWithin(REPOSITORY_ROOT_REAL, path)) {
    throw new Error(label + " precisa ficar fora do checkout Caracatoa.");
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function requireDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(label + " não foi encontrado.");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(label + " precisa ser uma pasta real, sem link simbólico.");
  }
  return realpath(path);
}

async function requireRegularFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(label + " não foi encontrado.");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(label + " precisa ser um arquivo regular.");
  }
  return path;
}

async function assertPathDoesNotExist(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(label + " já existe; nenhuma pasta foi alterada.");
}

async function resolveFuturePath(path) {
  let cursor = resolve(path);
  const missingParts = [];
  while (true) {
    try {
      await lstat(cursor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missingParts.unshift(basename(cursor));
      cursor = parent;
    }
  }
  let canonical = await realpath(cursor);
  for (const part of missingParts) canonical = join(canonical, part);
  return canonical;
}

async function prepareOutputDirectory(outputDirectory, label, protectedRoots = []) {
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) {
    throw new TypeError(label + " precisa ser informado.");
  }
  const requested = resolve(outputDirectory);
  assertOutsideRepository(requested, label);
  if (basename(requested).length === 0) {
    throw new Error(label + " não pode ser uma raiz de volume.");
  }
  await assertPathDoesNotExist(requested, label);
  const canonicalTarget = await resolveFuturePath(requested);
  assertOutsideRepository(canonicalTarget, label);
  if (
    protectedRoots.some(
      (root) =>
        isWithin(root, canonicalTarget) || isWithin(canonicalTarget, root),
    )
  ) {
    throw new Error(label + " não pode ficar dentro nem conter as pastas de origem.");
  }

  await mkdir(dirname(requested), { recursive: true });
  const actualOutput = await resolveFuturePath(requested);
  assertOutsideRepository(actualOutput, label);
  if (actualOutput !== canonicalTarget) {
    throw new Error(label + " mudou de destino durante a preparação.");
  }
  await assertPathDoesNotExist(actualOutput, label);
  return actualOutput;
}

async function prepareStagingDirectory(outputDirectory) {
  const staging = join(
    dirname(outputDirectory),
    "." + basename(outputDirectory) + ".staging-" + randomUUID(),
  );
  await mkdir(staging, { recursive: false });
  return staging;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function validateDatabase(path, label) {
  let database;
  try {
    database = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
    const rows = database.prepare("PRAGMA quick_check").all();
    if (rows.length !== 1 || rows[0].quick_check !== "ok") {
      throw new Error(label + " falhou no PRAGMA quick_check.");
    }
  } catch (error) {
    if (error?.message?.includes("PRAGMA quick_check")) throw error;
    throw new Error(label + " não pôde ser lido como SQLite válido.");
  } finally {
    database?.close();
  }
}

async function copyRegularFile(source, destination) {
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
}

async function collectStateFiles(stateDirectory) {
  const entries = await readdir(stateDirectory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("A pasta de estado contém uma entrada não suportada.");
    }
    if (!STATE_NAMES.has(entry.name)) {
      throw new Error(
        "A pasta de estado contém um arquivo não reconhecido: " + entry.name,
      );
    }
    await requireRegularFile(join(stateDirectory, entry.name), "Arquivo de estado");
    if (!SQLITE_SIDECARS.has(entry.name)) names.push(entry.name);
  }
  for (const name of REQUIRED_DATABASES) {
    if (!names.includes(name)) {
      throw new Error("A base SQLite obrigatória não existe: " + name);
    }
  }
  return names.sort(compareText);
}

async function collectCatalogFiles(catalogDirectory) {
  const entries = await readdir(catalogDirectory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("A pasta de catálogos contém uma entrada não suportada.");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|sql)$/i.test(entry.name)) {
      throw new Error(
        "A pasta de catálogos contém um arquivo não reconhecido: " + entry.name,
      );
    }
    await requireRegularFile(
      join(catalogDirectory, entry.name),
      "Arquivo de catálogo",
    );
    names.push(entry.name);
  }
  for (const name of REQUIRED_CATALOG_FILES) {
    if (!names.includes(name)) {
      throw new Error("O catálogo obrigatório não existe: " + name);
    }
  }
  return names.sort(compareText);
}

async function createFileRecord(root, relativePath, type) {
  const path = join(root, ...relativePath.split("/"));
  await validateStructuredFile(path, type, relativePath);
  const metadata = await stat(path);
  return {
    path: relativePath,
    type,
    sizeBytes: metadata.size,
    sha256: await hashFile(path),
  };
}

async function validateStructuredFile(path, type, label) {
  if (type === "json") {
    try {
      JSON.parse(await readFile(path, "utf8"));
    } catch {
      // Parser messages may contain account data. Report only the file label.
      throw new Error("JSON inválido em " + label + ".");
    }
  } else if (type === "jsonl") {
    const input = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    let readFailed = false;
    input.on("error", () => {
      readFailed = true;
      lines.close();
    });
    try {
      for await (const line of lines) {
        lineNumber += 1;
        JSON.parse(line);
      }
      if (readFailed) throw new Error("Audit read failed");
    } catch {
      throw new Error("JSONL inválido em " + label + " (linha " + lineNumber + ").");
    } finally {
      lines.close();
      input.destroy();
    }
  }
}

async function copySqliteSnapshot(sourcePath, destinationPath, name) {
  await validateDatabase(sourcePath, "A base de origem " + name);
  let source;
  let destination;
  try {
    source = new DatabaseSync(sourcePath, {
      readOnly: true,
      timeout: 5000,
    });
    await backup(source, destinationPath);
  } catch {
    throw new Error("Não foi possível criar o snapshot SQLite de " + name + ".");
  } finally {
    source?.close();
  }

  try {
    destination = new DatabaseSync(destinationPath, { timeout: 5000 });
    const journalMode = destination
      .prepare("PRAGMA journal_mode = DELETE")
      .get();
    if (journalMode?.journal_mode !== "delete") {
      throw new Error("O snapshot SQLite não pôde ser consolidado.");
    }
  } catch {
    throw new Error("Não foi possível consolidar o snapshot SQLite de " + name + ".");
  } finally {
    destination?.close();
  }

  await rm(destinationPath + "-wal", { force: true });
  await rm(destinationPath + "-shm", { force: true });
  await validateDatabase(destinationPath, "O snapshot de " + name);
}

function typeForManifestPath(relativePath) {
  if (
    relativePath === "state/player-accounts.sqlite" ||
    relativePath === "state/world-monsters.sqlite"
  ) {
    return "sqlite";
  }
  if (
    relativePath === "state/accounts.json" ||
    /^catalogs\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/i.test(relativePath)
  ) {
    return "json";
  }
  if (relativePath === "state/audit.jsonl") return "jsonl";
  if (
    /^catalogs\/[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/i.test(relativePath)
  ) {
    return "sql";
  }
  return null;
}

function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.format !== CARACATOA_LOCAL_BACKUP_FORMAT ||
    manifest.version !== CARACATOA_LOCAL_BACKUP_VERSION ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length <
      REQUIRED_DATABASES.length + REQUIRED_CATALOG_FILES.length ||
    manifest.files.length > 1000
  ) {
    throw new Error("Manifesto de backup inválido ou incompatível.");
  }

  const seen = new Set();
  let previousPath = "";
  for (const file of manifest.files) {
    const expectedType = typeForManifestPath(file?.path);
    if (
      !expectedType ||
      file.type !== expectedType ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      seen.has(file.path) ||
      compareText(previousPath, file.path) >= 0
    ) {
      throw new Error("Manifesto contém registro de arquivo inválido.");
    }
    seen.add(file.path);
    previousPath = file.path;
  }

  for (const name of REQUIRED_DATABASES) {
    if (!seen.has("state/" + name)) {
      throw new Error("Manifesto não inclui a base obrigatória " + name + ".");
    }
  }
  for (const name of REQUIRED_CATALOG_FILES) {
    if (!seen.has("catalogs/" + name)) {
      throw new Error("Manifesto não inclui o catálogo obrigatório " + name + ".");
    }
  }
}

async function listBackupFiles(backupDirectory) {
  const rootEntries = await readdir(backupDirectory, { withFileTypes: true });
  const rootNames = new Set(rootEntries.map((entry) => entry.name));
  if (
    rootNames.size !== 3 ||
    !rootNames.has("manifest.json") ||
    !rootNames.has("state") ||
    !rootNames.has("catalogs")
  ) {
    throw new Error("A pasta não corresponde ao formato de backup Caracatoa.");
  }

  const manifestPath = join(backupDirectory, "manifest.json");
  const manifestInfo = await lstat(manifestPath);
  const stateInfo = await lstat(join(backupDirectory, "state"));
  const catalogInfo = await lstat(join(backupDirectory, "catalogs"));
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    !stateInfo.isDirectory() ||
    stateInfo.isSymbolicLink() ||
    !catalogInfo.isDirectory() ||
    catalogInfo.isSymbolicLink()
  ) {
    throw new Error("A estrutura do backup contém um tipo de arquivo inválido.");
  }

  const files = [];
  for (const [folder, prefix] of [
    [join(backupDirectory, "state"), "state/"],
    [join(backupDirectory, "catalogs"), "catalogs/"],
  ]) {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error("O backup contém uma entrada não suportada.");
      }
      files.push(prefix + entry.name);
    }
  }
  return files.sort(compareText);
}

async function readAndVerifyBackup(backupDirectory) {
  const actualBackup = await requireDirectory(backupDirectory, "Backup");
  assertOutsideRepository(actualBackup, "O backup");
  const manifestPath = join(actualBackup, "manifest.json");
  await requireRegularFile(manifestPath, "Manifesto do backup");
  const manifestInfo = await stat(manifestPath);
  if (manifestInfo.size > MAX_MANIFEST_BYTES) {
    throw new Error("Manifesto do backup excede o limite permitido.");
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("Manifesto do backup não contém JSON válido.");
  }
  validateManifest(manifest);

  const actualFiles = await listBackupFiles(actualBackup);
  const expectedFiles = manifest.files.map((file) => file.path);
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index])
  ) {
    throw new Error("Os arquivos presentes não correspondem ao manifesto.");
  }

  for (const file of manifest.files) {
    const path = join(actualBackup, ...file.path.split("/"));
    await requireRegularFile(path, "Arquivo do backup");
    const metadata = await stat(path);
    if (
      metadata.size !== file.sizeBytes ||
      (await hashFile(path)) !== file.sha256
    ) {
      throw new Error("A verificação de integridade falhou para " + file.path + ".");
    }
    if (file.type === "sqlite") {
      await validateDatabase(path, "A base do backup " + file.path);
    }
    await validateStructuredFile(path, file.type, file.path);
  }
  return { backupDirectory: actualBackup, manifest };
}

async function writeManifest(path, manifest) {
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function createCaracatoaLocalBackup({
  stateDirectory,
  catalogDirectory,
  outputDirectory,
}) {
  const stateRoot = await requireDirectory(stateDirectory, "Pasta de estado");
  const catalogRoot = await requireDirectory(
    catalogDirectory,
    "Pasta de catálogos",
  );
  if (
    isWithin(stateRoot, catalogRoot) ||
    isWithin(catalogRoot, stateRoot)
  ) {
    throw new Error("As pastas de estado e catálogos precisam ser separadas.");
  }
  const target = await prepareOutputDirectory(
    outputDirectory,
    "Destino do backup",
    [stateRoot, catalogRoot],
  );
  if (
    isWithin(stateRoot, target) ||
    isWithin(target, stateRoot) ||
    isWithin(catalogRoot, target) ||
    isWithin(target, catalogRoot)
  ) {
    throw new Error("O destino do backup precisa ficar fora das pastas de origem.");
  }

  const stateFiles = await collectStateFiles(stateRoot);
  const catalogFiles = await collectCatalogFiles(catalogRoot);
  const staging = await prepareStagingDirectory(target);
  try {
    await mkdir(join(staging, "state"));
    await mkdir(join(staging, "catalogs"));
    const files = [];

    for (const name of stateFiles) {
      const destination = join(staging, "state", name);
      if (REQUIRED_DATABASES.includes(name)) {
        await copySqliteSnapshot(
          join(stateRoot, name),
          destination,
          name,
        );
        files.push(
          await createFileRecord(
            staging,
            "state/" + name,
            "sqlite",
          ),
        );
      } else {
        await copyRegularFile(join(stateRoot, name), destination);
        files.push(
          await createFileRecord(
            staging,
            "state/" + name,
            name === "audit.jsonl" ? "jsonl" : "json",
          ),
        );
      }
    }

    for (const name of catalogFiles) {
      await copyRegularFile(join(catalogRoot, name), join(staging, "catalogs", name));
      files.push(
        await createFileRecord(
          staging,
          "catalogs/" + name,
          name.endsWith(".sql") ? "sql" : "json",
        ),
      );
    }

    files.sort((left, right) => compareText(left.path, right.path));
    const manifest = {
      format: CARACATOA_LOCAL_BACKUP_FORMAT,
      version: CARACATOA_LOCAL_BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      files,
    };
    await writeManifest(join(staging, "manifest.json"), manifest);
    await rename(staging, target);
    return {
      outputDirectory: target,
      fileCount: files.length,
      sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreCaracatoaLocalBackup({
  backupDirectory,
  outputRoot,
}) {
  const { backupDirectory: source, manifest } =
    await readAndVerifyBackup(backupDirectory);
  const target = await prepareOutputDirectory(
    outputRoot,
    "Pasta de restauração",
    [source],
  );
  if (isWithin(source, target) || isWithin(target, source)) {
    throw new Error("A restauração precisa ficar fora da pasta do backup.");
  }

  const staging = await prepareStagingDirectory(target);
  try {
    await mkdir(join(staging, "state"));
    await mkdir(join(staging, "catalogs"));
    for (const file of manifest.files) {
      const sourcePath = join(source, ...file.path.split("/"));
      const destinationPath = join(staging, ...file.path.split("/"));
      await copyRegularFile(sourcePath, destinationPath);
      const copied = await stat(destinationPath);
      if (
        copied.size !== file.sizeBytes ||
        (await hashFile(destinationPath)) !== file.sha256
      ) {
        throw new Error("A cópia de restauração divergiu em " + file.path + ".");
      }
      if (file.type === "sqlite") {
        await validateDatabase(destinationPath, "A base restaurada " + file.path);
      }
    }
    await copyRegularFile(
      join(source, "manifest.json"),
      join(staging, "manifest.json"),
    );
    await rename(staging, target);
    return {
      outputRoot: target,
      stateDirectory: join(target, "state"),
      catalogDirectory: join(target, "catalogs"),
      fileCount: manifest.files.length,
      sizeBytes: manifest.files.reduce((total, file) => total + file.sizeBytes, 0),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function parseCliOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      typeof key !== "string" ||
      !key.startsWith("--") ||
      !allowed.includes(key) ||
      Object.hasOwn(options, key) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Opções inválidas. Consulte --help.");
    }
    options[key] = value;
  }
  for (const key of allowed) {
    if (!options[key]) throw new Error("Opção obrigatória ausente: " + key);
  }
  return options;
}

export const CARACATOA_LOCAL_BACKUP_USAGE =
  "Uso:\n" +
  "  node local-state-backup.mjs create --state-dir <pasta> --catalog-dir <pasta> --out <nova-pasta>\n" +
  "  node local-state-backup.mjs restore --backup <pasta-backup> --out <nova-pasta>\n" +
  "O destino precisa ficar fora do checkout e ainda não pode existir.";

export async function runCaracatoaLocalBackupCli(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(CARACATOA_LOCAL_BACKUP_USAGE);
    return;
  }
  const [operation, ...optionsArgs] = args;
  if (operation === "create") {
    const options = parseCliOptions(optionsArgs, [
      "--state-dir",
      "--catalog-dir",
      "--out",
    ]);
    const result = await createCaracatoaLocalBackup({
      stateDirectory: options["--state-dir"],
      catalogDirectory: options["--catalog-dir"],
      outputDirectory: options["--out"],
    });
    console.log(
      JSON.stringify({
        operation,
        outputDirectory: result.outputDirectory,
        files: result.fileCount,
        sizeBytes: result.sizeBytes,
      }),
    );
    return;
  }
  if (operation === "restore") {
    const options = parseCliOptions(optionsArgs, ["--backup", "--out"]);
    const result = await restoreCaracatoaLocalBackup({
      backupDirectory: options["--backup"],
      outputRoot: options["--out"],
    });
    console.log(
      JSON.stringify({
        operation,
        outputRoot: result.outputRoot,
        stateDirectory: result.stateDirectory,
        catalogDirectory: result.catalogDirectory,
        files: result.fileCount,
        sizeBytes: result.sizeBytes,
      }),
    );
    return;
  }
  throw new Error(CARACATOA_LOCAL_BACKUP_USAGE);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (
  invokedPath &&
  pathToFileURL(invokedPath).href === import.meta.url
) {
  runCaracatoaLocalBackupCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
