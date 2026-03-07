const DENSITY_CLASSES = Object.freeze({
  comfortable: "uesrpg-density-comfortable",
  compact: "uesrpg-density-compact",
  ultra: "uesrpg-density-ultra",
});

const ALL_DENSITY_CLASSES = Object.freeze(Object.values(DENSITY_CLASSES));

function _resolveDensityValue() {
  try {
    const raw = String(game?.settings?.get?.("uesrpg-3ev4", "sheetDensity") ?? "").trim().toLowerCase();
    if (raw in DENSITY_CLASSES) return raw;
  } catch (_e) {
    // no-op
  }
  return "comfortable";
}

export function applySheetDensityClass(rootEl) {
  if (!rootEl?.classList) return;

  rootEl.classList.remove(...ALL_DENSITY_CLASSES);
  const densityKey = _resolveDensityValue();
  rootEl.classList.add(DENSITY_CLASSES[densityKey]);
}
