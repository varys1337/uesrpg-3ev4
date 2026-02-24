/**
 * src/core/combat/tn.js
 *
 * Deterministic TN computation pipeline for opposed workflow.
 *
 * Scope (Step 2):
 *  - Base TN (combat style / governing characteristic)
 *  - Attack variant mod (+20 / -20 / 0)
 *  - Manual modifier
 *  - Placeholders for later pipeline stages (difficulty, wounds, situational, effects)
 *
 * NOTE: This system is not on ApplicationV2.
 */

import { skillHelper, skillModHelper } from "../../utils/skillCalcHelper.js";
import { collectCombatTNModifiersFromAE } from "../active-effects/combat-tn-modifiers.js";
import { hasTalent } from "../traits/talents-api.js";

/**
 * Read combat TN modifiers from actor.system.modifiers.combat.*.
 * These are intended to be written by Active Effects.
 *
 * Supported keys (all optional, default 0):
 *  - system.modifiers.combat.attackTN
 *  - system.modifiers.combat.defenseTN
 *  - system.modifiers.combat.defenseTN.<evade|block|parry|counter>
 */
/**
 * Collect combat TN modifiers from Active Effects.
 *
 * We do NOT rely on implicit "transfer" resolution for roll-time provenance. Instead we:
 *  - read Actor embedded effects
 *  - read Item effects that are marked transfer=true
 *
 * This allows:
 *  - deterministic application
 *  - per-effect provenance in TN breakdown (labels = effect.name)
 *
 * Supported change modes:
 *  - ADD (numeric)
 * Other modes are ignored for now by design to avoid implicit behavior differences.
 */
function getCombatTNModifiers(actor, role, defenseType, context) {
  return collectCombatTNModifiersFromAE(actor, role, defenseType, context);
}


/**
 * Public helper for other pipelines (e.g. unopposed Combat Style checks) to
 * consume combat TN modifiers with the same provenance labels used by the
 * opposed combat TN workflow.
 *
 * @param {Actor} actor
 * @param {"attacker"|"defender"} role
 * @param {string|null} defenseType
 * @returns {Array<{key: string, label: string, value: number, source: string}>}
 */
export function collectCombatTNModifierEntries(actor, role, defenseType = null) {
  // This helper has no context, so only non-contextual effects will be included.
  return getCombatTNModifiers(actor, role, defenseType, {})?.entries ?? [];
}

function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function getCharTotal(actor, key) {
  return asNumber(actor?.system?.characteristics?.[key]?.total ?? actor?.system?.characteristics?.[key]?.value ?? 0);
}

// --- Governing characteristic parsing -------------------------------------

// Map common characteristic tokens/words used in item.system.governingCha/baseCha.
// NOTE: Keep this purely local to TN logic (schema-safe, no data mutation).
const GOV_CHA_ALIASES = Object.freeze({
  str: "str",
  strength: "str",
  end: "end",
  endurance: "end",
  agi: "agi",
  agility: "agi",
  int: "int",
  intelligence: "int",
  wp: "wp",
  willpower: "wp",
  prc: "prc",
  perception: "prc",
  prs: "prs",
  presence: "prs",
  personality: "prs",
  lck: "lck",
  luck: "lck"
});

function _parseGoverningChaKeys(governingRaw, actor) {
  const raw = String(governingRaw ?? "").trim().toLowerCase();
  if (!raw) return [];

  // Split on commas, slashes, semicolons, or whitespace sequences.
  const parts = raw.split(/[,/;]+|\s+/g).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return [];

  const available = new Set(Object.keys(actor?.system?.characteristics ?? {}));
  const out = [];

  for (const p of parts) {
    const key = GOV_CHA_ALIASES[p];
    if (key && (available.size === 0 || available.has(key))) out.push(key);
  }

  // Dedupe but keep deterministic order.
  return [...new Set(out)];
}

function _getDominantGoverningChaTotal(actor, governingRaw) {
  const keys = _parseGoverningChaKeys(governingRaw, actor);
  if (!keys.length) return null;
  let best = null;
  for (const k of keys) {
    const v = getCharTotal(actor, k);
    if (best == null || v > best) best = v;
  }
  return best;
}

// --- Size-to-Hit (Chapter 5) ----------------------------------------------

