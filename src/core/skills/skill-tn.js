/**
 * src/core/skills/skill-tn.js
 *
 * Skill TN computation for UESRPG 3ev4 (Foundry v13.351).
 *
 * Design:
 *  - Deterministic TN computation with an explicit breakdown (for debug / UI).
 *  - Does not mutate documents.
 */

import { collectCombatTNModifierEntries, computeDefenderTNOverride } from "../combat/tn.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { hasTalent } from "../traits/talents-api.js";
import { applySenseLossPenaltyAdjustments } from "../traits/awareness-talents.js";
import { getArmoredAgilityAcrobaticsBonus } from "../traits/mobility-talents.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { normalizeKey } from "./key-utils.js";

export const SKILL_DIFFICULTIES = Object.freeze([
  { key: "effortless", label: "Effortless", mod: 40 },
  { key: "simple", label: "Simple", mod: 30 },
  { key: "easy", label: "Easy", mod: 20 },
  { key: "ordinary", label: "Ordinary", mod: 10 },
  { key: "average", label: "Average", mod: 0 },
  { key: "challenging", label: "Challenging", mod: -10 },
  { key: "difficult", label: "Difficult", mod: -20 },
  { key: "hard", label: "Hard", mod: -30 },
  { key: "veryHard", label: "Very Hard", mod: -40 }
]);

export function getDifficultyByKey(key) {
  return SKILL_DIFFICULTIES.find(d => d.key === key) ?? SKILL_DIFFICULTIES.find(d => d.key === "average");
}

function _asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}


const _governingParseCache = new WeakMap();

function _canonicalCharacteristicToken(v) {
  switch (v) {
    case "strength": return "str";
    case "endurance": return "end";
    case "agility": return "agi";
    case "intelligence": return "int";
    case "willpower": return "wp";
    case "perception": return "prc";
    case "personality": return "prs";
    case "luck": return "lck";
    default: return v;
  }
}

function _getParsedGoverningData(skill) {
  const skillObj = (skill && typeof skill === "object") ? skill : null;
  const skillSystem = (skillObj?.system && typeof skillObj.system === "object") ? skillObj.system : null;
  const cacheKey = skillSystem ?? skillObj;
  const governingRaw = String(skillSystem?.governingCha ?? "");
  const baseRaw = String(skillSystem?.baseCha ?? "");
  const baseNorm = _canonicalCharacteristicToken(baseRaw.trim().toLowerCase());

  if (!cacheKey || (typeof cacheKey !== "object")) {
    const tokens = new Set(
      governingRaw
        .split(/[,\n/]+/)
        .map(s => _canonicalCharacteristicToken(s.trim().toLowerCase()))
        .filter(Boolean)
    );
    return { tokens, baseNorm };
  }

  const cached = _governingParseCache.get(cacheKey);
  if (cached && cached.raw === governingRaw && cached.base === baseRaw) {
    return { tokens: cached.tokens, baseNorm: cached.baseNorm };
  }

  const tokens = new Set(
    governingRaw
      .split(/[,\n/]+/)
      .map(s => _canonicalCharacteristicToken(s.trim().toLowerCase()))
      .filter(Boolean)
  );

  _governingParseCache.set(cacheKey, {
    raw: governingRaw,
    base: baseRaw,
    baseNorm,
    tokens
  });

  return { tokens, baseNorm };
}

function _maybeAddObservantEvadeMod(actor, skillItem, situationalMods) {
  if (!actor || !skillItem || !Array.isArray(situationalMods)) return;
  if (normalizeKey(skillItem?.name) !== "evade") return;
  if (!hasTalent(actor, "observant")) return;

  const baseTN = _asNumber(skillItem?.system?.value ?? 0);
  const override = computeDefenderTNOverride(actor, {
    skillName: "Evade",
    fallbackCharacteristic: "prc"
  });
  const altTN = _asNumber(override?.tn ?? NaN);
  if (!Number.isFinite(altTN)) return;

  const delta = altTN - baseTN;
  if (delta > 0) {
    situationalMods.push({
      key: "talent:observant",
      label: "Observant (Evade as Perception)",
      value: delta,
      source: "talent"
    });
  }
}

