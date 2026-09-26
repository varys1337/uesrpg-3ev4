/**
 * src/core/aoe/aoe-placement-controller.js
 *
 * Legacy MeasuredTemplate placement controller.
 *
 * Compatibility contract:
 * - Creates a client-side preview MeasuredTemplate on the TemplateLayer preview container
 * - Preserves old template-based placement behavior for compatibility callers only
 * - Captures pointer events via the canvas stage to track + commit placement
 * - On confirm: persists a real MeasuredTemplateDocument via createEmbeddedDocuments
 * - On cancel: tears down preview without persisting
 * - Guarantees cleanup via try/finally + re-entry guard
 *
 * Active runtime AoE placement is Region-first and lives in
 * `aoe-region-placement-controller.js`. Do not route new spell, power, or item
 * targeting through this module.
 *
 * Legacy compatibility helper on Foundry VTT v14.359+.
 */

import {
  cleanupPreview,
  getCanvasPosition,
  snapToGrid as snapToGridPoint,
  updatePreviewPosition,
} from "./placement-helpers.js";
import { measureDistanceMeters, resolveRangeOrigin } from "./measurement.js";

/**
 * Re-entry guard: only one placement session at a time per client.
 * @type {boolean}
 */
let _placementActive = false;

/**
 * Check whether a placement session is currently in progress.
 * @returns {boolean}
 */
export function isPlacementActive() {
  return _placementActive;
}

/**
 * Start an interactive template placement session.
 *
 * @param {object} templateData   - MeasuredTemplateDocument source data (from buildTemplateData)
 * @param {object} [options]
 * @param {number|null} [options.maxRangeMeters]  - Max range from origin in meters (null = unlimited)
 * @param {{x:number, y:number}|null} [options.rangeOrigin] - Origin point for range gating
 * @param {boolean} [options.snapToGrid]          - Whether to snap placement to grid (default: false)
 * @param {boolean} [options.lockPosition]        - If true, skip interactive placement (pulse mode)
 * @returns {Promise<{templateDoc: MeasuredTemplateDocument, data: object}|null>}
 *          Resolves with the created document or null if canceled.
 */
export async function startPlacement(templateData, options = {}) {
  // --- Pre-flight checks ---
  if (_placementActive) {
    ui.notifications?.warn("An AoE template placement is already in progress.");
    return null;
  }
  if (!canvas?.scene) {
    ui.notifications?.warn("No active scene — cannot place AoE template.");
    return null;
  }
  if (!canvas?.templates) {
    ui.notifications?.warn("Canvas template layer is not available.");
    return null;
  }

  const {
    maxRangeMeters = null,
    rangeOrigin = null,
    snapToGrid = false,
    lockPosition = false,
  } = options;

  // Ensure user ID is set
  const data = foundry.utils.deepClone(templateData);
  data.user = game.user.id;

  // --- Lock Position mode (pulse): skip interactive placement ---
  if (lockPosition) {
    return _createDirectly(data);
  }

  // --- Interactive placement ---
  _placementActive = true;
  const previousActiveLayer = canvas.activeLayer ?? null;

  let previewTemplate = null;
  let previewDoc = null;

  try {
    // Create a temporary MeasuredTemplateDocument (not yet persisted to scene)
    const MeasuredTemplateDocClass = CONFIG.MeasuredTemplate?.documentClass ?? foundry.documents.MeasuredTemplateDocument;
    previewDoc = new MeasuredTemplateDocClass(data, { parent: canvas.scene });

    // Create the MeasuredTemplate placeable for preview
    const MeasuredTemplateClass = CONFIG.MeasuredTemplate?.objectClass
      ?? foundry.canvas.placeables.MeasuredTemplate;
    previewTemplate = new MeasuredTemplateClass(previewDoc);

    // Activate the templates layer (this naturally disables token interaction)
    canvas.templates.activate();

    // Draw the preview into the layer's preview container
    await previewTemplate.draw();
    if (canvas.templates.preview) {
      canvas.templates.preview.addChild(previewTemplate);
    } else {
      // Fallback: add to the template layer's objects container
      canvas.templates.objects?.addChild?.(previewTemplate);
    }

    // Run the interactive placement loop
    const result = await _interactivePlacementLoop(previewTemplate, previewDoc, {
      maxRangeMeters,
      rangeOrigin,
      snapToGrid,
    });

    return result;
  } catch (err) {
    console.error("UESRPG | AoE placement controller error:", err);
    return null;
  } finally {
    // --- Guaranteed cleanup ---
    cleanupPreview(previewTemplate);

    // Restore previous layer
    if (previousActiveLayer && typeof previousActiveLayer.activate === "function") {
      try { previousActiveLayer.activate(); } catch (_e) { /* ignore */ }
    }

    _placementActive = false;
  }
}

/**
 * Create a template directly without interactive placement (pulse/locked mode).
 *
 * @param {object} data - MeasuredTemplateDocument source data
 * @returns {Promise<{templateDoc: MeasuredTemplateDocument, data: object}|null>}
 */
async function _createDirectly(data) {
  try {
    const docs = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
    const templateDoc = docs?.[0] ?? null;
    if (!templateDoc) return null;
    return { templateDoc, data };
  } catch (err) {
    console.error("UESRPG | AoE direct template creation failed:", err);
    ui.notifications?.error("Failed to create AoE template.");
    return null;
  }
}

