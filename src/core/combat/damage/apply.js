/**
 * Damage & Healing Application
 * 
 * This module contains the top-level damage and healing application functions.
 * These functions orchestrate the full workflow: calculation, HP updates, 
 * unconscious/wounded status tracking, chat messages, and hook dispatch.
 */

import { calculateDamage } from "./calc.js";
import { DAMAGE_TYPES } from "./types.js";
import { isItemMagicSource } from "./reduction.js";
import { isActorImmuneToDamageType, isActorIncorporeal } from "../../traits/trait-registry.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { normalizeActiveEffectOrigin } from "../../../utils/compat.js";
import { isAnyDebugEnabled } from "../../../utils/debug.js";
import { shouldTriggerWound } from "../../wounds/wound-rules.js";
import { isShieldItem } from "../../items/shield-utils.js";
import { getResolvedArmorValues, isArmorCoveringLocation } from "../armor-state.js";
import {
  applyPostDamageUpdate,
  dispatchDamageAppliedHook,
  finalizeDamageTargetState,
  ensureUnconsciousEffect,
  resolveDamageUpdateTarget
} from "./post-application.js";

export { ensureUnconsciousEffect };

function _healingDebug(...args) {
  if (!isAnyDebugEnabled(["woundsDebug", "spellCastingDebug"])) return;
  try {
    console.log(...args);
  } catch (_e) {
    // no-op
  }
}

function _normalizeLocationKey(hitLocation = "Body") {
  const locationMap = {
    Head: "Head",
    Body: "Body",
    "Right Arm": "RightArm",
    "Left Arm": "LeftArm",
    "Right Leg": "RightLeg",
    "Left Leg": "LeftLeg",
    RightArm: "RightArm",
    LeftArm: "LeftArm",
    RightLeg: "RightLeg",
    LeftLeg: "LeftLeg",
  };
  return locationMap[hitLocation] ?? hitLocation;
}

function _isShieldItem(item) {
  return isShieldItem(item, { allowLegacy: true });
}

function _isNpcActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "npc";
}

function _getArmorRuntimeOptions(_actor) {
  // Prone changes trigger-style armor coverage interactions, not the item's
  // actual protection score for damage/quality degradation.
  return { isProneForArmor: false };
}

function _getItemLocationProtectionScore(item, { actor = null } = {}) {
  if (!item) return 0;
  const sys = item.system ?? {};
  const rawProtection = _isShieldItem(item)
    ? Number(sys.blockRatingEffective ?? sys.blockRating ?? sys.blockEffective ?? sys.block ?? 0)
    : Number(getResolvedArmorValues(sys, _getArmorRuntimeOptions(actor)).armor ?? 0);
  return Number.isFinite(rawProtection) ? Math.max(0, rawProtection) : 0;
}

