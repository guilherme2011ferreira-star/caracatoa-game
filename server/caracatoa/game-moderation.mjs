const ACTIONS = new Set(["kill", "revive"]);

export class GameModerationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "GameModerationError";
    this.status = status;
    this.code = code;
  }
}

function requireStaff(actor) {
  if (!["admin", "moderator"].includes(actor?.role)) {
    throw new GameModerationError(
      403,
      "forbidden",
      "Somente admin ou moderador pode usar ações de jogo.",
    );
  }
}

function validateRequest(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(",") !==
      "action,clientEntityId,position" ||
    !ACTIONS.has(request.action) ||
    !Number.isInteger(request.clientEntityId) ||
    request.clientEntityId < 1000 ||
    request.clientEntityId > 0xffff ||
    !request.position ||
    typeof request.position !== "object" ||
    Array.isArray(request.position) ||
    Object.keys(request.position).sort().join(",") !== "x,y" ||
    !Number.isInteger(request.position.x) ||
    request.position.x < -0x8000 ||
    request.position.x > 0x7fff ||
    !Number.isInteger(request.position.y) ||
    request.position.y < -0x8000 ||
    request.position.y > 0x7fff
  ) {
    throw new GameModerationError(
      400,
      "invalid-input",
      "Informe action kill/revive, clientEntityId e posição Int16.",
    );
  }
}

function listenerError(error) {
  switch (error?.code) {
    case "invalid-input":
      return new GameModerationError(400, error.code, error.message);
    case "monster-not-found":
      return new GameModerationError(404, error.code, error.message);
    case "monster-not-active":
    case "no-change":
      return new GameModerationError(409, error.code, error.message);
    case "clock-error":
      return new GameModerationError(503, error.code, error.message);
    default:
      return new GameModerationError(
        500,
        "moderation-failed",
        "Não foi possível aplicar a ação de moderação.",
      );
  }
}

export function createWyd727GameModerationService({ gameListener, audit }) {
  if (
    typeof gameListener?.listWorldMonsters !== "function" ||
    typeof gameListener?.moderateMonster !== "function"
  ) {
    throw new TypeError(
      "gameListener precisa fornecer listWorldMonsters e moderateMonster.",
    );
  }
  if (typeof audit !== "function") {
    throw new TypeError("audit precisa ser uma função.");
  }

  return Object.freeze({
    listMonsters(actor) {
      requireStaff(actor);
      return gameListener.listWorldMonsters();
    },

    async moderateMonster(actor, request) {
      requireStaff(actor);
      validateRequest(request);
      const { clientEntityId, position, action } = request;
      const targetId = `${clientEntityId}:${position.x}:${position.y}`;
      const before = gameListener
        .listWorldMonsters()
        .find(
          (monster) =>
            monster.clientEntityId === clientEntityId &&
            monster.position.x === position.x &&
            monster.position.y === position.y,
        );
      if (!before) {
        throw new GameModerationError(
          404,
          "monster-not-found",
          "Monstro não está carregado no mundo.",
        );
      }
      if (before.activeSessions < 1) {
        throw new GameModerationError(
          409,
          "monster-not-active",
          "Nenhuma sessão ativa está vendo este monstro.",
        );
      }
      if (
        (action === "kill" && before.currentHp === 0) ||
        (action === "revive" &&
          before.currentHp === before.maxHp &&
          before.respawnAt === 0)
      ) {
        throw new GameModerationError(
          409,
          "no-change",
          action === "kill"
            ? "O monstro já está morto."
            : "O monstro já está com HP máximo.",
        );
      }

      const afterRequest = { action, status: "requested" };
      await audit(
        actor,
        "game.monster.action.requested",
        "world-monster",
        targetId,
        before,
        afterRequest,
      );

      let after;
      try {
        after = gameListener.moderateMonster({
          clientEntityId,
          position,
          action,
        });
      } catch (error) {
        const failure = listenerError(error);
        try {
          await audit(
            actor,
            "game.monster.action.failed",
            "world-monster",
            targetId,
            before,
            { action, status: "failed", code: failure.code },
          );
        } catch {}
        throw failure;
      }

      await audit(
        actor,
        "game.monster.action.applied",
        "world-monster",
        targetId,
        before,
        { action, status: "applied", ...after },
      );
      return after;
    },
  });
}
