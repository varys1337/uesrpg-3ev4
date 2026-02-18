/**
 * @module utils/dev/chapter6-spell-remediation
 * @description Planner/applicator for Chapter 6 spell compendium metadata remediation.
 */

import { findChapter6SpellCatalogEntry } from "./chapter6-spell-catalog.js";

function _num(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function _str(v) {
  return String(v ?? "").trim();
}

function _deepClone(v) {
  try {
    return structuredClone(v);
  } catch (_e) {
    return JSON.parse(JSON.stringify(v));
  }
}

function _setIfChanged(patch, path, next, current) {
  if (next === undefined) return false;
  const cur = foundry.utils.getProperty(current, path);
  if (foundry.utils.isEmpty(next) && foundry.utils.isEmpty(cur)) return false;
  if (JSON.stringify(cur) === JSON.stringify(next)) return false;
  foundry.utils.setProperty(patch, path, next);
  return true;
}

function _buildSpellPatch(spell, catalogEntry, opts = {}) {
  const patch = {};
  const current = spell?.toObject?.() ?? spell;
  const sys = current?.system ?? {};
  const defaults = catalogEntry?.defaults ?? {};

  const changes = [];
  const mark = (key, reason) => changes.push({ key, reason });

  const school = _str(sys.school).toLowerCase();
  if (!school || school === "none") {
    if (_setIfChanged(patch, "system.school", catalogEntry.school, current)) mark("system.school", "Set canonical Chapter 6 school.");
  }

  const level = _num(sys.level, 1);
  const clampedLevel = Math.max(1, Math.min(7, level || 1));
  if (level !== clampedLevel) {
    if (_setIfChanged(patch, "system.level", clampedLevel, current)) mark("system.level", "Clamp spell level to 1..7.");
  }

  if (_str(defaults.rangeType)) {
    const rangeType = _str(sys.rangeType).toLowerCase();
    if (!rangeType || rangeType === "none") {
      if (_setIfChanged(patch, "system.rangeType", defaults.rangeType, current)) mark("system.rangeType", "Set canonical range type.");
    }
  }

  if (typeof defaults.hasUpkeep === "boolean") {
    const hasUpkeep = Boolean(sys.hasUpkeep);
    if (hasUpkeep !== defaults.hasUpkeep && opts?.setUpkeepByCatalog !== false) {
      if (_setIfChanged(patch, "system.hasUpkeep", defaults.hasUpkeep, current)) mark("system.hasUpkeep", "Align upkeep with catalog defaults.");
    }
  }

  const currentMode = _str(sys?.engine?.targeting?.mode);
  if (_str(defaults.engineTargetingMode) && !currentMode) {
    if (_setIfChanged(patch, "system.engine.targeting.mode", defaults.engineTargetingMode, current)) {
      mark("system.engine.targeting.mode", "Set canonical targeting mode.");
    }
  }

  if (_num(defaults.maxTargets, 0) > 0 && _num(sys?.engine?.targeting?.maxTargets, 0) <= 0) {
    if (_setIfChanged(patch, "system.engine.targeting.maxTargets", _num(defaults.maxTargets), current)) {
      mark("system.engine.targeting.maxTargets", "Set catalog maxTargets.");
    }
  }

  if (defaults.isRuneSpell === true && !sys.isRuneSpell) {
    if (_setIfChanged(patch, "system.isRuneSpell", true, current)) mark("system.isRuneSpell", "Mark rune spell.");
  }

  if (defaults.isZonePersistent === true && !sys.isZonePersistent) {
    if (_setIfChanged(patch, "system.isZonePersistent", true, current)) mark("system.isZonePersistent", "Mark persistent zone spell.");
  }

  if (catalogEntry.requiredCapabilities.includes("core:attack") && !Boolean(sys.isAttackSpell) && opts?.setAttackFromCatalog !== false) {
    if (_setIfChanged(patch, "system.isAttackSpell", true, current)) mark("system.isAttackSpell", "Mark attack spell.");
  }

  if (catalogEntry.requiredCapabilities.includes("core:damage")) {
    const damageFormula = _str(sys.damageFormula || sys.damage?.formula);
    if (damageFormula && !Boolean(sys.isDamagingSpell)) {
      if (_setIfChanged(patch, "system.isDamagingSpell", true, current)) mark("system.isDamagingSpell", "Enable damaging spell metadata.");
    }
  }

  // Chapter 6 catalog metadata for deterministic runtime hooks.
  const catalogFlag = {
    entryId: catalogEntry.id,
    family: catalogEntry.family,
    requiredCapabilities: catalogEntry.requiredCapabilities
  };
  if (_setIfChanged(patch, "flags.uesrpg-3ev4.chapter6", catalogFlag, current)) {
    mark("flags.uesrpg-3ev4.chapter6", "Set Chapter 6 catalog metadata.");
  }

  // Utility behavior hints used by utility-spells-service.
  const utilityKind = (() => {
    if (catalogEntry.requiredCapabilities.includes("utility:recall")) return "recall";
    if (catalogEntry.requiredCapabilities.includes("utility:detect")) return "detect";
    if (catalogEntry.requiredCapabilities.includes("utility:telepathy")) return "telepathy";
    if (catalogEntry.requiredCapabilities.includes("utility:open")) return "open";
    if (catalogEntry.requiredCapabilities.includes("utility:cure-disease")) return "cure-disease";
    if (catalogEntry.requiredCapabilities.includes("utility:stabilize")) return "stabilize";
    return "";
  })();
  if (utilityKind) {
    if (_setIfChanged(patch, "flags.uesrpg-3ev4.chapter6Utility.kind", utilityKind, current)) {
      mark("flags.uesrpg-3ev4.chapter6Utility.kind", "Set utility spell kind marker.");
    }
  }

  return {
    patch,
    changes,
    hasChanges: Object.keys(foundry.utils.flattenObject(patch)).length > 0
  };
}

/**
 * Build a deterministic remediation plan for Chapter 6 spells in a compendium.
 *
 * @param {object} [opts]
 * @param {string} [opts.pack="uesrpg-3ev4.spells-revised"]
 * @returns {Promise<object>}
 */
export async function planChapter6SpellRemediation(opts = {}) {
  const packName = _str(opts.pack) || "uesrpg-3ev4.spells-revised";
  const pack = game.packs.get(packName);
  if (!pack || pack.documentName !== "Item") {
    return { error: `Pack ${packName} not found or not an Item pack.` };
  }

  const docs = await pack.getDocuments();
  const spells = docs.filter((d) => d.type === "spell");
  const actions = [];

  for (const spell of spells) {
    const entry = findChapter6SpellCatalogEntry(spell.name);
    if (!entry) continue;
    const remediation = _buildSpellPatch(spell, entry, opts);
    if (!remediation.hasChanges) continue;
    actions.push({
      spellName: spell.name,
      spellId: spell.id,
      spellUuid: spell.uuid,
      entryId: entry.id,
      changes: remediation.changes,
      patch: remediation.patch
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    packName,
    totalSpells: spells.length,
    matchedChapter6Spells: spells.filter((s) => Boolean(findChapter6SpellCatalogEntry(s.name))).length,
    actions
  };
}

/**
 * Apply Chapter 6 spell remediation updates to a compendium.
 *
 * @param {object} [opts]
 * @param {string} [opts.pack="uesrpg-3ev4.spells-revised"]
 * @param {boolean} [opts.dryRun=true]
 * @param {boolean} [opts.backup=true]
 * @returns {Promise<object>}
 */
export async function applyChapter6SpellRemediation(opts = {}) {
  const dryRun = opts?.dryRun !== false;
  const backup = opts?.backup !== false;
  const plan = await planChapter6SpellRemediation(opts);
  if (plan?.error) return plan;

  if (dryRun) {
    return { ...plan, applied: false, dryRun: true, updated: 0, errors: [] };
  }

  if (!game.user?.isGM) {
    return { ...plan, applied: false, dryRun: false, updated: 0, errors: ["Only GMs can apply remediation updates."] };
  }

  const pack = game.packs.get(plan.packName);
  const byId = new Map((await pack.getDocuments()).map((d) => [String(d.id), d]));

  const backupPayload = [];
  const updated = [];
  const errors = [];

  for (const action of plan.actions) {
    const doc = byId.get(String(action.spellId));
    if (!doc) {
      errors.push({ spellName: action.spellName, error: "Document not found while applying remediation." });
      continue;
    }
    try {
      if (backup) backupPayload.push({ spellName: doc.name, spellId: doc.id, before: _deepClone(doc.toObject()) });
      await doc.update(action.patch, { diff: true });
      updated.push({ spellName: doc.name, spellId: doc.id, changes: action.changes });
    } catch (err) {
      errors.push({ spellName: doc.name, spellId: doc.id, error: err?.message ?? String(err) });
    }
  }

  if (backup && backupPayload.length > 0 && typeof saveDataToFile === "function") {
    try {
      const blob = new Blob([JSON.stringify({
        generatedAt: new Date().toISOString(),
        packName: plan.packName,
        entries: backupPayload
      }, null, 2)], { type: "application/json" });
      saveDataToFile(blob, "text/json", `chapter6-spell-remediation-backup-${Date.now()}.json`);
    } catch (_e) {
      errors.push({ spellName: "(backup)", error: "Failed to export backup JSON file." });
    }
  }

  return {
    ...plan,
    dryRun: false,
    applied: true,
    updated: updated.length,
    updatedEntries: updated,
    errors
  };
}
