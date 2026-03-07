import { FLAG_SCOPE, SYSTEM_ID } from "../../../core/constants.js";
import { registerOnce } from "../../_internal/hook-registry.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";

export function registerBufferCleanup() {
  registerOnce("hooks:buffer-cleanup", () => {
    Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
      try {
        if (game.userId !== userId) return;

        const flags = effect?.flags?.[FLAG_SCOPE];
        if (!flags?.bufferApplied || !flags?.bufferType) return;

        const targetActor = effect.parent;
        if (!targetActor || targetActor.documentName !== "Actor") return;

        const bufferType = flags.bufferType;
        const bufferPath = `system.buffers.${bufferType}`;

        const otherBufferEffects = targetActor.effects?.filter(ef =>
          ef.id !== effect.id &&
          ef.flags?.[FLAG_SCOPE]?.bufferApplied &&
          ef.flags?.[FLAG_SCOPE]?.bufferType === bufferType
        ) ?? [];

        if (otherBufferEffects.length === 0) {
          await requestUpdateDocument(targetActor, { [bufferPath]: 0 });

          const debugEnabled = game.settings.get(SYSTEM_ID, "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Cleared ${bufferType} buffer on ${targetActor.name} (effect ${effect.name} deleted)`);
          }
        } else {
          const maxBuffer = Math.max(...otherBufferEffects.map(ef =>
            Number(ef.flags?.[FLAG_SCOPE]?.bufferOriginalValue ?? 0)
          ));
          await requestUpdateDocument(targetActor, { [bufferPath]: maxBuffer });

          const debugEnabled = game.settings.get(SYSTEM_ID, "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Recalculated ${bufferType} buffer to ${maxBuffer} on ${targetActor.name}`);
          }
        }
      } catch (err) {
        console.error("UESRPG | Buffer cleanup failed", err);
      }
    });
  });
}
