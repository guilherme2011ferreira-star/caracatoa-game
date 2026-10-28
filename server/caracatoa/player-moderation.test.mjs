import assert from "node:assert/strict";
import test from "node:test";
import {
  createWyd727PlayerModerationService,
  PlayerModerationError,
} from "./player-moderation.mjs";

function createFixture({ online = true, onAudit } = {}) {
  const account = { accountId: "testplayer", enabled: true };
  const sessions = online
    ? [
        {
          accountId: "testplayer",
          phase: "in-world",
          characterSlot: 2,
          position: { x: 321, y: 122 },
          clientId: 54,
          password: "must-not-leak",
        },
      ]
    : [];
  const events = [];
  let disconnected = 0;
  const service = createWyd727PlayerModerationService({
    playerAccountStore: {
      getAccount: (accountId) =>
        account.accountId === accountId ? { ...account } : null,
      setEnabled: (accountId, enabled) => {
        if (account.accountId !== accountId) return null;
        account.enabled = enabled;
        return { ...account };
      },
    },
    gameListener: {
      listOnlinePlayers: () =>
        sessions.map((session) => structuredClone(session)),
      disconnectPlayerAccount: (accountId) => {
        const matches = sessions.filter(
          (session) => session.accountId === accountId,
        );
        disconnected = matches.length;
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          if (sessions[index].accountId === accountId)
            sessions.splice(index, 1);
        }
        return disconnected;
      },
    },
    async audit(...event) {
      events.push(event);
      await onAudit?.(event, sessions);
    },
  });
  return {
    service,
    account,
    sessions,
    events,
    get disconnected() {
      return disconnected;
    },
  };
}

test("lista sessões sem expor campos internos e exige papel de staff", () => {
  const fixture = createFixture();
  assert.throws(
    () => fixture.service.listOnlinePlayers({ id: "player", role: "player" }),
    (error) => error instanceof PlayerModerationError && error.status === 403,
  );
  assert.deepEqual(
    fixture.service.listOnlinePlayers({ id: "mod", role: "moderator" }),
    [
      {
        accountId: "testplayer",
        enabled: true,
        sessionCount: 1,
        sessions: [
          {
            phase: "in-world",
            characterSlot: 2,
            position: { x: 321, y: 122 },
          },
        ],
      },
    ],
  );
});

test("suspende a conta, desconecta todas as sessões e audita motivo/ator", async () => {
  const fixture = createFixture();
  const result = await fixture.service.suspendAndDisconnect(
    { id: "moderator", role: "moderator" },
    { accountId: "TESTPLAYER", reason: "abuso no chat" },
  );

  assert.deepEqual(result, {
    account: { accountId: "testplayer", enabled: false },
    disconnectedSessions: 1,
    reason: "abuso no chat",
  });
  assert.equal(fixture.account.enabled, false);
  assert.equal(fixture.disconnected, 1);
  assert.deepEqual(
    fixture.events.map((event) => event[1]),
    ["game.player.suspend.requested", "game.player.suspend.applied"],
  );
  assert.ok(fixture.events.every((event) => event[0].id === "moderator"));
  assert.equal(fixture.events[0][5].reason, "abuso no chat");
  assert.equal(JSON.stringify(fixture.events).includes("must-not-leak"), false);
});

test("recusa conta inexistente ou sem sessão antes de auditar", async () => {
  const offline = createFixture({ online: false });
  await assert.rejects(
    offline.service.suspendAndDisconnect(
      { id: "admin", role: "admin" },
      { accountId: "testplayer", reason: "revisão manual" },
    ),
    (error) => error instanceof PlayerModerationError && error.status === 409,
  );
  await assert.rejects(
    offline.service.suspendAndDisconnect(
      { id: "admin", role: "admin" },
      { accountId: "missing", reason: "revisão manual" },
    ),
    (error) => error instanceof PlayerModerationError && error.status === 404,
  );
  assert.equal(offline.account.enabled, true);
  assert.equal(offline.events.length, 0);
});

test("valida formato exato e motivo de uma linha", async () => {
  const fixture = createFixture();
  const actor = { id: "moderator", role: "moderator" };
  for (const request of [
    { accountId: "testplayer", reason: "ab" },
    { accountId: "testplayer", reason: "motivo\nextra" },
    { accountId: "testplayer", reason: "motivo válido", extra: true },
    { accountId: "../state", reason: "motivo válido" },
  ]) {
    await assert.rejects(
      fixture.service.suspendAndDisconnect(actor, request),
      (error) => error instanceof PlayerModerationError && error.status === 400,
    );
  }
  assert.equal(fixture.account.enabled, true);
  assert.equal(fixture.events.length, 0);
});

test("revalida sessão após gravar o pedido e audita falha sem suspender", async () => {
  const fixture = createFixture({
    onAudit: async (event, sessions) => {
      if (event[1] === "game.player.suspend.requested") sessions.length = 0;
    },
  });
  await assert.rejects(
    fixture.service.suspendAndDisconnect(
      { id: "moderator", role: "moderator" },
      { accountId: "testplayer", reason: "sessão encerrada" },
    ),
    (error) => error instanceof PlayerModerationError && error.status === 409,
  );
  assert.equal(fixture.account.enabled, true);
  assert.deepEqual(
    fixture.events.map((event) => event[1]),
    ["game.player.suspend.requested", "game.player.suspend.failed"],
  );
});
