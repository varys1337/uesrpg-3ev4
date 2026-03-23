export const characteristicAbbreviations = Object.freeze({
  agility: "agi",
  endurance: "end",
  intelligence: "int",
  luck: "lck",
  perception: "prc",
  personality: "prs",
  strength: "str",
  willpower: "wp",
});

export const CHARACTERISTIC_KEYS = Object.freeze(["str", "end", "agi", "int", "wp", "prc", "prs", "lck"]);

export const CHARACTERISTIC_LABELS = Object.freeze({
  str: "Strength",
  end: "Endurance",
  agi: "Agility",
  int: "Intelligence",
  wp: "Willpower",
  prc: "Perception",
  prs: "Personality",
  lck: "Luck"
});

export function normalizeCharacteristicKey(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "strength": return "str";
    case "endurance": return "end";
    case "agility": return "agi";
    case "intelligence": return "int";
    case "willpower": return "wp";
    case "perception": return "prc";
    case "personality": return "prs";
    case "luck": return "lck";
    default: return normalized;
  }
}

export function getCharacteristicLabel(key = "") {
  return CHARACTERISTIC_LABELS[normalizeCharacteristicKey(key)] ?? "";
}

export function getAllCharacteristicOptions(actor = null) {
  const available = actor?.system?.characteristics && typeof actor.system.characteristics === "object"
    ? Object.keys(actor.system.characteristics).map((key) => normalizeCharacteristicKey(key))
    : CHARACTERISTIC_KEYS;
  const keys = available.length ? available : CHARACTERISTIC_KEYS;
  const unique = [];
  for (const key of keys) {
    const normalized = normalizeCharacteristicKey(key);
    if (!CHARACTERISTIC_LABELS[normalized]) continue;
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  return unique.map((key) => ({ key, label: CHARACTERISTIC_LABELS[key] }));
}

export function getItemGoverningCharacteristicOptions(item = null, actor = null) {
  const raw = String(item?.system?.governingCha ?? "");
  const base = normalizeCharacteristicKey(item?.system?.baseCha ?? "");
  const available = new Set(getAllCharacteristicOptions(actor).map((option) => option.key));
  const unique = [];
  for (const token of raw.split(/[,\n/;]+|\s+/)) {
    const normalized = normalizeCharacteristicKey(token);
    if (!CHARACTERISTIC_LABELS[normalized]) continue;
    if (available.size && !available.has(normalized)) continue;
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  if (base && CHARACTERISTIC_LABELS[base] && (!available.size || available.has(base)) && !unique.includes(base)) {
    unique.push(base);
  }
  return unique.map((key) => ({ key, label: CHARACTERISTIC_LABELS[key] }));
}

export function getPreferredSkillCharacteristic(actor = null, item = null) {
  const governing = getItemGoverningCharacteristicOptions(item, actor);
  if (!governing.length) {
    const base = normalizeCharacteristicKey(item?.system?.baseCha ?? "");
    if (CHARACTERISTIC_LABELS[base]) return base;
    return getAllCharacteristicOptions(actor)[0]?.key ?? "";
  }

  let bestKey = governing[0].key;
  let bestValue = Number(actor?.system?.characteristics?.[bestKey]?.total ?? Number.NEGATIVE_INFINITY);
  for (const option of governing.slice(1)) {
    const nextValue = Number(actor?.system?.characteristics?.[option.key]?.total ?? Number.NEGATIVE_INFINITY);
    if (nextValue > bestValue) {
      bestKey = option.key;
      bestValue = nextValue;
    }
  }
  return bestKey;
}
