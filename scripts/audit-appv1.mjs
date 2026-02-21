#!/usr/bin/env node
/**
 * audit-appv1.mjs
 *
 * Walk src/ and list files that still use AppV1 sheet APIs:
 *   - foundry.appv1
 *   - extends foundry.appv1.sheets
 *   - ActorSheet / ItemSheet subclasses bound to appv1
 *
 * Outputs a readable summary and an optional JSON file.
 *
 * Usage:
 *   node scripts/audit-appv1.mjs
 *   node scripts/audit-appv1.mjs --json   (write audit-appv1.json to repo root)
 *
 * Exit code: always 0 (audit tool, not a gate).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_DIR = join(PROJECT_ROOT, 'src');

// Patterns that indicate AppV1 usage
const APPV1_PATTERNS = [
  /foundry\.appv1/,
  /extends\s+foundry\.appv1\.sheets/,
  /extends\s+ActorSheet\b/,
  /extends\s+ItemSheet\b/,
];

// Pattern to extract class names that extend AppV1 base classes
const CLASS_RE =
  /class\s+(\w+)\s+extends\s+(?:foundry\.appv1\.sheets\.(?:ActorSheet|ItemSheet)|ActorSheet|ItemSheet)\b/g;

// ──────────────────────────────────────────────────────────────────────────────
// File system helpers
// ──────────────────────────────────────────────────────────────────────────────

async function getJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...await getJsFiles(fullPath));
    } else if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Analysis
// ──────────────────────────────────────────────────────────────────────────────

async function analyseFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const hasAppV1 = APPV1_PATTERNS.some(re => re.test(content));
  if (!hasAppV1) return null;

  // Extract class names
  const classNames = [];
  CLASS_RE.lastIndex = 0;
  let match;
  while ((match = CLASS_RE.exec(content)) !== null) {
    classNames.push(match[1]);
  }

  // Collect matching pattern names for context
  const matchedPatterns = APPV1_PATTERNS
    .filter(re => re.test(content))
    .map(re => re.toString());

  return {
    file: 'src/' + relative(SRC_DIR, filePath).replace(/\\/g, '/'),
    classNames,
    matchedPatterns,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const writeJson = process.argv.includes('--json');

  console.log('📋 AppV1 Sheet Audit Tool');
  console.log('=========================\n');
  console.log(`Source dir: ${SRC_DIR}\n`);

  const files = await getJsFiles(SRC_DIR);
  console.log(`Scanning ${files.length} JavaScript files...\n`);

  const appv1Files = [];
  const appv1SheetClasses = [];

  for (const file of files) {
    const result = await analyseFile(file);
    if (!result) continue;
    appv1Files.push(result.file);
    for (const cls of result.classNames) {
      if (!appv1SheetClasses.includes(cls)) appv1SheetClasses.push(cls);
    }
  }

  // Summary
  console.log(`Files containing AppV1 references (${appv1Files.length})`);
  console.log('─'.repeat(72));
  if (appv1Files.length === 0) {
    console.log('  (none — AppV1 fully removed)');
  } else {
    for (const f of appv1Files) console.log(`  ${f}`);
  }

  console.log(`\nAppV1 sheet class names (${appv1SheetClasses.length})`);
  console.log('─'.repeat(72));
  if (appv1SheetClasses.length === 0) {
    console.log('  (none detected)');
  } else {
    for (const cls of appv1SheetClasses.sort()) console.log(`  ${cls}`);
  }

  const result = { appv1Files, appv1SheetClasses };

  if (writeJson) {
    const outPath = join(PROJECT_ROOT, 'audit-appv1.json');
    await writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n✅ JSON written to ${outPath}`);
  }

  console.log('\n✅ Audit complete (exit 0).\n');
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(0); // always 0 — audit tool
  });
