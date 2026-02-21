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
 * Must be initialized once at system ready via initializeStrikeOnHitRuntime().
 *
 * Target: Foundry VTT v13.351
 */

import { requestUpdateDocument, requestCreateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { isActorUndead } from "../../traits/trait-registry.js";

// ---------------------------------------------------------------------------
// Internal routing
// ---------------------------------------------------------------------------

/**
 * Apply a single strike enchantment side effect to the target actor.
 * @param {Actor} targetActor
 * @param {object} fx - Side effect descriptor from collectStrikeEnchantmentEffects
 * @param {object} hookData - Full uesrpgDamageApplied hook data payload
 */
async function _applyStrikeSideEffect(targetActor, fx, hookData) {
  switch (fx.effectType) {
    case "drain":
      await _applyDrain(targetActor, fx);
      break;
    case "absorb":
      await _applyAbsorb(targetActor, fx, hookData);
      break;
    case "condition":
      await _applyCondition(targetActor, fx, hookData);
      break;
    case "soulTrap":
      await _applySoulTrap(targetActor, fx, hookData);
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
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

/**
 * Drain a resource pool from the target by fx.y.
 * Handles: drainHealth, drainMagicka, drainStamina.
 */
async function _applyDrain(targetActor, fx) {
  const amount = Math.max(0, Number(fx.y ?? fx.sl ?? 0));
  if (amount === 0) return;

  let path = null;
  let currentValue = 0;

  switch (fx.catalog.drainPool) {
    case "health":
      path = "system.hp.value";
      currentValue = Number(targetActor.system?.hp?.value ?? 0);
      break;
    case "magicka":
      path = "system.magicka.value";
      currentValue = Number(targetActor.system?.magicka?.value ?? 0);
      break;
    case "stamina":
      // Dual-path: some actors use staminaPoints, others stamina.
      if (targetActor.system?.staminaPoints !== undefined) {
        path = "system.staminaPoints.value";
        currentValue = Number(targetActor.system?.staminaPoints?.value ?? 0);
      } else {
        path = "system.stamina.value";
        currentValue = Number(targetActor.system?.stamina?.value ?? 0);
      }
      break;
    default:
      console.warn(`UESRPG | Strike drain: unknown drainPool "${fx.catalog.drainPool}".`);
      return;
  }

  const newValue = Math.max(0, currentValue - amount);
  await requestUpdateDocument(targetActor, { [path]: newValue });

  _postSideEffectChat(targetActor, fx.weaponName, `${fx.catalog.label}: drained ${amount} from ${targetActor.name}`);
}

// ---------------------------------------------------------------------------
// Absorb
// ---------------------------------------------------------------------------

/**
 * Drain fx.y HP from target and restore it to the attacker.
 */
async function _applyAbsorb(targetActor, fx, hookData) {
  const amount = Math.max(0, Number(fx.y ?? fx.sl ?? 0));
  if (amount === 0) return;

  // Drain from target
  const targetHP = Number(targetActor.system?.hp?.value ?? 0);
  const actualDrained = Math.min(amount, targetHP);
  if (actualDrained > 0) {
    await requestUpdateDocument(targetActor, { "system.hp.value": Math.max(0, targetHP - actualDrained) });
  }

  // Restore to attacker
  const attackerActor = hookData.weapon?.actor ?? null;
  if (attackerActor && actualDrained > 0) {
    const attackerHP = Number(attackerActor.system?.hp?.value ?? 0);
    const attackerMaxHP = Number(attackerActor.system?.hp?.max ?? 0);
    const newHP = Math.min(attackerMaxHP, attackerHP + actualDrained);
    if (newHP !== attackerHP) {
      await requestUpdateDocument(attackerActor, { "system.hp.value": newHP });
    }
  }

  _postSideEffectChat(
    targetActor,
    fx.weaponName,
    `${fx.catalog.label}: absorbed ${actualDrained} HP from ${targetActor.name}${attackerActor ? ` → restored to ${attackerActor.name}` : ""}`
  );
}

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

/**
 * Apply a temporary condition via an ActiveEffect on the target.
 * turnUndead only fires against undead targets.
 */
async function _applyCondition(targetActor, fx, _hookData) {
  const conditionKey = fx.catalog.condition ?? null;
  if (!conditionKey) {
    console.warn(`UESRPG | Strike condition effect "${fx.key}" has no catalog.condition key.`);
    return;
  }

  // turnUndead: only applies to undead targets
  if (fx.key === "turnUndead" && !isActorUndead(targetActor)) return;

  const durationRounds = Math.max(1, Number(fx.sl ?? 1));
  const conditionLabel = _capitalize(conditionKey);

  const aeData = {
    name: `${conditionLabel} (${fx.weaponName})`,
    img: _conditionIcon(conditionKey),
    duration: {
      rounds: durationRounds,
      startRound: game.combat?.round ?? 0,
    },
    flags: {
      "uesrpg-3ev4": {
        source: "strikeEnchantment",
        conditionKey,
        weaponName: fx.weaponName,
      },
    },
    // Marker-only AE — no effect changes. GMs apply mechanical consequences.
  };

  try {
    await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", [aeData]);
    _postSideEffectChat(
      targetActor,
      fx.weaponName,
      `${fx.catalog.label}: ${conditionLabel} applied to ${targetActor.name} for ${durationRounds} round(s)`
    );
  } catch (err) {
    console.error("UESRPG | Strike enchantment condition AE creation failed", err);
  }
}

// ---------------------------------------------------------------------------
// Soul Trap
// ---------------------------------------------------------------------------

/**
 * Mark the target as soul-trapped for 1 minute (10 rounds).
 * If the target dies while soul-trapped, their soul can be harvested.
 */
async function _applySoulTrap(targetActor, fx, _hookData) {
  const expiresAtRound = (game.combat?.round ?? 0) + 10; // 1 minute = 10 rounds

  await requestUpdateDocument(targetActor, {
    "flags.uesrpg-3ev4.soulTrapped": {
      active: true,
      weaponName: fx.weaponName,
      attackerActorId: fx.attackerActorId,
      attackerActorUuid: fx.attackerActorUuid,
      expiresAtRound,
      appliedAt: Date.now(),
    },
  });

  _postSideEffectChat(
    targetActor,
    fx.weaponName,
    `Soul Trap: ${targetActor.name} is soul-trapped. If they die within 10 rounds, their soul can be captured.`
  );
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

    for (const fx of effects) {
      try {
        await _applyStrikeSideEffect(targetActor, fx, data);
      } catch (err) {
        console.error(`UESRPG | Strike enchantment side effect "${fx.key}" failed`, err);
      }
    }
  });
}
