/**
 * src/core/conditions/frenzied.js
 *
 * Chapter 5: Frenzied condition automation.
 *
 * RAW Summary (Phase 1 - Implemented):
 *  - +3 Wound Threshold
 *  - +1 Strength Bonus
 *  - +1 Stamina Points (can exceed max)
 *  - -20 penalty to non-physical skill tests (excludes STR/AGI/END)
 *  - Immune to passive wound penalties
 *  - Immune to stunned condition
 *  - On combat end or voluntary exit: lose 2 SP (cannot kill)
 *  - Can test Willpower (-20) as Secondary Action to end
 *
 * RAW Summary (Phase 2 - Deferred):
 *  - Must use All-Out Attacks only
 *  - Must attack nearest enemy
 *  - Cannot flee
 *
 * Talent Modifiers:
 *  - Berserker: SP loss 2 → 1
 *  - Controlled Anger: No SP loss, halve skill penalty (-10 instead of -20)
 *  - 'Tis But a Scratch: Double WT bonus (+6), ignore Crippled/Lost Limb
 *  - Rage-fueled Frenzy: Double SB/SP bonuses (+2 SB, +2 SP)
 */

import { hasCondition } from "./condition-engine.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { TimeService } from "../time/index.js";

const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const CONDITION_KEY = "frenzied";
const FRENZIED_END_GUARD_PATH = `${FLAG_PATH}.frenzied.endSpend`;

let _registered = false;

/** @type {Map<string, {combatId: string|null}>} */
const _actorCombatState = new Map();

function _getFrenziedEndRoundContext() {
  const combat = game?.combat ?? null;
  const combatId = combat?.id ?? null;
  const round = Number(combat?.round ?? 0);
  const inCombat = Boolean(combatId) && Boolean(combat?.started) && Number.isFinite(round) && round > 0;

  if (inCombat) {
    return {
      inCombat: true,
      combatId,
      round,
      roundKey: `combat:${combatId}:${round}`
    };
  }

  const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
  const wt = Number(TimeService.getWorldTimeSeconds?.() ?? game.time?.worldTime ?? 0) || 0;
  const worldRound = Math.floor(wt / roundSeconds);
  return {
    inCombat: false,
    combatId: null,
    round: worldRound,
    worldRound,
    worldTime: wt,
    roundKey: `world:${worldRound}`
  };
}

function _getFrenziedEndGuard(actor) {
  try {
    if (typeof actor?.getFlag === "function") return actor.getFlag(FLAG_SCOPE, "frenzied.endSpend");
    return actor?.flags?.[FLAG_SCOPE]?.frenzied?.endSpend ?? null;
  } catch (_e) {
    return null;
  }
}

function _isFrenziedEndGuarded(actor, { effectId, roundKey } = {}) {
  if (!actor || !roundKey) return false;
  const guard = _getFrenziedEndGuard(actor);
  if (!guard || typeof guard !== "object") return false;
  const guardKey = guard?.roundKey ?? (guard?.combatId && guard?.round ? `combat:${guard.combatId}:${guard.round}` : null);
  if (!guardKey) return false;
  if (guardKey !== roundKey) return false;
  if (effectId && guard?.effectId && String(guard.effectId) === String(effectId)) return true;
  return false;
}

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

function _effectsOf(actor) {
  try {
    if (!actor?.effects) return [];
    // Foundry collections are iterable; prefer .contents when available.
    return Array.isArray(actor.effects?.contents) ? actor.effects.contents : Array.from(actor.effects);
  } catch (_e) {
    return [];
  }
}

function _normKey(k) {
  return String(k ?? "").trim().toLowerCase();
}


function _debugEnabled() {
  try {
    return game?.settings?.get("uesrpg-3ev4", "effectsProxyDebug") === true;
  } catch (_e) {
    return false;
  }
}

function _dbg(...args) {
  if (_debugEnabled()) console.debug(...args);
}

