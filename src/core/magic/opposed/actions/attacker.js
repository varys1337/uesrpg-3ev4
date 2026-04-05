/**
 * @module magic/opposed/actions/attacker
 *
 * src/core/magic/opposed/actions/attacker.js
 *
 * Attacker action handlers for magic opposed workflow.
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { applySpellRestraintRefund, canActorCastSpell, computeMagicCastingTN, computeSpellAttemptMagickaCost, consumeSpellMagicka, getSpellCastingSchool, getSpellScalingLevels, isHealingSpell } from "../../magicka-utils.js";
import { shouldBackfire, triggerBackfire } from "../../backfire.js";
import { ActionEconomy } from "../../../combat/action-economy.js";
import { AttackTracker } from "../../../combat/attack-tracker.js";
import { classifySpellForRouting, emitCastResolved } from "../../spell-runtime.js";
import { ensureBankedScaffold, getDefenderEntries } from "../schema.js";
import { SKILL_DIFFICULTIES } from "../../../skills/skill-tn.js";
import { spellRequiresOriginAE, createOriginAE, registerLinkedEntity } from "../../effects/origin-effect.js";
import { isCharacteristicDefense, computeCharacteristicDefenseTN } from "../../characteristic-defense-service.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../../../traits/features/rule-element-runtime.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { FLAG_SCOPE } from "../../../system/namespace.js";
import { getActorFromResolvedDocument, resolveUuidSync } from "../../../../utils/uuid-cache.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";
import { cloneFlagState } from "../../../../utils/clone.js";
import { commitLaneToFreshCardState } from "../../../opposed/shared/fresh-commit.js";
import { resolveSpellProfile } from "../../spell-profile.js";
import {
  normalizeCastSourceCostMode,
  resolveItemContextFromCastSource,
  getItemSoulPoolSnapshot,
} from "../cast-source.js";
import { postMagicOpposedSubRoll } from "../subrolls.js";

const _FLAG_NS = FLAG_SCOPE;

function _ignoreTraining(data = {}) {
  return data?.attacker?.ignoreTraining === true || data?.attacker?.spellOptions?.ignoreTraining === true;
}

function _ignoreActionPoints(data = {}) {
  return data?.attacker?.ignoreActionPoints === true || data?.attacker?.spellOptions?.ignoreActionPoints === true;
}

/** @private — Clone current magic opposed state from a live message for lane-commit merging. */
function _readMagicOpposedFlagState(fm) {
  const raw = fm?.flags?.[_FLAG_NS]?.magicOpposed ?? null;
  const state = (raw?.state && typeof raw.state === "object") ? raw.state : null;
  return state ? cloneFlagState(state) : null;
}

function _getLiveMagicOpposedMessage(message) {
  const messageId = message?.id ?? message?._id ?? "";
  return messageId ? (game.messages?.get?.(messageId) ?? message) : message;
}

function _getAttackerRollClaimId(state = {}) {
  return String(state?.context?.attackerRollInFlight?.claimId ?? "").trim();
}

async function _acquireAttackerRollClaim(message, _updateCard) {
  const liveMessage = _getLiveMagicOpposedMessage(message);
  const freshState = _readMagicOpposedFlagState(liveMessage);
  if (!freshState?.attacker || freshState.attacker.result) {
    return { acquired: false, data: freshState, claimId: null };
  }
  if (_getAttackerRollClaimId(freshState)) {
    return { acquired: false, data: freshState, claimId: null };
  }

  const claimId = foundry.utils.randomID();
  freshState.context = freshState.context ?? {};
  freshState.context.attackerRollInFlight = {
    claimId,
    startedAt: Date.now(),
    startedBy: game.user.id
  };
  await _updateCard(liveMessage, freshState);

  const claimedState = _readMagicOpposedFlagState(_getLiveMagicOpposedMessage(message));
  if (_getAttackerRollClaimId(claimedState) !== claimId) {
    return { acquired: false, data: claimedState, claimId: null };
  }
  return { acquired: true, data: claimedState, claimId };
}

async function _releaseAttackerRollClaim(message, data, _updateCard, claimId, { persist = false } = {}) {
  if (!claimId) return data ?? null;
  const liveMessage = _getLiveMagicOpposedMessage(message);
  const working = persist
    ? (_readMagicOpposedFlagState(liveMessage) ?? data ?? null)
    : (data ?? _readMagicOpposedFlagState(liveMessage) ?? null);
  if (!working) return data ?? null;
  if (_getAttackerRollClaimId(working) !== claimId) return working;

  working.context = working.context ?? {};
  working.context.attackerRollInFlight = null;
  if (persist) {
    await _updateCard(liveMessage, working);
  }
  return working;
}

