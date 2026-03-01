/**
 * src/core/conditions/condition-engine.js
 *
 * ActiveEffect-backed conditions that require deterministic automation.
 *
 * Scope (Package 1):
 *  - Bleeding (X)
 *  - Burning (X)
 *
 * Design:
 *  - No schema changes
 *  - No direct document mutation (uses document update APIs)
 *  - Conditions persist as actor ActiveEffects with system-scoped flags
 */

import { applyDamage, DAMAGE_TYPES } from "../../combat/damage-automation.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { isActorSkeletal, isActorUndead, isActorUndeadBloodless, isActorImmuneToCondition as isActorImmuneToConditionProfile } from "../../traits/trait-registry.js";
import { CONDITION_DESCRIPTIONS } from "../../../data/conditions/conditions-data.js";
import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";

let _conditionHooksRegistered = false;

const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const BURNING_GATE_FLAG = "chapter5.burningActionGate";
const SILENCED_REALIZATION_FLAG = "chapter5.silencedRealization";

function _knownStatusIds() {
  try {
    const list = Array.isArray(CONFIG?.statusEffects) ? CONFIG.statusEffects : [];
    return new Set(list.map(se => se?.id).filter(Boolean));
  } catch (_e) {
    return new Set();
  }
}

function _coreStatusIdForKey(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return null;
  const ids = _knownStatusIds();
  return ids.has(k) ? k : null;
}

function _immunityFlagIsTrue(raw) {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;

  const n = Number(raw);
  if (Number.isFinite(n)) return n !== 0;

  const s = String(raw).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "on";
}

function _effectHasCoreStatus(effect, key) {
  const k = String(key || "").trim().toLowerCase();
  if (!effect || !k) return false;

  try {
    const statusId = effect.getFlag?.("core", "statusId");
    if (String(statusId || "").toLowerCase() === k) return true;
  } catch (_e) {}

  try {
    const statuses = effect?.statuses;
    if (statuses && typeof statuses.has === "function") return statuses.has(k);
    if (Array.isArray(statuses)) return statuses.map(s => String(s).toLowerCase()).includes(k);
  } catch (_e) {}

  return false;
}

function _coreStatusAliasesForKey(key) {
  const k = _normalizeConditionKey(key);
  if (!k) return [];
  // Foundry core uses 'blind'/'deaf' while the system uses 'blinded'/'deafened'.
  if (k === "blinded") return ["blinded", "blind"];
  if (k === "deafened") return ["deafened", "deaf"];
  return [k];
}

function _findCoreStatusEffect(actor, key) {
  const aliases = _coreStatusAliasesForKey(key);
  if (!aliases.length) return null;
  const effects = _effects(actor);
  for (const k of aliases) {
    const hit = effects.find(e => _effectHasCoreStatus(e, k));
    if (hit) return hit;
  }
  return null;
}

function _findCoreStatusEffects(actor, key) {
  const aliases = _coreStatusAliasesForKey(key);
  if (!aliases.length) return [];
  const out = [];
  const effects = _effects(actor);
  for (const ef of effects) {
    if (!ef) continue;
    for (const k of aliases) {
      if (_effectHasCoreStatus(ef, k)) {
        out.push(ef);
        break;
      }
    }
  }
  return out;
}


function _effects(actor) {
  return actor?.effects?.contents ?? [];
}

function _findConditionEffect(actor, key) {
  const k = _normalizeConditionKey(key);
  if (!k) return null;

  // Canonical system-scoped condition effect.
  const byFlag = _effects(actor).find(e => e?.getFlag?.(FLAG_SCOPE, "condition")?.key === k) ?? null;
  if (byFlag) return byFlag;

  // Core status effect interop (Token HUD or other tooling).
  return _findCoreStatusEffect(actor, k);
}

function _getConditionData(effect) {
  return effect?.getFlag?.(FLAG_SCOPE, "condition") ?? null;
}

function _toNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function _isActiveCombatant(actor) {
  try {
    const c = game.combat?.combatant?.actor;
    return !!(c && actor && c.uuid === actor.uuid);
  } catch (_e) {
    return false;
  }
}

function _activeCombatTurnKeyForActor(actor) {
  const combat = game.combat ?? null;
  if (!combat?.id || !combat.started || !actor) return null;
  const combatant = (combat.combatants ?? []).find?.((c) => c?.actor?.id === actor.id) ?? null;
  if (!combatant?.id) return null;
  const round = Number(combat.round ?? 0) || 0;
  const turn = Number(combat.turn ?? 0) || 0;
  return `${combat.id}:${round}:${turn}:${combatant.id}`;
}

function _getCharacteristicTotal(actor, key) {
  return _toNumber(actor?.system?.characteristics?.[key]?.total ?? 0, 0);
}

function _mkBaseEffectData({ name, img = null, icon = null, description = null, condition, changes = [], origin = null, statuses = null, coreStatusId = null }) {
  const effectImg = img ?? icon ?? null;
  const conditionKey = condition?.key;
  const isNumericCondition = conditionKey === "bleeding" || conditionKey === "burning" || conditionKey === "flanked";
  const stackRule = isNumericCondition ? "refresh" : "override";
  const effectGroup = conditionKey ? `condition.${conditionKey}` : null;
  
  const data = {
    name,
    // Foundry v13 ActiveEffect data uses "img". Accept a legacy "icon" arg internally.
    img: effectImg,
    origin: origin ?? null,
    disabled: false,
    duration: {},
    changes,
    flags: {
      [FLAG_SCOPE]: {
        condition,
        owner: "system",
        source: "condition"
      }
    }
  };

  // Add standardized metadata flags
  if (effectGroup) {
    data.flags[FLAG_SCOPE].effectGroup = effectGroup;
    data.flags[FLAG_SCOPE].stackRule = stackRule;
  }

  // Add description if provided (for tooltips and effect sheets)
  if (description) {
    data.description = description;
  }

  if (coreStatusId) {
    data.flags.core = { statusId: coreStatusId };
  }
  if (Array.isArray(statuses) && statuses.length) {
    data.statuses = statuses;
  }
  return data;
}

