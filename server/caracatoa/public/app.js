const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const accountLabel = document.querySelector("#account-label");
const kindSelect = document.querySelector("#catalog-kind");
const entryList = document.querySelector("#entry-list");
const editor = document.querySelector("#entry-json");
const contentMessage = document.querySelector("#content-message");
const context = document.querySelector("#editor-context");
const state = document.querySelector("#record-state");
const deleteButton = document.querySelector("#delete-entry");
const saveButton = document.querySelector("#save-entry");
const labels = new Map();
let account = null;
let catalog = null;
let selectedId = null;
let creating = false;

function setMessage(element, text, kind = "") {
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error ?? "Falha na solicitação.");
    error.status = response.status;
    if (response.status === 401 && path !== "/api/v1/session") showLogin();
    throw error;
  }
  return payload;
}

function showLogin() {
  account = null;
  appView.hidden = true;
  loginView.hidden = false;
  document.querySelector("#login-id").focus();
}

async function showApp(currentAccount) {
  account = currentAccount;
  loginView.hidden = true;
  appView.hidden = false;
  document.querySelector("#content-view").hidden = false;
  document.querySelector("#staff-view").hidden = true;
  document.querySelector("#moderation-view").hidden = true;
  document.querySelector("#tab-content").classList.add("active");
  document.querySelector("#tab-staff").classList.remove("active");
  document.querySelector("#tab-moderation").classList.remove("active");
  accountLabel.textContent = `${account.displayName} · ${account.role === "admin" ? "Administrador" : "Moderador"}`;
  document.querySelector("#tab-staff").hidden = account.role !== "admin";
  await loadKinds();
}

function defaultEntry() {
  const prefixes = {
    items: "item",
    characters: "personagem",
    monsters: "monstro",
    classes: "classe",
    skills: "habilidade",
  };
  const prefix = prefixes[kindSelect.value] ?? "registro";
  return {
    id: `novo-${prefix}`,
    name: "Novo registro",
    description: "",
    enabled: true,
    properties: {},
  };
}

function setEditor(entry, isNew = false) {
  selectedId = isNew ? null : entry.id;
  creating = isNew;
  editor.value = JSON.stringify(entry, null, 2);
  context.textContent = `${labels.get(kindSelect.value) ?? kindSelect.value} · ${entry.name}`;
  state.textContent = isNew ? "Novo registro" : "Editando";
  deleteButton.disabled = isNew;
  saveButton.disabled = false;
  setMessage(contentMessage, "");
  renderEntries();
}

function renderEntries() {
  entryList.replaceChildren();
  if (!catalog || catalog.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Este catálogo ainda está vazio.";
    entryList.append(empty);
    return;
  }
  for (const entry of catalog.entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-row";
    if (entry.id === selectedId) button.classList.add("selected");
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const id = document.createElement("span");
    id.textContent = entry.id;
    button.append(title, id);
    button.addEventListener("click", () => setEditor(entry));
    entryList.append(button);
  }
}

async function loadCatalog() {
  setMessage(contentMessage, "Carregando catálogo…");
  try {
    catalog = await api(
      `/api/v1/catalogs/${encodeURIComponent(kindSelect.value)}`,
    );
    if (!catalog.entries.some((entry) => entry.id === selectedId)) {
      selectedId = null;
      creating = false;
      editor.value = "";
      context.textContent = `${labels.get(kindSelect.value) ?? kindSelect.value} · selecione ou crie um registro`;
      state.textContent = "Nenhum registro";
      deleteButton.disabled = true;
    }
    renderEntries();
    setMessage(
      contentMessage,
      `${catalog.entries.length} registro(s) carregado(s).`,
      "success",
    );
  } catch (error) {
    catalog = null;
    renderEntries();
    setMessage(contentMessage, error.message, "error");
    if (error.status === 401) showLogin();
  }
}

async function loadKinds() {
  if (!kindSelect.options.length) {
    const payload = await api("/api/v1/catalogs");
    for (const item of payload.catalogs) {
      labels.set(item.kind, item.label);
      const option = document.createElement("option");
      option.value = item.kind;
      option.textContent = item.label;
      kindSelect.append(option);
    }
  }
  await loadCatalog();
}