function _getStructuredDamagedValue(item) {
  const structured = Array.isArray(item?.system?.qualitiesStructured)
    ? item.system.qualitiesStructured
    : [];
  const damaged = structured.find((q) => String(q?.key ?? "").toLowerCase() === "damaged");
  const n = Number(damaged?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function _applyDamagedQualityToItem(item, amount, { destroyWhenDepleted = false, actor = null } = {}) {
  if (!item) return false;
  const step = Math.max(0, Math.floor(Number(amount) || 0));
  if (!step) return false;

  const currentProtection = _getItemLocationProtectionScore(item, { actor });
  const structured = foundry.utils.deepClone(item.system?.qualitiesStructured ?? []);
  const existingIdx = structured.findIndex((q) => String(q?.key ?? "").toLowerCase() === "damaged");
  const oldDamaged = _getStructuredDamagedValue(item);
  const nextDamaged = oldDamaged + step;

  if (existingIdx >= 0) {
    structured[existingIdx] = { ...(structured[existingIdx] ?? {}), key: "damaged", value: nextDamaged };
  } else {
    structured.push({ key: "damaged", value: nextDamaged });
  }

  const nextProtection = Math.max(0, currentProtection - step);
  if (destroyWhenDepleted && nextProtection <= 0) {
    const parentActor = item.parent;
    if (parentActor?.documentName === "Actor" && item?.id) {
      await requestDeleteEmbeddedDocuments(parentActor, "Item", [item.id]);
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: parentActor }),
        content: `<div class="uesrpg"><b>${item.name}</b> is destroyed.</div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      return true;
    }
  }

  await requestUpdateDocument(item, { "system.qualitiesStructured": structured });
  return true;
}

export async function applyArmorLocationDamage(targetActor, hitLocation, damagedValue = 0) {
  if (!targetActor?.items) return 0;
  const amount = Math.max(0, Math.floor(Number(damagedValue) || 0));
  if (!amount) return 0;

  const propertyName = _normalizeLocationKey(hitLocation);
  const equippedArmor = targetActor.items?.filter((i) => i.type === "armor" && i.system?.equipped === true) ?? [];
  let updatedCount = 0;

  for (const item of equippedArmor) {
    if (!isArmorCoveringLocation(item, propertyName)) continue;
    if (_getItemLocationProtectionScore(item, { actor: targetActor }) <= 0) continue;

    const applied = await _applyDamagedQualityToItem(item, amount, { destroyWhenDepleted: true, actor: targetActor });
    if (applied) updatedCount += 1;
  }

  return updatedCount;
}

/**
 * Apply damage to an actor.
 * 
 * Handles the complete damage application workflow:
 * - Damage calculation (or bypass via ignoreReduction)
 * - Immunity and incorporeal checks
 * - Temp HP absorption
 * - HP updates
 * - Wounded/unconscious status tracking
 * - Chat message generation
 * - Hook dispatch for downstream automation
 * 
 * @param {Actor} actor - Target actor
 * @param {number} damage - Raw damage amount
 * @param {string} damageType - Type of damage (from DAMAGE_TYPES)
 * @param {object} options - Configuration options
 * @param {boolean} options.ignoreReduction - Bypass armor/resistance/toughness
 * @param {number} options.penetration - Armor penetration value
 * @param {number} options.dosBonus - Degrees of Success bonus damage
 * @param {string} options.source - Damage source description
 * @param {string} options.hitLocation - Hit location (Head, Body, RightArm, etc.)
 * @param {boolean} options.penetrateArmorForTriggers - For weapon qualities
 * @param {boolean} options.forcefulImpact - Apply Forceful Impact (Damaged +1 to armor)
 * @param {boolean} options.pressAdvantage - Informational flag for Press Advantage
 * @param {Item} options.weapon - Weapon item (for quality bonuses)
 * @param {Actor} options.attackerActor - Attacker (for AE modifiers)
 * @param {boolean} options.magicSource - Is this magic damage?
 * @param {object} options.damageAppliedByType - Track damage by type (for wounds)
 * @param {number} options.aeDamageTaken - Active Effect damage modifier (defender-side)
 * @param {number} options.aeMitigationFlat - Active Effect flat mitigation (defender-side)
 * @param {object} options.aeBreakdown - Detailed AE breakdown for chat display
 * @param {string} options.rollHTML - Dice roll HTML for chat
 * @param {string} options.criticalNote - Critical hit note for chat
 * @param {Array} options.extraBreakdownLines - Extra lines for breakdown section
 * @param {boolean} options.showZeroDoS - Show "+0 DoS" in chat even if zero
 * @param {string} options.applicationId - Unique ID for this damage event
 * @param {*} options.origin - Origin reference for hooks
 * @returns {Promise<object>} Result object with damage details
 */
export async function applyDamage(actor, damage, damageType = DAMAGE_TYPES.PHYSICAL, options = {}) {
  const {
    ignoreReduction = false,
    penetration = 0,
    dosBonus = 0,
    source = "Unknown",
    hitLocation = "Body",
    penetrateArmorForTriggers = false,
    // Advantage: Forceful Impact — applies/advances Damaged (1) on the armor piece protecting the hit location.
    // Current implementation: increments the Damaged quality on ONE equipped armor piece covering the location.
    forcefulImpact = false,
    // Advantage: Press Advantage — currently informational only (advantage economy is handled in opposed workflow).
    pressAdvantage = false,
    // Optional: enable RAW weapon-quality bonuses.
    weapon = null,
    attackerActor = null,
    magicSource = false,
    // When true, suppress the damage chat message (used by OverTime engine which posts its own).
    skipChatMessage = false,
    // For magic wounds: track damage by type for proper wound side effects
    damageAppliedByType = null,
    woundThresholdDelta = 0,
  } = options;

  if (!actor?.system) {
    ui.notifications.error("Invalid actor for damage application");
    return null;
  }

  // Compatibility: allow calling applyDamage with DAMAGE_TYPES.HEALING.
  // Route to applyHealing to avoid negative HP application.
  if (String(damageType ?? "").toLowerCase() === DAMAGE_TYPES.HEALING) {
    return applyHealing(actor, damage, options);
  }

  const rawDamage = Number(damage || 0);

  // Compute damage breakdown
  const damageCalc = ignoreReduction
    ? {
        rawDamage,
        dosBonus: Number(dosBonus || 0),
        totalDamage: Math.max(0, rawDamage + Number(dosBonus || 0)),
        reductions: { armor: 0, resistance: 0, toughness: 0, total: 0, penetrated: 0 },
        finalDamage: Math.max(0, rawDamage + Number(dosBonus || 0)),
        hitLocation,
        damageType,
      }
    : calculateDamage(rawDamage, damageType, actor, { penetration, dosBonus, hitLocation });

  // If weapon/attacker are provided, prefer the enriched calculation.
  // (calculateDamage is backwards-compatible; extra keys are ignored by older callers.)
  if (!ignoreReduction && (weapon || attackerActor)) {
    Object.assign(damageCalc, calculateDamage(rawDamage, damageType, actor, {
      penetration,
      dosBonus,
      hitLocation,
      penetrateArmorForTriggers,
      weapon,
      attackerActor,
    }));
  }

  if (isActorImmuneToDamageType(actor, damageType)) {
    damageCalc.immunity = { isImmune: true, damageType: String(damageType ?? "") };
    damageCalc.finalDamage = 0;
  }

  const defenderIncorporeal = isActorIncorporeal(actor);
  const isMagicAttack = magicSource || isItemMagicSource(weapon);
  if (defenderIncorporeal && !isMagicAttack) {
    damageCalc.incorporealBlock = { isBlocked: true, reason: "non-magic source" };
    damageCalc.finalDamage = 0;
  }

  const finalDamage = Number(damageCalc.finalDamage || 0);

  // --- Active Effects: Damage & Mitigation modifiers (final resolution stage)
  // All values are additive and sourced from AEs using explicit keys.
  // - aeDamageTaken: applied AFTER armor/resistance/toughness (positive increases damage taken; negative reduces)
  // - aeMitigationFlat: flat mitigation applied AFTER reductions (positive reduces damage)
  const aeDamageTaken = Number(options?.aeDamageTaken ?? 0) || 0;
  const aeMitigationFlat = Number(options?.aeMitigationFlat ?? 0) || 0;
  let finalDamageAdjusted = Math.max(0, finalDamage + aeDamageTaken - aeMitigationFlat);
  if (damageCalc.immunity?.isImmune) finalDamageAdjusted = 0;
  if (damageCalc.incorporealBlock?.isBlocked) finalDamageAdjusted = 0;

  // Wound Threshold: canonical trigger behavior is routed through wounds/wound-rules.js
  // to support both standard and alternate rules modes.
  // Schema: actor.system.wound_threshold.value (PC + NPC).
  const baseWoundThreshold = (() => {
    const wt = actor.system?.wound_threshold;
    // Preferred
    if (wt && typeof wt === "object") {
      const v = Number(wt.value ?? wt.total ?? wt.base);
      return Number.isFinite(v) ? v : 0;
    }
    // Defensive fallbacks
    const v = Number(actor.system?.woundThreshold ?? actor.system?.wounds ?? 0);
    return Number.isFinite(v) ? v : 0;
  })();
  const woundThreshold = Math.max(0, baseWoundThreshold + (Number(woundThresholdDelta) || 0));

  // HP state with temp HP support
  const currentHP = Number(actor.system?.hp?.value ?? 0);
  const maxHP = Number(actor.system?.hp?.max ?? 1);
  const currentTempHP = Number(actor.system?.tempHP ?? 0);
  
  // Temp HP absorbs damage first, then regular HP
  let remainingDamage = finalDamageAdjusted;
  let newTempHP = currentTempHP;
  let newHP = currentHP;
  let tempHPAbsorbed = 0;
  
  if (currentTempHP > 0 && remainingDamage > 0) {
    if (remainingDamage <= currentTempHP) {
      // Temp HP absorbs all damage
      newTempHP = currentTempHP - remainingDamage;
      tempHPAbsorbed = remainingDamage;
      remainingDamage = 0;
    } else {
      // Temp HP absorbs some damage, rest goes to regular HP
      tempHPAbsorbed = currentTempHP;
      remainingDamage -= currentTempHP;
      newTempHP = 0;
    }
  }
  
  // Apply remaining damage to regular HP
  if (remainingDamage > 0) {
    newHP = Math.max(0, currentHP - remainingDamage);
  }

  // Choose update target: unlinked token actor if applicable, else base actor
  const updateTarget = resolveDamageUpdateTarget(actor);

  // Canonical wound trigger routing.
  const woundEval = shouldTriggerWound({
    damageApplied: finalDamageAdjusted,
    woundThreshold,
    isCriticalSuccess: Boolean(options?.criticalSuccess ?? options?.isCritical ?? false),
    newHp: newHP
  });
  const isWounded = woundEval.triggered === true;

  let woundStatus = "uninjured";
  if (newHP === 0) woundStatus = _isNpcActor(updateTarget) ? "dead" : "unconscious";
  else if (isWounded) woundStatus = "wounded";

  await applyPostDamageUpdate(actor, { newHP, newTempHP });

  // Emit damage-applied hook for downstream automation (wounds, conditions, etc.)
  const damageOrigin = normalizeActiveEffectOrigin(options?.origin)
    ?? normalizeActiveEffectOrigin(options?.weapon?.uuid)
    ?? null;
  dispatchDamageAppliedHook(updateTarget, {
    applicationId: options?.applicationId ?? crypto?.randomUUID?.() ?? foundry?.utils?.randomID?.() ?? null,
    origin: damageOrigin,
    source,
    weapon: options?.weapon ?? null,
    ammo: options?.ammo ?? null,
    amountApplied: finalDamageAdjusted,
    hitLocation,
    damageType,
    damageAppliedByType: damageAppliedByType,
    woundThreshold,
    woundThresholdDelta: Number(woundThresholdDelta) || 0,
    woundMode: woundEval.mode,
    woundTriggerReason: woundEval.reason,
    criticalSuccess: Boolean(options?.criticalSuccess ?? options?.isCritical ?? false),
    woundTriggered: isWounded === true,
    chatContext: foundry.utils.deepClone(options?.chatContext ?? null),
  });


  if (forcefulImpact && String(damageType ?? "").toLowerCase() === DAMAGE_TYPES.PHYSICAL) {
    try {
      await _applyForcefulImpact(updateTarget, hitLocation);
    } catch (err) {
      console.warn("UESRPG | Forceful Impact armor update failed", err);
    }
  }

  await finalizeDamageTargetState(updateTarget, { newHP });

  // Damage chat message (GM-only, blind by default)
  const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
  const hpDelta = Math.max(0, currentHP - newHP);

  const parts = [];
  const rollHTML = String(options?.rollHTML ?? "");

  const criticalNote = String(options?.criticalNote ?? "");
  const extraBreakdownLines = Array.isArray(options?.extraBreakdownLines) ? options.extraBreakdownLines : [];

  if (rollHTML) {
    parts.push(`<div class="uesrpg-da-row"><span class="k">Roll</span><span class="v">${rollHTML}</span></div>`);
  }

  if (criticalNote) {
    parts.push(`<div class="uesrpg-da-row"><span class="k">Critical</span><span class="v">${criticalNote}</span></div>`);
  }
  
  // Show temp HP absorption if any
  if (tempHPAbsorbed > 0) {
    parts.push(`<div class="uesrpg-da-row"><span class="k">Temp HP Absorbed</span><span class="v">${tempHPAbsorbed}</span></div>`);
  }

  for (const line of extraBreakdownLines) {
    const s = String(line ?? "");
    if (!s) continue;
    parts.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${s}</span></div>`);
  }

  if (damageCalc.immunity?.isImmune) {
    const immType = String(damageCalc.immunity?.damageType ?? damageType ?? "");
    const label = immType ? `Immune (${immType})` : "Immune";
    parts.push(`<div class="uesrpg-da-row"><span class="k">Trait</span><span class="v">${label}</span></div>`);
  }

  if (damageCalc.incorporealBlock?.isBlocked) {
    parts.push(`<div class="uesrpg-da-row"><span class="k">Trait</span><span class="v">Incorporeal (non-magic source)</span></div>`);
  }

  if (damageCalc.incorporealAttack?.ignoreNonMagicArmor) {
    parts.push(`<div class="uesrpg-da-row"><span class="k">Trait</span><span class="v">Incorporeal Attack (non-magic AR ignored)</span></div>`);
  }

  if (!ignoreReduction) {
    const rd = Number(damageCalc.rawDamage ?? 0);
    const db = Number(damageCalc.dosBonus ?? 0);
    const wb = Number(damageCalc.weaponBonus ?? 0);
    const showZeroDoS = Boolean(options?.showZeroDoS);
    const bonuses = [
      (db || showZeroDoS) ? `${db >= 0 ? "+" : ""}${db} DoS` : null,
      wb ? `${wb >= 0 ? "+" : ""}${wb} Weapon` : null,
    ].filter(Boolean).join(" ");
    parts.push(`<div class="uesrpg-da-row"><span class="k">Rolled</span><span class="v">${rd}</span></div>`);
    if (bonuses) parts.push(`<div class="uesrpg-da-row"><span class="k">Bonuses</span><span class="v">${bonuses}</span></div>`);
    parts.push(`<div class="uesrpg-da-row"><span class="k">Pre-Reduction Total</span><span class="v">${Number(damageCalc.totalDamage ?? (rd + db + wb))}</span></div>`);
    parts.push(`<div class="uesrpg-da-row"><span class="k">Reduction</span><span class="v">-${damageCalc.reductions.total} <span class="muted">(AR ${damageCalc.reductions.armor} / R ${damageCalc.reductions.resistance} / T ${damageCalc.reductions.toughness}${damageCalc.reductions.penetrated ? ` / Pen ${damageCalc.reductions.penetrated}` : ""})</span></span></div>`);
  }
  const aeBreakdown = options?.aeBreakdown ?? null;

  const aeSummary = (() => {
    const hasBreakdown =
      aeBreakdown &&
      (Array.isArray(aeBreakdown.attacker) || Array.isArray(aeBreakdown.defender));

    const rows = [];

    const fmt = (n) => {
      const v = Number(n ?? 0) || 0;
      return v >= 0 ? `+${v}` : `${v}`;
    };

    const sumByTarget = (entries, target) => {
      if (!Array.isArray(entries)) return 0;
      return entries
        .filter(e => e?.target === target)
        .reduce((a, e) => a + (Number(e?.value ?? 0) || 0), 0);
    };

    const renderDetails = (entries, target, label) => {
      if (!Array.isArray(entries)) return;
      for (const e of entries) {
        if (!e || e.target !== target) continue;
        const value = Number(e.value ?? 0) || 0;
        if (!value) continue;
        const name = String(e.label ?? "Effect");
        rows.push(
          `<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${label}: ${name} ${fmt(value)}</span></div>`
        );
      }
    };

    // --- Attacker-side (dealt damage + penetration) ---
    if (hasBreakdown) {
      const dealt = sumByTarget(aeBreakdown.attacker, "damage.dealt");
      const pen = sumByTarget(aeBreakdown.attacker, "penetration");

      const bits = [];
      if (dealt) bits.push(`Dealt ${fmt(dealt)}`);
      if (pen) bits.push(`Pen ${fmt(pen)} <span class="muted">(via penetration)</span>`);

      if (bits.length) {
        rows.push(
          `<div class="uesrpg-da-row"><span class="k">AE (Attacker)</span><span class="v">${bits.join(" • ")}</span></div>`
        );
        renderDetails(aeBreakdown.attacker, "damage.dealt", "Dealt");
        renderDetails(aeBreakdown.attacker, "penetration", "Pen");
      }
    }

    // --- Defender-side (damage taken + flat mitigation) ---
    {
      const bits = [];
      if (aeDamageTaken) bits.push(`Taken ${fmt(aeDamageTaken)}`);
      if (aeMitigationFlat) bits.push(`Mit -${Number(aeMitigationFlat || 0)}`);

      if (bits.length) {
        rows.push(
          `<div class="uesrpg-da-row"><span class="k">AE (Defender)</span><span class="v">${bits.join(" • ")}</span></div>`
        );

        if (hasBreakdown) {
          renderDetails(aeBreakdown.defender, "damage.taken", "Taken");
          renderDetails(aeBreakdown.defender, "mitigation.flat", "Mit");
        }
      }
    }

    return rows.join("");
  })();

  // --- Reduction provenance (Armor / Resistance / Toughness) ---
  // If the reduction calculation surfaced AE breakdown info, attribute it here.
  const reductionAEBreakdown = (() => {
    const r = damageCalc?.reductions;
    const ae = r?.ae;
    const base = r?.base;
    if (!ae || !base) return "";

    const lines = [];
    const fmt = (n) => {
      const v = Number(n ?? 0) || 0;
      return v >= 0 ? `+${v}` : `${v}`;
    };

    const pushEntries = (title, entries) => {
      if (!Array.isArray(entries) || !entries.length) return;
      for (const e of entries) {
        const value = Number(e?.value ?? 0) || 0;
        if (!value) continue;
        const label = String(e?.label ?? "Effect");
        lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${title}: ${label} ${fmt(value)}</span></div>`);
      }
    };

    // Armor Rating
    if ((ae.armorRating?.global?.total ?? 0) || (ae.armorRating?.location?.total ?? 0)) {
      const bits = [];
      const laneLabel = String(ae.armorRating?.lane ?? "physical").toLowerCase() === "magic" ? "Magic AR" : "Physical AR";
      if (ae.armorRating?.global?.total) bits.push(`Global ${fmt(ae.armorRating.global.total)}`);
      if (ae.armorRating?.location?.total) bits.push(`${ae.armorRating.location.key} ${fmt(ae.armorRating.location.total)}`);
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${laneLabel} AE: ${bits.join(" • ")}</span></div>`);
      pushEntries(laneLabel, ae.armorRating?.global?.entries);
      pushEntries(laneLabel, ae.armorRating?.location?.entries);
    }

    // Resistance
    if (ae.resistance?.key && ae.resistance?.total) {
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">R AE (${ae.resistance.key}): ${fmt(ae.resistance.total)}</span></div>`);
      pushEntries("R", ae.resistance.entries);
    }

    // Natural Toughness
    if (ae.natToughness?.total) {
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">T AE (natToughness): ${fmt(ae.natToughness.total)}</span></div>`);
      pushEntries("T", ae.natToughness.entries);
    }

    return lines.join("");
  })();

  const _actorThumb = updateTarget.img ?? "icons/svg/mystery-man.svg";
  const messageContent = `
    <div class="uesrpg-damage-applied-card">
      <div class="hdr">
        <img class="actor-thumb" src="${_actorThumb}" alt="">
        <div class="hdr-text">
          <div class="title">${updateTarget.name}</div>
          <div class="sub">${source}${hitLocation ? ` \u00B7 ${hitLocation}` : ""}${damageType ? ` <span class="type-tag">${damageType}</span>` : ""}</div>
        </div>
      </div>
      <div class="body">
        <div class="uesrpg-da-row"><span class="k">Applied Damage</span><span class="v final">${finalDamageAdjusted}</span></div>
        <div class="uesrpg-da-row"><span class="k">Pre-Reduction</span><span class="v">${Number(damageCalc.totalDamage ?? rawDamage)}</span></div>
        <div class="uesrpg-da-row"><span class="k">Reduction</span><span class="v">-${Number(damageCalc.reductions?.total ?? 0)}</span></div>
        <div class="uesrpg-da-row"><span class="k">HP</span><span class="v">${newHP} / ${maxHP}${hpDelta ? ` <span class="muted">(\u2212${hpDelta})</span>` : ""}</span></div>
        ${currentTempHP > 0 || newTempHP > 0 ? `<div class="uesrpg-da-row"><span class="k">Temp HP</span><span class="v">${newTempHP}${tempHPAbsorbed ? ` <span class="muted">(\u2212${tempHPAbsorbed})</span>` : ""}</span></div>` : ""}
        ${woundStatus === "wounded" ? `<div class="status wounded">\u26A0 WOUNDED <span class="muted">(WT ${woundThreshold})</span></div>` : ""}
        ${woundStatus === "unconscious" ? `<div class="status unconscious">\u{1F480} UNCONSCIOUS</div>` : ""}
        ${woundStatus === "dead" ? `<div class="status unconscious">\u{1F480} DEAD</div>` : ""}
        <details>
          <summary>Damage Breakdown</summary>
          <div style="font-size:12px; opacity:0.95;">${parts.join("\n")}${reductionAEBreakdown}${aeSummary}</div>
        </details>
      </div>
    </div>
  `;

  if (!skipChatMessage) {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: updateTarget }),
      content: messageContent,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: gmIds,
      blind: true,
    });
  }

  const prevented = Math.max(0, Number(damageCalc.totalDamage ?? rawDamage) - finalDamageAdjusted);

  return {
    actor: updateTarget,
    damage: finalDamageAdjusted,
    baseFinalDamage: finalDamage,
    aeDamageTaken,
    aeMitigationFlat,
    reductions: damageCalc.reductions,
    immunity: damageCalc.immunity ?? null,
    incorporealBlock: damageCalc.incorporealBlock ?? null,
    incorporealAttack: damageCalc.incorporealAttack ?? null,
    oldHP: currentHP,
    newHP,
    oldTempHP: currentTempHP,
    newTempHP,
    tempHPAbsorbed,
    woundStatus,
    prevented,
  };
}