// -------------------------------------------------------------------------------------
// Static conditions (Package 2/3)
//
// These conditions do not require turn-based ticking. They exist primarily to:
//  - provide deterministic modifier lanes (if configured via AE changes)
//  - allow other subsystems (combat workflow) to gate actions consistently
//
// IMPORTANT: Keep these definitions minimal and non-invasive. Do not introduce schema
// changes or direct document mutation.
// -------------------------------------------------------------------------------------

const STATIC_CONDITIONS = {
  // Package 2: common static conditions with deterministic TN modifiers.
  blinded: {
    name: "Blinded",
    img: "icons/svg/blind.svg",
    description: CONDITION_DESCRIPTIONS.get("blinded"),
    // RAW: -30 penalty to tests benefitting from sight.
    // Deterministic automation scope: Combat Style tests + Observe.
    changes: [
      { key: "system.modifiers.skills.observe", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -30, priority: 20 }
    ]
  },

  deafened: {
    name: "Deafened",
    img: "icons/svg/deaf.svg",
    description: CONDITION_DESCRIPTIONS.get("deafened"),
    // RAW: -30 penalty to tests benefitting from hearing.
    // Deterministic automation scope: Observe.
    changes: [
      { key: "system.modifiers.skills.observe", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -30, priority: 20 }
    ]
  },

  crippled: {
    name: "Crippled",
    img: "icons/svg/bones.svg",
    description: CONDITION_DESCRIPTIONS.get("crippled"),
    // Tracking-only condition for now (no hard automation yet).
    changes: []
  },

  silenced: {
    name: "Silenced",
    img: "icons/svg/sound-off.svg",
    description: CONDITION_DESCRIPTIONS.get("silenced"),
    // Tracking-only condition for now (no hard automation yet).
    changes: []
  },

  stunned: {
    name: "Stunned",
    img: "icons/svg/stoned.svg",
    description: CONDITION_DESCRIPTIONS.get("stunned"),
    // Tracking-only condition for now (no hard automation yet).
    changes: []
  },

  entangled: {
    name: "Entangled",
    img: "icons/svg/net.svg",
    description: CONDITION_DESCRIPTIONS.get("entangled"),
    // RAW: -20 penalty to all Combat Style tests.
    // NOTE: Movement halving is enforced in actor derived Speed (Package 4).
    changes: [
      { key: "system.modifiers.combat.attackTN", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -20, priority: 20 },
      { key: "system.modifiers.combat.defenseTN.total", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -20, priority: 20 }
    ]
  },

  dazed: {
    name: "Dazed",
    img: "icons/svg/daze.svg",
    description: CONDITION_DESCRIPTIONS.get("dazed"),
    // RAW: Gain 1 fewer Action Point at the beginning of each round (minimum 1).
    // Automation approach: reduce AP max by 1; combat AP refresh clamps to minimum 1 while Dazed.
    changes: [
      { key: "system.action_points.max", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1, priority: 20 }
    ]
  },

  hidden: {
    name: "Hidden",
    img: "icons/svg/cowled.svg",
    description: CONDITION_DESCRIPTIONS.get("hidden"),
    // Core icon (Foundry) used in the Token HUD palette.
    // RAW: Enemies cannot defend themselves against attacks from hidden characters.
    // Movement costs double (handled via derived Speed in Actor data).
    // Auto-removal after making an attack is handled in the opposed workflow.
    changes: []
  },

  invisible: {
    name: "Invisible",
    img: "icons/svg/invisible.svg",
    description: CONDITION_DESCRIPTIONS.get("invisible"),
    // RAW: Attacks made against invisible targets suffer -30 TN (handled in opposed workflow).
    changes: []
  },

  frenzied: {
    name: "Frenzied",
    img: "icons/svg/terror.svg",
    description: CONDITION_DESCRIPTIONS.get("frenzied"),
    // Automated via frenzied.js; changes are dynamic based on talents
    changes: []
  },


  prone: {
    name: "Prone",
    img: "icons/svg/falling.svg",
    description: CONDITION_DESCRIPTIONS.get("prone"),
    // RAW: -20 penalty to all Combat related tests.
    // NOTE: Movement restriction + stand-up cost are enforced via Package 4 semantics.
    changes: [
      { key: "system.modifiers.combat.attackTN", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -20, priority: 20 },
      { key: "system.modifiers.combat.defenseTN.total", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -20, priority: 20 }
    ]
  },

  // Package 3 gating conditions (primarily action/defense restrictions elsewhere)
  unconscious: {
    name: "Unconscious",
    img: "icons/svg/unconscious.svg",
    description: CONDITION_DESCRIPTIONS.get("unconscious"),
    changes: []
  },
  paralyzed: {
    name: "Paralyzed",
    img: "icons/svg/paralysis.svg",
    description: CONDITION_DESCRIPTIONS.get("paralyzed"),
    changes: []
  },
  restrained: {
    name: "Restrained",
    img: "icons/svg/anchor.svg",
    description: CONDITION_DESCRIPTIONS.get("restrained"),
    changes: []
  },
  grappled: {
    name: "Grappled",
    img: "icons/svg/grab.svg",
    description: CONDITION_DESCRIPTIONS.get("grappled"),
    changes: []
  },

  // Special Actions conditions
  feinted: {
    name: "Feinted",
    img: "icons/svg/combat.svg",
    description: CONDITION_DESCRIPTIONS.get("feinted"),
    changes: []
  },

  // Package 4: movement restriction semantics (no TN modifiers; applied in derived Speed)
  slowed: {
    name: "Slowed",
    img: "icons/svg/wingfoot.svg",
    description: CONDITION_DESCRIPTIONS.get("slowed"),
    // Core icon (Foundry) used in the Token HUD palette.
    changes: []
  },
  immobilized: {
    name: "Immobilized",
    img: "icons/svg/statue.svg",
    description: CONDITION_DESCRIPTIONS.get("immobilized"),
    changes: []
  },

  // Homebrew — Engagement & Flanking
  // Numeric tracking condition; effects are applied in combat TN computation.
  flanked: {
    name: "Flanked (X)",
    img: "icons/svg/target.svg",
    description: CONDITION_DESCRIPTIONS.get("flanked"),
    changes: []
  },

  // Homebrew — Reach & Length Overhaul
  // No persistent AE modifiers; the Length Penalty direction is resolved at TN time.
  inclose: {
    name: "In Close",
    img: "icons/svg/combat.svg",
    description: CONDITION_DESCRIPTIONS.get("inclose"),
    changes: []
  }
};

