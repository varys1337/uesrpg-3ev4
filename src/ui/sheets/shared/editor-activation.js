/**
 * src/ui/sheets/shared/editor-activation.js
 *
 * AppV2 bridge for legacy {{editor}} helper markup (.editor > .editor-content[data-edit]).
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

function getSubmitForm(app, element) {
  if (app?.form?.nodeName === "FORM") return app.form;
  if (element?.nodeName === "FORM") return element;
  return element?.querySelector?.("form") ?? null;
}

function requestSubmitForm(form) {
  if (!form) return;
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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

function scheduleCloseEditor(key, { submit = false } = {}) {
  const entry = ACTIVE_EDITORS.get(key);
  if (!entry || entry.closing) return;
  entry.closing = true;

  void (async () => {
    // Let menu actions/focus handlers finish before tearing down PM internals.
    await waitFrames(2);
    if (submit) requestSubmitForm(entry.form);
    await waitFrames(1);
    cleanupEditor(key, { destroy: true });
  })().catch(() => {
    cleanupEditor(key, { destroy: true });
  });
}

function resolveTarget(doc, clicked) {
  const editor = clicked?.closest?.(".editor");
  const pm = clicked?.closest?.("prose-mirror");
  const withEdit = clicked?.closest?.("[data-edit]");

  let target = editor?.dataset?.edit
    || pm?.getAttribute?.("name")
    || withEdit?.dataset?.edit
    || editor?.querySelector?.("[name]")?.getAttribute?.("name")
    || pm?.querySelector?.("[name]")?.getAttribute?.("name");

  if (!target || target === "undefined") {
    const root = editor || pm || withEdit || clicked;
    if (root?.closest?.(".bioPage .contentContainer") || root?.closest?.(".biography-container")) target = "system.bio";
    else if (root?.closest?.(".editor-section.notes")) target = "system.notes";
    else if (root?.closest?.(".editor-section.description") || root?.closest?.(".tab[data-tab='description']") || root?.closest?.("[data-tab='description']")) target = "system.description";
    else if (doc?.documentName === "Item") target = "system.description";
    else if (doc?.documentName === "Actor") target = "system.bio";
  }

  return target || null;
}

function locateEditorContent(root, target, clickOrigin) {
  const selector = `.editor .editor-content[data-edit="${escapeAttr(target)}"]`;
  let content = root.querySelector?.(selector) ?? null;

  if (!content) {
    const editor = clickOrigin?.closest?.(".editor");
    content = editor?.querySelector?.(".editor-content[data-edit]")
      || clickOrigin?.closest?.(".editor-content[data-edit]")
      || null;
  }

  if (content && (!content.dataset.edit || content.dataset.edit === "undefined")) {
    content.dataset.edit = target;
  }

  return content;
}

async function activateLegacyEditor(app, root, target, clickOrigin) {
  const key = editorKey(app, target);
  const existing = ACTIVE_EDITORS.get(key);
  if (existing) {
    if (existing.targetEl?.isConnected) {
      if (DEBUG()) console.log("UESRPG | editor already active", { target });
      return true;
    }
    cleanupEditor(key, { destroy: true });
  }

  const content = locateEditorContent(root, target, clickOrigin);
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
  const form = getSubmitForm(app, root);

  const save = async () => {
    if (DEBUG()) console.log("UESRPG | editor save callback", { target });
    scheduleCloseEditor(key, { submit: true });
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
    ACTIVE_EDITORS.set(key, { instance, targetEl: content, button, container, engine, form, closing: false });

    // Defer focus until editor DOM is fully connected/painted.
    await waitFrames(1);
    const active = ACTIVE_EDITORS.get(key);
    if (active?.targetEl?.isConnected) {
      if (instance?.focus) instance.focus();
      else if (instance?.view?.focus) instance.view.focus();
    }

    if (DEBUG()) {
      console.log("UESRPG | editor activated", {
        target,
        engine,
        collaborate,
        hasButton: !!button,
      });
    }
    return true;
  } catch (err) {
    cleanupEditor(key, { destroy: true });
    if (DEBUG()) console.warn("UESRPG | editor activation failed", { target, err });
    return false;
  }
}

export function activateEditorButtons(app, element) {
  if (!element?.isConnected || !app?.document) return;

  const DELEGATION_KEY = "data-uesrpg-editor-delegation";
  if (element.hasAttribute?.(DELEGATION_KEY)) return;
  element.setAttribute(DELEGATION_KEY, "1");

  const doc = app.document;

  element.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".editor-edit");

    // Optional support for no-button editors: click content when no edit button exists.
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

    const clickOrigin = btn || noButtonContentClick || ev.target;
    const target = resolveTarget(doc, clickOrigin);
    if (!target) {
      if (DEBUG()) console.warn("UESRPG | target resolve failed");
      return;
    }

    if (DEBUG()) console.log("UESRPG | target resolved", { target });
    ev.preventDefault();
    ev.stopPropagation();
    void activateLegacyEditor(app, element, target, clickOrigin);
  }, true);
}
