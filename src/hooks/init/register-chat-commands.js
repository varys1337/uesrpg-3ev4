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
    return handler(messageText);
  });

  Hooks.on("chatInput", (chatLog, messageText) => {
    return handler(messageText);
  });
}