// -------------------------------------------------------------------------------------
// Token HUD status parity
//
// We expose system conditions in CONFIG.statusEffects so the Token HUD palette matches the
// system's canonical condition set. In addition, we provide a lightweight upgrade helper
// to repair any "empty" core status effects created by earlier buggy builds.
// -------------------------------------------------------------------------------------

/**
 * Ordered list of condition keys shown in the Token HUD.
 *
 * Keep this list conservative: only include conditions that are safe and already implemented.
 */
const TOKEN_HUD_CONDITION_ORDER = [
  "bleeding",
  "blinded",
  "burning",
  "dazed",
  "deafened",
  "crippled",
  "entangled",
  "flanked",
  "frenzied",
  "hidden",
  "immobilized",
  "inclose",
  "invisible",
  "paralyzed",
  "prone",
  "restrained",
  "silenced",
  "slowed",
  "stunned",
  "unconscious",
];

/** @type {Set<string>} */
export const SYSTEM_TOKEN_HUD_STATUS_ID_SET = new Set(TOKEN_HUD_CONDITION_ORDER);

/**
 * Canonical condition keys for traits and immunities.
 * Built from the Token HUD list plus any static conditions not shown in the HUD.
 */
export const CONDITION_KEYS = Object.freeze((() => {
  const out = new Set();
  for (const key of TOKEN_HUD_CONDITION_ORDER) {
    const k = _normalizeConditionKey(key);
    if (k) out.add(k);
  }
  for (const key of Object.keys(STATIC_CONDITIONS ?? {})) {
    const k = _normalizeConditionKey(key);
    if (k) out.add(k);
  }
  return Array.from(out);
})());

/** @type {Set<string>} */
export const TOKEN_HUD_XVALUE_STATUS_ID_SET = new Set(["bleeding", "burning", "flanked"]);

function _deepClone(obj) {
  try {
    return foundry?.utils?.deepClone ? foundry.utils.deepClone(obj) : JSON.parse(JSON.stringify(obj));
  } catch (_e) {
    return obj;
  }
}

function _mkTokenHudStatusConfigForStatic(key) {
  const k = _normalizeConditionKey(key);
  const def = STATIC_CONDITIONS[k];
  if (!def) return null;

  const changes = Array.isArray(def.changes) ? _deepClone(def.changes) : [];
  return {
    id: k,
    name: def.name,
    img: def.img,
    description: def.description ?? null,
    hud: true,
    disabled: false,
    duration: {},
    changes,
    statuses: [k],
    flags: {
      core: { statusId: k },
      [FLAG_SCOPE]: {
        condition: {
          key: k,
          value: 1,
          source: def.name
        },
        owner: "system",
        effectGroup: `condition.${k}`,
        stackRule: "override",
        source: "condition"
      }
    }
  };
}

function _mkTokenHudStatusConfigForBleeding() {
  const k = "bleeding";
  return {
    id: k,
    name: "Bleeding",
    img: "icons/svg/blood.svg",
    description: CONDITION_DESCRIPTIONS.get("bleeding") ?? null,
    hud: true,
    disabled: false,
    duration: {},
    changes: _mkBleedingWTChanges(1),
    statuses: [k],
    flags: {
      core: { statusId: k },
      [FLAG_SCOPE]: {
        condition: {
          key: k,
          value: 1,
          delay: 0,
          source: "Bleeding"
        },
        owner: "system",
        effectGroup: `condition.${k}`,
        stackRule: "refresh",
        source: "condition"
      }
    }
  };
}

function _mkTokenHudStatusConfigForBurning() {
  const k = "burning";
  return {
    id: k,
    name: "Burning",
    img: "icons/svg/fire.svg",
    description: CONDITION_DESCRIPTIONS.get("burning") ?? null,
    hud: true,
    disabled: false,
    duration: {},
    changes: [],
    statuses: [k],
    flags: {
      core: { statusId: k },
      [FLAG_SCOPE]: {
        condition: {
          key: k,
          value: 1,
          hitLocation: "Body",
          source: "Burning"
        },
        owner: "system",
        effectGroup: `condition.${k}`,
        stackRule: "refresh",
        source: "condition"
      }
    }
  };
}

/**
 * Build the set of StatusEffectConfig entries used by the Token HUD.
 *
 * Returned objects are safe to assign into CONFIG.statusEffects.
 */
export function getTokenHudStatusEffectConfigs() {
  /** @type {any[]} */
  const out = [];

  for (const key of TOKEN_HUD_CONDITION_ORDER) {
    if (key === "bleeding") {
      out.push(_mkTokenHudStatusConfigForBleeding());
      continue;
    }
    if (key === "burning") {
      out.push(_mkTokenHudStatusConfigForBurning());
      continue;
    }
    const cfg = _mkTokenHudStatusConfigForStatic(key);
    if (cfg) out.push(cfg);
  }
  return out;
}

/**
 * Repair any existing ActiveEffects which were created via core status toggles but
 * are missing the system condition flag lane and/or deterministic AE changes.
 *
 * This is intended as a self-healing migration for previously-broken Token HUD toggles.
 * It is safe and idempotent.
 */
