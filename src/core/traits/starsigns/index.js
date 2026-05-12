/**
 * src/core/traits/starsigns/index.js
 *
 * Small read-only helpers for starsign-driven workflow behavior.
 * Target: Foundry VTT v13.351
 */

const RITUAL_BLESSING_NAMES = Object.freeze([
  "Blessed Touch",
  "Blessed Word",
  "Mara's Gift",
]);

const STARSIGN_POWER_NAMES = new Set([
  ...RITUAL_BLESSING_NAMES,
  "Moonshadow",
  "Treasure Seeker",
  "Akaviri Danger-Sense",
].map((name) => String(name).trim().toLowerCase()));

function _normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _readSystemBirthsign(system = {}) {
  const canonical = String(system?.birthsign ?? "").trim();
  if (canonical) return canonical;
  return String(system?.birthSign ?? "").trim();
}

function _getItems(actor) {
  const items = actor?.items?.contents ?? actor?.items;
  return Array.isArray(items) ? items : Array.from(items ?? []);
}

function _matchesName(item, name) {
  return _normalizeName(item?.name) === _normalizeName(name);
}

function _getBirthsignNamedItems(actor, name, { includePowers = false } = {}) {
  const desired = _normalizeName(name);
  if (!desired) return [];
  return listBirthsignItems(actor).filter((item) => {
    const type = String(item?.type ?? "").trim().toLowerCase();
    if (type === "trait") return _normalizeName(item?.name) === desired;
    if (includePowers && type === "power") return _normalizeName(item?.name) === desired;
    return false;
  });
}

function _readItemNumber(item, path, fallback = 0) {
  const value = foundry?.utils?.getProperty?.(item, path);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function listBirthsignItems(actor) {
  return _getItems(actor).filter((item) => {
    const type = String(item?.type ?? "").trim().toLowerCase();
    if (type === "trait") return true;
    if (type !== "power") return false;
    return STARSIGN_POWER_NAMES.has(_normalizeName(item?.name));
  });
}

export function readActorBirthsignLabel(actor) {
  return _readSystemBirthsign(actor?.system ?? {});
}

export function buildBirthsignFieldUpdates(signLabel) {
  const normalized = String(signLabel ?? "").trim();
  return {
    "system.birthsign": normalized,
    "system.birthSign": normalized,
  };
}

export function hasBirthsignTrait(actor, name) {
  return _getBirthsignNamedItems(actor, name).some((item) => String(item?.type ?? "").trim().toLowerCase() === "trait");
}

export function hasTheLordBirthsign(actor) {
  return hasBirthsignTrait(actor, "The Lord");
}

export function hasStarCursedLordBirthsign(actor) {
  return hasBirthsignTrait(actor, "The Star-Cursed Lord");
}

export function hasRitualBirthsign(actor) {
  return hasBirthsignTrait(actor, "The Ritual");
}

export function hasStarCursedRitualBirthsign(actor) {
  return hasBirthsignTrait(actor, "The Star-Cursed Ritual");
}

export function hasRunningOutOfLuck(actor) {
  return hasBirthsignTrait(actor, "Running Out of Luck");
}

export function hasAkaviriDangerSense(actor) {
  return _getBirthsignNamedItems(actor, "Akaviri Danger-Sense", { includePowers: true }).length > 0;
}

export function getNaturalHealingStarsignProfile(actor) {
  const profile = {
    multiplier: 1,
    flatBonus: 0,
    sources: []
  };

  const lordItems = [
    ..._getBirthsignNamedItems(actor, "The Lord"),
    ..._getBirthsignNamedItems(actor, "The Star-Cursed Lord"),
  ];

  for (const item of lordItems) {
    if (!_matchesName(item, "The Lord") && !_matchesName(item, "The Star-Cursed Lord")) continue;
    profile.sources.push(String(item?.name ?? "The Lord"));
    const itemMultiplier = _readItemNumber(item, "system.recovery.naturalHealing.multiplier", 2);
    const itemFlatBonus = _readItemNumber(item, "system.recovery.naturalHealing.flatBonus", 0);
    profile.multiplier = Math.max(profile.multiplier, Math.max(1, itemMultiplier));
    profile.flatBonus += itemFlatBonus;
  }

  return profile;
}

export function getLuckBurnStarsignProfile(actor) {
  if (!hasRunningOutOfLuck(actor)) {
    return {
      doubleBurnCost: false,
      burnAllIfInsufficient: false,
      sources: []
    };
  }

  return {
    doubleBurnCost: true,
    burnAllIfInsufficient: true,
    sources: ["Running Out of Luck"]
  };
}

export function getRitualBlessingNames() {
  return [...RITUAL_BLESSING_NAMES];
}

export function isRitualBlessingItem(item) {
  if (!item) return false;
  return RITUAL_BLESSING_NAMES.some((name) => _matchesName(item, name));
}
