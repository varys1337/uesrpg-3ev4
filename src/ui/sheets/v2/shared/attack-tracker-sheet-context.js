import { buildAttackTrackerContext } from "../../../../core/combat/attack-tracker-context.js";

function _readSheetTrackerAuthorityHint(sheet, actor) {
  const hint = sheet?._uesrpgAttackTrackerAuthorityHint;
  if (!hint || typeof hint !== "object") return null;

  const actorUuid = String(actor?.uuid ?? "").trim();
  const hintedActorUuid = String(hint.actorUuid ?? "").trim();
  if (hintedActorUuid && actorUuid && hintedActorUuid !== actorUuid) return null;

  const hintedCombatId = String(hint.combatId ?? "").trim();
  const currentCombatId = String(game?.combat?.id ?? "").trim();
  if (hintedCombatId && currentCombatId && hintedCombatId !== currentCombatId) return null;

  return hint;
}

export function buildSheetAttackTrackerContext(sheet, actor) {
  const directSheetToken = sheet?.token?.document ?? sheet?.token ?? null;
  const hintedAuthority = directSheetToken ? null : _readSheetTrackerAuthorityHint(sheet, actor);

  return buildAttackTrackerContext(actor, {
    source: "sheet-combat-tab",
    sheetToken: directSheetToken,
    tokenUuid: directSheetToken?.document?.uuid
      ?? directSheetToken?.uuid
      ?? hintedAuthority?.tokenUuid
      ?? null,
    combatantId: hintedAuthority?.combatantId ?? null,
    authoritative: typeof hintedAuthority?.authoritative === "boolean"
      ? hintedAuthority.authoritative
      : undefined,
    authorityState: hintedAuthority?.authorityState ?? null,
    ambiguityState: hintedAuthority?.ambiguityState ?? null,
    resolutionSource: hintedAuthority?.resolutionSource ?? null,
    attackTraceId: hintedAuthority?.attackTraceId ?? null,
    attackMode: hintedAuthority?.attackMode ?? null,
    phase: hintedAuthority?.phase ?? null,
    sourceTag: hintedAuthority?.sourceTag ?? null,
    notice: hintedAuthority?.notice ?? null,
  });
}