export async function upgradeTokenHudStatusEffects(actor) {
  if (!actor) return;
  const configs = new Map(getTokenHudStatusEffectConfigs().map(c => [String(c.id).toLowerCase(), c]));

  const effects = Array.from(actor.effects ?? []);
  for (const effect of effects) {
    if (!effect) continue;

    let statusId = null;
    try {
      statusId = effect.getFlag?.("core", "statusId") ?? null;
    } catch (_e) {}

    if (!statusId) {
      try {
        const st = effect.statuses;
        if (st && typeof st.has === "function") {
          for (const k of SYSTEM_TOKEN_HUD_STATUS_ID_SET) {
            if (st.has(k)) {
              statusId = k;
              break;
            }
          }
        } else if (Array.isArray(st)) {
          const lower = st.map(s => String(s).toLowerCase());
          statusId = lower.find(s => SYSTEM_TOKEN_HUD_STATUS_ID_SET.has(s)) ?? null;
        }
      } catch (_e) {}
    }

    const k = _normalizeConditionKey(statusId);
    if (!k || !configs.has(k)) continue;

    const cfg = configs.get(k);
    const hasSystemFlag = !!(effect.getFlag?.(FLAG_SCOPE, "condition")?.key);

    // Determine an appropriate value for X-value conditions from the effect name, if present.
    let xValue = 1;
    if (k === "bleeding" || k === "burning" || k === "flanked") {
      try {
        const m = String(effect.name || "").match(/\((\d+)\)/);
        if (m && m[1]) xValue = Math.max(1, Number(m[1]) || 1);
      } catch (_e) {}
    }

    // If already system-scoped, only fix icon/changes/name linkage if needed.
    if (hasSystemFlag) {
      const updates = {};
      if (cfg.img && effect.img !== cfg.img) updates.img = cfg.img;
      if (k === "bleeding") {
        const cur = getConditionValue(actor, k) ?? xValue;
        const desiredName = `Bleeding (${cur})`;
        if (effect.name !== desiredName) updates.name = desiredName;
        updates.changes = _mkBleedingWTChanges(cur);
      }
      if (k === "burning") {
        const cur = getConditionValue(actor, k) ?? xValue;
        const desiredName = `Burning (${cur})`;
        if (effect.name !== desiredName) updates.name = desiredName;
      }
      if (k === "flanked") {
        const cur = getConditionValue(actor, k) ?? xValue;
        const desiredName = `Flanked (${cur})`;
        if (effect.name !== desiredName) updates.name = desiredName;
      }
      // Ensure core linkage exists for toggleStatusEffect removal.
      try {
        if (String(effect.getFlag?.("core", "statusId") || "").toLowerCase() !== k) {
          updates["flags.core.statusId"] = k;
        }
      } catch (_e) {
        updates["flags.core.statusId"] = k;
      }

      updates.statuses = [k];

      if (Object.keys(updates).length) {
        try {
          await requestUpdateDocument(effect, updates);
        } catch (_e) {}
      }
      continue;
    }

    // Upgrade an unscoped core status effect into a system-scoped condition effect.
    const updates = {
      img: cfg.img,
      disabled: false,
      duration: {},
      changes: Array.isArray(cfg.changes) ? _deepClone(cfg.changes) : [],
      statuses: [k],
      "flags.core.statusId": k
    };

    if (k === "bleeding") {
      updates.name = `Bleeding (${xValue})`;
      updates.changes = _mkBleedingWTChanges(xValue);
      updates[`${FLAG_PATH}.condition`] = { key: k, value: xValue, delay: 0, source: "Bleeding" };
    } else if (k === "burning") {
      updates.name = `Burning (${xValue})`;
      updates[`${FLAG_PATH}.condition`] = { key: k, value: xValue, hitLocation: "Body", source: "Burning" };
    } else {
      updates.name = cfg.name;
      updates[`${FLAG_PATH}.condition`] = { key: k, value: 1, source: cfg.name };
    }

    try {
      await requestUpdateDocument(effect, updates);
    } catch (_e) {}
  }

  // Final safety pass: ensure no actor ends up with duplicated condition effects (which would double-count TN lanes).
  try {
    for (const key of SYSTEM_TOKEN_HUD_STATUS_ID_SET) {
      await _dedupeConditionEffects(actor, key);
    }
  } catch (_e) {}

}


function _normalizeConditionKey(key) {
  let k = String(key || "").trim().toLowerCase();
  if (!k) return "";

  // Normalize common core ↔ system naming differences.
  if (k === "blind") k = "blinded";
  if (k === "deaf") k = "deafened";

  // Strip any accidental numeric suffixes from ids/names (e.g., 'bleeding (1)').
  k = k.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
  return k;
}

function _fallbackHasConditionByName(actor, key) {
  const k = _normalizeConditionKey(key);
  if (!k) return false;

  // Core status interop (including aliases).
  if (_findCoreStatusEffect(actor, k)) return true;

  const aliases = new Set(_coreStatusAliasesForKey(k));
  return _effects(actor).some(e => {
    const n = String(e?.name ?? "").trim().toLowerCase();
    for (const a of aliases) {
      if (n === a || n.startsWith(`${a} (`) || n.startsWith(`${a} `)) return true;
    }
    return false;
  });
}

export function hasCondition(actor, key) {
  const k = _normalizeConditionKey(key);
  if (!actor || !k) return false;
  if (_findConditionEffect(actor, k)) return true;
  return _fallbackHasConditionByName(actor, k);
}

/**
 * Determine whether an actor is immune to a condition.
 *
 * Immunities are boolean-semantic flags which may be contributed by traits/talents/powers
 * or Active Effects. Foundry Active Effect values are strings, so we treat any non-zero
 * numeric value as "true".
 *
 * Canonical storage: actor.system.traits.immunity[conditionKey] = 1
 */
export function isImmuneToCondition(actor, key) {
  const k = _normalizeConditionKey(key);
  if (!actor || !k) return false;

  // Built-in immunity list (currently used by Undead and similar traits).
  // Keep this inside the immunity predicate so ALL entry points (including Token HUD) are gated.
  if (isActorUndead(actor)) {
    const blocked = new Set(["dazed", "deafened", "poisoned", "disease"]);
    if (blocked.has(k)) return true;
  }

  const lane = actor?.system?.traits?.immunity ?? null;
  if (lane && typeof lane === "object") {
    // Optional: global immunity (rare, but supported).
    if (_immunityFlagIsTrue(lane._all)) return true;
    if (_immunityFlagIsTrue(lane[k])) return true;
  }

  // Derived trait profile immunity (Talents/Traits/Powers parsing).
  // IMPORTANT: do not require lane presence; items may provide immunity without populating system.traits.immunity.
  try {
    if (isActorImmuneToConditionProfile(actor, k)) return true;
  } catch (_e) {}

  return false;
}

