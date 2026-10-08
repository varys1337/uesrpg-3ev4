import { escapeHtml as _escapeHtml } from '../../../utils/html.js';
/**
 * Canonical spell options dialog used by core and UI casting flows.
 */

import { getKnownSpellScalingLevels, getSpellCost, getSpellLevel, computeMagicCastingTN } from "../magicka-utils.js";
import { SKILL_DIFFICULTIES } from "../../skills/skill-tn.js";
import { resolveSpellProfile } from "../spell-profile.js";
import { buildCastingOptionPresentation } from "./casting-option-presentation.js";
import { hasTalent } from "../../traits/talents-api.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { t, tf } from "../../../utils/i18n.js";
import { createLogger } from "../../../utils/debug.js";
import { systemTooltipAttributes, setSystemOptionTooltip, setSystemTooltip } from "../../../ui/shared/system-tooltips.js";
import { renderTNPill, updateTNPill } from "../../../ui/shared/tn-presentation.js";

const LOG = createLogger("UESRPG | Spell options dialog |", {
  debugSettingKey: "spellCastingDebug",
});



function _getCastSourceResourcePresentation(castContext = null, spell = null) {
  const castSource = castContext?.castSource ?? castContext ?? null;
  const mode = String(castSource?.costMode ?? "").trim().toLowerCase();
  if (castSource?.type !== "enchantment") {
    const defaultLevel = castContext?.castLevel ?? null;
    return {
      mode: "magicka",
      fixedCost: null,
      baseCost: getSpellCost(spell, defaultLevel),
      label: t("UESRPG.UI.Magicka", "Magicka")
    };
  }

  if (mode === "none") {
    return {
      mode,
      fixedCost: 0,
      baseCost: 0,
      label: t("UESRPG.Sheets.Item.NoCost", "No Cost")
    };
  }

  if (mode === "soul") {
    const fixedCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
    return {
      mode,
      fixedCost,
      baseCost: fixedCost,
      label: t("UESRPG.UI.SoulEnergy", "Soul Energy")
    };
  }

  if (mode === "magicka") {
    const fixedCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
    return {
      mode,
      fixedCost,
      baseCost: fixedCost,
      label: t("UESRPG.UI.Magicka", "Magicka")
    };
  }

  return {
    mode: "magicka",
    fixedCost: null,
    baseCost: Number(getSpellCost(spell, castContext?.castLevel ?? null) ?? 0) || 0,
    label: t("UESRPG.UI.Magicka", "Magicka")
  };
}

/**
 * Show spell options dialog for Restraint/Overload.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object|null} castContext
 * @returns {Promise<object|null>}
 */
