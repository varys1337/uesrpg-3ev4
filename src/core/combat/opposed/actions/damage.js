/**
 * src/core/combat/opposed/actions/damage.js
 * Damage roll handlers for opposed workflow
 */

import { _resolveDoc } from "../helpers/docs.js";
import { _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState, _getDefenderDamage, _setDefenderDamage } from "../schema.js";
import { _opposedFlags } from "../helpers/util.js";
import { getHitLocationFromRoll, resolveHitLocationForTarget, getDamageTypeFromWeapon, getAttackModeFromWeapon } from "../../combat-utils.js";
import { rollWeaponDamage as _rollWeaponDamage, rollManualDamage as _rollManualDamage } from "../damage/roller.js";
import { postWeaponDamageChatCard as _postWeaponDamageChatCard, postManualEffectChatCard as _postManualEffectChatCard } from "../damage/chat-cards.js";
import { getPreferredWeaponUuid as _getPreferredWeaponUuid, getContextAttackMode } from "../helpers/workflow.js";
import { _canControlActor } from "../helpers/util.js";
import { getSpecialActionById } from "../../../config/special-actions.js";
import { hasCondition } from "../../../conditions/condition-engine.js";
import { _promptWeaponAndAdvantages, _ensureResolvedForPostActions, _applyPressAdvantageEffect } from "../../opposed-workflow.js";
import { UESRPG } from "../../../constants.js";
import { selectEquippedRangedWeapon } from "../helpers/select-equipped-ranged-weapon.js";

const DAMAGE_TYPES = {
  PHYSICAL: "physical",
  MAGIC: "magic",
  SILVER: "silver",
  SUNLIGHT: "sunlight",
};



async function _resolveInlineRollHtml(dmg, sharedDamage) {
  if (!dmg) return { rollHtml: "", rollBHtml: "" };

  const existingRollHtml = (typeof dmg.rollHtml === "string") ? dmg.rollHtml : "";
  const existingRollBHtml = (typeof dmg.rollBHtml === "string") ? dmg.rollBHtml : "";

  const rollHtml = existingRollHtml
    ? existingRollHtml
    : (typeof dmg.rollA?.render === "function" ? await dmg.rollA.render() : String(sharedDamage?.rollHtml ?? ""));

  const rollBHtml = existingRollBHtml
    ? existingRollBHtml
    : (typeof dmg.rollB?.render === "function" ? await dmg.rollB.render() : String(sharedDamage?.rollBHtml ?? ""));

  return { rollHtml, rollBHtml };
}

/**
 * Emit inline damage dice to Dice So Nice without creating an extra chat card.
 *
 * @param {Object} opts
 * @returns {Promise<null>}
 */
export async function _emitInlineDamageRollMessage({
  actor,
  token = null,
  dmg,
  label = "Damage Roll",
  parentMessageId = null,
  stage = "damage-roll-inline",
} = {}) {
  if (!actor || !dmg) return null;
  const rolls = [dmg.rollA, dmg.rollB].filter(Boolean);
  if (!rolls.length) return null;

  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return null;

  // NOTE: We intentionally avoid ChatMessage.create() here to prevent duplicate
  // "Weapon - Damage Roll" cards in opposed inline-damage workflows.
  await Promise.allSettled(rolls.map(async (roll) => {
    try {
      await dsn.showForRoll(roll, game.user, true);
    } catch (_err) {
      try {
        await dsn.showForRoll(roll);
      } catch (_err2) {
        // no-op: inline panel still shows rendered roll HTML
      }
    }
  }));

  return null;
}

/**
 * Build a serializable apply-damage payload from button parameters.
 * Eliminates repeated inline data-attribute construction.
 * Keys are camelCase — the renderer converts to kebab-case data attributes.
 *
 * @param {Object} opts
 * @returns {Object} Serializable payload for flags
 */
export function _buildApplyPayload({
  targetUuid, targetName, attackerActorUuid, weaponUuid, ammoUuid,
  sourceItemUuid, damage, damageType, hitLocation, dosBonus = 0,
  penetration = 0, penetrateArmor = false, forcefulImpact = false,
  pressAdvantage = false, attackMode, attackHidden = false,
  magicSource = false, source, buttonLabel, healing, tempHp,
  ignoreReduction = false,
} = {}) {
  const p = {};
  if (targetUuid != null) p.targetUuid = targetUuid;
  if (targetName != null) p.targetName = targetName;
  if (attackerActorUuid != null) p.attackerActorUuid = attackerActorUuid;
  if (weaponUuid != null) p.weaponUuid = weaponUuid;
  if (ammoUuid != null) p.ammoUuid = ammoUuid;
  if (sourceItemUuid != null) p.sourceItemUuid = sourceItemUuid;
  if (damage != null) p.damage = damage;
  if (healing != null) p.healing = healing;
  if (tempHp != null) p.tempHp = tempHp;
  if (damageType != null) p.damageType = damageType;
  if (hitLocation != null) p.hitLocation = hitLocation;
  p.dosBonus = String(dosBonus);
  p.penetration = String(penetration);
  p.penetrateArmor = penetrateArmor ? "1" : "0";
  p.forcefulImpact = forcefulImpact ? "1" : "0";
  p.pressAdvantage = pressAdvantage ? "1" : "0";
  p.ignoreReduction = ignoreReduction ? "1" : "0";
  if (attackMode != null) p.attackMode = attackMode;
  p.attackHidden = attackHidden ? "1" : "0";
  p.magicSource = magicSource ? "1" : "0";
  if (source != null) p.source = source;
  if (buttonLabel != null) p.buttonLabel = buttonLabel;
  return p;
}

