/**
 * @module utils/dev/chapter4-audit
 * @description Chapter 4 catalog/audit helper for GM diagnostics.
 *
 * Deterministic report output used by:
 * - game.uesrpg.auditChapter4()
 * - docs/diagnostics/talents-matrix.md maintenance
 */

import { getChapter4Catalog } from "../../core/traits/chapter4-catalog.js";
import { listKnownTalentSlugs } from "../../core/traits/talents-api.js";

function _sortStrings(values = []) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function _countBy(items = [], keyFn = () => "unknown") {
  const out = {};
  for (const item of items) {
    const k = String(keyFn(item) ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function _toTalentRow(entry) {
  return {
    slug: String(entry?.slug ?? ""),
    level: entry?.level ?? null,
    automationClass: String(entry?.automationClass ?? "unknown"),
    governingCharacteristics: Array.isArray(entry?.governingCharacteristics)
      ? entry.governingCharacteristics
      : [],
    hasRequirements: Boolean(entry?.requirements && (
      Array.isArray(entry.requirements.requires) && entry.requirements.requires.length > 0 ||
      Array.isArray(entry.requirements.replaces) && entry.requirements.replaces.length > 0
    )),
    notes: String(entry?.notes ?? ""),
  };
}

/**
 * Produce a deterministic Chapter 4 audit report.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeEntries=false] include full talent entry table
 * @param {boolean} [opts.log=false] console-log summary
 * @returns {object}
 */
export function auditChapter4(opts = {}) {
  const includeEntries = opts?.includeEntries === true;
  const shouldLog = opts?.log === true;
  const generatedAt = typeof opts?.generatedAt === "string" ? opts.generatedAt : null;

  const catalog = getChapter4Catalog();
  const talents = Array.isArray(catalog?.talents) ? catalog.talents.map(_toTalentRow) : [];
  const traits = Array.isArray(catalog?.traits) ? catalog.traits : [];
  const powers = Array.isArray(catalog?.powers) ? catalog.powers : [];

  const knownSlugs = _sortStrings(listKnownTalentSlugs());
  const catalogSlugs = _sortStrings(talents.map((t) => t.slug));

  const missingFromCatalog = _sortStrings(knownSlugs.filter((slug) => !catalogSlugs.includes(slug)));
  const catalogOnly = _sortStrings(catalogSlugs.filter((slug) => !knownSlugs.includes(slug)));

  const byAutomationClass = _countBy(talents, (t) => t.automationClass || "unknown");
  const unknownAutomation = _sortStrings(
    talents.filter((t) => t.automationClass === "unknown").map((t) => t.slug)
  );
  const blocked = _sortStrings(
    talents.filter((t) => t.automationClass === "blocked").map((t) => t.slug)
  );
  const notAutomated = _sortStrings(
    talents.filter((t) => t.automationClass === "not_automated").map((t) => t.slug)
  );
  const stubs = _sortStrings(
    talents.filter((t) => t.automationClass === "stub").map((t) => t.slug)
  );

  const report = {
    generatedAt,
    source: {
      catalogVersion: String(catalog?.version ?? ""),
      catalogSource: String(catalog?.source ?? ""),
    },
    totals: {
      talents: talents.length,
      traits: traits.length,
      powers: powers.length,
    },
    coverage: {
      byAutomationClass,
    },
    gaps: {
      missingFromCatalog,
      catalogOnly,
      unknownAutomation,
      blocked,
      notAutomated,
      stubs,
      traitsCatalogMissing: traits.length === 0,
      powersCatalogMissing: powers.length === 0,
    },
  };

  if (includeEntries) report.entries = { talents, traits, powers };

  if (shouldLog) {
    console.groupCollapsed?.("UESRPG | Chapter 4 Audit");
    console.table?.(report.coverage.byAutomationClass);
    console.log?.("Gaps", report.gaps);
    console.groupEnd?.();
  }

  return report;
}
