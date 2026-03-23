import { getEffectByKey } from "./effects.js";
import { buildDirectAlchemyPayloadForSpell } from "./workflow-descriptors.js";
import { ALCHEMY_DEFAULT_ICON, cloneAlchemyData } from "./shared.js";

export function getAlchemyEffectLabel(effectEntry) {
  return String(effectEntry?.effectLabel ?? effectEntry?.spellName ?? "").trim()
    || getEffectByKey(effectEntry?.effectKey)?.label
    || String(effectEntry?.effectKey ?? effectEntry?.spellUuid ?? "Unknown Effect");
}

export function buildSyntheticSpellFromPayload(effectEntry) {
  const payload = effectEntry?.directPayload ?? null;
  const snapshot = payload?.spellSnapshot ? cloneAlchemyData(payload.spellSnapshot) : null;
  if (!snapshot) return null;
  snapshot.effects = Array.isArray(snapshot.effects) ? snapshot.effects : [];
  snapshot.system = snapshot.system ?? {};
  snapshot.name = snapshot.name ?? effectEntry?.effectLabel ?? effectEntry?.spellName ?? "Alchemy Spell";
  snapshot.img = snapshot.img ?? ALCHEMY_DEFAULT_ICON;
  snapshot.uuid = String(snapshot.uuid ?? payload?.spellUuid ?? effectEntry?.spellUuid ?? "").trim()
    || `Alchemy.${foundry.utils.randomID()}`;
  snapshot.id = snapshot.id ?? null;
  return snapshot;
}

export async function normalizeStoredSpellEffect(effectEntry, { mode = "potion" } = {}) {
  if (effectEntry?.directPayload) return { ok: true, effectEntry };

  const spellUuid = String(effectEntry?.spellUuid ?? "").trim();
  if (!spellUuid) return { ok: false, reason: "Missing brewed spell reference." };

  const spell = await fromUuid(spellUuid).catch(() => null);
  if (!spell || spell.type !== "spell") {
    return { ok: false, reason: `${getAlchemyEffectLabel(effectEntry)} could not resolve its source spell.` };
  }

  const directPayload = buildDirectAlchemyPayloadForSpell(spell, {
    mode,
    spellLevel: Math.max(1, Number(effectEntry?.spellLevel ?? 1) || 1),
    cost: Math.max(0, Number(effectEntry?.cost ?? spell?.system?.cost ?? 0) || 0),
    finalDuration: effectEntry?.finalDuration ?? null,
  });
  if (!directPayload?.ok || !directPayload?.payload) {
    return {
      ok: false,
      reason: directPayload?.reason ?? `${spell.name} must be re-brewed to use direct alchemy resolution.`,
    };
  }

  return {
    ok: true,
    effectEntry: {
      ...effectEntry,
      directPayload: directPayload.payload,
    },
  };
}

function _scaleHalfPotencyDuration(duration) {
  if (!duration) return duration;
  const unit = String(duration.unit ?? "").trim();
  if (!unit || unit === "instant" || unit === "permanent") return duration;
  return {
    value: Math.max(1, Math.floor((Number(duration.value ?? 0) || 0) / 2)),
    unit,
  };
}

export function cloneEffectEntryWithPotency(effectEntry, potency = 1) {
  if (potency >= 1) return effectEntry;
  const next = cloneAlchemyData(effectEntry);
  if (next?.finalDuration) next.finalDuration = _scaleHalfPotencyDuration(next.finalDuration);
  if (next?.directPayload?.finalDuration) next.directPayload.finalDuration = _scaleHalfPotencyDuration(next.directPayload.finalDuration);
  if (next?.directPayload?.spellSnapshot?.system?.duration) {
    next.directPayload.spellSnapshot.system.duration = _scaleHalfPotencyDuration(next.directPayload.spellSnapshot.system.duration);
  }
  if (next?.directPayload?.spellSnapshot?.system?.level) {
    next.directPayload.spellSnapshot.system.level = Math.max(1, Math.floor(Number(next.directPayload.spellSnapshot.system.level ?? 1) / 2));
  }
  return next;
}
