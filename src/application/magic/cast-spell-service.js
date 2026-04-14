import { SpellCastingService } from "../../core/magic/casting-service.js";
import { resolveSpellProfile } from "../../core/magic/spell-profile.js";
import { normalizeTargetTokenUuids } from "../foundry/adapters.js";

async function resolveSpellDocument(spellUuid) {
  const raw = String(spellUuid ?? "").trim();
  if (!raw) return null;

  try {
    const spell = await fromUuid(raw);
    return spell?.documentName === "Item" && String(spell?.type ?? "") === "spell" ? spell : null;
  } catch (_err) {
    return null;
  }
}

async function resolveCasterActor(actorUuid) {
  const raw = String(actorUuid ?? "").trim();
  if (!raw) return null;

  try {
    const actor = await fromUuid(raw);
    return actor?.documentName === "Actor" ? actor : null;
  } catch (_err) {
    return null;
  }
}

export const CastSpellService = {
  async cast(cfg = {}) {
    const normalizedTargetTokenUuids = normalizeTargetTokenUuids(cfg.targetTokenUuids ?? []);

    if (normalizedTargetTokenUuids.length > 1) {
      const [spell, actor] = await Promise.all([
        resolveSpellDocument(cfg.spellUuid),
        resolveCasterActor(cfg.casterActorUuid),
      ]);

      if (spell && actor) {
        const profile = resolveSpellProfile(spell, actor, {
          level: cfg.spellOptions?.castLevel ?? null,
          isRestrained: cfg.spellOptions?.isRestrained ?? false,
          isOverloaded: cfg.spellOptions?.isOverloaded ?? false,
        });

        if (profile?.classification?.isDirect === true) {
          let lastResult = null;
          for (const targetTokenUuid of normalizedTargetTokenUuids) {
            lastResult = await SpellCastingService.cast({
              ...cfg,
              targetTokenUuids: [targetTokenUuid],
            });
            if (lastResult?.success !== true) return lastResult;
          }
          return lastResult ?? { success: false, messageId: null, error: "No direct spell targets were resolved." };
        }
      }
    }

    return SpellCastingService.cast({
      ...cfg,
      targetTokenUuids: normalizedTargetTokenUuids,
    });
  },
};
