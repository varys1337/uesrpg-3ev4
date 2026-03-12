/**
 * Native AppV2 prose-mirror helpers.
 *
 * Foundry v13 AppV2 sheets support `<prose-mirror>` directly. This helper keeps only
 * one convenience behavior from the legacy bridge: clicking inactive preview content
 * opens the toggled editor.
 */

function isInteractivePreviewTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("a, button, input, select, textarea, label"));
}

export function openProseMirrorEditor(editor) {
  if (!(editor instanceof HTMLElement)) return false;
  if (!editor.matches?.("prose-mirror")) return false;
  if (editor.hasAttribute("disabled") || editor.hasAttribute("readonly")) return false;
  if (editor.open) return true;

  editor.open = true;
  return true;
}

export function activateProseMirrorEditors(_app, element) {
  if (!(element instanceof HTMLElement)) return;

  const delegationKey = "data-uesrpg-prosemirror-delegation";
  if (element.hasAttribute(delegationKey)) return;
  element.setAttribute(delegationKey, "1");

  element.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInteractivePreviewTarget(target)) return;

    const editor = target.closest("prose-mirror[toggled]");
    if (!(editor instanceof HTMLElement)) return;
    if (editor.hasAttribute("open")) return;
    if (editor.hasAttribute("disabled") || editor.hasAttribute("readonly")) return;

    const preview = target.closest(".editor-content");
    if (!preview || !editor.contains(preview)) return;

    event.preventDefault();
    openProseMirrorEditor(editor);
  }, true);
}