function _isFrenziedEffect(effect) {
  if (!effect) return false;
  
  const k = _normKey(effect?.getFlag?.(FLAG_SCOPE, "condition")?.key ?? effect?.flags?.[FLAG_SCOPE]?.condition?.key);
  if (k === CONDITION_KEY) return true;

  const coreId = _normKey(effect?.getFlag?.("core", "statusId") ?? effect?.flags?.core?.statusId);
  if (coreId === CONDITION_KEY) return true;

  try {
    if (effect.statuses && typeof effect.statuses?.has === "function" && effect.statuses.has(CONDITION_KEY)) return true;
  } catch (_err) {}

  const nm = _normKey(effect.name);
  return nm.startsWith(CONDITION_KEY) || nm === "frenzied";
}

const _LEGACY_SB_KEY = "system.characteristics.str.bonus";


const _REQUIRED_CHANGE_KEYS = new Set([
  "system.modifiers.wound_threshold.value",
  "system.modifiers.characteristics.str",
  "system.modifiers.skills.frenziedPenalty",
  "system.traits.immunity.stunned",
  "system.traits.immunity.panic",
  "system.traits.immunity.horror",
  "system.traits.immunity.passiveWounds"
]);

function _needsFrenziedChangesRepair(changes) {
  try {
    if (!Array.isArray(changes) || changes.length === 0) return true;

    // Legacy key used by older Frenzied effects
    if (changes.some(c => String(c?.key ?? "") === _LEGACY_SB_KEY)) return true;

    // Older builds used a direct woundPenalty override which is now superseded by passive wound suppression immunity.
    if (changes.some(c => String(c?.key ?? "") === "system.woundPenalty")) return true;

    const keys = new Set(changes.map(c => String(c?.key ?? "")));
    for (const req of _REQUIRED_CHANGE_KEYS) {
      if (!keys.has(req)) return true;
    }

    return false;
  } catch (_e) {
    return true;
  }
}

async function _dedup(actor) {
  const effects = _effectsOf(actor).filter(_isFrenziedEffect);
  if (effects.length <= 1) return effects[0] ?? null;

  // Keep the first, delete the rest
  const keep = effects[0];
  const deleteIds = effects.slice(1).map(e => e.id).filter(Boolean);
  if (deleteIds.length) {
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", deleteIds);
    } catch (err) {
      console.warn("UESRPG | Frenzied | dedup failed", err);
    }
  }
  return keep;
}

//------------------------------------------------------------------------------
// Talent Detection
//------------------------------------------------------------------------------

function _hasTalent(actor, talentName) {
  if (!actor?.items) return false;
  const norm = _normKey(talentName);
  return actor.items.some(i => i.type === "talent" && _normKey(i.name) === norm);
}

function _getTalentModifiers(actor) {
  const hasBerserker = _hasTalent(actor, "berserker");
  const hasControlled = _hasTalent(actor, "controlled anger");
  const hasTisScratch = _hasTalent(actor, "'tis but a scratch");
  const hasRageFueled = _hasTalent(actor, "rage-fueled frenzy");

  // Base values
  let wtBonus = 3;
  let sbBonus = 1;
  let spBonus = 1;
  let skillPenalty = -20;
  let spLossOnEnd = 2;

  // Controlled Anger: halve skill penalty, no SP loss
  if (hasControlled) {
    skillPenalty = -10;
    spLossOnEnd = 0;
  } else if (hasBerserker) {
    // Berserker (without Controlled): SP loss 2 → 1
    spLossOnEnd = 1;
  }

  // 'Tis But a Scratch: double WT bonus
  if (hasTisScratch) {
    wtBonus = 6;
  }

  // Rage-fueled Frenzy: double SB and SP bonuses
  if (hasRageFueled) {
    sbBonus = 2;
    spBonus = 2;
  }

  return {
    wtBonus,
    sbBonus,
    spBonus,
    skillPenalty,
    spLossOnEnd,
    talents: {
      berserker: hasBerserker,
      controlledAnger: hasControlled,
      tisButAScratch: hasTisScratch,
      rageFueledFrenzy: hasRageFueled
    }
  };
}

