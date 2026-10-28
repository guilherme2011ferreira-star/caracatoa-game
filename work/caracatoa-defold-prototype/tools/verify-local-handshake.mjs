import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalGameListener } from '../../../server/caracatoa/game-listener.mjs';

const HOST = '127.0.0.1';
const PORT = 8289;
const HANDSHAKE_TIMEOUT_MS = 8000;
const executable = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'usage: node tools/verify-local-handshake.mjs <CaracatoaDefoldSpike.exe>');
assert.match(executable, /Caracatoa3DPreview\.exe$/i, 'only the local Caracatoa 3D preview build is accepted');
const PROFILE_ROOT = await mkdtemp(join(tmpdir(), 'caracatoa-handshake-'));
const appData = join(PROFILE_ROOT, 'appdata');
const localAppData = join(PROFILE_ROOT, 'localappdata');

const observed = [];
let resolveHandshake;
let rejectHandshake;
const handshakeReceived = new Promise((resolvePromise, rejectPromise) => {
  resolveHandshake = resolvePromise;
  rejectHandshake = rejectPromise;
});
const server = createLocalGameListener({
  authEnabled: false,
  idleTimeoutMs: 10000,
  onEvent(event) {
    observed.push(event.type);
    if (event.type === 'handshake') resolveHandshake();
  },
});
let clientProcess;
let timer;

try {
  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolveListen);
  });

  clientProcess = spawn(executable, [], {
    cwd: dirname(executable),
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
    },
  });
  clientProcess.once('error', rejectHandshake);
  clientProcess.once('exit', (code) => {
    if (code !== 0) rejectHandshake(new Error(`Defold client exited before server handshake (exit ${code}).`));
  });
  timer = setTimeout(() => rejectHandshake(new Error('Timed out waiting for the Caracatoa listener handshake event.')), HANDSHAKE_TIMEOUT_MS);
  await handshakeReceived;
  assert.ok(observed.includes('connection-open'));
  assert.ok(observed.includes('handshake'));
  console.log('PASS Defold client connected to 127.0.0.1:8289 and sent the WYD client handshake; no login or credentials were used.');
} finally {
  clearTimeout(timer);
  if (clientProcess && clientProcess.exitCode === null) {
    clientProcess.kill();
    await Promise.race([once(clientProcess, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
  }
  if (server.listening) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  await rm(PROFILE_ROOT, { recursive: true, force: true });
}
