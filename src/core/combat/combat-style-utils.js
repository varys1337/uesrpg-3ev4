/**
 * src/core/combat/combat-style-utils.js
 *
 * Canonical Combat Style + Special Action utility layer.
 */

import { SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById } from "../config/special-actions.js";
import { SYSTEM_ID } from "../constants.js";

// Backward-compat re-exports: all callers that import from this module continue to work unchanged.
export { SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById } from "../config/special-actions.js";
export { SYSTEM_ID } from "../constants.js";

/**
 * Canonical test-option registry for Special Actions.
 * `npcProfessionKeys` is ordered by preference.
 */
export const SPECIAL_ACTION_TEST_OPTION_REGISTRY = Object.freeze({
  combatStyle: {
    key: "combatStyle",
    label: "Combat Style",
    kind: "combatStyle",
    requirement: "any",
    allowNpcProfessionFallback: true
  },
  combatStyleUnarmed: {
    key: "combatStyleUnarmed",
    label: "Combat Style (unarmed)",
    kind: "combatStyle",
    requirement: "unarmed",
    allowNpcProfessionFallback: true
  },
  combatStyleWithShield: {
    key: "combatStyleWithShield",
    label: "Combat Style (with shield)",
    kind: "combatStyle",
    requirement: "shield",
    allowNpcProfessionFallback: true
  },
  athletics: {
    key: "athletics",
    label: "Athletics",
    kind: "skill",
    skillName: "athletics",
    npcProfessionKeys: ["athletics", "physical"]
  },
  evade: {
    key: "evade",
    label: "Evade",
    kind: "skill",
    skillName: "evade",
    npcProfessionKeys: ["evade"]
  },
  deceive: {
    key: "deceive",
    label: "Deceive",
    kind: "skill",
    skillName: "deceive",
    npcProfessionKeys: ["deceive", "social"]
  },
  observe: {
    key: "observe",
    label: "Observe",
    kind: "skill",
    skillName: "observe",
    npcProfessionKeys: ["observe"]
  }
});

export const SPECIAL_ACTION_TEST_OPTIONS = Object.freeze({
  bash: {
    attacker: ["combatStyleUnarmed", "athletics"],
    defender: ["combatStyleUnarmed", "athletics", "evade"]
  },
  blindOpponent: {
    attacker: ["combatStyle"],
    defender: ["combatStyleWithShield", "evade"]
  },
  disarm: {
    attacker: ["combatStyleUnarmed", "athletics"],
    defender: ["combatStyleUnarmed", "athletics"]
  },
  feint: {
    attacker: ["combatStyle", "deceive"],
    defender: ["combatStyle", "observe"]
  },
  forceMovement: {
    attacker: ["combatStyle"],
    defender: ["combatStyle", "athletics"]
  },
  grapple: {
    attacker: ["combatStyle", "athletics"],
    defender: ["combatStyle", "athletics", "evade"]
  },
  inClose: {
    attacker: ["athletics", "combatStyle"],
    defender: ["athletics", "combatStyle", "evade"]
  },
  resist: {
    attacker: ["combatStyleUnarmed", "athletics"],
    defender: ["combatStyleUnarmed", "athletics"]
  },
  trip: {
    attacker: ["combatStyleUnarmed", "athletics"],
    defender: ["combatStyleUnarmed", "athletics", "evade"]
  }
});

export const NPC_KNOWN_FLAG = "npcSpecialActionsKnown";
const ACTIVE_STYLE_FLAG = "activeCombatStyleId";

/**
 * @param {string} specialActionId
 * @returns {{attacker:string[],defender:string[]}}
 */
export function getSpecialActionTestOptionSet(specialActionId) {
  const key = String(specialActionId ?? "").trim();
  const set = SPECIAL_ACTION_TEST_OPTIONS[key];
  if (!set) return { attacker: [], defender: [] };
  return {
    attacker: Array.isArray(set.attacker) ? set.attacker.slice() : [],
    defender: Array.isArray(set.defender) ? set.defender.slice() : []
  };
}

/**
 * @param {string} specialActionId
 * @param {"attacker"|"defender"} side
 * @returns {string[]}
 */
export function getSpecialActionTestOptionKeys(specialActionId, side = "attacker") {
  const set = getSpecialActionTestOptionSet(specialActionId);
  const lane = (String(side ?? "").toLowerCase() === "defender") ? "defender" : "attacker";
  return Array.isArray(set[lane]) ? set[lane].slice() : [];
}

/**
 * @param {string} key
 * @returns {object|null}
 */
