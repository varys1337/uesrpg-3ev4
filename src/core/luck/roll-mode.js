import { getCoreRollMode } from "../../utils/chat-roll-mode.js";

export function getLuckRollMode(raw = null) {
  const fallback = String(raw?.rollMode ?? "").trim();
  return getCoreRollMode({ fallback });
}