export async function applyCondition(actor, key, { origin = null, source = null } = {}) {
  if (!actor) return null;
  const k = _normalizeConditionKey(key);
  const def = STATIC_CONDITIONS[k];
  if (!def) {
    ui.notifications?.warn?.(`Unknown condition key: ${k}`);
    return null;
  }

  // Global immunity gate (traits/talents/powers + Active Effects).
  // This must apply to all condition entry points, including manual Token HUD toggles.
  if (isImmuneToCondition(actor, k)) {
    ui.notifications?.warn?.(`${actor.name} is immune to ${def.name}.`);
    return null;
  }


  const coreStatusId = _coreStatusIdForKey(k);
  const statuses = coreStatusId ? [coreStatusId] : null;
  const createData = _mkBaseEffectData({
    name: def.name,
    img: def.img,
    description: def.description ?? null,
    statuses,
    coreStatusId,
    origin,
    condition: { key: k, value: 1, source: source ?? def.name },
    changes: Array.isArray(def.changes) ? def.changes : []
  });

  const applied = await _upsertConditionEffect(actor, k, {
    createData,
    updateFn: async (_effect) => {
      const updates = {
        name: def.name,
        img: def.img,
        changes: Array.isArray(def.changes) ? def.changes : [],
        [`${FLAG_PATH}.condition.key`]: k,
        [`${FLAG_PATH}.condition.value`]: 1
      };

      if (coreStatusId) {
        updates["flags.core.statusId"] = coreStatusId;
        updates.statuses = statuses ?? [coreStatusId];
      }

      return updates;
    }
  });

  if (k === "stunned") {
    await _applyStunnedOnApply(actor);
  }

  return applied;
}

export async function toggleCondition(actor, key, { origin = null, source = null } = {}) {
  if (!actor) return null;
  const k = _normalizeConditionKey(key);

  const all = _findAllConditionEffects(actor, k);
  if (all.length) {
    for (const ef of all) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
      } catch (_e) {}
    }
    return null;
  }

  // Immunity gate: prevent manual Token HUD / core status toggles from applying.
  if (isImmuneToCondition(actor, k)) {
    const def = STATIC_CONDITIONS[k];
    ui.notifications?.warn?.(`${actor.name} is immune to ${def?.name ?? k}.`);
    return null;
  }

  return applyCondition(actor, k, { origin, source });
}

async function _applyStunnedOnApply(actor) {
  if (!actor) return;
  const ap = Number(actor?.system?.action_points?.value ?? 0) || 0;
  if (ap <= 0) return;
  await requestUpdateDocument(actor, {
    "system.action_points.value": 0
  });
}

/**
 * Chapter 5 Burning action gate:
 * a burning actor must pass WP-20 each turn before attempting non-extinguish actions.
 */
export async function ensureBurningTurnActionAllowed(actor, { actionId = "action", allowExtinguish = false } = {}) {
  if (!actor) return { allowed: false, reason: "Actor missing" };

  const burningX = Math.max(0, _toNumber(getConditionValue(actor, "burning") ?? 0, 0));
  if (burningX <= 0) return { allowed: true, reason: null, skipped: true };
  if (!(game.combat?.started)) return { allowed: true, reason: null, skipped: true };

  const actionKey = String(actionId ?? "").trim().toLowerCase();
  if (allowExtinguish && (actionKey === "extinguish-burning" || actionKey === "put-out-fire")) {
    return { allowed: true, reason: null, skipped: true };
  }

  const turnKey = _activeCombatTurnKeyForActor(actor) ?? `nocombat:${actor.id}`;
  const prev = actor.getFlag(FLAG_SCOPE, BURNING_GATE_FLAG) ?? null;
  if (prev && typeof prev === "object" && String(prev.turnKey ?? "") === turnKey && typeof prev.allowed === "boolean") {
    return {
      allowed: prev.allowed === true,
      reason: prev.allowed === true ? null : "Burning"
    };
  }

  const tn = _getCharacteristicTotal(actor, "wp") - 20;
  const result = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await result?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — Burning Action Gate (WP ${tn})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking.
  }

  const allowed = result?.isSuccess === true;
  await requestUpdateDocument(actor, {
    [`flags.${FLAG_SCOPE}.${BURNING_GATE_FLAG}`]: {
      turnKey,
      allowed,
      burningX,
      checkedAt: Date.now()
    }
  });

  if (!allowed) {
    await _applyStunnedOnApply(actor);
    return { allowed: false, reason: "Burning" };
  }

  return { allowed: true, reason: null };
}

/**
 * Chapter 5 burning extinguish action:
 * - spend AP in caller
 * - STR/AGI +20, -10 per X beyond 1
 * - actor becomes Prone
 * - on success remove Burning
 */
export async function attemptExtinguishBurning(actor) {
  if (!actor) return { ok: false, reason: "Actor missing" };

  const burningX = Math.max(0, _toNumber(getConditionValue(actor, "burning") ?? 0, 0));
  if (burningX <= 0) return { ok: false, reason: "Not burning" };

  const chooseAgi = await customDialog({
    title: "Put Out Fire",
    content: "<p>Choose Strength or Agility for the extinguish test.</p>",
    buttons: {
      strength: { label: "Strength", callback: () => false },
      agility: { label: "Agility", callback: () => true }
    },
    defaultButton: "strength"
  });

  const charKey = chooseAgi === true ? "agi" : "str";
  const base = _getCharacteristicTotal(actor, charKey);
  const modifier = 20 - (Math.max(0, burningX - 1) * 10);
  const tn = base + modifier;

  const result = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await result?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — Extinguish Fire (${charKey.toUpperCase()} ${tn})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking.
  }

  await applyCondition(actor, "prone", { source: "Burning" });
  if (result?.isSuccess) {
    await removeCondition(actor, "burning");
  }

  return {
    ok: true,
    success: result?.isSuccess === true,
    burningValue: burningX
  };
}