/**
 * Apply Forceful Impact: increment Damaged (X) on one armor item that covers the hit location.
 * Selection policy: choose the single equipped, non-shield armor item with the highest effective AR at the location.
 *
 * This does NOT attempt to handle edge cases beyond deterministic item selection.
 */
export async function applyForcefulImpact(targetActor, hitLocation) {
  return _applyForcefulImpact(targetActor, hitLocation);
}

/**
 * Internal helper: apply Forceful Impact armor damage.
 * Used by applyDamage and the exported wrapper.
 * 
 * @param {Actor} targetActor - Target actor
 * @param {string} hitLocation - Hit location
 */
async function _applyForcefulImpact(targetActor, hitLocation) {
  if (!targetActor?.items) return;

  // Normalize hitLocation key variants coming from sheets/chat cards.
  const locationMap = {
    Head: "Head",
    Body: "Body",
    "Right Arm": "RightArm",
    "Left Arm": "LeftArm",
    "Right Leg": "RightLeg",
    "Left Leg": "LeftLeg",
    RightArm: "RightArm",
    LeftArm: "LeftArm",
    RightLeg: "RightLeg",
    LeftLeg: "LeftLeg",
  };
  const propertyName = _normalizeLocationKey(hitLocation);

  const equippedArmor = targetActor.items?.filter((i) => i.type === "armor" && i.system?.equipped === true) ?? [];
  const candidates = [];

  for (const item of equippedArmor) {
    if (!isArmorCoveringLocation(item, propertyName)) continue;

    // Forceful Impact selects one piece/shield. Prefer the item that is currently most protective
    // at the struck location.
    const score = _getItemLocationProtectionScore(item, { actor: targetActor });
    if (score <= 0) continue;

    candidates.push({ item, score });
  }

  if (!candidates.length) return;

  // Choose the single most protective item on that location (deterministic).
  candidates.sort((a, b) => (b.score - a.score));
  const targetItem = candidates[0].item;
  await _applyDamagedQualityToItem(targetItem, 1, { destroyWhenDepleted: true, actor: targetActor });
}

