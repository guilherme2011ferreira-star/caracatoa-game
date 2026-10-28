import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 0;
const TIMEOUT_MS = 8000;
const PROFILE_ROOT = await mkdtemp(join(tmpdir(), 'caracatoa-frame-loopback-'));
const TRACE_PATH = resolve(PROFILE_ROOT, 'client-trace.log');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'usage: node tools/verify-local-frame-loopback.mjs <Caracatoa3DPreview.exe>');
assert.match(executable, /Caracatoa3DPreview\.exe$/i, 'only the local Caracatoa 3D preview build is accepted');

const fixtures = JSON.parse(await readFile(resolve(projectRoot, 'tests/fixtures/frame-vectors.synthetic.json'), 'utf8'));
assert.equal(fixtures.credentials, false);
assert.equal(fixtures.vectors.length, 5);

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const abort = deferred();
abort.promise.catch(() => {});
const handshake = deferred();
const socketClosed = deferred();
const frames = fixtures.vectors.slice(0, 3).map((vector) => Buffer.from(vector.wireHex, 'hex'));
const corruptFrame = Buffer.from(frames[0]);
corruptFrame[3] ^= 0x01;
const clientHandshake = Buffer.from([0x11, 0xf3, 0x11, 0x1f]);
let clientProcess;
let serverSocket;
let server;
let deadline;
let consoleOutput = '';
let traceOutput = '';
let receivedFromClient = Buffer.alloc(0);
let handshakeAccepted = false;
let testComplete = false;
let ownsTrace = false;

function fail(error) {
  abort.reject(error instanceof Error ? error : new Error(String(error)));
}

