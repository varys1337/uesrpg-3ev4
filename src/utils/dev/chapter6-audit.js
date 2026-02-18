/**
 * @module utils/dev/chapter6-audit
 * @description Chapter 6 (Spells) compliance audit helpers for GM diagnostics.
 */

import {
  findChapter6SpellCatalogEntry,
  getChapter6SpellCatalog
} from "./chapter6-spell-catalog.js";

function _sort(values = []) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function _str(v) {
  return String(v ?? "").trim();
}

function _makeCheck(id, ok, details = "") {
  return { id: String(id), ok: Boolean(ok), details: String(details ?? "") };
}

async function _readSystemSource(relPath) {
  try {
    const path = _str(relPath).replace(/^\/+/, "");
    const urls = [`systems/${game.system.id}/${path}`, `/systems/${game.system.id}/${path}`];
    for (const url of urls) {
      const response = await fetch(url, { cache: "no-store" });
      if (response?.ok) return await response.text();
    }
  } catch (_e) {
    // no-op
  }
  return null;
}

function _matchesAll(text, patterns = []) {
  if (typeof text !== "string" || !text.length) return false;
  return patterns.every((p) => (p instanceof RegExp ? p.test(text) : text.includes(String(p))));
}

function _runtimeCapabilitySet(sourceByFile = {}) {
  const src = (path) => String(sourceByFile[path] ?? "");
  const caps = new Set();

  if (src("src/core/magic/services/disintegrate-service.js")) caps.add("core:disintegrate");
  if (src("src/core/magic/services/dispel-service.js")) caps.add("core:dispel");
  if (src("src/core/magic/services/drain-service.js")) caps.add("core:drain");
  if (src("src/core/magic/services/soul-trap-service.js")) caps.add("core:soultrap");
  if (src("src/core/magic/services/rune-trigger-service.js")) caps.add("core:rune");
  if (src("src/core/magic/services/condition-triggers.js")) caps.add("core:invisibility-break");
  if (src("src/core/magic/opposed/actions.js")) caps.add("core:ward");
  if (_matchesAll(src("src/core/magic/spell-runtime.js"), ["trySpellReflect"])) caps.add("core:spell-defense");
  if (_matchesAll(src("src/core/magic/effects/spell-effects.js"), ["Frenzy", "Fortify", "Weakness"])) caps.add("core:fortify-weakness-opposition");
  if (_matchesAll(src("src/core/magic/effects/spell-effects.js"), ["removeOpposingSpellEffects"])) caps.add("core:effects");
  if (_matchesAll(src("src/core/magic/opposed/spell-helpers.js"), ["shouldShareSpellDamage"])) caps.add("core:multitarget");
  if (_matchesAll(src("src/core/magic/services/utility-spells-service.js"), ["initializeUtilitySpellsService"])) {
    caps.add("utility:detect");
    caps.add("utility:recall");
    caps.add("utility:telepathy");
    caps.add("utility:open");
    caps.add("utility:cure-disease");
    caps.add("utility:stabilize");
    caps.add("utility:movement");
    caps.add("utility:encumbrance");
  }

  // Generic baseline capabilities represented by canonical spell fields.
  caps.add("core:attack");
  caps.add("core:damage");
  caps.add("core:aoe");
  caps.add("core:zone");
  caps.add("core:condition");
  caps.add("core:duration");
  caps.add("core:upkeep");
  caps.add("core:direct");
  caps.add("core:summon");
  caps.add("core:mindlock");
  caps.add("core:conjure");

  return caps;
}

