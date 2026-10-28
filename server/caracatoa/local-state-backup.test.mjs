import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createCaracatoaLocalBackup,
  restoreCaracatoaLocalBackup,
} from "./local-state-backup.mjs";

const execFileAsync = promisify(execFile);
const DATABASES = ["player-accounts.sqlite", "world-monsters.sqlite"];
const REQUIRED_CATALOGS = [
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

async function createFixture(t) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "caracatoa-local-state-backup-"),
  );

  const stateDirectory = join(temporaryRoot, "source-state");
  const catalogDirectory = join(temporaryRoot, "source-catalogs");
  await mkdir(stateDirectory);
  await mkdir(catalogDirectory);

  const databases = new Map();
  for (const filename of DATABASES) {
    const database = new DatabaseSync(join(stateDirectory, filename));
    database.exec(
      "PRAGMA journal_mode = WAL; " +
        "CREATE TABLE fixture_state (value TEXT NOT NULL);",
    );
    database
      .prepare("INSERT INTO fixture_state (value) VALUES (?)")
      .run("snapshot-value:" + filename);
    databases.set(filename, database);
  }

  await writeFile(
    join(stateDirectory, "accounts.json"),
    '{"account":"synthetic-account","passwordHash":"synthetic-only"}\n',
  );
  await writeFile(
    join(stateDirectory, "audit.jsonl"),
    '{"event":"synthetic-fixture","actor":"fixture-only"}\n',
  );
  for (const filename of REQUIRED_CATALOGS) {
    await writeFile(
      join(catalogDirectory, filename),
      filename.endsWith(".sql")
        ? "-- synthetic catalog schema\n"
        : '{"fixture":"synthetic-only"}\n',
    );
  }

  t.after(async () => {
    for (const database of databases.values()) database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  return { temporaryRoot, stateDirectory, catalogDirectory, databases };
}

test("backup and staged restore preserve a SQLite WAL snapshot and catalogs", async (t) => {
  const fixture = await createFixture(t);
  const backupDirectory = join(fixture.temporaryRoot, "backup");
  const outputRoot = join(fixture.temporaryRoot, "restored");

  const created = await createCaracatoaLocalBackup({
    stateDirectory: fixture.stateDirectory,
    catalogDirectory: fixture.catalogDirectory,
    outputDirectory: backupDirectory,
  });
  assert.equal(created.fileCount, DATABASES.length + 2 + REQUIRED_CATALOGS.length);
  assert.ok(created.sizeBytes > 0);
  assert.ok((await stat(join(backupDirectory, "manifest.json"))).isFile());

  for (const [filename, database] of fixture.databases) {
    database
      .prepare("UPDATE fixture_state SET value = ?")
      .run("changed-after-snapshot");
  }
  await writeFile(join(fixture.catalogDirectory, "items.json"), "changed\n");
  await writeFile(join(fixture.stateDirectory, "audit.jsonl"), "changed\n");

  const restored = await restoreCaracatoaLocalBackup({
    backupDirectory,
    outputRoot,
  });
  assert.equal(restored.fileCount, created.fileCount);
  assert.equal(restored.stateDirectory, join(outputRoot, "state"));
  assert.equal(restored.catalogDirectory, join(outputRoot, "catalogs"));
  assert.equal(
    await readFile(join(restored.catalogDirectory, "items.json"), "utf8"),
    '{"fixture":"synthetic-only"}\n',
  );
  assert.match(
    await readFile(join(restored.stateDirectory, "audit.jsonl"), "utf8"),
    /synthetic-fixture/,
  );

  for (const filename of DATABASES) {
    const restoredDatabase = new DatabaseSync(
      join(restored.stateDirectory, filename),
      { readOnly: true },
    );
    try {
      const row = restoredDatabase
        .prepare("SELECT value FROM fixture_state")
        .get();
      assert.equal(row.value, "snapshot-value:" + filename);
    } finally {
      restoredDatabase.close();
    }
  }
});

test("restore refuses a modified backup and leaves its destination absent", async (t) => {
  const fixture = await createFixture(t);
  const backupDirectory = join(fixture.temporaryRoot, "backup-tampered");
  const outputRoot = join(fixture.temporaryRoot, "must-not-exist");
  await createCaracatoaLocalBackup({
    stateDirectory: fixture.stateDirectory,
    catalogDirectory: fixture.catalogDirectory,
    outputDirectory: backupDirectory,
  });
  await writeFile(join(backupDirectory, "catalogs", "items.json"), "tampered\n");

  await assert.rejects(
    restoreCaracatoaLocalBackup({ backupDirectory, outputRoot }),
    /integridade falhou/,
  );
  await assert.rejects(stat(outputRoot), { code: "ENOENT" });
});

test("restore rejects manifest traversal before preparing a destination", async (t) => {
  const fixture = await createFixture(t);
  const backupDirectory = join(fixture.temporaryRoot, "backup-path-check");
  const outputRoot = join(fixture.temporaryRoot, "must-not-exist");
  await createCaracatoaLocalBackup({
    stateDirectory: fixture.stateDirectory,
    catalogDirectory: fixture.catalogDirectory,
    outputDirectory: backupDirectory,
  });
  const manifestPath = join(backupDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files[0].path = "../../escape.json";
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(
    restoreCaracatoaLocalBackup({ backupDirectory, outputRoot }),
    /registro de arquivo inválido/,
  );
  await assert.rejects(stat(outputRoot), { code: "ENOENT" });
  await assert.rejects(stat(join(fixture.temporaryRoot, "escape.json")), {
    code: "ENOENT",
  });
});

test("backup does not create a destination hierarchy inside a source", async (t) => {
  const fixture = await createFixture(t);
  const forbiddenOutput = join(fixture.stateDirectory, "new-parent", "backup");

  await assert.rejects(
    createCaracatoaLocalBackup({
      stateDirectory: fixture.stateDirectory,
      catalogDirectory: fixture.catalogDirectory,
      outputDirectory: forbiddenOutput,
    }),
    /não pode ficar dentro nem conter/,
  );
  await assert.rejects(stat(join(fixture.stateDirectory, "new-parent")), {
    code: "ENOENT",
  });
});

test("backup refuses to replace an existing destination", async (t) => {
  const fixture = await createFixture(t);
  const outputDirectory = join(fixture.temporaryRoot, "existing-backup");
  await mkdir(outputDirectory);
  const sentinelPath = join(outputDirectory, "keep.txt");
  await writeFile(sentinelPath, "preserve synthetic sentinel\n");

  await assert.rejects(
    createCaracatoaLocalBackup({
      stateDirectory: fixture.stateDirectory,
      catalogDirectory: fixture.catalogDirectory,
      outputDirectory,
    }),
    /já existe/,
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "preserve synthetic sentinel\n");
});

test("backup requires the project catalog set before producing a snapshot", async (t) => {
  const fixture = await createFixture(t);
  const outputDirectory = join(fixture.temporaryRoot, "incomplete-backup");
  await rm(join(fixture.catalogDirectory, "skills.json"));

  await assert.rejects(
    createCaracatoaLocalBackup({
      stateDirectory: fixture.stateDirectory,
      catalogDirectory: fixture.catalogDirectory,
      outputDirectory,
    }),
    /catálogo obrigatório não existe: skills\.json/,
  );
  await assert.rejects(stat(outputDirectory), { code: "ENOENT" });
});

test("CLI creates and restores a synthetic backup", async (t) => {
  const fixture = await createFixture(t);
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "local-state-backup.mjs");
  const backupDirectory = join(fixture.temporaryRoot, "cli-backup");
  const outputRoot = join(fixture.temporaryRoot, "cli-restore");

  const created = await execFileAsync(process.execPath, [
    cliPath,
    "create",
    "--state-dir",
    fixture.stateDirectory,
    "--catalog-dir",
    fixture.catalogDirectory,
    "--out",
    backupDirectory,
  ]);
  assert.equal(JSON.parse(created.stdout).operation, "create");
  assert.equal(created.stderr, "");

  const restored = await execFileAsync(process.execPath, [
    cliPath,
    "restore",
    "--backup",
    backupDirectory,
    "--out",
    outputRoot,
  ]);
  assert.equal(JSON.parse(restored.stdout).operation, "restore");
  assert.equal(restored.stderr, "");
  for (const filename of DATABASES) {
    const database = new DatabaseSync(join(outputRoot, "state", filename), {
      readOnly: true,
    });
    try {
      assert.equal(
        database.prepare("SELECT value FROM fixture_state").get().value,
        "snapshot-value:" + filename,
      );
    } finally {
      database.close();
    }
  }
});

for (const relativePath of ['catalogs/items.json', 'state/accounts.json', 'state/audit.jsonl']) {
  test(`backup rejects truncated ${relativePath} without publishing or exposing its contents`, async (t) => {
    const fixture = await createFixture(t);
    const [folder, name] = relativePath.split('/');
    const source = join(folder === 'catalogs' ? fixture.catalogDirectory : fixture.stateDirectory, name);
    const invalid = '{"synthetic-private-marker":"unfinished';
    await writeFile(source, invalid);
    const outputDirectory = join(fixture.temporaryRoot, 'invalid-backup');
    await assert.rejects(createCaracatoaLocalBackup({ ...fixture, outputDirectory }), (error) => {
      assert.match(error.message, /JSONL? inválido/);
      assert.ok(error.message.includes(relativePath));
      assert.ok(!error.message.includes('synthetic-private-marker'));
      return true;
    });
    await assert.rejects(stat(outputDirectory), { code: 'ENOENT' });
    assert.equal(await readFile(source, 'utf8'), invalid);
    assert.ok(!(await readdir(fixture.temporaryRoot)).some(name => name.includes('.staging-')));
  });

  test(`restore rejects invalid ${relativePath} even when its manifest hash matches`, async (t) => {
    const fixture = await createFixture(t);
    const backupDirectory = join(fixture.temporaryRoot, 'valid-backup');
    await createCaracatoaLocalBackup({ ...fixture, outputDirectory: backupDirectory });
    const invalid = Buffer.from('{"synthetic-private-marker":');
    await writeFile(join(backupDirectory, ...relativePath.split('/')), invalid);
    const manifestPath = join(backupDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const record = manifest.files.find(file => file.path === relativePath);
    record.sizeBytes = invalid.length;
    record.sha256 = createHash('sha256').update(invalid).digest('hex');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const outputRoot = join(fixture.temporaryRoot, 'must-not-exist');
    await assert.rejects(restoreCaracatoaLocalBackup({ backupDirectory, outputRoot }), /JSONL? inválido/);
    await assert.rejects(stat(outputRoot), { code: 'ENOENT' });
  });
}

test('audit validation accepts empty logs and CRLF records without requiring a final newline', async (t) => {
  const fixture = await createFixture(t);
  for (const [index, content] of ['', '{"event":1}\r\n{"event":2}'].entries()) {
    await writeFile(join(fixture.stateDirectory, 'audit.jsonl'), content);
    const backupDirectory = join(fixture.temporaryRoot, `audit-backup-${index}`);
    await createCaracatoaLocalBackup({ ...fixture, outputDirectory: backupDirectory });
    const result = await restoreCaracatoaLocalBackup({ backupDirectory, outputRoot: join(fixture.temporaryRoot, `audit-restore-${index}`) });
    assert.equal(await readFile(join(result.stateDirectory, 'audit.jsonl'), 'utf8'), content);
  }
});

test('a truncated audit tail reports only its line and removes staging', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.stateDirectory, 'audit.jsonl'), '{"event":"ok"}\n{"privateMarker":"unfinished');
  const outputDirectory = join(fixture.temporaryRoot, 'truncated-audit');
  await assert.rejects(createCaracatoaLocalBackup({ ...fixture, outputDirectory }), (error) => {
    assert.equal(error.message, 'JSONL inválido em state/audit.jsonl (linha 2).');
    return true;
  });
  await assert.rejects(stat(outputDirectory), { code: 'ENOENT' });
  assert.ok(!(await readdir(fixture.temporaryRoot)).some(name => name.includes('.staging-')));
});
