import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWyd727CharacterToWorldBody } from "./wyd-727-world-entry.mjs";
import {
  DEFAULT_WYD727_CLASS_CATALOG,
  getWyd727ClassEntry,
  loadWyd727ClassEntry,
  validateWyd727ClassCatalog,
} from "./wyd-727-class-catalog.mjs";

test("default catalog matches the four classes supported by the client", async () => {
  const catalogPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "data",
    "catalogs",
    "classes.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  assert.equal(validateWyd727ClassCatalog(catalog), catalog);
  assert.deepEqual(
    catalog.entries.map(({ id, name }) => [id, name]),
    [
      ["0", "TransKnight"],
      ["1", "Foema"],
      ["2", "BeastMaster"],
      ["3", "Huntress"],
    ],
  );
  assert.deepEqual(getWyd727ClassEntry(catalog, 3), catalog.entries[3]);
  assert.equal(getWyd727ClassEntry(catalog, 4), null);
});

test("class catalog rejects missing IDs, a fifth class, and invalid wire stats", () => {
  const missing = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  missing.entries.pop();
  assert.throws(
    () => validateWyd727ClassCatalog(missing),
    /classes de ID 0 a 3/,
  );

  const extra = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  extra.entries[3].id = "4";
  assert.throws(() => validateWyd727ClassCatalog(extra), /registro de classe/i);

  const invalidSpeed = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  invalidSpeed.entries[1].properties.startingStats.movementSpeed = 8;
  assert.throws(
    () => validateWyd727ClassCatalog(invalidSpeed),
    /movementSpeed/,
  );

  const invalidHealth = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  invalidHealth.entries[1].properties.startingStats.currentHp = 101;
  assert.throws(
    () => validateWyd727ClassCatalog(invalidHealth),
    /HP\/MP atuais/,
  );

  const unknownField = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  unknownField.entries[1].properties.startingStats.newStat = 1;
  assert.throws(
    () => validateWyd727ClassCatalog(unknownField),
    /exatamente os campos/,
  );
});

test("local class edits populate BaseScore and FinalScore in the WYD 7.27 0x114", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "caracatoa-class-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalogPath = join(directory, "classes.json");
  const catalog = structuredClone(DEFAULT_WYD727_CLASS_CATALOG);
  catalog.entries[1].properties.startingStats = {
    ...catalog.entries[1].properties.startingStats,
    damage: 41,
    movementSpeed: 5,
    maxHp: 180,
    currentHp: 170,
    maxMp: 140,
    currentMp: 130,
    str: 22,
    int: 17,
    dex: 14,
    con: 13,
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, "utf8");

  const definition = await loadWyd727ClassEntry(catalogPath, 1);
  const body = buildWyd727CharacterToWorldBody({
    clientId: 0x1234,
    character: {
      name: "Aria_01",
      classId: 1,
      level: 1,
      gold: 0,
    },
    classStats: definition.properties.startingStats,
    position: { x: 321, y: 123 },
  });

  assert.equal(body.readInt32LE(64), 41); // BaseScore.damage
  assert.equal(body.readUInt8(69), 5); // BaseScore.movementSpeed
  assert.equal(body.readInt32LE(72), 180); // BaseScore.maxHp
  assert.equal(body.readInt32LE(80), 170); // BaseScore.currentHp
  assert.equal(body.readUInt16LE(88), 22); // BaseScore.str
  assert.equal(body.readInt32LE(112), 41); // FinalScore.damage
  assert.equal(body.readUInt8(117), 5); // FinalScore.movementSpeed
  assert.equal(body.readInt32LE(120), 180); // FinalScore.maxHp
  assert.equal(body.readInt32LE(128), 170); // FinalScore.currentHp
  assert.equal(body.readUInt16LE(136), 22); // FinalScore.str
});