/**
 * Handle damage-roll action: attacker rolls damage after winning opposed test
 */
export async function handleDamageRoll(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, aToken, dToken, isAoE, opts, _updateCard } = ctx;

  const ok = await _ensureResolvedForPostActions(message, data, { defenderIndex });
  if (!ok) {
    ui.notifications.warn("Damage cannot be rolled until the opposed test is resolved.");
    return;
  }
  const outcome = _getDefenderOutcome(data, data.defender);
  if (!outcome || outcome.winner !== "attacker") {
    ui.notifications.warn("Damage can only be rolled when the attacker wins the opposed test.");
    return;
  }
  if (!_canControlActor(attacker) && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to roll damage for this attacker.");
    return;
  }

  // Idempotency guard: prevent re-rolling if inline damage already recorded
  const existingDamage = _getDefenderDamage(data, data.defender);
  if (existingDamage?.rolled === true) {
    ui.notifications.warn("Damage has already been rolled for this target.");
    return;
  }

  // Shared damage is only appropriate for AoE workflows. Multi-defender (e.g., Mighty Cleave)
  // rolls damage per target by RAW.
  const shareDamage = isAoE;
  let sharedDamage = shareDamage ? (data.context?.sharedDamage ?? null) : null;
  const sharedSelection = shareDamage ? (data.context?.sharedDamageSelection ?? null) : null;

  const advantage = _getDefenderAdvantage(data, data.defender) ?? { attacker: 0, defender: 0 };
  const attackMode = getContextAttackMode(data.context);
  const ctxWeaponUuid = String(data.context?.weaponUuid ?? "").trim();
  let ctxWeaponMode = "";
  if (ctxWeaponUuid) {
    try {
      const w = await fromUuid(ctxWeaponUuid);
      ctxWeaponMode = String(w?.system?.attackMode ?? "").toLowerCase();
    } catch (_e) {
      ctxWeaponMode = "";
    }
  }
  const advCount = (attackMode === "melee") ? Number(advantage.attacker ?? 0) : 0;
  const defenderActor = _resolveDoc(data?.defender?.actorUuid);
  const forcedHitLocationRaw = data?.context?.forcedHitLocation ?? null;
  const forcedHitLocation = forcedHitLocationRaw
    ? resolveHitLocationForTarget(defenderActor, forcedHitLocationRaw)
    : null;
  const baseHitLocation = forcedHitLocation
    ?? resolveHitLocationForTarget(defenderActor, getHitLocationFromRoll(data.attacker?.result?.rollTotal ?? 0));
  const activationCtx = data.context?.activation ?? null;
  const activationDamage = activationCtx?.damage ?? null;
  const activationMode = String(activationDamage?.mode ?? "weapon").toLowerCase().trim();
  const allowNoWeapon = Boolean(activationDamage && activationMode !== "weapon");

  const isRanged = String(attackMode ?? "").toLowerCase() === "ranged" || String(ctxWeaponMode ?? "").toLowerCase() === "ranged";
  const rangedWeapon = isRanged ? (selectEquippedRangedWeapon(attacker) ?? null) : null;
  const rangedWeaponUuid = isRanged
    ? (String(data.context?.weaponUuid ?? "").trim()
      || String(data.context?.lastWeaponUuid ?? "").trim()
      || String(rangedWeapon?.uuid ?? "")
      || String(_getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? "").trim())
    : "";

  if (isRanged && !rangedWeaponUuid && !allowNoWeapon) {
    ui.notifications.warn("No equipped ranged weapon could be resolved for this damage roll.");
    return;
  }

  const selection = sharedSelection
    ?? (shareDamage && sharedDamage?.weaponUuid ? { weaponUuid: sharedDamage.weaponUuid } : null)
    ?? (isRanged ? { weaponUuid: rangedWeaponUuid || null } : null)
    ?? await _promptWeaponAndAdvantages({
      attackerActor: attacker,
      attackMode,
      advantageCount: advCount,
      attackerTokenUuid: data.attacker?.tokenUuid ?? null,
      opponentTokenUuid: data.defender?.tokenUuid ?? null,
      defaultWeaponUuid: data.context?.lastWeaponUuid ?? _getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? null,
      defaultHitLocation: baseHitLocation,
      allowNoWeapon,
    });
  if (!selection) return;

  // Do not persist selection here; block resolution does not spend Advantage.

  // Record Advantage spend selections (including Special Actions) for downstream automation/rendering.
  const resolutionState = _getDefenderResolutionState(data, data.defender);
  resolutionState.advantageResolution.attacker = {
    precisionStrike: Boolean(selection.precisionStrike),
    precisionLocation: String(selection.precisionLocation ?? ""),
    penetrateArmor: Boolean(selection.penetrateArmor),
    forcefulImpact: Boolean(selection.forcefulImpact),
    pressAdvantage: Boolean(selection.pressAdvantage),
    pressAdvantageDouble: Boolean(selection.pressAdvantageDouble),
    specialActionsSelected: Array.isArray(selection.specialActionsSelected) ? selection.specialActionsSelected.slice() : []
  };

    const weapon = selection.weaponUuid ? await fromUuid(selection.weaponUuid) : null;
    if (!weapon && !allowNoWeapon) {
      ui.notifications.warn("Selected weapon could not be resolved.");
      return;
    }

    // Persist last weapon for convenience within this single opposed workflow.
    if (weapon) {
      data.context = data.context ?? {};
      data.context.lastWeaponUuid = weapon.uuid;
    }

    // Perf: single batched card update for advantage selection + weapon choice
    // (previously two separate _updateCard calls).
    await _updateCard(message, data);

  if (selection.pressAdvantage && attackMode === "melee") {
    const defenderActor = _resolveDoc(data?.defender?.actorUuid);
    await _applyPressAdvantageEffect(attacker, defenderActor, {
      attackerTokenUuid: data.attacker?.tokenUuid ?? null,
      defenderTokenUuid: data.defender?.tokenUuid ?? null,
      doubleEffect: Boolean(selection.pressAdvantageDouble)
    });
  }

  // Execute Special Advantage automation (free + auto-win)
  if (Array.isArray(selection.specialActionsSelected) && selection.specialActionsSelected.length > 0) {
    try {
      const { showSpecialAdvantageDialog, executeSpecialAction } = await import("../../special-actions-helper.js");
      const defenderActor = _resolveDoc(data?.defender?.actorUuid);
      
      for (const saId of selection.specialActionsSelected) {
        const choice = await showSpecialAdvantageDialog(saId);
        if (!choice) continue;

        if (choice.mode === "autowin") {
          // Auto-Win: consume 1 AP, skip test, auto-succeed
          const { ActionEconomy } = await import("../../action-economy.js");
          const def = getSpecialActionById(saId);
          await ActionEconomy.spendAP(attacker, 1, { 
            reason: `Special Advantage: ${def?.name} (Auto-Win)`, 
            silent: false 
          });

          const result = await executeSpecialAction({
            specialActionId: saId,
            actor: attacker,
            target: defenderActor ?? null,
            isAutoWin: true,
            opposedResult: { winner: "attacker" }
          });

          if (result.success) {
            await ChatMessage.create({
              user: game.user.id,
              speaker: ChatMessage.getSpeaker({ actor: attacker }),
              content: `<div class="uesrpg-special-action-advantage"><b>Special Advantage (Auto-Win):</b><p>${result.message}</p></div>`,
              style: CONST.CHAT_MESSAGE_STYLES.OTHER
            });
          }
        } else if (choice.mode === "free") {
          // Free Action: 0 AP, initiate test with dropdown selection
          const attackerTokenUuid = data.attacker?.tokenUuid ?? null;
          const defenderTokenUuid = data.defender?.tokenUuid ?? null;
          const attackerToken = attackerTokenUuid ? fromUuidSync(attackerTokenUuid)?.object : null;
          const defenderToken = defenderTokenUuid ? fromUuidSync(defenderTokenUuid)?.object : null;

          if (attackerToken && defenderToken) {
            const { SkillOpposedWorkflow } = await import("../../../skills/opposed-workflow.js");
            const def = getSpecialActionById(saId);
            
            const saMessage = await SkillOpposedWorkflow.createPending({
              attackerTokenUuid: attackerToken?.document?.uuid ?? attackerToken?.uuid,
              defenderTokenUuid: defenderToken?.document?.uuid ?? defenderToken?.uuid,
              attackerSkillUuid: null,  // Let user choose from dropdown in card
              attackerSkillLabel: `${def?.name} (Special Action)`
            });

            const state = saMessage?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
            if (state) {
              state.specialActionId = saId;
              state.allowCombatStyle = true;
              state.isFreeAction = true;

              await saMessage.update({
                flags: {
                  "uesrpg-3ev4": {
                    skillOpposed: {
                      version: state.version ?? 1,
                      state
                    }
                  }
                }
              });
            }

            ui.notifications.info(`Special Advantage: ${def?.name} used as free action.`);
          }
        }
      }
    } catch (err) {
      console.error("UESRPG | Failed to execute Special Advantage automation", err);
    }
  }

  // Hit location RAW: ones digit of attack roll, unless Precision Strike is used.
  const hitLocationRaw = forcedHitLocation
    ?? ((advCount > 0 && selection.precisionStrike)
      ? selection.precisionLocation
      : getHitLocationFromRoll(data.attacker?.result?.rollTotal ?? 0));
  const hitLocation = resolveHitLocationForTarget(defenderActor, hitLocationRaw);

  const activationFormula = String(activationDamage?.formula ?? "").trim();
  const activationType = String(activationDamage?.type ?? "").trim().toLowerCase();
  const activationTags = Array.isArray(activationCtx?.tags) ? activationCtx.tags : [];
  const activationQualities = _collectActivationDamageQualities(activationDamage);
  const hasActivationQualities = activationQualities.structured.length > 0 || activationQualities.traits.length > 0;

  const useManual = activationDamage && activationMode !== "weapon";
  const isHealingMode = activationMode === "healing" || activationMode === "temporary";
  const isManualMode = activationMode === "manual";
  if (useManual && !isHealingMode && !isManualMode) {
    ui.notifications.warn("Unsupported activation damage mode.");
    return;
  }
  if (useManual && !activationFormula) {
    ui.notifications.warn("Manual damage/healing requires a formula.");
    return;
  }

  // Render a weapon damage chat card, gated by the opposed result.
    let pillsInline = (() => {
      if (!weapon) return '<span style="opacity:0.75;">—</span>';
      const injected = Array.isArray(weapon.system?.qualitiesStructuredInjected)
        ? weapon.system.qualitiesStructuredInjected
        : Array.isArray(weapon.system?.qualitiesStructured)
          ? weapon.system.qualitiesStructured
          : [];

    const labelIndex = (() => {
      const core = UESRPG?.QUALITIES_CORE_BY_TYPE?.weapon ?? UESRPG?.QUALITIES_CATALOG ?? [];
      const traits = UESRPG?.TRAITS_BY_TYPE?.weapon ?? [];
      const idx = new Map();
      for (const q of [...core, ...traits, ...(UESRPG?.QUALITIES_CATALOG ?? [])]) {
        if (!q?.key) continue;
        idx.set(String(q.key).toLowerCase(), String(q.label ?? q.key));
      }
      return idx;
    })();

    const out = [];
    for (const q of injected) {
      const key = String(q?.key ?? q ?? "").toLowerCase().trim();
      if (!key) continue;
      const label = labelIndex.get(key) ?? key;
      const v = (q?.value !== undefined && q?.value !== null && q?.value !== "") ? Number(q.value) : null;
      out.push(`<span class="tag">${v != null && !Number.isNaN(v) ? `${label} (${v})` : label}</span>`);
    }
    const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
    for (const t of traits) {
      const key = String(t ?? "").toLowerCase().trim();
      if (!key) continue;
      const label = labelIndex.get(key) ?? key;
      out.push(`<span class="tag">${label}</span>`);
    }
    if (!out.length) return '<span style="opacity:0.75;">—</span>';
    return `<span class="uesrpg-inline-tags">${out.join("")}</span>`;
  })();

    const sourceLabel = activationCtx?.itemName ?? weapon?.name ?? "Attack";
    const sourceImg = activationCtx?.itemImg ?? weapon?.img ?? null;
  let magicSource = (() => {
    const tags = activationTags.map(t => String(t ?? "").toLowerCase());
    if (tags.includes("magic") || tags.includes("silver") || tags.includes("silvered")) return true;
    if (activationMode === "manual") {
      return activationType === "magic" || activationType === "silver" || activationType === "sunlight";
    }
    return false;
  })();

  pillsInline = hasActivationQualities
    ? _buildInlineQualityTags(activationQualities)
    : _buildInlineQualityTags(_collectWeaponInlineQualities(weapon));

  magicSource = (() => {
    const tags = activationTags.map(t => String(t ?? "").toLowerCase());
    if (tags.includes("magic") || tags.includes("silver") || tags.includes("silvered")) return true;
    const qualTokens = [
      ...activationQualities.structured.map(q => String(q?.key ?? q ?? "").toLowerCase().trim()),
      ...activationQualities.traits.map(t => String(t ?? "").toLowerCase().trim())
    ].filter(Boolean);
    if (qualTokens.includes("magic") || qualTokens.includes("silver") || qualTokens.includes("silvered")) return true;
    if (activationMode === "manual") {
      return activationType === "magic" || activationType === "silver" || activationType === "sunlight";
    }
    return false;
  })();

  if (useManual && isHealingMode) {
    const reuseShared = Boolean(sharedDamage && sharedDamage.mode === "manual-healing");
    const dmg = reuseShared ? _inflateSharedDamage(sharedDamage) : await _rollManualDamage({ formula: activationFormula });
    if (!dmg) return;
    if (shareDamage && (!sharedDamage || sharedDamage.mode !== "manual-healing")) {
      sharedDamage = _buildSharedDamagePayload({ mode: "manual-healing", dmg, damageType: activationType || "healing" });
      data.context = data.context ?? {};
      data.context.sharedDamage = sharedDamage;
      await _updateCard(message, data);
    }
    const isTemporary = activationMode === "temporary";
    const effectLabel = isTemporary ? "Temp HP" : "Healing";

    await _emitInlineDamageRollMessage({
      actor: attacker,
      token: aToken,
      dmg,
      label: `${sourceLabel} - ${effectLabel} Roll`,
      parentMessageId: message.id,
      stage: "healing-roll-inline",
    });

    const { rollHtml, rollBHtml } = await _resolveInlineRollHtml(dmg, sharedDamage);
    if (sharedDamage && rollHtml && !sharedDamage.rollHtml) sharedDamage.rollHtml = rollHtml;
    if (sharedDamage && rollBHtml && !sharedDamage.rollBHtml) sharedDamage.rollBHtml = rollBHtml;

    const damageObj = {
      rolled: true,
      mode: "healing",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollHtml,
      rollBHtml,
      rollATotal: dmg.rollA?.total ?? null,
      rollBTotal: dmg.rollB?.total ?? null,
      hitLocation,
      weaponName: null,
      weaponImg: null,
      effectLabel,
      damageType: "healing",
      qualityPillsHtml: pillsInline,
      extraNoteHtml: `<b>Activation:</b> ${sourceLabel}`,
      extraNotes: "",
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        healing: dmg.finalDamage,
        tempHp: isTemporary ? "1" : "0",
        source: sourceLabel,
        buttonLabel: `Apply ${effectLabel} → ${dToken?.name ?? defender.name}`,
      }),
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  if (useManual && isManualMode) {
    const reuseShared = Boolean(sharedDamage && sharedDamage.mode === "manual-damage");
    const dmg = reuseShared ? _inflateSharedDamage(sharedDamage) : await _rollManualDamage({ formula: activationFormula });
    if (!dmg) return;
    if (shareDamage && (!sharedDamage || sharedDamage.mode !== "manual-damage")) {
      sharedDamage = _buildSharedDamagePayload({ mode: "manual-damage", dmg, damageType: activationType || DAMAGE_TYPES.PHYSICAL });
      data.context = data.context ?? {};
      data.context.sharedDamage = sharedDamage;
      await _updateCard(message, data);
    }
    const damageType = activationType || DAMAGE_TYPES.PHYSICAL;
    const sourceItemUuid = activationCtx?.itemUuid ?? "";
    const weaponUuidForDamage = sourceItemUuid ? "" : (weapon?.uuid ?? "");

    const attackMode = getContextAttackMode(data.context);
    const attackHidden = data.context?.attackFromHidden === true;
    const ammoUuid = data.attacker?.preConsumedAmmo?.ammoUuid ?? "";

    await _emitInlineDamageRollMessage({
      actor: attacker,
      token: aToken,
      dmg,
      label: `${sourceLabel} - Damage Roll`,
      parentMessageId: message.id,
      stage: "damage-roll-inline",
    });

    const { rollHtml, rollBHtml } = await _resolveInlineRollHtml(dmg, sharedDamage);
    if (sharedDamage && rollHtml && !sharedDamage.rollHtml) sharedDamage.rollHtml = rollHtml;
    if (sharedDamage && rollBHtml && !sharedDamage.rollBHtml) sharedDamage.rollBHtml = rollBHtml;

    const damageObj = {
      rolled: true,
      mode: "manual",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollHtml,
      rollBHtml,
      rollATotal: dmg.rollA?.total ?? null,
      rollBTotal: dmg.rollB?.total ?? null,
      hitLocation,
      weaponName: sourceLabel,
      weaponImg: sourceImg,
      effectLabel: "Damage",
      damageType,
      qualityPillsHtml: pillsInline,
      extraNoteHtml: `<b>Activation:</b> ${sourceLabel}`,
      extraNotes: "",
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        attackerActorUuid: attacker.uuid,
        weaponUuid: weaponUuidForDamage,
        ammoUuid,
        sourceItemUuid,
        damage: dmg.finalDamage,
        damageType,
        hitLocation,
        penetrateArmor: selection.penetrateArmor,
        forcefulImpact: selection.forcefulImpact,
        pressAdvantage: selection.pressAdvantage,
        attackMode,
        attackHidden,
        magicSource,
        source: sourceLabel,
        buttonLabel: `Apply Damage → ${dToken?.name ?? defender.name}`,
      }),
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  const reuseShared = Boolean(sharedDamage && sharedDamage.mode === "weapon" && (!sharedDamage.weaponUuid || sharedDamage.weaponUuid === weapon?.uuid));
  const dmg = reuseShared
    ? _inflateSharedDamage(sharedDamage)
    : await _rollWeaponDamage({ weapon, preConsumedAmmo: data.attacker?.preConsumedAmmo ?? null, context: data.context ?? null });
  if (!dmg) return;
  if (shareDamage && (!sharedDamage || sharedDamage.mode !== "weapon")) {
    sharedDamage = _buildSharedDamagePayload({ mode: "weapon", dmg, weaponUuid: weapon?.uuid ?? null, damageType: getDamageTypeFromWeapon(weapon) });
    data.context = data.context ?? {};
    data.context.sharedDamage = sharedDamage;
    await _updateCard(message, data);
  }
  const damageType = getDamageTypeFromWeapon(weapon);

  const extraNotes = (() => {
    const notes = [];
    if (dmg?.damagedValue && Number(dmg.damagedValue) > 0) notes.push(`Damaged: -${Number(dmg.damagedValue)}`);
    if (dmg?.rerollMode === "primitive") notes.push("Primitive: take lower");
    else if (dmg?.rerollMode === "proven") notes.push("Proven: take higher");
    return notes.length ? `<div style="margin-top:0.15rem;">${notes.join('<br>')}</div>` : "";
  })();

  const rollATotal = Number.isFinite(Number(dmg.rollA?.total)) ? dmg.rollA.total : (Number.isFinite(Number(sharedDamage?.rollATotal)) ? sharedDamage.rollATotal : null);
  const rollBTotal = Number.isFinite(Number(dmg.rollB?.total)) ? dmg.rollB.total : (Number.isFinite(Number(sharedDamage?.rollBTotal)) ? sharedDamage.rollBTotal : null);
  const altTag = (rollBTotal != null)
    ? `<div style="margin-top:0.25rem;font-size:x-small;line-height:1.2;">Roll A: ${rollATotal ?? "?"}<br>Roll B: ${rollBTotal}${extraNotes}</div>`
    : (extraNotes ? `<div style="margin-top:0.25rem;font-size:x-small;line-height:1.2;">${extraNotes}</div>` : "");

  const attackHidden = data.context?.attackFromHidden === true;
  const ammoUuid = data.attacker?.preConsumedAmmo?.ammoUuid ?? "";

  await _emitInlineDamageRollMessage({
    actor: attacker,
    token: aToken,
    dmg,
    label: `${weapon?.name ?? "Weapon"} - Damage Roll`,
    parentMessageId: message.id,
    stage: "damage-roll-inline",
  });

  const { rollHtml, rollBHtml } = await _resolveInlineRollHtml(dmg, sharedDamage);
  if (sharedDamage && rollHtml && !sharedDamage.rollHtml) sharedDamage.rollHtml = rollHtml;
  if (sharedDamage && rollBHtml && !sharedDamage.rollBHtml) sharedDamage.rollBHtml = rollBHtml;

  const extraNotesText = (() => {
    const n = [];
    if (dmg?.damagedValue && Number(dmg.damagedValue) > 0) n.push(`Damaged: -${Number(dmg.damagedValue)}`);
    if (dmg?.rerollMode === "primitive") n.push("Primitive: take lower");
    else if (dmg?.rerollMode === "proven") n.push("Proven: take higher");
    return n.join(", ");
  })();

  const damageObj = {
    rolled: true,
    mode: "weapon",
    finalDamage: dmg.finalDamage,
    damageString: dmg.damageString ?? "",
    rollHtml,
    rollBHtml,
    rollATotal: rollATotal,
    rollBTotal: rollBTotal,
    hitLocation,
    weaponName: weapon.name,
    weaponImg: weapon.img,
    weaponUuid: weapon.uuid ?? "",
    damageType,
    qualityPillsHtml: pillsInline,
    extraNoteHtml: "",
    extraNotes: extraNotesText,
    applyPayload: _buildApplyPayload({
      targetUuid: defender.uuid,
      targetName: dToken?.name ?? defender.name,
      attackerActorUuid: attacker.uuid,
      weaponUuid: weapon?.uuid ?? "",
      ammoUuid,
      damage: dmg.finalDamage,
      damageType,
      hitLocation,
      penetrateArmor: selection.penetrateArmor,
      forcefulImpact: selection.forcefulImpact,
      pressAdvantage: selection.pressAdvantage,
      attackMode,
      attackHidden,
      source: weapon.name,
      buttonLabel: `Apply Damage → ${dToken?.name ?? defender.name}`,
    }),
    applied: false,
  };
  _setDefenderDamage(data, data.defender, damageObj);
  await _updateCard(message, data);
  return;
}

