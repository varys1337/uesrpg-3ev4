function asId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rankOption(label, itemType, itemName, {
  id = null,
  aliases = [],
  xpCost = 0,
  system = null,
} = {}) {
  return {
    id: asId(id ?? itemName ?? label),
    label: String(label),
    xpCost: Math.max(0, Number(xpCost) || 0),
    operations: [{
      kind: "setRank",
      itemType: String(itemType),
      itemName: String(itemName),
      aliases: aliases.map(String),
      rank: "novice",
      ...(system && typeof system === "object" ? { system: { ...system } } : {}),
    }],
  };
}

export function talentOption(label, itemName, { id = null, xpCost = 0, aliases = [] } = {}) {
  return {
    id: asId(id ?? itemName ?? label),
    label: String(label),
    xpCost: Math.max(0, Number(xpCost) || 0),
    operations: [{
      kind: "grantItem",
      itemType: "talent",
      itemName: String(itemName),
      aliases: aliases.map(String),
    }],
  };
}

export function choiceOption(label, { id = null, xpCost = 0, value = null } = {}) {
  return {
    id: asId(id ?? value ?? label),
    label: String(label),
    xpCost: Math.max(0, Number(xpCost) || 0),
    operations: [{ kind: "recordChoice", value: String(value ?? label) }],
  };
}

export function combatStyleOption(label = "Combat Style", { id = "combat-style", xpCost = 0 } = {}) {
  return {
    id: asId(id),
    label: String(label),
    xpCost: Math.max(0, Number(xpCost) || 0),
    operations: [{ kind: "setRank", itemType: "combatStyle", selectTarget: true, rank: "novice" }],
  };
}

export function combinedOption(id, label, options, { xpCost = 0 } = {}) {
  return {
    id: asId(id),
    label: String(label),
    xpCost: Math.max(0, Number(xpCost) || 0),
    operations: options.flatMap((option) => option?.operations ?? []).map((operation) => ({ ...operation })),
  };
}

export function grant(id, label, options) {
  return {
    id: asId(id),
    label: String(label),
    options: (Array.isArray(options) ? options : []).map((option) => ({ ...option })),
  };
}

export function magicNoviceOptions(names) {
  return (Array.isArray(names) ? names : []).map((name) => rankOption(name, "magicSkill", name));
}

export function skillNoviceOptions(names) {
  return (Array.isArray(names) ? names : []).map((name) => rankOption(name, "skill", name));
}
