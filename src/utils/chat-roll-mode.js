function _normalizeFallback(fallback) {
  const normalized = normalizeChatMessageMode(fallback, { fallback: null });
  return normalized ?? "roll";
}

export function normalizeChatMessageMode(value, { fallback = "roll" } = {}) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback == null ? null : _normalizeFallback(fallback);
  if (raw === "roll" || raw === "public" || raw === "publicroll") return "roll";
  if (raw === "gmroll" || raw === "private" || raw === "whisper") return "gmroll";
  if (raw === "blind" || raw === "blindroll") return "blindroll";
  if (raw === "self" || raw === "selfroll") return "selfroll";
  if (raw.includes("blind")) return "blindroll";
  if (raw.includes("self")) return "selfroll";
  if (raw.includes("private") || raw.includes("whisper") || raw.includes("gm")) return "gmroll";
  if (raw.includes("public")) return "roll";
  return fallback == null ? null : _normalizeFallback(fallback);
}

export function getCoreMessageMode({ fallback = "roll" } = {}) {
  try {
    const value = game?.settings?.get?.("core", "messageMode");
    return normalizeChatMessageMode(value, { fallback });
  } catch (_err) {
    return _normalizeFallback(fallback);
  }
}

export function getCoreRollMode({ fallback = "roll" } = {}) {
  return getCoreMessageMode({ fallback });
}

export function isPublicChatMessageMode(value) {
  return normalizeChatMessageMode(value, { fallback: "roll" }) === "roll";
}

export function getChatMessageModeOptions({ fallback = "roll", userId = game?.user?.id } = {}) {
  const rollMode = getCoreMessageMode({ fallback });
  if (rollMode === "gmroll") return { rollMode, whisper: ChatMessage.getWhisperRecipients("GM") };
  if (rollMode === "blindroll") return { rollMode, whisper: ChatMessage.getWhisperRecipients("GM"), blind: true };
  if (rollMode === "selfroll") return { rollMode, whisper: userId ? [userId] : [] };
  return { rollMode };
}
