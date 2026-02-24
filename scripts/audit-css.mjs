#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const STYLES_DIR = path.join(ROOT, "styles");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const AUDIT_DIR = path.join(ROOT, "audit");
const OUTPUT_FILE = path.join(AUDIT_DIR, "css-audit.json");

const SCOPES = [
  "body.system-uesrpg-3ev4",
  ".worldbuilding",
  ".application.uesrpg",
  ".uesrpg",
];

async function walk(dir, exts) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(full, exts));
    else if (ent.isFile() && exts.includes(path.extname(ent.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function listTopLevelByExt(dir, exts) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((ent) => ent.isFile() && exts.includes(path.extname(ent.name).toLowerCase()))
    .map((ent) => path.join(dir, ent.name));
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitSelectors(prelude) {
  return prelude
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isScoped(selector) {
  return SCOPES.some((scope) => selector.includes(scope));
}

function descendantCount(selector) {
  const normalized = selector
    .replace(/\s*[>+~]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return 0;
  const tokens = normalized.split(" ").filter(Boolean);
  return Math.max(0, tokens.length - 1);
}

function extractCssClasses(text) {
  const classes = new Set();
  const re = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const cls = m[1];
    if (!cls.startsWith("\u005c")) classes.add(cls);
  }
  return classes;
}

function extractTemplateClasses(text) {
  const classes = new Set();
  const re = /class\s*=\s*(["'])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[2]
      .replace(/{{[\s\S]*?}}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) continue;
    for (const token of raw.split(" ")) {
      if (/^[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(token)) classes.add(token);
    }
  }
  return classes;
}

async function auditCssFiles(cssFiles) {
  const unscoped = [];
  const deepSelectors = [];
  const importantLocations = [];
  const hasLocations = [];
  const allCssClasses = new Set();

  for (const file of cssFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const raw = await fs.readFile(file, "utf-8");
    const css = stripComments(raw);

    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes("!important")) importantLocations.push({ file: rel, line: idx + 1, snippet: line.trim().slice(0, 180) });
      if (line.includes(":has(")) hasLocations.push({ file: rel, line: idx + 1, snippet: line.trim().slice(0, 180) });
    });

    for (const cls of extractCssClasses(css)) allCssClasses.add(cls);

    const blockRe = /([^{}]+)\{/g;
    let m;
    while ((m = blockRe.exec(css)) !== null) {
      const prelude = m[1].trim();
      if (!prelude || prelude.startsWith("@")) continue;
      const selectors = splitSelectors(prelude);
      for (const selector of selectors) {
        const deep = descendantCount(selector);
        if (deep > 3) deepSelectors.push({ file: rel, selector, descendantCombinators: deep });
        if (!isScoped(selector)) unscoped.push({ file: rel, selector });
      }
    }
  }

  return {
    unscoped,
    deepSelectors,
    importantLocations,
    hasLocations,
    cssClasses: [...allCssClasses].sort(),
  };
}

async function auditTemplateClasses(templateFiles) {
  const allTemplateClasses = new Set();
  for (const file of templateFiles) {
    const text = await fs.readFile(file, "utf-8");
    for (const cls of extractTemplateClasses(text)) allTemplateClasses.add(cls);
  }
  return [...allTemplateClasses].sort();
}

function topOffendersByFile(list, key = "file", top = 10) {
  const counts = new Map();
  for (const item of list) {
    const k = item[key];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([file, count]) => ({ file, count }));
}

async function main() {
  // Scope to styles/*.css only (top-level), matching runtime style inventory intent.
  const cssFiles = await listTopLevelByExt(STYLES_DIR, [".css"]);
  const templateFiles = await walk(TEMPLATES_DIR, [".hbs", ".html"]);

  const cssAudit = await auditCssFiles(cssFiles);
  const templateClasses = await auditTemplateClasses(templateFiles);

  const cssSet = new Set(cssAudit.cssClasses);
  const tplSet = new Set(templateClasses);

  const cssNotInTemplates = [...cssSet].filter((c) => !tplSet.has(c));
  const templatesNotInCss = [...tplSet].filter((c) => !cssSet.has(c));

  const result = {
    generatedAt: new Date().toISOString(),
    scopesChecked: SCOPES,
    files: {
      cssCount: cssFiles.length,
      templateCount: templateFiles.length,
      css: cssFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, "/")),
      templates: templateFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, "/")),
    },
    metrics: {
      unscopedSelectorCount: cssAudit.unscoped.length,
      importantCount: cssAudit.importantLocations.length,
      hasCount: cssAudit.hasLocations.length,
      deepSelectorCount: cssAudit.deepSelectors.length,
      cssClassCount: cssSet.size,
      templateClassCount: tplSet.size,
      cssClassesNeverUsedInTemplatesCount: cssNotInTemplates.length,
      templateClassesNeverDefinedInCssCount: templatesNotInCss.length,
    },
    topOffenders: {
      unscopedSelectorsByFile: topOffendersByFile(cssAudit.unscoped),
      deepSelectorsByFile: topOffendersByFile(cssAudit.deepSelectors),
      importantByFile: topOffendersByFile(cssAudit.importantLocations),
      hasByFile: topOffendersByFile(cssAudit.hasLocations),
    },
    details: {
      unscopedSelectors: cssAudit.unscoped,
      deepSelectors: cssAudit.deepSelectors,
      importantLocations: cssAudit.importantLocations,
      hasLocations: cssAudit.hasLocations,
      cssClassesNeverUsedInTemplates: cssNotInTemplates.sort(),
      templateClassesNeverDefinedInCss: templatesNotInCss.sort(),
    },
    notes: [
      "templateClassesNeverDefinedInCss is a soft warning; some classes may be Foundry/core generated.",
      "Selector parsing is heuristic and may include false positives around complex at-rules.",
    ],
  };

  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf-8");

  console.log("CSS audit complete");
  console.log(`- CSS files: ${result.files.cssCount}`);
  console.log(`- Template files: ${result.files.templateCount}`);
  console.log(`- Unscoped selectors: ${result.metrics.unscopedSelectorCount}`);
  console.log(`- !important count: ${result.metrics.importantCount}`);
  console.log(`- :has() count: ${result.metrics.hasCount}`);
  console.log(`- Deep selectors (>3): ${result.metrics.deepSelectorCount}`);
  console.log(`- Output: ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, "/")}`);
}

main().catch((err) => {
  console.error("Audit failed", err);
  process.exit(1);
});