function _spellMetadataCapabilities(spell) {
  const out = new Set();
  const sys = spell?.system ?? {};
  if (Boolean(sys.isAttackSpell)) out.add("core:attack");
  if (_str(sys.damageFormula) || _str(sys?.damage?.formula)) out.add("core:damage");
  if (_str(sys.rangeType).toLowerCase() === "aoe" || Number(sys.aoeSize ?? 0) > 0) out.add("core:aoe");
  if (Boolean(sys.isZonePersistent)) out.add("core:zone");
  if (Boolean(sys.hasUpkeep)) out.add("core:upkeep");
  if (Boolean(sys.isDirect)) out.add("core:direct");
  if (Boolean(sys.isRuneSpell)) out.add("core:rune");
  if (Boolean(sys.isSummonSpell) || _str(sys?.engine?.conjure?.mode).toLowerCase() === "creature") out.add("core:summon");
  if (_str(sys?.engine?.conjure?.mode).toLowerCase() === "item") out.add("core:conjure");
  if (Number(sys.mindlockValue ?? 0) > 0) out.add("core:mindlock");
  if (_str(sys.duration?.unit).toLowerCase() !== "instant" || Number(sys.duration?.value ?? 0) > 0) out.add("core:duration");
  if ((spell.effects?.size ?? 0) > 0) out.add("core:effects");
  if (_str(spell?.flags?.["uesrpg-3ev4"]?.chapter6Utility?.kind)) {
    out.add(`utility:${_str(spell.flags["uesrpg-3ev4"].chapter6Utility.kind).toLowerCase()}`);
  }
  return out;
}

function _findDataMisalignments(spell, entry) {
  const sys = spell?.system ?? {};
  const mis = [];
  const school = _str(sys.school).toLowerCase();
  if (!school || school === "none") mis.push("missing:system.school");
  if (entry?.school && school && school !== entry.school) mis.push(`mismatch:school(expected ${entry.school}, got ${school})`);

  const lvl = Number(sys.level ?? 0);
  if (!Number.isFinite(lvl) || lvl < 1 || lvl > 7) mis.push("invalid:system.level");

  const def = entry?.defaults ?? {};
  if (_str(def.rangeType) && !_str(sys.rangeType)) mis.push("missing:system.rangeType");
  if (typeof def.hasUpkeep === "boolean" && Boolean(sys.hasUpkeep) !== def.hasUpkeep) mis.push("mismatch:system.hasUpkeep");
  if (_str(def.engineTargetingMode) && !_str(sys?.engine?.targeting?.mode)) mis.push("missing:system.engine.targeting.mode");
  return mis;
}

/**
 * Spell-by-spell Chapter 6 audit for a spell pack.
 *
 * @param {object} [opts]
 * @param {string} [opts.pack="uesrpg-3ev4.spells-revised"]
 * @param {boolean} [opts.log=false]
 * @param {boolean} [opts.includeDetails=false]
 * @returns {Promise<object>}
 */
