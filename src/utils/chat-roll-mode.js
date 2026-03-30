export function getCoreRollMode({ fallback = "" } = {}) {
  try {
    const value = game?.settings?.get?.("core", "rollMode");
    const mode = String(value ?? "").trim();
    return mode || String(fallback ?? "").trim();
  } catch (_err) {
    return String(fallback ?? "").trim();
  }
}
