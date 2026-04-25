/**
 * src/core/magic/opposed/actions/defender-commit.js
 *
 * Defender commit handler for magic opposed tests (banked mode).
 * Banks the defender's choice of defense type before the roll phase.
 */

import { hasEquippedShield } from "../../../combat/tn.js";
import { hasActiveWard } from "../../../combat/ward-defense.js";
import { ensureBankedScaffold } from "../schema.js";
import { resolveToken } from "../schema.js";
import { cloneFlagState } from "../../../../utils/clone.js";
import { FLAG_SCOPE } from "../../../system/namespace.js";
import { commitLaneToFreshCardState } from "../../../opposed/shared/fresh-commit.js";

/** @private — Clone current magic opposed state from a live message for lane-commit merging. */
function _readMagicOpposedFlagState(fm) {
  const raw = fm?.flags?.[FLAG_SCOPE]?.magicOpposed ?? null;
  const state = (raw?.state && typeof raw.state === "object") ? raw.state : null;
  return state ? cloneFlagState(state) : null;
}
import { computeCharacteristicDefenseTN } from "../../characteristic-defense-service.js";
import { buildMagicCastContext } from "../cast-context.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";
import { hasCondition } from "../../../conditions/condition-engine.js";
import { markDefenderNoDefense } from "../../../combat/opposed/actions/eligibility.js";
import { t } from "../../../../utils/i18n.js";

/** @private */
function syncDefenderToData(data, defender, defenderIndex) {
  if (defenderIndex != null && Array.isArray(data.defenders)) {
    data.defenders[defenderIndex] = defender;
  }
  data.defender = defender;
}

