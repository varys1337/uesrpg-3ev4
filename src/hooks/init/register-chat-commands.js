let _chatCommandsRegistered = false;

function _parseCharCommand(input) {
  const text = String(input ?? "").trim();
  if (!text.startsWith("/")) return null;

  const [token, ...rest] = text.split(/\s+/);
  const normalized = String(token ?? "").toLowerCase();
  if (normalized !== "/char" && normalized !== "/ueschar") return null;

  return {
    name: rest.join(" ").trim() || null,
  };
}

async function _openWizard(parsed) {
  const api = game.uesrpg?.chargen;
  if (typeof api?.openWizard === "function") {
    await api.openWizard({ name: parsed.name });
    return;
  }

  const mod = await import("../../macros/character-generation.js");
  if (typeof mod?.openCharGenWizard !== "function") {
    throw new Error("Character generation macro entrypoint unavailable");
  }

  await mod.openCharGenWizard({ name: parsed.name });
}

function _shouldHandle() {
  try {
    return Boolean(game.settings.get("uesrpg-3ev4", "enableCharGenSlashCommand"));
  } catch (_err) {
    return false;
  }
}

function _normalizeRollMode(mode) {
  const raw = String(mode ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "roll" || raw === "public" || raw === "publicroll") return "roll";
  if (raw === "gmroll" || raw === "private" || raw === "whisper") return "gmroll";
  if (raw === "blind" || raw === "blindroll") return "blindroll";
  if (raw === "self" || raw === "selfroll") return "selfroll";
  if (raw.includes("blind")) return "blindroll";
  if (raw.includes("self")) return "selfroll";
  if (raw.includes("private") || raw.includes("gm")) return "gmroll";
  if (raw.includes("public")) return "roll";
  return null;
}

function _extractModeFromElement(el) {
  if (!el) return null;
  const data = el.dataset ?? {};
  const direct = _normalizeRollMode(
    data.rollMode
    ?? data.mode
    ?? data.value
    ?? el.getAttribute?.("value")
    ?? el.getAttribute?.("data-roll-mode")
    ?? el.getAttribute?.("data-mode")
    ?? el.value
  );
  if (direct) return direct;
  const attr = _normalizeRollMode(
    el.getAttribute?.("aria-label")
    ?? el.getAttribute?.("title")
    ?? el.textContent
  );
  return attr;
}

function _resolveRollModeFromUi(chatLog) {
  const root = chatLog?.element?.[0] ?? document;
  const controls = root?.querySelector?.("#chat-controls");
  if (!controls) return _normalizeRollMode(game.settings.get("core", "rollMode")) ?? "roll";

  const named = controls.querySelector?.('[name="rollMode"]');
  const namedMode = _extractModeFromElement(named);
  if (namedMode) return namedMode;

  const activeNodes = controls.querySelectorAll?.([
    ".roll-type-select .active",
    ".roll-type-select [aria-pressed='true']",
    ".roll-type-select [aria-selected='true']",
    ".control-buttons .active",
    "[data-roll-mode].active",
    "[data-mode].active",
  ].join(", "));

  if (activeNodes?.length) {
    for (const node of activeNodes) {
      const mode = _extractModeFromElement(node) ?? _extractModeFromElement(node.querySelector?.("[data-roll-mode], [data-mode], button, a"));
      if (mode) return mode;
    }
  }

  return _normalizeRollMode(game.settings.get("core", "rollMode")) ?? "roll";
}

export function registerChatCommands() {
  if (_chatCommandsRegistered) return;
  _chatCommandsRegistered = true;

  const handler = (messageText) => {
    try {
      if (!_shouldHandle()) return;

      const parsed = _parseCharCommand(messageText);
      if (!parsed) return;
      void _openWizard(parsed).catch((err) => {
        console.error("UESRPG | Failed to execute /char command", err);
        ui.notifications?.error?.("Failed to open Character Generation Wizard.");
      });
      return false;
    } catch (err) {
      console.error("UESRPG | Failed to execute /char command", err);
      return false;
    }
  };

  Hooks.on("chatMessage", (chatLog, messageText, chatData) => {
    const handled = handler(messageText);
    if (handled === false) return false;

    if (chatData && typeof chatData === "object") {
      const mode = _resolveRollModeFromUi(chatLog);
      if (mode) chatData.rollMode = mode;
    }
    return handled;
  });

  Hooks.on("chatInput", (chatLog, messageText) => {
    return handler(messageText);
  });
}
