/**
 * Canonical spell options dialog used by core and UI casting flows.
 */

import { getSpellScalingLevels } from "../magicka-utils.js";
import { SKILL_DIFFICULTIES } from "../../skills/skill-tn.js";
import { resolveSpellProfile } from "../spell-profile.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { buildCircumstanceOptionsHtml } from "../../opposed/circumstance.js";

/**
 * Show spell options dialog for Restraint/Overload.
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {Promise<object|null>}
 */
export async function showSpellOptionsDialog(actor, spell) {
  const hasOverload = Boolean(spell.system?.hasOverload);
  const hasOverchargeTalent = actor.items?.some(i => i.type === "talent" && i.name === "Overcharge") ?? false;
  const hasMagickaCyclingTalent = actor.items?.some(i => i.type === "talent" && i.name === "Magicka Cycling") ?? false;
  const baseCost = Number(spell.system?.cost ?? 0);
  const baseLevel = spell.system?.level ?? 1;
  const baseProfile = resolveSpellProfile(spell, actor, { isRestrained: true, isOverloaded: false });
  const baseRestraintReduction = Number(baseProfile?.cost?.effectiveRestraintReduction ?? baseProfile?.cost?.restrained?.reduction ?? 0) || 0;

  const allScalingLevels = getSpellScalingLevels(spell);
  const scalingLevels = (Array.isArray(allScalingLevels) ? allScalingLevels : [])
    .filter(entry => {
      if (!entry || typeof entry !== "object") return false;
      const lvl = Number(entry.level ?? 0);
      return Number.isFinite(lvl) && lvl > 0;
    });

  const hasScaling = scalingLevels.length > 0;

  const content = `
    <div class="uesrpg-spell-options">
      <h3>${spell.name}</h3>
      <div class="form-group">
        <label>Base MP Cost: <b>${baseCost}</b></label>
      </div>
      ${hasScaling ? `
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>Cast at Level</b></label>
        <select name="castLevel" id="castLevelSelect" style="width:100%;">
          <option value="base">Base (Level ${baseLevel}, ${baseCost} MP)</option>
          ${scalingLevels.map((entry, idx) => {
            const lvl = entry.level ?? 1;
            const cost = entry.cost ?? baseCost;
            const dmg = entry.damageFormula ? `, ${entry.damageFormula}` : "";
            const desc = entry.description ? ` - ${entry.description}` : "";
            return `<option value="${lvl}" data-scaling-index="${idx}">Level ${lvl} (${cost} MP${dmg})${desc}</option>`;
          }).join("")}
        </select>
      </div>
      <div id="profilePreview" class="form-group" style="background:#f0f0f0; padding:8px; border-radius:4px; font-size:0.9em;">
        <strong>Profile Preview:</strong><br/>
        <span id="previewCost">Cost: ${baseCost} MP</span><br/>
        <span id="previewDamage">Damage: ${spell.system.damageFormula || "N/A"}</span><br/>
        <span id="previewDuration">Duration: ${spell.system.duration?.value || 0} ${spell.system.duration?.unit || "instant"}</span>
      </div>` : ""}
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">
          ${SKILL_DIFFICULTIES.map(df => {
            const sign = df.mod >= 0 ? "+" : "";
            const sel = df.key === "average" ? "selected" : "";
            return `<option value="${df.key}" ${sel}>${df.label} (${sign}${df.mod})</option>`;
          }).join("\n")}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:8px;">
        <label style="display:block;"><b>Circumstance Modifier</b></label>
        <select name="circumstanceMod" style="width:100%;">
          ${buildCircumstanceOptionsHtml(0)}
        </select>
      </div>
      <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input type="number" name="manualModifier" value="0" style="width:120px; text-align:center;" />
      </div>
      <hr style="margin: 10px 0;"/>
      <div class="form-group" id="restrainGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="restrain" id="restrainCheckbox" ${!hasOverload ? "checked" : ""} />
          <span><b>Spell Restraint</b> (reduce cost by ${baseRestraintReduction} to min 1)</span>
        </label>
      </div>
      ${hasOverload ? `
      <div class="form-group" id="overloadGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overload" id="overloadCheckbox" />
          <span><b>Overload</b> (${spell.system.overloadEffect || "double cost for enhanced effect"})</span>
        </label>
      </div>` : ""}
      ${hasOverchargeTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overcharge" />
          <span><b>Overcharge</b> (talent option)</span>
        </label>
      </div>` : ""}
      ${hasMagickaCyclingTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="magickaCycling" />
          <span><b>Magicka Cycling</b> (talent option)</span>
        </label>
      </div>` : ""}
    </div>
  `;

  return await customDialog({
    title: "Spell Options",
    content,
    buttons: {
      cast: {
        label: "Cast",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];

          const difficultyKey = String(root?.querySelector('[name="difficultyKey"]')?.value ?? "average");
          const circumstanceMod = Number.parseInt(String(root?.querySelector('[name="circumstanceMod"]')?.value ?? "0"), 10) || 0;
          const manualModifierRaw = root?.querySelector('[name="manualModifier"]')?.value ?? "0";
          const manualModifier = Number.parseInt(String(manualModifierRaw ?? "0"), 10) || 0;
          const castLevelRaw = root?.querySelector('[name="castLevel"]')?.value ?? "base";
          const castLevel = hasScaling && castLevelRaw !== "base" ? (Number.parseInt(String(castLevelRaw), 10) || null) : null;

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
                  isOverloaded: false
                })?.cost?.effectiveRestraintReduction ?? 0) || 0)
              : 0,
            baseCost,
            castLevel
          };
        }
      },
      cancel: {
        label: "Cancel",
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
        const previewCost = root?.querySelector("#previewCost");
        const previewDamage = root?.querySelector("#previewDamage");
        const previewDuration = root?.querySelector("#previewDuration");

        const updatePreview = () => {
          const selectedLevel = parseInt(castLevelSelect?.value ?? baseLevel);
          const isRestrained = restrainCheckbox?.checked ?? false;
          const isOverloaded = overloadCheckbox?.checked ?? false;

          try {
            const profile = resolveSpellProfile(spell, actor, {
              level: selectedLevel,
              isRestrained,
              isOverloaded
            });

            const refundValue = Number(profile?.cost?.effectiveRestraintReduction ?? profile?.cost?.restrained?.reduction ?? 0) || 0;
            if (previewCost) previewCost.textContent = `Cost: ${profile.cost.final} MP${isRestrained ? ` (refund on success: ${refundValue} MP)` : ""}${isOverloaded ? " (2x overload)" : ""}`;
            if (previewDamage) previewDamage.textContent = `Damage: ${profile.damage.formula || "N/A"}`;
            if (previewDuration) previewDuration.textContent = `Duration: ${profile.duration.value || 0} ${profile.duration.unit || "instant"}`;
          } catch (err) {
            console.warn("UESRPG | Failed to update spell profile preview", err);
          }
        };

        if (castLevelSelect) castLevelSelect.addEventListener("change", updatePreview);
        if (restrainCheckbox) restrainCheckbox.addEventListener("change", updatePreview);
        if (overloadCheckbox) overloadCheckbox.addEventListener("change", updatePreview);
        updatePreview();
      }
    },
    width: 380
  });
}