/**
 * Silenced realization check (start of round).
 */
export async function runSilencedRealizationCheck(actor, { combat = game.combat } = {}) {
  if (!actor || !combat?.id || !combat?.started) return null;
  if (!hasCondition(actor, "silenced")) return null;

  const round = Number(combat.round ?? 0) || 0;
  const roundKey = `${combat.id}:${round}`;
  const prev = actor.getFlag(FLAG_SCOPE, SILENCED_REALIZATION_FLAG) ?? null;
  if (prev && typeof prev === "object" && String(prev.roundKey ?? "") === roundKey) return prev;

  const tn = _getCharacteristicTotal(actor, "prc");
  const result = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await result?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — Silenced Realization (PRC ${tn})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking.
  }

  const realized = result?.isSuccess === true;
  const payload = {
    roundKey,
    realized,
    checkedAt: Date.now()
  };

  await requestUpdateDocument(actor, {
    [`flags.${FLAG_SCOPE}.${SILENCED_REALIZATION_FLAG}`]: payload
  });

  return payload;
}


async function _postConditionNote(actor, content) {
  try {
    const speaker = ChatMessage.getSpeaker({ actor });
    await ChatMessage.create({ speaker, content });
  } catch (_e) {}
}

function _mkBleedingWTChanges(x) {
  const v = Math.max(0, _toNumber(x, 0));
  return [
    {
      // Apply to the final derived WT lane; actor derived-data reads this lane deterministically.
      // Using .bonus does not reliably propagate into system.wound_threshold.value in this build.
      key: "system.modifiers.wound_threshold.value",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: -v,
      priority: 20
    }
  ];
}

function _findAllConditionEffects(actor, key) {
  const k = _normalizeConditionKey(key);
  if (!k) return [];

  const out = [];
  const effects = _effects(actor);
  const aliases = _coreStatusAliasesForKey(k);

  for (const ef of effects) {
    if (!ef) continue;

    // Canonical system-scoped condition flag
    try {
      const sysKey = ef?.getFlag?.(FLAG_SCOPE, "condition")?.key;
      if (_normalizeConditionKey(sysKey) === k) {
        out.push(ef);
        continue;
      }
    } catch (_e) {}

    // Core status linkage / statuses set
    for (const a of aliases) {
      if (_effectHasCoreStatus(ef, a)) {
        out.push(ef);
        break;
      }
    }
  }

  return out;
}

async function _dedupeConditionEffects(actor, key) {
  if (!actor) return null;
  const k = _normalizeConditionKey(key);
  if (!k) return null;

  const all = _findAllConditionEffects(actor, k);
  if (all.length <= 1) return all[0] ?? null;

  // Prefer the most-recent system-scoped condition effect; otherwise keep the most-recent matching effect.
  const flagged = all.filter(e => _normalizeConditionKey(e?.getFlag?.(FLAG_SCOPE, "condition")?.key) === k);
  const keep = (flagged.length ? flagged[flagged.length - 1] : all[all.length - 1]) ?? null;

  for (const ef of all) {
    if (!ef || !keep) continue;
    if (ef.id === keep.id) continue;
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
    } catch (_e) {}
  }

  return keep;
}

async function _upsertConditionEffect(actor, key, { createData, updateFn }) {
  const k = _normalizeConditionKey(key);
  if (!k) return null;

  // Ensure we never accumulate multiple effects for the same condition.
  let existing = await _dedupeConditionEffects(actor, k);

  if (!existing) {
    await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [createData]);
    existing = await _dedupeConditionEffects(actor, k);
  }

  if (!existing) return null;

  if (typeof updateFn === "function") {
    const updates = await updateFn(existing);
    if (updates && typeof updates === "object" && Object.keys(updates).length) {
      await requestUpdateDocument(existing, updates);
    }
  }

  // Final dedupe pass: some update flows can re-introduce a core-linked duplicate via toggleStatusEffect.
  return await _dedupeConditionEffects(actor, k);
}

/**
 * Apply or advance Bleeding (X).
 * Rules (Chapter 5):
 *  - Reduce Wound Threshold by X while bleeding.
 *  - At end of the character's next Turn, they take X damage (bypass AR/resistance), then X reduces by 1.
 *  - Healing reduces X by total HP regained (including overheal).
 *  - If applied again, X values add.
 */
export async function applyBleeding(actor, x, { origin = null, source = "Bleeding" } = {}) {
  if (!actor) return null;
  if (isActorUndeadBloodless(actor)) return null;
  if (isImmuneToCondition(actor, "bleeding")) {
    ui.notifications?.warn?.(`${actor.name} is immune to Bleeding.`);
    return null;
  }
  const add = Math.max(0, _toNumber(x, 0));
  if (add <= 0) return null;

  const initialDelay = _isActiveCombatant(actor) ? 1 : 0;

  const coreStatusId = _coreStatusIdForKey("bleeding");
  const statuses = coreStatusId ? [coreStatusId] : null;

  const createData = _mkBaseEffectData({
    name: `Bleeding (${add})`,
    icon: "icons/svg/blood.svg",
    description: CONDITION_DESCRIPTIONS.get("bleeding") ?? null,
    statuses,
    coreStatusId,
    origin,
    condition: { key: "bleeding", value: add, delay: initialDelay, source },
    changes: _mkBleedingWTChanges(add)
  });

  return _upsertConditionEffect(actor, "bleeding", {
    createData,
    updateFn: async (effect) => {
      const c = _getConditionData(effect) ?? {};
      const cur = Math.max(0, _toNumber(c.value, 0));
      const next = cur + add;

      // Do not reset timing; preserve earliest tick.
      const delay = Math.max(0, _toNumber(c.delay, initialDelay));
      const updates = {
        name: `Bleeding (${next})`,
        changes: _mkBleedingWTChanges(next),
        [`${FLAG_PATH}.condition.value`]: next,
        [`${FLAG_PATH}.condition.delay`]: delay
      };

      if (coreStatusId) {
        updates["flags.core.statusId"] = coreStatusId;
        updates.statuses = statuses ?? [coreStatusId];
      }

      return updates;
    }
  });
}