/**
 * Handle counter-damage-roll action: defender rolls damage after winning via counter-attack
 */
export async function handleCounterDamageRoll(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, aToken, dToken, opts, _updateCard } = ctx;

  const ok = await _ensureResolvedForPostActions(message, data, { defenderIndex });
  if (!ok) {
    ui.notifications.warn("Counter-attack damage cannot be rolled until the opposed test is resolved.");
    return;
  }

  let defenseType = String(data.defender?.defenseType ?? "").toLowerCase();
  if (defenseType !== "counter") {
    const lbl = String(data.defender?.defenseLabel ?? data.defender?.label ?? "").toLowerCase();
    if (lbl.includes("counter")) {
      data.defender = data.defender ?? {};
      data.defender.defenseType = "counter";
      defenseType = "counter";
      // Perf: deferred — will be persisted with the next _updateCard below.
    }
  }

  const outcome = _getDefenderOutcome(data, data.defender);
  if (!outcome || outcome.winner !== "defender" || defenseType !== "counter") {
    ui.notifications.warn("Counter-attack damage can only be rolled when the defender wins via Counter-Attack.");
    return;
  }
  if (!_canControlActor(defender) && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to roll damage for this defender.");
    return;
  }

  // Idempotency guard: prevent re-rolling if inline damage already recorded
  const existingCounterDamage = _getDefenderDamage(data, data.defender);
  if (existingCounterDamage?.rolled === true) {
    ui.notifications.warn("Counter-attack damage has already been rolled.");
    return;
  }

  const advantage = _getDefenderAdvantage(data, data.defender) ?? { attacker: 0, defender: 0 };
  const advCount = Number(advantage.defender ?? 0);
  const targetActor = _resolveDoc(data?.attacker?.actorUuid) ?? attacker;
  const baseHitLocation = resolveHitLocationForTarget(targetActor, getHitLocationFromRoll(data.defender?.result?.rollTotal ?? 0));
  const selection = await _promptWeaponAndAdvantages({
    attackerActor: defender,
    advantageCount: advCount,
    attackerTokenUuid: data.defender?.tokenUuid ?? null,
    opponentTokenUuid: data.attacker?.tokenUuid ?? null,
    defaultWeaponUuid: data.context?.lastDefenderWeaponUuid ?? _getPreferredWeaponUuid(defender, { meleeOnly: true }) ?? null,
    defaultHitLocation: baseHitLocation,
  });
  if (!selection) return;

  const weapon = await fromUuid(selection.weaponUuid);
  if (!weapon) {
    ui.notifications.warn("Selected weapon could not be resolved.");
    return;
  }

  // Persist last defender weapon for convenience within this single opposed workflow.
  data.context = data.context ?? {};
  data.context.lastDefenderWeaponUuid = weapon.uuid;
  await _updateCard(message, data);

  // Press Advantage: if the counter-attacker spends Advantage here, the benefit belongs to the defender
  // (the striker in this counter-damage roll) against the original attacker.
  // This mirrors the attacker-win damage flow, which applies Press Advantage immediately upon selection.
  const attackMode = getContextAttackMode(data.context);
  if (selection.pressAdvantage && attackMode === "melee") {
    try {
      // Counter-attack is only legal against melee attacks; still guard defensively.
      await _applyPressAdvantageEffect(
        defender,
        targetActor,
        {
          attackerTokenUuid: data.defender?.tokenUuid ?? null,
          defenderTokenUuid: data.attacker?.tokenUuid ?? null,
          doubleEffect: Boolean(selection.pressAdvantageDouble)
        }
      );
    } catch (err) {
      console.warn("UESRPG | Failed to apply Press Advantage on counter-attack damage selection", err);
    }
  }

  // Hit location RAW: ones digit of counter-attack roll, unless Precision Strike is used.
  const hitLocationRaw = (advCount > 0 && selection.precisionStrike)
    ? selection.precisionLocation
    : getHitLocationFromRoll(data.defender?.result?.rollTotal ?? 0);
  const hitLocation = resolveHitLocationForTarget(targetActor, hitLocationRaw);

  const dmg = await _rollWeaponDamage({ weapon, preConsumedAmmo: data.attacker?.preConsumedAmmo ?? null, context: data.context ?? null });
  if (!dmg) return;
  const damageType = getDamageTypeFromWeapon(weapon);
  const counterAttackMode = getAttackModeFromWeapon(weapon);
  const counterHidden = hasCondition(defender, "hidden");
  const counterAmmoUuid = (() => {
    if (String(counterAttackMode ?? "").toLowerCase() !== "ranged") return "";
    const ammoId = String(weapon.system?.ammoId ?? "").trim();
    if (!ammoId) return "";
    const ammo = weapon.actor?.items?.get?.(ammoId) ?? null;
    if (!ammo || ammo.type !== "ammunition") return "";
    return String(ammo.uuid ?? "");
  })();

  // Counter-attack: defender is the striker, original attacker is the target.
  await _emitInlineDamageRollMessage({
    actor: defender,
    token: dToken,
    dmg,
    label: `${weapon?.name ?? "Weapon"} - Counter Damage Roll`,
    parentMessageId: message.id,
    stage: "counter-damage-roll-inline",
  });

  const { rollHtml, rollBHtml } = await _resolveInlineRollHtml(dmg, null);

  const damageObj = {
    rolled: true,
    mode: "counter",
    finalDamage: dmg.finalDamage,
    damageString: dmg.damageString ?? "",
    rollHtml,
    rollBHtml,
    rollATotal: dmg.rollA?.total ?? null,
    rollBTotal: dmg.rollB?.total ?? null,
    hitLocation,
    weaponName: weapon.name,
    weaponImg: weapon.img,
    weaponUuid: weapon.uuid ?? "",
    damageType,
    qualityPillsHtml: _buildInlineQualityTags(_collectWeaponInlineQualities(weapon)),
    extraNoteHtml: `<b>Strike:</b> Counter-Attack against ${aToken?.name ?? attacker.name}`,
    extraNotes: "",
    applyPayload: _buildApplyPayload({
      targetUuid: attacker.uuid,
      targetName: aToken?.name ?? attacker.name,
      attackerActorUuid: defender.uuid,
      weaponUuid: weapon.uuid,
      ammoUuid: counterAmmoUuid,
      damage: dmg.finalDamage,
      damageType,
      hitLocation,
      penetrateArmor: selection.penetrateArmor,
      forcefulImpact: selection.forcefulImpact,
      pressAdvantage: selection.pressAdvantage,
      attackMode: counterAttackMode,
      attackHidden: counterHidden,
      source: weapon.name,
      buttonLabel: `Apply Damage → ${aToken?.name ?? attacker.name}`,
    }),
    applied: false,
  };
  _setDefenderDamage(data, data.defender, damageObj);
  await _updateCard(message, data);
  return;
}