//------------------------------------------------------------------------------
// Active Effect Changes
//------------------------------------------------------------------------------

/**
 * Generate the Active Effect changes array for Frenzied condition.
 * Exported for use by actor repair mechanism.
 * 
 * @param {Actor} actor
 * @returns {Array<{key: string, mode: number, value: string, priority: number}>}
 */
export function _mkFrenziedChanges(actor) {
  const mods = _getTalentModifiers(actor);
  
  // Ensure values are properly formatted (Foundry expects strings for AE changes)
  return [
    // +WT
    // Using system.modifiers.wound_threshold.value as per condition-engine.js (bleeding)
    { 
      key: "system.modifiers.wound_threshold.value", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: String(mods.wtBonus), 
      priority: 20 
    },
    
    // +SB (Strength Bonus)
    // NOTE: In UESRPG, most roll TN and several derived stats key off STR total (and derive SB from total).
    // Implement SB +N by raising STR total by +10 per +1 SB so the bonus is reflected consistently.
    { 
      key: "system.modifiers.characteristics.str", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: String(Number(mods.sbBonus) * 10), 
      priority: 20 
    },
    
    // NOTE: SP bonus is applied immediately on application (not via Active Effect)
    // to ensure it can exceed max and is properly tracked
    
    // Skill penalty (non-physical tests)
    // NOTE: This is a blanket penalty; skill-tn.js must check if skill is STR/AGI/END-based and exempt it
    { 
      key: "system.modifiers.skills.frenziedPenalty", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: String(mods.skillPenalty), 
      priority: 20 
    },
    
    // Immunities: Stunned + fear equivalents (Panic/Horror) + passive wound effects
    { 
      key: "system.traits.immunity.stunned", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: "1", 
      priority: 30 
    },
    { 
      key: "system.traits.immunity.panic", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: "1", 
      priority: 30 
    },
    { 
      key: "system.traits.immunity.horror", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: "1", 
      priority: 30 
    },
    { 
      key: "system.traits.immunity.passiveWounds", 
      mode: CONST.ACTIVE_EFFECT_MODES.ADD, 
      value: "1", 
      priority: 30 
    }
  ];
}

//------------------------------------------------------------------------------
// Effect Repair Hook
//------------------------------------------------------------------------------

/**
 * Register a hook to repair Frenzied effects that have empty changes arrays.
 * This ensures effects created before fixes are applied get their changes populated.
 */
function _registerFrenziedRepairHook() {
  if (game.uesrpg?._frenziedRepairHookRegistered) return;
  if (!game.uesrpg) game.uesrpg = {};
  game.uesrpg._frenziedRepairHookRegistered = true;

  Hooks.on("updateActiveEffect", async (effect, data, options, userId) => {
    try {
      // Only process Frenzied effects
      const isFrenzied = effect?.flags?.[FLAG_SCOPE]?.condition?.key === CONDITION_KEY ||
                         effect?.flags?.core?.statusId === CONDITION_KEY;
      if (!isFrenzied) return;

      // Check if changes are missing or empty
      const currentChanges = Array.isArray(effect.changes) ? effect.changes : [];
      if (_needsFrenziedChangesRepair(currentChanges)) {
        const actor = effect.parent;
        if (!actor || !actor.system) return;

        // Defer to avoid timing issues during prepareData
        // Use a longer delay to ensure actor data is fully prepared
        setTimeout(async () => {
          try {
            // Double-check actor is still valid
            const refreshedActor = game.actors.get(actor.id);
            if (!refreshedActor || !refreshedActor.system) {
              _dbg("UESRPG | Frenzied | Actor no longer valid for repair", { actorId: actor.id });
              return;
            }

            const refreshedEffect = refreshedActor.effects.get(effect.id);
            if (!refreshedEffect) {
              _dbg("UESRPG | Frenzied | Effect no longer exists", { effectId: effect.id });
              return;
            }

            // Check again if changes still need repair (missing or legacy key)
            const refreshedChanges = Array.isArray(refreshedEffect.changes) ? refreshedEffect.changes : [];
            const stillNeedsRepair = _needsFrenziedChangesRepair(refreshedChanges);
            if (!stillNeedsRepair) {
              _dbg("UESRPG | Frenzied | Effect already has valid changes, skipping repair", { effectId: effect.id });
              return;
            }

            _dbg("UESRPG | Frenzied | Repairing effect with missing/legacy changes", { 
              effectId: effect.id,
              actor: refreshedActor.name 
            });

            const changes = _mkFrenziedChanges(refreshedActor);
            const changesToApply = changes.map(c => ({
              key: String(c.key ?? ""),
              mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
              value: String(c.value ?? ""),
              priority: Number(c.priority ?? 20)
            }));

            if (changesToApply.length > 0) {
              await requestUpdateDocument(refreshedEffect, { changes: changesToApply });
              _dbg("UESRPG | Frenzied | Effect repaired with changes", { 
                effectId: effect.id,
                changesCount: changesToApply.length 
              });
            }
          } catch (err) {
            console.warn("UESRPG | Frenzied | Repair failed", { effectId: effect.id, err });
          }
        }, 200);
      }
    } catch (err) {
      // Silently fail - repair is non-critical
      _dbg("UESRPG | Frenzied | Repair hook error", err);
    }
  });
}