export async function auditChapter6Spells(opts = {}) {
  const packName = _str(opts.pack) || "uesrpg-3ev4.spells-revised";
  const shouldLog = opts?.log === true;
  const includeDetails = opts?.includeDetails === true;

  const pack = game.packs.get(packName);
  if (!pack || pack.documentName !== "Item") {
    return { error: `Pack ${packName} not found or not an Item pack.` };
  }

  const sourceTargets = [
    "src/core/magic/services/disintegrate-service.js",
    "src/core/magic/services/dispel-service.js",
    "src/core/magic/services/drain-service.js",
    "src/core/magic/services/soul-trap-service.js",
    "src/core/magic/services/rune-trigger-service.js",
    "src/core/magic/services/condition-triggers.js",
    "src/core/magic/services/utility-spells-service.js",
    "src/core/magic/effects/spell-effects.js",
    "src/core/magic/opposed/spell-helpers.js",
    "src/core/magic/opposed/actions.js",
    "src/core/magic/spell-runtime.js"
  ];
  const loaded = {};
  for (const p of sourceTargets) loaded[p] = await _readSystemSource(p);
  const runtimeCaps = _runtimeCapabilitySet(loaded);

  const docs = await pack.getDocuments();
  const spells = docs.filter((d) => d.type === "spell");
  const entries = [];

  for (const spell of spells) {
    const catalogEntry = findChapter6SpellCatalogEntry(spell.name);
    if (!catalogEntry) continue;

    const required = catalogEntry.requiredCapabilities;
    const presentMeta = _spellMetadataCapabilities(spell);
    const present = _sort([...runtimeCaps, ...presentMeta]);
    const missing = required.filter((cap) => !present.includes(cap));
    const misalignments = _findDataMisalignments(spell, catalogEntry);

    let status = "implemented";
    if (missing.length > 0 && misalignments.length > 0) status = "missing";
    else if (missing.length > 0) status = "partial";
    else if (misalignments.length > 0) status = "data-misaligned";

    entries.push({
      spellName: spell.name,
      spellId: spell.id,
      spellUuid: spell.uuid,
      school: _str(spell.system?.school).toLowerCase(),
      family: catalogEntry.family,
      catalogEntryId: catalogEntry.id,
      requiredCapabilities: required,
      presentCapabilities: present,
      missingCapabilities: missing,
      dataMisalignments: misalignments,
      remediationActions: _sort([
        ...missing.map((m) => `runtime:${m}`),
        ...misalignments.map((m) => `data:${m}`)
      ]),
      status
    });
  }

  const byStatus = {
    implemented: entries.filter((e) => e.status === "implemented").length,
    partial: entries.filter((e) => e.status === "partial").length,
    missing: entries.filter((e) => e.status === "missing").length,
    "data-misaligned": entries.filter((e) => e.status === "data-misaligned").length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      chapter: "Chapter 6 - Spells",
      packName,
      catalogSize: getChapter6SpellCatalog().length
    },
    totals: {
      packSpells: spells.length,
      chapter6SpellsMatched: entries.length
    },
    coverage: { byStatus },
    gaps: {
      missingSpells: _sort(entries.filter((e) => e.status === "missing").map((e) => e.spellName)),
      partialSpells: _sort(entries.filter((e) => e.status === "partial").map((e) => e.spellName)),
      dataMisalignedSpells: _sort(entries.filter((e) => e.status === "data-misaligned").map((e) => e.spellName))
    }
  };

  if (includeDetails) report.entries = entries;

  if (shouldLog) {
    console.groupCollapsed?.("UESRPG | Chapter 6 Spell Audit");
    console.table?.(entries.map((e) => ({
      spell: e.spellName,
      family: e.family,
      status: e.status,
      missing: e.missingCapabilities.join(", "),
      data: e.dataMisalignments.join(", ")
    })));
    console.log?.("Coverage", report.coverage);
    console.groupEnd?.();
  }

  return report;
}

/**
 * Core Chapter 6 guardrail audit + spell matrix summary wrapper.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.log=false]
 * @param {boolean} [opts.includeDetails=false]
 * @returns {Promise<object>}
 */
