import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeFearHtml } from "./effects-and-restrictions.js";
import { t } from "../../utils/i18n.js";

export async function showFearTestDialog({ defaultType = "panic", defaultModifier = 0, defaultSource = "Fear Source" } = {}) {
  return customDialog({
    layout: "workflow",
    title: t("UESRPG.Dialogs.Fear.ConfigureTitle"),
    content: `
      <div style="display:grid;gap:var(--form-gap,6px);padding:0 4px 4px">
        <div class="form-group">
          <label class="form-group__label">${t("UESRPG.Dialogs.Fear.TestType")}</label>
          <div class="form-fields">
            <select name="type">
              <option value="panic"${defaultType === "panic" ? " selected" : ""}>${t("UESRPG.Dialogs.Fear.PanicOption")}</option>
              <option value="horror"${defaultType === "horror" ? " selected" : ""}>${t("UESRPG.Dialogs.Fear.HorrorOption")}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-group__label">${t("UESRPG.Dialogs.Fear.Modifier")}</label>
          <div class="form-fields">
            <input type="number" name="modifier" value="${Number(defaultModifier) || 0}" step="5" placeholder="0" />
          </div>
          <p class="hint">${t("UESRPG.Dialogs.Fear.ModifierHint")}</p>
        </div>
        <div class="form-group">
          <label class="form-group__label">${t("UESRPG.Dialogs.Fear.Source")}</label>
          <div class="form-fields">
            <input type="text" name="source" value="${escapeFearHtml(defaultSource)}" placeholder="${t("UESRPG.Dialogs.Fear.Source")}" />
          </div>
        </div>
      </div>
    `,
    buttons: {
      ok: {
        label: t("UESRPG.Dialogs.Fear.RunTests"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.element ?? html;
          if (!(root instanceof HTMLElement)) return null;
          const form = root.querySelector("form") ?? root;
          return {
            type: String(form.querySelector('select[name="type"]')?.value ?? "panic"),
            modifier: String(form.querySelector('input[name="modifier"]')?.value ?? "0"),
            source: String(form.querySelector('input[name="source"]')?.value ?? "Fear Source"),
          };
        }
      },
      cancel: { label: t("UESRPG.UI.Cancel"), callback: () => null }
    },
    defaultButton: "ok",
    rejectClose: false
  });
}
