#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CSS_FILE = path.join(ROOT, "styles", "uesrpg.css");
const OUT_DIR = path.join(ROOT, "audit");
const OUT_FILE = path.join(OUT_DIR, "css-metrics.json");

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitSelectors(prelude) {
  return prelude.split(",").map((s) => s.trim()).filter(Boolean);
}

function countCombinators(selector) {
  const normalized = selector.replace(/\s*([>+~])\s*/g, "$1").trim();
  if (!normalized) return 0;
  const tokens = normalized.split(/[>+~\s]+/).filter(Boolean);
  return Math.max(0, tokens.length - 1);
}

function collectSelectorStats(cssText) {
  const clean = stripComments(cssText);
  const lines = clean.split(/\r?\n/);
  const selectorRows = [];
  const deepSelectors = [];

  lines.forEach((line, idx) => {
    const braceIndex = line.indexOf("{");
    if (braceIndex <= 0) return;
    const prelude = line.slice(0, braceIndex).trim();
    if (!prelude || prelude.startsWith("@")) return;
    const selectors = splitSelectors(prelude);
    for (const selector of selectors) {
      const len = selector.length;
      const combinators = countCombinators(selector);
      selectorRows.push({ line: idx + 1, length: len, selector });
      if (combinators >= 4) {
        deepSelectors.push({ line: idx + 1, combinators, selector });
      }
    }
  });

  selectorRows.sort((a, b) => b.length - a.length);
  deepSelectors.sort((a, b) => b.combinators - a.combinators || b.selector.length - a.selector.length);

  return {
    deepSelectorApproxCount: deepSelectors.length,
    topLongestSelectors: selectorRows.slice(0, 50),
  };
}

function loadExistingRuns() {
  if (!fs.existsSync(OUT_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

function main() {
  if (!fs.existsSync(CSS_FILE)) {
    throw new Error(`CSS file not found: ${CSS_FILE}`);
  }

  const css = fs.readFileSync(CSS_FILE, "utf8");
  const rawBytes = Buffer.byteLength(css);
  const gzipBytes = zlib.gzipSync(Buffer.from(css, "utf8")).length;
  const selectorStats = collectSelectorStats(css);

  const run = {
    generatedAt: new Date().toISOString(),
    file: "styles/uesrpg.css",
    metrics: {
      rawBytes,
      gzipBytes,
      hasCount: countMatches(css, /:has\(/g),
      importantCount: countMatches(css, /!important/g),
      attrClassContainsCount: countMatches(css, /\[class\*/g),
      attrValueSuffixCount: countMatches(css, /\[value\$/g),
      attrSelectorCount: countMatches(css, /\[[^\]]+\]/g),
      deepSelectorApproxCount: selectorStats.deepSelectorApproxCount,
    },
    topLongestSelectors: selectorStats.topLongestSelectors,
  };

  const runs = loadExistingRuns();
  runs.push(run);

  const out = {
    generatedAt: run.generatedAt,
    latest: run,
    runs,
    notes: [
      "Counts are heuristic and line-based.",
      "deepSelectorApproxCount uses selector combinator count >= 4.",
    ],
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");

  console.log("CSS metrics written:", path.relative(ROOT, OUT_FILE).replace(/\\/g, "/"));
  console.log("rawBytes:", rawBytes);
  console.log("gzipBytes:", gzipBytes);
  console.log("hasCount:", run.metrics.hasCount);
  console.log("attrValueSuffixCount:", run.metrics.attrValueSuffixCount);
}

main();
