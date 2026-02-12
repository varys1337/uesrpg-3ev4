/**
 * src/ui/sheets/item/listeners/effects.js
 * Active Effect handlers for item sheets
 */

/**
 * Handle Active Effect controls from the Effects tab.
 *
 * @param {ItemSheet} sheet
 * @param {Event} event
 */
export async function onEffectControl(sheet, event) {
  event.preventDefault();
  const el = event.currentTarget;
  if (!el) return;

  // In some templates the click target can be a nested element, or the control
  // may not carry the effect id directly. Resolve deterministically.
  const action = el.dataset?.action;
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
    const created = await sheet.item.createEmbeddedDocuments("ActiveEffect", [effectData]);
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
      await sheet.item.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
      break;
    case "toggle":
      await sheet.item.updateEmbeddedDocuments("ActiveEffect", [{ _id: effectId, disabled: !effect.disabled }]);
      break;
    default:
      break;
  }
}

/**
 * Register effect-related listeners
 *
 * @param {ItemSheet} sheet
 * @param {jQuery} html
 */
export function registerEffectListeners(sheet, html) {
  html.find(".effect-control").click((ev) => onEffectControl(sheet, ev));
}
