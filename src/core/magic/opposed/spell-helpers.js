/**
 * @module magic/opposed/spell-helpers
 *
 * src/core/magic/opposed/spell-helpers.js
 *
 * Spell-specific utility functions for magic opposed workflow.
 */

import { isMultiDefender } from "./schema.js";
import { computeSpellMagickaCost, getSpellDamageFormula, getSpellDamageType, rollSpellDamage } from "../magicka-utils.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { computeElementalDamageBonus } from "../magic-modifiers.js";
import { canTokenEscapeArea } from "../../../utils/aoe-utils.js";
import { getCoreRollMode, isPublicChatMessageMode } from "../../../utils/chat-roll-mode.js";
import { canUserRollActor } from "../../../utils/permissions.js";
import { resolveToken } from "./schema.js";

export function emitSuppressedOpposedSubRollDice(roll, { rollMode = null } = {}) {
  if (!roll) return null;
  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  const sync = isPublicChatMessageMode(rollMode ?? getCoreRollMode());

  try {
    const primary = dsn.showForRoll(roll, game.user, sync);
    Promise.resolve(primary).catch(() => {
      try {
        const fallback = dsn.showForRoll(roll);
        Promise.resolve(fallback).catch(() => {});
      } catch (_err2) {
        // no-op
      }
    });
  } catch (_err) {
    try {
      const fallback = dsn.showForRoll(roll);
      Promise.resolve(fallback).catch(() => {});
    } catch (_err2) {
      // no-op
    }
  }
  return null;
}

async function _postSpellDamageRollMessage({
  attacker,
  spell,
  rolls = [],
  parentMessageId = null
} = {}) {
  const safeRolls = Array.isArray(rolls) ? rolls.filter(Boolean) : [];
  if (!attacker || !safeRolls.length) return null;

  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  // Avoid posting extra "Spell - Damage Roll" chat cards in inline opposed flows.
  await Promise.allSettled(safeRolls.map(async (roll) => {
    try {
      await dsn.showForRoll(roll, game.user, true);
    } catch (_err) {
      try {
        await dsn.showForRoll(roll);
      } catch (_err2) {
        // no-op: the opposed card still renders the roll breakdown inline
      }
    }
  }));

  return null;
}

/**
 * Check if a spell has a finite duration.
 * @param {Item} spell
 * @returns {boolean}
 */
export function spellHasFiniteDuration(spell) {
  const dur = spell?.system?.duration ?? {};
  const unit = String(dur.unit ?? "rounds");
  const value = Number(dur.value ?? 0) || 0;
  if (!value) return false;
  // Units that represent a finite duration which should be tracked/represented as a target AE even when there are no embedded AEs.
  return ["rounds", "minutes", "hours", "days"].includes(unit);
}

/**
 * Check if a spell needs effect application.
 * @param {Item} spell
 * @returns {boolean}
 */
export function spellNeedsEffectApplication(spell) {
  if (!spell) return false;
  if (Boolean(spell.system?.hasUpkeep)) return true;
  if (Boolean(spell.system?.hasOverTime)) return true;
  if ((spell.effects?.size ?? 0) > 0) return true;
  return spellHasFiniteDuration(spell);
}

/**
 * Check if a successful direct spell should create a deferred application panel.
 * Covers damage, healing, effects-only, and buffer-only direct spells.
 * @param {Item} spell
 * @returns {boolean}
 */
export function spellNeedsDeferredDirectApplication(spell) {
  if (!spell) return false;
  if (spellNeedsEffectApplication(spell)) return true;

  const damageType = getSpellDamageType(spell);
  if (isHealingType(damageType)) return true;

  const damageFormula = String(getSpellDamageFormula(spell) ?? "").trim();
  if (damageFormula && damageFormula !== "0" && String(damageType ?? "").trim().toLowerCase() !== "none") {
    return true;
  }

  return Boolean(spell.system?.hasBuffer && spell.system?.buffer?.type && spell.system.buffer.type !== "none");
}

/**
 * Get blocking no-duration upkeep effect.
 * @param {Actor} actor
 * @param {string} pendingSpellUuid
 * @returns {object|null}
 */
export function getBlockingNoDurationUpkeep(actor, pendingSpellUuid) {
  const effects = actor?.effects ?? [];
  for (const e of effects) {
    if (e?.disabled) continue;
    const f = e?.flags?.["uesrpg-3ev4"];
    if (!f?.spellEffect) continue;
    if (!f?.hasUpkeep) continue;
    if (!f?.noListedDuration) continue;
    const activeSpellUuid = String(f?.spellUuid ?? e?.origin ?? "");
    if (pendingSpellUuid && String(pendingSpellUuid) === activeSpellUuid) continue;
    return {
      effectId: e.id,
      spellUuid: activeSpellUuid,
      spellName: String(f?.spellName ?? e?.name ?? "Upkept Spell")
    };
  }
  return null;
}

/**
 * Check if a damage type is a healing type (includes temporary healing).
 * @param {string} damageType
 * @returns {boolean}
 */
export function isHealingType(damageType) {
  const dt = String(damageType || "").toLowerCase();
  return dt === "healing" || dt === "temporaryhealing" || dt === "temporary healing";
}

/**
 * Check if a damage type is temporary healing (normalized comparison).
 * @param {string} damageType
 * @returns {boolean}
 */
export function isTemporaryHealingType(damageType) {
  if (!damageType) return false;
  const dt = String(damageType).toLowerCase().trim();
  return dt === "temporaryhealing" || dt === "temporary healing";
}

/**
 * Check if spell damage should be shared across multiple targets.
 * @param {object} data
 * @returns {boolean}
 */