/**
 * Apply healing to an actor.
 *
 * @param {Actor} actor
 * @param {number} healing
 * @param {object} options
 * @param {string} options.source
 */
export async function applyHealing(actor, healing, options = {}) {
  const { source = "Healing" } = options;

  _healingDebug("UESRPG | applyHealing CALLED", {
    actor: actor?.name,
    healing,
    source,
    isTemporary: options.isTemporary
  });

  if (!actor?.system) {
    console.error("UESRPG | applyHealing: Invalid actor");
    ui.notifications.error("Invalid actor for healing");
    return null;
  }

  // NEW: Check if this is temporary HP grant
  if (options.isTemporary === true) {
    _healingDebug("UESRPG | applyHealing: Routing to applyTemporaryHP");
    return await applyTemporaryHP(actor, healing, source, options);
  }

  const currentHP = Number(actor.system?.hp?.value ?? 0);
  const maxHP = Number(actor.system?.hp?.max ?? 1);

  // RAW (Bleeding interaction): "subtract the total HP regained (including HP that would go beyond max HP)".
  // We therefore track both:
  //  - totalHealed: the attempted healing amount (including DoS bonus and overheal)
  //  - effectiveHealed: actual HP restored (capped by maxHP)
  const baseHeal = Number(healing || 0);
  const dosBonus = Number(options?.dosBonus ?? 0);
  const totalHealed = Math.max(0, baseHeal + dosBonus);
  if (totalHealed <= 0) return null;

  const newHP = Math.min(maxHP, currentHP + totalHealed);
  const effectiveHealed = newHP - currentHP;
  const overflow = Math.max(0, totalHealed - effectiveHealed);

  const activeToken = actor.token ?? actor.getActiveTokens?.()[0] ?? null;
  const isUnlinkedToken = !!(activeToken && actor.prototypeToken && actor.prototypeToken.actorLink === false);
  const updateTarget = isUnlinkedToken ? activeToken.actor : actor;

  // Only update HP when there is an actual HP delta.
  if (effectiveHealed !== 0) {
    await requestUpdateDocument(updateTarget, { "system.hp.value": newHP });
  }

  const rollHTML = String(options?.rollHTML ?? "");

  // Healing should not reveal current/max HP by default to avoid metagame information.
  // Set { revealHP: true } explicitly if a specific workflow needs it.
  const revealHP = options?.revealHP === true;
  
  // For magic healing workflow, skip chat message since it's already shown in the opposed card
  const skipChatMessage = options?.skipChatMessage === true;

  const messageContent = `
    <div class="uesrpg-healing-applied">
      <h3>${updateTarget.name} receives healing!</h3>
      ${rollHTML ? `<div class="dice-roll" style="margin:0.35rem 0;">${rollHTML}</div>` : ""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin:0.5rem 0;">
        <div><strong>Source:</strong></div><div>${source}</div>
        <div><strong>Healing:</strong></div><div style="color:#388e3c;font-weight:bold;">+${effectiveHealed}</div>
        ${revealHP ? `<div><strong>HP:</strong></div><div>${newHP} / ${maxHP}</div>` : ""}
      </div>
    </div>
  `;

  // Avoid chat spam when no HP is actually restored (but still dispatch the hook for Bleeding reduction).
  // Also skip chat message if requested (e.g., for magic healing where opposed card already shows result).
  if (effectiveHealed > 0 && !skipChatMessage) {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: updateTarget }),
      content: messageContent,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  }
  // Emit healing-applied hook for downstream automation (wounds treatment, etc.)
  try {
    const healingOrigin = normalizeActiveEffectOrigin(options?.origin);
    Hooks.callAll("uesrpgHealingApplied", updateTarget, {
      applicationId: options?.applicationId ?? crypto?.randomUUID?.() ?? foundry?.utils?.randomID?.() ?? null,
      origin: healingOrigin,
      source: options?.source ?? "Healing",
      // Backwards-compatible: keep amountApplied as the effective HP restored.
      amountApplied: effectiveHealed,
      // Canonical: total healing including overheal (used by Bleeding).
      totalHealed,
      effectiveHealed,
      overflow,
      oldHP: currentHP,
      newHP,
      maxHP,
    });
  } catch (err) {
    console.error("UESRPG | uesrpgHealingApplied hook dispatch failed", err);
  }


  return {
    actor: updateTarget,
    healing: effectiveHealed,
    oldHP: currentHP,
    newHP,
    totalHealed,
    overflow,
  };
}

