/**
 * src/core/combat/damage/resolver/resolve.js
 *
 * Main damage resolution orchestrator - canonical resolver for all damage application.
 *
 * Responsibilities:
 *  - Apply Active Effects damage & mitigation modifiers
 *  - Consume Power Attack effects
 *  - Apply talent damage modifiers (Sneak Attack, Assassinate, Unarmed Prowess)
 *  - Handle typed bonus damage (multi-component damage application)
 *  - Apply trait-based post-mitigation adjustments (Resist Normal Weapons, Silver-Scarred, etc.)
 *  - Handle Spell Absorption, Incorporeal blocks, Diseased trait
 *  - Trigger wounds & unconscious effects
 *  - Generate comprehensive GM damage reports
 *
 * CRITICAL: This is the single canonical damage resolution path. All logic, timing,
 * and side effects must be preserved exactly when refactoring.
 */

import { buildDamageContext } from "./context.js";
import { getAETwitterMods, collectTypedBonusDamage } from "./ae-mods.js";
import { asNumber } from "./normalize.js";
import { listArmorSourcesForLocation } from "./armor.js";
import { getFlagValueWithFallback } from "../../../system/flags.js";
import { getCoreRollMode } from "../../../../utils/chat-roll-mode.js";
import {
  calculateDamage,
  DAMAGE_TYPES,
  applyForcefulImpact,
  isItemMagicSource,
  itemHasToken,
} from "../../damage-automation.js";
import { applyTalentDamageModifiers, getEnemyWoundThresholdDelta } from "../../../traits/combat-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";
import {
  applyWeaponExpertiseDamageModifiers,
  applyWeaponExpertisePostDamageEffects,
  getWeaponExpertiseWTDelta,
  isWeaponExpertiseActive
} from "../../../traits/weapon-expertise/index.js";
import { recordAssassinStrikeAoOBlock } from "../../../traits/mobility-talents.js";
import { isActorIncorporeal, getActorTraitValue, hasActorTrait, isActorUndead } from "../../../traits/trait-registry.js";
import { postDiseasedCheckCard } from "../../../traits/trait-automation.js";
import { applyBleeding, applyCondition, hasCondition } from "../../../conditions/condition-engine.js";
import { getAttackModeFromWeapon } from "../../combat-utils.js";
import { getUnusualCombatDamageAdjustment } from "../../unusual-combat.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { collectStrikeEnchantmentEffects, consumeStrikeCharge } from "../../../enchanting/runtime/strike-runtime.js";
import { shouldTriggerWound } from "../../../wounds/wound-rules.js";
import { getRuntimeSystemId as _getSystemId } from "../../../system/namespace.js";
import { getEffectChanges, normalizeActiveEffectOrigin } from "../../../../utils/compat.js";
import {
  applyPostDamageUpdate,
  dispatchDamageAppliedHook,
  finalizeDamageTargetState,
  resolveDamageUpdateTarget
} from "../post-application.js";

const PENDING_SNEAK_TTL_MS = 30000;
const _isNpcActor = (actor) => String(actor?.type ?? "").trim().toLowerCase() === "npc";

async function _runEntanglingEscapeCheck({ attacker, defender } = {}) {
  if (!defender) return;

  const strTN = Math.max(0, Number(defender.system?.characteristics?.str?.total ?? 0) || 0);
  const agiTN = Math.max(0, Number(defender.system?.characteristics?.agi?.total ?? 0) || 0);
  if (strTN <= 0 && agiTN <= 0) return;

  const preferred = (agiTN > strTN) ? "agi" : "str";
  const choice = await customDialog({
    title: "Entangling",
    content: `
      <div class="uesrpg">
        <p><b>${foundry.utils.escapeHTML(defender.name ?? "Target")}</b> was hit by an Entangling attack.</p>
        <p>Choose STR or AGI to resist being entangled.</p>
      </div>
    `,
    buttons: {
      str: { label: `STR (${strTN})`, callback: () => "str" },
      agi: { label: `AGI (${agiTN})`, callback: () => "agi" },
      cancel: { label: "Skip", callback: () => null }
    },
    defaultButton: preferred
  });
  if (!choice) return;

  const useAgi = String(choice) === "agi";
  const chosenLabel = useAgi ? "AGI" : "STR";
  const targetTN = useAgi ? agiTN : strTN;

  const roll = await (new Roll("1d100")).evaluate();
  const rollTotal = Number(roll?.total ?? 100) || 100;
  const isSuccess = rollTotal <= targetTN;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: `Entangling Escape Check (${chosenLabel}) — ${isSuccess ? "Success" : "Failure"}`,
    rollMode: getCoreRollMode()
  });

  if (!isSuccess) {
    await applyCondition(defender, "entangled", {
      source: "entangling",
      attackerUuid: attacker?.uuid ?? null
    });
  }
}

async function _promptUntouchableLpSpend({ actor, availableLp, woundThreshold, damageApplied } = {}) {
  const a = actor;
  const max = Math.max(0, Number(availableLp ?? 0) || 0);
  if (!a || max <= 0) return 0;

  const title = "Untouchable \u2014 Spend Luck Points";
  const content = `
    <div class="uesrpg-untouchable-spend">
      <p><b>${foundry.utils.escapeHTML(a.name ?? "Actor")}</b> may spend Luck Points to increase Wound Threshold for this attack only.</p>
      <p style="opacity:0.85;"><b>Damage Applied:</b> ${Number(damageApplied || 0)} &nbsp;&nbsp; <b>Current WT:</b> ${Number(woundThreshold || 0)}</p>
      <div class="form-group" style="margin-top:8px;">
        <label><b>Luck Points to Spend</b> (0\u2013${max})</label>
        <input name="lp" type="number" min="0" max="${max}" value="0" style="width:100%;" />
      </div>
    </div>
  `;

  const result = await customDialog({
    title,
    content,
    buttons: {
      ok: {
        label: "Spend",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const raw = root?.querySelector('input[name="lp"]')?.value ?? "0";
          const n = Number.parseInt(String(raw), 10) || 0;
          return Math.clamp(n, 0, max);
        }
      },
      cancel: { label: "Spend 0", callback: () => 0 }
    },
    defaultButton: "ok",
  });
  return result ?? 0;
}

function _consumePendingSneakAttack(attackerActor, { weapon = null, attackMode = null } = {}) {
  try {
    if (!attackerActor || typeof attackerActor.getFlag !== "function") return false;
    const systemId = _getSystemId();
    const pending = attackerActor.getFlag(systemId, "combat.pendingSneakAttack");
    if (!pending || typeof pending !== "object") return false;

    const ageMs = Date.now() - Number(pending.at ?? 0);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PENDING_SNEAK_TTL_MS) {
      requestUpdateDocument(attackerActor, { [`flags.${systemId}.combat.-=pendingSneakAttack`]: null }).catch(() => {});
      return false;
    }

    const pendingWeapon = String(pending.weaponUuid ?? "").trim();
    const weaponUuid = String(weapon?.uuid ?? "").trim();
    if (pendingWeapon) {
      if (!weaponUuid || pendingWeapon !== weaponUuid) return false;
    }

    const pendingMode = String(pending.attackMode ?? "").trim().toLowerCase();
    const mode = String(attackMode ?? "").trim().toLowerCase();
    if (pendingMode) {
      if (!mode || pendingMode !== mode) return false;
    }

    requestUpdateDocument(attackerActor, { [`flags.${systemId}.combat.-=pendingSneakAttack`]: null }).catch(() => {});
    return true;
  } catch (_e) {
    return false;
  }
}