async function _repairLegacyFrenziedEffectsOnReady() {
  if (game?.user?.isGM !== true) return;

  const actors = Array.isArray(game?.actors?.contents)
    ? game.actors.contents
    : Array.from(game?.actors ?? []);

  let repaired = 0;

  for (const actor of actors) {
    if (!actor) continue;
    const effects = _effectsOf(actor).filter(_isFrenziedEffect);
    if (!effects.length) continue;

    for (const effect of effects) {
      const currentChanges = Array.isArray(effect?.changes) ? effect.changes : [];
      if (!_needsFrenziedChangesRepair(currentChanges)) continue;

      const changes = _mkFrenziedChanges(actor);
      const changesToApply = Array.isArray(changes)
        ? changes.map(c => ({
            key: String(c.key ?? ""),
            mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
            value: String(c.value ?? ""),
            priority: Number(c.priority ?? 20)
          }))
        : [];

      if (!changesToApply.length) continue;

      try {
        await requestUpdateDocument(effect, { changes: changesToApply });
        repaired += 1;
      } catch (err) {
        console.warn("UESRPG | Frenzied | Legacy repair failed", { actor: actor?.name, effectId: effect?.id, err });
      }
    }
  }

  if (repaired > 0) {
    _dbg(`UESRPG | Frenzied | Repaired ${repaired} effect(s) with missing/legacy changes on ready`);
  }
}