export function getSpecialActionTestOption(key) {
  const k = String(key ?? "").trim();
  if (!k) return null;
  return SPECIAL_ACTION_TEST_OPTION_REGISTRY[k] ?? null;
}

/**
 * @param {Actor} actor
 * @returns {string|null}
 */
export function getActiveCombatStyleId(actor) {
  try {
    const v = actor?.getFlag?.(SYSTEM_ID, ACTIVE_STYLE_FLAG);
    return v ? String(v) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Explicit active combat style lookup (no fallback).
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getExplicitActiveCombatStyleItem(actor) {
  const id = getActiveCombatStyleId(actor);
  if (!id) return null;
  return _resolveOwnedCombatStyle(actor, id);
}

/**
 * Resolve the NPC-known map from Actor flag lane.
 *
 * @param {Actor} actor
 * @returns {Record<string, boolean>}
 */
export function getNpcSpecialActionsKnownMap(actor) {
  try {
    const raw = actor?.getFlag?.(SYSTEM_ID, NPC_KNOWN_FLAG);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch (_e) {
    return {};
  }
}

/**
 * Resolve combat style for a combat test with deterministic fallback.
 *
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {string|null} [opts.preferredStyleUuid]
 * @param {boolean} [opts.actorTypeFallback]
 * @returns {{styleUuid:string,styleId:string|null,styleName:string,styleItem:object,base:number,isProfessionFallback:boolean,source:string}|null}
 */
export function resolveStyleForCombatTest(actor, { preferredStyleUuid = null, actorTypeFallback = true } = {}) {
  if (!actor) return null;

  const isNpc = String(actor?.type ?? "").toLowerCase() === "npc";
  const preferred = String(preferredStyleUuid ?? "").trim();

  if (preferred) {
    const owned = _resolveOwnedCombatStyle(actor, preferred);
    if (owned) return _buildStyleContext(actor, owned, { source: "preferred", isProfessionFallback: false });

    if (isNpc && actorTypeFallback && preferred === "prof:combat") {
      const prof = _buildCombatProfessionStyle(actor);
      if (prof) return _buildStyleContext(actor, prof, { source: "preferred-profession", isProfessionFallback: true });
    }
  }

  const activeId = getActiveCombatStyleId(actor);
  if (activeId) {
    const active = _resolveOwnedCombatStyle(actor, activeId);
    if (active) return _buildStyleContext(actor, active, { source: "active", isProfessionFallback: false });
  }

  const firstOwned = _listOwnedCombatStyles(actor)[0] ?? null;
  if (firstOwned) return _buildStyleContext(actor, firstOwned, { source: "owned", isProfessionFallback: false });

  if (isNpc && actorTypeFallback) {
    const prof = _buildCombatProfessionStyle(actor);
    if (prof) return _buildStyleContext(actor, prof, { source: "profession-fallback", isProfessionFallback: true });
  }

  return null;
}

/**
 * Resolve known Special Actions for a specific style (or style-like reference).
 *
 * @param {Actor} actor
 * @param {string|null} styleUuidOrId
 * @param {object} [opts]
 * @param {boolean} [opts.legacyNpcFallback]
 * @returns {Set<string>}
 */
export function getKnownSpecialActionIdsForStyle(actor, styleUuidOrId, { legacyNpcFallback = false } = {}) {
  const known = new Set();
  const ref = String(styleUuidOrId ?? "").trim();

  if (ref && !ref.startsWith("prof:")) {
    const style = _resolveOwnedCombatStyle(actor, ref);
    const map = style?.system?.specialAdvantages;
    if (map && typeof map === "object") {
      for (const sa of SPECIAL_ACTIONS) {
        if (map?.[sa.id] === true) known.add(sa.id);
      }
    }
  }

  if (known.size > 0) return known;

  if (legacyNpcFallback && String(actor?.type ?? "").toLowerCase() === "npc") {
    const map = getNpcSpecialActionsKnownMap(actor);
    for (const sa of SPECIAL_ACTIONS) {
      if (map?.[sa.id] === true) known.add(sa.id);
    }
  }

  return known;
}

/**
 * Backward-compatible wrapper for explicit active style lane.
 *
 * @param {Actor} actor
 * @returns {Set<string>}
 */
export function getKnownSpecialActionIdsFromActiveStyle(actor) {
  const styleId = getActiveCombatStyleId(actor);
  return getKnownSpecialActionIdsForStyle(actor, styleId, { legacyNpcFallback: false });
}

/**
 * Determine which Special Action ids are "known" for this Actor.
 *
 * @param {Actor} actor
 * @returns {Set<string>}
 */
export function getKnownSpecialActionIds(actor) {
  const styleId = getActiveCombatStyleId(actor);
  const isNpc = String(actor?.type ?? "").toLowerCase() === "npc";
  return getKnownSpecialActionIdsForStyle(actor, styleId, {
    legacyNpcFallback: isNpc && !styleId
  });
}

/**
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {string|null} [opts.styleUuidOrId]
 * @param {boolean} [opts.legacyNpcFallback]
 * @returns {Array<{id:string,name:string,actionType:string,known:boolean}>}
 */
export function buildSpecialActionsForActor(actor, { styleUuidOrId = null, legacyNpcFallback = true } = {}) {
  const knownIds = (styleUuidOrId != null)
    ? getKnownSpecialActionIdsForStyle(actor, styleUuidOrId, { legacyNpcFallback })
    : getKnownSpecialActionIds(actor);

  return SPECIAL_ACTIONS
    .filter((sa) => sa?.id !== "grapple")
    .map((sa) => ({
    id: sa.id,
    name: sa.name,
    actionType: sa.actionType,
    known: knownIds.has(sa.id),
  }));
}

/**
 * Build legal test choices for a Special Action lane.
 *
 * @param {Actor} actor
 * @param {object} opts
 * @param {string} opts.specialActionId
 * @param {"attacker"|"defender"} opts.side
 * @param {string|null} [opts.preferredStyleUuid]
 * @returns {Array<{optionKey:string,testType:string,skillUuid:string,label:string,kind:string}>}
 */
export function buildSpecialActionTestChoicesForActor(actor, { specialActionId, side = "attacker", preferredStyleUuid = null } = {}) {
  const out = [];
  const seen = new Set();
  const optionKeys = getSpecialActionTestOptionKeys(specialActionId, side);
  const isNpc = String(actor?.type ?? "").toLowerCase() === "npc";
  const preferred = String(preferredStyleUuid ?? "").trim();

  for (const key of optionKeys) {
    const opt = getSpecialActionTestOption(key);
    if (!opt) continue;

    if (opt.kind === "combatStyle") {
      const styles = _listOwnedCombatStyles(actor);
      const ordered = _orderStylesByPreferred(styles, preferred);
      const filtered = ordered.filter(style => _styleMatchesRequirement(style, opt.requirement));

      for (const style of filtered) {
        const skillUuid = String(style?.uuid ?? "");
        if (!skillUuid || seen.has(skillUuid)) continue;
        seen.add(skillUuid);
        out.push({
          optionKey: key,
          testType: "combatStyle",
          skillUuid,
          label: `${style.name} (${opt.label})`,
          kind: "combatStyle"
        });
      }

      if (!filtered.length && isNpc && opt.allowNpcProfessionFallback) {
        const prof = _buildCombatProfessionStyle(actor);
        const profUuid = String(prof?.uuid ?? "");
        if (profUuid && !seen.has(profUuid)) {
          seen.add(profUuid);
          out.push({
            optionKey: key,
            testType: "combatProfession",
            skillUuid: profUuid,
            label: "Combat (Profession)",
            kind: "profession"
          });
        }
      }

      continue;
    }

    if (opt.kind === "skill") {
      const skill = _findSkillByName(actor, opt.skillName);
      if (skill?.uuid && !seen.has(skill.uuid)) {
        seen.add(skill.uuid);
        out.push({
          optionKey: key,
          testType: opt.skillName,
          skillUuid: skill.uuid,
          label: opt.label,
          kind: "skill"
        });
        continue;
      }

      if (isNpc) {
        const profUuid = _resolveNpcProfessionUuid(actor, opt.npcProfessionKeys);
        if (profUuid && !seen.has(profUuid)) {
          seen.add(profUuid);
          out.push({
            optionKey: key,
            testType: opt.skillName,
            skillUuid: profUuid,
            label: `${opt.label} (Profession)`,
            kind: "profession"
          });
        }
      }
    }
  }

  return out;
}

/**
 * Determine whether a Primary action is legal for the actor now.
 * Secondary actions are allowed even when it's not their turn.
 *
 * @param {Actor} actor
 * @param {"primary"|"secondary"} actionType
 * @returns {boolean}
 */
export function isSpecialActionUsableNow(actor, actionType) {
  const t = String(actionType ?? "").toLowerCase();
  if (t === "secondary") return true;
  if (t !== "primary") return true;

  const combat = game?.combat;
  if (!combat || !combat.started) return true;

  const active = combat.combatant;
  const actorId = actor?.id;
  return Boolean(active && active.actor?.id === actorId);
}

/**
 * @param {Item|object|null} combatStyleItem
 * @returns {boolean}
 */
export function isUnarmedCombatStyleItem(combatStyleItem) {
  if (!combatStyleItem) return false;
  const name = String(combatStyleItem.name ?? "").trim().toLowerCase();
  const trainedEquipment = Array.isArray(combatStyleItem?.system?.trainedEquipment)
    ? combatStyleItem.system.trainedEquipment
    : [];
  const trainedText = trainedEquipment
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" | ");
  const haystack = `${name} | ${trainedText}`;
  return (
    haystack.includes("unarmed")
    || haystack.includes("hand to hand")
    || haystack.includes("hand-to-hand")
    || haystack.includes("brawling")
    || haystack.includes("martial arts")
    || haystack.includes("fist")
    || haystack.includes("punch")
    || haystack.includes("kick")
  );
}

/**
 * @param {Item|object|null} combatStyleItem
 * @returns {boolean}
 */
export function canCombatStyleUseShield(combatStyleItem) {
  if (!combatStyleItem) return false;
  const name = String(combatStyleItem.name ?? "").trim().toLowerCase();
  if (isUnarmedCombatStyleItem(combatStyleItem)) return false;
  if (name.includes("two-handed") || name.includes("two handed")) return false;
  return true;
}

function _listOwnedCombatStyles(actor) {
  return actor?.itemTypes?.combatStyle
    ?? actor?.items?.filter?.((i) => i?.type === "combatStyle")
    ?? [];
}

function _resolveOwnedCombatStyle(actor, styleUuidOrId) {
  const key = String(styleUuidOrId ?? "").trim();
  if (!actor || !key) return null;

  const byUuid = (actor?.items ?? []).find(i => String(i?.uuid ?? "") === key);
  if (byUuid) return byUuid;

  return actor?.items?.get?.(key) ?? null;
}

function _buildCombatProfessionStyle(actor) {
  const hasCombatProfession = Object.prototype.hasOwnProperty.call(actor?.system?.professions ?? {}, "combat");
  if (!hasCombatProfession) return null;
  const base = Number(actor?.system?.professions?.combat ?? 0) || 0;
  return {
    uuid: "prof:combat",
    id: "prof:combat",
    type: "combatStyle",
    name: "Combat (Profession)",
    system: { value: base, bonus: 0, miscValue: 0 },
    _professionKey: "combat"
  };
}

function _buildStyleContext(actor, styleItem, { source, isProfessionFallback } = {}) {
  if (!styleItem) return null;
  const styleUuid = String(styleItem?.uuid ?? styleItem?.id ?? "").trim();
  const base = Number(styleItem?.system?.value ?? styleItem?.system?.base ?? 0) || 0;
  return {
    styleUuid,
    styleId: styleItem?.id ? String(styleItem.id) : null,
    styleName: String(styleItem?.name ?? "Combat Style"),
    styleItem,
    base,
    isProfessionFallback: Boolean(isProfessionFallback),
    source: String(source ?? "unknown")
  };
}

function _orderStylesByPreferred(styles, preferredStyleUuid) {
  if (!Array.isArray(styles) || !styles.length) return [];
  const preferred = String(preferredStyleUuid ?? "").trim();
  if (!preferred) return styles.slice();
  const idx = styles.findIndex(s => String(s?.uuid ?? "") === preferred || String(s?.id ?? "") === preferred);
  if (idx <= 0) return styles.slice();
  const out = styles.slice();
  const [selected] = out.splice(idx, 1);
  out.unshift(selected);
  return out;
}

function _styleMatchesRequirement(style, requirement) {
  const req = String(requirement ?? "any").toLowerCase();
  if (req === "any") return true;
  if (req === "unarmed") return isUnarmedCombatStyleItem(style);
  if (req === "shield") return canCombatStyleUseShield(style);
  return true;
}

function _findSkillByName(actor, skillName) {
  const wanted = String(skillName ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const skills = actor?.itemTypes?.skill ?? actor?.items?.filter?.(i => i?.type === "skill") ?? [];
  return skills.find(i => String(i?.name ?? "").trim().toLowerCase() === wanted) ?? null;
}

function _resolveNpcProfessionUuid(actor, professionKeys) {
  if (String(actor?.type ?? "").toLowerCase() !== "npc") return null;
  const keys = Array.isArray(professionKeys) ? professionKeys : [];
  const professions = actor?.system?.professions ?? {};
  for (const raw of keys) {
    const key = String(raw ?? "").trim().toLowerCase();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(professions, key)) return `prof:${key}`;
  }
  return null;
}
