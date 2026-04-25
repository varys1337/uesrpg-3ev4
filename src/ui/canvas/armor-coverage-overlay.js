/**
 * src/ui/canvas/armor-coverage-overlay.js
 *
 * Compact PIXI renderer for armor coverage badges.
 */

const OVERLAY_NAME = "uesrpg-armor-coverage-overlay";

const COLORS = Object.freeze({
  full: 0x2fbf71,
  partial: 0xe0b84a,
  none: 0x3f4650,
  frame: 0x000000,
  text: 0xffffff
});

function _isCanvasReady() {
  return Boolean(globalThis.canvas?.scene && globalThis.canvas?.interface);
}

function _setNonInteractive(container) {
  if (!container) return;
  try { container.eventMode = "none"; } catch (_e) { /* no-op */ }
  container.interactiveChildren = false;
}

function _drawRoundedBadge(graphics, { width, height, color, transparency = 90 }) {
  graphics.clear();
  const fillAlpha = transparency / 100; // Convert 0-100 to 0.0-1.0
  const strokeAlpha = fillAlpha * 0.7; // Border slightly more transparent
  graphics.lineStyle(1, COLORS.frame, strokeAlpha);
  graphics.beginFill(color, fillAlpha);
  graphics.drawRoundedRect(0, 0, width, height, 4);
  graphics.endFill();
}

function _stateColor(state) {
  return COLORS[state] ?? COLORS.none;
}

export class ArmorCoverageOverlay {
  constructor() {
    this.container = null;
    this.entries = new Map();
    this.transparency = 90; // Default 90% opacity
  }

  setTransparency(transparency) {
    const value = Number(transparency);
    this.transparency = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 90;
    // Redraw all existing badges with new transparency
    for (const entry of this.entries.values()) {
      if (!entry?.lastViewModel) continue;
      this._updateRows(entry, entry.lastViewModel);
    }
  }

  ensureContainer() {
    if (!_isCanvasReady()) return null;
    if (this.container && !this.container.destroyed) return this.container;

    this.container = new PIXI.Container();
    this.container.name = OVERLAY_NAME;
    this.container.sortableChildren = true;
    this.container.zIndex = 100100;
    _setNonInteractive(this.container);

    const parent = canvas.interface ?? canvas.tokens;
    if (!parent) return null;
    parent.addChild(this.container);
    return this.container;
  }

  destroy() {
    for (const tokenId of Array.from(this.entries.keys())) this.destroyToken(tokenId);
    try { this.container?.parent?.removeChild?.(this.container); } catch (_e) { /* no-op */ }
    try { this.container?.destroy?.({ children: true }); } catch (_e) { /* no-op */ }
    this.container = null;
  }

  destroyToken(tokenId) {
    const id = String(tokenId ?? "");
    const entry = this.entries.get(id);
    if (!entry) return;
    try { entry.container?.parent?.removeChild?.(entry.container); } catch (_e) { /* no-op */ }
    try { entry.container?.destroy?.({ children: true }); } catch (_e) { /* no-op */ }
    this.entries.delete(id);
  }

  clearExcept(tokenIds) {
    const wanted = new Set((tokenIds ?? []).map(id => String(id)));
    for (const id of Array.from(this.entries.keys())) {
      if (!wanted.has(id)) this.destroyToken(id);
    }
  }

  updateToken(token, viewModel) {
    if (!token || !viewModel) return;
    const root = this.ensureContainer();
    if (!root) return;

    const tokenId = String(token.id ?? "");
    if (!tokenId) return;

    const entry = this._ensureEntry(tokenId, viewModel);
    if (!entry) return;
    this._updateRows(entry, viewModel);
    this.positionToken(token);
    entry.container.visible = true;
  }

