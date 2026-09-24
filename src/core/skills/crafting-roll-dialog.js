import { customDialog } from "../../utils/dialog-v2-helper.js";
import { getAllCharacteristicOptions, getPreferredSkillCharacteristic, normalizeCharacteristicKey } from "../../utils/maps/characteristics.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../traits/trait-resistance-ui.js";
import { normalizeSkillRollOptions } from "./roll-request.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "./skill-tn.js";
import { t } from "../../utils/i18n.js";

/**
 * Prompt for the common declaration options used by non-opposed crafting tests.
 * The returned TN is calculated from the live actor and skill document; callers
 * may apply their own rules-derived penalty after this declaration.
 */
export async function promptCraftingSkillRollDeclaration(actor, skill, {
  title = null,
  difficultyKey = "average",
} = {}) {
  if (!actor || !skill) return null;

  const characteristicOptions = getAllCharacteristicOptions(actor);
  const defaultCharacteristic = getPreferredSkillCharacteristic(actor, skill)
    || normalizeCharacteristicKey(skill?.system?.baseCha ?? "")
    || (characteristicOptions[0]?.key ?? "");
  const resistanceSection = buildResistanceBonusSection(actor);
  const hasSpecialization = String(skill?.system?.trainedItems ?? "").trim().length > 0;

  const getLast = () => {
    try {
      const saved = game.settings.get("uesrpg-3ev4", "skillRollLastOptions") ?? {};
      delete saved.selectedCharacteristicKey;
      return saved;
    } catch (_error) {
      return {};
    }
  };
  const setLast = async (patch = {}) => {
    const previous = getLast();
    const next = {
      ...previous,
      ...patch,
      lastSkillUuidByActor: {
        ...(previous.lastSkillUuidByActor ?? {}),
        ...(patch.lastSkillUuidByActor ?? {}),
      },
    };
    delete next.selectedCharacteristicKey;
    try {
      await game.settings.set("uesrpg-3ev4", "skillRollLastOptions", next);
    } catch (_error) {
      // Preference persistence is non-fatal.
    }
  };

  const defaults = normalizeSkillRollOptions(getLast(), {
    difficultyKey,
    manualMod: 0,
    useSpec: false,
    selectedCharacteristicKey: defaultCharacteristic,
  });
  const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const difficultyOptions = SKILL_DIFFICULTIES.map((entry) => {
    const sign = Number(entry.mod ?? 0) >= 0 ? "+" : "";
    return `<option value="${esc(entry.key)}" ${entry.key === defaults.difficultyKey ? "selected" : ""}>${esc(entry.label)} (${sign}${Number(entry.mod ?? 0)})</option>`;
  }).join("");
  const characteristicSelect = characteristicOptions.length ? `
    <div class="form-group">
      <label><b>${esc(t("UESRPG.Apps.EnchantingWorkshop.RollDialog.Characteristic", "Characteristic"))}</b></label>
      <select name="selectedCharacteristicKey">
        ${characteristicOptions.map((option) => `<option value="${esc(option.key)}" ${option.key === (defaults.selectedCharacteristicKey ?? defaultCharacteristic) ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
      </select>
    </div>` : "";

  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>${esc(t("UESRPG.Apps.EnchantingWorkshop.RollDialog.Difficulty", "Difficulty"))}</b></label>
        <select name="difficultyKey">${difficultyOptions}</select>
      </div>
      ${characteristicSelect}
      <div class="form-group">
        <label class="uesrpg-inline-checkbox">
          <input type="checkbox" name="useSpec" ${hasSpecialization ? "" : "disabled"} ${defaults.useSpec ? "checked" : ""}>
          <span><b>${esc(t("UESRPG.Apps.EnchantingWorkshop.RollDialog.Specialization", "Use Specialization"))}</b> (+10)${hasSpecialization ? "" : ` <small>${esc(t("UESRPG.Apps.EnchantingWorkshop.RollDialog.NoSpecialization", "none on this skill"))}</small>`}</span>
        </label>
      </div>
      <div class="form-group">
        <label><b>${esc(t("UESRPG.Apps.EnchantingWorkshop.RollDialog.ManualModifier", "Manual Modifier"))}</b></label>
        <input name="manualMod" type="number" value="${Number(defaults.manualMod) || 0}">
      </div>
      ${resistanceSection.html}
    </div>`;

  let declaration = null;
  try {
    declaration = await customDialog({
      layout: "workflow",
      title: title ?? `${skill.name} - ${t("UESRPG.Apps.EnchantingWorkshop.RollDialog.Title", "Roll Options")}`,
      content,
      buttons: {
        ok: {
          label: t("UESRPG.Apps.EnchantingWorkshop.RollDialog.Roll", "Roll"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const selectedCharacteristicKey = String(
              root?.querySelector('select[name="selectedCharacteristicKey"]')?.value
              ?? defaults.selectedCharacteristicKey
              ?? defaultCharacteristic
            );
            const normalized = normalizeSkillRollOptions({
              difficultyKey: root?.querySelector('select[name="difficultyKey"]')?.value ?? difficultyKey,
              manualMod: Number.parseInt(String(root?.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0,
              useSpec: Boolean(root?.querySelector('input[name="useSpec"]')?.checked),
              selectedCharacteristicKey,
            }, defaults);
            return {
              ...normalized,
              resistanceSelected: readResistanceBonusSelections(root, resistanceSection.options),
            };
          },
        },
        cancel: { label: t("UESRPG.Buttons.Cancel", "Cancel"), callback: () => null },
      },
      default: "ok",
      width: 420,
    });
  } catch (_error) {
    declaration = null;
  }
  if (!declaration) return null;

  declaration = normalizeSkillRollOptions(declaration, defaults);
  declaration.resistanceSelected = Array.isArray(declaration.resistanceSelected) ? declaration.resistanceSelected : [];
  await setLast({
    difficultyKey: declaration.difficultyKey,
    manualMod: declaration.manualMod,
    useSpec: Boolean(declaration.useSpec),
    lastSkillUuidByActor: { [actor.uuid]: skill.uuid },
  });

  const tn = computeSkillTN({
    actor,
    skillItem: skill,
    difficultyKey: declaration.difficultyKey,
    manualMod: declaration.manualMod,
    selectedCharacteristicKey: String(declaration.selectedCharacteristicKey ?? defaultCharacteristic),
    useSpecialization: hasSpecialization && declaration.useSpec,
    situationalMods: buildResistanceBonusMods(declaration.resistanceSelected),
  });
  return { declaration, tn, hasSpec: hasSpecialization };
}