// Register a preCreateActiveEffect hook to inject changes if they're missing
// This MUST run BEFORE condition-automation.js hook (which returns early for frenzied)
// Use a high priority to ensure it runs first
function _registerFrenziedPreCreateHook() {
  if (game.uesrpg?._frenziedPreCreateHookRegistered) return;
  if (!game.uesrpg) game.uesrpg = {};
  game.uesrpg._frenziedPreCreateHookRegistered = true;

  // Use a high priority number to run before other hooks
  Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
    try {
      // Only process for the creating user
      if (game.userId !== userId) return;
      
      const parent = effect?.parent ?? options?.parent ?? null;
      if (!parent || parent.documentName !== "Actor") return;
      
      // Check if this is a Frenzied effect by multiple methods
      const key1 = data?.flags?.[FLAG_SCOPE]?.condition?.key;
      const key2 = data?.flags?.core?.statusId;
      const key3 = data?.statuses?.[0] ?? (Array.isArray(data?.statuses) ? data.statuses[0] : null);
      
      const isFrenzied = _normKey(key1) === CONDITION_KEY || 
                         _normKey(key2) === CONDITION_KEY ||
                         _normKey(key3) === CONDITION_KEY;
      
      if (!isFrenzied) return;
      
      // If changes are missing or empty, inject them
      const currentChanges = Array.isArray(data?.changes) ? data.changes : [];
      if (_needsFrenziedChangesRepair(currentChanges)) {
        const changes = _mkFrenziedChanges(parent);
        const changesToApply = changes.map(c => ({
          key: String(c.key ?? ""),
          mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
          value: String(c.value ?? ""),
          priority: Number(c.priority ?? 20)
        }));
        
        // Inject changes into the create data
        data.changes = changesToApply;
        
        // Also ensure flags are set correctly
        if (!data.flags) data.flags = {};
        if (!data.flags.core) data.flags.core = {};
        if (!data.flags[FLAG_SCOPE]) data.flags[FLAG_SCOPE] = {};
        data.flags.core.statusId = CONDITION_KEY;
        data.flags[FLAG_SCOPE].condition = {
          key: CONDITION_KEY,
          source: data.flags[FLAG_SCOPE]?.condition?.source ?? "Frenzied",
          voluntary: data.flags[FLAG_SCOPE]?.condition?.voluntary ?? false
        };
        data.flags[FLAG_SCOPE].owner = "system";
        data.flags[FLAG_SCOPE].effectGroup = `condition.${CONDITION_KEY}`;
        data.flags[FLAG_SCOPE].stackRule = "override";
        data.flags[FLAG_SCOPE].source = "condition";
        
        _dbg("UESRPG | Frenzied | Injected changes via preCreateActiveEffect hook", {
          actor: parent.name,
          changesCount: changesToApply.length,
          changes: changesToApply.map(c => ({ key: c.key, value: c.value }))
        });
      }
    } catch (err) {
      console.warn("UESRPG | Frenzied | preCreateActiveEffect hook error", err);
    }
  }, { once: false });
}


function _registerFrenziedCreateHook() {
  if (game.uesrpg?._frenziedCreateHookRegistered) return;
  if (!game.uesrpg) game.uesrpg = {};
  game.uesrpg._frenziedCreateHookRegistered = true;

  Hooks.on("createActiveEffect", async (effect, options, userId) => {
    try {
      // Only process for the creating user
      if (game.userId !== userId) return;

      const actor = effect.parent;
      if (!actor || actor.documentName !== "Actor") return;

      // Check if this is a Frenzied effect
      const isFrenzied = effect?.flags?.[FLAG_SCOPE]?.condition?.key === CONDITION_KEY ||
                         effect?.flags?.core?.statusId === CONDITION_KEY;
      if (!isFrenzied) return;

      // Check if changes are missing
      const currentChanges = Array.isArray(effect.changes) ? effect.changes : [];
      if (_needsFrenziedChangesRepair(currentChanges)) {
        // Immediately update with changes
        const changes = _mkFrenziedChanges(actor);
        const changesToApply = changes.map(c => ({
          key: String(c.key ?? ""),
          mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
          value: String(c.value ?? ""),
          priority: Number(c.priority ?? 20)
        }));

        if (changesToApply.length > 0) {
          await requestUpdateDocument(effect, { changes: changesToApply });
          _dbg("UESRPG | Frenzied | Fixed missing changes immediately after creation", {
            effectId: effect.id,
            actor: actor.name,
            changesCount: changesToApply.length
          });
        }
      }
    } catch (err) {
      console.warn("UESRPG | Frenzied | createActiveEffect hook error", err);
    }
  });
}

function _registerFrenziedDeleteHook() {
  if (globalThis.__UESRPG_FRENZIED_DELETE_HOOK__) return;
  globalThis.__UESRPG_FRENZIED_DELETE_HOOK__ = true;

  Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
    try {
      const activeGM = game.users?.activeGM ?? null;
      if (activeGM) {
        if (game.user.id !== activeGM.id) return;
      } else if (game.user.id !== userId) {
        return;
      }

      const actor = effect?.parent ?? null;
      if (!actor || actor.documentName !== "Actor") return;
      if (!_isFrenziedEffect(effect)) return;

      await _applyFrenziedEndEffects(actor, { effectId: effect.id, reason: "removed" });
    } catch (err) {
      console.warn("UESRPG | Frenzied | delete hook failed", err);
    }
  });
}

