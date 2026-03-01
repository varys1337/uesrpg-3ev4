import { computeSkillTN, getDifficultyByKey } from "../skills/skill-tn.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { computeCharacteristicTN } from "../characteristics/opposed/helpers.js";

function normalizeChaKey(v = "") {
  const s = String(v ?? "").trim().toLowerCase();
  switch (s) {
    case "strength": return "str";
    case "endurance": return "end";
    case "agility": return "agi";
    case "intelligence": return "int";
    case "willpower": return "wp";
    case "perception": return "prc";
    case "personality": return "prs";
    case "luck": return "lck";
    default: return s;
  }
}

function chaLabel(key = "") {
  switch (String(key ?? "").toLowerCase()) {
    case "str": return "Strength";
    case "end": return "Endurance";
    case "agi": return "Agility";
    case "int": return "Intelligence";
    case "wp": return "Willpower";
    case "prc": return "Perception";
    case "prs": return "Personality";
    case "lck": return "Luck";
    default: return String(key || "").toUpperCase();
  }
}

function governingOptions(skillItem) {
  const raw = String(skillItem?.system?.governingCha ?? "");
  const base = normalizeChaKey(skillItem?.system?.baseCha ?? "");
  const keys = raw
    .split(/[,\n/]+/)
    .map((s) => normalizeChaKey(s))
    .filter(Boolean);
  if (base && !keys.includes(base)) keys.push(base);
  return keys.map((k) => ({ key: k, label: chaLabel(k) }));
}

export function getActorSkillOptions(actor) {
  const items = actor?.items ?? [];
  return items
    .filter((i) => ["skill", "magicSkill", "combatStyle"].includes(String(i.type)))
    .map((i) => {
      const hasSpec = String(i?.system?.trainedItems ?? "").trim().length > 0;
      return {
        uuid: i.uuid,
        id: i.id,
        name: i.name,
        hasSpec,
        governingChaOptions: governingOptions(i),
        selectedCha: normalizeChaKey(i?.system?.baseCha ?? ""),
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function getActorCharacteristicOptions(actor) {
  const chars = actor?.system?.characteristics ?? {};
  return Object.keys(chars)
    .map((k) => normalizeChaKey(k))
    .filter(Boolean)
    .map((k) => ({ key: k, label: chaLabel(k) }));
}

function resolveSkill(actor, uuidOrId) {
  if (!actor || !uuidOrId) return null;
  const id = String(uuidOrId);
  return actor.items.find((i) => String(i.uuid) === id || String(i.id) === id) ?? null;
}

export async function performTravelAssignmentRoll({
  actor,
  assignment,
  terrainMod = 0,
  autoMod = 0,
  extraMods = [],
} = {}) {
  if (!actor) throw new Error("Missing actor for travel roll.");
  if (!assignment) throw new Error("Missing assignment for travel roll.");

  const difficulty = getDifficultyByKey(String(assignment?.difficultyKey ?? "average"));
  const manualMod = Number(assignment?.manualMod ?? 0);
  const extrasTotal = (Array.isArray(extraMods) ? extraMods : []).reduce((sum, v) => sum + Number(v || 0), 0);
  const totalMod = manualMod + Number(difficulty?.mod ?? 0) + Number(terrainMod || 0) + Number(autoMod || 0) + extrasTotal;
  const mode = String(assignment?.testMode ?? "skill");

  if (mode === "characteristic") {
    const charKey = normalizeChaKey(assignment?.charKey ?? "int");
    const tn = computeCharacteristicTN(actor, charKey, totalMod, 0);
    const result = await doTestRoll(actor, { target: tn.finalTN });
    const breakdown = [
      { label: `${chaLabel(charKey)} Base`, value: Number(tn.baseTN ?? 0) },
      { label: `${difficulty.label} Difficulty`, value: Number(difficulty.mod ?? 0) },
      { label: "Manual Modifier", value: manualMod },
      { label: "Terrain Modifier", value: Number(terrainMod || 0) },
      { label: "Automatic Modifiers", value: Number(autoMod || 0) },
      ...((Array.isArray(extraMods) ? extraMods : []).map((value, idx) => ({
        label: `Extra Modifier ${idx + 1}`,
        value: Number(value || 0),
      }))),
    ];
    return {
      mode,
      target: tn.finalTN,
      breakdown,
      result,
      label: chaLabel(charKey),
      difficulty,
      totalMod,
    };
  }

  const skill = resolveSkill(actor, assignment?.skillUuid);
  if (!skill) throw new Error("Selected skill not found on actor.");
  const selectedCharacteristicKey = normalizeChaKey(assignment?.charKey ?? "");
  const tn = computeSkillTN({
    actor,
    skillItem: skill,
    difficultyKey: difficulty.key,
    manualMod: totalMod,
    selectedCharacteristicKey: selectedCharacteristicKey || null,
    useSpecialization: Boolean(assignment?.useSpec),
    situationalMods: [],
  });
  const result = await doTestRoll(actor, { target: tn.finalTN });
  return {
    mode,
    target: tn.finalTN,
    breakdown: tn.breakdown ?? [],
    result,
    label: skill.name,
    difficulty,
    totalMod,
    skillUuid: skill.uuid,
  };
}