/**
 * Apply or advance Burning (X).
 * Rules (Chapter 5):
 *  - End of each of their turns: take X fire damage to the appropriate hit location, then increase X by 1.
 *  - Stacking: combine X values.
 *
 * NOTE: Action restriction and extinguish action are intentionally deferred (later package).
 */
export async function applyBurning(actor, x, { hitLocation = "Body", origin = null, source = "Burning" } = {}) {
  if (!actor) return null;
  if (isActorSkeletal(actor)) return null;
  if (isImmuneToCondition(actor, "burning")) {
    ui.notifications?.warn?.(`${actor.name} is immune to Burning.`);
    return null;
  }
  const add = Math.max(0, _toNumber(x, 0));
  if (add <= 0) return null;

  const loc = String(hitLocation || "Body");

  const coreStatusId = _coreStatusIdForKey("burning");
  const statuses = coreStatusId ? [coreStatusId] : null;

  const createData = _mkBaseEffectData({
    name: `Burning (${add})`,
    icon: "icons/svg/fire.svg",
    description: CONDITION_DESCRIPTIONS.get("burning") ?? null,
    statuses,
    coreStatusId,
    origin,
    condition: { key: "burning", value: add, hitLocation: loc, source },
    changes: []
  });

  return _upsertConditionEffect(actor, "burning", {
    createData,
    updateFn: async (effect) => {
      const c = _getConditionData(effect) ?? {};
      const cur = Math.max(0, _toNumber(c.value, 0));
      const next = cur + add;

      // Preserve stored hit location if already present.
      const storedLoc = String(c.hitLocation || loc);

      const updates = {
        name: `Burning (${next})`,
        [`${FLAG_PATH}.condition.value`]: next,
        [`${FLAG_PATH}.condition.hitLocation`]: storedLoc
      };

      if (coreStatusId) {
        updates["flags.core.statusId"] = coreStatusId;
        updates.statuses = statuses ?? [coreStatusId];
      }

      return updates;
    }
  });
}


/**
 * Set the numeric value (X) for a condition effect, if supported.
 *
 * Supported:
 *  - bleeding (updates WT penalty lane and preserves tick delay by default)
 *  - burning (preserves stored hit location)
 *
 * For non-numeric (static) conditions, values are treated as boolean: value>0 applies, value<=0 removes.
 */
export async function setConditionValue(actor, key, value, { preserveTiming = true } = {}) {
  if (!actor) return null;
  const k = _normalizeConditionKey(key);
  const next = Math.max(0, _toNumber(value, 0));

  // Apply if missing
  const existing = _findConditionEffect(actor, k);

  // Immunity gate: allow removal (next<=0), but block any attempt to apply/set a positive
  // value for an immune condition. This closes the "manual token HUD" bypass.
  if (next > 0 && isImmuneToCondition(actor, k)) {
    const def = STATIC_CONDITIONS[k];
    ui.notifications?.warn?.(`${actor.name} is immune to ${def?.name ?? k}.`);
    return existing ?? null;
  }

  if (!existing) {
    if (next <= 0) return null;

    if (k === "bleeding") return applyBleeding(actor, next, { origin: null, source: "Bleeding" });
    if (k === "burning") return applyBurning(actor, next, { origin: null, source: "Burning" });
    if (k === "flanked") {
      await applyCondition(actor, k, { origin: null, source: "Engagement & Flanking" });
      return setConditionValue(actor, k, next);
    }
    return applyCondition(actor, k, { origin: null, source: null });
  }

  if (next <= 0) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existing.id]);
    return null;
  }

  // Keep core status linkage if configured
  const coreStatusId = _coreStatusIdForKey(k);
  const statuses = coreStatusId ? [coreStatusId] : null;

  const updates = {
    name: existing.name,
    [`${FLAG_PATH}.condition.key`]: k,
    [`${FLAG_PATH}.condition.value`]: next
  };

  if (coreStatusId) {
    updates["flags.core.statusId"] = coreStatusId;
    updates.statuses = statuses ?? [coreStatusId];
  }

  if (k === "bleeding") {
    // Preserve delay by default. If the existing effect has no delay, keep 0.
    const c = _getConditionData(existing) ?? {};
    const delay = preserveTiming ? Math.max(0, _toNumber(c.delay, 0)) : 0;
    updates.name = `Bleeding (${next})`;
    updates.changes = _mkBleedingWTChanges(next);
    updates[`${FLAG_PATH}.condition.delay`] = delay;
  } else if (k === "burning") {
    const c = _getConditionData(existing) ?? {};
    const storedLoc = String(c.hitLocation || "Body");
    updates.name = `Burning (${next})`;
    updates[`${FLAG_PATH}.condition.hitLocation`] = storedLoc;
  } else if (k === "flanked") {
    updates.name = `Flanked (${next})`;
  } else {
    // Static condition: clamp to 1
    updates[`${FLAG_PATH}.condition.value`] = 1;
  }

  await requestUpdateDocument(existing, updates);
  return existing;
}

/**
 * Adjust a numeric condition value (X) by a delta. If the value drops to 0, the condition is removed.
 */
export async function adjustConditionValue(actor, key, delta, options = {}) {
  if (!actor) return null;
  const k = _normalizeConditionKey(key);
  const d = _toNumber(delta, 0);
  if (!Number.isFinite(d) || d === 0) return _findConditionEffect(actor, k);

  const cur = getConditionValue(actor, k) ?? 0;
  return setConditionValue(actor, k, cur + d, options);
}


export async function removeCondition(actor, key) {
  if (!actor) return;
  const k = _normalizeConditionKey(key);
  const all = _findAllConditionEffects(actor, k);
  for (const ef of all) {
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
    } catch (_e) {}
  }
}