const SIZE_INDEX = {
  puny: 0,
  tiny: 1,
  small: 2,
  standard: 3,
  large: 4,
  huge: 5,
  enormous: 6
};

function _normalizeSize(size) {
  const s = String(size ?? "standard").trim().toLowerCase();
  if (s === "punity") return "puny"; // legacy typo in some rule text
  return SIZE_INDEX[s] != null ? s : "standard";
}

function _sizeIndex(size) {
  return SIZE_INDEX[_normalizeSize(size)] ?? SIZE_INDEX.standard;
}

function _sizeToHitModForTargetSize(size) {
  // Chapter 5: Size-to-Hit Effects
  // Puny -30, Tiny -20, Small -10, Standard 0, Large +10, Huge +20, Enormous +30
  switch (_normalizeSize(size)) {
    case "puny": return -30;
    case "tiny": return -20;
    case "small": return -10;
    case "large": return 10;
    case "huge": return 20;
    case "enormous": return 30;
    case "standard":
    default: return 0;
  }
}

/**
 * Chapter 5 Size-to-Hit modifier resolver.
 *
 * Rules summary:
 * - Ranged: always based on defender size category.
 * - Melee:
 *   - Puny/Tiny/Small penalty applies only when attacker is larger.
 *   - Huge/Enormous bonus applies only when attacker is smaller.
 *   - Large has no melee modifier.
 *
 * @param {object} opts
 * @param {"melee"|"ranged"} [opts.mode]
 * @param {string} [opts.attackerSize]
 * @param {string} [opts.defenderSize]
 * @returns {number}
 */
export function getSizeToHitModifier({ mode = "melee", attackerSize = "standard", defenderSize = "standard" } = {}) {
  const attackMode = String(mode ?? "melee").toLowerCase();
  const attackerIdx = _sizeIndex(attackerSize);
  const defenderNorm = _normalizeSize(defenderSize);
  const defenderIdx = _sizeIndex(defenderNorm);
  const sizeMod = _sizeToHitModForTargetSize(defenderNorm);

  if (attackMode === "ranged") return sizeMod;
  if (attackMode !== "melee") return 0;

  if (defenderNorm === "large" || defenderNorm === "standard") return 0;

  if (defenderNorm === "puny" || defenderNorm === "tiny" || defenderNorm === "small") {
    return attackerIdx > defenderIdx ? sizeMod : 0;
  }

  if (defenderNorm === "huge" || defenderNorm === "enormous") {
    return attackerIdx < defenderIdx ? sizeMod : 0;
  }

  return 0;
}

export function listCombatStyles(actor) {
  const styles = (actor?.items ?? [])
    .filter(i => i.type === "combatStyle")
    .map(i => ({ uuid: i.uuid, id: i.id, name: i.name, item: i }));

  if (actor?.type === "NPC") {
    const sys = actor?.system ?? {};
    const combatVal = Number(sys?.professions?.combat ?? 0);
    styles.push({
      uuid: "prof:combat",
      id: "prof:combat",
      name: "Combat (Profession)",
      item: {
        uuid: "prof:combat",
        id: "prof:combat",
        type: "combatStyle",
        name: "Combat (Profession)",
        system: { value: combatVal, bonus: 0, miscValue: 0 }
      }
    });
  }

  return styles;
}


export function getCombatStyleItem(actor, styleUuidOrId) {
  if (!actor || !styleUuidOrId) {
    if (!actor) console.warn("UESRPG | getCombatStyleItem: No actor provided");
    if (!styleUuidOrId) console.warn("UESRPG | getCombatStyleItem: No styleUuidOrId provided");
    return null;
  }
if (typeof styleUuidOrId === "string" && styleUuidOrId.startsWith("prof:")) {
  const key = styleUuidOrId.slice(5);
  const sys = actor?.system ?? {};
  const base = Number(sys?.professions?.[key] ?? 0);
  const woundPenalty = Number(sys?.woundPenalty ?? 0);
  const fatiguePenalty = Number(sys?.fatigue?.penalty ?? 0);
  
  return {
    uuid: styleUuidOrId,
    id: styleUuidOrId,
    type: "combatStyle",
    name: key.charAt(0).toUpperCase() + key.slice(1),
    system: { value: base + fatiguePenalty + woundPenalty, bonus: 0, miscValue: 0 },
    _professionKey: key
  };
}

  // Prefer UUID match when present
  const byUuid = (actor.items ?? []).find(i => i.uuid === styleUuidOrId);
  if (byUuid) {
    return byUuid;
  }
  const byId = (actor.items ?? []).find(i => i.id === styleUuidOrId);
  if (byId) {
    return byId;
  }
  
  console.error("UESRPG | getCombatStyleItem: Could not resolve combat style", { 
    actor: actor.name, 
    styleUuidOrId 
  });
  return null;
}

