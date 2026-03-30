import {
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
  requestUpdateEmbeddedDocuments,
} from "../../utils/authority-proxy.js";
import { ALCHEMY_DEFAULT_ICON, cloneAlchemyData, FLAG_NS } from "./shared.js";
import { getActorItemsArray } from "./utils.js";

export const ALCHEMY_WEAPON_AE_KEY = "alchemyWeaponApplied";

export function getWeaponAlchemyEffect(item) {
  return Array.from(item?.effects ?? []).find((effect) => {
    const payload = effect?.flags?.[FLAG_NS]?.[ALCHEMY_WEAPON_AE_KEY];
    return Boolean(payload?.kind);
  }) ?? null;
}

export function getAppliedAlchemy(item) {
  const effect = getWeaponAlchemyEffect(item);
  if (effect) {
    return {
      ...cloneAlchemyData(effect.flags?.[FLAG_NS]?.[ALCHEMY_WEAPON_AE_KEY] ?? {}),
      effectId: effect.id ?? null,
      source: "ae",
    };
  }

  const legacy = item?.flags?.[FLAG_NS]?.alchemyApplied ?? null;
  if (!legacy) return null;
  return {
    ...cloneAlchemyData(legacy),
    effectId: null,
    source: "legacy-flag",
  };
}

export function isAlchemyWeaponTarget(item) {
  return String(item?.type ?? "").trim().toLowerCase() === "weapon" && item?.system?.equipped === true;
}

export function isAlchemyAmmoTarget(item) {
  return String(item?.type ?? "").trim().toLowerCase() === "ammunition"
    && Math.max(0, Number(item?.system?.quantity ?? 0) || 0) > 0
    && !getAppliedAlchemy(item);
}

export function getAlchemyWeaponTargets(actor) {
  return getActorItemsArray(actor).filter((item) => isAlchemyWeaponTarget(item));
}

export function getAlchemyCoatingTargets(actor) {
  return getActorItemsArray(actor).filter((item) => isAlchemyWeaponTarget(item) || isAlchemyAmmoTarget(item));
}

export function getAlchemyTargetOptionLabel(item) {
  return String(item?.type ?? "").trim().toLowerCase() === "ammunition"
    ? `Ammunition: ${item.name}`
    : `Weapon: ${item.name}`;
}

export function buildCoatedAmmoName(ammoItem, alchemyFlags) {
  const baseName = String(ammoItem?.name ?? "Ammunition").trim() || "Ammunition";
  const kind = String(alchemyFlags?.kind ?? "").trim().toLowerCase();
  if (kind === "poison") {
    const formula = String(alchemyFlags?.damageFormula ?? "").trim();
    return `${baseName} (Poisoned${formula ? `, ${formula}` : ""})`;
  }
  return `${baseName} (Toxin)`;
}

export function buildWeaponAlchemyAEData(alchemyItem, alchemyFlags) {
  const isCombat = Boolean(game.combat?.active);
  const durationRounds = Number(alchemyFlags?.kind === "toxin" ? (alchemyFlags.durationRounds ?? 10) : 10) || 10;
  const payload = {
    version: 2,
    kind: alchemyFlags.kind,
    itemUuid: alchemyItem?.uuid ?? null,
    itemName: alchemyItem?.name ?? null,
    appliedAtWorldTime: Number(game.time?.worldTime ?? 0) || 0,
    appliedAtCombatRound: Number(game.combat?.round ?? 0) || 0,
    durationRounds,
    expiresAfterSeconds: 60,
    backfired: Boolean(alchemyFlags?.backfired),
    ...(alchemyFlags.kind === "poison" ? {
      damageFormula: String(alchemyFlags?.damageFormula ?? "1d4"),
      poisonLevel: Math.max(1, Number(alchemyFlags?.poisonLevel ?? 1) || 1),
    } : {}),
    ...(alchemyFlags.kind === "toxin" ? {
      effects: cloneAlchemyData(alchemyFlags?.effects ?? []),
      maxHits: Math.max(1, Number(alchemyFlags?.maxHits ?? 3) || 3),
      hitsRemaining: Math.max(1, Number(alchemyFlags?.maxHits ?? 3) || 3),
    } : {}),
  };

  return {
    name: alchemyFlags.kind === "poison"
      ? `Applied Poison (${payload.poisonLevel ?? 1})`
      : `Applied Toxin (${payload.hitsRemaining ?? 3} hits)`,
    icon: ALCHEMY_DEFAULT_ICON,
    origin: alchemyItem?.uuid ?? null,
    duration: isCombat
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: 60 },
    changes: [],
    disabled: false,
    flags: {
      [FLAG_NS]: {
        [ALCHEMY_WEAPON_AE_KEY]: payload,
      },
    },
  };
}

export function isAppliedAlchemyExpired(applied) {
  if (!applied) return true;
  const nowRound = Number(game.combat?.round ?? 0) || 0;
  const appliedRound = Number(applied?.appliedAtCombatRound ?? 0) || 0;
  const durationRounds = Math.max(0, Number(applied?.durationRounds ?? 10) || 10);
  if (game.combat?.active && durationRounds > 0 && appliedRound > 0) {
    if ((nowRound - appliedRound) >= durationRounds) return true;
  }

  const nowWorldTime = Number(game.time?.worldTime ?? 0) || 0;
  const appliedWorldTime = Number(applied?.appliedAtWorldTime ?? 0) || 0;
  const expirySeconds = Math.max(0, Number(applied?.expiresAfterSeconds ?? 60) || 60);
  if (appliedWorldTime > 0 && expirySeconds > 0 && (nowWorldTime - appliedWorldTime) >= expirySeconds) return true;
  return false;
}

export async function clearAppliedAlchemy(item, applied = null) {
  const current = applied ?? getAppliedAlchemy(item);
  if (!current) return false;

  if (current.effectId) {
    const liveEffect = item?.effects?.get?.(current.effectId) ?? null;
    if (liveEffect) {
      const deleted = await requestDeleteEmbeddedDocuments(item, "ActiveEffect", [current.effectId]);
      return Boolean(deleted);
    }
    return true;
  }

  if (item?.flags?.[FLAG_NS]?.alchemyApplied) {
    await requestUpdateDocument(item, { [`flags.${FLAG_NS}.alchemyApplied`]: null });
    return true;
  }

  return false;
}

export async function updateAppliedAlchemyHits(item, applied, hitsRemaining) {
  const next = Math.max(0, Number(hitsRemaining ?? 0) || 0);
  if (applied?.effectId) {
    return requestUpdateEmbeddedDocuments(item, "ActiveEffect", [{
      _id: applied.effectId,
      [`flags.${FLAG_NS}.${ALCHEMY_WEAPON_AE_KEY}.hitsRemaining`]: next,
      name: `Applied Toxin (${next} hits)`,
    }]);
  }

  if (item?.flags?.[FLAG_NS]?.alchemyApplied) {
    await requestUpdateDocument(item, {
      [`flags.${FLAG_NS}.alchemyApplied.hitsRemaining`]: next,
    });
    return true;
  }

  return false;
}