// --- Helper functions (extracted from original actions.js) ---

function _collectActivationDamageQualities(activationDamage) {
  if (!activationDamage) return { structured: [], traits: [] };
  return {
    structured: Array.isArray(activationDamage.qualitiesStructured) ? activationDamage.qualitiesStructured : [],
    traits: Array.isArray(activationDamage.qualitiesTraits) ? activationDamage.qualitiesTraits : []
  };
}

function _collectWeaponInlineQualities(weapon) {
  if (!weapon) return { structured: [], traits: [] };
  const injected = Array.isArray(weapon.system?.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : Array.isArray(weapon.system?.qualitiesStructured)
      ? weapon.system.qualitiesStructured
      : [];
  const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
  return { structured: injected, traits };
}

function _buildInlineQualityTags(qualities) {
  const labelIndex = (() => {
    const core = UESRPG?.QUALITIES_CORE_BY_TYPE?.weapon ?? UESRPG?.QUALITIES_CATALOG ?? [];
    const traits = UESRPG?.TRAITS_BY_TYPE?.weapon ?? [];
    const idx = new Map();
    for (const q of [...core, ...traits, ...(UESRPG?.QUALITIES_CATALOG ?? [])]) {
      if (!q?.key) continue;
      idx.set(String(q.key).toLowerCase(), String(q.label ?? q.key));
    }
    return idx;
  })();

  const out = [];
  for (const q of qualities.structured) {
    const key = String(q?.key ?? q ?? "").toLowerCase().trim();
    if (!key) continue;
    const label = labelIndex.get(key) ?? key;
    const v = (q?.value !== undefined && q?.value !== null && q?.value !== "") ? Number(q.value) : null;
    out.push(`<span class="tag">${v != null && !Number.isNaN(v) ? `${label} (${v})` : label}</span>`);
  }
  for (const t of qualities.traits) {
    const key = String(t ?? "").toLowerCase().trim();
    if (!key) continue;
    const label = labelIndex.get(key) ?? key;
    out.push(`<span class="tag">${label}</span>`);
  }
  if (!out.length) return '<span style="opacity:0.75;">—</span>';
  return `<span class="uesrpg-inline-tags">${out.join("")}</span>`;
}

export function inflateSharedDamage(shared) {
  if (!shared) return null;
  return {
    finalDamage: Number(shared.finalDamage ?? 0),
    damageString: String(shared.damageString ?? ""),
    rollHtml: String(shared.rollHtml ?? ""),
    rollBHtml: String(shared.rollBHtml ?? ""),
    rollA: shared.rollA ?? null,
    rollB: shared.rollB ?? null,
    damagedValue: shared.damagedValue ?? 0,
    rerollMode: shared.rerollMode ?? null
  };
}

export function buildSharedDamagePayload({ mode, dmg, weaponUuid = null, damageType = "physical" }) {
  return {
    mode,
    weaponUuid,
    damageType,
    finalDamage: dmg.finalDamage,
    damageString: dmg.damageString,
    rollHtml: String(dmg.rollHtml ?? ""),
    rollBHtml: String(dmg.rollBHtml ?? ""),
    rollATotal: dmg.rollA?.total ?? null,
    rollBTotal: dmg.rollB?.total ?? null,
    damagedValue: dmg.damagedValue ?? 0,
    rerollMode: dmg.rerollMode ?? null
  };
}

// Internal aliases for backward compatibility within this file
const _inflateSharedDamage = inflateSharedDamage;
const _buildSharedDamagePayload = buildSharedDamagePayload;