/**
 * Determine whether an Actor has an equipped shield.
 *
 * Repository conventions (validated via exported shield item JSON):
 *  - Item type: "armor"
 *  - system.equipped: true
 *  - system.item_cat: "shield"
 */
export function hasEquippedShield(actor) {
  return (actor?.items ?? []).some(i => {
    if (i.type !== "armor") return false;
    if (!i.system?.equipped) return false;
    const isShield = Boolean(i.system?.isShieldEffective ?? i.system?.isShield);
    const itemCat = String(i.system?.item_cat ?? "").toLowerCase();
    if (!isShield && itemCat !== "shield" && !String(i.name ?? "").toLowerCase().includes("shield")) return false;

    // RAW: bucklers cannot be used to Block.
    const shieldType = String(i.system?.shieldType ?? "normal").toLowerCase();
    if (shieldType === "buckler") return false;
    return true;
  });
}

function _hasEquippedShieldType(actor, typeKey) {
  const target = String(typeKey ?? "").toLowerCase();
  if (!target) return false;
  return (actor?.items ?? []).some(i => {
    if (i.type !== "armor") return false;
    if (!i.system?.equipped) return false;
    const isShield = Boolean(i.system?.isShieldEffective ?? i.system?.isShield);
    const itemCat = String(i.system?.item_cat ?? "").toLowerCase();
    if (!isShield && itemCat !== "shield" && !String(i.name ?? "").toLowerCase().includes("shield")) return false;
    const shieldType = String(i.system?.shieldType ?? "normal").toLowerCase();
    return shieldType === target;
  });
}

