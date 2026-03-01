import { TERRAIN_MODIFIERS } from "./data/terrain-modifiers.js";
import { getTravelEndeavour } from "./data/travel-endeavours.js";

export function convertPoolToEffects(total) {
  const value = Math.max(0, Number(total) || 0);
  if (value >= 7) return 3;
  if (value >= 4) return 2;
  if (value >= 1) return 1;
  return 0;
}

export function computePlanningTotals(entries = [], spends = []) {
  const rows = Array.isArray(entries) ? entries : [];
  let dos = 0;
  let dof = 0;
  for (const row of rows) {
    const result = row?.result;
    if (!result) continue;
    if (result.isSuccess) dos += Number(result.degree ?? 0);
    else dof += Number(result.degree ?? 0);
  }
  const benefits = convertPoolToEffects(dos);
  const impairments = convertPoolToEffects(dof);
  const spendRows = Array.isArray(spends) ? spends : [];
  const spentBenefits = spendRows.filter((s) => s?.type === "benefit").length;
  const spentImpairments = spendRows.filter((s) => s?.type === "impairment").length;
  return {
    dos,
    dof,
    benefits,
    impairments,
    spentBenefits,
    spentImpairments,
  };
}

export function computeTerrainModifier(terrainKey, lane) {
  if (!lane) return 0;
  const terrain = TERRAIN_MODIFIERS[String(terrainKey ?? "")];
  if (!terrain) return 0;
  return Number(terrain[lane] ?? 0);
}

function sameActorRows(assignments, actorUuid) {
  return (Array.isArray(assignments) ? assignments : []).filter((r) => String(r?.actorUuid ?? "") === String(actorUuid ?? ""));
}

export function computeDoubleEndeavourPenalty(assignments, row) {
  if (!row?.actorUuid) return 0;
  const peerRows = sameActorRows(assignments, row.actorUuid);
  if (!peerRows.length) return 0;

  let penalty = 0;
  const keys = new Set(peerRows.map((r) => String(r?.endeavourKey ?? "")));
  const key = String(row?.endeavourKey ?? "");

  if ((key === "map" || key === "navigate") && keys.has("map") && keys.has("navigate")) {
    penalty -= 10;
  }

  const sustainKeys = ["water", "huntFish", "forage", "scout"];
  const sustainCount = sustainKeys.reduce((sum, k) => sum + (keys.has(k) ? 1 : 0), 0);
  if (sustainCount >= 2 && sustainKeys.includes(key)) {
    penalty -= 20;
  }

  return penalty;
}

export function validateHasteAssignments(assignments, memberCount) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const hasteRows = rows.filter((r) => String(r?.endeavourKey ?? "") === "haste" && r?.actorUuid);
  if (!hasteRows.length) return { valid: true, reason: "" };

  const nonHasteRows = rows.filter((r) => String(r?.endeavourKey ?? "") !== "haste" && r?.actorUuid);
  if (nonHasteRows.length > 0) {
    return { valid: false, reason: "Haste is exclusive for the stage; no other travel endeavours can be assigned." };
  }

  const unique = new Set(hasteRows.map((r) => String(r.actorUuid)));
  if (memberCount > 0 && unique.size < memberCount) {
    return { valid: false, reason: "Haste requires all party members to participate in this stage." };
  }

  return { valid: true, reason: "" };
}

export function getNavigateOutcomeAdvice(result) {
  if (!result) return null;
  if (result.isSuccess) {
    if (Number(result.degree ?? 0) >= 4) {
      return {
        key: "navigate-shortcut",
        label: "Shortcut found",
        description: "Reduce total stages by 1.",
      };
    }
    return {
      key: "navigate-on-course",
      label: "On course",
      description: "Current stage proceeds normally.",
    };
  }

  if (Number(result.degree ?? 0) >= 4) {
    return {
      key: "navigate-lost-severe",
      label: "Lost (Severe)",
      description: "Add 1 stage, queue event next stage, and apply -30 Navigate TN until a successful Navigate roll.",
    };
  }

  return {
    key: "navigate-lost",
    label: "Led astray",
    description: "Add 1 stage and queue an event next stage.",
  };
}

export function getEndeavourMeta(phase, key) {
  if (phase === "travel") return getTravelEndeavour(key);
  return null;
}