//------------------------------------------------------------------------------
// Public API
//------------------------------------------------------------------------------

/**
 * Apply Frenzied condition to an actor.
 * Replaces any existing Frenzied effect (does not stack).
 *
 * @param {Actor} actor
 * @param {object} options
 * @param {string} options.source - Source description
 * @param {boolean} options.voluntary - Whether entered voluntarily (affects talent interactions)
 */
export async function applyFrenzied(actor, { source = "Frenzied", voluntary = false } = {}) {
  if (!actor) return null;

  // Deduplicate first
  const existing = await _dedup(actor);
  
  // If already frenzied, ensure it has changes and update flags
  if (existing) {
    const existingChanges = Array.isArray(existing.changes) ? existing.changes : [];
    
    // If changes are missing, add them
    if (_needsFrenziedChangesRepair(existingChanges)) {
      const changes = _mkFrenziedChanges(actor);
      const changesToApply = changes.map(c => ({
        key: String(c.key ?? ""),
        mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
        value: String(c.value ?? ""),
        priority: Number(c.priority ?? 20)
      }));
      
      await requestUpdateDocument(existing, {
        changes: changesToApply,
        [`${FLAG_PATH}.condition.voluntary`]: voluntary,
        [`${FLAG_PATH}.condition.source`]: source
      });
      console.log("UESRPG | Frenzied | Updated existing effect with missing changes", { 
        effectId: existing.id,
        changesCount: changesToApply.length 
      });
    } else {
      // Just update flags if changes already exist
      await requestUpdateDocument(existing, {
        [`${FLAG_PATH}.condition.voluntary`]: voluntary,
        [`${FLAG_PATH}.condition.source`]: source
      });
    }
    return existing;
  }

  // Track combat association
  const combat = game.combat;
  if (combat?.id) {
    _actorCombatState.set(actor.uuid, { combatId: combat.id });
  }

  // Create effect with dynamic changes based on actor's talents
  const mods = _getTalentModifiers(actor);
  const changes = _mkFrenziedChanges(actor);
  
  // Ensure changes array is properly formatted
  if (!Array.isArray(changes) || changes.length === 0) {
    console.warn("UESRPG | Frenzied | No changes generated", { actor: actor.name, mods });
  }

  // Deep clone changes to avoid any reference issues
  const changesToApply = changes.map(c => ({
    key: String(c.key ?? ""),
    mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
    value: String(c.value ?? ""),
    priority: Number(c.priority ?? 20)
  }));

  const effectData = {
    name: "Frenzied",
    icon: "icons/svg/terror.svg",
    disabled: false,
    flags: {
      core: { statusId: CONDITION_KEY },
      [FLAG_SCOPE]: {
        condition: {
          key: CONDITION_KEY,
          source,
          voluntary
        },
        owner: "system",
        effectGroup: `condition.${CONDITION_KEY}`,
        stackRule: "override",
        source: "condition"
      }
    },
    origin: null,
    duration: {},
    changes: changesToApply  // Use cloned changes
  };

  try {
    // Ensure changes are properly formatted before creation
    if (!Array.isArray(changesToApply) || changesToApply.length === 0) {
      console.error("UESRPG | Frenzied | No changes generated", { actor: actor.name, mods, changes, changesToApply });
      return null;
    }
    
    // Log changes for debugging
    console.log("UESRPG | Frenzied | Creating effect with changes", { 
      actor: actor.name, 
      changesCount: changesToApply.length,
      changes: changesToApply.map(c => ({ key: c.key, mode: c.mode, value: c.value }))
    });
    
    // Ensure changes are in the effectData before creation
    effectData.changes = changesToApply;
    
    // Final verification before creation
    if (!Array.isArray(effectData.changes) || effectData.changes.length === 0) {
      console.error("UESRPG | Frenzied | CRITICAL: effectData.changes is empty before creation!", {
        actor: actor.name,
        effectData: JSON.stringify(effectData, null, 2),
        changesToApply
      });
      return null;
    }

    console.log("UESRPG | Frenzied | About to create effect", {
      actor: actor.name,
      changesInEffectData: effectData.changes.length,
      changesPreview: effectData.changes.map(c => ({ key: c.key, value: c.value }))
    });

    const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData]);
    
    // Verify changes were applied
    const createdEffect = created?.[0];
    if (createdEffect) {
      const appliedChanges = Array.isArray(createdEffect.changes) ? createdEffect.changes : [];
      
      if (appliedChanges.length === 0) {
        console.warn("UESRPG | Frenzied | Effect created but changes are empty - repair hook will fix", { 
          effectId: createdEffect.id,
          expectedChanges: changesToApply.length
        });
        // The repair hook will handle this on the next update cycle
      } else {
        console.log("UESRPG | Frenzied | Effect created successfully with changes", { 
          effectId: createdEffect.id,
          changesCount: appliedChanges.length
        });
      }
    } else {
      console.error("UESRPG | Frenzied | No effect was created", { created, effectData });
    }
    
    // RAW: Gain +1 SP immediately (can exceed max)
    const mods = _getTalentModifiers(actor);
    const currentSP = Number(actor.system?.stamina?.value ?? 0);
    const newSP = currentSP + mods.spBonus; // Can exceed max per RAW
    
    await requestUpdateDocument(actor, { "system.stamina.value": newSP });
    
    // FIX: Force immediate effect application
    actor.prepareData();
    
    ui.notifications.info(`${actor.name} gains ${mods.spBonus} Stamina Point${mods.spBonus > 1 ? 's' : ''} from Frenzy!`);
    
    return created?.[0] ?? null;
  } catch (err) {
    console.warn("UESRPG | Frenzied | failed to create effect", err);
    return null;
  }
}