function _hasSenseLossMods(situationalMods) {
  if (!Array.isArray(situationalMods)) return false;
  return situationalMods.some((m) => {
    const key = String(m?.key ?? m?.conditionKey ?? "").trim().toLowerCase();
    return key === "blinded" || key === "deafened";
  });
}

function _maybeAddSenseLossAwarenessMods(actor, skillItem, situationalMods) {
  if (!actor || !skillItem || !Array.isArray(situationalMods)) return;

  const hasAll = hasTalent(actor, "onewithall");
  const hasHoned = !hasAll && hasTalent(actor, "honedsenses");
  if (!hasAll && !hasHoned) return;

  // If sense-loss mods already exist, ensure awareness adjustments are applied once.
  if (_hasSenseLossMods(situationalMods)) {
    applySenseLossPenaltyAdjustments(situationalMods, actor);
    return;
  }

  // Unopposed baseline: only auto-hydrate observe penalties that already exist via condition AEs.
  const skillKey = normalizeKey(skillItem?.name);
  if (skillKey !== "observe") return;

  const hasBlind = hasCondition(actor, "blinded");
  const hasDeaf = hasCondition(actor, "deafened");
  if (!hasBlind && !hasDeaf) return;

  if (hasBlind) {
    situationalMods.push({
      key: "blinded",
      conditionKey: "blinded",
      label: "Blinded (sight)",
      value: -30,
      source: "sense-loss",
      applyMode: "offset"
    });
  }

  if (hasDeaf) {
    situationalMods.push({
      key: "deafened",
      conditionKey: "deafened",
      label: "Deafened (hearing)",
      value: -30,
      source: "sense-loss",
      applyMode: "offset"
    });
  }

  applySenseLossPenaltyAdjustments(situationalMods, actor);
}
function _isAgilityBasedSkill(skillItem) {
  // Skills can encode governing characteristics as a single token ("Agi"),
  // a full word ("Agility"), or a comma/space separated list ("Str, Agi").
  // Treat any token containing AGI/Agility as agility-based for mobility rules.
  const governingRaw = String(skillItem?.system?.governingCha || skillItem?.system?.baseCha || "");
  const governing = governingRaw.trim().toLowerCase();
  if (!governing) return false;

  // Match whole tokens to avoid false positives.
  return /\bagi\b|\bagility\b/.test(governing);
}

/**
 * Determine if a skill is based on STR, AGI, or END.
 * Used for Frenzied condition penalty exemption.
 */
function _isPhysicalSkill(skill) {
  const gov = String(skill?.system?.governingCha ?? skill?.system?.baseCha ?? skill?.governingCharacteristic ?? "").trim().toLowerCase();
  return /\bstr\b|\bstrength\b|\bagi\b|\bagility\b|\bend\b|\bendurance\b/.test(gov);
}

function _isStrOrEndSkill(skill) {
  const gov = String(skill?.system?.governingCha ?? skill?.system?.baseCha ?? skill?.governingCharacteristic ?? "").trim().toLowerCase();
  return /\bstr\b|\bstrength\b|\bend\b|\bendurance\b/.test(gov);
}

function _collectItemSkillBonuses(actor, skill) {
  const out = [];
  if (!actor) return out;

  const key = String(skill?._professionKey ?? "").trim();
  const name = String(skill?.name ?? "").trim();

  const candidates = new Set();
  if (key) {
    candidates.add(key.toLowerCase());
    candidates.add(normalizeKey(key));
  }
  if (name) {
    candidates.add(name.toLowerCase());
    candidates.add(normalizeKey(name));
  }

  const seen = new Set(); // dedupe by itemId+entryKey+value

  for (const item of (actor.items ?? [])) {
    const sys = item?.system ?? {};
    if (!sys.equipped) continue;

    const arr = Array.isArray(sys.skillArray) ? sys.skillArray : [];
    for (const entry of arr) {
      const eName = String(entry?.name ?? "").trim();
      const eValue = _asNumber(entry?.value);
      if (!eName || !eValue) continue;

      const lc = eName.toLowerCase();
      const ek = normalizeKey(eName);
      if (!(candidates.has(lc) || candidates.has(ek))) continue;

      const sig = `${item.id}|${ek}|${eValue}`;
      if (seen.has(sig)) continue;
      seen.add(sig);

      out.push({ itemName: item.name, value: eValue });
    }
  }
  return out;
}