export async function showSpellOptionsDialog(actor, spell, castContext = null) {
  const hasOverload = Boolean(spell.system?.hasOverload);
  const hasOverchargeTalent = hasTalent(actor, "overcharge");
  const hasMagickaCyclingTalent = hasTalent(actor, "magickacycling");
  const hasMasterOfMagickaTalent = hasTalent(actor, "masterofmagicka");
  const resourcePresentation = _getCastSourceResourcePresentation(castContext, spell);
  const learnedScalingLevels = getKnownSpellScalingLevels(spell);
  const baseLevel = Number(learnedScalingLevels[0]?.level ?? getSpellLevel(spell)) || 1;
  const baseCost = Number(resourcePresentation.baseCost ?? getSpellCost(spell, baseLevel) ?? 0);

  const scalingLevels = (Array.isArray(learnedScalingLevels) ? learnedScalingLevels : [])
    .filter(entry => {
      if (!entry || typeof entry !== "object") return false;
      const lvl = Number(entry.level ?? 0);
      return Number.isFinite(lvl) && lvl > 0;
    });

  const hasScaling = scalingLevels.length > 0;
  const initialPresentation = buildCastingOptionPresentation(actor, spell, {
    level: baseLevel, isRestrained: !hasOverload,
    hasMasterOfMagicka: hasMasterOfMagickaTalent,
    fixedCost: resourcePresentation.fixedCost,
    resourceLabel: resourcePresentation.fixedCost != null ? resourcePresentation.label : "MP",
  });
  const baseProfile = initialPresentation.profile;
  const formatPreviewCostValue = (cost) => {
    const safeCost = Math.max(0, Number(cost ?? 0) || 0);
    if (resourcePresentation.fixedCost != null) {
      if (resourcePresentation.mode === "none") return "0";
      return `${safeCost} ${resourcePresentation.label}`;
    }
    return `${safeCost} MP`;
  };
  const buildPreviewCostHtml = (cost) => `<span class="uesrpg-spell-profile-card__value-main">${_escapeHtml(formatPreviewCostValue(cost))}</span>`;
  const formatLevelCostText = (cost) => {
    if (resourcePresentation.fixedCost != null) {
      return resourcePresentation.mode === "none"
        ? t("UESRPG.Sheets.Item.NoCost", "No Cost")
        : `${cost} ${resourcePresentation.label}`;
    }
    return `${cost} MP`;
  };

  const content = `
    <div class="uesrpg uesrpg-spell-options uesrpg-dialog-stack uesrpg-adv-dialog uesrpg-adv-dialog--spell-options uesrpg-adv-dialog--choice-bars">
      <div class="uesrpg-spell-options__head"><h3 class="uesrpg-spell-options__title">${_escapeHtml(spell.name)}</h3>${renderTNPill("casting")}</div>
      <div id="profilePreview" class="uesrpg-spell-profile-card">
        <div class="uesrpg-spell-profile-card__item">
          <span class="uesrpg-spell-profile-card__label">${t("UESRPG.Dialogs.SpellOptions.Cost", "Cost")}</span>
          <span id="previewCost" class="uesrpg-spell-profile-card__value" tabindex="0" ${systemTooltipAttributes({ text: initialPresentation.costHelp })}>${buildPreviewCostHtml(baseCost)}</span>
        </div>
        <div class="uesrpg-spell-profile-card__item">
          <span class="uesrpg-spell-profile-card__label">${t("UESRPG.Dialogs.SpellOptions.SpellStrength", "Spell Strength")}</span>
          <span id="previewDamage" class="uesrpg-spell-profile-card__value">${_escapeHtml(baseProfile.damage.formula || t("UESRPG.UI.NotAvailable", "N/A"))}</span>
        </div>
        <div class="uesrpg-spell-profile-card__item">
          <span class="uesrpg-spell-profile-card__label">${t("UESRPG.Dialogs.SpellOptions.DurationLabel", "Duration")}</span>
          <span id="previewDuration" class="uesrpg-spell-profile-card__value">${tf("UESRPG.Dialogs.SpellOptions.DurationValue", { value: spell.system.duration?.value || 0, unit: spell.system.duration?.unit || t("UESRPG.Dialogs.SpellOptions.Instant", "instant") }, `${spell.system.duration?.value || 0} ${spell.system.duration?.unit || "instant"}`)}</span>
        </div>
      </div>
      ${hasScaling ? `
      <div class="form-group">
        <label><b>${t("UESRPG.Dialogs.SpellOptions.CastAtLevel", "Cast at Level")}</b></label>
        <select name="castLevel" id="castLevelSelect">
          ${scalingLevels.map((entry, idx) => {
            const lvl = entry.level ?? 1;
            const cost = resourcePresentation.fixedCost ?? entry.cost ?? baseCost;
            const strength = String(entry.spellStrengthFormula ?? "").trim();
            const strengthText = strength ? `, SS ${strength}` : ", SS WB";
            const desc = entry.description ? ` - ${entry.description}` : "";
            return `<option value="${lvl}" data-scaling-index="${idx}" ${idx === 0 ? "selected" : ""}>Level ${lvl} (${formatLevelCostText(cost)}${strengthText})${desc}</option>`;
          }).join("")}
        </select>
      </div>` : ""}
      <div class="form-group">
        <label><b>${t("UESRPG.Dialogs.SpellOptions.Difficulty", "Difficulty")}</b></label>
        <select name="difficultyKey">
          ${SKILL_DIFFICULTIES.map(df => {
            const sign = df.mod >= 0 ? "+" : "";
            const sel = df.key === "average" ? "selected" : "";
            return `<option value="${df.key}" ${sel}>${_escapeHtml(df.label)} (${sign}${df.mod})</option>`;
          }).join("\n")}
        </select>
      </div>
      <div class="form-group">
        <label><b>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}</b></label>
        <input type="number" name="manualModifier" value="0" />
      </div>
      <div class="uesrpg-dialog-section-header">${t("UESRPG.Dialogs.SpellOptions.CastingOptions", "Casting Options")}</div>
      <div class="uesrpg-spell-option-grid ${hasOverload || hasOverchargeTalent ? "" : "uesrpg-spell-option-grid--single"}">
        <label class="uesrpg-adv-choice uesrpg-choice-bar" id="restrainGroup" ${systemTooltipAttributes({ text: initialPresentation.restraintHelp })}>
          <input type="checkbox" name="restrain" id="restrainCheckbox" ${!hasOverload ? "checked" : ""} />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title" data-ues-restraint-label>${_escapeHtml(initialPresentation.restraintLabel)}</span>
          </span>
        </label>
        ${hasOverload ? `
        <label class="uesrpg-adv-choice uesrpg-choice-bar" id="overloadGroup" ${systemTooltipAttributes({ text: initialPresentation.overloadHelp })}>
          <input type="checkbox" name="overload" id="overloadCheckbox" />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.SpellOptions.Overload", "Overload")}</span>
          </span>
        </label>
        ` : ""}
      ${hasOverchargeTalent ? `
          <label class="uesrpg-adv-choice uesrpg-choice-bar ${hasOverload ? "uesrpg-defense-grid__full" : ""}" ${systemTooltipAttributes({ text: initialPresentation.overchargeHelp })}>
          <input type="checkbox" name="overcharge" />
          <span class="uesrpg-adv-choice__label"><b>${t("UESRPG.Dialogs.SpellOptions.Overcharge", "Overcharge")}</b></span>
          </label>
      ` : ""}
      </div>
    </div>
  `;

  return await customDialog({
    layout: "workflow",
    title: t("UESRPG.Dialogs.SpellOptions.Title", "Spell Options"),
    content,
    buttons: {
      cast: {
        label: t("UESRPG.Sheets.Item.Cast", "Cast"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];

          const difficultyKey = String(root?.querySelector('[name="difficultyKey"]')?.value ?? "average");
          const manualModifierRaw = root?.querySelector('[name="manualModifier"]')?.value ?? "0";
          const manualModifier = Number.parseInt(String(manualModifierRaw ?? "0"), 10) || 0;
          const castLevelRaw = root?.querySelector('[name="castLevel"]')?.value ?? String(baseLevel);
          const castLevel = hasScaling ? (Number.parseInt(String(castLevelRaw), 10) || baseLevel) : baseLevel;
          const requestedRestraint = root?.querySelector('[name="restrain"]')?.checked ?? false;
          const requestedOverload = root?.querySelector('[name="overload"]')?.checked ?? false;
          const isRestrained = requestedRestraint;
          const isOverloaded = hasMasterOfMagickaTalent ? requestedOverload : (requestedOverload && !requestedRestraint);
          const useOvercharge = root?.querySelector('[name="overcharge"]')?.checked ?? false;

          return {
            isRestrained,
            isOverloaded,
            useOvercharge,
            useMagickaCycling: hasMagickaCyclingTalent,
            difficultyKey,
            circumstanceMod: 0,
            manualModifier,
            restraintValue: Number(isRestrained)
              ? (Number(resolveSpellProfile(spell, actor, {
                  level: castLevel,
                  isRestrained: true,
                  isOverloaded: false,
                  useOvercharge
                })?.cost?.effectiveRestraintReduction ?? 0) || 0)
              : 0,
            baseCost,
            castLevel
          };
        }
      },
      cancel: {
        label: t("UESRPG.UI.Cancel", "Cancel"),
        callback: () => null
      }
    },
    default: "cast",
    classes: ["uesrpg-attack-declare"],
    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const castLevelSelect = root?.querySelector("#castLevelSelect");
      const restrainCheckbox = root?.querySelector("#restrainCheckbox");
      const overloadCheckbox = root?.querySelector("#overloadCheckbox");
      const restrainGroup = root?.querySelector("#restrainGroup");
      const overloadGroup = root?.querySelector("#overloadGroup");
      const overchargeCheckbox = root?.querySelector('input[name="overcharge"]');
      const previewCost = root?.querySelector("#previewCost");
      const previewDamage = root?.querySelector("#previewDamage");
      const previewDuration = root?.querySelector("#previewDuration");
      const difficultySelect = root?.querySelector('[name="difficultyKey"]');
      const manualInput = root?.querySelector('[name="manualModifier"]');

      const syncCastingOptionState = (changed = null) => {
        if (!hasOverload || !restrainCheckbox || !overloadCheckbox) return;
        if (hasMasterOfMagickaTalent) {
          restrainGroup?.classList.remove("is-incompatible");
          overloadGroup?.classList.remove("is-incompatible");
          return;
        }

        if (changed === "restrain" && restrainCheckbox.checked) overloadCheckbox.checked = false;
        if (changed === "overload" && overloadCheckbox.checked) restrainCheckbox.checked = false;

        const overloadBlocked = restrainCheckbox.checked;
        const restrainBlocked = overloadCheckbox.checked;
        overloadGroup?.classList.toggle("is-incompatible", overloadBlocked);
        restrainGroup?.classList.toggle("is-incompatible", restrainBlocked);
      };

      const updatePreview = () => {
        const selectedLevel = parseInt(castLevelSelect?.value ?? baseLevel, 10) || baseLevel;
        const isRestrained = restrainCheckbox?.checked ?? false;
        const isOverloaded = overloadCheckbox?.checked ?? false;
        const useOvercharge = overchargeCheckbox?.checked ?? false;

        const tn = computeMagicCastingTN(actor, spell, {
          ...castContext,
          castLevel: selectedLevel, level: selectedLevel,
          difficultyKey: difficultySelect?.value ?? "average",
          circumstanceMod: 0,
          manualModifier: Number.parseInt(manualInput?.value, 10) || 0,
          isRestrained, isOverloaded, useOvercharge,
          useMagickaCycling: hasMagickaCyclingTalent,
        });
        updateTNPill(root, "casting", tn, { automatic: castContext?.castSource?.skipCastingTest === true });

        try {
          const presentation = buildCastingOptionPresentation(actor, spell, {
            level: selectedLevel,
            isRestrained,
            isOverloaded,
            useOvercharge,
            hasMasterOfMagicka: hasMasterOfMagickaTalent,
            fixedCost: resourcePresentation.fixedCost,
            resourceLabel: resourcePresentation.fixedCost != null ? resourcePresentation.label : "MP",
          });
          const { profile } = presentation;
          const restraintLabel = restrainGroup?.querySelector("[data-ues-restraint-label]");
          if (restraintLabel) restraintLabel.textContent = presentation.restraintLabel;
          setSystemOptionTooltip(restrainCheckbox, presentation.restraintHelp);
          setSystemOptionTooltip(overloadCheckbox, presentation.overloadHelp);
          setSystemOptionTooltip(overchargeCheckbox, presentation.overchargeHelp);
          if (previewCost) {
            if (resourcePresentation.fixedCost != null) {
              previewCost.innerHTML = buildPreviewCostHtml(resourcePresentation.fixedCost);
            } else {
              previewCost.innerHTML = buildPreviewCostHtml(profile.cost.attempt);
            }
            setSystemTooltip(previewCost, { text: presentation.costHelp });
          }
          if (previewDamage) previewDamage.textContent = profile.damage.formula || t("UESRPG.UI.NotAvailable", "N/A");
          if (previewDuration) previewDuration.textContent = tf("UESRPG.Dialogs.SpellOptions.DurationValue", { value: profile.duration.value || 0, unit: profile.duration.unit || t("UESRPG.Dialogs.SpellOptions.Instant", "instant") }, `${profile.duration.value || 0} ${profile.duration.unit || "instant"}`);
        } catch (err) {
          LOG.debug("Failed to update spell profile preview", {
            actorUuid: actor?.uuid ?? null,
            spellUuid: spell?.uuid ?? null,
            spellName: spell?.name ?? null,
            err,
          });
        }
      };

      if (castLevelSelect) castLevelSelect.addEventListener("change", updatePreview);
      difficultySelect?.addEventListener("change", updatePreview);
      manualInput?.addEventListener("input", updatePreview);
      if (restrainCheckbox) {
        restrainCheckbox.addEventListener("change", () => {
          syncCastingOptionState("restrain");
          updatePreview();
        });
      }
      if (overloadCheckbox) {
        overloadCheckbox.addEventListener("change", () => {
          syncCastingOptionState("overload");
          updatePreview();
        });
      }
      if (overchargeCheckbox) overchargeCheckbox.addEventListener("change", updatePreview);
      syncCastingOptionState();
      updatePreview();
    },
    width: 450
  });
}
