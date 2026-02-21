#!/usr/bin/env node
/**
 * audit-templates.mjs
 *
 * Inventory all template references in src/ and compare against templates/ on disk.
 * Outputs JSON + a readable summary table.
 *
 * Usage:
 *   node scripts/audit-templates.mjs
 *   node scripts/audit-templates.mjs --json   (write audit-templates.json to repo root)
 *
 * Exit code: always 0 (audit tool, not a gate).
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_DIR = join(PROJECT_ROOT, 'src');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates');

// Match string literals that look like template paths (html or hbs)
const TEMPLATE_REF_RE = /["'`]([^"'`]*templates\/[^"'`]*\.(?:html|hbs))[^"'`]*["'`]/g;

// ──────────────────────────────────────────────────────────────────────────────
// File system helpers
// ──────────────────────────────────────────────────────────────────────────────

async function getFilesByExt(dir, exts) {
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
      results.push(...await getFilesByExt(fullPath, exts));
    } else if (entry.isFile() && exts.includes(extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reference extraction
// ──────────────────────────────────────────────────────────────────────────────

async function collectTemplateReferences(srcDir) {
  const htmlRefs = new Set();
  const hbsRefs = new Set();

  const jsFiles = await getFilesByExt(srcDir, ['.js', '.mjs']);
  for (const file of jsFiles) {
    const content = await readFile(file, 'utf-8');
    TEMPLATE_REF_RE.lastIndex = 0;
    let match;
    while ((match = TEMPLATE_REF_RE.exec(content)) !== null) {
      const raw = match[1];
      // Normalise to the path segment starting at "templates/"
      const idx = raw.indexOf('templates/');
      if (idx === -1) continue;
      const templatePart = raw.slice(idx); // e.g. "templates/stamina-dialog.html"
      if (templatePart.endsWith('.html')) htmlRefs.add(templatePart);
      else if (templatePart.endsWith('.hbs')) hbsRefs.add(templatePart);
    }
  }

  return { htmlRefs: [...htmlRefs].sort(), hbsRefs: [...hbsRefs].sort() };
}

// ──────────────────────────────────────────────────────────────────────────────
// Disk inventory
// ──────────────────────────────────────────────────────────────────────────────

async function collectDiskTemplates(templatesDir) {
  const htmlFiles = (await getFilesByExt(templatesDir, ['.html']))
    .map(f => 'templates/' + relative(templatesDir, f).replace(/\\/g, '/'))
    .sort();
  const hbsFiles = (await getFilesByExt(templatesDir, ['.hbs']))
    .map(f => 'templates/' + relative(templatesDir, f).replace(/\\/g, '/'))
    .sort();
  return { htmlFiles, hbsFiles };
}

// ──────────────────────────────────────────────────────────────────────────────
// Reporting helpers
// ──────────────────────────────────────────────────────────────────────────────

function printTable(title, rows) {
  console.log(`\n${title} (${rows.length})`);
  console.log('─'.repeat(72));
  if (rows.length === 0) {
    console.log('  (none)');
  } else {
    for (const row of rows) console.log(`  ${row}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const writeJson = process.argv.includes('--json');

  console.log('📋 Template Audit Tool');
  console.log('======================\n');
  console.log(`Project root : ${PROJECT_ROOT}`);
  console.log(`Source dir   : ${SRC_DIR}`);
  console.log(`Templates dir: ${TEMPLATES_DIR}\n`);

  const { htmlRefs, hbsRefs } = await collectTemplateReferences(SRC_DIR);
  const { htmlFiles, hbsFiles } = await collectDiskTemplates(TEMPLATES_DIR);

  const htmlFilesSet = new Set(htmlFiles);
  const hbsFilesSet = new Set(hbsFiles);

  const unreferencedHtmlTemplates = htmlFiles.filter(f => !htmlRefs.includes(f));
  const unreferencedHbsTemplates = hbsFiles.filter(f => !hbsRefs.includes(f));

  // Print summary
  printTable('Referenced .html templates (src/ → templates/)', htmlRefs);
  printTable('Referenced .hbs templates (src/ → templates/)', hbsRefs);
  printTable('Unreferenced .html templates on disk', unreferencedHtmlTemplates);
  printTable('Unreferenced .hbs templates on disk', unreferencedHbsTemplates);

  const result = {
    referencedTemplatesHtml: htmlRefs,
    referencedTemplatesHbs: hbsRefs,
    diskHtmlTemplates: htmlFiles,
    diskHbsTemplates: hbsFiles,
    unreferencedHtmlTemplates,
    unreferencedHbsTemplates,
  };

  if (writeJson) {
    const outPath = join(PROJECT_ROOT, 'audit-templates.json');
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