function _isCombatStyle(skillItem) {
  return (skillItem?.type === "combatStyle") || /combat style/i.test(String(skillItem?.name || ""));
}

// Chapter 1/7: encumbrance penalty applies only to STR/END/AGI-governed tests.
const _ENCUMBRANCE_PHYSICAL_KEYS = new Set(["str", "strength", "end", "endurance", "agi", "agility"]);
function _encumbrancePhysicalKey(k) {
  return _ENCUMBRANCE_PHYSICAL_KEYS.has(String(k ?? "").trim().toLowerCase());
}

export function computeSkillTN({
  actor,
  skillItem,
  difficultyKey = "average",
  manualMod = 0,
  selectedCharacteristicKey = null,
  useSpecialization = false,
  situationalMods = []
} = {}) {
  // Derive item-based skill bonuses from equipped items that use the legacy `system.skillArray` format.
  // This allows the chat card breakdown to attribute bonuses to specific items.
  const itemBonuses = _collectItemSkillBonuses(actor, skillItem);

  // Active Effects: global test modifiers + skill-specific lanes.
  // Supported keys:
  // - system.modifiers.tests.all
  // - system.modifiers.skills._all
  // - system.modifiers.skills.<normalizedSkillName>
  //
  // We evaluate these deterministically at roll-time to support both ADD and OVERRIDE modes.
  const _aeSkillNorm = normalizeKey(skillItem?.name);
  const _aeProfessionNorm = normalizeKey(skillItem?._professionKey);
  const _aeCharacteristicNorm = normalizeKey(skillItem?._characteristicKey);
  const _aeSkillKeys = new Set([
    "system.modifiers.tests.all",
    "system.modifiers.skills._all",
    "system.modifiers.skills.frenziedPenalty",
    "system.modifiers.skills.physicalExertion"
  ]);
  if (_aeSkillNorm) _aeSkillKeys.add(`system.modifiers.skills.${_aeSkillNorm}`);
  if (_aeProfessionNorm) _aeSkillKeys.add(`system.modifiers.skills.${_aeProfessionNorm}`);
  if (_aeCharacteristicNorm) _aeSkillKeys.add(`system.modifiers.characteristics.${_aeCharacteristicNorm}`);
  const _aeSkillResolved = actor ? evaluateAEModifierKeys(actor, Array.from(_aeSkillKeys)) : {};

  const fallbackSituational = [];
  if (
    actor &&
    !_isCombatStyle({ type: skillItem?.type, name: skillItem?.name }) &&
    _isStrOrEndSkill({ system: skillItem?.system ?? {} }) &&
    !_asNumber(_aeSkillResolved["system.modifiers.skills.physicalExertion"] ?? 0)
  ) {
    const hasLegacy = actor.effects?.some(e =>
      !e.disabled && getFlagValueWithFallback(e, "key") === "stamina-physical-exertion"
    );
    if (hasLegacy) {
      fallbackSituational.push({ key: "physicalExertion", label: "Physical Exertion", value: 20, source: "staminaLegacy" });
    }
  }

  const situational = Array.isArray(situationalMods) ? [...situationalMods] : [];
  _maybeAddObservantEvadeMod(actor, skillItem, situational);
  _maybeAddSenseLossAwarenessMods(actor, skillItem, situational);

  return computeSkillTNFromData({
    actor,
    actorSystem: actor?.system ?? {},
    actorType: actor?.type,
    actorHasPlayerOwner: actor?.hasPlayerOwner,
    skill: {
      name: skillItem?.name,
      type: skillItem?.type,
      system: skillItem?.system ?? {},
      _professionKey: skillItem?._professionKey
    },
    itemBonuses,
    aeSkillResolved: _aeSkillResolved,
    combatTNBonuses: (() => {
      // Unopposed Combat Style checks should consume the same AE-driven combat TN bonuses
      // used by the opposed combat workflow (e.g. weapon effects adding Attack TN).
      // This is only relevant for combat styles.
      const isCombat = _isCombatStyle({ type: skillItem?.type, name: skillItem?.name });
      if (!isCombat) return null;
      // Lazy import boundary: keep this file usable in pure-data mode.
      // The import is static (top-level) but the function call is gated.
      return collectCombatTNModifierEntries(actor, "attacker");
    })(),
    difficultyKey,
    manualMod,
    selectedCharacteristicKey,
    useSpecialization,
    situationalMods: [...situational, ...fallbackSituational]
  });
}

