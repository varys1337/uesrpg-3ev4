export function getCanvasPosition(ev) {
  if (typeof ev?.getLocalPosition === "function") {
    const pos = ev.getLocalPosition(canvas.stage);
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
  }

  const data = ev?.data ?? ev;
  if (typeof data?.getLocalPosition === "function") {
    const pos = data.getLocalPosition(canvas.stage);
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
  }

  const globalPoint = ev?.global ?? ev?.data?.global;
  if (globalPoint && typeof canvas.stage?.toLocal === "function") {
    const pos = canvas.stage.toLocal(globalPoint);
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
  }
  return null;
}

export function snapToGrid(pt) {
  if (canvas.templates && typeof canvas.templates.getSnappedPoint === "function") {
    return canvas.templates.getSnappedPoint(pt);
  }
  return pt;
}

export function updatePreviewPosition(previewTemplate, previewDoc, x, y, direction) {
  try {
    previewDoc.updateSource({ x, y, direction });
    previewTemplate.renderFlags?.set?.({ refreshPosition: true, refreshShape: true });
    if (Number.isFinite(x) && Number.isFinite(y)) {
      previewTemplate.position?.set?.(x, y);
    }
  } catch (_e) {
    // Best effort only.
  }
}

export function cleanupPreview(previewTemplate) {
  if (!previewTemplate) return;
  try {
    if (previewTemplate.parent) {
      previewTemplate.parent.removeChild(previewTemplate);
    }
    previewTemplate.destroy({ children: true });
  } catch (_e) {
    // Best effort cleanup.
  }
  try {
    canvas.templates?.clearPreviewContainer?.();
  } catch (_e) {
    // Ignore cleanup failures.
  }
}