/** @private */
async function promptDefenseCommitChoice(defenderActor) {
  const canBlock = hasEquippedShield(defenderActor);
  const canWard = hasActiveWard(defenderActor);
  return await customDialog({
    title: t("UESRPG.Dialogs.Opposed.CommitDefense", "Commit Defense"),
    content: `
      <div class="uesrpg defense-dialog uesrpg-adv-dialog uesrpg-adv-dialog--magic-commit">
        <div class="uesrpg-dialog-section-header">${t("UESRPG.Dialogs.Opposed.DefenseResponse", "Defense Response")}</div>
        <div class="uesrpg-adv-grid uesrpg-defense-grid">
          <label class="uesrpg-adv-choice def-opt">
            <input type="radio" name="defenseType" value="evade" checked/>
            <span class="uesrpg-adv-choice__label def-opt__card">
              <span class="uesrpg-defense-card__head">
                <span class="uesrpg-adv-choice__title">${t("UESRPG.Chat.Opposed.Evade", "Evade")}</span>
              </span>
              <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.UseEvadeTN", "Use Evade TN.")}</span>
            </span>
          </label>
          <label class="uesrpg-adv-choice def-opt ${canBlock ? "" : "is-disabled"}"${canBlock ? "" : ' style="pointer-events:none;"'}>
            <input type="radio" name="defenseType" value="block" ${canBlock ? "" : "disabled"}/>
            <span class="uesrpg-adv-choice__label def-opt__card">
              <span class="uesrpg-defense-card__head">
                <span class="uesrpg-adv-choice__title">${t("UESRPG.Chat.Opposed.Block", "Block")}</span>
              </span>
              <span class="uesrpg-adv-choice__desc">${canBlock ? t("UESRPG.Dialogs.Opposed.UseBlockTN", "Use Block TN.") : t("UESRPG.Dialogs.Opposed.RequiresEquippedShield", "Requires equipped shield.")}</span>
            </span>
          </label>
          ${canWard ? `
          <label class="uesrpg-adv-choice def-opt uesrpg-defense-grid__full">
            <input type="radio" name="defenseType" value="ward"/>
            <span class="uesrpg-adv-choice__label def-opt__card">
              <span class="uesrpg-defense-card__head">
                <span class="uesrpg-adv-choice__title">${t("UESRPG.Chat.Opposed.Ward", "Ward")}</span>
              </span>
              <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.WardDefenseDesc", "BR = Spell Strength. Power Block incompatible.")}</span>
            </span>
          </label>` : ""}
        </div>
        <div class="form-group">
          <label><b>${t("UESRPG.Dialogs.Opposed.CircumstanceModifier", "Circumstance Modifier")}</b></label>
          <select name="circumstanceMod" style="width:100%;">
            ${buildCircumstanceOptionsHtml(0)}
          </select>
        </div>
        <div class="form-group">
          <label><b>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}</b></label>
          <input type="number" name="manualMod" value="0" step="1" />
        </div>
      </div>
    `,
    classes: ["uesrpg-attack-declare"],
    buttons: {
      confirm: {
        icon: '<i class="fas fa-check"></i>',
        label: t("UESRPG.Chat.Opposed.CommitChoices", "Commit"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const defenseTypeRaw = String(root?.querySelector('[name="defenseType"]:checked')?.value ?? "evade");
          const defenseType = (defenseTypeRaw === "block" && canBlock)
            ? "block"
            : (defenseTypeRaw === "ward" && canWard)
              ? "ward"
              : "evade";
          const manualMod = Number(root?.querySelector('[name="manualMod"]')?.value ?? 0) || 0;
          const circumstanceMod = Number(root?.querySelector('[name="circumstanceMod"]')?.value ?? 0) || 0;
          return { defenseType, manualMod, circumstanceMod };
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: t("UESRPG.UI.Cancel", "Cancel"),
        callback: () => null
      }
    },
    defaultButton: "confirm",
    width: 520,
  });
}

/**
 * Handle defender commit actions (banked mode).
 * @param {object} ctx - Context object
 * @param {string} action - Action type
 * @returns {Promise<void>}
 */
export async function handleDefenderCommit(ctx, action) {
  const { message, data, attacker, defender, defenderActor, bankMode, _updateCard } = ctx;

  if (!bankMode) return;
  if (defender?.result || defender?.noDefense) return;

  let selectedDefense = null;
  let selectedManualMod = 0;
  let selectedCircumstanceMod = 0;
  const isCharacteristicAction = action === "defender-commit-characteristic";

  if (!isCharacteristicAction && hasCondition(defenderActor, "helpless")) {
    ensureBankedScaffold(data);
    defender.banked.committed = true;
    defender.banked.committedAt = Date.now();
    defender.banked.committedBy = "system";
    defender.banked.forced = true;
    defender.banked.reason = "helpless";
    markDefenderNoDefense(defender, "Helpless");
    syncDefenderToData(data, defender, ctx.defenderIndex);
    await commitLaneToFreshCardState({
      message,
      readState: _readMagicOpposedFlagState,
      mutate: (_t) => {
        _t.defender = foundry.utils.mergeObject(_t.defender ?? {}, data.defender ?? {}, { overwrite: true, insertKeys: true });
        _t.context = foundry.utils.mergeObject(_t.context ?? {}, data.context ?? {}, { overwrite: true, insertKeys: true });
        const _di = Number(ctx.defenderIndex ?? 0);
        if (Number.isFinite(_di) && _di >= 0 && Array.isArray(data.defenders) && Array.isArray(_t.defenders) && _t.defenders[_di] && data.defenders[_di]) {
          _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], data.defenders[_di], { overwrite: true, insertKeys: true });
        }
      },
      updateCard: _updateCard,
      fallbackData: data,
    });
    return;
  }

  if (action === "defender-commit-characteristic") {
    selectedDefense = "characteristic-save";

    const spell = ctx.spell ?? (data.attacker?.spellUuid ? await ctx._uuidResolver.resolve(data.attacker.spellUuid) : null);
    if (spell) {
      const tnData = computeCharacteristicDefenseTN(defenderActor, spell, {
        attacker: data?.attacker ?? {},
        castContext: buildMagicCastContext(data?.attacker ?? {}, spell)
      });
      if (tnData) {
        defender.tn = {
          finalTN: tnData.finalTN,
          baseTN: tnData.baseTN,
          totalMod: tnData.totalMod,
          breakdown: tnData.breakdown
        };
        defender.characteristicLabel = tnData.chaLabel;
      }
    }
  } else if (action === "defender-commit") {
    const picked = await promptDefenseCommitChoice(defenderActor);
    if (!picked) return;
    selectedDefense = picked.defenseType;
    selectedManualMod = Number(picked.manualMod ?? 0) || 0;
    selectedCircumstanceMod = Number(picked.circumstanceMod ?? 0) || 0;
  }

  const { defenderIndex } = ctx;
  syncDefenderToData(data, defender, defenderIndex);

  let commitAsNoDefense = action === "defender-commit-nodefense";
  if (!commitAsNoDefense && !isCharacteristicAction) {
    const apCost = Number(defender?.apCost ?? 1) || 1;
    const currentAP = Number(foundry.utils.getProperty(defenderActor, "system.action_points.value") ?? 0);
    if (currentAP < apCost) {
      ui.notifications.info(`Not enough Action Points for defense (${currentAP}/${apCost}); committing No Defense.`);
      commitAsNoDefense = true;
    }
  }

  ensureBankedScaffold(data);

  if (commitAsNoDefense) {
    defender.defenseType = "none";
    defender.noDefense = true;
    defender.tn = { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
    defender.result = { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };
  } else {
    const defenseType = selectedDefense ?? ((action === "defender-commit-block") ? "block" : "evade");
    defender.defenseType = defenseType;
    defender.noDefense = false;
    defender.declared = {
      manualMod: selectedManualMod,
      circumstanceMod: selectedCircumstanceMod
    };
  }

  defender.banked.committed = true;
  defender.banked.committedAt = Date.now();
  defender.banked.committedBy = game.user.id;

  syncDefenderToData(data, defender, defenderIndex);

  // Fresh-state re-read: apply only defender lane + context onto live state to preserve
  // any attacker-side commit that arrived while the defense dialog was open.
  await commitLaneToFreshCardState({
    message,
    readState: _readMagicOpposedFlagState,
    mutate: (_t) => {
      _t.defender = foundry.utils.mergeObject(_t.defender ?? {}, data.defender ?? {}, { overwrite: true, insertKeys: true });
      _t.context = foundry.utils.mergeObject(_t.context ?? {}, data.context ?? {}, { overwrite: true, insertKeys: true });
      const _di = Number(defenderIndex ?? 0);
      if (Number.isFinite(_di) && _di >= 0 && Array.isArray(data.defenders) && Array.isArray(_t.defenders) && _t.defenders[_di] && data.defenders[_di]) {
        _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], data.defenders[_di], { overwrite: true, insertKeys: true });
      }
    },
    updateCard: _updateCard,
    fallbackData: data,
  });
}