/**
 * Grant temporary hit points to actor
 * Temp HP does NOT stack - always use the higher value (RAW)
 * @param {Actor} actor
 * @param {number} amount
 * @param {string} source
 * @param {object} options
 */
async function applyTemporaryHP(actor, amount, source = "Spell", options = {}) {
  _healingDebug("UESRPG | applyTemporaryHP CALLED", {
    actor: actor?.name,
    amount,
    source,
    currentTempHP: actor?.system?.tempHP ?? actor?.system?.hp?.temp ?? 0
  });

  if (!actor?.system) {
    console.error("UESRPG | applyTemporaryHP: Invalid actor");
    ui.notifications.error("Invalid actor for temporary HP");
    return null;
  }

  const grantAmount = Math.max(0, Number(amount || 0));
  if (grantAmount === 0) {
    console.warn("UESRPG | applyTemporaryHP: Grant amount is 0");
    return null;
  }

  // Check both possible locations for backwards compatibility
  const currentTempHP = Number(actor.system?.tempHP ?? actor.system?.hp?.temp ?? 0);

  _healingDebug(`UESRPG | applyTemporaryHP: Current temp HP: ${currentTempHP}, Grant amount: ${grantAmount}`);

  // RAW: Temp HP doesn't stack - take the higher value
  const newTempHP = Math.max(currentTempHP, grantAmount);
  const actualGranted = newTempHP - currentTempHP;

  _healingDebug(`UESRPG | applyTemporaryHP: New temp HP: ${newTempHP}, Actual granted: ${actualGranted}`);

  const activeToken = actor.token ?? actor.getActiveTokens?.()[0] ?? null;
  const isUnlinkedToken = !!(activeToken && actor.prototypeToken && actor.prototypeToken.actorLink === false);
  const updateTarget = isUnlinkedToken ? activeToken.actor : actor;

  _healingDebug(`UESRPG | applyTemporaryHP: Update target: ${updateTarget?.name}, isUnlinked: ${isUnlinkedToken}`);

  if (newTempHP !== currentTempHP) {
    try {
      _healingDebug(`UESRPG | applyTemporaryHP: Updating actor with temp HP: ${newTempHP}`);
      // Update both fields for backwards compatibility, but system.tempHP is canonical
      await requestUpdateDocument(updateTarget, { 
        "system.tempHP": newTempHP,
        "system.hp.temp": newTempHP 
      });
      _healingDebug("UESRPG | applyTemporaryHP: Actor updated successfully");
    } catch (err) {
      console.error("UESRPG | applyTemporaryHP: Actor update FAILED", err);
      return null;
    }
  } else {
    _healingDebug("UESRPG | applyTemporaryHP: No update needed, temp HP unchanged");
  }

  const rollHTML = String(options?.rollHTML ?? "");
  
  // For magic healing workflow, skip chat message since it's already shown in the opposed card
  const skipChatMessage = options?.skipChatMessage === true;

  // Chat message
  const content = `
    <div class="uesrpg-temp-hp-card">
      <h3>Temporary Hit Points</h3>
      ${rollHTML ? `<div class="dice-roll" style="margin:0.35rem 0;">${rollHTML}</div>` : ""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin:0.5rem 0;">
        <div><strong>Source:</strong></div><div>${source}</div>
        <div><strong>Temp HP:</strong></div><div style="color:#2196f3;font-weight:bold;">${actualGranted > 0 ? `+${grantAmount}` : `${currentTempHP} (already higher)`}</div>
        <div><strong>Total Temp HP:</strong></div><div><em>${newTempHP}</em></div>
      </div>
    </div>
  `;

  if (!skipChatMessage) {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: updateTarget }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  return { tempHP: newTempHP, granted: actualGranted, previous: currentTempHP };
}
