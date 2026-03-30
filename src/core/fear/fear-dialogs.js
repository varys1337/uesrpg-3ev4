import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeFearHtml } from "./effects-and-restrictions.js";

export async function showFearTestDialog({ defaultType = "panic", defaultModifier = 0, defaultSource = "Fear Source" } = {}) {
  return customDialog({
    title: "Configure Fear Test",
    content: `
      <div style="display:grid;gap:var(--form-gap,6px);padding:0 4px 4px">
        <div class="form-group">
          <label class="form-group__label">Test Type</label>
          <div class="form-fields">
            <select name="type">
              <option value="panic"${defaultType === "panic" ? " selected" : ""}>Panic - Mundane Horror (WP +/- X)</option>
              <option value="horror"${defaultType === "horror" ? " selected" : ""}>Horror - Supernatural Terror (WP +/- X)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-group__label">Modifier</label>
          <div class="form-fields">
            <input type="number" name="modifier" value="${Number(defaultModifier) || 0}" step="5" placeholder="0" />
          </div>
          <p class="hint">Positive = easier. Negative = harder.</p>
        </div>
        <div class="form-group">
          <label class="form-group__label">Fear Source</label>
          <div class="form-fields">
            <input type="text" name="source" value="${escapeFearHtml(defaultSource)}" placeholder="Fear Source" />
          </div>
        </div>
      </div>
    `,
    buttons: {
      ok: {
        label: "Run Tests",
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
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok",
    rejectClose: false
  });
}