export async function auditChapter6(opts = {}) {
  const shouldLog = opts?.log === true;
  const includeDetails = opts?.includeDetails === true;

  const checks = [];
  const findings = [];

  checks.push(_makeCheck(
    "runtime.magic.cast.exposed",
    typeof game?.uesrpg?.magic?.cast === "function",
    "Expected game.uesrpg.magic.cast to be a function."
  ));

  checks.push(_makeCheck(
    "runtime.magic.resolveProfile.exposed",
    typeof game?.uesrpg?.magic?.resolveProfile === "function",
    "Expected game.uesrpg.magic.resolveProfile to be a function."
  ));

  try {
    const magic = await import("../../core/magic/magicka-utils.js");
    const probeSpell = { system: { cost: 10 } };
    const normal = magic.computeSpellAttemptMagickaCost(null, probeSpell, { isOverloaded: false });
    const overloaded = magic.computeSpellAttemptMagickaCost(null, probeSpell, { isOverloaded: true });
    const ok = Number(normal?.cost) === 10 && Number(overloaded?.cost) === 20;
    checks.push(_makeCheck(
      "cost.attempt.overload_double",
      ok,
      `Expected normal=10 and overloaded=20, got normal=${Number(normal?.cost)}, overloaded=${Number(overloaded?.cost)}`
    ));
  } catch (err) {
    checks.push(_makeCheck("cost.attempt.overload_double", false, `Failed to evaluate: ${err?.message ?? err}`));
  }

  const sourceTargets = [
    "src/core/magic/magicka-utils.js",
    "src/core/magic/casting-service.js",
    "src/core/magic/services/soul-trap-service.js",
    "src/core/magic/opposed-workflow.js",
    "src/core/magic/opposed/actions/attacker.js",
    "src/ui/sheets/shared/listeners/magic-cast.js",
    "src/core/magic/upkeep-workflow.js"
  ];
  const loaded = {};
  for (const path of sourceTargets) {
    loaded[path] = await _readSystemSource(path);
    if (!loaded[path]) findings.push(`Could not read source: ${path}`);
  }

  checks.push(_makeCheck(
    "casting.training_gate.service",
    _matchesAll(loaded["src/core/magic/casting-service.js"], ["isActorTrainedInMagicSchool", "cannot cast"]),
    "Casting service should explicitly gate untrained school casting."
  ));
  checks.push(_makeCheck(
    "casting.training_gate.opposed",
    _matchesAll(loaded["src/core/magic/opposed-workflow.js"], ["isActorTrainedInMagicSchool", "cannot cast"]) &&
      _matchesAll(loaded["src/core/magic/opposed/actions/attacker.js"], ["isActorTrainedInMagicSchool", "cannot cast"]),
    "Opposed workflow should gate untrained school casting."
  ));
  checks.push(_makeCheck(
    "casting.training_gate.ui_picker",
    _matchesAll(loaded["src/ui/sheets/shared/listeners/magic-cast.js"], ["isActorTrainedInMagicSchool", "must be trained in the spell's school"]),
    "Spell picker should filter/guard by school training."
  ));
  checks.push(_makeCheck(
    "casting.somatic_penalty",
    _matchesAll(loaded["src/core/magic/magicka-utils.js"], ["_hasTwoFreeHandsForCasting", "No free hands (somatic)", "-20"]),
    "Casting TN should include the no-free-hands somatic penalty."
  ));
  checks.push(_makeCheck(
    "upkeep.ap_field_canonical",
    typeof loaded["src/core/magic/upkeep-workflow.js"] === "string" &&
      !loaded["src/core/magic/upkeep-workflow.js"].includes("actionPoints") &&
      loaded["src/core/magic/upkeep-workflow.js"].includes("action_points"),
    "Upkeep workflow should use canonical AP lane system.action_points.value."
  ));

  const spellAudit = await auditChapter6Spells({
    pack: opts?.pack ?? "uesrpg-3ev4.spells-revised",
    log: shouldLog,
    includeDetails
  });

  const failedChecks = checks.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      chapter: "Chapter 6 - Magic",
      systemId: _str(game?.system?.id),
      systemVersion: _str(game?.system?.version)
    },
    totals: {
      checks: checks.length,
      passed: checks.length - failedChecks.length,
      failed: failedChecks.length
    },
    gaps: {
      failedChecks: _sort(failedChecks.map((c) => c.id)),
      sourceReadFailures: _sort(findings)
    },
    spells: spellAudit?.error ? { error: spellAudit.error } : {
      totals: spellAudit?.totals ?? {},
      coverage: spellAudit?.coverage ?? {},
      gaps: spellAudit?.gaps ?? {}
    }
  };

  if (includeDetails) {
    report.checks = checks;
    if (!spellAudit?.error) report.spells.entries = spellAudit?.entries ?? [];
  }

  if (shouldLog) {
    console.groupCollapsed?.("UESRPG | Chapter 6 Audit");
    console.table?.(checks.map((c) => ({ id: c.id, ok: c.ok, details: c.details })));
    console.log?.("Gaps", report.gaps);
    if (!spellAudit?.error) console.log?.("Spell Coverage", report.spells.coverage);
    console.groupEnd?.();
  }

  return report;
}
