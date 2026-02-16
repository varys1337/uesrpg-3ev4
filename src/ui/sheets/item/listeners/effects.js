/**
 * src/ui/sheets/item/listeners/effects.js
 * Active Effect handlers for item sheets
 */
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateEmbeddedDocuments } from "../../../../utils/authority-proxy.js";

/**
 * Handle Active Effect controls from the Effects tab.
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 * @param {HTMLElement} [actionEl] - Explicit action target (AppV2 actions dispatch).
 *   Falls back to event.currentTarget for legacy jQuery callers.
 */
export async function onEffectControl(sheet, event, actionEl = null) {
  event.preventDefault();
  const el = actionEl ?? event.currentTarget;
  if (!el) return;

  // In some templates the click target can be a nested element, or the control
  // may not carry the effect id directly. Resolve deterministically.
  const action = el.dataset?.effectAction;
  const effectId = el.dataset?.effectId ?? el.closest?.("[data-effect-id]")?.dataset?.effectId;

  if (!action) return;
  if (!sheet.item || !sheet.item.effects) return;

  if (action === "create") {
    const effectData = {
      name: "New Effect",
      img: "icons/svg/aura.svg",
      changes: [],
      disabled: false,
      transfer: false,
      duration: {}
    };
    const created = await requestCreateEmbeddedDocuments(sheet.item, "ActiveEffect", [effectData]);
    const eff = created && created.length ? created[0] : null;
    if (eff && eff.sheet) eff.sheet.render(true);
    return;
  }

  if (!effectId) return;
  const effect = sheet.item.effects.get(effectId);
  if (!effect) return;

  switch (action) {
    case "edit":
      if (effect.sheet) effect.sheet.render(true);
      break;
    case "delete":
      // Use embedded document API explicitly; this is more reliable for Item-embedded effects.
      await requestDeleteEmbeddedDocuments(sheet.item, "ActiveEffect", [effectId]);
      break;
    case "toggle":
      await requestUpdateEmbeddedDocuments(sheet.item, "ActiveEffect", [{ _id: effectId, disabled: !effect.disabled }]);
      break;
    default:
      break;
  }
}
