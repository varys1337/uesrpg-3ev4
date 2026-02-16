/**
 * @module magic/services/disintegrate-service
 *
 * src/core/magic/disintegrate-service.js
 *
 * Runtime automation for Disintegrate Armor / Disintegrate Weapon spells.
 *
 * RAW (Chapter 6 — Destruction):
 *   "Fires a bolt of energy at target character within 100m. Instead of
 *    dealing damage, this attack applies the Damaged ([Spell Strength])
 *    quality to the piece of armor on the location it hits (or shield,
 *    if it is blocked by a shield)."
 *
 * Disintegrate Weapon:
 *   Same mechanic, targeting the weapon instead of armor.
 *
 * Implementation:
 *   1. Hook `uesrpg.spell.castResolved` to intercept successful casts.
 *   2. If the spell has `engine.disintegrate.enabled`, skip normal HP damage
 *      and instead apply the Damaged quality to the relevant equipped item.
 *   3. Provide a reusable `applyDamagedQuality(item, magnitude, opts)` helper.
 *
 * The service uses the `uesrpg.spell.effectApplied` hook so it fires after
 * the opposed test resolves and effects land on the target — at that point
 * we know the spell hit.  For Disintegrate spells that are `isDamagingSpell: false`,
 * the normal pipeline doesn't deal HP damage, so we only need to apply the
 * item quality degradation.
 *
 * Target: Foundry VTT v13.351
 */

import { _num, _str, createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][Disintegrate]");

/* ═══════════════════════════════════════════════════════════════════════════
 *  Reusable Helper: Apply "Damaged (magnitude)" to an Item
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Apply or increment the "Damaged" structured quality on an item.
 *
 * Idempotent increment: if the item already has Damaged(X), the new value
 * becomes X + magnitude.  If no Damaged quality exists, one is created
 * with value = magnitude.
 *
 * @param {Item} item              - The owned (embedded) item to modify
 * @param {number} magnitude       - The Damaged value to apply (e.g. Spell Strength)
 * @param {object} [opts]          - Optional context
 * @param {string} [opts.sourceSpell]  - Name of the source spell (for chat)
 * @param {string} [opts.workflowId]   - Workflow ID for deduplication
 * @returns {Promise<{success: boolean, oldValue: number, newValue: number, item: Item}|null>}
 */
