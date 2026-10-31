/** Pure document queries shared by summon talents, trait consumers and cleanup. */
import { FLAG_SCOPE } from "../../system/namespace.js";
import { hasTalent } from "../../traits/talents-api.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";

export function getSummonState(actorOrToken) {
  const token = actorOrToken?.documentName === "Actor" ? actorOrToken.token : actorOrToken;
  const flags = token?.flags?.[FLAG_SCOPE];
  if (flags?.isSummonedToken !== true) return null;
  const spell = flags.spellUuid ? resolveUuidSync(flags.spellUuid) : null;
  const kind = flags.summonKind ?? spell?.flags?.[FLAG_SCOPE]?.summonType ?? "";
  return { ...flags, token, summonKind: String(kind).toLowerCase() };
}

export function getSummonedTokens(casterActor, { scene = canvas?.scene ?? null, allScenes = false, kind = null, boundOnly = false } = {}) {
  if (!casterActor?.uuid) return [];
  const scenes = allScenes ? Array.from(game.scenes ?? []) : scene ? [scene] : [];
  return scenes.flatMap(entry => Array.from(entry.tokens ?? [])).filter(token => {
    const state = getSummonState(token);
    return state?.summonerActorUuid === casterActor.uuid
      && (!kind || state.summonKind === kind)
      && (!boundOnly || state.binding?.status === "bound");
  });
}

/** Mending Tides grants the ordinary Regeneration trait only while controlled. */
export function getSummonedRegeneration(actor) {
  const state = getSummonState(actor);
  if (state?.summonKind !== "daedra" || state.binding?.status !== "bound") return 0;
  const caster = resolveActorFromUuidSync(state.summonerActorUuid);
  if (!caster || !hasTalent(caster, "themendingtidesoblivion")) return 0;
  return Math.max(0, Number(caster.system?.characteristics?.wp?.bonus ?? 0) || 0);
}

/** Only a weapon produced by Conjure Weapon qualifies for Bladecaller. */
export function isBoundWeaponFromConjureWeapon(item) {
  const flags = item?.flags?.[FLAG_SCOPE];
  if (item?.type !== "weapon" || flags?.isBoundItem !== true) return false;
  const spell = flags.spellUuid ? resolveUuidSync(flags.spellUuid) : null;
  const family = flags.conjureSourceFamily ?? spell?.flags?.[FLAG_SCOPE]?.coreSource?.family;
  if (family) return family === "conjureweapon";
  // Saved pre-reconciliation Items retain their source UUID and spell label.
  return String(spell?.name ?? flags.spellName ?? "").replace(/[^a-z]/gi, "").toLowerCase() === "conjureweapon";
}
