/**
 * Resize motion guard for Actor AppV2 sheets.
 * Adds a transient class while the user is actively resizing to suppress
 * costly transitions and layout oscillation.
 */

const DEFAULT_CLASS = "uesrpg-is-resizing";
const IDLE_CLEAR_MS = 140;
const HANDLE_SELECTOR = ".window-resizable-handle, .window-resize-handle, .resize-handle, [data-action='resize']";

function getAppRoot(app) {
  const el = app?.element;
  if (!el) return null;
  return el.closest(".application, .app") || el.parentElement || el;
}

function readSize(root) {
  return {
    width: Number(root?.offsetWidth ?? 0),
    height: Number(root?.offsetHeight ?? 0),
  };
}

function setActive(state, active, reason) {
  if (!state || state.destroyed) return;
  if (state.active === active) return;
  state.active = active;
  const root = state.appRoot;
  if (root?.classList) {
    if (active) root.classList.add(state.className);
    else root.classList.remove(state.className);
  }
  try {
    state.onStateChange?.(active ? "start" : "end", {
      reason,
      width: Number(root?.offsetWidth ?? 0),
      height: Number(root?.offsetHeight ?? 0),
    });
  } catch (_err) {
    // no-op
  }
}

function scheduleInactive(state, reason = "idle") {
  if (!state || state.destroyed) return;
  if (state.clearTimer != null) clearTimeout(state.clearTimer);
  state.clearTimer = setTimeout(() => {
    state.clearTimer = null;
    setActive(state, false, reason);
  }, state.idleMs);
}

function teardown(state) {
  if (!state || state.destroyed) return;
  state.destroyed = true;
  if (state.clearTimer != null) clearTimeout(state.clearTimer);
  state.clearTimer = null;
  try {
    state.ro?.disconnect?.();
  } catch (_err) {
    // no-op
  }
  state.ro = null;
  try {
    state.appRoot?.removeEventListener("pointerdown", state.onPointerDown, true);
  } catch (_err) {
    // no-op
  }
  try {
    window.removeEventListener("pointerup", state.onPointerUp, true);
    window.removeEventListener("pointercancel", state.onPointerUp, true);
    window.removeEventListener("blur", state.onWindowBlur, true);
  } catch (_err) {
    // no-op
  }
  setActive(state, false, "teardown");
}

export function disableResizeMotionGuard(app) {
  const state = app?._uesrpgResizeMotionGuard;
  if (!state) return;
  teardown(state);
  if (app?._uesrpgResizeMotionGuard === state) app._uesrpgResizeMotionGuard = null;
}

export function enableResizeMotionGuard(app, opts = {}) {
  if (!app) return;

  const appRoot = getAppRoot(app);
  if (!appRoot) return;

  const prior = app._uesrpgResizeMotionGuard;
  if (prior && !prior.destroyed && prior.appRoot === appRoot) return;
  if (prior) disableResizeMotionGuard(app);

  const state = {
    destroyed: false,
    active: false,
    appRoot,
    className: String(opts.className || DEFAULT_CLASS),
    idleMs: Number(opts.idleMs || IDLE_CLEAR_MS),
    clearTimer: null,
    ro: null,
    lastSize: readSize(appRoot),
    onStateChange: typeof opts.onStateChange === "function" ? opts.onStateChange : null,
    onPointerDown: null,
    onPointerUp: null,
    onWindowBlur: null,
  };

  state.onPointerDown = (event) => {
    if (state.destroyed) return;
    const target = event?.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(HANDLE_SELECTOR)) return;
    if (!state.appRoot.contains(target)) return;
    setActive(state, true, "pointerdown");
    scheduleInactive(state, "pointerup-idle");
  };

  state.onPointerUp = () => {
    if (state.destroyed) return;
    scheduleInactive(state, "pointerup");
  };

  state.onWindowBlur = () => {
    if (state.destroyed) return;
    scheduleInactive(state, "window-blur");
  };

  appRoot.addEventListener("pointerdown", state.onPointerDown, true);
  window.addEventListener("pointerup", state.onPointerUp, true);
  window.addEventListener("pointercancel", state.onPointerUp, true);
  window.addEventListener("blur", state.onWindowBlur, true);

  if (typeof ResizeObserver !== "undefined") {
    state.ro = new ResizeObserver(() => {
      if (state.destroyed) return;
      const next = readSize(state.appRoot);
      if (next.width === state.lastSize.width && next.height === state.lastSize.height) return;
      state.lastSize = next;
      setActive(state, true, "resize-observer");
      scheduleInactive(state, "resize-idle");
    });
    state.ro.observe(appRoot);
  }

  app._uesrpgResizeMotionGuard = state;
}