function _weaponHasToken(weapon, token) {
  const target = String(token ?? "").toLowerCase().trim();
  if (!weapon?.system || !target) return false;
  const structured = Array.isArray(weapon.system.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : (Array.isArray(weapon.system.qualitiesStructured) ? weapon.system.qualitiesStructured : []);
  if (structured.some(q => String(q?.key ?? q ?? "").toLowerCase() === target)) return true;
  const traits = Array.isArray(weapon.system.qualitiesTraitsInjected)
    ? weapon.system.qualitiesTraitsInjected
    : (Array.isArray(weapon.system.qualitiesTraits) ? weapon.system.qualitiesTraits : []);
  if (traits.some(t => String(t ?? "").toLowerCase() === target)) return true;
  return false;
}

function _getPreferredDefenderWeapon(actor) {
  if (!actor?.items) return null;
  const ew = actor?.system?.equippedWeapons;
  const boundIds = [
    ew?.primaryWeapon?.id,
    ew?.secondaryWeapon?.id,
    ew?.equippedWeapons?.primaryWeapon?.id,
    ew?.equippedWeapons?.secondaryWeapon?.id
  ].filter(Boolean);
  for (const id of boundIds) {
    const w = actor.items.get(id);
    if (w?.type === "weapon" && w.system?.equipped === true) return w;
  }
  return (actor.items ?? []).find(i => i?.type === "weapon" && i?.system?.equipped === true) ?? null;
}

function computeCombatStyleTN(styleItem) {
  // styleItem.system.value is already computed in prepareData with penalties/bonuses.
  const value = asNumber(styleItem?.system?.value ?? 0);
  
  if (value === 0 && styleItem) {
    console.warn("UESRPG | computeCombatStyleTN: Combat Style has 0 value", { 
      name: styleItem.name,
      type: styleItem.type,
      system: styleItem.system 
    });
  }
  
  return value;
}

function computeBlockTN(defender, styleItem) {
  // RAW: Combat Style test using Strength.
  const woundPenalty = asNumber(defender?.system?.woundPenalty ?? 0);
  const fatiguePenalty = asNumber(defender?.system?.fatigue?.penalty ?? 0);

  const strTotal = getCharTotal(defender, "str");
  const styleBonus = asNumber(styleItem?.system?.bonus ?? 0);
  const miscValue = asNumber(styleItem?.system?.miscValue ?? 0);
  
  // REMOVED: itemChaBonus from skillHelper - this was double-counting Trait/Talent bonuses
  // Traits/Talents modify characteristics directly, which are already included in strTotal
  
  const itemSkillBonus = asNumber(skillModHelper(defender, styleItem?.name ?? "") ?? 0);

  // Chapter 5: wound penalties are derived from Wound Active Effects and exposed via system.woundPenalty.
  // Do not use legacy system.wounded flags.
  let tn = strTotal + styleBonus + miscValue + itemSkillBonus + fatiguePenalty + woundPenalty;

  // Tower shields: +10 to block tests (RAW).
  if (_hasEquippedShieldType(defender, "tower")) tn += 10;

  return tn;
}

/**
 * Compute a defender TN override which uses an alternative skill but swaps its governing
 * characteristic base to a different characteristic.
 *
 * This supports Fearsome: Persuade (Strength) as an Evade reaction option.
 *
 * Heuristic (schema-safe):
 * - If the referenced skill item declares `system.governingCha` (or `system.baseCha`), we assume
 *   the stored `system.value` includes that governing characteristic total, and we swap the
 *   characteristic by: (skillTN - oldChaTotal + newChaTotal).
 * - If the governing characteristic is missing/unrecognized, we fall back to: (skillTN + newChaTotal).
 *
 * @param {Actor} defender
 * @param {object} tnOverride
 * @returns {{ tn: number, label: string }|null}
 */
export function computeDefenderTNOverride(defender, tnOverride) {
  if (!defender || !tnOverride || typeof tnOverride !== "object") return null;

  const skillName = String(tnOverride.skillName ?? "").trim();
  const newChaKey = String(tnOverride.fallbackCharacteristic ?? tnOverride.characteristicKey ?? "").trim().toLowerCase();
  if (!skillName || !newChaKey) return null;

  // NPCs: treat as characteristic-only (no per-skill item context available).
  if (defender.type === "NPC") {
    const tn = getCharTotal(defender, newChaKey);
    return { tn, label: `${skillName} (${newChaKey.toUpperCase()})` };
  }

  const skillItem = (defender.items ?? []).find(i => i.type === "skill" && String(i.name ?? "").toLowerCase() === skillName.toLowerCase());
  if (!skillItem) {
    const tn = getCharTotal(defender, newChaKey);
    return { tn, label: `${skillName} (${newChaKey.toUpperCase()})` };
  }

  const skillTN = asNumber(skillItem.system?.value ?? 0);

  // Many skills (including Persuade) have multiple governing characteristics.
  // In derived data, the system TN commonly uses the *best* governing characteristic.
  // For overrides like Persuade (Strength), we must:
  //   1) remove the currently-applied governing characteristic contribution (dominant), then
  //   2) add the requested characteristic contribution.
  const governingRaw = String(skillItem.system?.governingCha ?? skillItem.system?.baseCha ?? "");
  const dominantGovTotal = _getDominantGoverningChaTotal(defender, governingRaw);
  const newChaTotal = getCharTotal(defender, newChaKey);

  if (Number.isFinite(Number(dominantGovTotal)) && Number.isFinite(Number(newChaTotal))) {
    // Only swap when the derived TN plausibly contains the governing characteristic.
    // If it doesn't (legacy/odd data), swapping would be destructive.
    if (skillTN >= dominantGovTotal) {
      const tn = (skillTN - dominantGovTotal) + newChaTotal;
      return { tn, label: `${skillName} (${newChaKey.toUpperCase()})` };
    }
  }

  // Fallback: conservative composition.
  // If we can't determine a dominant governing characteristic, treat `skillTN` as the
  // non-characteristic portion and add the requested characteristic.
  const tn = skillTN + newChaTotal;
  return { tn, label: `${skillName} (${newChaKey.toUpperCase()})` };
}

function computeEvadeTN(defender, { tnOverride = null } = {}) {
  if (defender?.type === "NPC") {
    const sys = defender?.system ?? {};
    const base = Number(sys?.professions?.evade ?? 0);
    const woundPenalty = Number(sys?.woundPenalty ?? 0);
    const fatiguePenalty = Number(sys?.fatigue?.penalty ?? 0);
    const baseTN = base + fatiguePenalty + woundPenalty;
    return {
      baseTN,
      baseLabel: "Base TN",
      observantDelta: 0,
      observantLabel: "Observant (Evade as Perception)"
    };
  }

  if (tnOverride) {
    const override = computeDefenderTNOverride(defender, tnOverride);
    if (override && Number.isFinite(Number(override.tn))) {
      return {
        baseTN: Number(override.tn),
        baseLabel: override.label ?? "Base TN",
        observantDelta: 0,
        observantLabel: "Observant (Evade as Perception)"
      };
    }
  }

  const evadeItem = (defender?.items ?? []).find(i => i.type === "skill" && String(i.name ?? "").toLowerCase() === "evade");
  const evadeTN = asNumber(evadeItem?.system?.value ?? 0);
  if (evadeTN) {
    if (hasTalent(defender, "observant")) {
      const override = computeDefenderTNOverride(defender, {
        skillName: "Evade",
        fallbackCharacteristic: "prc"
      });
      const alt = Number(override?.tn ?? NaN);
      if (Number.isFinite(alt) && alt > evadeTN) {
        return {
          baseTN: evadeTN,
          baseLabel: "Base TN",
          observantDelta: alt - evadeTN,
          observantLabel: "Observant (Evade as Perception)"
        };
      }
    }
    return {
      baseTN: evadeTN,
      baseLabel: "Base TN",
      observantDelta: 0,
      observantLabel: "Observant (Evade as Perception)"
    };
  }
  return {
    baseTN: getCharTotal(defender, "agi"),
    baseLabel: "Agility",
    observantDelta: 0,
    observantLabel: "Observant (Evade as Perception)"
  };
}

export function variantMod(variant) {
  switch (variant) {
    case "allOut": return 20;
    case "precision": return -20;
    case "coup": return 0;
    case "normal":
    default: return 0;
  }
}

export function computeTN({
  actor,
  role,
  variant = "normal",
  defenseType = null,
  styleUuid = null,
  manualMod = 0,
  circumstanceMod = 0,
  situationalMods = [],
  context = {}
} = {}) {
  const breakdown = [];
  let observantEntry = null;

  // --- Base TN
  let baseTN = 0;
  let baseLabel = "Base";

  if (role === "attacker") {
    const styleItem = getCombatStyleItem(actor, styleUuid);
    if (!styleItem) {
      console.error("UESRPG | computeTN: No combat style item resolved for attacker", { 
        actor: actor?.name, 
        styleUuid 
      });
    }
    baseTN = computeCombatStyleTN(styleItem);
    baseLabel = "Base TN";
  } else if (role === "defender") {
    if (defenseType === "evade") {
      // Standardized TN override contract (used by Fearsome and other talent scaffolding).
      // Back-compat: accept `context.evadeOverride`.
      const tnOverride = context?.tnOverride ?? context?.evadeOverride ?? null;
      const overrideResult = computeDefenderTNOverride(actor, tnOverride);
      if (overrideResult) {
        baseTN = overrideResult.tn;
        baseLabel = overrideResult.label;
      } else {
        const evadeData = computeEvadeTN(actor);
        baseTN = evadeData.baseTN;
        baseLabel = evadeData.baseLabel ?? "Base TN";
        if (evadeData.observantDelta) {
          observantEntry = {
            key: "talent:observant",
            label: evadeData.observantLabel ?? "Observant (Evade as Perception)",
            value: evadeData.observantDelta,
            source: "talent"
          };
        }
      }
    } else if (defenseType === "block") {
      const shieldOk = hasEquippedShield(actor);
      if (!shieldOk) {
        baseTN = 0;
      } else if (typeof styleUuid === "string" && styleUuid.startsWith("prof:")) {
        const styleItem = getCombatStyleItem(actor, styleUuid);
        baseTN = Number(styleItem?.system?.value ?? 0);
      } else {
        const styleItem = getCombatStyleItem(actor, styleUuid);
        baseTN = styleItem ? computeBlockTN(actor, styleItem) : 0;
      }
      baseLabel = "Base TN";
    } else if (defenseType === "parry" || defenseType === "counter") {
      const styleItem = getCombatStyleItem(actor, styleUuid);
      baseTN = computeCombatStyleTN(styleItem);
      baseLabel = "Base TN";
    } else {
      baseTN = 0;
      baseLabel = "Base TN";
    }
  }

  // Keep a short label for chat-card real estate; preserve detail for debugging.
  const baseDetail = (role === "attacker")
    ? "Combat Style"
    : (defenseType === "evade")
      ? "Evade"
      : (defenseType === "block")
        ? "Block"
        : (defenseType === "parry" || defenseType === "counter")
          ? "Combat Style"
          : "—";

  breakdown.push({ key: "base", label: baseLabel, value: asNumber(baseTN), source: "base", detail: baseDetail });
  if (observantEntry) breakdown.push(observantEntry);

  if (role === "defender" && (defenseType === "parry" || defenseType === "counter")) {
    const defenderWeapon = _getPreferredDefenderWeapon(actor);
    if (_weaponHasToken(defenderWeapon, "unwieldy")) {
      breakdown.push({
        key: "quality:unwieldy",
        label: "Unwieldy",
        value: -20,
        source: "quality"
      });
    }
  }

  // --- Variant mod (attacker only)
  const vMod = (role === "attacker") ? variantMod(variant) : 0;
  if (vMod) breakdown.push({ key: "variant", label: "Attack option", value: vMod, source: "variant" });

  // --- Manual
  const mMod = asNumber(manualMod);
  if (mMod) breakdown.push({ key: "manual", label: "Manual", value: mMod, source: "manual" });

  // --- Combat circumstances (pre-AE): discrete disadvantage dropdown applied to this side's TN.
  const cMod = asNumber(circumstanceMod);
  if (cMod) breakdown.push({ key: "circumstance", label: "Circumstance", value: cMod, source: "circumstance" });

  // --- Situational modifiers (e.g. sensory impairment toggles, range bands, etc.)
  // These are passed in explicitly by callers and must always be reflected in TN and breakdown.
  if (Array.isArray(situationalMods) && situationalMods.length) {
    let i = 0;
    for (const m of situationalMods) {
      const v = asNumber(m?.value);
      if (!v) continue;

      const k = String(m?.key ?? `m${i}`).trim() || `m${i}`;
      const label = String(m?.label ?? m?.name ?? "Situational").trim() || "Situational";

      breakdown.push({
        key: `situational:${k}`,
        label,
        value: v,
        source: String(m?.source ?? "situational")
      });

      i += 1;
    }
  }

  // --- Size-to-Hit (Chapter 5): attacker TN only
  // Caller must provide sizes in context to keep computeTN synchronous.
  if (role === "attacker") {
    const sizeMod = getSizeToHitModifier({
      mode: context?.attackMode,
      attackerSize: context?.selfSize ?? actor?.system?.size,
      defenderSize: context?.opponentSize
    });
    if (sizeMod) breakdown.push({ key: "size", label: "Size", value: sizeMod, source: "size" });
  }

  // --- Active Effects combat TN modifiers (from system.modifiers.combat.*)
  // Applied exactly once at this stage, and only to TN (not to base characteristics).
  const ae = getCombatTNModifiers(actor, role, defenseType, context);
  for (const e of (ae.entries ?? [])) breakdown.push(e);


  // --- Placeholders for Step 2+ expansions
  if (context?.includePlaceholders) {
    breakdown.push({ key: "difficulty", label: "Difficulty", value: 0, source: "difficulty" });
    breakdown.push({ key: "wounds", label: "Wounds", value: 0, source: "wounds" });
    breakdown.push({ key: "situational", label: "Situational", value: 0, source: "situational" });
    breakdown.push({ key: "effects", label: "Effects", value: 0, source: "effects" });
  }

  const totalMod = breakdown
    .filter(b => b.key !== "base")
    .reduce((acc, b) => acc + asNumber(b.value), 0);

  const finalTN = asNumber(baseTN) + totalMod;

  return {
    finalTN,
    baseTN: asNumber(baseTN),
    totalMod,
    breakdown
  };
}