/**
 * Run the interactive placement loop (mouse tracking + confirm/cancel).
 *
 * @param {MeasuredTemplate} previewTemplate
 * @param {MeasuredTemplateDocument} previewDoc
 * @param {object} opts
 * @returns {Promise<{templateDoc: MeasuredTemplateDocument, data: object}|null>}
 */
function _interactivePlacementLoop(previewTemplate, previewDoc, opts) {
  const { maxRangeMeters, rangeOrigin, snapToGrid } = opts;

  return new Promise((resolve) => {
    let active = true;
    let currentDirection = previewDoc.direction ?? 0;
    let canvasReadyHookId = null;

    const finish = async (result) => {
      if (!active) return;
      active = false;

      // Remove all listeners
      try { window.removeEventListener("keydown", onKeyDown); } catch (_e) { /* */ }
      try { canvas.stage.off("pointermove", onPointerMove); } catch (_e) { /* */ }
      try { canvas.stage.off("pointerdown", onPointerDown); } catch (_e) { /* */ }
      try { canvas.stage.off("rightdown", onRightDown); } catch (_e) { /* */ }
      try { window.removeEventListener("wheel", onWheel); } catch (_e) { /* */ }

      // Clean up scene-change hook
      if (canvasReadyHookId != null) {
        try { Hooks.off("canvasReady", canvasReadyHookId); } catch (_e) { /* */ }
        canvasReadyHookId = null;
      }

      resolve(result);
    };

    // --- ESC to cancel ---
    const onKeyDown = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        finish(null);
      }
    };

    // --- Pointer move: update preview position ---
    const onPointerMove = (ev) => {
      if (!active) return;
      const pos = getCanvasPosition(ev);
      if (!pos) return;

      const snapped = snapToGrid ? snapToGridPoint(pos) : pos;
      updatePreviewPosition(previewTemplate, previewDoc, snapped.x, snapped.y, currentDirection);
    };

    // --- Left click: confirm placement ---
    const onPointerDown = async (ev) => {
      if (!active) return;

      // Only respond to primary button (left click)
      // v13 (PIXI v8): FederatedPointerEvent has .button directly
      if ((ev.button ?? ev.data?.button) !== 0) return;

      const pos = getCanvasPosition(ev);
      if (!pos) return;

      const snapped = snapToGrid ? snapToGridPoint(pos) : pos;

      // Range gating (supports aoeOriginMeasurement setting for edge-based origins)
      if (Number.isFinite(maxRangeMeters) && maxRangeMeters > 0 && rangeOrigin) {
        const effectiveOrigin = resolveRangeOrigin(rangeOrigin);
        const d = measureDistanceMeters(effectiveOrigin, snapped);
        if (d > maxRangeMeters) {
          ui.notifications?.warn(
            `Out of range (${Math.round(d)}m, max ${maxRangeMeters}m). ` +
            `Move closer or press Esc/right-click to cancel.`
          );
          return; // Don't place, let user try again
        }
      }

      // Persist the template
      const finalData = foundry.utils.deepClone(previewDoc.toObject());
      finalData.x = snapped.x;
      finalData.y = snapped.y;
      finalData.direction = currentDirection;
      // Remove _id if it was set on the preview doc
      delete finalData._id;

      const result = await _createDirectly(finalData);
      await finish(result);
    };

    // --- Right click: cancel ---
    const onRightDown = (ev) => {
      if (!active) return;
      ev.preventDefault?.();
      ev.stopPropagation?.();
      finish(null);
    };

    // --- Mouse wheel: rotate template ---
    const onWheel = (ev) => {
      if (!active) return;
      // Only rotate for directional shapes (cone, ray)
      const shape = previewDoc.t;
      if (shape !== "cone" && shape !== "ray") return;

      ev.preventDefault();
      const delta = ev.deltaY > 0 ? 15 : -15; // 15-degree increments
      currentDirection = (currentDirection + delta) % 360;
      if (currentDirection < 0) currentDirection += 360;

      updatePreviewPosition(previewTemplate, previewDoc, previewDoc.x, previewDoc.y, currentDirection);
    };

    // Install listeners
    window.addEventListener("keydown", onKeyDown, { capture: true });
    canvas.stage.on("pointermove", onPointerMove);
    canvas.stage.on("pointerdown", onPointerDown);
    canvas.stage.on("rightdown", onRightDown);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // Cancel on scene change — the preview and TemplateLayer will be torn down
    canvasReadyHookId = Hooks.on("canvasReady", () => finish(null));

    // User guidance
    const shapeType = previewDoc.t;
    const rotateHint = (shapeType === "cone" || shapeType === "ray")
      ? ". Scroll to rotate"
      : "";
    ui.notifications?.info(
      `Place template: Left-click to confirm, Right-click or Esc to cancel${rotateHint}.`
    );
  });
}

// ──────────────────────────── Helpers ────────────────────────────

/**
 * Get canvas-space coordinates from a PIXI event.
 * @param {*} ev
 * @returns {{x: number, y: number}|null}
 */


/**
 * Snap a point to the grid using the template layer's snapping.
 * @param {{x: number, y: number}} pt
 * @returns {{x: number, y: number}}
 */


/**
 * Update preview template position and direction in-place (no document update round-trip).
 *
 * @param {MeasuredTemplate} previewTemplate
 * @param {MeasuredTemplateDocument} previewDoc
 * @param {number} x
 * @param {number} y
 * @param {number} direction
 */


/**
 * Clean up a preview template from the canvas.
 * @param {MeasuredTemplate|null} previewTemplate
 */

