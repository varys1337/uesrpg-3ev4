import { registerOnce } from "../_internal/hook-registry.js";
import { handleEffectDropData } from "../../core/active-effects/drop-transfer.js";

export function registerEffectDrops() {
  registerOnce("hooks:effect-canvas-drops", () => {
    Hooks.on("dropCanvasData", (canvas, data) => {
      if (data?.type !== "ActiveEffect") return;
      const token = [...(canvas.tokens?.placeables ?? [])]
        .filter(row => row.isVisible && !row.isPreview && row.bounds?.contains(data.x, data.y))
        .sort((a, b) => (b.document.elevation - a.document.elevation) || (b.document.sort - a.document.sort))
        .at(0);
      if (!token?.actor) return;
      // Hooks.call is synchronous; claim the drop before starting the async document workflow.
      void handleEffectDropData(data, token.actor);
      return false;
    });
  });
}
