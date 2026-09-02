import { SpellCastingService } from "../../core/magic/casting-service.js";
import { normalizeTargetTokenUuids } from "../foundry/adapters.js";

export const CastSpellService = {
  async cast(cfg = {}) {
    const normalizedTargetTokenUuids = normalizeTargetTokenUuids(cfg.targetTokenUuids ?? []);

    return SpellCastingService.cast({
      ...cfg,
      targetTokenUuids: normalizedTargetTokenUuids,
    });
  },
};
