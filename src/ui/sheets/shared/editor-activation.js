/**
 * src/ui/sheets/shared/editor-activation.js
 *
 * AppV2 bridge for legacy {{editor}} helper markup (.editor > .editor-content[data-edit]).
 *
 * Retained bridge rationale (v13.351):
 *   Foundry v13 still ships the {{editor}} Handlebars helper which emits
 *   .editor > .editor-content[data-edit] markup. No fully-documented AppV2-native
 *   replacement path (e.g. <prose-mirror> as a form field) is confirmed in v13.351,
 *   so this bridge activates ProseMirror on click and saves directly via
 *   document.update() to avoid relying on FormDataExtended (which cannot read
 *   ProseMirror custom-element content reliably).
 *
 * Editor save path: direct document.update({[target]: html}) — deterministic, no form submit.
 *
 * Debug: set window.UESRPG_EDITOR_DEBUG = true in browser console.
 */

const DEBUG = () => typeof window !== "undefined" && window.UESRPG_EDITOR_DEBUG === true;
const ACTIVE_EDITORS = new Map();

function editorKey(app, target) {
  return `${app?.id ?? "app"}::${target}`;
}

function escapeAttr(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function buildProseMirrorPlugins(onSave) {
  if (typeof ProseMirror === "undefined") return undefined;
  return {
    menu: ProseMirror.ProseMirrorMenu.build(ProseMirror.defaultSchema, {
      // Keep lifecycle in our bridge to avoid save/focus races.
      destroyOnSave: false,
      onSave,
    }),
    keyMaps: ProseMirror.ProseMirrorKeyMaps.build(ProseMirror.defaultSchema, {
      onSave,
    }),
  };
}

/**
 * Extract current HTML content from a ProseMirror editor instance.
 * Tries Foundry's built-in getData(), then ProseMirror DOM serializer, then
 * raw DOM innerHTML as a last resort.
 */
function getEditorHTML(instance) {
  if (typeof instance?.getData === "function") {
    const d = instance.getData();
    if (d != null) return String(d);
  }
  if (instance?.view?.state && typeof ProseMirror !== "undefined") {
    try {
      const pm = ProseMirror;
      const serializer = pm.DOMSerializer.fromSchema(pm.defaultSchema);
      const div = document.createElement("div");
      div.appendChild(serializer.serializeFragment(instance.view.state.doc.content));
      return div.innerHTML;
    } catch (_e) {
      // fall through to DOM fallback
    }
  }
  return instance?.view?.dom?.innerHTML ?? "";
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitFrames(count = 1) {
  for (let i = 0; i < count; i += 1) await nextFrame();
}

function cleanupEditor(key, { destroy = false } = {}) {
  const entry = ACTIVE_EDITORS.get(key);
  if (!entry) return;

  if (destroy) {
    try {
      entry.instance?.destroy?.();
    } catch (_e) {
      // no-op
    }
  }

  if (entry.button) entry.button.style.display = "";
  if (entry.container && entry.engine) entry.container.classList.remove(entry.engine);
  ACTIVE_EDITORS.delete(key);
}

function scheduleCloseEditor(key) {
  const entry = ACTIVE_EDITORS.get(key);
  if (!entry || entry.closing) return;
  entry.closing = true;

  void (async () => {
    // Let menu actions/focus handlers finish before tearing down PM internals.
    await waitFrames(3);
    cleanupEditor(key, { destroy: true });
  })().catch(() => {
    cleanupEditor(key, { destroy: true });
  });
}

/**
 * Resolve the target field path and content element from a click origin inside an .editor container.
 * Derives target directly from .editor-content[data-edit] — no proximity heuristics.
 *
 * @param {HTMLElement} clickOrigin
 * @returns {{ target: string, content: HTMLElement } | null}
 */
function resolveEditorTarget(clickOrigin) {
  const editorContainer = clickOrigin?.closest?.(".editor");
  if (!editorContainer) return null;

  const content = editorContainer.querySelector(".editor-content[data-edit]");
  const target = content?.dataset?.edit;
  if (!target || target === "undefined") return null;

  return { target, content };
}

/**
 * @param {ApplicationV2} app
 * @param {HTMLElement} root     - Sheet root element (used as fallback querySelector scope)
 * @param {string}      target   - Document field path (e.g. "system.description")
 * @param {HTMLElement} content  - The .editor-content[data-edit] element (pre-resolved)
 */
async function activateLegacyEditor(app, root, target, content) {
  const key = editorKey(app, target);
  const existing = ACTIVE_EDITORS.get(key);
  if (existing) {
    if (existing.targetEl?.isConnected) {
      if (DEBUG()) console.log("UESRPG | editor already active", { target });
      return true;
    }
    cleanupEditor(key, { destroy: true });
  }

  if (!content) {
    // Fallback: locate by data-edit attribute within root scope.
    const selector = `.editor .editor-content[data-edit="${escapeAttr(target)}"]`;
    content = root.querySelector?.(selector) ?? null;
  }

  if (!content) {
    if (DEBUG()) console.warn("UESRPG | editor content not found", { target });
    return false;
  }

  const TextEditorImpl = foundry?.applications?.ux?.TextEditor?.implementation;
  if (!TextEditorImpl?.create) {
    if (DEBUG()) console.warn("UESRPG | TextEditor implementation missing", { target });
    return false;
  }

  const container = content.closest?.(".editor");
  const button = container?.querySelector?.(".editor-edit") ?? null;
  const engine = content.dataset.engine || "prosemirror";
  const collaborate = String(content.dataset.collaborate ?? "false") === "true";
  const height = content.offsetHeight || container?.offsetHeight || 300;
  const initial = foundry.utils.getProperty(app.document, target) ?? "";

  const save = async () => {
    if (DEBUG()) console.log("UESRPG | editor save (direct update)", { target });
    // Direct document.update bypasses FormDataExtended, which cannot reliably read
    // ProseMirror custom element content. submitOnChange on item/actor sheets already
    // persists all non-editor form fields on every keystroke.
    const entry = ACTIVE_EDITORS.get(key);
    if (!entry?.instance) {
      scheduleCloseEditor(key);
      return;
    }
    const html = getEditorHTML(entry.instance);
    try {
      if (app.document) await app.document.update({ [target]: html });
    } catch (err) {
      if (DEBUG()) console.warn("UESRPG | editor save failed", { target, err });
    }
    scheduleCloseEditor(key);
  };

  const options = {
    target: content,
    fieldName: target,
    engine,
    collaborate,
    height,
    save_onsavecallback: save,
  };

  if (engine === "prosemirror") {
    const plugins = buildProseMirrorPlugins(save);
    if (plugins) options.plugins = plugins;
  }

  try {
    if (button) button.style.display = "none";
    if (container) container.classList.add(engine);

    const instance = await TextEditorImpl.create(options, initial);
    ACTIVE_EDITORS.set(key, { instance, targetEl: content, button, container, engine, closing: false });

    // Defer focus until editor DOM is fully connected/painted.
    await waitFrames(1);
    const active = ACTIVE_EDITORS.get(key);
    if (active?.targetEl?.isConnected) {
      if (instance?.focus) instance.focus();
      else if (instance?.view?.focus) instance.view.focus();
    }

    if (DEBUG()) {
      console.log("UESRPG | editor activated", { target, engine, collaborate, hasButton: !!button });
    }
    return true;
  } catch (err) {
    cleanupEditor(key, { destroy: true });
    if (DEBUG()) console.warn("UESRPG | editor activation failed", { target, err });
    return false;
  }
}

/**
 * Wire delegated click handling for all .editor-edit buttons within the given element.
 * Called once from _onRender of each AppV2 sheet that contains {{editor}} markup.
 *
 * @param {ApplicationV2} app     - The sheet application instance
 * @param {HTMLElement}   element - The sheet root element
 */
export function activateEditorButtons(app, element) {
  if (!element?.isConnected || !app?.document) return;

  const DELEGATION_KEY = "data-uesrpg-editor-delegation";
  if (element.hasAttribute?.(DELEGATION_KEY)) return;
  element.setAttribute(DELEGATION_KEY, "1");

  element.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".editor-edit");

    // Optional: support no-button editors where content is clicked directly.
    let noButtonContentClick = null;
    if (!btn) {
      const content = ev.target?.closest?.(".editor-content[data-edit]");
      if (!content) return;
      const editor = content.closest?.(".editor");
      const hasButton = !!editor?.querySelector?.(".editor-edit");
      const active = editor?.classList?.contains("prosemirror") || editor?.classList?.contains("tinymce");
      if (hasButton || active) return;
      noButtonContentClick = content;
    }

    const clickOrigin = btn || noButtonContentClick;
    if (!clickOrigin) return;

    // Derive target directly from the .editor-content[data-edit] element.
    // Avoids brittle DOM proximity heuristics — the {{editor}} helper always
    // sets data-edit to the explicit target= parameter.
    let target, content;
    if (noButtonContentClick) {
      target = noButtonContentClick.dataset?.edit;
      content = noButtonContentClick;
    } else {
      const resolved = resolveEditorTarget(clickOrigin);
      if (!resolved) {
        if (DEBUG()) console.warn("UESRPG | editor target not resolvable from clicked element");
        return;
      }
      ({ target, content } = resolved);
    }

    if (!target) {
      if (DEBUG()) console.warn("UESRPG | no data-edit target found");
      return;
    }

    if (DEBUG()) console.log("UESRPG | editor target resolved", { target });
    ev.preventDefault();
    ev.stopPropagation();
    void activateLegacyEditor(app, element, target, content);
  }, true);
}