  positionToken(token) {
    const tokenId = String(token?.id ?? "");
    if (!tokenId) return;
    const entry = this.entries.get(tokenId);
    if (!entry) return;

    const center = token.center;
    if (!center) return;

    const pad = 8;
    const width = entry.maxWidth || 90; // Use dynamic width, fallback to previous default
    const height = entry.height || 92;
    const right = center.x + (Number(token.w) || 0) / 2 + pad;
    const fallbackLeft = center.x - (Number(token.w) || 0) / 2 - width - pad;
    const maxX = Number(canvas?.dimensions?.width ?? right + width + pad) - width - pad;
    const x = right <= maxX ? right : Math.max(pad, fallbackLeft);
    const yRaw = center.y - height / 2;
    const maxY = Number(canvas?.dimensions?.height ?? yRaw + height + pad) - height - pad;
    const y = Math.max(pad, Math.min(maxY, yRaw));
    entry.container.position.set(x, y);
  }

  _ensureEntry(tokenId, viewModel) {
    const existing = this.entries.get(tokenId);
    if (existing && existing.container && !existing.container.destroyed) return existing;

    const root = this.ensureContainer();
    if (!root) return null;

    const container = new PIXI.Container();
    container.name = `${OVERLAY_NAME}-${tokenId}`;
    _setNonInteractive(container);

    const rows = [];
    const rowHeight = 14; // Reduced from 20px for compact layout
    const gap = 2;        // Reduced from 4px
    const pad = 3;        // Reduced from 5px
    const height = pad + (viewModel.rows.length * rowHeight) + ((viewModel.rows.length - 1) * gap) + pad;

    for (let i = 0; i < viewModel.rows.length; i += 1) {
      const g = new PIXI.Graphics();
      g.position.set(0, pad + i * (rowHeight + gap));
      const text = new PIXI.Text("", {
        fontFamily: "Signika",
        fontSize: 10, // Reduced from 12px for compact layout
        fill: COLORS.text,
        stroke: COLORS.frame,
        strokeThickness: 2, // Reduced from 3px
        align: "center"
      });
      text.anchor.set(0.5, 0.5); // Center both horizontally and vertically
      // Position will be set in _updateRows after text width is known
      // Vertical position is center of bar: pad + i*(rowHeight+gap) + rowHeight/2
      text.position.set(0, pad + i * (rowHeight + gap) + rowHeight / 2);
      container.addChild(g);
      container.addChild(text);
      rows.push({ graphics: g, text });
    }

    root.addChild(container);
    const entry = { container, rows, height, maxWidth: 0 };
    this.entries.set(tokenId, entry);
    return entry;
  }

  _updateRows(entry, viewModel) {
    if (!entry || !viewModel) return;
    const rowHeight = 14; // Must match _ensureEntry rowHeight
    const horizontalPadding = 12; // 6px left + 6px right
    // Store the viewModel for redrawing when transparency changes
    entry.lastViewModel = viewModel;
    
    let maxWidth = 0;
    
    for (let i = 0; i < entry.rows.length; i += 1) {
      const row = viewModel.rows[i];
      const part = entry.rows[i];
      if (!row || !part) continue;
      
      // Use detailed text for partial coverage with single side
      let displayText;
      if (row.state === "none") {
        displayText = "No";
      } else if (row.state === "full") {
        displayText = "Yes";
      } else if (row.state === "partial" && row.detailedText) {
        // e.g., "Arms: Right" or "Legs: Left"
        displayText = row.detailedText;
      } else {
        displayText = "Some";
      }
      
      const textContent = `${row.label}: ${displayText}`;
      part.text.text = textContent;
      
      // Measure text width
      const textMetrics = PIXI.TextMetrics.measureText(textContent, part.text.style);
      const textWidth = textMetrics.width;
      const barWidth = Math.max(textWidth + horizontalPadding, 40); // Minimum width 40px
      
      // Update max width for positioning
      if (barWidth > maxWidth) maxWidth = barWidth;
      
      // Draw badge with dynamic width
      _drawRoundedBadge(part.graphics, {
        width: barWidth,
        height: rowHeight,
        color: _stateColor(row.state),
        transparency: this.transparency
      });
      
      // Position text at center of bar
      part.text.position.set(barWidth / 2, part.text.position.y);
    }
    
    // Store max width for positioning in positionToken
    entry.maxWidth = maxWidth;
  }
}
