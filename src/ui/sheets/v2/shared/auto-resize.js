/**
 * Auto-resize controller for ApplicationV2 sheets (Foundry v13).
 * - Uses ResizeObserver when available.
 * - Falls back to MutationObserver.
 * - Clamps to viewport height (prevents infinite growth).
 * - Designed to be idempotent per app instance.
 *
 * IMPORTANT: We only resize when setting is enabled.
 */

const DEFAULTS = {
  onlyGrow: true,
  minHeight: 420,
  maxViewportRatio: 0.94,
  contentSelector: ".window-content",
  lockAtScrollableOverflow: true,
  minDeltaPx: 8,
  normalizeIfNoOverflow: false,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getAppRoot(app) {
  // V13 apps typically have an outer wrapper element with header/content.
  const el = app?.element;
  if (!el) return null;
  return el.closest(".application") || el.closest(".app") || el.parentElement || el;
}

function getActiveActorScroller(appRoot) {
  const activePrimaryTab = appRoot?.querySelector?.('.tab[data-group="primary"].active');
  if (!activePrimaryTab) return null;

  const actorTabContent = activePrimaryTab.querySelector?.(
    ".tabContainer, .combatTabContainer, .magicTabContainer, .equipmentTabContainer"
  );
  if (actorTabContent) return actorTabContent;
  return activePrimaryTab;
}

function getActiveItemScroller(appRoot) {
  const activePrimaryTab = appRoot?.querySelector?.('.sheet-body .tab[data-group="primary"].active');
  if (activePrimaryTab) return activePrimaryTab;
  return appRoot?.querySelector?.(".sheet-body") ?? null;
}

function getMeasureElement(appRoot, app) {
  if (app?.document?.documentName === "Actor") {
    return getActiveActorScroller(appRoot)
      || appRoot?.querySelector?.(DEFAULTS.contentSelector)
      || app?.element
      || appRoot;
  }

  if (app?.document?.documentName === "Item") {
    return getActiveItemScroller(appRoot)
      || appRoot?.querySelector?.(DEFAULTS.contentSelector)
      || app?.element
      || appRoot;
  }

  return appRoot?.querySelector?.(DEFAULTS.contentSelector) || app?.element || appRoot;
}

function getViewportMaxHeight(maxViewportRatio) {
  const maxH = Math.floor(window.innerHeight * maxViewportRatio);
  return Math.max(1, maxH);
}

function getOverflowPx(el) {
  if (!el) return 0;
  const client = Number(el.clientHeight ?? 0);
  if (client <= 1) return 0;
  const scroll = Number(el.scrollHeight ?? 0);
  return Math.max(0, scroll - client);
}

function getMeasureElementKey(el) {
  if (!(el instanceof HTMLElement)) return "";
  const cls = typeof el.className === "string" ? el.className : "";
  return [el.tagName, el.id || "", cls, el.dataset?.tab || "", el.dataset?.group || ""].join("|");
}

function disconnectObservers(state) {
  try {
    state.ro?.disconnect?.();
    state.mo?.disconnect?.();
  } catch (_e) {
    // ignore
  }
  state.ro = null;
  state.mo = null;
}

function resetMeasureTracking(state, { keepHeight = true } = {}) {
  state.lastObservedOverflow = 0;
  state.hasLockedScrollableState = false;
  state.normalizedNoOverflowOnce = false;
  state.lastProcessedOverflow = null;
  state.lastMeasuredHeight = keepHeight ? state.lastMeasuredHeight : null;
}

function teardownAutoResize(state) {
  if (!state || state.destroyed) return;
  state.destroyed = true;
  state.isClosing = true;
  try {
    if (Number.isInteger(state.rafId)) cancelAnimationFrame(state.rafId);
  } catch (_e) { /* ignore */ }
  state.rafId = null;
  disconnectObservers(state);
  state.observedEl = null;
  state.observedKey = "";
  state.lastScheduleReason = null;
}

export function uesrpgDisableAutoResize(app) {
  const state = app?._uesrpgAutoResize;
  if (!state) return;
  teardownAutoResize(state);
  if (app?._uesrpgAutoResize === state) app._uesrpgAutoResize = null;
}

export function uesrpgEnableAutoResize(app, opts = {}) {
  if (!app) return;

  // Gate behind a client setting for safety / rollback.
  // Use try/catch to avoid hard failures during early init.
  try {
    if (!game?.settings?.get?.("uesrpg-3ev4", "autoResizeSheets")) return;
  } catch (_e) { /* ignore */ }

  const priorState = app._uesrpgAutoResize;
  if (priorState?.installed && !priorState.destroyed && !priorState.isClosing) return;
  if (priorState?.installed && (priorState.destroyed || priorState.isClosing)) {
    app._uesrpgAutoResize = null;
  }

  const cfg = {
    ...DEFAULTS,
    ...opts,
  };

  const appRoot = getAppRoot(app);
  if (!appRoot) return;

  const state = {
    installed: true,
    destroyed: false,
    isClosing: false,
    scheduled: false,
    rafId: null,
    ro: null,
    mo: null,
    observedEl: null,
    observedKey: "",
    lastAppliedHeight: Number(app.position?.height ?? 0),
    lastObservedOverflow: 0,
    lastProcessedOverflow: null,
    lastMeasuredHeight: null,
    lastScheduleReason: null,
    hasLockedScrollableState: false,
    normalizedNoOverflowOnce: false,
    teardown: () => teardownAutoResize(state),
  };

  const schedule = (reason = "unknown") => {
    if (state.destroyed || state.isClosing || !appRoot?.isConnected || !app?.element?.isConnected) return;
    if (state.scheduled) {
      state.lastScheduleReason = reason;
      return;
    }
    state.scheduled = true;
    state.lastScheduleReason = reason;

    state.rafId = requestAnimationFrame(() => {
      state.rafId = null;
      state.scheduled = false;
      try {
        if (state.destroyed || state.isClosing || !appRoot?.isConnected || !app?.element?.isConnected) return;
        const currentH = app.position?.height ?? appRoot.offsetHeight ?? 0;
        const maxH = getViewportMaxHeight(cfg.maxViewportRatio);
        const measureEl = getMeasureElement(appRoot, app);
        observeTarget(measureEl);
        const overflowPx = getOverflowPx(measureEl);
        const manualResizeDelta = currentH - (state.lastAppliedHeight || 0);

        if (
          state.lastProcessedOverflow !== null
          && Math.abs(overflowPx - state.lastProcessedOverflow) < cfg.minDeltaPx
          && state.lastMeasuredHeight !== null
          && Math.abs(currentH - state.lastMeasuredHeight) < cfg.minDeltaPx
        ) {
          return;
        }

        // Respect manual user resize gestures: if the app is larger than the last
        // auto-applied height and there is no structural overflow, do not force
        // a normalize-down pass on this tick.
        const userExpandedWithoutOverflow =
          (manualResizeDelta > cfg.minDeltaPx) && (overflowPx <= cfg.minDeltaPx);

        let desiredH = currentH;
        if (overflowPx > cfg.minDeltaPx) {
          if (cfg.lockAtScrollableOverflow && state.hasLockedScrollableState) {
            const growthDelta = overflowPx - state.lastObservedOverflow;
            if (growthDelta > cfg.minDeltaPx) desiredH = currentH + growthDelta;
          } else {
            desiredH = currentH + overflowPx;
            if (cfg.lockAtScrollableOverflow) state.hasLockedScrollableState = true;
          }
        } else if (cfg.lockAtScrollableOverflow) {
          state.hasLockedScrollableState = false;
          if (
            cfg.normalizeIfNoOverflow
            && !state.normalizedNoOverflowOnce
            && !userExpandedWithoutOverflow
          ) {
            const normalized = clamp(cfg.minHeight, cfg.minHeight, maxH);
            if ((currentH - normalized) >= cfg.minDeltaPx) {
              desiredH = normalized;
              state.normalizedNoOverflowOnce = true;
            }
          }
        }

        desiredH = clamp(desiredH, cfg.minHeight, maxH);
        state.lastMeasuredHeight = currentH;
        state.lastProcessedOverflow = overflowPx;

        if (cfg.onlyGrow && desiredH <= currentH) {
          state.lastObservedOverflow = overflowPx;
          return;
        }

        if (!cfg.onlyGrow && desiredH < currentH && (currentH - desiredH) < cfg.minDeltaPx) {
          state.lastObservedOverflow = overflowPx;
          return;
        }

        if (Math.abs(desiredH - currentH) < cfg.minDeltaPx) {
          state.lastObservedOverflow = overflowPx;
          return;
        }

        if (state.destroyed || state.isClosing || !appRoot?.isConnected || !app?.element?.isConnected) return;
        if (app?.closing || app?._closing) return;
        app.setPosition({ height: desiredH });
        state.lastAppliedHeight = desiredH;
        state.lastObservedOverflow = overflowPx;
      } catch (_e) {
        // Never hard-fail a sheet render due to resize logic.
      }
    });
  };

  const observeTarget = (el) => {
    if (!(el instanceof HTMLElement) || state.destroyed) return;
    const nextKey = getMeasureElementKey(el);
    if (state.observedEl === el && state.observedKey === nextKey) return;

    disconnectObservers(state);
    state.observedEl = el;
    state.observedKey = nextKey;
    resetMeasureTracking(state, { keepHeight: false });

    if (typeof ResizeObserver !== "undefined") {
      state.ro = new ResizeObserver(() => schedule("resize-observer"));
      state.ro.observe(el);
      return;
    }
    if (typeof MutationObserver !== "undefined") {
      state.mo = new MutationObserver(() => schedule("mutation-observer"));
      state.mo.observe(el, { childList: true, subtree: true });
    }
  };

  // Initial resize after render
  schedule("initial");
  const initialMeasureEl = getMeasureElement(appRoot, app);
  if (initialMeasureEl) observeTarget(initialMeasureEl);

  app._uesrpgAutoResize = state;
}
