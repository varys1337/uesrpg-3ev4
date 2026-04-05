import {
  areTokensInBaseContact,
  areWarfareTokensOpposing,
} from "./geometry.js";

function _tokenUuid(tokenDoc) {
  return String(tokenDoc?.uuid ?? "");
}

function _componentId(members = []) {
  return `group:${members.slice().sort().join("|")}`;
}

export function buildWarfareContactGraph(scene, battlefieldUnits = {}, {
  pendingPairs = [],
} = {}) {
  const graph = new Map();
  const tokenDocs = Array.from(scene?.tokens?.contents ?? [])
    .filter((tokenDoc) => tokenDoc?.actor?.type === "Warfare Unit");

  const ensure = (tokenUuid) => {
    const key = String(tokenUuid ?? "");
    if (!key) return null;
    if (!graph.has(key)) graph.set(key, new Set());
    return graph.get(key);
  };

  for (const tokenDoc of tokenDocs) ensure(_tokenUuid(tokenDoc));

  for (let index = 0; index < tokenDocs.length; index += 1) {
    const a = tokenDocs[index];
    for (let inner = index + 1; inner < tokenDocs.length; inner += 1) {
      const b = tokenDocs[inner];
      if (!areWarfareTokensOpposing(a, b)) continue;
      if (!areTokensInBaseContact(a, b)) continue;
      ensure(a.uuid)?.add(String(b.uuid));
      ensure(b.uuid)?.add(String(a.uuid));
    }
  }

  for (const pair of pendingPairs) {
    const a = String(pair?.attackerTokenUuid ?? "");
    const b = String(pair?.defenderTokenUuid ?? "");
    if (!a || !b) continue;
    ensure(a)?.add(b);
    ensure(b)?.add(a);
  }

  return graph;
}

export function buildClashGroupForPair(scene, battlefieldUnits = {}, {
  attackerTokenDoc,
  defenderTokenDoc,
  pendingPairs = [],
} = {}) {
  const attackerTokenUuid = _tokenUuid(attackerTokenDoc);
  const defenderTokenUuid = _tokenUuid(defenderTokenDoc);
  if (!attackerTokenUuid || !defenderTokenUuid) {
    return {
      clashGroupId: "",
      groupMembers: [],
      attackerContactSide: "front",
      defenderContactSide: "front",
    };
  }

  const graph = buildWarfareContactGraph(scene, battlefieldUnits, {
    pendingPairs: [
      ...pendingPairs,
      { attackerTokenUuid, defenderTokenUuid },
    ],
  });

  const members = [];
  const queue = [attackerTokenUuid];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    members.push(current);
    for (const next of Array.from(graph.get(current) ?? [])) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  if (!seen.has(defenderTokenUuid)) members.push(defenderTokenUuid);

  return {
    clashGroupId: _componentId(members),
    groupMembers: members.slice().sort(),
    attackerContactSide: "front",
    defenderContactSide: "front",
  };
}
