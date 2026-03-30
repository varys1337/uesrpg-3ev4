export async function wouldCreateCircularGroupReference(actor, actorUuid) {
  if (!actorUuid) return false;
  if (actorUuid === actor?.uuid) return true;

  const checkActor = async (uuid, visited = new Set()) => {
    if (visited.has(uuid)) return false;
    visited.add(uuid);

    const groupActor = await fromUuid(uuid);
    if (!groupActor || groupActor.type !== "Group") return false;

    for (const member of groupActor.system.members || []) {
      if (member.id === actor?.uuid) return true;
      if (await checkActor(member.id, visited)) return true;
    }
    return false;
  };

  return checkActor(actorUuid);
}
