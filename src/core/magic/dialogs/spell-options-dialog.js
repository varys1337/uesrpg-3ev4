/**
 * Canonical spell options dialog used by core and UI casting flows.
 */

import { getKnownSpellScalingLevels, getSpellCost, getSpellLevel } from "../magicka-utils.js";
import { SKILL_DIFFICULTIES } from "../../skills/skill-tn.js";
import { resolveSpellProfile } from "../spell-profile.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { buildCircumstanceOptionsHtml } from "../../opposed/circumstance.js";
import { t, tf } from "../../../utils/i18n.js";

function _getCastSourceResourcePresentation(castContext = null, spell = null) {
  const castSource = castContext?.castSource ?? castContext ?? null;
  const mode = String(castSource?.costMode ?? "").trim().toLowerCase();
  if (castSource?.type !== "enchantment") {
    const defaultLevel = castContext?.castLevel ?? null;
    return {
      mode: "magicka",
      fixedCost: null,
      baseCost: getSpellCost(spell, defaultLevel),
      label: t("UESRPG.UI.Magicka", "Magicka"),
      baseCostText: (cost) => tf("UESRPG.Dialogs.SpellOptions.BaseMpCost", { cost }, `Base MP Cost: ${cost}`),
      costPreviewText: (cost, suffix = "") => tf("UESRPG.Dialogs.SpellOptions.CostMpWithSuffix", { cost, suffix }, `Cost: ${cost} MP${suffix}`)
    };
  }

  if (mode === "none") {
    return {
      mode,
      fixedCost: 0,
      baseCost: 0,
      label: t("UESRPG.Sheets.Item.NoCost", "No Cost"),
      baseCostText: () => `${t("UESRPG.Sheets.Item.NoCost", "No Cost")}: 0`,
      costPreviewText: () => `${t("UESRPG.Sheets.Item.NoCost", "No Cost")}: 0`
    };
  }

  if (mode === "soul") {
    const fixedCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
    return {
      mode,
      fixedCost,
      baseCost: fixedCost,
      label: t("UESRPG.UI.SoulEnergy", "Soul Energy"),
      baseCostText: (cost) => `${t("UESRPG.UI.SoulEnergy", "Soul Energy")}: ${cost}`,
      costPreviewText: (cost) => `${t("UESRPG.UI.SoulEnergy", "Soul Energy")}: ${cost}`
    };
  }

  if (mode === "magicka") {
    const fixedCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
    return {
      mode,
      fixedCost,
      baseCost: fixedCost,
      label: t("UESRPG.UI.Magicka", "Magicka"),
      baseCostText: (cost) => tf("UESRPG.Dialogs.SpellOptions.BaseMpCost", { cost }, `Base MP Cost: ${cost}`),
      costPreviewText: (cost, suffix = "") => tf("UESRPG.Dialogs.SpellOptions.CostMpWithSuffix", { cost, suffix }, `Cost: ${cost} MP${suffix}`)
    };
  }

  return {
    mode: "magicka",
    fixedCost: null,
    baseCost: Number(getSpellCost(spell, castContext?.castLevel ?? null) ?? 0) || 0,
    label: t("UESRPG.UI.Magicka", "Magicka"),
    baseCostText: (cost) => tf("UESRPG.Dialogs.SpellOptions.BaseMpCost", { cost }, `Base MP Cost: ${cost}`),
    costPreviewText: (cost, suffix = "") => tf("UESRPG.Dialogs.SpellOptions.CostMpWithSuffix", { cost, suffix }, `Cost: ${cost} MP${suffix}`)
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
  const hasOverchargeTalent = actor.items?.some(i => i.type === "talent" && i.name === "Overcharge") ?? false;
  const hasMagickaCyclingTalent = actor.items?.some(i => i.type === "talent" && i.name === "Magicka Cycling") ?? false;
  const resourcePresentation = _getCastSourceResourcePresentation(castContext, spell);
  const learnedScalingLevels = getKnownSpellScalingLevels(spell);
  const baseLevel = Number(learnedScalingLevels[0]?.level ?? getSpellLevel(spell)) || 1;
  const baseCost = Number(resourcePresentation.baseCost ?? getSpellCost(spell, baseLevel) ?? 0);
  const baseProfile = resolveSpellProfile(spell, actor, { isRestrained: true, isOverloaded: false });
  const baseRestraintReduction = Number(baseProfile?.cost?.effectiveRestraintReduction ?? baseProfile?.cost?.restrained?.reduction ?? 0) || 0;

  const scalingLevels = (Array.isArray(learnedScalingLevels) ? learnedScalingLevels : [])
    .filter(entry => {
      if (!entry || typeof entry !== "object") return false;
      const lvl = Number(entry.level ?? 0);
      return Number.isFinite(lvl) && lvl > 0;
    });

  const hasScaling = scalingLevels.length > 0;
  const formatLevelCostText = (cost) => {
    if (resourcePresentation.fixedCost != null) {
      return resourcePresentation.mode === "none"
        ? t("UESRPG.Sheets.Item.NoCost", "No Cost")
        : `${cost} ${resourcePresentation.label}`;
    }
    return `${cost} MP`;
  };

  const content = `
    <div class="uesrpg-spell-options">
      <h3>${spell.name}</h3>
      <div class="form-group">
        <label>${resourcePresentation.baseCostText(baseCost)}</label>
      </div>
      ${hasScaling ? `
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>${t("UESRPG.Dialogs.SpellOptions.CastAtLevel", "Cast at Level")}</b></label>
        <select name="castLevel" id="castLevelSelect" style="width:100%;">
          ${scalingLevels.map((entry, idx) => {
            const lvl = entry.level ?? 1;
            const cost = resourcePresentation.fixedCost ?? entry.cost ?? baseCost;
            const strength = String(entry.spellStrengthFormula ?? "").trim();
            const strengthText = strength ? `, SS ${strength}` : ", SS WB";
            const desc = entry.description ? ` - ${entry.description}` : "";
            return `<option value="${lvl}" data-scaling-index="${idx}" ${idx === 0 ? "selected" : ""}>Level ${lvl} (${formatLevelCostText(cost)}${strengthText})${desc}</option>`;
          }).join("")}
        </select>
      </div>
      <div id="profilePreview" class="form-group" style="background:#f0f0f0; padding:8px; border-radius:4px; font-size:0.9em;">
        <strong>${t("UESRPG.Dialogs.SpellOptions.ProfilePreview", "Profile Preview")}:</strong><br/>
        <span id="previewCost">${resourcePresentation.costPreviewText(baseCost)}</span><br/>
        <span id="previewDamage">Formula: ${spell.system.damageFormula || t("UESRPG.UI.NotAvailable", "N/A")}</span><br/>
        <span id="previewDuration">${tf("UESRPG.Dialogs.SpellOptions.Duration", { value: spell.system.duration?.value || 0, unit: spell.system.duration?.unit || t("UESRPG.Dialogs.SpellOptions.Instant", "instant") }, `Duration: ${spell.system.duration?.value || 0} ${spell.system.duration?.unit || "instant"}`)}</span>
      </div>` : ""}
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>${t("UESRPG.Dialogs.SpellOptions.Difficulty", "Difficulty")}</b></label>
        <select name="difficultyKey" style="width:100%;">
          ${SKILL_DIFFICULTIES.map(df => {
            const sign = df.mod >= 0 ? "+" : "";
            const sel = df.key === "average" ? "selected" : "";
            return `<option value="${df.key}" ${sel}>${df.label} (${sign}${df.mod})</option>`;
          }).join("\n")}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:8px;">
        <label style="display:block;"><b>${t("UESRPG.Dialogs.Opposed.CircumstanceModifier", "Circumstance Modifier")}</b></label>
        <select name="circumstanceMod" style="width:100%;">
          ${buildCircumstanceOptionsHtml(0)}
        </select>
      </div>
      <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}</b></label>
        <input type="number" name="manualModifier" value="0" style="width:120px; text-align:center;" />
      </div>
      <hr style="margin: 10px 0;"/>
      <div class="form-group" id="restrainGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="restrain" id="restrainCheckbox" ${!hasOverload ? "checked" : ""} />
          <span><b>${t("UESRPG.Dialogs.SpellOptions.SpellRestraint", "Spell Restraint")}</b> ${tf("UESRPG.Dialogs.SpellOptions.ReduceCostMin", { value: baseRestraintReduction }, `(reduce cost by ${baseRestraintReduction} to min 1)`)}</span>
        </label>
      </div>
      ${hasOverload ? `
      <div class="form-group" id="overloadGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overload" id="overloadCheckbox" />
          <span><b>${t("UESRPG.Dialogs.SpellOptions.Overload", "Overload")}</b> (${spell.system.overloadEffect || t("UESRPG.Dialogs.SpellOptions.OverloadDefault", "double cost for enhanced effect")})</span>
        </label>
      </div>` : ""}
      ${hasOverchargeTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overcharge" />
          <span><b>${t("UESRPG.Dialogs.SpellOptions.Overcharge", "Overcharge")}</b> ${t("UESRPG.Dialogs.SpellOptions.TalentOption", "(talent option)")}</span>
        </label>
      </div>` : ""}
      ${hasMagickaCyclingTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="magickaCycling" />
          <span><b>${t("UESRPG.Dialogs.SpellOptions.MagickaCycling", "Magicka Cycling")}</b> ${t("UESRPG.Dialogs.SpellOptions.TalentOption", "(talent option)")}</span>
        </label>
      </div>` : ""}
    </div>
  `;

  return await customDialog({
    title: t("UESRPG.Dialogs.SpellOptions.Title", "Spell Options"),
    content,
    buttons: {
      cast: {
        label: t("UESRPG.Sheets.Item.Cast", "Cast"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];

          const difficultyKey = String(root?.querySelector('[name="difficultyKey"]')?.value ?? "average");
          const circumstanceMod = Number.parseInt(String(root?.querySelector('[name="circumstanceMod"]')?.value ?? "0"), 10) || 0;
          const manualModifierRaw = root?.querySelector('[name="manualModifier"]')?.value ?? "0";
          const manualModifier = Number.parseInt(String(manualModifierRaw ?? "0"), 10) || 0;
          const castLevelRaw = root?.querySelector('[name="castLevel"]')?.value ?? String(baseLevel);
          const castLevel = hasScaling ? (Number.parseInt(String(castLevelRaw), 10) || baseLevel) : baseLevel;

          return {
            isRestrained: root?.querySelector('[name="restrain"]')?.checked ?? false,
            isOverloaded: root?.querySelector('[name="overload"]')?.checked ?? false,
            useOvercharge: root?.querySelector('[name="overcharge"]')?.checked ?? false,
            useMagickaCycling: root?.querySelector('[name="magickaCycling"]')?.checked ?? false,
            difficultyKey,
            circumstanceMod,
            manualModifier,
                restraintValue: Number(root?.querySelector('[name="restrain"]')?.checked ?? false)
                  ? (Number(resolveSpellProfile(spell, actor, {
                      level: castLevel,
                      isRestrained: true,
                      isOverloaded: false,
                      useOvercharge: Boolean(root?.querySelector('[name="overcharge"]')?.checked)
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
    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      if (hasOverload) {
        const restrainCheckbox = root?.querySelector("#restrainCheckbox");
        const overloadCheckbox = root?.querySelector("#overloadCheckbox");
        const restrainGroup = root?.querySelector("#restrainGroup");
        const overloadGroup = root?.querySelector("#overloadGroup");

        if (restrainCheckbox && overloadCheckbox) {
          restrainCheckbox.addEventListener("change", (e) => {
            if (e.target.checked) {
              overloadCheckbox.checked = false;
              overloadGroup.style.opacity = "0.5";
            } else {
              overloadGroup.style.opacity = "1";
            }
          });

          overloadCheckbox.addEventListener("change", (e) => {
            if (e.target.checked) {
              restrainCheckbox.checked = false;
              restrainGroup.style.opacity = "0.5";
            } else {
              restrainGroup.style.opacity = "1";
            }
          });
        }
      }

      if (hasScaling) {
        const castLevelSelect = root?.querySelector("#castLevelSelect");
        const restrainCheckbox = root?.querySelector("#restrainCheckbox");
        const overloadCheckbox = root?.querySelector("#overloadCheckbox");
        const overchargeCheckbox = root?.querySelector('input[name="overcharge"]');
        const previewCost = root?.querySelector("#previewCost");
        const previewDamage = root?.querySelector("#previewDamage");
        const previewDuration = root?.querySelector("#previewDuration");

        const updatePreview = () => {
          const selectedLevel = parseInt(castLevelSelect?.value ?? baseLevel, 10) || baseLevel;
          const isRestrained = restrainCheckbox?.checked ?? false;
          const isOverloaded = overloadCheckbox?.checked ?? false;
          const useOvercharge = overchargeCheckbox?.checked ?? false;

          try {
            const profile = resolveSpellProfile(spell, actor, {
              level: selectedLevel,
              isRestrained,
              isOverloaded,
              useOvercharge
            });

            const refundValue = Number(profile?.cost?.effectiveRestraintReduction ?? profile?.cost?.restrained?.reduction ?? 0) || 0;
            if (previewCost) {
              if (resourcePresentation.fixedCost != null) {
                previewCost.textContent = resourcePresentation.costPreviewText(resourcePresentation.fixedCost);
              } else {
                const refund = isRestrained ? tf("UESRPG.Dialogs.SpellOptions.RefundOnSuccess", { value: refundValue }, ` (refund on success: ${refundValue} MP)`) : "";
                const overload = isOverloaded ? t("UESRPG.Dialogs.SpellOptions.OverloadCostSuffix", " (2x overload)") : "";
                const overcharge = profile?.cost?.overcharge?.enabled ? " (2x overcharge)" : "";
                previewCost.textContent = resourcePresentation.costPreviewText(profile.cost.attempt, `${refund}${overload}${overcharge}`);
              }
            }
            if (previewDamage) previewDamage.textContent = `Formula: ${profile.damage.formula || t("UESRPG.UI.NotAvailable", "N/A")}`;
            if (previewDuration) previewDuration.textContent = tf("UESRPG.Dialogs.SpellOptions.Duration", { value: profile.duration.value || 0, unit: profile.duration.unit || t("UESRPG.Dialogs.SpellOptions.Instant", "instant") }, `Duration: ${profile.duration.value || 0} ${profile.duration.unit || "instant"}`);
          } catch (err) {
            console.warn("UESRPG | Failed to update spell profile preview", err);
          }
        };

        if (castLevelSelect) castLevelSelect.addEventListener("change", updatePreview);
        if (restrainCheckbox) restrainCheckbox.addEventListener("change", updatePreview);
        if (overloadCheckbox) overloadCheckbox.addEventListener("change", updatePreview);
        if (overchargeCheckbox) overchargeCheckbox.addEventListener("change", updatePreview);
        updatePreview();
      }
    },
    width: 380
  });
}
