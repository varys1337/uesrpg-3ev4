import { normalizeCharacteristicKey, CHARACTERISTIC_KEYS } from "../../utils/maps/characteristics.js";

const governingParseCache = new WeakMap();

export function canonicalCharacteristicToken(value) {
  return normalizeCharacteristicKey(value);
}

export function isKnownCharacteristicKey(key) {
  return CHARACTERISTIC_KEYS.includes(canonicalCharacteristicToken(key));
}

export function resolveEffectiveSkillCharacteristicKey(skill, selectedCharacteristicKey = null) {
  const selected = canonicalCharacteristicToken(String(selectedCharacteristicKey ?? "").trim().toLowerCase());
  if (isKnownCharacteristicKey(selected)) return selected;
  const base = canonicalCharacteristicToken(skill?.system?.baseCha ?? skill?.governingCharacteristic ?? "");
  if (isKnownCharacteristicKey(base)) return base;
  const governingRaw = String(skill?.system?.governingCha ?? "").trim().toLowerCase();
  const governingMatch = governingRaw
    .split(/[,\n/;]+|\s+/)
    .map((token) => canonicalCharacteristicToken(token))
    .find((token) => isKnownCharacteristicKey(token));
  return governingMatch ?? base;
}

export function isAgilityCharacteristicKey(key) {
  return canonicalCharacteristicToken(key) === "agi";
}

export function isPhysicalCharacteristicKey(key) {
  return ["str", "agi", "end"].includes(canonicalCharacteristicToken(key));
}

export function isStrOrEndCharacteristicKey(key) {
  return ["str", "end"].includes(canonicalCharacteristicToken(key));
}

export function getParsedGoverningData(skill) {
  const skillObject = (skill && typeof skill === "object") ? skill : null;
  const skillSystem = (skillObject?.system && typeof skillObject.system === "object") ? skillObject.system : null;
  const cacheKey = skillSystem ?? skillObject;
  const governingRaw = String(skillSystem?.governingCha ?? "");
  const baseRaw = String(skillSystem?.baseCha ?? "");
  const baseNorm = canonicalCharacteristicToken(baseRaw.trim().toLowerCase());

  if (!cacheKey || (typeof cacheKey !== "object")) {
    const tokens = new Set(
      governingRaw
        .split(/[,\n/]+/)
        .map((entry) => canonicalCharacteristicToken(entry.trim().toLowerCase()))
        .filter(Boolean)
    );
    return { tokens, baseNorm };
  }

  const cached = governingParseCache.get(cacheKey);
  if (cached && cached.raw === governingRaw && cached.base === baseRaw) {
    return { tokens: cached.tokens, baseNorm: cached.baseNorm };
  }

  const tokens = new Set(
    governingRaw
      .split(/[,\n/]+/)
      .map((entry) => canonicalCharacteristicToken(entry.trim().toLowerCase()))
      .filter(Boolean)
  );

  governingParseCache.set(cacheKey, {
    raw: governingRaw,
    base: baseRaw,
    baseNorm,
    tokens
  });

  return { tokens, baseNorm };
}