export function getConditionValue(actor, key) {
  const k = _normalizeConditionKey(key);
  const all = _findAllConditionEffects(actor, k);
  if (!all.length) return null;

  // Defensive: if duplicates exist for X-value conditions, combine their values.
  if (k === "bleeding" || k === "burning" || k === "flanked") {
    let sum = 0;
    for (const ef of all) {
      const c = _getConditionData(ef);
      sum += c ? _toNumber(c.value, 0) : 0;
    }
    return sum;
  }

  const c = _getConditionData(all[0]);
  return c ? _toNumber(c.value, 0) : 1;
}

/**
 * Called by the turn ticker at end-of-turn for the actor who just acted.
 */
export async function tickConditionsEndTurn(actor) {
  if (!actor) return;
  await _tickBleeding(actor);
  await _tickBurning(actor);
}

async function _tickBleeding(actor) {
  const effect = _findConditionEffect(actor, "bleeding");
  if (!effect) return;

  const c = _getConditionData(effect) ?? {};
  const x = Math.max(0, _toNumber(c.value, 0));
  if (x <= 0) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    return;
  }

  const delay = Math.max(0, _toNumber(c.delay, 0));
  if (delay > 0) {
    await requestUpdateDocument(effect, { [`${FLAG_PATH}.condition.delay`]: delay - 1 });
    return;
  }

  // Bypass AR/resistance: ignoreReduction=true.
  await applyDamage(actor, x, DAMAGE_TYPES.PHYSICAL, {
    ignoreReduction: true,
    source: `Bleeding (${x})`,
    hitLocation: "Body",
    isConditionTick: true,
    suppressWoundCheck: true
  });

  const next = x - 1;
  if (next <= 0) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    return;
  }

  await requestUpdateDocument(effect, {
    name: `Bleeding (${next})`,
    changes: _mkBleedingWTChanges(next),
    [`${FLAG_PATH}.condition.value`]: next
  });
}

async function _tickBurning(actor) {
  const effect = _findConditionEffect(actor, "burning");
  if (!effect) return;

  const c = _getConditionData(effect) ?? {};
  const x = Math.max(0, _toNumber(c.value, 0));
  if (x <= 0) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    return;
  }

  const loc = String(c.hitLocation || "Body");

  await applyDamage(actor, x, DAMAGE_TYPES.FIRE, {
    ignoreReduction: false,
    source: `Burning (${x})`,
    hitLocation: loc,
    isConditionTick: true,
    suppressWoundCheck: true
  });

  const next = x + 1;
  await requestUpdateDocument(effect, {
    name: `Burning (${next})`,
    [`${FLAG_PATH}.condition.value`]: next
  });
}

/**
 * Healing interaction (Chapter 5):
 * - If the character regains HP from any source, subtract total HP regained (including overheal) from Bleeding X.
 */
export function registerConditionHooks() {
  if (_conditionHooksRegistered) return;
  _conditionHooksRegistered = true;
  Hooks.on("uesrpgHealingApplied", async (actor, data) => {
    try {
      if (!actor) return;
      const totalHealed = Math.max(0, _toNumber((data?.totalHealed ?? data?.amountApplied ?? data?.amountHealed ?? data?.amount ?? 0), 0));
      if (totalHealed <= 0) return;

      const effect = _findConditionEffect(actor, "bleeding");
      if (!effect) return;

      const c = _getConditionData(effect) ?? {};
      const x = Math.max(0, _toNumber(c.value, 0));
      if (x <= 0) {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
        return;
      }

      const next = x - totalHealed;
      if (next <= 0) {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
        return;
      }

      await requestUpdateDocument(effect, {
        name: `Bleeding (${next})`,
        changes: _mkBleedingWTChanges(next),
        [`${FLAG_PATH}.condition.value`]: next
      });
    } catch (err) {
      console.warn("UESRPG | Bleeding healing adjustment failed", err);
    }
  });
}

/**
 * Public API surface (macros / items / spells may call these).
 */

/**
 * Audit the internal condition registry for stability issues.
 * This is a non-mutating check intended to catch configuration regressions early.
 *
 * Returns an object: { ok: boolean, warnings: string[] }.
 */
export function auditConditionRegistry(_options = {}) {
  const warnings = [];

  const reg = STATIC_CONDITIONS ?? {};
  for (const [key, def] of Object.entries(reg)) {
    if (!def || typeof def !== "object") {
      warnings.push(`Condition '${key}' is not an object definition.`);
      continue;
    }
    if (!def.name || typeof def.name !== "string") warnings.push(`Condition '${key}' is missing a valid name.`);
    if (!def.img || typeof def.img !== "string") warnings.push(`Condition '${key}' is missing a valid icon path.`);
    if (def.changes != null && !Array.isArray(def.changes)) warnings.push(`Condition '${key}' has non-array changes.`);
    if (def.statusId != null && typeof def.statusId !== "string") warnings.push(`Condition '${key}' has non-string statusId.`);
    // Canonical status id should be stable: prefer explicit statusId else the key.
    const canonical = (def.statusId && def.statusId.trim()) ? def.statusId.trim() : key;
    if (!canonical) warnings.push(`Condition '${key}' resolved to empty canonical statusId.`);
  }

  // Also sanity-check exported Token HUD configs for duplicates.
  try {
    const effects = getTokenHudStatusEffectConfigs?.() ?? [];
    const seen = new Set();
    for (const e of effects) {
      const id = e?.id ?? e?.statusId ?? e?._id;
      if (!id) continue;
      if (seen.has(id)) warnings.push(`Duplicate Token HUD status id '${id}'.`);
      seen.add(id);
    }
  } catch (err) {
    warnings.push(`Condition registry audit failed to enumerate Token HUD effects: ${err?.message ?? err}`);
  }

  return { ok: warnings.length === 0, warnings };
}


export const ConditionsAPI = {
  // Static conditions (no turn-ticker required)
  applyCondition,
  toggleCondition,
  hasCondition,

  // Numeric (X) and turn-ticked conditions
  applyBleeding,
  applyBurning,
  setConditionValue,
  adjustConditionValue,

  // Chapter 5 automation helpers
  ensureBurningTurnActionAllowed,
  attemptExtinguishBurning,
  runSilencedRealizationCheck,

  // Introspection and removal helpers
  removeCondition,
  getConditionValue
};
