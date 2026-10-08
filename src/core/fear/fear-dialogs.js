import { renderTNSummary, bindTNEstimates } from "../../ui/shared/tn-presentation.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeFearHtml, wpTN, isFearImmune } from "./effects-and-restrictions.js";
import { t } from "../../utils/i18n.js";

export async function showFearTestDialog({ actors = [], defaultType = "panic", defaultModifier = 0, defaultSource = "Fear Source" } = {}) {
  const targets = actors.filter(Boolean);
  const estimates = targets.length ? targets.map((actor, index) => ({ key: `fear-${index}`, label: actor.name })) : [{ key: "test", label: t("UESRPG.Dialogs.Fear.ConfigureTitle") }];
  return customDialog({
    layout: "workflow",
    title: t("UESRPG.Dialogs.Fear.ConfigureTitle"),
    render: (_event, dialog) => bindTNEstimates(dialog.element, () => {
      const type = String(dialog.element.querySelector('[name="type"]')?.value ?? "panic").toLowerCase() === "horror" ? "horror" : "panic";
      const modifier = Number(dialog.element.querySelector('[name="modifier"]')?.value ?? 0) || 0;
      if (!targets.length) return [{ key: "test", result: null, reason: "Select an actor to estimate this Fear test." }];
      return targets.map((actor, index) => ({ key: `fear-${index}`, label: actor.name,
        status: isFearImmune(actor, type) ? "Immune" : null,
        result: { finalTN: wpTN(actor, modifier, type), breakdown: [
          { key: "base", label: "Willpower", value: Number(actor.system?.characteristics?.wp?.total ?? 0) },
          { label: "Manual Modifier", value: modifier },
          { label: "Fear modifiers", value: Number(actor.system?.modifiers?.tests?.fear ?? 0) + Number(actor.system?.modifiers?.tests?.[type] ?? 0) },
        ] } }));
    }),
    content: `
      <div style="display:grid;gap:var(--form-gap,6px);padding:0 4px 4px">
        ${renderTNSummary(estimates)}
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