function _resolveItemContextFromState(data = {}) {
  const castSource = data?.attacker?.castSource ?? null;
  const itemCtx = data?.context?.itemCastContext ?? null;
  return resolveItemContextFromCastSource(castSource, itemCtx);
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
  const mode = normalizeCastSourceCostMode(castSource);
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
  const byTraining = byAction.filter((s) => canActorCastSpell(attacker, s));

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
  const preferredRestraintProfile = resolveSpellProfile(preferredSpell, attacker, {
    isRestrained: true,
    isOverloaded: false
  });
  const preferredRestraintReduction = Number(preferredRestraintProfile?.cost?.effectiveRestraintReduction ?? preferredRestraintProfile?.cost?.restrained?.reduction ?? 0) || 0;

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
                <span><b>Spell Restraint</b> (reduce cost by ${preferredRestraintReduction} to min 1)</span>
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
                level: castLevel, // Alias for compatibility with existing resolvers
                restraintValue: Boolean(root?.querySelector('input[name="restrain"]')?.checked)
                  ? (Number(resolveSpellProfile(selectedSpell, attacker, {
                      level: castLevel,
                      isRestrained: true,
                      isOverloaded: false
                    })?.cost?.effectiveRestraintReduction ?? 0) || 0)
                  : 0
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
          const restraintLabel = root?.querySelector('#ues-restrain-group span');
          const restraintProfile = resolveSpellProfile(selectedSpell, attacker, {
            isRestrained: true,
            isOverloaded: false
          });
          const restraintReduction = Number(restraintProfile?.cost?.effectiveRestraintReduction ?? restraintProfile?.cost?.restrained?.reduction ?? 0) || 0;
          if (restraintLabel) {
            restraintLabel.innerHTML = `<b>Spell Restraint</b> (reduce cost by ${restraintReduction} to min 1)`;
          }
          
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

    if (!canActorCastSpell(attacker, spell)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
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
      const pool = getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
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

  // Fresh-state re-read: apply only attacker lane + context onto live state to preserve
  // any defender-side commit that arrived while the spell-selection dialog was open.
  await commitLaneToFreshCardState({
    message,
    readState: _readMagicOpposedFlagState,
    mutate: (_t) => {
      _t.attacker = foundry.utils.mergeObject(_t.attacker ?? {}, data.attacker, { overwrite: true, insertKeys: true });
      _t.context = foundry.utils.mergeObject(_t.context ?? {}, data.context, { overwrite: true, insertKeys: true });
      if (Array.isArray(data.defenders) && Array.isArray(_t.defenders)) {
        for (let _di = 0; _di < data.defenders.length; _di++) {
          if (_t.defenders[_di] && data.defenders[_di]) {
            _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], data.defenders[_di], { overwrite: true, insertKeys: true });
          }
        }
      }
    },
    updateCard: _updateCard,
    fallbackData: data,
  });

  // Auto-roll is triggered solely via the updateChatMessage hook path
  // (maybeAutoRollBanked) to prevent duplicate runs.
}

