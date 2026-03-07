/**
 * @module magic/opposed/actions/attacker
 *
 * src/core/magic/opposed/actions/attacker.js
 *
 * Attacker action handlers for magic opposed workflow.
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { computeMagicCastingTN, computeSpellAttemptMagickaCost, consumeSpellMagicka, applySpellRestraintRefund, isHealingSpell, getSpellScalingLevels, isActorTrainedInMagicSchool } from "../../magicka-utils.js";
import { shouldBackfire, triggerBackfire } from "../../backfire.js";
import { ActionEconomy } from "../../../combat/action-economy.js";
import { AttackTracker } from "../../../combat/attack-tracker.js";
import { classifySpellForRouting, emitCastResolved } from "../../spell-runtime.js";
import { ensureBankedScaffold, getDefenderEntries } from "../schema.js";
import { SKILL_DIFFICULTIES } from "../../../skills/skill-tn.js";
import { spellRequiresOriginAE, createOriginAE, registerLinkedEntity, findOriginAE } from "../../effects/origin-effect.js";
import { isCharacteristicDefense, computeCharacteristicDefenseTN } from "../../characteristic-defense-service.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../../../traits/features/rule-element-runtime.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { emitSuppressedOpposedSubRollDice } from "../spell-helpers.js";
import { FLAG_SCOPE } from "../../../system/namespace.js";
import { getActorFromResolvedDocument, resolveUuidSync } from "../../../../utils/uuid-cache.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";

const _FLAG_NS = FLAG_SCOPE;
const NAMESPACE = FLAG_SCOPE;

function _normalizeCastSourceCostMode(castSource = null) {
  const mode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _resolveItemContextFromState(data = {}) {
  const castSource = data?.attacker?.castSource ?? null;
  const itemCtx = data?.context?.itemCastContext ?? null;
  const itemUuid = String(itemCtx?.itemUuid ?? castSource?.itemUuid ?? "").trim();
  const sourceLane = String(itemCtx?.sourceLane ?? castSource?.sourceLane ?? "workshop").trim().toLowerCase();
  const slotId = String(itemCtx?.slotId ?? castSource?.spellSlotId ?? "").trim();
  if (!itemUuid) return null;
  const itemDoc = resolveUuidSync(itemUuid);
  const item = itemDoc?.documentName === "Item" ? itemDoc : null;
  if (!item) return null;
  return { item, sourceLane, slotId };
}

function _getItemSoulPoolSnapshot(itemCtx = null) {
  if (!itemCtx?.item) return { value: 0, max: 0, poolPath: "" };
  const { item, sourceLane } = itemCtx;
  if (sourceLane === "extension") {
    const pool = item.flags?.[_FLAG_NS]?.itemSpellcasting?.pool ?? {};
    return {
      value: Number(item.system?.charge?.value ?? pool?.value ?? 0) || 0,
      max: Number(item.system?.charge?.max ?? pool?.max ?? 0) || 0,
      poolPath: `flags.${_FLAG_NS}.itemSpellcasting.pool.value`
    };
  }
  const pool = item.flags?.[_FLAG_NS]?.enchanting?.cast?.pool ?? {};
  return {
    value: Number(pool?.value ?? 0) || 0,
    max: Number(pool?.max ?? 0) || 0,
    poolPath: `flags.${_FLAG_NS}.enchanting.cast.pool.value`
  };
}

function _resolveCastResourceSpec(attacker, data, spell) {
  const castSource = data?.attacker?.castSource ?? null;
  if (castSource?.type !== "enchantment") {
    return {
      type: "normal",
      mode: "magicka",
      cost: Number(computeSpellAttemptMagickaCost(attacker, spell, data?.attacker?.spellOptions ?? {})?.cost ?? 0) || 0,
      castSource,
      itemCtx: null
    };
  }
  const mode = _normalizeCastSourceCostMode(castSource);
  const itemCtx = _resolveItemContextFromState(data);
  if (mode === "soul") {
    return {
      type: "enchantment",
      mode,
      cost: Math.max(0, Number(castSource?.cost ?? 0) || 0),
      castSource,
      itemCtx
    };
  }
  return { type: "enchantment", mode, cost: 0, castSource, itemCtx };
}

function _isMagickaCommitRequired(resourceSpec) {
  return !(resourceSpec?.type === "enchantment" && (resourceSpec?.mode === "soul" || resourceSpec?.mode === "none"));
}

function _applyBindingStrengthFloorIfNeeded(data, result) {
  if (!result?.isSuccess) return;
  const castSource = data?.attacker?.castSource ?? null;
  if (castSource?.type !== "enchantment") return;
  const floor = Math.max(0, Number(castSource?.bindingStrength ?? 0) || 0);
  const current = Math.max(0, Number(result?.degree ?? 0) || 0);
  if (current < floor) result.degree = floor;
}

async function _setEnchantmentUpkeepPointerIfNeeded(data, spell) {
  if (!spell?.system?.hasUpkeep) return;
  const itemCtx = _resolveItemContextFromState(data);
  if (!itemCtx?.item) return;
  if (!itemCtx?.slotId) return;
  const upkeepPath = itemCtx.sourceLane === "extension"
    ? `flags.${_FLAG_NS}.itemSpellcasting.activeUpkeepSlotId`
    : `flags.${_FLAG_NS}.enchanting.cast.activeUpkeepSpellId`;
  await requestUpdateDocument(itemCtx.item, { [upkeepPath]: itemCtx.slotId });
}

function _buildCommitSpellPool(attacker, castActionType = "primary") {
  const spellsAll = Array.from(attacker?.items ?? []).filter((i) => i?.type === "spell");
  const byAction = String(castActionType) === "secondary"
    ? spellsAll.filter((s) => s?.system?.isInstant === true)
    : spellsAll;
  const byTraining = byAction.filter((s) => isActorTrainedInMagicSchool(attacker, s?.system?.school));

  // For opposed workflow commit selection, include all targetable spells
  // (attack, healing, AND direct). Direct spells committed here auto-resolve
  // with no defense step in handleAttackerRoll.
  const routed = byTraining.filter((s) => {
    const cls = classifySpellForRouting(s);
    return Boolean(cls?.isTargeted);
  });

  return routed.length ? routed : byTraining;
}

function _difficultyOptionsHtml(selectedKey = "average") {
  return SKILL_DIFFICULTIES.map((df) => {
    const sign = Number(df?.mod ?? 0) >= 0 ? "+" : "";
    const selected = String(df?.key) === String(selectedKey) ? "selected" : "";
    return `<option value="${String(df?.key ?? "average")}" ${selected}>${String(df?.label ?? "Average")} (${sign}${Number(df?.mod ?? 0)})</option>`;
  }).join("");
}

async function promptCastingCommitChoice(attacker, attackerState = {}) {
  const castActionType = String(attackerState?.castActionType ?? "primary");
  const spells = _buildCommitSpellPool(attacker, castActionType);
  if (!spells.length) {
    ui.notifications.warn(castActionType === "secondary"
      ? "No castable Instant spells available to commit (must be trained in the spell's school)."
      : "No castable spells available to commit (must be trained in the spell's school).");
    return null;
  }

  const byId = new Map(spells.map((s) => [String(s.id), s]));
  const preferredUuid = String(attackerState?.preferredSpellUuid ?? attackerState?.spellUuid ?? "").trim();
  const preferredSpell = spells.find((s) => String(s?.uuid ?? "") === preferredUuid) ?? spells[0];
  const preferredId = String(preferredSpell?.id ?? spells[0]?.id ?? "");
  const startingDifficulty = String(attackerState?.spellOptions?.difficultyKey ?? "average");
  const startingCircumstance = Number(attackerState?.spellOptions?.circumstanceMod ?? 0) || 0;
  const startingManual = Number(attackerState?.spellOptions?.manualModifier ?? 0) || 0;

  const hasOverchargeTalent = Array.from(attacker?.items ?? []).some((i) => i?.type === "talent" && i?.name === "Overcharge");
  const hasMagickaCyclingTalent = Array.from(attacker?.items ?? []).some((i) => i?.type === "talent" && i?.name === "Magicka Cycling");
  const hasMasterOfMagickaTalent = Array.from(attacker?.items ?? []).some((i) => i?.type === "talent" && i?.name === "Master of Magicka");
  const wpBonus = Math.floor(Number(attacker?.system?.characteristics?.wp?.total ?? 0) / 10);

  const spellOptions = spells.map((s) => {
    const school = String(s?.system?.school ?? "");
    const level = Number(s?.system?.level ?? 1) || 1;
    const cost = Number(s?.system?.cost ?? 0) || 0;
    return `<option value="${String(s.id)}">${s.name} (${school} L${level}, ${cost} MP)</option>`;
  }).join("");

  return await customDialog({
    title: "Cast Magic",
    content: `
        <div class="uesrpg uesrpg-adv-dialog uesrpg-adv-dialog--magic-cast">
          <div class="uesrpg-dialog-section-header">Cast Magic</div>
          <div class="form-group">
            <label><b>Select Spell to Commit</b></label>
            <select name="spellId" style="width:100%;">${spellOptions}</select>
          </div>
          <div class="form-group" id="ues-cast-level-group" style="display:none;">
            <label><b>Cast at Level</b></label>
            <select name="castLevel" id="ues-cast-level" style="width:100%;"></select>
          </div>
          <div class="form-group">
            <label><b>Difficulty</b></label>
            <select name="difficultyKey" style="width:100%;">${_difficultyOptionsHtml(startingDifficulty)}</select>
          </div>
          <div class="form-group">
            <label><b>Circumstance Modifier</b></label>
            <select name="circumstanceMod" style="width:100%;">${buildCircumstanceOptionsHtml(startingCircumstance)}</select>
          </div>
          <div class="form-group">
            <label><b>Manual Modifier</b></label>
            <input type="number" name="manualModifier" value="${startingManual}" step="1" />
          </div>
          <div class="uesrpg-defense-flags">
            <span class="uesrpg-defense-flags__label">Casting Options</span>
            <div class="uesrpg-defense-flags__items">
              <label class="uesrpg-inline-check" id="ues-restrain-group">
                <input type="checkbox" name="restrain" />
                <span><b>Spell Restraint</b> (reduce cost by ${wpBonus} to min 1)</span>
              </label>
              <label class="uesrpg-inline-check" id="ues-overload-group" style="display:none;">
                <input type="checkbox" name="overload" />
                <span><b>Overload</b></span>
              </label>
              ${hasOverchargeTalent ? `
              <label class="uesrpg-inline-check">
                <input type="checkbox" name="overcharge" />
                <span><b>Overcharge</b> (talent option)</span>
              </label>` : ""}
              ${hasMagickaCyclingTalent ? `
              <label class="uesrpg-inline-check">
                <input type="checkbox" name="magickaCycling" />
                <span><b>Magicka Cycling</b> (talent option)</span>
              </label>` : ""}
            </div>
          </div>
        </div>
      `,
      buttons: {
        commit: {
          icon: '<i class="fas fa-check"></i>',
          label: "Commit",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const spellId = String(root?.querySelector('select[name="spellId"]')?.value ?? "");
            const selectedSpell = byId.get(spellId) ?? null;
            if (!selectedSpell) {
              return null;
            }

            const baseLevel = Number(selectedSpell?.system?.level ?? 1) || 1;
            const levelRaw = String(root?.querySelector('select[name="castLevel"]')?.value ?? "base");
            const castLevel = (levelRaw !== "base" && Number.isFinite(Number(levelRaw))) ? Number(levelRaw) : null;
            const hasOverload = Boolean(selectedSpell?.system?.hasOverload);
            const isOverloaded = hasOverload && Boolean(root?.querySelector('input[name="overload"]')?.checked);

            return {
              spell: selectedSpell,
              spellOptions: {
                difficultyKey: String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average"),
                circumstanceMod: Number(root?.querySelector('select[name="circumstanceMod"]')?.value ?? 0) || 0,
                manualModifier: Number(root?.querySelector('input[name="manualModifier"]')?.value ?? 0) || 0,
                isRestrained: Boolean(root?.querySelector('input[name="restrain"]')?.checked),
                isOverloaded,
                useOvercharge: Boolean(root?.querySelector('input[name="overcharge"]')?.checked),
                useMagickaCycling: Boolean(root?.querySelector('input[name="magickaCycling"]')?.checked),
                castLevel,
                level: castLevel // Alias for compatibility with existing resolvers
              }
            };
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => null
        }
      },
      default: "commit",
      classes: ["uesrpg-attack-declare"],
      render: (event, html) => {
        const root = html instanceof HTMLElement ? html : html?.element ?? html;
        const spellSelect = root?.querySelector('select[name="spellId"]');
        const castLevelGroup = root?.querySelector("#ues-cast-level-group");
        const castLevelSelect = root?.querySelector("#ues-cast-level");
        const restrainBox = root?.querySelector('input[name="restrain"]');
        const overloadGroup = root?.querySelector("#ues-overload-group");
        const overloadBox = root?.querySelector('input[name="overload"]');

        const rebuildForSpell = () => {
          const selectedSpell = byId.get(String(spellSelect?.value ?? "")) ?? spells[0];
          if (!selectedSpell) return;
          
          const baseCost = Number(selectedSpell.system?.cost ?? 0) || 0;
          const baseLevel = Number(selectedSpell.system?.level ?? 1) || 1;
          const rawScalingLevels = getSpellScalingLevels(selectedSpell);
          
          // Filter and validate scaling levels
          const validScalingLevels = [];
          if (Array.isArray(rawScalingLevels)) {
            for (let i = 0; i < rawScalingLevels.length; i++) {
              const entry = rawScalingLevels[i];
              if (!entry || typeof entry !== "object") continue;
              
              const lvl = Number(entry.level ?? 0);
              if (!Number.isFinite(lvl) || lvl <= 0) continue;
              
              validScalingLevels.push({
                level: lvl,
                cost: Number(entry.cost ?? baseCost) || baseCost,
                damageFormula: String(entry.damageFormula || ""),
                description: String(entry.description || "")
              });
            }
          }
          
          validScalingLevels.sort((a, b) => a.level - b.level);
          
          // Build dropdown options
          if (castLevelSelect) {
            const options = [];
            options.push(`<option value="base">Base (Level ${baseLevel}, ${baseCost} MP)</option>`);
            
            for (let i = 0; i < validScalingLevels.length; i++) {
              const entry = validScalingLevels[i];
              const dmgText = entry.damageFormula ? `, ${entry.damageFormula}` : "";
              const descText = entry.description ? ` — ${entry.description}` : "";
              options.push(`<option value="${entry.level}" data-scaling-index="${i}">Level ${entry.level} (${entry.cost} MP${dmgText})${descText}</option>`);
            }
            
            castLevelSelect.innerHTML = options.join("");
          }
          
          // Show/hide dropdown based on whether scaling levels exist
          const hasScaling = validScalingLevels.length > 0;
          if (castLevelGroup) {
            castLevelGroup.style.display = hasScaling ? "" : "none";
          }

          // Handle overload checkbox visibility
          const hasOverload = Boolean(selectedSpell.system?.hasOverload);
          if (overloadGroup) overloadGroup.style.display = hasOverload ? "" : "none";
          if (!hasOverload && overloadBox) overloadBox.checked = false;

          // Mutual exclusion between restrain and overload (unless Master of Magicka)
          if (restrainBox && overloadBox) {
            if (overloadBox.checked && !hasMasterOfMagickaTalent) {
              restrainBox.checked = false;
            }
          }
        };

        if (spellSelect) {
          spellSelect.value = preferredId;
          spellSelect.addEventListener("change", rebuildForSpell);
        }

        if (restrainBox && overloadBox) {
          restrainBox.addEventListener("change", () => {
            if (restrainBox.checked && !hasMasterOfMagickaTalent) overloadBox.checked = false;
          });
          overloadBox.addEventListener("change", () => {
            if (overloadBox.checked && !hasMasterOfMagickaTalent) restrainBox.checked = false;
          });
        }

        rebuildForSpell();
      },
      width: 560
    });
}

/**
 * Handle attacker commit action (banked mode).
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleAttackerCommit(ctx) {
  const { message, data, attacker, bankMode, workflow, _updateCard } = ctx;

  if (!bankMode) return;
  if (data.attacker.result) return;

  // Gate commit if the actor cannot currently pay the AP cost (prevents dead commits).
  if (game.combat) {
    const apCost = Number(data.attacker.apCost ?? 1) || 1;
    const currentAP = Number(foundry.utils.getProperty(attacker, "system.action_points.value") ?? 0);
    if (currentAP < apCost) {
      ui.notifications.warn(`Not enough Action Points to commit casting (${currentAP}/${apCost}).`);
      return;
    }
  }

  if (data.attacker?.pendingSpellChoice === true || !data.attacker?.spellUuid || !data.attacker?.tn) {
    const picked = await promptCastingCommitChoice(attacker, data.attacker ?? {});
    if (!picked?.spell) return;

    const spell = picked.spell;
    const spellOptions = picked.spellOptions ?? {};

    if (!isActorTrainedInMagicSchool(attacker, spell?.system?.school)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
      return;
    }

    // Commit-time preflight: prevent dead commits that would certainly fail on roll.
    const spellClassification = classifySpellForRouting(spell);
    if (spellClassification.isAttack && game.combat) {
      if (AttackTracker.hasExceededLimit(attacker)) {
        ui.notifications.warn(AttackTracker.getLimitWarning(attacker) || "Attack limit reached for this round.");
        return;
      }
    }
    const commitPreview = {
      attacker: {
        ...(data?.attacker ?? {}),
        castSource: data?.attacker?.castSource ?? null,
        spellOptions
      }
    };
    const resourceSpec = _resolveCastResourceSpec(attacker, commitPreview, spell);
    if (_isMagickaCommitRequired(resourceSpec)) {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < Number(resourceSpec?.cost ?? 0)) {
        ui.notifications.warn(`Not enough Magicka to commit ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${currentMagicka}.`);
        return;
      }
    } else if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "soul") {
      const pool = _getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
      if (pool.value < Number(resourceSpec?.cost ?? 0)) {
        ui.notifications.warn(`Not enough Soul Energy to commit ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${pool.value}.`);
        return;
      }
    }

    const tn = computeMagicCastingTN(attacker, spell, spellOptions);
    const primaryDef = getDefenderEntries(data)[0] ?? null;
    const targetActor = getActorFromResolvedDocument(resolveUuidSync(String(primaryDef?.actorUuid ?? "").trim()));
    const targetToken = (() => {
      const tokenUuid = String(primaryDef?.tokenUuid ?? "").trim();
      if (!tokenUuid) return null;
      return resolveUuidSync(tokenUuid)?.object ?? null;
    })();
    applyRuntimePreRollToTN({
      actor: attacker,
      targetActor,
      targetToken,
      item: spell,
      rollContext: data?.context?.rollContext,
      workflow: "magic",
      side: "attacker",
      attackMode: "magic",
      tn
    });

    data.attacker.spellUuid = spell.uuid;
    data.attacker.spellName = spell.name;
    data.attacker.spellSchool = spell.system?.school ?? "";
    data.attacker.spellLevel = Number(spell.system?.level ?? 1);
    data.attacker.spellCost = Number(spell.system?.cost ?? 0);
    data.attacker.spellOptions = spellOptions;
    data.attacker.tn = tn;
    data.attacker.pendingSpellChoice = false;
    data.attacker.preferredSpellUuid = spell.uuid;

    data.context = data.context ?? {};
    data.context.healingDirect = isHealingSpell(spell);

    // When the deferred spell uses characteristic defense, tag all defender
    // entries so the card shows the correct characteristic commit/roll buttons.
    // Also pre-calculate TN for immediate display.
    if (isCharacteristicDefense(spell)) {
      const _CHA_LABELS = { str: "STR", end: "END", agi: "AGI", int: "INT", wp: "WP", prc: "PRC", prs: "PRS", lck: "LCK" };
      const { normalizeSpellConfig } = await import("../../spell-config.js");
      const charDef = normalizeSpellConfig(spell)?.characteristicDefense;
      const chaKey = String(charDef?.defenderCharacteristic || "end").toLowerCase();
      const chaLabel = _CHA_LABELS[chaKey] ?? chaKey.toUpperCase();
      const defs = getDefenderEntries(data);
      
      for (const def of defs) {
        def.defenseType = "characteristic-save";
        def.characteristicLabel = chaLabel;
        
        // Pre-calculate TN for card display using canonical TN computation
        const defActor = def?.actorUuid ? await fromUuid(def.actorUuid) : null;
        if (defActor) {
          const tnData = computeCharacteristicDefenseTN(defActor, spell);
          if (tnData) {
            applyRuntimePreRollToTN({
              actor: defActor,
              targetActor: attacker,
              targetToken: null,
              item: spell,
              rollContext: data?.context?.rollContext,
              workflow: "magic",
              side: "defender",
              attackMode: "magic",
              defenseType: "characteristic-save",
              tn: tnData
            });
            def.tn = {
              finalTN: tnData.finalTN,
              baseTN: tnData.baseTN,
              totalMod: tnData.totalMod,
              breakdown: tnData.breakdown
            };
          }
        }
      }
    }
  }

  ensureBankedScaffold(data);
  data.attacker.banked.committed = true;
  data.attacker.banked.committedAt = Date.now();
  data.attacker.banked.committedBy = game.user.id;

  await _updateCard(message, data);

  // Auto-roll is triggered solely via the updateChatMessage hook path
  // (maybeAutoRollBanked) to prevent duplicate runs.
}

/**
 * Handle attacker roll action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleAttackerRoll(ctx) {
  const { message, data, attacker, spell, defenders, batchedUpdate, _updateCard, workflow } = ctx;

  if (data.attacker.result) return;

  if (!isActorTrainedInMagicSchool(attacker, spell?.system?.school)) {
    ui.notifications.warn(`${attacker.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
    return;
  }

  // Preflight: gate attack limit BEFORE any resource consumption.
  const spellClassification = classifySpellForRouting(spell);
  if (spellClassification.isAttack && game.combat) {
    if (AttackTracker.hasExceededLimit(attacker)) {
      ui.notifications.warn(AttackTracker.getLimitWarning(attacker) || "Attack limit reached for this round.");
      return;
    }
  }

  // Preflight resources (AP + Magicka) before spending.
  const apCost = Number(data.attacker.apCost ?? 1) || 1;
  const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
  if (currentAP < apCost) {
    ui.notifications.warn("Not enough Action Points to cast a spell.");
    return;
  }

  const resourceSpec = _resolveCastResourceSpec(attacker, data, spell);
  if (_isMagickaCommitRequired(resourceSpec)) {
    const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    if (currentMagicka < Number(resourceSpec?.cost ?? 0)) {
      ui.notifications.warn(`Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${currentMagicka}.`);
      return;
    }
  } else if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "soul") {
    const pool = _getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
    if (pool.value < Number(resourceSpec?.cost ?? 0)) {
      ui.notifications.warn(`Not enough Soul Energy to cast ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${pool.value}.`);
      return;
    }
  }

  const apReason = (String(data.attacker.castActionType ?? "primary") === "secondary") ? "Cast Magic (Instant)" : "Cast Magic";
  const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, { reason: apReason, silent: false });
  if (!apSpentOk) return;

  // Increment attack counter for attack spells (after AP is spent successfully)
  if (spellClassification.isAttack) {
    try {
      await AttackTracker.incrementAttacks(attacker);
    } catch (err) {
      console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      // Don't break the workflow if attack tracking fails
    }
  }

  // Consume Magicka at cast time. If this fails due to a race, we attempt to refund AP.
  let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
  if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "soul") {
    const pool = _getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
    const next = Math.max(0, pool.value - Number(resourceSpec?.cost ?? 0));
    const updates = {
      [pool.poolPath]: next,
      "system.charge.value": next
    };
    const ok = resourceSpec?.itemCtx?.item ? await requestUpdateDocument(resourceSpec.itemCtx.item, updates) : false;
    if (!ok) {
      try {
        await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
      } catch (_e) {
        // best-effort
      }
      ui.notifications.warn("Failed to spend Soul Energy from enchanted item.");
      return;
    }
    magickaSpend.consumed = Number(resourceSpec?.cost ?? 0) || 0;
    magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
  } else if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "none") {
    magickaSpend.consumed = 0;
    magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
  } else {
    magickaSpend = await consumeSpellMagicka(attacker, spell, data.attacker.spellOptions ?? {});
    if (!magickaSpend?.ok) {
      try {
        await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
      } catch (_e) {
        // best-effort
      }
      return;
    }
  }

  data.attacker.mpSpent = Number(magickaSpend.consumed ?? 0) || 0;
  data.attacker.mpRemaining = Number(magickaSpend.remaining ?? attacker?.system?.magicka?.value ?? 0) || 0;

  const primaryDef = Array.isArray(defenders) ? defenders[0] ?? null : null;
  const targetActor = getActorFromResolvedDocument(resolveUuidSync(String(primaryDef?.actorUuid ?? "").trim()));
  const targetToken = (() => {
    const tokenUuid = String(primaryDef?.tokenUuid ?? "").trim();
    if (!tokenUuid) return null;
    return resolveUuidSync(tokenUuid)?.object ?? null;
  })();

  const castingTn = (data.attacker?.tn && typeof data.attacker.tn === "object")
    ? data.attacker.tn
    : { finalTN: Number(data.attacker?.tn?.finalTN ?? 0) || 0 };
  applyRuntimePreRollToTN({
    actor: attacker,
    targetActor,
    targetToken,
    item: spell,
    rollContext: data?.context?.rollContext,
    workflow: "magic",
    side: "attacker",
    attackMode: "magic",
    tn: castingTn
  });
  data.attacker.tn = castingTn;

  // Roll casting test
  const result = await doTestRoll(attacker, {
    target: Number(castingTn.finalTN ?? 0) || 0,
    allowLucky: true,
    allowUnlucky: true
  });

  await applyRuntimePostRollToResult({
    actor: attacker,
    targetActor,
    targetToken,
    item: spell,
    rollContext: data?.context?.rollContext,
    workflow: "magic",
    side: "attacker",
    attackMode: "magic",
    result,
    allowPrompt: true
  });
  _applyBindingStrengthFloorIfNeeded(data, result);

  const postSubRolls = game.settings?.settings?.has?.(`${NAMESPACE}.opposedPostSubRollMessages`)
    ? game.settings.get(NAMESPACE, "opposedPostSubRollMessages")
    : true;
  if (postSubRolls) {
    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<b>${spell.name}</b> — Casting Test`,
      flags: { [_FLAG_NS]: { magicOpposedMeta: { parentMessageId: message.id, stage: "attacker" } } }
    });
  } else {
    emitSuppressedOpposedSubRollDice(result.roll, { rollMode: game.settings.get("core", "rollMode") });
  }

  // Backfire (RAW / system rules)
  const needsBackfire = shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
  if (needsBackfire) {
    await triggerBackfire(attacker, spell);
  }

  // RAW: Spell Restraint reduces Magicka cost only on a successful spellcast.
  try {
    const refundInfo = (resourceSpec?.type === "enchantment" && resourceSpec?.mode !== "magicka")
      ? { finalCost: Number(magickaSpend?.consumed ?? 0) || 0, refund: 0, breakdown: [] }
      : await applySpellRestraintRefund(attacker, spell, data.attacker.spellOptions ?? {}, result, magickaSpend);
    if (refundInfo?.refund > 0) {
      data.attacker.mpSpent = refundInfo.finalCost;
      data.attacker.mpRemaining = Number(attacker.system?.magicka?.value ?? data.attacker.mpRemaining);
      data.attacker.mpRefund = refundInfo.refund;
      data.attacker.mpRestraintBreakdown = refundInfo.breakdown;
    }
  } catch (err) {
    console.warn("UESRPG | Spell restraint refund failed", err);
  }

  // Emit castResolved hook
  try {
    emitCastResolved({
      caster: attacker,
      spell,
      result,
      success: result.isSuccess,
      backfired: needsBackfire,
      mpSpent: Number(data.attacker.mpSpent ?? magickaSpend?.consumed ?? 0) || 0,
      spellOptions: data.attacker.spellOptions ?? {}
    });
  } catch (_e) { /* no-op */ }

  // Create Origin AE on the caster for persistent spells (only on success)
  if (result.isSuccess && spellRequiresOriginAE(spell)) {
    try {
      const defUuids = defenders.map((d) => d?.actorUuid).filter(Boolean);
      const originAE = await createOriginAE(attacker, spell, {
        costPaid: Number(data.attacker.mpSpent ?? magickaSpend?.consumed ?? 0) || 0,
        scalingChoices: (data.attacker.spellOptions?.castLevel) ? { level: data.attacker.spellOptions.castLevel } : null,
        spellOptions: data.attacker.spellOptions ?? {},
        targetUuids: defUuids,
        castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
        castSource: data.attacker.castSource ?? null
      });

      // Link AoE template to Origin AE if present
      if (originAE) {
        const tplUuid = data?.context?.aoe?.templateUuid ?? null;
        if (tplUuid) {
          try {
            await registerLinkedEntity(originAE, {
              type: "template",
              uuid: tplUuid,
              label: `${spell.name} AoE`
            });
          } catch (_tplErr) {
            console.warn("UESRPG | Failed to link AoE template to Origin AE", _tplErr);
          }
        }
      }
    } catch (_e) {
      console.warn("UESRPG | Failed to create Origin AE for opposed spell", _e);
    }
  }

  data.attacker.result = result;
  data.attacker.backfire = needsBackfire;
  if (result.isSuccess) {
    await _setEnchantmentUpkeepPointerIfNeeded(data, spell);
  }

  // Direct and healing spells skip the standard Block/Evade/Ward defense step
  // — resolve immediately.  Characteristic defense spells proceed to the
  // awaiting-defense phase so the defender can roll their characteristic save
  // (either via the chat card button or automatically in banked mode).
  const directNoDefense = Boolean(data.context?.healingDirect) || Boolean(spell?.system?.isDirect);
  if (directNoDefense) {
    for (const def of defenders) {
      def.noDefense = true;
      def.defenseType = def.defenseType || "-";
      def.tn = def.tn ?? null;
      def.result = def.result ?? { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };
    }
    data.context.phase = "resolved";
    for (let i = 0; i < defenders.length; i += 1) {
      const defActor = ctx.resolveActor(defenders[i]?.actorUuid);
      if (!defActor) continue;
      await workflow._resolveOutcome(message, data, attacker, defActor, { defenderIndex: i, batchedUpdate, spell });
    }
    return data;
  }

  data.context.phase = "awaiting-defense";
  ctx._markResolutionPhase(data);
  if (batchedUpdate) return data;
  await _updateCard(message, data);
  return data;
}
