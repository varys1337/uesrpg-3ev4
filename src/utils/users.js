/**
 * Resolve the deterministic active GM used for single-writer workflows.
 * Foundry's activeGM is preferred; the stable-id fallback covers startup races.
 */
export function getActiveGMUser() {
  try {
    if (game.users?.activeGM) return game.users.activeGM;
    const activeGMs = (game.users?.contents ?? []).filter((user) => user?.active && user.isGM);
    activeGMs.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return activeGMs[0] ?? null;
  } catch (_error) {
    return null;
  }
}

export function isActiveGMUser(user) {
  if (!user?.isGM) return false;
  const activeGM = getActiveGMUser();
  return activeGM ? activeGM.id === user.id : true;
}
