import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const roots = [join(root, "server", "caracatoa"), join(root, "tools", "preview")];
const tests = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) tests.push(path);
  }
}

for (const directory of roots) await collect(directory);
tests.sort();
if (tests.length === 0) throw new Error("No .test.mjs files found.");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...tests], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