export async function applyDamagedQuality(item, magnitude, opts = {}) {
  if (!item || !item.parent) {
    console.warn("[UESRPG][Disintegrate] applyDamagedQuality: item has no parent actor");
    return null;
  }

  magnitude = Math.max(0, Math.floor(_num(magnitude, 0)));
  if (magnitude <= 0) {
    _debug("applyDamagedQuality: magnitude is 0 — no-op");
    return null;
  }

  const actor = item.parent;
  const qualitiesStructured = foundry.utils.deepClone(item.system?.qualitiesStructured ?? []);

  // Find existing Damaged entry
  const existingIdx = qualitiesStructured.findIndex(q => (q?.key ?? q) === "damaged");
  const oldValue = existingIdx >= 0 ? _num(qualitiesStructured[existingIdx]?.value, 0) : 0;
  const newValue = oldValue + magnitude;

  if (existingIdx >= 0) {
    // Increment existing
    qualitiesStructured[existingIdx] = { key: "damaged", value: newValue };
  } else {
    // Add new entry
    qualitiesStructured.push({ key: "damaged", value: newValue });
  }

  // Permission-safe update
  const { requestUpdateEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");
  try {
    await requestUpdateEmbeddedDocuments(actor, "Item", [{
      _id: item.id,
      "system.qualitiesStructured": qualitiesStructured
    }]);

    _debug("applyDamagedQuality: updated", {
      item: item.name,
      actor: actor.name,
      oldValue,
      newValue
    });

    return { success: true, oldValue, newValue, item };
  } catch (err) {
    console.error("[UESRPG][Disintegrate] applyDamagedQuality: update failed", err);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Disintegrate Target Resolution
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Find the equipped armor item covering a given hit location on an actor.
 *
 * @param {Actor} actor
 * @param {string} [hitLocation] - e.g. "Head", "Body", "Left Arm", etc.
 * @returns {Item|null}
 */
function _findEquippedArmor(actor, hitLocation) {
  if (!actor?.items) return null;

  // Get all equipped armor items
  const equippedArmor = actor.items.filter(i =>
    i.type === "armor" && i.system?.equipped === true
  );

  if (!equippedArmor.length) return null;

  // If hit location is specified, try to match by armor coverage
  if (hitLocation) {
    const locLower = hitLocation.toLowerCase().trim();
    for (const armor of equippedArmor) {
      // Check coverage areas stored in the armor's system data
      const coverage = _str(armor.system?.coverage).toLowerCase();
      if (coverage && coverage.includes(locLower)) return armor;

      // Check armor location field
      const armorLoc = _str(armor.system?.location).toLowerCase();
      if (armorLoc && armorLoc.includes(locLower)) return armor;

      // Check armor name as fallback
      const armorName = armor.name.toLowerCase();
      if (armorName.includes(locLower)) return armor;
    }
  }

  // Fallback: return the first equipped armor (typically body armor)
  return equippedArmor[0] ?? null;
}

/**
 * Find the equipped shield on an actor.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
function _findEquippedShield(actor) {
  if (!actor?.items) return null;
  return actor.items.find(i =>
    i.type === "armor" &&
    i.system?.equipped === true &&
    (i.system?.isShield === true ||
     (i.system?.traitsStructured ?? []).some(t => (t?.key ?? t) === "shield") ||
     i.name.toLowerCase().includes("shield"))
  ) ?? null;
}

/**
 * Find the equipped weapon on an actor (primary weapon).
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
function _findEquippedWeapon(actor) {
  if (!actor?.items) return null;
  return actor.items.find(i =>
    i.type === "weapon" && i.system?.equipped === true
  ) ?? null;
}

/**
 * Resolve the Spell Strength from the spell's damage formula / scaling.
 * Disintegrate spells store SS in the damageFormula field.
 *
 * @param {Item} spell
 * @returns {number}
 */
function _resolveSpellStrength(spell) {
  const formula = _str(spell.system?.damageFormula || spell.system?.spell_str || spell.system?.damage);
  const n = Number(formula);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Hook Handler: Process Disintegrate on Spell Hit
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Handle `uesrpg.spell.effectApplied` — if the spell has engine.disintegrate.enabled,
 * find the target's equipped armor/shield/weapon and apply Damaged(SS).
 *
 * @param {object} payload - { caster, target, spell, effects, originEffect }
 * @returns {Promise<void>}
 */
async function _onEffectApplied(payload) {
  const { caster, target, spell } = payload;
  if (!caster || !target || !spell) return;

  // Check if spell has disintegrate engine enabled
  const disintConfig = spell.system?.engine?.disintegrate;
  if (!disintConfig?.enabled) return;

  // Only GM processes disintegrate (item mutation requires authority)
  if (!game.user.isGM) return;

  const targetType = _str(disintConfig.target).toLowerCase() || "armor";
  const ss = _resolveSpellStrength(spell);

  _debug("Disintegrate triggered:", {
    spell: spell.name,
    target: target.name,
    targetType,
    spellStrength: ss
  });

  // Determine which item to degrade
  let targetItem = null;
  let itemDesc = "";

  if (targetType === "weapon") {
    targetItem = _findEquippedWeapon(target);
    itemDesc = "weapon";
  } else {
    // Armor: check for shield block first
    // TODO: When the opposed workflow provides block info, use it to determine shield vs armor
    // For now, default to armor unless the target's last defense was a shield block
    const lastDefense = target.getFlag?.(_FLAG_NS, "lastDefenseType");
    if (lastDefense === "block" || lastDefense === "ward") {
      targetItem = _findEquippedShield(target);
      itemDesc = "shield";
    }
    if (!targetItem) {
      targetItem = _findEquippedArmor(target);
      itemDesc = "armor";
    }
  }

  if (!targetItem) {
    _debug("Disintegrate: no eligible", itemDesc, "found on", target.name);
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Disintegrate — No Target Found</h3>
          <p><strong>${caster.name}</strong>'s <strong>${spell.name}</strong> hit <strong>${target.name}</strong>,
          but no equipped ${itemDesc} was found to degrade.</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  // Apply Damaged(SS)
  const result = await applyDamagedQuality(targetItem, ss, {
    sourceSpell: spell.name,
    workflowId: `disintegrate-${caster.uuid}-${Date.now()}`
  });

  if (result?.success) {
    const valueText = result.oldValue > 0
      ? `Damaged (${result.oldValue}) → Damaged (${result.newValue})`
      : `Damaged (${result.newValue})`;

    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Disintegrate — ${targetType === "weapon" ? "Weapon" : "Armor"} Degraded</h3>
          <p><strong>${caster.name}</strong>'s <strong>${spell.name}</strong> applies <strong>${valueText}</strong>
          to <strong>${target.name}</strong>'s <strong>${targetItem.name}</strong>.</p>
          <p><em>Spell Strength: ${ss}</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
  }
}

/**
 * Also hook into the opposed test outcome to catch Disintegrate hits that don't
 * fire effectApplied (because they have no embedded AEs). This hooks
 * `uesrpg.spell.castResolved` to process non-AE Disintegrate spells after
 * the opposed test resolves.
 *
 * Note: For Disintegrate spells with isDamagingSpell=false and no effects[],
 * the effectApplied hook won't fire. We use a custom hook emitted from the
 * outcome resolution instead.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 *  Initialization
 * ═══════════════════════════════════════════════════════════════════════════ */

let _initialized = false;

/**
 * Register the disintegrate service hook listener. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeDisintegrateService() {
  if (_initialized) return;
  _initialized = true;

  // Hook effectApplied for spells that have embedded AEs
  Hooks.on("uesrpg.spell.effectApplied", _onEffectApplied);

  // Hook a custom spell outcome hook for non-AE disintegrate spells
  Hooks.on("uesrpg.spell.spellHitTarget", _onSpellHitTarget);

  _debug("Disintegrate service hooks registered");
}

/**
 * Handle the custom `uesrpg.spell.spellHitTarget` hook — fired from outcome
 * resolution when a non-damaging attack spell hits but has no AEs to apply.
 * This ensures Disintegrate spells without embedded effects still process.
 *
 * @param {object} payload - { caster, target, spell, hitLocation, defenseType }
 * @returns {Promise<void>}
 */
async function _onSpellHitTarget(payload) {
  const { caster, target, spell, hitLocation, defenseType } = payload;
  if (!caster || !target || !spell) return;

  const disintConfig = spell.system?.engine?.disintegrate;
  if (!disintConfig?.enabled) return;

  // Only GM processes
  if (!game.user.isGM) return;

  // Avoid double-processing if effectApplied already handled it
  // (effectApplied fires only if spellNeedsEffectApplication is true)
  // spellHitTarget fires for ALL non-damaging hits
  // Check if the spell has any enabled effects — if so, effectApplied will handle it
  const hasEnabledEffects = (spell.effects ?? []).some(e => !e.disabled);
  if (hasEnabledEffects) return;

  const targetType = _str(disintConfig.target).toLowerCase() || "armor";
  const ss = _resolveSpellStrength(spell);

  _debug("Disintegrate (via spellHitTarget):", {
    spell: spell.name,
    target: target.name,
    targetType,
    spellStrength: ss,
    hitLocation,
    defenseType
  });

  let targetItem = null;
  let itemDesc = "";

  if (targetType === "weapon") {
    targetItem = _findEquippedWeapon(target);
    itemDesc = "weapon";
  } else {
    // Use defenseType from the opposed test to determine if shield was used
    if (defenseType === "block" || defenseType === "ward") {
      targetItem = _findEquippedShield(target);
      itemDesc = "shield";
    }
    if (!targetItem) {
      targetItem = _findEquippedArmor(target, hitLocation);
      itemDesc = "armor";
    }
  }

  if (!targetItem) {
    _debug("Disintegrate (spellHitTarget): no eligible", itemDesc, "on", target.name);
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Disintegrate — No Target Found</h3>
          <p><strong>${caster.name}</strong>'s <strong>${spell.name}</strong> hit <strong>${target.name}</strong>,
          but no equipped ${itemDesc} was found to degrade.</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  const result = await applyDamagedQuality(targetItem, ss, {
    sourceSpell: spell.name
  });

  if (result?.success) {
    const valueText = result.oldValue > 0
      ? `Damaged (${result.oldValue}) → Damaged (${result.newValue})`
      : `Damaged (${result.newValue})`;

    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Disintegrate — ${targetType === "weapon" ? "Weapon" : "Armor"} Degraded</h3>
          <p><strong>${caster.name}</strong>'s <strong>${spell.name}</strong> applies <strong>${valueText}</strong>
          to <strong>${target.name}</strong>'s <strong>${targetItem.name}</strong>.</p>
          <p><em>Spell Strength: ${ss}</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
  }
}
