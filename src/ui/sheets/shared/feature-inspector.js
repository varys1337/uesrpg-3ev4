import { getFeatureConfig } from "../../../core/traits/features/feature-config.js";

/**
 * src/ui/sheets/shared/feature-inspector.js
 *
 * Prepare Feature Inspector context for actor/NPC sheet templates.
 * This reads the in-memory FeatureMod data from actor.system.ui (populated
 * during prepareData) and reshapes it for the Handlebars template.
 *
 * No mutations, no side effects — pure data transformation.
 */

/**
 * Format a FeatureMod path for display.
 * "system.resistance.fireR" → "Resistance: Fire"
 * "system.speed.bonus" → "Speed Bonus"
 * "flag.undead" → "Flag: Undead"
 */
function _formatPath(path) {
  const p = String(path ?? "");

  // Resistance lanes
  const resistMatch = p.match(/system\.resistance\.(\w+)/);
  if (resistMatch) {
    const key = resistMatch[1].replace(/R$/, "");
    return `Resistance: ${_capitalize(key)}`;
  }

  // Immunity
  const immuneMatch = p.match(/immunity\.(?:condition\.)?(\w+)/);
  if (immuneMatch) {
    return `Immunity: ${_capitalize(immuneMatch[1])}`;
  }

  // Flags
  const flagMatch = p.match(/flag\.(\w+)/);
  if (flagMatch) {
    return `Flag: ${_capitalize(flagMatch[1])}`;
  }

  // Generic system paths
  const systemMatch = p.match(/system\.(\w+)\.(\w+)/);
  if (systemMatch) {
    return `${_capitalize(systemMatch[1])}: ${_capitalize(systemMatch[2])}`;
  }

  return p;
}

function _capitalize(str) {
  const s = String(str ?? "");
  if (!s) return "";
  // Support camelCase → space-separated
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Map stacking mode to a short human-readable label.
 */
function _stackingLabel(mode) {
  switch (mode) {
    case "highest": return "Highest Wins";
    case "add":     return "Additive";
    case "any":     return "Any (Boolean)";
    case "none":    return "Non-Stackable";
    case "override": return "Override";
    default:        return mode ?? "—";
  }
}

function _isVisibleInInspector(mod, actor) {
  const itemId = String(mod?.source?.itemId ?? "").trim();
  if (!itemId || !actor?.items) return true;
  const item = actor.items.get?.(itemId) ?? actor.items.find?.((it) => String(it?.id ?? "") === itemId);
  if (!item) return true;

  const type = String(item.type ?? "");
  if (!(type === "trait" || type === "talent" || type === "power")) return true;

  const cfg = getFeatureConfig(item);
  if (cfg?.debug?.showInInspector === false) return false;
  if (cfg?.visibility === "gmOnly" && !game?.user?.isGM) return false;
  return true;
}

function _estimateFinalFromVisible(group) {
  const mode = String(group?.stacking ?? "add");
  const values = (group?.contributions ?? []).map((c) => c?.value);
  if (!values.length) return null;

  if (mode === "any" || mode === "boolean") {
    return values.some((v) => Boolean(v));
  }
  if (mode === "highest") {
    const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    return nums.length ? Math.max(...nums) : null;
  }
  if (mode === "none" || mode === "override") {
    return values[0] ?? null;
  }

  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((acc, v) => acc + v, 0) : null;
}


/**
 * Build a template-friendly feature inspector context from actor data.
 *
 * @param {Actor} actor  The actor document.
 * @returns {object|null}  Context for the feature-inspector partial, or null if unavailable.
 */
export function buildFeatureInspectorContext(actor) {
  const ui = actor?.system?.ui;
  if (!ui) return null;

  const rawMods = ui.featureMods;
  if (!Array.isArray(rawMods) || rawMods.length === 0) return null;
  const visibleMods = rawMods.filter((mod) => _isVisibleInInspector(mod, actor));
  if (!visibleMods.length) return null;

  // Group mods by path for the table.
  const groupedMap = new Map();

  for (const mod of visibleMods) {
    const path = mod.path ?? "";
    if (!groupedMap.has(path)) {
      groupedMap.set(path, {
        path,
        pathLabel: _formatPath(path),
        domain: mod.domain ?? "",
        stacking: mod.rule?.stacking ?? "none",
        stackingLabel: _stackingLabel(mod.rule?.stacking),
        contributions: [],
        finalValue: null,
      });
    }
    const group = groupedMap.get(path);
    group.contributions.push({
      sourceType: mod.source?.type ?? "?",
      sourceKey: mod.source?.key ?? "",
      itemName: mod.source?.itemName ?? "",
      itemId: mod.source?.itemId ?? "",
      mode: mod.mode ?? "add",
      value: mod.value,
      valueLabel: _formatValue(mod.value, mod.mode),
      ruleName: mod.rule?.name ?? "",
    });
  }

  // Compute final values per path from the stacking-reduced data.
  const totals = ui.featureModTotals;
  if (game?.user?.isGM && totals instanceof Map) {
    for (const [path, total] of totals) {
      const group = groupedMap.get(path);
      if (group) group.finalValue = total;
    }
  } else {
    for (const group of groupedMap.values()) {
      group.finalValue = _estimateFinalFromVisible(group);
    }
  }

  // Convert Map to array for Handlebars.
  const groups = Array.from(groupedMap.values());

  // Sort: resistances first, then flags, then misc.
  groups.sort((a, b) => {
    const domainOrder = { resistance: 0, weakness: 1, immunity: 2, speed: 3, initiative: 4, woundThreshold: 5, hp: 6, mp: 7, sp: 8, lp: 9, flag: 10, misc: 11 };
    const da = domainOrder[a.domain] ?? 99;
    const db = domainOrder[b.domain] ?? 99;
    if (da !== db) return da - db;
    return a.pathLabel.localeCompare(b.pathLabel);
  });

  // Summary stats.
  const totalContributions = visibleMods.length;
  const uniquePaths = groups.length;

  return {
    groups,
    totalContributions,
    uniquePaths,
    modsJson: JSON.stringify(visibleMods, null, 2),
    hasData: true,
  };
}


function _formatValue(value, mode) {
  if (mode === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n >= 0 ? `+${n}` : `${n}`;
}