function decodedFrameCount() {
  const output = `${consoleOutput}\n${traceOutput}`;
  return [...output.matchAll(/(\d+) frame\(s\) local\(is\) decodificado\(s\)/g)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
}

async function refreshTrace() {
  try {
    traceOutput = await readFile(TRACE_PATH, 'utf8');
    ownsTrace = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function allOutput() {
  return `${consoleOutput}\n${traceOutput}`;
}

async function waitForDecodedFrames(expected) {
  const end = Date.now() + TIMEOUT_MS;
  while (Date.now() < end) {
    await refreshTrace();
    if (decodedFrameCount() >= expected) return;
    if (clientProcess?.exitCode !== null && clientProcess?.exitCode !== undefined) {
      throw new Error(`Defold saiu antes de decodificar fixtures (exit ${clientProcess.exitCode}).\n${allOutput()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timeout aguardando ${expected} frames decodificados. Saída: ${allOutput() || '<vazia>'}`);
}

async function waitForOutput(fragment) {
  const end = Date.now() + TIMEOUT_MS;
  while (Date.now() < end) {
    await refreshTrace();
    if (allOutput().includes(fragment)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timeout aguardando '${fragment}'. Saída: ${allOutput() || '<vazia>'}`);
}

async function waitForSessionSelfTestAndHandshake() {
  const end = Date.now() + TIMEOUT_MS;
  while (Date.now() < end) {
    await refreshTrace();
    if (allOutput().includes('SESSION_FIXTURES_FAIL:')) {
      throw new Error(`Defold recusou fixtures Lua de sessão: ${allOutput()}`);
    }
    if (allOutput().includes('SESSION_FIXTURES_PASS') && handshakeAccepted) return;
    if (clientProcess?.exitCode !== null && clientProcess?.exitCode !== undefined) {
      throw new Error(`Defold saiu antes do autoteste/handshake (exit ${clientProcess.exitCode}). ${allOutput()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timeout aguardando autoteste de sessão e handshake. Saída: ${allOutput() || '<vazia>'}`);
}

try {
  await mkdir(`${PROFILE_ROOT}\\appdata`, { recursive: true });
  await mkdir(`${PROFILE_ROOT}\\localappdata`, { recursive: true });
  try {
    await readFile(TRACE_PATH);
    throw new Error(`O caminho de trace de teste já existe e não será sobrescrito: ${TRACE_PATH}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  server = net.createServer((connection) => {
    if (serverSocket) {
      connection.destroy();
      fail(new Error('O cliente abriu mais de uma conexão no teste local.'));
      return;
    }
    serverSocket = connection;
    serverSocket.setNoDelay(true);
    serverSocket.on('error', fail);
    serverSocket.on('close', () => socketClosed.resolve());
    serverSocket.on('data', (chunk) => {
      if (handshakeAccepted) {
        receivedFromClient = Buffer.concat([receivedFromClient, chunk]);
        if (receivedFromClient.length > 0) {
          fail(new Error('O cliente enviou bytes além do handshake no teste sem sessão.'));
        }
        return;
      }

      receivedFromClient = Buffer.concat([receivedFromClient, chunk]);
      if (receivedFromClient.length < clientHandshake.length) return;
      if (!receivedFromClient.subarray(0, clientHandshake.length).equals(clientHandshake)) {
        fail(new Error(`Handshake inesperado: ${receivedFromClient.toString('hex')}`));
        return;
      }
      if (receivedFromClient.length !== clientHandshake.length) {
        fail(new Error('O cliente enviou payload junto ao handshake; sessão não esperada.'));
        return;
      }

      handshakeAccepted = true;
      handshake.resolve();

      serverSocket.write(frames[0].subarray(0, 5));
      setTimeout(() => {
        if (!serverSocket.destroyed) {
          serverSocket.write(Buffer.concat([frames[0].subarray(5), frames[1], frames[2]]));
        }
      }, 150);
    });
  });

  server.on('error', fail);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(PORT, HOST, resolveListen);
  });
  const testPort = server.address().port;

  clientProcess = spawn(executable, [], {
    cwd: dirname(executable),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      APPDATA: `${PROFILE_ROOT}\\appdata`,
      LOCALAPPDATA: `${PROFILE_ROOT}\\localappdata`,
      CARACATOA_TEST_TRACE: TRACE_PATH,
      CARACATOA_SERVER_PORT: String(testPort),
    },
  });
  clientProcess.stdout.setEncoding('utf8');
  clientProcess.stderr.setEncoding('utf8');
  clientProcess.stdout.on('data', (chunk) => { consoleOutput += chunk; });
  clientProcess.stderr.on('data', (chunk) => { consoleOutput += chunk; });
  clientProcess.once('error', fail);
  clientProcess.once('exit', (code) => {
    if (!testComplete) fail(new Error(`Defold saiu antes de concluir o teste (exit ${code}).`));
  });

  deadline = setTimeout(() => fail(new Error(`Timeout geral. Saída do cliente: ${allOutput() || '<vazia>'}`)), TIMEOUT_MS + 2000);
  await Promise.race([waitForSessionSelfTestAndHandshake(), abort.promise]);
  await Promise.race([waitForDecodedFrames(3), abort.promise]);
  assert.equal(decodedFrameCount(), 3, 'o cliente deve decodificar exatamente três frames sintéticos');
  assert.equal(receivedFromClient.length, clientHandshake.length, 'nenhum login ou pacote de sessão foi enviado');

  serverSocket.write(corruptFrame);
  await Promise.race([waitForOutput('Frame local rejeitado:'), abort.promise]);
  await Promise.race([socketClosed.promise, abort.promise]);
  assert.match(allOutput(), /Frame local rejeitado:/, 'o cliente deve registrar a rejeição do checksum inválido');
  testComplete = true;

  console.log('PASS Defold recebeu três frames sintéticos em loopback, incluindo fragmentação e coalescência.');
  console.log('PASS Defold rejeitou o frame com checksum adulterado e fechou o socket.');
  console.log('PASS Os builders/parsers Lua de sessão passaram autoteste no runtime sem enviar pedidos de sessão.');
  console.log('PASS O único payload enviado pelo cliente foi o handshake; nenhuma sessão ou credencial foi usada.');
} finally {
  clearTimeout(deadline);
  if (clientProcess && clientProcess.exitCode === null) {
    clientProcess.kill();
    await Promise.race([once(clientProcess, 'exit'), new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))]);
  }
  if (serverSocket && !serverSocket.destroyed) serverSocket.destroy();
  if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(PROFILE_ROOT, { recursive: true, force: true });
}
