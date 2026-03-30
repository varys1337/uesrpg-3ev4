const RETICLE_COLOR = 0x00AAFF;
const RETICLE_ALPHA = 0.35;
const RETICLE_BORDER_ALPHA = 0.7;
const DEFAULT_TIMEOUT_MS = 60_000;

function getSnappedTopLeft({ x, y }, { widthCells = 1, heightCells = 1, anchorMode = "top-left" } = {}) {
  const gs = canvas.grid?.size ?? 100;
  const widthPx = Math.max(1, Number(widthCells) || 1) * gs;
  const heightPx = Math.max(1, Number(heightCells) || 1) * gs;
  const isCenter = String(anchorMode ?? "top-left").toLowerCase() === "center";
  const raw = isCenter
    ? { x: x - (widthPx / 2), y: y - (heightPx / 2) }
    : { x, y };

  return canvas.grid?.getSnappedPoint(
    raw,
    { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX }
  ) ?? raw;
}

function getPointerCanvasPosition(event) {
  return event?.data?.getLocalPosition(canvas.stage) ?? event?.getLocalPosition?.(canvas.stage) ?? null;
}

/**
 * Show a crosshair-style reticle on the canvas and wait for the user to
 * click a position, then return the grid-snapped top-left coordinates.
 *
 * @param {object} [opts]
 * @param {string} [opts.label]
 * @param {number} [opts.tokenWidth=1]
 * @param {number} [opts.tokenHeight=1]
 * @param {number} [opts.timeout=60000]
 * @param {"top-left"|"center"} [opts.anchorMode="top-left"]
 * @returns {Promise<{x: number, y: number}|null>}
 */
export async function pickCanvasLocation(opts = {}) {
  const scene = canvas?.scene;
  if (!scene || !canvas?.ready) {
    ui.notifications?.warn("No active scene - cannot pick a location.");
    return null;
  }

  const gs = canvas.grid?.size ?? 100;
  const tw = Math.max(1, Number(opts.tokenWidth) || 1);
  const th = Math.max(1, Number(opts.tokenHeight) || 1);
  const timeout = Number(opts.timeout) || DEFAULT_TIMEOUT_MS;
  const anchorMode = String(opts.anchorMode ?? "top-left").toLowerCase() === "center"
    ? "center"
    : "top-left";
  const label = opts.label || "Click on the canvas to choose a placement point. Right-click or Escape to cancel.";

  ui.notifications?.info(label, { permanent: false });

  return new Promise((resolve) => {
    let resolved = false;
    let timerId = null;
    let reticle = null;

    try {
      reticle = new PIXI.Graphics();
      reticle.eventMode = "none";
      reticle.zIndex = 9999;
      canvas.interface?.addChild(reticle);
    } catch (_e) {
      reticle = null;
    }

    function drawReticle(x, y) {
      if (!reticle) return;
      reticle.clear();
      reticle.beginFill(RETICLE_COLOR, RETICLE_ALPHA);
      reticle.drawRect(0, 0, tw * gs, th * gs);
      reticle.endFill();
      reticle.lineStyle(2, RETICLE_COLOR, RETICLE_BORDER_ALPHA);
      reticle.drawRect(0, 0, tw * gs, th * gs);
      const cx = (tw * gs) / 2;
      const cy = (th * gs) / 2;
      reticle.moveTo(cx, 0);
      reticle.lineTo(cx, th * gs);
      reticle.moveTo(0, cy);
      reticle.lineTo(tw * gs, cy);
      reticle.position.set(x, y);
    }

    function cleanup() {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      canvas.stage?.off("pointermove", onMouseMove);
      canvas.stage?.off("pointerdown", onMouseClick);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("contextmenu", onRightClick, { capture: true });
      if (reticle) {
        try {
          reticle.destroy({ children: true });
        } catch (_e) {
          /* no-op */
        }
        reticle = null;
      }
    }

    function finish(result) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    }

    function onMouseMove(event) {
      if (resolved) return;
      const pos = getPointerCanvasPosition(event);
      if (!pos) return;
      const snapped = getSnappedTopLeft(pos, {
        widthCells: tw,
        heightCells: th,
        anchorMode,
      });
      drawReticle(snapped.x, snapped.y);
    }

    function onMouseClick(event) {
      if (resolved) return;
      const button = event?.data?.button ?? event?.button;
      if (button !== 0) return;
      const pos = getPointerCanvasPosition(event);
      if (!pos) return;
      finish(getSnappedTopLeft(pos, {
        widthCells: tw,
        heightCells: th,
        anchorMode,
      }));
    }

    function onRightClick(event) {
      if (resolved) return;
      event.preventDefault();
      event.stopPropagation();
      ui.notifications?.info("Placement cancelled.");
      finish(null);
    }

    function onKeyDown(event) {
      if (resolved) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      ui.notifications?.info("Placement cancelled.");
      finish(null);
    }

    canvas.stage?.on("pointermove", onMouseMove);
    canvas.stage?.on("pointerdown", onMouseClick);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("contextmenu", onRightClick, { capture: true });

    if (timeout > 0) {
      timerId = setTimeout(() => {
        if (resolved) return;
        ui.notifications?.warn("Placement timed out.");
        finish(null);
      }, timeout);
    }
  });
}
