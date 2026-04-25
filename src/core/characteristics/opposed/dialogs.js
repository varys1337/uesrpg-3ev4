/**
 * src/core/characteristics/opposed/dialogs.js
 * Dialog UI for characteristic opposed tests
 */

import { _esc } from "./util.js";
import { CHARACTERISTICS } from "./constants.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { buildCircumstanceOptionsHtml } from "../../opposed/circumstance.js";
import { t } from "../../../utils/i18n.js";

/**
 * Show a dialog for choosing characteristic and manual modifier.
 *
 * @param {object} opts
 * @param {string}  opts.title - Dialog title
 * @param {string}  [opts.defaultCharKey="wp"] - Default characteristic key
 * @param {number}  [opts.defaultCircumstanceMod=0] - Default circumstance modifier
 * @param {number}  [opts.defaultManualMod=0] - Default manual modifier
 * @param {boolean} [opts.showCharSelect=true] - Whether to allow changing the characteristic
 * @returns {Promise<{charKey: string, manualMod: number}|null>}
 */
export async function _charTestDialog({
  title = t("UESRPG.Dialogs.CharacteristicTest.Title"),
  defaultCharKey = "wp",
  defaultCircumstanceMod = 0,
  defaultManualMod = 0,
  showCharSelect = true
} = {}) {
  const charOptions = Object.entries(CHARACTERISTICS).map(([key, label]) => {
    const sel = key === defaultCharKey ? "selected" : "";
    return `<option value="${key}" ${sel}>${_esc(label)} (${_esc(key.toUpperCase())})</option>`;
  }).join("\n");

  const charSelect = showCharSelect
    ? `
      <div class="form-group">
        <label><b>${t("UESRPG.Dialogs.CharacteristicTest.Characteristic")}</b></label>
        <select name="charKey" style="width:100%;">${charOptions}</select>
      </div>`
    : `<input type="hidden" name="charKey" value="${_esc(defaultCharKey)}" />`;

  const content = `
    <div class="uesrpg-char-declare">
      ${charSelect}
      <div class="form-group" style="margin-top:8px;">
        <label><b>${t("UESRPG.Dialogs.CharacteristicTest.CircumstanceModifier")}</b></label>
        <select name="circumstanceMod" style="width:100%;">${buildCircumstanceOptionsHtml(defaultCircumstanceMod)}</select>
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>${t("UESRPG.Dialogs.CharacteristicTest.ManualModifier")}</b></label>
        <input name="manualMod" type="number" value="${Number(defaultManualMod) || 0}" style="width:100%;" />
      </div>
    </div>`;

  try {
    const result = await customDialog({
      title,
      content,
      classes: ["uesrpg-attack-declare"],
      buttons: {
        ok: {
          label: t("UESRPG.Buttons.Roll"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const charKey = root?.querySelector('select[name="charKey"]')?.value
              ?? root?.querySelector('input[name="charKey"]')?.value
              ?? defaultCharKey;
            const rawCircumstance = root?.querySelector('select[name="circumstanceMod"]')?.value ?? "0";
            const circumstanceMod = Number.parseInt(String(rawCircumstance), 10) || 0;
            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            return { charKey, circumstanceMod, manualMod };
          }
        },
        cancel: { label: t("UESRPG.Buttons.Cancel"), callback: () => null }
      },
      default: "ok",
      width: 350
    });
    return result ?? null;
  } catch (_e) {
    return null;
  }
}