/**
 * Pure TN computation operating on plain data objects (no document access).
 */
function computeSkillTNFromData({
  actor = null,
  actorSystem = {},
  actorType = null,
  actorHasPlayerOwner = true,
  skill = { name: null, type: null, system: {} },
  itemBonuses = null,
  aeSkillResolved = null,
  combatTNBonuses = null,
  difficultyKey = "average",
  manualMod = 0,
  selectedCharacteristicKey = null,
  useSpecialization = false,
  situationalMods = []
} = {}) {
  const breakdown = [];

  const isCharacteristic = skill?.type === "characteristic";

  // In UESRPG, the stored skill value represents the rank-derived bonus (and any legacy item-derived parts).
  // For characteristics, this is the characteristic total.
  // In chat cards, present this as "Rank" for skills or the characteristic name for char tests.
  const baseSkillRaw = _asNumber(skill?.system?.value);
  const needsRuntimeFatigueWound = (skill?.type === "profession" || skill?.type === "characteristic");
  let baseSkill = baseSkillRaw;

  // Chapter 3: many skills allow choosing a governing characteristic per test.
  // Stored `system.value` is derived from the currently selected base characteristic.
  // For per-roll selection, swap old characteristic contribution with the selected one.
  const selectedCharKey = _canonicalCharacteristicToken(String(selectedCharacteristicKey ?? "").trim().toLowerCase());
  const { tokens: governingTokens, baseNorm: currentBaseCharKey } = _getParsedGoverningData(skill);
  if (
    selectedCharKey &&
    selectedCharKey !== currentBaseCharKey &&
    ["skill", "magicSkill", "combatStyle"].includes(String(skill?.type ?? "")) &&
    governingTokens.has(selectedCharKey)
  ) {
    const oldTotal = _asNumber(actorSystem?.characteristics?.[currentBaseCharKey]?.total ?? 0);
    const newTotal = _asNumber(actorSystem?.characteristics?.[selectedCharKey]?.total ?? 0);
    const delta = newTotal - oldTotal;
    if (delta !== 0) {
      baseSkill = baseSkillRaw + delta;
      breakdown.push({
        label: `Characteristic (${selectedCharKey.toUpperCase()})`,
        value: delta,
        source: "characteristicSelection"
      });
    }
  }

  breakdown.push({ label: isCharacteristic ? (skill?.name ?? "Characteristic") : "Rank", value: baseSkill, source: isCharacteristic ? "characteristic" : "rank" });

  // Active Effects: skill-specific and global modifiers.
  // Supported keys (dynamic):
  // - system.modifiers.tests.all
  // - system.modifiers.skills._all
  // - system.modifiers.skills.<normalizedSkillName>
  //
  // We evaluate these deterministically at roll-time to support both ADD and OVERRIDE modes.
  const normName = normalizeKey(skill?.name);
  const resolved = aeSkillResolved ?? {};

  // Global test lane
  const allTestBonus = _asNumber(resolved["system.modifiers.tests.all"] ?? 0);
  if (allTestBonus) {
    breakdown.push({ label: "Effects: All Tests", value: allTestBonus, source: "aeTestsAll" });
  }

  // Global skill lane
  const allSkillBonus = _asNumber(resolved["system.modifiers.skills._all"] ?? 0);
  if (allSkillBonus) {
    breakdown.push({ label: "Effects: All Skills", value: allSkillBonus, source: "aeSkillAll" });
  }

  // Skill-specific lane
  const normProfession = normalizeKey(skill?._professionKey);
  const specificBonus = normName ? _asNumber(resolved[`system.modifiers.skills.${normName}`] ?? 0) : 0;
  if (specificBonus) {
    const labelName = String(skill?.name ?? "").trim();
    breakdown.push({
      label: labelName ? `Effects: ${labelName}` : "Effects: Skill",
      value: specificBonus,
      source: "aeSkillSpecific"
    });
  }

  const professionBonus = (normProfession && normProfession !== normName)
    ? _asNumber(resolved[`system.modifiers.skills.${normProfession}`] ?? 0)
    : 0;
  if (professionBonus) {
    const labelName = String(skill?._professionKey ?? "").trim();
    breakdown.push({
      label: labelName ? `Effects: ${labelName}` : "Effects: Profession",
      value: professionBonus,
      source: "aeSkillProfession"
    });
  }

  // Characteristic-specific AE modifier lane
  const normCharacteristic = normalizeKey(skill?._characteristicKey);
  if (normCharacteristic) {
    const chaBonus = _asNumber(resolved[`system.modifiers.characteristics.${normCharacteristic}`] ?? 0);
    if (chaBonus) {
      const chaLabel = String(skill?.name ?? normCharacteristic).trim();
      breakdown.push({
        label: `Effects: ${chaLabel}`,
        value: chaBonus,
        source: "aeCharacteristic"
      });
    }
  }

  // Frenzied condition penalty lane
  // Key: system.modifiers.skills.frenziedPenalty
  // Applies to all skill tests except STR/AGI/END-based skills.
  const frenziedPenalty = _asNumber(resolved["system.modifiers.skills.frenziedPenalty"] ?? 0);
  if (frenziedPenalty && !_isPhysicalSkill(skill)) {
    breakdown.push({ label: "Effects: Frenzied", value: frenziedPenalty, source: "aeFrenziedPenalty" });
  }

  // Physical Exertion bonus (STR/END-based skills only; not Combat Style).
  const physicalExertion = _asNumber(resolved["system.modifiers.skills.physicalExertion"] ?? 0);
  if (physicalExertion && _isStrOrEndSkill(skill) && !_isCombatStyle({ type: skill?.type, name: skill?.name })) {
    breakdown.push({ label: "Physical Exertion", value: physicalExertion, source: "staminaPhysicalExertion" });
  }

  // Combat Style unopposed checks: include combat TN modifiers (attacker side).
  // These are applied via Actor-level modifiers or transferred item effects.
  // We prefer provenance-carrying entries when provided by the caller.
  if (_isCombatStyle({ type: skill?.type, name: skill?.name })) {
    const entries = Array.isArray(combatTNBonuses) ? combatTNBonuses : null;
    if (entries && entries.length) {
      for (const e of entries) {
        const v = _asNumber(e?.value);
        if (!v) continue;
        const label = String(e?.label ?? "Effects");
        breakdown.push({ label, value: v, source: "combatTN" });
      }
    } else {
      const combatMods = actorSystem?.modifiers?.combat ?? {};
      const v = _asNumber(combatMods?.attackTN);
      if (v) breakdown.push({ label: "Effects", value: v, source: "combatTN" });
    }
  }
  // Skill-linked item automation.
  // NOTE: This function is pure-data; it cannot inspect Actor items. Any item-based bonuses must be
  // collected by the caller and provided via `itemBonuses`.
  const derivedItemBonuses = Array.isArray(itemBonuses) ? itemBonuses : [];

  if (derivedItemBonuses.length) {
    for (const b of derivedItemBonuses) {
      const v = _asNumber(b?.value);
      if (!v) continue;
      const itemName = String(b?.itemName ?? "").trim();
      const label = itemName ? `Item Bonus: ${itemName}` : "Item Bonus";
      breakdown.push({ label, value: v, source: "itemBonus" });
    }
  }

  const fatigue = needsRuntimeFatigueWound ? _asNumber(actorSystem?.fatigue?.penalty) : 0;
  if (fatigue) breakdown.push({ label: "Fatigue", value: fatigue, source: "fatigue" });

  const enc = _asNumber(actorSystem?.carry_rating?.penalty);
  if (enc) {
    // Chapter 1/7: scope encumbrance to STR/END/AGI-governed tests only.
    // NPC profession pseudo-items (type: "profession") preserve legacy always-apply behavior.
    let applyEnc = false;
    if (skill?.type === "profession") {
      applyEnc = true;
    } else if (isCharacteristic) {
      applyEnc = _encumbrancePhysicalKey(skill?._characteristicKey ?? "");
    } else {
      // Effective characteristic: selectedCharKey if valid in governing set, else baseCha.
      const effectiveCharKey = (selectedCharKey && governingTokens.has(selectedCharKey))
        ? selectedCharKey
        : currentBaseCharKey;
      if (_encumbrancePhysicalKey(effectiveCharKey)) {
        applyEnc = true;
      } else {
        // Secondary rule: skill.system.tags may contain "physical" or "movement" to opt-in.
        const tags = Array.isArray(skill?.system?.tags) ? skill.system.tags : [];
        applyEnc = tags.some(t => t === "physical" || t === "movement");
      }
    }
    if (applyEnc) {
      breakdown.push({ label: "Encumbrance", value: enc, source: "encumbrance" });
    }
  }

  // Mobility: armor weight class penalties (RAW).
  // We rely on the derived actor.system.mobility object.
  // - Light: -10 Acrobatics
  // - Medium/Heavy/Super-Heavy: Agility-based tests (except Combat Style)
  // - Crippling: -40 all tests
  const mobility = actorSystem?.mobility ?? {};
  const allTestPenalty = _asNumber(mobility?.allTestPenalty);
  if (allTestPenalty) breakdown.push({ label: "Armor: Crippling", value: allTestPenalty, source: "armorAll" });

  const nameKey = String(skill?.name ?? "").trim().toLowerCase();
  const skillSpecific = _asNumber(mobility?.skillTestPenalties?.[nameKey]);
  if (skillSpecific) breakdown.push({ label: "Armor: Penalty", value: skillSpecific, source: "armorSkill" });

  const mobilityAgiPenalty = (_isAgilityBasedSkill({ system: skill.system }) && !_isCombatStyle({ type: skill.type, name: skill.name }))
    ? _asNumber(mobility?.agilityTestPenalty)
    : 0;
  if (mobilityAgiPenalty) breakdown.push({ label: "Armor: Penalty", value: mobilityAgiPenalty, source: "armorAgility" });

  // Armored Agility (Chapter 4): reduce Acrobatics penalties gained from armor class by
  // (Acrobatics rank - 1) * 10 (cannot turn a penalty into a bonus).
  if (nameKey === "acrobatics") {
    const aa = getArmoredAgilityAcrobaticsBonus(actor, mobility);
    if (aa > 0) breakdown.push({ label: "Talent: Armored Agility", value: aa, source: "talentArmoredAgility" });
  }

  const woundedPenalty = needsRuntimeFatigueWound ? _asNumber(actorSystem?.woundPenalty) : 0;
  if (woundedPenalty) breakdown.push({ label: "Wounded", value: woundedPenalty, source: "wounded" });

  // Environmental penalty scaffolding: optional structured penalties by skill name.
  // This does not require schema changes; callers may supply actorSystem.environment via effects/modules.
  const envPenalty = _asNumber(actorSystem?.environment?.skillPenalties?.[nameKey]);
  if (envPenalty) breakdown.push({ label: "Environment", value: envPenalty, source: "environment" });
  // Difficulty (RAW Chapter 1)
  const diff = getDifficultyByKey(difficultyKey);
  if (diff?.mod) breakdown.push({ label: `Difficulty: ${diff.label}`, value: diff.mod, source: "difficulty" });

  // Specialization (RAW Chapter 3): +10 when applicable.
  const isEvade = String(skill?.name ?? "").trim().toLowerCase() === "evade";
  const specBonus = (useSpecialization && !isEvade) ? 10 : 0;
  if (specBonus) breakdown.push({ label: "Specialization", value: specBonus, source: "specialization" });

  // Situational modifiers (e.g., sensory impairment toggles in opposed workflows).
  if (Array.isArray(situationalMods)) {
    for (const m of situationalMods) {
      const v = _asNumber(m?.value);
      if (!v) continue;
      const label = String(m?.label ?? m?.name ?? "Situational").trim() || "Situational";
      breakdown.push({ label, value: v, source: String(m?.source ?? "situational") });
    }
  }

  const manual = _asNumber(manualMod);
  if (manual) breakdown.push({ label: "Manual Modifier", value: manual, source: "manual" });

  const finalTN = breakdown.reduce((sum, b) => sum + _asNumber(b.value), 0);

  return {
    baseTN: baseSkill,
    finalTN,
    breakdown,
    difficulty: diff,
    useSpecialization: Boolean(useSpecialization)
  };
}