function _formatFrenziedEndModifiers(mods) {
  const out = [];
  if (mods?.talents?.controlledAnger) out.push("Controlled Anger (SP loss 0)");
  else if (mods?.talents?.berserker) out.push("Berserker (SP loss 1)");
  return out.length ? out.join(", ") : "None";
}

async function _applyFrenziedEndEffects(actor, { effectId = null, applySPLoss = true, reason = "ended" } = {}) {
  if (!actor) return { applied: false };
  const roundCtx = _getFrenziedEndRoundContext();
  if (_isFrenziedEndGuarded(actor, { effectId, roundKey: roundCtx.roundKey })) {
    return { applied: false, skipped: true };
  }

  const mods = _getTalentModifiers(actor);
  const spLoss = applySPLoss ? Math.max(0, Number(mods.spLossOnEnd ?? 0) || 0) : 0;
  const currentSP = Number(actor.system?.stamina?.value ?? 0);
  const newSP = spLoss > 0 ? Math.max(1, currentSP - spLoss) : currentSP;

  const guardPayload = {
    effectId: effectId ?? null,
    roundKey: roundCtx.roundKey,
    combatId: roundCtx.combatId ?? null,
    round: roundCtx.round ?? null,
    worldRound: roundCtx.worldRound ?? null,
    worldTime: roundCtx.worldTime ?? null,
    usedAt: Date.now(),
    reason: String(reason ?? "ended")
  };

  const updates = { [FRENZIED_END_GUARD_PATH]: guardPayload };
  if (spLoss > 0 && Number.isFinite(newSP)) {
    updates["system.stamina.value"] = newSP;
  }

  try {
    await requestUpdateDocument(actor, updates);
  } catch (err) {
    console.warn("UESRPG | Frenzied | SP loss update failed", err);
  }

  const modLabel = _formatFrenziedEndModifiers(mods);
  const spLine = spLoss > 0
    ? `Spent ${spLoss} Stamina Point${spLoss > 1 ? "s" : ""} (now ${newSP} SP).`
    : `No Stamina spent (now ${newSP} SP).`;

  try {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="uesrpg-condition-card" style="padding:8px; border:1px solid rgba(200,0,0,0.3); background:rgba(200,0,0,0.05);">
        <h3 style="margin:0 0 8px 0; color:rgba(200,0,0,0.9);">Frenzy Ended: ${actor.name}</h3>
        <p style="margin:4px 0;"><b>${spLine}</b></p>
        <p style="margin:4px 0; opacity:0.9;"><b>Modifiers:</b> ${modLabel}</p>
      </div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (err) {
    console.warn("UESRPG | Frenzied | chat message failed", err);
  }

  return { applied: true, spLoss, newSP, mods };
}

/**
 * Remove Frenzied condition and apply SP loss.
 *
 * @param {Actor} actor
 * @param {object} options
 * @param {boolean} options.applySPLoss - Whether to apply SP loss (default: true)
 * @param {string} options.reason - Reason for ending (audit only)
 */
export async function removeFrenzied(actor, { applySPLoss = true, reason = "ended" } = {}) {
  if (!actor) return;

  const effect = await _dedup(actor);
  if (!effect) return;

  await _applyFrenziedEndEffects(actor, { effectId: effect.id, applySPLoss, reason });

  // Remove effect
  try {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    
    // FIX: Force immediate recalculation
    actor.prepareData();
    
  } catch (err) {
    console.warn("UESRPG | Frenzied | failed to delete effect", err);
  }

  // Clear combat association
  _actorCombatState.delete(actor.uuid);
}

/**
 * Prompt Willpower test to end Frenzied voluntarily.
 */
export async function promptWillpowerTest(actor) {
  if (!actor) return;
  if (!hasCondition(actor, CONDITION_KEY)) return;

  const wpTotal = Number(actor.system?.characteristics?.wp?.total ?? 0);
  const tn = wpTotal - 20; // -20 penalty per RAW

  const d = new Dialog({
    title: `${actor.name} - End Frenzied`,
    content: `<p><strong>Willpower Test (-20):</strong> Roll d100 ≤ ${tn} to end Frenzied.</p>`,
    buttons: {
      roll: {
        label: "Roll",
        callback: async () => {
          const roll = await new Roll("1d100").evaluate({ async: true });
          const success = roll.total <= tn;

          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div style="padding:6px;">
              <strong>Willpower Test to End Frenzied:</strong><br>
              TN: ${tn} | Roll: ${roll.total} | ${success ? "<strong>Success!</strong>" : "Failure"}
            </div>`,
            rolls: [roll]
          });

          if (success) {
            await removeFrenzied(actor, { reason: "snapped" });
          }
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "roll"
  });

  d.render(true);
}

//------------------------------------------------------------------------------
// Hooks
//------------------------------------------------------------------------------

export function registerFrenzied() {
  if (_registered) return;
  _registered = true;

  // Register Frenzied-specific AE shaping/repair hooks explicitly through the system init path.
  // This avoids hook registration as a side effect of importing this module.
  try {
    _registerFrenziedPreCreateHook();
    _registerFrenziedCreateHook();
    _registerFrenziedDeleteHook();
    Hooks.once("ready", async () => {
      _registerFrenziedRepairHook();
      await _repairLegacyFrenziedEffectsOnReady();
    });
  } catch (err) {
    console.warn("UESRPG | Frenzied | Failed to register Frenzied hooks", err);
  }


  // Combat end: remove Frenzied from all participants (GM-only)
  Hooks.on("deleteCombat", async (combat, options, userId) => {
    if (game?.user?.isGM !== true) return;
    if (game.user.id !== userId) return;

    for (const c of (combat.combatants ?? [])) {
      const actor = c?.actor;
      if (!actor) continue;
      if (!hasCondition(actor, CONDITION_KEY)) continue;

      const state = _actorCombatState.get(actor.uuid);
      if (state?.combatId === combat.id) {
        await removeFrenzied(actor);
      }
    }
  });
}

export const FrenziedAPI = {
  applyFrenzied,
  removeFrenzied,
  promptWillpowerTest
};
