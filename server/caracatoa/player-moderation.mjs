export class PlayerModerationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PlayerModerationError";
    this.status = status;
    this.code = code;
  }
}

function requireStaff(actor) {
  if (!["admin", "moderator"].includes(actor?.role)) {
    throw new PlayerModerationError(
      403,
      "forbidden",
      "Somente admin ou moderador pode suspender jogador online.",
    );
  }
}

function parseRequest(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(",") !== "accountId,reason" ||
    typeof request.accountId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/.test(request.accountId) ||
    typeof request.reason !== "string"
  ) {
    throw new PlayerModerationError(
      400,
      "invalid-input",
      "Informe somente accountId e um motivo de 3 a 200 caracteres.",
    );
  }
  const reason = request.reason.trim();
  if (
    reason.length < 3 ||
    reason.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(reason)
  ) {
    throw new PlayerModerationError(
      400,
      "invalid-input",
      "O motivo deve ter de 3 a 200 caracteres em uma única linha.",
    );
  }
  return { accountId: request.accountId.toLowerCase(), reason };
}

function safeSessions(sessions) {
  return sessions.map((session) => ({
    phase: session.phase,
    characterSlot: session.characterSlot,
    position: session.position
      ? { x: session.position.x, y: session.position.y }
      : null,
  }));
}

export function createWyd727PlayerModerationService({
  playerAccountStore,
  gameListener,
  audit,
} = {}) {
  if (
    typeof playerAccountStore?.getAccount !== "function" ||
    typeof playerAccountStore?.setEnabled !== "function" ||
    typeof gameListener?.listOnlinePlayers !== "function" ||
    typeof gameListener?.disconnectPlayerAccount !== "function"
  ) {
    throw new TypeError(
      "A moderação precisa do store de jogadores e do listener de sessões.",
    );
  }
  if (typeof audit !== "function") {
    throw new TypeError("audit precisa ser uma função.");
  }

  return Object.freeze({
    listOnlinePlayers(actor) {
      requireStaff(actor);
      const grouped = new Map();
      for (const session of gameListener.listOnlinePlayers()) {
        if (
          !session ||
          typeof session.accountId !== "string" ||
          !session.accountId
        ) {
          continue;
        }
        const sessions = grouped.get(session.accountId) ?? [];
        sessions.push(session);
        grouped.set(session.accountId, sessions);
      }
      return [...grouped]
        .map(([accountId, sessions]) => {
          const account = playerAccountStore.getAccount(accountId);
          if (!account) return null;
          return {
            accountId,
            enabled: account.enabled,
            sessionCount: sessions.length,
            sessions: safeSessions(sessions),
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.accountId.localeCompare(right.accountId));
    },

    async suspendAndDisconnect(actor, request) {
      requireStaff(actor);
      const { accountId, reason } = parseRequest(request);
      const account = playerAccountStore.getAccount(accountId);
      if (!account) {
        throw new PlayerModerationError(
          404,
          "account-not-found",
          "Conta de jogador não encontrada.",
        );
      }
      const sessions = gameListener
        .listOnlinePlayers()
        .filter((session) => session.accountId === accountId);
      if (sessions.length === 0) {
        throw new PlayerModerationError(
          409,
          "player-not-online",
          "A conta não possui uma sessão de jogo online.",
        );
      }

      const before = {
        enabled: account.enabled,
        sessionCount: sessions.length,
        sessions: safeSessions(sessions),
      };
      const targetId = accountId;
      await audit(
        actor,
        "game.player.suspend.requested",
        "player-account",
        targetId,
        before,
        { status: "requested", reason },
      );

      let after;
      try {
        const currentAccount = playerAccountStore.getAccount(accountId);
        if (!currentAccount) {
          throw new PlayerModerationError(
            404,
            "account-not-found",
            "Conta de jogador não encontrada.",
          );
        }
        const currentSessions = gameListener
          .listOnlinePlayers()
          .filter((session) => session.accountId === accountId);
        if (currentSessions.length === 0) {
          throw new PlayerModerationError(
            409,
            "player-not-online",
            "A sessão foi encerrada antes da suspensão.",
          );
        }

        const suspendedAccount = playerAccountStore.setEnabled(
          accountId,
          false,
        );
        if (!suspendedAccount) {
          throw new PlayerModerationError(
            404,
            "account-not-found",
            "Conta de jogador não encontrada.",
          );
        }
        const disconnectedSessions =
          gameListener.disconnectPlayerAccount(accountId);
        after = {
          enabled: suspendedAccount.enabled,
          status: "applied",
          disconnectedSessions,
          reason,
        };
      } catch (error) {
        const code =
          error instanceof PlayerModerationError
            ? error.code
            : "moderation-failed";
        try {
          await audit(
            actor,
            "game.player.suspend.failed",
            "player-account",
            targetId,
            before,
            { status: "failed", code, reason },
          );
        } catch {}
        if (error instanceof PlayerModerationError) throw error;
        throw new PlayerModerationError(
          500,
          "moderation-failed",
          "Não foi possível suspender e desconectar a conta.",
        );
      }

      await audit(
        actor,
        "game.player.suspend.applied",
        "player-account",
        targetId,
        before,
        after,
      );
      return {
        account: {
          accountId,
          enabled: after.enabled,
        },
        disconnectedSessions: after.disconnectedSessions,
        reason,
      };
    },
  });
}
