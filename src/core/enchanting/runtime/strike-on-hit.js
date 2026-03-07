/**
 * src/core/enchanting/runtime/strike-on-hit.js
 *
 * Strike Enchantment On-Hit Handler.
 *
 * Registers a listener on `uesrpgDamageApplied` to process non-damage
 * strike enchantment side effects: drain, absorb, condition, soulTrap,
 * dispel, and disintegrate.
 *
 * Damage-type effects (fire/frost/shock) are handled inline in resolve.js
 * via collectStrikeEnchantmentEffects() before damage is applied.
 *
 * Per-hit document update strategy (Phase 2):
 *  - All targetActor system/flag updates are accumulated into a single object
 *    and applied with at most one requestUpdateDocument call per hit.
 *  - All condition ActiveEffects are batched into a single requestCreateEmbeddedDocuments call.
 *  - Attacker updates (absorb restore) are applied separately (different actor).
 *  - Chat messages are posted after all document writes.
 *
 * Must be initialized once at system ready via initializeStrikeOnHitRuntime().
 *
 * Target: Foundry VTT v13.351
 */

import { requestUpdateDocument, requestCreateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { isActorUndead } from "../../traits/trait-registry.js";
import { SYSTEM_ID } from "../../constants.js";

// ---------------------------------------------------------------------------
// Synchronous accumulator helpers
// Each _compute* function mutates the shared accumulators (targetUpdates,
// effectsToCreate, attackerRef) and returns a human-readable chat description
// string, or null if the effect was skipped.
// ---------------------------------------------------------------------------

/**
 * Accumulate a drain resource update into targetUpdates.
 * Reads the current value from the accumulator first (handles multiple drains
 * on the same pool in one hit without a separate document read per effect).
 *
 * @param {Actor} targetActor
 * @param {object} fx
 * @param {object} targetUpdates - Shared mutable accumulator
 * @returns {string|null} Chat description or null if skipped.
 */
function _computeDrain(targetActor, fx, targetUpdates) {
  const amount = Math.max(0, Number(fx.y ?? fx.sl ?? 0));
  if (amount === 0) return null;

  let path;
  let currentValue;

  switch (fx.catalog.drainPool) {
    case "health":
      path = "system.hp.value";
      currentValue = targetUpdates[path] ?? Number(targetActor.system?.hp?.value ?? 0);
      break;
    case "magicka":
      path = "system.magicka.value";
      currentValue = targetUpdates[path] ?? Number(targetActor.system?.magicka?.value ?? 0);
      break;
    case "stamina":
      // Dual-path: some actors use staminaPoints, others stamina.
      if (targetActor.system?.staminaPoints !== undefined) {
        path = "system.staminaPoints.value";
        currentValue = targetUpdates[path] ?? Number(targetActor.system?.staminaPoints?.value ?? 0);
      } else {
        path = "system.stamina.value";
        currentValue = targetUpdates[path] ?? Number(targetActor.system?.stamina?.value ?? 0);
      }
      break;
    default:
      console.warn(`UESRPG | Strike drain: unknown drainPool "${fx.catalog.drainPool}".`);
      return null;
  }

  targetUpdates[path] = Math.max(0, currentValue - amount);
  return `${fx.catalog.label}: drained ${amount} from ${targetActor.name}`;
}

/**
 * Accumulate an absorb (drain target HP + restore attacker HP) into the shared accumulators.
 * Reads from accumulated targetUpdates so it composes correctly with prior drain effects.
 *
 * @param {Actor} targetActor
 * @param {object} fx
 * @param {object} hookData - Full uesrpgDamageApplied payload
 * @param {object} targetUpdates - Shared mutable accumulator
 * @param {{ actor: Actor|null, updates: object }} attackerRef - Shared attacker accumulator
 * @returns {string|null}
 */
function _computeAbsorb(targetActor, fx, hookData, targetUpdates, attackerRef) {
  const amount = Math.max(0, Number(fx.y ?? fx.sl ?? 0));
  if (amount === 0) return null;

  // Drain from target (reads accumulated value if prior effects already modified HP).
  const targetHP = targetUpdates["system.hp.value"] ?? Number(targetActor.system?.hp?.value ?? 0);
  const actualDrained = Math.min(amount, targetHP);
  if (actualDrained > 0) {
    targetUpdates["system.hp.value"] = Math.max(0, targetHP - actualDrained);
  }

  // Restore to attacker (separate actor — tracked in attackerRef).
  const attackerActor = hookData.weapon?.actor ?? null;
  if (attackerActor && actualDrained > 0) {
    if (!attackerRef.actor) {
      attackerRef.actor = attackerActor;
      attackerRef.updates = {};
    }
    const attackerMaxHP = Number(attackerActor.system?.hp?.max ?? 0);
    const attackerHP = attackerRef.updates["system.hp.value"] ?? Number(attackerActor.system?.hp?.value ?? 0);
    const newHP = Math.min(attackerMaxHP, attackerHP + actualDrained);
    if (newHP !== attackerHP) {
      attackerRef.updates["system.hp.value"] = newHP;
    }
  }

  return `${fx.catalog.label}: absorbed ${actualDrained} HP from ${targetActor.name}${attackerActor ? ` → restored to ${attackerActor.name}` : ""}`;
}

/**
 * Accumulate a condition ActiveEffect into effectsToCreate.
 * turnUndead only fires against undead targets.
 *
 * @param {Actor} targetActor
 * @param {object} fx
 * @param {object[]} effectsToCreate - Shared mutable accumulator
 * @returns {string|null}
 */
function _computeCondition(targetActor, fx, effectsToCreate) {
  const conditionKey = fx.catalog.condition ?? null;
  if (!conditionKey) {
    console.warn(`UESRPG | Strike condition effect "${fx.key}" has no catalog.condition key.`);
    return null;
  }

  // turnUndead: only applies to undead targets.
  if (fx.key === "turnUndead" && !isActorUndead(targetActor)) return null;

  const durationRounds = Math.max(1, Number(fx.sl ?? 1));
  const conditionLabel = _capitalize(conditionKey);

  effectsToCreate.push({
    name: `${conditionLabel} (${fx.weaponName})`,
    img: _conditionIcon(conditionKey),
    duration: {
      rounds: durationRounds,
      startRound: game.combat?.round ?? 0,
    },
    flags: {
      [SYSTEM_ID]: {
        source: "strikeEnchantment",
        conditionKey,
        weaponName: fx.weaponName,
      },
    },
    // Marker-only AE — no effect changes. GMs apply mechanical consequences.
  });

  return `${fx.catalog.label}: ${conditionLabel} applied to ${targetActor.name} for ${durationRounds} round(s)`;
}

/**
 * Accumulate a soul trap flag update into targetUpdates.
 *
 * @param {Actor} targetActor
 * @param {object} fx
 * @param {object} targetUpdates - Shared mutable accumulator
 * @returns {string}
 */
function _computeSoulTrap(targetActor, fx, targetUpdates) {
  const expiresAtRound = (game.combat?.round ?? 0) + 10; // 1 minute = 10 rounds

  targetUpdates[`flags.${SYSTEM_ID}.soulTrapped`] = {
    active: true,
    weaponName: fx.weaponName,
    attackerActorId: fx.attackerActorId,
    attackerActorUuid: fx.attackerActorUuid,
    expiresAtRound,
    appliedAt: Date.now(),
  };

  return `Soul Trap: ${targetActor.name} is soul-trapped. If they die within 10 rounds, their soul can be captured.`;
}

// ---------------------------------------------------------------------------
// Stubs (dispel, disintegrate)
// ---------------------------------------------------------------------------

/**
 * Post a GM notification for effects not yet fully automated.
 */
function _stubNotify(targetActor, fx, label) {
  const msg = `<p><strong>Strike Enchantment — ${label}</strong> (${fx.weaponName})</p>`
    + `<p>Effect triggered on <strong>${targetActor.name}</strong>. `
    + `SL: ${fx.sl}. Requires GM adjudication — automation not yet implemented.</p>`;

  ChatMessage.create({
    content: msg,
    whisper: ChatMessage.getWhisperRecipients("GM"),
    speaker: ChatMessage.getSpeaker(),
  });
}

// ---------------------------------------------------------------------------
// Chat card helper
// ---------------------------------------------------------------------------

function _postSideEffectChat(targetActor, weaponName, description) {
  ChatMessage.create({
    content: `<p><strong>Strike Enchantment</strong> (${weaponName})</p><p>${description}</p>`,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function _capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function _conditionIcon(conditionKey) {
  const icons = {
    paralyzed: "icons/svg/paralysis.svg",
    silenced: "icons/svg/silenced.svg",
    fleeing: "icons/svg/terror.svg",
  };
  return icons[conditionKey] ?? "icons/svg/aura.svg";
}

// ---------------------------------------------------------------------------
// Initializer
// ---------------------------------------------------------------------------

let _hookRegistered = false;

/**
 * Register the uesrpgDamageApplied hook handler.
 * Must be called once at system ready. Idempotent.
 */
export function initializeStrikeOnHitRuntime() {
  if (_hookRegistered) return;
  _hookRegistered = true;

  Hooks.on("uesrpgDamageApplied", async (targetActor, data) => {
    const effects = data?.strikeEnchantmentSideEffects;
    if (!Array.isArray(effects) || effects.length === 0) return;

    // Accumulators: collect all updates synchronously, then apply in batch.
    const targetUpdates = {};
    const effectsToCreate = [];
    const attackerRef = { actor: null, updates: {} };
    const chatDescriptions = [];

    for (const fx of effects) {
      try {
        let desc = null;
        switch (fx.effectType) {
          case "drain":
            desc = _computeDrain(targetActor, fx, targetUpdates);
            break;
          case "absorb":
            desc = _computeAbsorb(targetActor, fx, data, targetUpdates, attackerRef);
            break;
          case "condition":
            desc = _computeCondition(targetActor, fx, effectsToCreate);
            break;
          case "soulTrap":
            desc = _computeSoulTrap(targetActor, fx, targetUpdates);
            break;
          case "dispel":
            _stubNotify(targetActor, fx, "Dispel");
            break;
          case "disintegrate":
            _stubNotify(targetActor, fx, "Disintegrate");
            break;
          default:
            console.warn(`UESRPG | Unknown strike enchantment effectType "${fx.effectType}" — skipping.`);
        }
        if (desc) chatDescriptions.push({ weaponName: fx.weaponName, desc });
      } catch (err) {
        console.error(`UESRPG | Strike enchantment side effect "${fx.key}" failed`, err);
      }
    }

    // Apply all targetActor updates in a single document operation.
    if (Object.keys(targetUpdates).length > 0) {
      try {
        await requestUpdateDocument(targetActor, targetUpdates);
      } catch (err) {
        console.error("UESRPG | Strike enchantment batch target update failed", err);
      }
    }

    // Apply attacker updates (absorb restore) — separate actor, separate call.
    if (attackerRef.actor && Object.keys(attackerRef.updates).length > 0) {
      try {
        await requestUpdateDocument(attackerRef.actor, attackerRef.updates);
      } catch (err) {
        console.error("UESRPG | Strike enchantment batch attacker update failed", err);
      }
    }

    // Create all condition AEs in a single embedded document operation.
    if (effectsToCreate.length > 0) {
      try {
        await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", effectsToCreate);
      } catch (err) {
        console.error("UESRPG | Strike enchantment AE creation failed", err);
      }
    }

    // Post chat messages after document writes.
    for (const { weaponName, desc } of chatDescriptions) {
      _postSideEffectChat(targetActor, weaponName, desc);
    }
  });
}