/**
 * Handle attacker roll action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleAttackerRoll(ctx) {
  const { message, data, attacker, spell, batchedUpdate, _updateCard, workflow } = ctx;
  let workingData = data;
  let claimId = null;

  try {
    const claim = await _acquireAttackerRollClaim(message, _updateCard);
    if (!claim?.acquired) return claim?.data;
    claimId = claim.claimId;
    workingData = claim.data ?? data;

    if (workingData?.attacker?.result) {
      return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
    }

    if (!_ignoreTraining(workingData) && !canActorCastSpell(attacker, spell)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
      return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
    }

    // Preflight: gate attack limit BEFORE any resource consumption.
    const spellClassification = classifySpellForRouting(spell);
    if (spellClassification.isAttack && game.combat) {
      if (AttackTracker.hasExceededLimit(attacker)) {
        ui.notifications.warn(AttackTracker.getLimitWarning(attacker) || "Attack limit reached for this round.");
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
    }

    // Preflight resources (AP + Magicka) before spending.
    const apCost = Number(workingData.attacker?.apCost ?? 1) || 1;
    const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
    const ignoreAP = _ignoreActionPoints(workingData);
    if (!ignoreAP && currentAP < apCost) {
      ui.notifications.warn("Not enough Action Points to cast a spell.");
      return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
    }

    const resourceSpec = _resolveCastResourceSpec(attacker, workingData, spell);
    if (_isMagickaCommitRequired(resourceSpec)) {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < Number(resourceSpec?.cost ?? 0)) {
        ui.notifications.warn(`Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${currentMagicka}.`);
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
    } else if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "soul") {
      const pool = getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
      if (pool.value < Number(resourceSpec?.cost ?? 0)) {
        ui.notifications.warn(`Not enough Soul Energy to cast ${spell?.name ?? "spell"}. Required: ${resourceSpec?.cost ?? 0}, Available: ${pool.value}.`);
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
    }

    const apReason = (String(workingData.attacker?.castActionType ?? "primary") === "secondary") ? "Cast Magic (Instant)" : "Cast Magic";
    if (!ignoreAP) {
      const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, { reason: apReason, silent: false });
      if (!apSpentOk) {
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
    }

    if (spellClassification.isAttack) {
      try {
        await AttackTracker.incrementAttacks(attacker);
      } catch (err) {
        console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      }
    }

    let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
    if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "soul") {
      const pool = getItemSoulPoolSnapshot(resourceSpec?.itemCtx);
      const next = Math.max(0, pool.value - Number(resourceSpec?.cost ?? 0));
      const updates = {
        [pool.poolPath]: next,
        "system.charge.value": next
      };
      const ok = resourceSpec?.itemCtx?.item ? await requestUpdateDocument(resourceSpec.itemCtx.item, updates) : false;
      if (!ok) {
        if (!ignoreAP) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) {
            // best-effort
          }
        }
        ui.notifications.warn("Failed to spend Soul Energy from enchanted item.");
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
      magickaSpend.consumed = Number(resourceSpec?.cost ?? 0) || 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else if (resourceSpec?.type === "enchantment" && resourceSpec?.mode === "none") {
      magickaSpend.consumed = 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else {
      magickaSpend = await consumeSpellMagicka(attacker, spell, workingData.attacker?.spellOptions ?? {});
      if (!magickaSpend?.ok) {
        if (!ignoreAP) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) {
            // best-effort
          }
        }
        return await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
      }
    }

    workingData.attacker.mpSpent = Number(magickaSpend.consumed ?? 0) || 0;
    workingData.attacker.mpRemaining = Number(magickaSpend.remaining ?? attacker?.system?.magicka?.value ?? 0) || 0;

    const defenders = getDefenderEntries(workingData);
    const primaryDef = defenders[0] ?? null;
    const targetActor = getActorFromResolvedDocument(resolveUuidSync(String(primaryDef?.actorUuid ?? "").trim()));
    const targetToken = (() => {
      const tokenUuid = String(primaryDef?.tokenUuid ?? "").trim();
      if (!tokenUuid) return null;
      return resolveUuidSync(tokenUuid)?.object ?? null;
    })();

    const castingTn = (workingData.attacker?.tn && typeof workingData.attacker.tn === "object")
      ? workingData.attacker.tn
      : { finalTN: Number(workingData.attacker?.tn?.finalTN ?? 0) || 0 };
    applyRuntimePreRollToTN({
      actor: attacker,
      targetActor,
      targetToken,
      item: spell,
      rollContext: workingData?.context?.rollContext,
      workflow: "magic",
      side: "attacker",
      attackMode: "magic",
      tn: castingTn
    });
    workingData.attacker.tn = castingTn;

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
      rollContext: workingData?.context?.rollContext,
      workflow: "magic",
      side: "attacker",
      attackMode: "magic",
      result,
      allowPrompt: true
    });
    _applyBindingStrengthFloorIfNeeded(workingData, result);

    await postMagicOpposedSubRoll({
    roll: result.roll,
    actor: attacker,
    flavor: `<b>${spell.name}</b> — Casting Test`,
    parentMessageId: message.id,
    stage: "attacker"
  });

    // Backfire (RAW / system rules)
    const needsBackfire = shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
    if (needsBackfire) {
      await triggerBackfire(attacker, spell);
    }

    // RAW: Spell Restraint reduces Magicka cost only on a successful spellcast.
    try {
      const refundInfo = (resourceSpec?.type === "enchantment" && resourceSpec?.mode !== "magicka")
        ? { finalCost: Number(magickaSpend?.consumed ?? 0) || 0, refund: 0, breakdown: [] }
        : await applySpellRestraintRefund(attacker, spell, workingData.attacker?.spellOptions ?? {}, result, magickaSpend);
      if (refundInfo?.refund > 0) {
        workingData.attacker.mpSpent = refundInfo.finalCost;
        workingData.attacker.mpRemaining = Number(attacker.system?.magicka?.value ?? workingData.attacker.mpRemaining);
        workingData.attacker.mpRefund = refundInfo.refund;
        workingData.attacker.mpRestraintBreakdown = refundInfo.breakdown;
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
        mpSpent: Number(workingData.attacker.mpSpent ?? magickaSpend?.consumed ?? 0) || 0,
        spellOptions: workingData.attacker?.spellOptions ?? {}
      });
    } catch (_e) { /* no-op */ }

    // Create Origin AE on the caster for persistent spells (only on success)
    if (result.isSuccess && spellRequiresOriginAE(spell)) {
      try {
        const defUuids = defenders.map((d) => d?.actorUuid).filter(Boolean);
        const originAE = await createOriginAE(attacker, spell, {
          costPaid: Number(workingData.attacker.mpSpent ?? magickaSpend?.consumed ?? 0) || 0,
          scalingChoices: (workingData.attacker?.spellOptions?.castLevel) ? { level: workingData.attacker.spellOptions.castLevel } : null,
          spellOptions: workingData.attacker?.spellOptions ?? {},
          targetUuids: defUuids,
          castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
          castSource: workingData.attacker?.castSource ?? null,
          casterTokenUuid: workingData.attacker?.tokenUuid ?? null
        });

        // Link AoE template to Origin AE if present
        if (originAE) {
          const tplUuid = workingData?.context?.aoe?.templateUuid ?? null;
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

    workingData.attacker.result = result;
    workingData.attacker.backfire = needsBackfire;
    if (result.isSuccess) {
      await _setEnchantmentUpkeepPointerIfNeeded(workingData, spell);
    }

  // Direct and healing spells skip the standard Block/Evade/Ward defense step
  // — resolve immediately.  Characteristic defense spells proceed to the
  // awaiting-defense phase so the defender can roll their characteristic save
  // (either via the chat card button or automatically in banked mode).
    workingData.context = workingData.context ?? {};
    workingData.context.attackerRollInFlight = null;
    const directNoDefense = Boolean(workingData.context?.healingDirect) || Boolean(spell?.system?.isDirect);
    if (directNoDefense) {
      for (const def of defenders) {
      def.noDefense = true;
      def.defenseType = def.defenseType || "-";
      def.tn = def.tn ?? null;
      def.result = def.result ?? { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };
      }
      workingData.context.phase = "resolved";
      for (let i = 0; i < defenders.length; i += 1) {
        const defActor = ctx.resolveActor(defenders[i]?.actorUuid);
        if (!defActor) continue;
        await workflow._resolveOutcome(message, workingData, attacker, defActor, { defenderIndex: i, batchedUpdate, spell });
      }
      return workingData;
    }

    workingData.context.phase = "awaiting-defense";
    ctx._markResolutionPhase(workingData);
    if (batchedUpdate) return workingData;
  // Fresh-state re-read: apply attacker result + context onto live state to preserve
  // any defender-side commit that arrived during the roll phase.
    await commitLaneToFreshCardState({
    message,
    readState: _readMagicOpposedFlagState,
    mutate: (_t) => {
      _t.attacker = foundry.utils.mergeObject(_t.attacker ?? {}, workingData.attacker, { overwrite: true, insertKeys: true });
      _t.context = foundry.utils.mergeObject(_t.context ?? {}, workingData.context, { overwrite: true, insertKeys: true });
      if (Array.isArray(workingData.defenders) && Array.isArray(_t.defenders)) {
        for (let _di = 0; _di < workingData.defenders.length; _di++) {
          if (_t.defenders[_di] && workingData.defenders[_di]) {
            _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], workingData.defenders[_di], { overwrite: true, insertKeys: true });
          }
        }
      }
    },
    updateCard: _updateCard,
    fallbackData: workingData,
  });
    return workingData;
  } catch (err) {
    try {
      await _releaseAttackerRollClaim(message, workingData, _updateCard, claimId, { persist: true });
    } catch (_releaseErr) {
      // best-effort
    }
    throw err;
  }
}
