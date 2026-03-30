import { CONDITION_KEYS } from "../../conditions/index.js";
import { hasCondition as hasCanonicalCondition } from "../../conditions/condition-engine.js";

export function getActorConditionKeySet(actorData) {
  const out = new Set();
  const keys = Array.isArray(CONDITION_KEYS) ? CONDITION_KEYS : [];
  const api = game?.uesrpg?.conditions;
  const predicate = (actor, key) => {
    if (api?.hasCondition && typeof api.hasCondition === "function") {
      try { return !!api.hasCondition(actor, key); } catch (_e) {}
    }
    try { return !!hasCanonicalCondition(actor, key); } catch (_e) { return false; }
  };

  for (const key of keys) {
    const normalized = String(key ?? "").trim().toLowerCase();
    if (normalized && predicate(actorData, normalized)) out.add(normalized);
  }

  return out;
}

export function applyMovementRestrictionSemantics(actorData, actorSystemData) {
  try {
    if (!actorSystemData?.speed) return;

    const keys = getActorConditionKeySet(actorData);
    const clamp = (n) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.max(0, v) : 0;
    };

    let ground = clamp(actorSystemData.speed.value);
    let swim = clamp(actorSystemData.speed.swimSpeed);
    let fly = clamp(actorSystemData.speed.flySpeed);

    const immobile = keys.has("immobilized") || keys.has("restrained") || keys.has("paralyzed") || keys.has("unconscious");
    if (immobile) {
      ground = 0;
      swim = 0;
      fly = 0;
    } else {
      if (keys.has("slowed")) {
        ground = Math.ceil(ground / 2);
        swim = Math.ceil(swim / 2);
        fly = Math.ceil(fly / 2);
      }
      if (keys.has("entangled")) {
        ground = Math.ceil(ground / 2);
        swim = Math.ceil(swim / 2);
        fly = Math.ceil(fly / 2);
      }
      if (keys.has("prone")) ground = Math.floor(ground / 2);
      if (keys.has("hidden")) {
        ground = Math.floor(ground / 2);
        swim = Math.floor(swim / 2);
        fly = Math.floor(fly / 2);
      }
    }

    actorSystemData.speed.value = ground;
    actorSystemData.speed.swimSpeed = swim;
    if (Object.prototype.hasOwnProperty.call(actorSystemData.speed, "flySpeed")) {
      actorSystemData.speed.flySpeed = fly;
    }
  } catch (err) {
    console.warn("uesrpg-3ev4 | Movement restriction semantics failed", err);
  }
}