function _asInt(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.floor(n);
  const m = String(v ?? "").match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

function _maxTraitValue(actor, key) {
  return Math.max(0, Number(getActorTraitValue(actor, key, { mode: "max" })) || 0);
}

function _isNaturalWeaponSource(item) {
  if (!item) return false;
  return itemHasToken(item, "handToHand");
}

function _isSilverSource(item) {
  if (!item) return false;
  return itemHasToken(item, "silver") || itemHasToken(item, "silvered");
}

function _isSunlightSource(item) {
  if (!item) return false;
  return itemHasToken(item, "sunlight");
}

function _buildGmDamageReportPayload({
  targetActor,
  source,
  hitLocation,
  totalApplied,
  newHP,
  maxHP,
  currentHP,
  currentTempHP,
  newTempHP,
  tempHPAbsorbed,
  bufferAbsorbedDetail,
  traitNotes,
  woundTriggered,
  woundThreshold,
  results,
  attackerDealtEntries,
  attackerPenEntries,
  defenderTakenEntries,
  defenderMitEntries
} = {}) {
  const fmt = (n) => {
    const v = Number(n ?? 0) || 0;
    return v >= 0 ? `+${v}` : `${v}`;
  };
  const hpDelta = Math.max(0, (Number(currentHP ?? 0) || 0) - (Number(newHP ?? 0) || 0));
  const renderEntries = (entries, formatter = fmt) =>
    Array.isArray(entries)
      ? entries.map((entry) => ({
          label: String(entry?.label ?? "Effect"),
          value: formatter(Number(entry?.value ?? 0) || 0)
        }))
      : [];

  const segments = (Array.isArray(results) ? results : []).map((r) => {
    const reductionNotes = [];
    const red = r?.reductions ?? {};
    const ae = red?.ae ?? null;
    const armorBase = Number(red?.armor ?? 0) || 0;
    if (armorBase) {
      const armorSources = listArmorSourcesForLocation(targetActor, hitLocation);
      reductionNotes.push(armorSources.length
        ? `AR: ${armorSources.map((a) => `${a.name} (${a.ar})`).join(", ")}`
        : `AR: ${armorBase}`);
    }
    if (ae?.armorRating && ((ae.armorRating.global?.total ?? 0) || (ae.armorRating.location?.total ?? 0))) {
      const bits = [];
      if (ae.armorRating.global?.total) bits.push(`Global ${fmt(ae.armorRating.global.total)}`);
      if (ae.armorRating.location?.total) bits.push(`${ae.armorRating.location.key} ${fmt(ae.armorRating.location.total)}`);
      reductionNotes.push(`AR AE: ${bits.join(" | ")}`);
    }
    const resistanceBase = Number(red?.resistance ?? 0) || 0;
    if (r?.damageType && String(r.damageType) !== "physical" && resistanceBase) {
      reductionNotes.push(`R (base): ${resistanceBase}`);
    }
    if (ae?.resistance?.key && ae?.resistance?.total) {
      reductionNotes.push(`R AE (${ae.resistance.key}): ${fmt(ae.resistance.total)}`);
    }
    const toughnessBase = Number(targetActor?.system?.resistance?.natToughness ?? 0) || 0;
    if (toughnessBase) reductionNotes.push(`T (base natToughness): ${toughnessBase}`);
    if (ae?.natToughness?.total) reductionNotes.push(`T AE (natToughness): ${fmt(ae.natToughness.total)}`);

    const sourceNotes = [];
    if (r.kind === "primary") {
      const weaponName = String(source ?? "Weapon");
      sourceNotes.push(`Weapon: ${weaponName}`);
      if (r.dosBonus) sourceNotes.push(`DoS bonus: ${fmt(r.dosBonus)}`);
      if (r.weaponBonus) sourceNotes.push(`Weapon bonus: ${fmt(r.weaponBonus)} (${weaponName})`);
      sourceNotes.push(...renderEntries(attackerDealtEntries).map((e) => `AE dealt: ${e.label} ${e.value}`));
      sourceNotes.push(...renderEntries(attackerPenEntries).map((e) => `AE penetration: ${e.label} ${e.value}`));
      sourceNotes.push(...renderEntries(defenderTakenEntries).map((e) => `AE taken: ${e.label} ${e.value}`));
      sourceNotes.push(...renderEntries(defenderMitEntries, (n) => `${Math.min(0, -Math.abs(n))}`).map((e) => `AE mitigation: ${e.label} ${e.value}`));
    } else if (r.kind === "sneak") {
      sourceNotes.push("Talent: Sneak Attack");
      for (const note of (Array.isArray(r.breakdown?.talentNotes) ? r.breakdown.talentNotes : [])) sourceNotes.push(String(note));
      if (r.ignoreArmorOnly) sourceNotes.push("Assassinate: AR ignored for bonus");
    } else if (r.kind === "external") {
      sourceNotes.push(`Source: ${String(r.sourceLabel ?? "Attack")}`);
    } else {
      const typedEntries = Array.isArray(r.breakdown?.entries)
        ? r.breakdown.entries
        : (Array.isArray(r.breakdown?.attackerTyped) ? r.breakdown.attackerTyped : []);
      sourceNotes.push(...renderEntries(typedEntries).map((e) => `AE bonus [${String(r.damageType ?? "physical")}]: ${e.label} ${e.value}`));
    }
    if (r.incorporealBlock?.isBlocked) sourceNotes.push("Trait: Incorporeal (non-magic source)");
    if (r.incorporealAttack?.ignoreNonMagicArmor) sourceNotes.push("Trait: Incorporeal Attack (non-magic AR ignored)");

    return {
      damageType: String(r?.damageType ?? "physical"),
      rawDamage: Number(r?.rawDamage ?? 0) || 0,
      reductionTotal: Number(r?.reductions?.total ?? 0) || 0,
      applied: Number(r?.finalApplied ?? 0) || 0,
      sourceNotes,
      reductionNotes
    };
  });

  return {
    panelKey: `gm-damage:${String(targetActor?.uuid ?? targetActor?.id ?? "target")}:${Date.now()}`,
    title: String(targetActor?.name ?? "Target"),
    source: String(source ?? "Attack"),
    hitLocation: String(hitLocation ?? "Body"),
    totalDamage: Math.max(0, Number(totalApplied ?? 0) || 0),
    hp: { value: Number(newHP ?? 0) || 0, max: Number(maxHP ?? 0) || 0, delta: hpDelta },
    tempHp: (tempHPAbsorbed > 0 || currentTempHP > 0)
      ? { value: Number(newTempHP ?? 0) || 0, absorbed: Number(tempHPAbsorbed ?? 0) || 0 }
      : null,
    buffers: Array.isArray(bufferAbsorbedDetail)
      ? bufferAbsorbedDetail.map((b) => ({
          pool: String(b?.pool ?? ""),
          remaining: Number(b?.remaining ?? 0) || 0,
          absorbed: Number(b?.absorbed ?? 0) || 0
        }))
      : [],
    traitNotes: Array.isArray(traitNotes) ? traitNotes.map((note) => String(note ?? "")) : [],
    woundTriggered: woundTriggered === true,
    woundThreshold: Number(woundThreshold ?? 0) || 0,
    defeated: Number(newHP ?? 0) === 0,
    segments
  };
}

/**
 * Canonical resolver: applies damage with deterministic option shaping and AE modifiers.
 *
 * @param {Actor} targetActor
 * @param {object} payload - see buildDamageContext()
 * @returns {Promise<object|null>} Damage engine result (applyDamage return value)
 */
export async function applyDamageResolved(targetActor, payload = {}) {
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for damage application.");
    return null;
  }

  const ctx = buildDamageContext(payload);
  // Unique identifier for this damage application (used for wound/shock idempotency).
  const applicationId = String(ctx.options?.applicationId ?? "").trim() || foundry.utils.randomID();
  ctx.options.applicationId = applicationId;

  // --- Active Effects: damage & mitigation modifiers (resolver boundary) ---
  const attackerActor = ctx.options?.attackerActor ?? null;
  const mods = getAETwitterMods(attackerActor, targetActor);
  const powerAttackEffect = attackerActor?.effects?.find((e) =>
    !e.disabled && getFlagValueWithFallback(e, "key") === "stamina-power-attack"
  ) ?? null;
  let powerAttackAppliedBonus = 0;
  let powerAttackFromAe = 0;
  let attackerAeEntries = Array.isArray(mods?.attacker?.entries) ? mods.attacker.entries : [];

  if (powerAttackEffect?.id) {
    const powerEffectId = String(powerAttackEffect.id);
    powerAttackFromAe = attackerAeEntries
      .filter((e) =>
        String(e?.target ?? "") === "damage.dealt" &&
        String(e?.effectId ?? "") === powerEffectId
      )
      .reduce((sum, e) => sum + (Number(e?.value ?? 0) || 0), 0);

    // Keep generic AE reporting clean; Power Attack is audited separately.
    attackerAeEntries = attackerAeEntries.filter((e) =>
      !(String(e?.target ?? "") === "damage.dealt" && String(e?.effectId ?? "") === powerEffectId)
    );
  }

  const attackerDamageDealtTotal = asNumber(mods?.attacker?.damageDealt);
  const attackerDamageDealtExcludingPowerAttack = attackerDamageDealtTotal - powerAttackFromAe;

  // --- Resolve and consume Power Attack effect (one-time, activation-driven stamina action) ---
  if (powerAttackEffect) {
    try {
      const fromFlag = Number(getFlagValueWithFallback(powerAttackEffect, "damageBonus") ?? 0);
      const fromChange = getEffectChanges(powerAttackEffect)
        .filter((ch) => String(ch?.key ?? "") === "system.modifiers.combat.damage.dealt")
        .reduce((sum, ch) => sum + (Number(ch?.value ?? 0) || 0), 0);
      if (Number.isFinite(fromFlag) && fromFlag !== 0) powerAttackAppliedBonus = fromFlag;
      else if (Number.isFinite(fromChange) && fromChange !== 0) powerAttackAppliedBonus = fromChange;
      else powerAttackAppliedBonus = powerAttackFromAe;
      const paParent = powerAttackEffect.parent;
      if (paParent?.isOwner) {
        await powerAttackEffect.delete();
      } else if (paParent) {
        await requestDeleteEmbeddedDocuments(paParent, "ActiveEffect", [powerAttackEffect.id]);
      }
    } catch (err) {
      console.warn("UESRPG | Failed to consume Power Attack effect:", err);
    }
  }

  // Apply attacker-side bonuses BEFORE mitigation.
  // Power Attack is applied explicitly once to avoid double counting when AE and consumption both run.
  const attackerDamageDealtApplied = attackerDamageDealtExcludingPowerAttack + powerAttackAppliedBonus;
  ctx.rawDamage = Math.max(0, ctx.rawDamage + attackerDamageDealtApplied);
  ctx.options.penetration = Math.max(0, asNumber(ctx.options.penetration) + asNumber(mods?.attacker?.penetration));

  // Pass defender-side adjustments into the final resolution stage
  ctx.options.aeDamageTaken = asNumber(mods?.defender?.damageTaken);
  ctx.options.aeMitigationFlat = Math.max(0, asNumber(mods?.defender?.mitigationFlat));

  // Attach provenance for downstream chat cards / debugging (non-authoritative).
  ctx.options.aeBreakdown = {
    attacker: attackerAeEntries,
    defender: mods?.defender?.entries ?? [],
  };

  // --- Talent-derived damage modifiers (Sneak Attack / Assassinate / Unarmed Prowess) ---
  const weaponItem = ctx.options?.weapon ?? null;
  const weaponCtx = (weaponItem && weaponItem.type === "weapon") ? weaponItem : null;
  const attackMode = ctx.options?.attackMode || (weaponCtx ? getAttackModeFromWeapon(weaponCtx) : null);
  ctx.options.attackMode = attackMode || null;

  if (attackerActor) {
    const pendingHidden = _consumePendingSneakAttack(attackerActor, { weapon: weaponCtx, attackMode });
    if (pendingHidden) ctx.options.attackFromHidden = true;
  }

  // Unarmed Prowess: add STR bonus to hand-to-hand damage.
  if (weaponCtx && attackerActor && itemHasToken(weaponCtx, "handToHand") && hasTalent(attackerActor, "unarmedprowess")) {
    const dmgFormula = String(weaponCtx.system?.damageEffective ?? weaponCtx.system?.damage ?? "").toLowerCase();
    const hasStrInFormula = dmgFormula.includes("@str") || /\bstr\b/.test(dmgFormula) || /\bstrength\b/.test(dmgFormula) || /\bsb\b/.test(dmgFormula);
    if (!hasStrInFormula) {
      const sb = Number(attackerActor.system?.characteristics?.str?.bonus ?? 0) || 0;
      if (sb > 0) ctx.rawDamage = Math.max(0, Number(ctx.rawDamage || 0) + sb);
    }
  }

  const talentContext = {
    attackFromHidden: ctx.options?.attackFromHidden,
    talentDamageBonus: 0,
    talentNotes: [],
    sneakIgnoreArmorOnly: false,
    _isSneakAttack: false
  };

  // NOTE: traitNotes is declared early so weapon expertise notes can append to it
  // even when there is no talent damage bonus (informational-only paths).
  const traitNotes = [];

  if (weaponCtx && attackerActor) {
    applyTalentDamageModifiers({
      attacker: attackerActor,
      target: targetActor,
      attackerToken: null,
      weapon: weaponCtx,
      damageContext: talentContext
    });
  }
  // Weapon Expertise damage modifiers (Bruiser, Dart Thrower, Executioner, Pugilist, etc.)
  if (weaponCtx && attackerActor) {
    applyWeaponExpertiseDamageModifiers({
      attacker: attackerActor,
      target: targetActor,
      weapon: weaponCtx,
      damageContext: talentContext,
      attackData: {
        variant: ctx.options?.variant ?? "",
        isAllOutAttack: ctx.options?.isAllOutAttack ?? false,
        isPenetrateArmor: ctx.options?.isPenetrateArmor ?? false,
        hitLocation: ctx.options?.hitLocation ?? null
      }
    });
  }

  // --- Typed bonus damage (single application workflow)
  // We must support additional damage types in ONE damage application click.
  // Policy:
  //  - Primary instance receives defender-side AE taken/mitigation adjustments.
  //  - Typed bonus instances receive their own reductions (resistance/toughness) but do NOT re-apply
  //    defender AE taken/mitigation adjustments (avoids double-counting per attack).
  //  - All instances are applied in one HP update and reported in one chat card.

  const components = [];
  const explicitComponents = Array.isArray(ctx.components) ? ctx.components : [];
  if (explicitComponents.length) {
    for (let i = 0; i < explicitComponents.length; i++) {
      const c = explicitComponents[i];
      components.push({
        kind: i === 0 ? "primary" : "external",
        amount: Math.max(0, Number(c.amount ?? 0) || 0),
        damageType: String(c.damageType ?? ctx.damageType ?? DAMAGE_TYPES.PHYSICAL).toLowerCase(),
        applyDefenderAdjust: i === 0,
        sourceLabel: c.sourceLabel ?? c.source ?? ctx.options.source ?? "Attack",
        breakdown: (i === 0)
          ? {
              attacker: ctx.options?.aeBreakdown?.attacker ?? [],
              defender: ctx.options?.aeBreakdown?.defender ?? [],
            }
          : {},
      });
    }
  } else {
    // Primary component
    components.push({
      kind: "primary",
      amount: Math.max(0, ctx.rawDamage),
      damageType: ctx.damageType,
      applyDefenderAdjust: true,
      sourceLabel: ctx.options.source ?? "Attack",
      breakdown: {
        attacker: ctx.options?.aeBreakdown?.attacker ?? [],
        defender: ctx.options?.aeBreakdown?.defender ?? [],
      },
    });
  }

  // Talent bonus damage component (Sneak Attack, Weapon Expertise, etc.)
  const talentBonus = Math.max(0, Number(talentContext?.talentDamageBonus ?? 0));
  if (talentBonus > 0) {
    const isSneakAttack = Boolean(talentContext?._isSneakAttack);
    const sourceTag = isSneakAttack ? "Sneak Attack" : "Talent Bonus";
    components.push({
      kind: "sneak",
      amount: talentBonus,
      damageType: ctx.damageType,
      applyDefenderAdjust: false,
      ignoreArmorOnly: talentContext?.sneakIgnoreArmorOnly === true,
      sourceLabel: `${ctx.options.source ?? "Attack"} - ${sourceTag}`,
      breakdown: {
        talentNotes: Array.isArray(talentContext?.talentNotes) ? talentContext.talentNotes : [],
      },
    });
  } else if (Array.isArray(talentContext?.talentNotes) && talentContext.talentNotes.length > 0) {
    // Weapon Expertise notes without bonus damage — surface them in traitNotes.
    for (const note of talentContext.talentNotes) {
      traitNotes.push(note);
    }
  }

  // Typed bonus components
  const typedBonusDamage = (attackerActor ? collectTypedBonusDamage(attackerActor) : null);
  if (typedBonusDamage?.byType) {
    for (const [dtype, t] of Object.entries(typedBonusDamage.byType)) {
      const amt = Number(t?.total ?? 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      components.push({
        kind: "typed",
        amount: Math.max(0, amt),
        damageType: ctx.damageType,
        applyDefenderAdjust: false,
        sourceLabel: `${ctx.options.source ?? "Attack"} - AE Bonus [${dtype}]`,
        breakdown: {
          attackerTyped: t.entries ?? [],
        },
      });
    }
  }

  // Strike enchantment damage components (fire, frost, shock on-hit effects).
  // Only fires when weapon has a valid strike enchantment and sufficient charge.
  const strikeEnchantComponents = weaponCtx
    ? collectStrikeEnchantmentEffects(weaponCtx, attackerActor)
    : { damageComponents: [], sideEffects: [], chargeConsumptionNeeded: false };
  for (const sc of strikeEnchantComponents.damageComponents) {
    components.push(sc);
  }

  const unusualDamageAdjustment = getUnusualCombatDamageAdjustment({
    attacker: attackerActor,
    movementAction: ctx.options?.movementAction ?? null,
  });
  if (unusualDamageAdjustment) {
    for (const component of components) {
      component.amount = unusualDamageAdjustment.apply(component.amount);
    }
    traitNotes.push(unusualDamageAdjustment.label);
  }

  // Compute per-component results and apply once.
  const hitLocation = ctx.options.hitLocation ?? "Body";
  const currentHP = Number(targetActor.system?.hp?.value ?? 0);
  const maxHP = Number(targetActor.system?.hp?.max ?? 1);
  const currentTempHP = Number(targetActor.system?.tempHP ?? 0);

  const baseWoundThreshold = (() => {
    const wt = targetActor.system?.wound_threshold;
    if (wt && typeof wt === "object") {
      const v = Number(wt.value ?? wt.total ?? wt.base);
      return Number.isFinite(v) ? v : 0;
    }
    const v = Number(targetActor.system?.woundThreshold ?? targetActor.system?.wounds ?? 0);
    return Number.isFinite(v) ? v : 0;
  })();

  const updateTarget = resolveDamageUpdateTarget(targetActor);

  let woundThreshold = baseWoundThreshold;
  let woundThresholdDelta = 0;
  if (weaponCtx && attackerActor) {
    const mode = String(attackMode ?? "").toLowerCase().trim();
    if (mode === "melee" || mode === "ranged") {
      const delta = getEnemyWoundThresholdDelta({ attacker: attackerActor, attackMode: mode });
      if (Number.isFinite(delta) && delta !== 0) {
        woundThresholdDelta = delta;
        woundThreshold = Math.max(0, Number(baseWoundThreshold || 0) + Number(delta));
      }
    }

    // Weapon Expertise WT modifiers (Monster Hunter: pike → WT -1).
    const weDelta = getWeaponExpertiseWTDelta({ attacker: attackerActor, weapon: weaponCtx, attackMode: mode });
    if (Number.isFinite(weDelta) && weDelta !== 0) {
      woundThresholdDelta += weDelta;
      woundThreshold = Math.max(0, woundThreshold + weDelta);
    }
  }

  const defenderIncorporeal = isActorIncorporeal(updateTarget);
  const sourceItem = ctx.options?.weapon ?? null;
  const ammoItem = ctx.options?.ammo ?? null;
  const attackIsMagic = ctx.options.magicSource === true || isItemMagicSource(sourceItem) || isItemMagicSource(ammoItem);
  const isSilverSource = _isSilverSource(sourceItem) || _isSilverSource(ammoItem);
  const isSunlightSource = _isSunlightSource(sourceItem);
  const incorporealBlock = defenderIncorporeal && !attackIsMagic;

  /** @type {Array<any>} */
  const results = [];
  let totalApplied = 0;
  let woundTriggered = false;
  if (woundThresholdDelta && attackerActor) {
    if (hasTalent(attackerActor, "cripplingstrikes")) {
      traitNotes.push("Crippling Strikes: WT -1");
    } else if (hasTalent(attackerActor, "eyeofvengeance")) {
      traitNotes.push("Eye of Vengeance: WT -1");
    } else if (hasTalent(attackerActor, "monsterhunter") && weaponCtx && isWeaponExpertiseActive(attackerActor, weaponCtx, "monsterhunter")) {
      traitNotes.push("Monster Hunter: WT -1 (pike)");
    } else {
      traitNotes.push(`Wound Threshold: ${woundThresholdDelta}`);
    }
  }

  // Spell Absorption (X): negate magic-typed bonus damage and restore MP.
  const spellAbsorptionValue = _maxTraitValue(updateTarget, "spellAbsorption");
  let spellAbsorptionRestored = 0;
  if (spellAbsorptionValue > 0) {
    const typedTotal = components
      .filter(c => c.kind === "typed" && Number(c.amount ?? 0) > 0)
      .reduce((s, c) => s + Number(c.amount ?? 0), 0);

    if (typedTotal > 0) {
      const roll = new Roll("1d10");
      await roll.evaluate();
      const rollTotal = Number(roll.total ?? 0) || 0;
      const absorbed = rollTotal <= spellAbsorptionValue;

      if (absorbed) {
        for (const c of components) {
          if (c.kind === "typed") {
            c.amount = 0;
            c.spellAbsorbed = true;
          }
        }

        const currentMP = Number(updateTarget.system?.magicka?.value ?? 0);
        const maxMP = Number(updateTarget.system?.magicka?.max ?? 0);
        const missingMP = Math.max(0, maxMP - currentMP);
        const restoreCap = Math.max(0, _asInt(typedTotal));
        spellAbsorptionRestored = Math.min(missingMP, restoreCap);
      }

      traitNotes.push(`Spell Absorption (${spellAbsorptionValue}): Roll ${rollTotal} (${absorbed ? "absorbed" : "failed"})`);
      if (spellAbsorptionRestored > 0) {
        traitNotes.push(`Spell Absorption: +${spellAbsorptionRestored} MP`);
      }
    }
  }

  for (const c of components) {
    const isPrimary = c.kind === "primary";
    const componentIgnoreArmor = isPrimary ? (ctx.options?.ignoreArmor === true) : (c.ignoreArmor === true);
    const componentIgnoreArmorOnly = c.ignoreArmorOnly === true;

    const calc = ctx.options?.ignoreReduction === true
      ? {
          rawDamage: Number(c.amount || 0),
          dosBonus: isPrimary ? Number(ctx.options?.dosBonus || 0) : 0,
          totalDamage: Math.max(0, Number(c.amount || 0) + (isPrimary ? Number(ctx.options?.dosBonus || 0) : 0)),
          reductions: { armor: 0, resistance: 0, toughness: 0, total: 0, penetrated: 0 },
          finalDamage: Math.max(0, Number(c.amount || 0) + (isPrimary ? Number(ctx.options?.dosBonus || 0) : 0)),
          hitLocation,
          damageType: c.damageType,
          weaponBonus: 0,
        }
      : calculateDamage(Number(c.amount || 0), c.damageType, updateTarget, {
          penetration: isPrimary ? Number(ctx.options?.penetration || 0) : 0,
          dosBonus: isPrimary ? Number(ctx.options?.dosBonus || 0) : 0,
          hitLocation,
          penetrateArmorForTriggers: isPrimary ? (ctx.options?.penetrateArmorForTriggers === true) : false,
          weapon: isPrimary ? (ctx.options?.weapon ?? null) : null,
          attackerActor: isPrimary ? (ctx.options?.attackerActor ?? null) : null,
          ammo: isPrimary ? (ctx.options?.ammo ?? null) : null,
          ignoreArmor: componentIgnoreArmor,
          ignoreArmorOnly: componentIgnoreArmorOnly,
        });

    let baseFinal = Number(calc.finalDamage || 0);
    if (incorporealBlock) baseFinal = 0;

    const adjusted = incorporealBlock
      ? 0
      : c.applyDefenderAdjust
        ? Math.max(0, baseFinal + asNumber(ctx.options?.aeDamageTaken) - asNumber(ctx.options?.aeMitigationFlat))
        : Math.max(0, baseFinal);

    totalApplied += adjusted;

    results.push({
      kind: c.kind,
      sourceLabel: c.sourceLabel,
      damageType: c.damageType,
      hitLocation,
      rawDamage: Number(calc.rawDamage ?? c.amount ?? 0),
      dosBonus: Number(calc.dosBonus ?? 0),
      weaponBonus: Number(calc.weaponBonus ?? 0),
      reductions: calc.reductions,
      finalDamage: baseFinal,
      finalApplied: adjusted,
      spellAbsorbed: c.spellAbsorbed === true,
      ignoreArmorOnly: c.ignoreArmorOnly === true,
      incorporealBlock: incorporealBlock ? { isBlocked: true, reason: "non-magic source" } : null,
      incorporealAttack: calc.incorporealAttack ?? null,
      breakdown: c.breakdown ?? null,
    });
  }

  // Trait-based post-mitigation adjustments (after reductions and AE adjustments).
  if (totalApplied > 0) {
    // Chapter 4 X-traits: highest value wins when duplicated.
    const resistNormal = _maxTraitValue(updateTarget, "resistNormalWeapons");
    const silverScarred = _maxTraitValue(updateTarget, "silverScarred");
    const sunScarred = _maxTraitValue(updateTarget, "sunScarred");

    let delta = 0;

    if (!attackIsMagic && resistNormal > 0) {
      const reduction = Math.min(resistNormal, totalApplied);
      if (reduction > 0) {
        delta -= reduction;
        traitNotes.push(`Resist Normal Weapons (${resistNormal}): -${reduction}`);
      }
    }

    if (isSilverSource && silverScarred > 0) {
      delta += silverScarred;
      traitNotes.push(`Silver-Scarred (${silverScarred}): +${silverScarred}`);
    }

    if (isSunlightSource && sunScarred > 0) {
      delta += sunScarred;
      traitNotes.push(`Sun-Scarred (${sunScarred}): +${sunScarred}`);
    }

    if (delta !== 0) {
      totalApplied = Math.max(0, totalApplied + delta);

      // Apply delta to the primary component first, then spill to others if needed.
      let remaining = delta;
      for (const r of results) {
        if (remaining === 0) break;
        const applied = Number(r.finalApplied ?? 0);
        if (remaining > 0) {
          r.finalApplied = applied + remaining;
          remaining = 0;
        } else {
          const reduceBy = Math.min(applied, Math.abs(remaining));
          r.finalApplied = applied - reduceBy;
          remaining += reduceBy;
        }
      }
    }
  }

  // Cutthroat: apply Bleeding after post-mitigation damage when applicable.
  if (totalApplied > 0 && attackerActor && weaponCtx && hasTalent(attackerActor, "cutthroat")) {
    let bleedAdd = 0;
    const sneakApplied = Number(results.find(r => r.kind === "sneak")?.finalApplied ?? 0) || 0;
    if (sneakApplied > 0) bleedAdd += 1;

    const hasSmall = itemHasToken(weaponCtx, "small");
    if (hasSmall && hasCondition(updateTarget, "bleeding")) bleedAdd += 1;

    if (bleedAdd > 0) {
      try {
        await applyBleeding(updateTarget, bleedAdd, { origin: ctx.options?.origin ?? null, source: "Cutthroat" });
      } catch (err) {
        console.warn("UESRPG | Cutthroat bleeding application failed", err);
      }
    }
  }
  if (powerAttackAppliedBonus !== 0) {
    traitNotes.push(`Power Attack: +${powerAttackAppliedBonus} damage`);
  }

  // Assassin Strike (Chapter 4): if damage is inflicted (after mitigation), the target cannot make an AoO
  // against the attacker during that Turn.
  if (totalApplied > 0 && attackerActor && hasTalent(attackerActor, "assassinstrike")) {
    try {
      const combat = (game.combat && game.combat.started) ? game.combat : null;
      await recordAssassinStrikeAoOBlock(updateTarget, {
        attackerUuid: attackerActor.uuid,
        combatId: combat?.id ?? null,
        round: Number(combat?.round ?? 0) || 0,
        turn: Number(combat?.turn ?? 0) || 0
      });
      traitNotes.push("Assassin Strike: Target cannot AoO attacker this turn");
    } catch (err) {
      console.warn("UESRPG | Assassin Strike AoO block record failed", err);
    }
  }

  // Untouchable (Chapter 4): after being hit, the defender may spend LP to increase WT for this attack only.
  let untouchableSpentLp = 0;
  let untouchableCurrentLp = 0;
  if (totalApplied > 0 && hasTalent(updateTarget, "untouchable") && woundThreshold > 0 && totalApplied > woundThreshold) {
    try {
      untouchableCurrentLp = Math.max(0, Number(updateTarget.system?.luck_points?.value ?? 0) || 0);
      const canPrompt = Boolean(game.user?.isGM) || Boolean(updateTarget?.isOwner);
      if (canPrompt && untouchableCurrentLp > 0) {
        untouchableSpentLp = await _promptUntouchableLpSpend({
          actor: updateTarget,
          availableLp: untouchableCurrentLp,
          woundThreshold,
          damageApplied: totalApplied
        });

        if (untouchableSpentLp > 0) {
          woundThreshold += untouchableSpentLp;
          traitNotes.push(`Untouchable: +${untouchableSpentLp} WT (spent ${untouchableSpentLp} LP)`);
        }
      } else if (untouchableCurrentLp > 0) {
        traitNotes.push("Untouchable: LP spend requires owner/GM");
      }
    } catch (err) {
      console.warn("UESRPG | Untouchable LP spend prompt failed", err);
    }
  }


  // Canonical wound trigger routing is resolved after final HP is applied.

  // Provide per-damage-type totals for wound shock follow-ups (e.g. fire vs shock effects).
  const damageAppliedByType = results.reduce((acc, r) => {
    const k = String(r?.damageType ?? "").toLowerCase() || "physical";
    const v = Number(r?.finalApplied ?? 0) || 0;
    if (v > 0) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});


  // Damage mitigation order: Buffer → Temp HP → regular HP
  let remainingDamage = Math.max(0, totalApplied);

  // Typed buffer absorption (Physical / Magical / Elemental buffers).
  // Maps damage types to the appropriate buffer pool.
  const buffers = {
    physical: Math.max(0, Number(targetActor.system?.buffers?.physical ?? 0)),
    magical: Math.max(0, Number(targetActor.system?.buffers?.magical ?? 0)),
    elemental: Math.max(0, Number(targetActor.system?.buffers?.elemental ?? 0)),
  };
  const newBuffers = { ...buffers };
  let bufferAbsorbed = 0;
  let bufferAbsorbedDetail = [];

  if (remainingDamage > 0 && (buffers.physical > 0 || buffers.magical > 0 || buffers.elemental > 0)) {
    // Determine which buffer pool(s) to drain based on damage type composition.
    // Physical: physical, silver, sunlight
    // Magical: magic
    // Elemental: fire, frost, shock, poison
    const _bufferMap = {
      physical: "physical", silver: "physical", sunlight: "physical",
      magic: "magical",
      fire: "elemental", frost: "elemental", shock: "elemental", poison: "elemental",
    };

    // Walk through damage-by-type and absorb from matching buffer.
    for (const [dType, dAmount] of Object.entries(damageAppliedByType)) {
      if (remainingDamage <= 0) break;
      const bufferKey = _bufferMap[dType.toLowerCase()] ?? null;
      if (!bufferKey || newBuffers[bufferKey] <= 0) continue;

      const absorbable = Math.min(newBuffers[bufferKey], dAmount, remainingDamage);
      if (absorbable <= 0) continue;

      newBuffers[bufferKey] -= absorbable;
      remainingDamage -= absorbable;
      bufferAbsorbed += absorbable;
      bufferAbsorbedDetail.push({ pool: bufferKey, absorbed: absorbable, remaining: newBuffers[bufferKey] });
    }
  }

  let newTempHP = currentTempHP;
  let tempHPAbsorbed = 0;

  if (currentTempHP > 0 && remainingDamage > 0) {
    tempHPAbsorbed = Math.min(currentTempHP, remainingDamage);
    newTempHP = currentTempHP - tempHPAbsorbed;
    remainingDamage -= tempHPAbsorbed;
  }

  const newHP = Math.max(0, Number(currentHP) - remainingDamage);

  const extraUpdates = {};
  if (bufferAbsorbed > 0) {
    extraUpdates["system.buffers.physical"] = newBuffers.physical;
    extraUpdates["system.buffers.magical"] = newBuffers.magical;
    extraUpdates["system.buffers.elemental"] = newBuffers.elemental;
  }
  if (untouchableSpentLp > 0) {
    const nextLp = Math.max(0, untouchableCurrentLp - untouchableSpentLp);
    extraUpdates["system.luck_points.value"] = nextLp;
  }
  if (spellAbsorptionRestored > 0) {
    const currentMP = Number(updateTarget.system?.magicka?.value ?? 0);
    const maxMP = Number(updateTarget.system?.magicka?.max ?? 0);
    const nextMP = Math.min(maxMP, currentMP + spellAbsorptionRestored);
    extraUpdates["system.magicka.value"] = nextMP;
  }
  await applyPostDamageUpdate(targetActor, { newHP, newTempHP, extraUpdates });

  const woundEval = shouldTriggerWound({
    damageApplied: Math.max(0, totalApplied),
    woundThreshold,
    isCriticalSuccess: Boolean(ctx.options?.criticalSuccess ?? ctx.options?.isCritical ?? false),
    newHp: newHP
  });
  woundTriggered = woundEval.triggered === true;

  // Emit canonical damage-applied hook for downstream automation (e.g. Chapter 5 wounds/shock).
  const damageOrigin = normalizeActiveEffectOrigin(ctx.options?.origin)
    ?? normalizeActiveEffectOrigin(ctx.options?.weapon?.uuid)
    ?? null;
  dispatchDamageAppliedHook(updateTarget, {
    applicationId,
    woundTriggered,
    woundMode: woundEval.mode,
    woundTriggerReason: woundEval.reason,
    criticalSuccess: Boolean(ctx.options?.criticalSuccess ?? ctx.options?.isCritical ?? false),
    woundThreshold,
    amountApplied: Math.max(0, totalApplied),
    damageAppliedByType,
    hitLocation,
    source: ctx.options?.source ?? "Attack",
    weapon: ctx.options?.weapon ?? null,
    ammo: ctx.options?.ammo ?? null,
    origin: damageOrigin,
    chatContext: foundry.utils.deepClone(ctx.options?.chatContext ?? null),
    strikeEnchantmentSideEffects: strikeEnchantComponents.sideEffects ?? [],
  }, {
    logPrefix: "UESRPG | uesrpgDamageApplied hook failed",
    logLevel: "warn"
  });

  // Consume strike enchantment charge AFTER damage is applied and hooks have fired.
  if (strikeEnchantComponents.chargeConsumptionNeeded && weaponCtx) {
    try {
      await consumeStrikeCharge(weaponCtx);
    } catch (err) {
      console.warn("UESRPG | Strike enchantment charge consume failed", err);
    }
  }

  // Diseased (X): natural weapon damage > 0 triggers Endurance test.
  try {
    const diseasedValue = getActorTraitValue(attackerActor, "diseased", { mode: "sum" });
    const hasDiseased = Number(diseasedValue || 0) !== 0;
    if (hasDiseased && totalApplied > 0 && _isNaturalWeaponSource(sourceItem) && !hasActorTrait(updateTarget, "diseased") && !isActorUndead(updateTarget)) {
      await postDiseasedCheckCard({
        attacker: attackerActor,
        defender: updateTarget,
        traitValue: Number(diseasedValue || 0),
        sourceItem
      });
    }
  } catch (err) {
    console.warn("UESRPG | Diseased trait automation failed", err);
  }

  if (ctx.options?.forcefulImpact && String(ctx.damageType ?? "").toLowerCase() === DAMAGE_TYPES.PHYSICAL) {
    const primaryApplied = results.find(r => r.kind === "primary")?.finalApplied ?? 0;
    if (primaryApplied > 0) {
      try {
        await applyForcefulImpact(updateTarget, hitLocation);
      } catch (err) {
        console.warn("UESRPG | Forceful Impact armor update failed", err);
      }
    }
  }

  // Weapon Expertise post-damage effects (Bleeding, SP loss notes, move options).
  if (weaponCtx && attackerActor && updateTarget) {
    try {
      const wePostResult = await applyWeaponExpertisePostDamageEffects({
        attacker: attackerActor,
        target: updateTarget,
        weapon: weaponCtx,
        damageContext: talentContext,
        damageApplied: Math.max(0, totalApplied),
        woundTriggered
      });
      if (wePostResult?.notes?.length) {
        for (const note of wePostResult.notes) {
          traitNotes.push(note);
        }
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise post-damage effects failed", err);
    }
  }

  await finalizeDamageTargetState(updateTarget, { newHP });

  // Entangling (Chapter 7): on hit, target makes STR or AGI test; failure applies Entangled.
  try {
    if (weaponCtx && itemHasToken(weaponCtx, "entangling")) {
      await _runEntanglingEscapeCheck({ attacker: attackerActor, defender: updateTarget });
    }
  } catch (err) {
    console.warn("UESRPG | Entangling automation failed", err);
  }

  // Consolidated GM-only damage report
  const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
  const hpDelta = Math.max(0, currentHP - newHP);

  const fmt = (n) => {
    const v = Number(n ?? 0) || 0;
    return v >= 0 ? `+${v}` : `${v}`;
  };

  const summarizeAEs = (entries, target) => {
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(e => e?.target === target)
      .map(e => {
        const value = Number(e?.value ?? 0) || 0;
        if (!value) return null;
        return { label: String(e?.label ?? "Effect"), value };
      })
      .filter(Boolean);
  };

  const attackerDealtEntries = summarizeAEs(ctx.options?.aeBreakdown?.attacker, "damage.dealt");
  const attackerPenEntries = summarizeAEs(ctx.options?.aeBreakdown?.attacker, "penetration");
  const defenderTakenEntries = summarizeAEs(ctx.options?.aeBreakdown?.defender, "damage.taken");
  const defenderMitEntries = summarizeAEs(ctx.options?.aeBreakdown?.defender, "mitigation.flat");

  const renderEntryLines = (title, entries, signFmt = fmt) => {
    if (!Array.isArray(entries) || !entries.length) return "";
    const lines = entries.map(e => `<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${title}: ${e.label} ${signFmt(e.value)}</span></div>`);
    return lines.join("");
  };

  const renderReductionProvenance = (r) => {
    const red = r?.reductions ?? {};
    const ae = red?.ae ?? null;

    const lines = [];

    // --- Armor ---
    const armorBase = Number(red?.armor ?? 0) || 0;
    if (armorBase) {
      const armorSources = listArmorSourcesForLocation(updateTarget, hitLocation);
      if (armorSources.length) {
        const src = armorSources.map(a => `${a.name} (${a.ar})`).join(", ");
        lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">AR: ${src}</span></div>`);
      } else {
        lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">AR: ${armorBase}</span></div>`);
      }
    }

    if (ae?.armorRating && ((ae.armorRating.global?.total ?? 0) || (ae.armorRating.location?.total ?? 0))) {
      const bits = [];
      if (ae.armorRating.global?.total) bits.push(`Global ${fmt(ae.armorRating.global.total)}`);
      if (ae.armorRating.location?.total) bits.push(`${ae.armorRating.location.key} ${fmt(ae.armorRating.location.total)}`);
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">AR AE: ${bits.join(" | ")}</span></div>`);
      lines.push(renderEntryLines("AR", ae.armorRating.global?.entries));
      lines.push(renderEntryLines("AR", ae.armorRating.location?.entries));
    }

    // --- Resistance ---
    const resistanceBase = Number(red?.resistance ?? 0) || 0;
    if (r?.damageType && String(r.damageType) !== "physical" && resistanceBase) {
      const resKeyByType = {
        fire: "fireR",
        frost: "frostR",
        shock: "shockR",
        poison: "poisonR",
        magic: "magicR",
        silver: "silverR",
        sunlight: "sunlightR",
      };
      const rk = resKeyByType[String(r.damageType).toLowerCase()] ?? "resistance";
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">R (base ${rk}): ${resistanceBase}</span></div>`);
    }

    if (ae?.resistance?.key && ae?.resistance?.total) {
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">R AE (${ae.resistance.key}): ${fmt(ae.resistance.total)}</span></div>`);
      lines.push(renderEntryLines("R", ae.resistance.entries));
    }

    // --- Natural Toughness ---
    const toughnessBase = Number(updateTarget.system?.resistance?.natToughness ?? 0) || 0;
    if (toughnessBase) {
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">T (base natToughness): ${toughnessBase}</span></div>`);
    }

    if (ae?.natToughness?.total) {
      lines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">T AE (natToughness): ${fmt(ae.natToughness.total)}</span></div>`);
      lines.push(renderEntryLines("T", ae.natToughness.entries));
    }

    return lines.filter(Boolean).join("");
  };

  const renderDamageSegments = () => {
    const segs = [];

    for (const r of results) {
      const dtype = String(r.damageType ?? "physical");
      const rawBase = Number(r.rawDamage ?? 0) || 0;

      // Raw composition and provenance
      const rawLines = [];
      if (r.kind === "primary") {
        const wName = String(ctx.options?.weapon?.name ?? "Weapon");
        rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Weapon: ${wName}</span></div>`);
        if (r.dosBonus) rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">DoS bonus: ${fmt(r.dosBonus)}</span></div>`);
        if (r.weaponBonus) rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Weapon bonus: ${fmt(r.weaponBonus)} (${wName})</span></div>`);
        if (attackerDealtEntries.length) rawLines.push(renderEntryLines("AE dealt", attackerDealtEntries));
        if (attackerPenEntries.length) rawLines.push(renderEntryLines("AE penetration", attackerPenEntries));
      } else if (r.kind === "sneak") {
        rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Talent: Sneak Attack</span></div>`);
        const tnotes = Array.isArray(r.breakdown?.talentNotes) ? r.breakdown.talentNotes : [];
        for (const note of tnotes) {
          rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">${note}</span></div>`);
        }
        if (r.ignoreArmorOnly) {
          rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Assassinate: AR ignored for bonus</span></div>`);
        }
      } else {
        if (r.kind === "external") {
          rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Source: ${String(r.sourceLabel ?? "Attack")}</span></div>`);
        } else {
          // Typed bonus
          const typedEntries = Array.isArray(r.breakdown?.entries)
            ? r.breakdown.entries
            : (Array.isArray(r.breakdown?.attackerTyped) ? r.breakdown.attackerTyped : []);
          if (typedEntries.length) {
            const formatted = typedEntries
              .map(e => ({ label: String(e.label ?? "Effect"), value: Number(e.value ?? 0) || 0 }))
              .filter(e => e.value);
            rawLines.push(renderEntryLines(`AE bonus [${dtype}]`, formatted));
          }
        }
      }

      if (r.incorporealBlock?.isBlocked) {
        rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Trait: Incorporeal (non-magic source)</span></div>`);
      }
      if (r.incorporealAttack?.ignoreNonMagicArmor) {
        rawLines.push(`<div class="uesrpg-da-row"><span class="k"></span><span class="v muted">Trait: Incorporeal Attack (non-magic AR ignored)</span></div>`);
      }

      // Defender AE adjustments only apply to primary
      const defLines = [];
      if (r.kind === "primary") {
        if (defenderTakenEntries.length) defLines.push(renderEntryLines("AE taken", defenderTakenEntries));
        if (defenderMitEntries.length) {
          // Mitigation flat is shown as -X
          const mf = defenderMitEntries.map(e => ({ label: e.label, value: -Math.abs(Number(e.value ?? 0) || 0) }));
          defLines.push(renderEntryLines("AE mitigation", mf, (n) => (Number(n) <= 0 ? `${n}` : `+${n}`)));
        }
      }

      const reductionTotal = Number(r.reductions?.total ?? 0) || 0;
      const applied = Number(r.finalApplied ?? 0) || 0;

      segs.push(`
        <div class="uesrpg-da-segment">
          <div class="uesrpg-da-row"><span class="k"><strong>${dtype}</strong></span><span class="v"></span></div>
          <div class="uesrpg-da-row"><span class="k">Raw</span><span class="v">${rawBase}</span></div>
          ${rawLines.join("")}
          ${renderReductionProvenance(r)}
          ${defLines.join("")}
          <div class="uesrpg-da-row"><span class="k">Total Reduction</span><span class="v">-${reductionTotal}</span></div>
          <div class="uesrpg-da-row"><span class="k">Applied</span><span class="v final">${applied}</span></div>
        </div>
      `);
    }

    return segs.join("\n");
  };

  const traitNotesHtml = traitNotes.length
    ? `<div class="uesrpg-da-row"><span class="k">Traits</span><span class="v">${traitNotes.join(" | ")}</span></div>`
    : "";

  const _actorThumb = updateTarget.img ?? "icons/svg/mystery-man.svg";
  const messageContent = `
    <div class="uesrpg-damage-applied-card">
      <div class="hdr">
        <img class="actor-thumb" src="${_actorThumb}" alt="">
        <div class="hdr-text">
          <div class="title">${updateTarget.name}</div>
          <div class="sub">${ctx.options.source ?? "Attack"}${hitLocation ? ` \u00B7 ${hitLocation}` : ""}</div>
        </div>
      </div>
      <div class="body">
        <div class="uesrpg-da-row"><span class="k">Total Damage</span><span class="v final">${Math.max(0, Number(totalApplied || 0))}</span></div>
        <div class="uesrpg-da-row"><span class="k">HP</span><span class="v">${newHP} / ${maxHP}${hpDelta ? ` <span class="muted">(\u2212${hpDelta})</span>` : ""}</span></div>
        ${tempHPAbsorbed > 0 ? `<div class="uesrpg-da-row"><span class="k">Temp HP</span><span class="v">${newTempHP}${tempHPAbsorbed ? ` <span class="muted">(\u2212${tempHPAbsorbed} absorbed)</span>` : ""}</span></div>` : (currentTempHP > 0 ? `<div class="uesrpg-da-row"><span class="k">Temp HP</span><span class="v">${newTempHP}</span></div>` : "")}
        ${bufferAbsorbedDetail.map(b => `<div class="uesrpg-da-row"><span class="k">${b.pool.charAt(0).toUpperCase() + b.pool.slice(1)} Buffer</span><span class="v">${b.remaining} <span class="muted">(\u2212${b.absorbed} absorbed)</span></span></div>`).join("")}
        ${traitNotesHtml}
        ${woundTriggered ? `<div class="status wounded">\u26A0 WOUNDED <span class="muted">(WT ${woundThreshold})</span></div>` : ""}
        ${newHP === 0 ? `<div class="status unconscious">\u{1F480} ${_isNpcActor(updateTarget) ? "DEAD" : "UNCONSCIOUS"}</div>` : ""}
        <details>
          <summary>Damage Breakdown</summary>
          <div style="font-size:12px; opacity:0.95;">${renderDamageSegments()}</div>
        </details>
      </div>
    </div>
  `;
  const gmDamageReport = _buildGmDamageReportPayload({
    targetActor: updateTarget,
    source: ctx.options.source ?? "Attack",
    hitLocation,
    totalApplied,
    newHP,
    maxHP,
    currentHP,
    currentTempHP,
    newTempHP,
    tempHPAbsorbed,
    bufferAbsorbedDetail,
    traitNotes,
    woundTriggered,
    woundThreshold,
    results,
    attackerDealtEntries,
    attackerPenEntries,
    defenderTakenEntries,
    defenderMitEntries
  });

  const suppressStandaloneSummary = ctx.options?.chatContext?.suppressStandaloneSummary === true;
  if (!suppressStandaloneSummary) {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: updateTarget }),
      content: messageContent,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: gmIds,
      blind: true,
    });
  }

  // Preserve expected return shape for callers.
  return {
    actor: updateTarget,
    damage: Math.max(0, Number(totalApplied || 0)),
    components: results,
    oldHP: Number(currentHP || 0),
    newHP,
    oldTempHP: currentTempHP,
    newTempHP,
    tempHPAbsorbed,
    bufferAbsorbed,
    bufferAbsorbedDetail,
    oldBuffers: buffers,
    newBuffers,
    woundStatus: (newHP === 0) ? (_isNpcActor(updateTarget) ? "dead" : "unconscious") : (woundTriggered ? "wounded" : "uninjured"),
    gmDamageReport,
  };
}