export function shouldShareSpellDamage(data) {
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  return isAoE || isMultiDefender(data);
}

/**
 * Compute shared spell damage for multi-target/AoE spells.
 * @param {object} options - {attacker, spell, spellOptions, isCritical, damageType}
 * @returns {Promise<object>}
 */
export async function computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId = null } = {}) {
  // Map castLevel → level for downstream functions
  const normalizedOptions = {
    ...(spellOptions ?? {}),
    level: spellOptions?.castLevel ?? spellOptions?.level ?? null
  };
  
  const costInfo = computeSpellMagickaCost(attacker, spell, {
    ...normalizedOptions,
    isCritical
  });

  const wpBonus = Math.floor(Number(attacker.system?.characteristics?.wp?.total ?? 0) / 10);
  const isOverloaded = Boolean(costInfo?.isOverloaded);
  const overloadBonus = isOverloaded ? wpBonus : 0;

  const commonRollOptions = { 
    isCritical, 
    isOverloaded, 
    wpBonus,
    level: normalizedOptions.level // Include level for damage scaling
  };

  const wantsOvercharge = Boolean(costInfo?.isOvercharged);
  let damageRoll = null;
  let rollMessages = null;
  let overchargeTotals = null;
  if (wantsOvercharge) {
    const r1 = await rollSpellDamage(spell, commonRollOptions);
    const r2 = await rollSpellDamage(spell, commonRollOptions);
    const t1 = Number(r1.total) || 0;
    const t2 = Number(r2.total) || 0;
    damageRoll = (t2 > t1) ? r2 : r1;
    rollMessages = [r1, r2];
    overchargeTotals = [t1, t2];
  } else {
    damageRoll = await rollSpellDamage(spell, commonRollOptions);
    rollMessages = [damageRoll];
  }

  const baseDamage = Number(damageRoll.total) || 0;
  const elemBonusInfo = computeElementalDamageBonus(attacker, damageType);
  const elementalBonus = Number(elemBonusInfo?.bonus ?? 0) || 0;
  const damageValue = baseDamage + overloadBonus + elementalBonus;
  const rollHTML = await damageRoll.render();
  const rollMessage = await _postSpellDamageRollMessage({
    attacker,
    spell,
    rolls: rollMessages,
    parentMessageId
  });

  return {
    spellUuid: spell?.uuid ?? null,
    damageType,
    baseDamage,
    damageValue,
    rollHTML,
    isOverloaded,
    overloadBonus,
    isOvercharged: wantsOvercharge,
    overchargeTotals,
    elementalBonus,
    elementalBonusLabel: elemBonusInfo?.label || "",
    rollMessageId: rollMessage?.id ?? null
  };
}

/**
 * Get or create shared spell damage for a spell.
 * @param {object} options - {data, attacker, spell, spellOptions, isCritical, damageType}
 * @returns {Promise<object|null>}
 */
export async function getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId = null } = {}) {
  if (!shouldShareSpellDamage(data)) return null;
  data.context = data.context ?? {};
  const existing = data.context.sharedSpellDamage;
  if (existing && existing.spellUuid === spell?.uuid && existing.damageType === damageType) {
    return existing;
  }
  const computed = await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId });
  data.context.sharedSpellDamage = computed;
  return computed;
}

/**
 * Prompt for AoE evade escape.
 * @param {object} options - {defenderName, spellName}
 * @returns {Promise<boolean|null>}
 */
export async function promptAoEEvadeEscape({ defenderName = "Defender", spellName = "the spell" } = {}) {
  try {
    return await confirmDialog({
      title: "AoE Evade",
      content: `<p>${defenderName} successfully evaded ${spellName}. Can they move 1m to exit the area?</p>`,
      yesLabel: "Escapes AoE",
      noLabel: "Still in AoE",
    });
  } catch (_e) {
    return null;
  }
}

/**
 * Resolve AoE evade escape for a defender.
 * @param {object} options - {data, defenderEntry, defenderActor}
 * @returns {Promise<boolean|null>}
 */
export async function maybeResolveAoEEvadeEscape({ data, defenderEntry, defenderActor } = {}) {
  if (!data || !defenderEntry) return null;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  if (!isAoE) return null;

  const defenseType = String(defenderEntry.defenseType ?? "").toLowerCase();
  if (defenseType !== "evade") return null;

  if (!defenderEntry?.result?.isSuccess) return null;
  if (defenderEntry.aoeEvadeEscaped === true) return true;
  if (defenderEntry.aoeEvadeEscaped === false) return false;

  const areaUuid = data?.context?.aoe?.areaUuid ?? data?.context?.aoe?.regionUuid ?? data?.context?.aoe?.templateUuid ?? null;
  const areaId = data?.context?.aoe?.areaId ?? data?.context?.aoe?.regionId ?? data?.context?.aoe?.templateId ?? null;
  const token = resolveToken(defenderEntry?.tokenUuid ?? defenderActor?.uuid);

  let canEscape = canTokenEscapeArea({ areaUuid, areaId, token, stepMeters: 1 });
  if (canEscape == null) {
    const canPrompt = game.user?.isGM || (defenderActor && canUserRollActor(game.user, defenderActor));
    if (canPrompt) {
      canEscape = await promptAoEEvadeEscape({
        defenderName: defenderActor?.name ?? defenderEntry?.name ?? "Defender",
        spellName: data?.attacker?.spellName ?? "the spell"
      });
    }
  }

  if (canEscape != null) {
    defenderEntry.aoeEvadeEscaped = Boolean(canEscape);
    defenderEntry.aoeEvadeFailed = !canEscape;
  }

  return canEscape;
}