async function saveEntry() {
  let entry;
  try {
    entry = JSON.parse(editor.value);
  } catch {
    setMessage(contentMessage, "O texto não é JSON válido.", "error");
    return;
  }
  const editingId = creating ? null : selectedId;
  const url = editingId
    ? `/api/v1/catalogs/${encodeURIComponent(kindSelect.value)}/${encodeURIComponent(editingId)}`
    : `/api/v1/catalogs/${encodeURIComponent(kindSelect.value)}`;
  try {
    catalog = await api(url, {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    selectedId = entry.id;
    creating = false;
    renderEntries();
    setEditor(entry);
    setMessage(
      contentMessage,
      "Registro salvo. A alteração entrou na auditoria local.",
      "success",
    );
  } catch (error) {
    setMessage(contentMessage, error.message, "error");
    if (error.status === 401) showLogin();
  }
}

async function deleteEntry() {
  if (!selectedId || !window.confirm(`Excluir “${selectedId}” deste catálogo?`))
    return;
  try {
    await api(
      `/api/v1/catalogs/${encodeURIComponent(kindSelect.value)}/${encodeURIComponent(selectedId)}`,
      { method: "DELETE" },
    );
    selectedId = null;
    creating = false;
    editor.value = "";
    state.textContent = "Nenhum registro";
    context.textContent = `${labels.get(kindSelect.value) ?? kindSelect.value} · selecione ou crie um registro`;
    deleteButton.disabled = true;
    await loadCatalog();
    setMessage(
      contentMessage,
      "Registro excluído. A alteração entrou na auditoria local.",
      "success",
    );
  } catch (error) {
    setMessage(contentMessage, error.message, "error");
    if (error.status === 401) showLogin();
  }
}

function roleLabel(role) {
  return role === "admin" ? "Administrador" : "Moderador";
}

async function loadAccounts() {
  const container = document.querySelector("#account-list");
  container.replaceChildren();
  try {
    const payload = await api("/api/v1/accounts");
    if (!payload.accounts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "Nenhuma conta foi cadastrada.";
      container.append(empty);
      return;
    }
    for (const user of payload.accounts) {
      const row = document.createElement("article");
      row.className = "account-row";
      const heading = document.createElement("div");
      heading.className = "account-heading";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = user.displayName;
      const id = document.createElement("span");
      id.textContent = `${user.id} · ${roleLabel(user.role)}${user.enabled ? "" : " · desativada"}`;
      identity.append(name, id);
      heading.append(identity);

      const controls = document.createElement("div");
      controls.className = "account-controls";
      const role = document.createElement("select");
      role.setAttribute("aria-label", `Papel de ${user.id}`);
      role.innerHTML =
        '<option value="moderator">Moderador</option><option value="admin">Administrador</option>';
      role.value = user.role;
      const saveRole = document.createElement("button");
      saveRole.type = "button";
      saveRole.className = "button button-secondary";
      saveRole.textContent = "Salvar papel";
      saveRole.addEventListener("click", async () => {
        try {
          await api(`/api/v1/accounts/${encodeURIComponent(user.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: role.value }),
          });
          setMessage(
            document.querySelector("#account-message"),
            `Papel de ${user.id} atualizado.`,
            "success",
          );
          await loadAccounts();
          await loadAudit();
        } catch (error) {
          setMessage(
            document.querySelector("#account-message"),
            error.message,
            "error",
          );
        }
      });
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "button button-secondary";
      toggle.textContent = user.enabled ? "Desativar" : "Reativar";
      toggle.disabled = user.id === account.id;
      toggle.addEventListener("click", async () => {
        try {
          await api(`/api/v1/accounts/${encodeURIComponent(user.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !user.enabled }),
          });
          setMessage(
            document.querySelector("#account-message"),
            `Conta ${user.id} atualizada.`,
            "success",
          );
          await loadAccounts();
          await loadAudit();
        } catch (error) {
          setMessage(
            document.querySelector("#account-message"),
            error.message,
            "error",
          );
        }
      });
      const resetInput = document.createElement("input");
      resetInput.type = "password";
      resetInput.minLength = 12;
      resetInput.maxLength = 128;
      resetInput.autocomplete = "new-password";
      resetInput.placeholder = "Nova senha (12+ caracteres)";
      resetInput.setAttribute("aria-label", `Nova senha de ${user.id}`);
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "button button-secondary";
      reset.textContent = "Redefinir senha";
      reset.addEventListener("click", async () => {
        if (resetInput.value.length < 12) {
          setMessage(
            document.querySelector("#account-message"),
            "A nova senha precisa ter ao menos 12 caracteres.",
            "error",
          );
          return;
        }
        try {
          await api(`/api/v1/accounts/${encodeURIComponent(user.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: resetInput.value }),
          });
          resetInput.value = "";
          setMessage(
            document.querySelector("#account-message"),
            `Senha de ${user.id} redefinida.`,
            "success",
          );
          await loadAccounts();
          await loadAudit();
        } catch (error) {
          setMessage(
            document.querySelector("#account-message"),
            error.message,
            "error",
          );
        }
      });
      controls.append(role, saveRole, toggle, resetInput, reset);
      row.append(heading, controls);
      container.append(row);
    }
  } catch (error) {
    setMessage(
      document.querySelector("#account-message"),
      error.message,
      "error",
    );
    if (error.status === 401) showLogin();
  }
}

async function loadPlayerAccounts() {
  const container = document.querySelector("#player-account-list");
  container.replaceChildren();
  try {
    const payload = await api("/api/v1/player-accounts");
    if (!payload.accounts.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "Nenhuma conta de jogador foi criada.";
      container.append(empty);
      return;
    }
    for (const player of payload.accounts) {
      const row = document.createElement("article");
      row.className = "account-row";
      const heading = document.createElement("div");
      heading.className = "account-heading";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = player.accountId;
      const state = document.createElement("span");
      const tokenStatus = player.tokenConfigured
        ? "token configurado"
        : "token pendente";
      state.textContent = `${player.enabled ? "Ativa" : "Desativada"} · ${tokenStatus} · criada ${new Date(player.createdAt).toLocaleString()}`;
      identity.append(name, state);
      heading.append(identity);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "button button-secondary";
      toggle.textContent = player.enabled
        ? "Desativar login"
        : "Reativar login";
      toggle.addEventListener("click", async () => {
        try {
          await api(
            `/api/v1/player-accounts/${encodeURIComponent(player.accountId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: !player.enabled }),
            },
          );
          setMessage(
            document.querySelector("#player-account-message"),
            `Conta ${player.accountId} atualizada.`,
            "success",
          );
          await Promise.all([loadPlayerAccounts(), loadAudit()]);
        } catch (error) {
          setMessage(
            document.querySelector("#player-account-message"),
            error.message,
            "error",
          );
        }
      });
      const tokenControls = document.createElement("div");
      tokenControls.className = "player-token-controls";
      const tokenInput = document.createElement("input");
      tokenInput.type = "password";
      tokenInput.inputMode = "numeric";
      tokenInput.minLength = 4;
      tokenInput.maxLength = 6;
      tokenInput.pattern = "[0-9]{4,6}";
      tokenInput.autocomplete = "new-password";
      tokenInput.placeholder = "Novo token (4 a 6 dígitos)";
      tokenInput.setAttribute(
        "aria-label",
        `Novo token numérico de ${player.accountId}`,
      );
      const resetToken = document.createElement("button");
      resetToken.type = "button";
      resetToken.className = "button button-secondary";
      resetToken.textContent = "Redefinir token";
      resetToken.addEventListener("click", async () => {
        if (!/^\d{4,6}$/.test(tokenInput.value)) {
          setMessage(
            document.querySelector("#player-account-message"),
            "O token precisa ter de 4 a 6 dígitos.",
            "error",
          );
          return;
        }
        try {
          await api(
            `/api/v1/player-accounts/${encodeURIComponent(player.accountId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: tokenInput.value }),
            },
          );
          tokenInput.value = "";
          setMessage(
            document.querySelector("#player-account-message"),
            `Token de ${player.accountId} redefinido.`,
            "success",
          );
          await Promise.all([loadPlayerAccounts(), loadAudit()]);
        } catch (error) {
          setMessage(
            document.querySelector("#player-account-message"),
            error.message,
            "error",
          );
        }
      });
      tokenControls.append(tokenInput, resetToken);
      row.append(heading, toggle, tokenControls);
      container.append(row);
    }
  } catch (error) {
    setMessage(
      document.querySelector("#player-account-message"),
      error.message,
      "error",
    );
    if (error.status === 401) showLogin();
  }
}

async function loadAudit() {
  const container = document.querySelector("#audit-list");
  container.replaceChildren();
  try {
    const payload = await api("/api/v1/audit?limit=100");
    if (!payload.events.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "Nenhuma alteração foi registrada ainda.";
      container.append(empty);
      return;
    }
    for (const event of payload.events) {
      const row = document.createElement("article");
      row.className = "audit-row";
      const action = document.createElement("strong");
      const actionNames = {
        "catalog.create": "Criou registro",
        "catalog.update": "Editou registro",
        "catalog.delete": "Excluiu registro",
        "account.create": "Criou conta",
        "account.update": "Alterou conta",
        "player-account.create": "Criou conta de jogador",
        "player-account.update": "Alterou conta de jogador",
        "player-account.token-reset": "Redefiniu token de jogador",
        "game.monster.action.requested": "Solicitou ação em monstro",
        "game.monster.action.applied": "Aplicou ação em monstro",
        "game.monster.action.failed": "Falhou ação em monstro",
        "game.player.suspend.requested": "Solicitou suspensão de jogador",
        "game.player.suspend.applied": "Suspendeu e desconectou jogador",
        "game.player.suspend.failed": "Falhou suspensão de jogador",
      };
      const moderationActions = { kill: "matar", revive: "reviver" };
      const actionDetail = moderationActions[event.after?.action];
      action.textContent = `${actionNames[event.action] ?? event.action}${actionDetail ? ` · ${actionDetail}` : ""}`;
      const target = document.createElement("span");
      const beforeHp = event.before?.currentHp;
      const afterHp = event.after?.currentHp;
      const hpDetail = Number.isInteger(beforeHp)
        ? ` · HP ${beforeHp}${Number.isInteger(afterHp) ? ` → ${afterHp}` : ""}`
        : "";
      const reasonDetail =
        typeof event.after?.reason === "string"
          ? ` · Motivo: ${event.after.reason}`
          : "";
      target.textContent = `${event.entity} · ${event.targetId}${hpDetail}${reasonDetail}`;
      const meta = document.createElement("small");
      meta.textContent = `${event.actor.id} · ${new Date(event.at).toLocaleString("pt-BR")}`;
      row.append(action, target, meta);
      container.append(row);
    }
  } catch (error) {
    const failure = document.createElement("p");
    failure.className = "empty-list";
    failure.textContent = error.message;
    container.append(failure);
  }
}

async function loadLiveMonsters() {
  const container = document.querySelector("#live-monster-list");
  container.replaceChildren();
  setMessage(
    document.querySelector("#moderation-message"),
    "Consultando sessões do jogo…",
  );
  try {
    const payload = await api("/api/v1/game/monsters");
    if (!payload.monsters.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent =
        "Nenhum monstro foi carregado por uma sessão de jogo ainda.";
      container.append(empty);
      setMessage(document.querySelector("#moderation-message"), "");
      return;
    }
    for (const monster of payload.monsters) {
      const row = document.createElement("article");
      row.className = "account-row";
      const heading = document.createElement("div");
      heading.className = "account-heading";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = `Entidade ${monster.clientEntityId}`;
      const details = document.createElement("span");
      details.textContent = `(${monster.position.x}, ${monster.position.y}) · HP ${monster.currentHp}/${monster.maxHp} · ${monster.activeSessions} sessão(ões)`;
      identity.append(name, details);
      heading.append(identity);

      const controls = document.createElement("div");
      controls.className = "moderation-controls";
      const kill = document.createElement("button");
      kill.type = "button";
      kill.className = "button button-danger";
      kill.textContent = "Matar";
      kill.disabled = monster.activeSessions < 1 || monster.currentHp === 0;
      kill.addEventListener("click", () =>
        moderateLiveMonster(monster, "kill"),
      );
      const revive = document.createElement("button");
      revive.type = "button";
      revive.className = "button button-secondary";
      revive.textContent = "Reviver com HP máximo";
      revive.disabled =
        monster.activeSessions < 1 ||
        (monster.currentHp === monster.maxHp && monster.respawnAt === 0);
      revive.addEventListener("click", () =>
        moderateLiveMonster(monster, "revive"),
      );
      controls.append(kill, revive);
      row.append(heading, controls);
      container.append(row);
    }
    setMessage(
      document.querySelector("#moderation-message"),
      `${payload.monsters.length} monstro(s) carregado(s).`,
      "success",
    );
  } catch (error) {
    setMessage(
      document.querySelector("#moderation-message"),
      error.message,
      "error",
    );
    if (error.status === 401) showLogin();
  }
}

async function moderateLiveMonster(monster, action) {
  const actionLabel = action === "kill" ? "matar" : "reviver com HP máximo";
  if (
    !window.confirm(
      `Confirmar ${actionLabel} da entidade ${monster.clientEntityId} em (${monster.position.x}, ${monster.position.y})?`,
    )
  )
    return;
  setMessage(document.querySelector("#moderation-message"), "Aplicando ação…");
  try {
    await api("/api/v1/game/monsters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        clientEntityId: monster.clientEntityId,
        position: monster.position,
      }),
    });
    setMessage(
      document.querySelector("#moderation-message"),
      "Ação aplicada e registrada na auditoria.",
      "success",
    );
    await loadLiveMonsters();
    if (account?.role === "admin") await loadAudit();
  } catch (error) {
    setMessage(
      document.querySelector("#moderation-message"),
      error.message,
      "error",
    );
    if (error.status === 401) showLogin();
  }
}

async function loadOnlinePlayers() {
  const container = document.querySelector("#live-player-list");
  const message = document.querySelector("#player-moderation-message");
  container.replaceChildren();
  setMessage(message, "Consultando jogadores online…");
  try {
    const payload = await api("/api/v1/game/player-sessions");
    if (!payload.players.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "Nenhuma conta de jogador autenticada no momento.";
      container.append(empty);
      setMessage(message, "");
      return;
    }
    for (const player of payload.players) {
      const row = document.createElement("article");
      row.className = "account-row";
      const heading = document.createElement("div");
      heading.className = "account-heading";
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = player.accountId;
      const details = document.createElement("span");
      const sessionDetails = player.sessions
        .map((session) => {
          const character =
            Number.isInteger(session.characterSlot) &&
            session.characterSlot >= 0
              ? ` · slot ${session.characterSlot}`
              : "";
          const position = session.position
            ? ` · (${session.position.x}, ${session.position.y})`
            : "";
          return `${session.phase}${character}${position}`;
        })
        .join("; ");
      details.textContent = `${player.enabled ? "Conta ativa" : "Conta suspensa"} · ${player.sessionCount} sessão(ões) · ${sessionDetails}`;
      identity.append(name, details);
      heading.append(identity);

      const controls = document.createElement("div");
      controls.className = "moderation-controls player-moderation-controls";
      const reason = document.createElement("input");
      reason.type = "text";
      reason.minLength = 3;
      reason.maxLength = 200;
      reason.placeholder = "Motivo da suspensão";
      reason.setAttribute(
        "aria-label",
        `Motivo para suspender ${player.accountId}`,
      );
      const suspend = document.createElement("button");
      suspend.type = "button";
      suspend.className = "button button-danger";
      suspend.textContent = "Suspender e desconectar";
      suspend.addEventListener("click", () =>
        suspendOnlinePlayer(player, reason.value),
      );
      controls.append(reason, suspend);
      row.append(heading, controls);
      container.append(row);
    }
    setMessage(
      message,
      `${payload.players.length} conta(s) online.`,
      "success",
    );
  } catch (error) {
    setMessage(message, error.message, "error");
    if (error.status === 401) showLogin();
  }
}

async function suspendOnlinePlayer(player, reasonInput) {
  const reason = reasonInput.trim();
  const message = document.querySelector("#player-moderation-message");
  if (reason.length < 3 || reason.length > 200) {
    setMessage(message, "Informe um motivo de 3 a 200 caracteres.", "error");
    return;
  }
  if (
    !window.confirm(
      `Suspender a conta ${player.accountId}, encerrar ${player.sessionCount} sessão(ões) e impedir novo login?\n\nMotivo: ${reason}`,
    )
  ) {
    return;
  }
  setMessage(message, "Suspendendo e desconectando sessões…");
  try {
    const result = await api("/api/v1/game/player-sessions/suspend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: player.accountId, reason }),
    });
    setMessage(
      message,
      `Conta suspensa; ${result.disconnectedSessions} sessão(ões) encerrada(s). A ação foi auditada.`,
      "success",
    );
    await loadOnlinePlayers();
    if (account?.role === "admin") await loadAudit();
  } catch (error) {
    setMessage(message, error.message, "error");
    if (error.status === 401) showLogin();
  }
}

async function start() {
  try {
    const payload = await api("/api/v1/session");
    if (!payload.authenticated) return showLogin();
    await showApp(payload.account);
  } catch (error) {
    setMessage(loginMessage, error.message, "error");
    showLogin();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  setMessage(loginMessage, "Autenticando…");
  try {
    const payload = await api("/api/v1/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.get("id"),
        password: form.get("password"),
      }),
    });
    loginForm.reset();
    setMessage(loginMessage, "");
    await showApp(payload.account);
  } catch (error) {
    setMessage(loginMessage, error.message, "error");
  }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try {
    await api("/api/v1/session", { method: "DELETE" });
  } finally {
    showLogin();
  }
});

document.querySelector("#tab-content").addEventListener("click", () => {
  document.querySelector("#content-view").hidden = false;
  document.querySelector("#staff-view").hidden = true;
  document.querySelector("#moderation-view").hidden = true;
  document.querySelector("#tab-content").classList.add("active");
  document.querySelector("#tab-staff").classList.remove("active");
  document.querySelector("#tab-moderation").classList.remove("active");
});

document
  .querySelector("#tab-moderation")
  .addEventListener("click", async () => {
    document.querySelector("#content-view").hidden = true;
    document.querySelector("#staff-view").hidden = true;
    document.querySelector("#moderation-view").hidden = false;
    document.querySelector("#tab-content").classList.remove("active");
    document.querySelector("#tab-staff").classList.remove("active");
    document.querySelector("#tab-moderation").classList.add("active");
    await Promise.all([loadLiveMonsters(), loadOnlinePlayers()]);
  });

document.querySelector("#tab-staff").addEventListener("click", async () => {
  if (account?.role !== "admin") return;
  document.querySelector("#content-view").hidden = true;
  document.querySelector("#moderation-view").hidden = true;
  document.querySelector("#staff-view").hidden = false;
  document.querySelector("#tab-content").classList.remove("active");
  document.querySelector("#tab-staff").classList.add("active");
  document.querySelector("#tab-moderation").classList.remove("active");
  await Promise.all([loadAccounts(), loadPlayerAccounts(), loadAudit()]);
});

kindSelect.addEventListener("change", loadCatalog);
document.querySelector("#reload").addEventListener("click", loadCatalog);
document
  .querySelector("#new-entry")
  .addEventListener("click", () => setEditor(defaultEntry(), true));
document
  .querySelector("#save-entry")
  .addEventListener("click", () => saveEntry());
document
  .querySelector("#delete-entry")
  .addEventListener("click", () => deleteEntry());
document.querySelector("#discard").addEventListener("click", loadCatalog);
document.querySelector("#reload-audit").addEventListener("click", loadAudit);
document
  .querySelector("#reload-player-accounts")
  .addEventListener("click", loadPlayerAccounts);
document
  .querySelector("#reload-live-monsters")
  .addEventListener("click", loadLiveMonsters);
document
  .querySelector("#reload-live-players")
  .addEventListener("click", loadOnlinePlayers);

document
  .querySelector("#account-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    setMessage(document.querySelector("#account-message"), "Criando conta…");
    try {
      await api("/api/v1/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      event.currentTarget.reset();
      setMessage(
        document.querySelector("#account-message"),
        "Conta criada. A senha foi armazenada somente como hash.",
        "success",
      );
      await Promise.all([loadAccounts(), loadAudit()]);
    } catch (error) {
      setMessage(
        document.querySelector("#account-message"),
        error.message,
        "error",
      );
    }
  });

document
  .querySelector("#player-account-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(
      document.querySelector("#player-account-message"),
      "Criando conta de jogador…",
    );
    try {
      await api("/api/v1/player-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      event.currentTarget.reset();
      setMessage(
        document.querySelector("#player-account-message"),
        "Conta de jogador criada e registrada na auditoria local.",
        "success",
      );
      await Promise.all([loadPlayerAccounts(), loadAudit()]);
    } catch (error) {
      setMessage(
        document.querySelector("#player-account-message"),
        error.message,
        "error",
      );
    }
  });

start();
