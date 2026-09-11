import { isWarfareUnitActorType } from "../actors/types.js";

const GOV_CHA_ALIASES = Object.freeze({
  str: "str",
  strength: "str",
  end: "end",
  endurance: "end",
  agi: "agi",
  agility: "agi",
  int: "int",
  intelligence: "int",
  wp: "wp",
  willpower: "wp",
  prc: "prc",
  perception: "prc",
  prs: "prs",
  presence: "prs",
  personality: "prs",
  lck: "lck",
  luck: "lck",
});

export function asCombatNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function getCharacteristicTotal(actor, key) {
  return asCombatNumber(actor?.system?.characteristics?.[key]?.total ?? actor?.system?.characteristics?.[key]?.value ?? 0);
}

function parseGoverningCharacteristicKeys(governingRaw, actor) {
  const raw = String(governingRaw ?? "").trim().toLowerCase();
  if (!raw) return [];

  const parts = raw.split(/[,/;]+|\s+/g).map((part) => part.trim()).filter(Boolean);
  const available = new Set(Object.keys(actor?.system?.characteristics ?? {}));
  const out = [];

  for (const part of parts) {
    const key = GOV_CHA_ALIASES[part];
    if (key && (available.size === 0 || available.has(key))) out.push(key);
  }
  return [...new Set(out)];
}

function getDominantGoverningCharacteristicTotal(actor, governingRaw) {
  let best = null;
  for (const key of parseGoverningCharacteristicKeys(governingRaw, actor)) {
    const value = getCharacteristicTotal(actor, key);
    if (best == null || value > best) best = value;
  }
  return best;
}

export function computeDefenderTNOverride(defender, tnOverride) {
  if (!defender || !tnOverride || typeof tnOverride !== "object") return null;
  if (isWarfareUnitActorType(defender?.type)) return null;

  const skillName = String(tnOverride.skillName ?? "").trim();
  const newChaKey = String(tnOverride.fallbackCharacteristic ?? tnOverride.characteristicKey ?? "").trim().toLowerCase();
  if (!skillName || !newChaKey) return null;

  if (defender.type === "NPC") {
    return { tn: getCharacteristicTotal(defender, newChaKey), label: `${skillName} (${newChaKey.toUpperCase()})` };
  }

  const skillItem = (defender.items ?? []).find((item) => (
    item.type === "skill" && String(item.name ?? "").toLowerCase() === skillName.toLowerCase()
  ));
  if (!skillItem) {
    return { tn: getCharacteristicTotal(defender, newChaKey), label: `${skillName} (${newChaKey.toUpperCase()})` };
  }

  const skillTN = asCombatNumber(skillItem.system?.value ?? 0);
  const governingRaw = String(skillItem.system?.governingCha ?? skillItem.system?.baseCha ?? "");
  const dominantGovTotal = getDominantGoverningCharacteristicTotal(defender, governingRaw);
  const newChaTotal = getCharacteristicTotal(defender, newChaKey);

  if (Number.isFinite(Number(dominantGovTotal)) && Number.isFinite(Number(newChaTotal)) && skillTN >= dominantGovTotal) {
    return {
      tn: (skillTN - dominantGovTotal) + newChaTotal,
      label: `${skillName} (${newChaKey.toUpperCase()})`,
    };
  }

  return { tn: skillTN + newChaTotal, label: `${skillName} (${newChaKey.toUpperCase()})` };
}
