import { hasTalent } from "../../traits/talents-api.js";
import { isShieldItem } from "../../items/shield-utils.js";

function _pushByType(map, type, item) {
  const key = String(type ?? "");
  if (!map[key]) map[key] = [];
  map[key].push(item);
}

export function buildActorPrepareContext(actor) {
  const items = Array.from(actor?.items?.contents ?? actor?.items ?? []);
  const equippedItems = [];
  const talents = [];
  const traitsAndTalents = [];
  const byType = Object.create(null);
  const talentSlugSet = new Set();
  const halfSpeedItems = [];
  const halfFatiguePenaltyItems = [];
  const addIbToMpItems = [];
  const addHalfSpeedItems = [];
  const wereCrocodileFormItems = [];
  let hasHalfWoundPenaltyItem = false;
  let hasEquippedTowerShield = false;

  for (const item of items) {
    if (!item) continue;
    _pushByType(byType, item.type, item);

    const sys = item.system ?? {};
    if (sys.equipped === true) equippedItems.push(item);
    if (item.type === "talent") {
      talents.push(item);
      const slug = String(sys.slug ?? sys.key ?? sys.id ?? "").trim().toLowerCase();
      const name = String(item.name ?? "").trim().toLowerCase().replace(/\s+/g, "");
      if (slug) talentSlugSet.add(slug);
      if (name) talentSlugSet.add(name);
    }
    if (item.type === "trait" || item.type === "talent") traitsAndTalents.push(item);
    if (sys.halfSpeed === true) halfSpeedItems.push(item);
    if (sys.halfFatiguePenalty === true) halfFatiguePenaltyItems.push(item);
    if (sys.addIBToMP === true) addIbToMpItems.push(item);
    if (sys.addHalfSpeed === true) addHalfSpeedItems.push(item);
    if (sys.halfWoundPenalty === true) hasHalfWoundPenaltyItem = true;
    if (String(sys.shiftFormStyle ?? "") === "shiftFormWereCrocodile") wereCrocodileFormItems.push(item);

    if (!hasEquippedTowerShield && isShieldItem(item, { allowLegacy: true }) && sys.equipped === true) {
      hasEquippedTowerShield = String(sys.shieldType ?? "normal").toLowerCase() === "tower";
    }
  }

  return {
    items,
    equippedItems,
    talents,
    traitsAndTalents,
    byType,
    talentSlugSet,
    halfSpeedItems,
    halfFatiguePenaltyItems,
    addIbToMpItems,
    addHalfSpeedItems,
    wereCrocodileFormItems,
    hasHalfWoundPenaltyItem,
    hasEquippedTowerShield,
  };
}

export function hasTalentCached(actor, key) {
  const k = String(key ?? "").trim().toLowerCase();
  if (!k) return false;
  const normalized = k.replace(/\s+/g, "");
  const set = actor?._getPrepareCtx?.()?.talentSlugSet;
  if (set instanceof Set && (set.has(k) || set.has(normalized))) return true;
  try { return hasTalent(actor, key); } catch (_e) { return false; }
}
