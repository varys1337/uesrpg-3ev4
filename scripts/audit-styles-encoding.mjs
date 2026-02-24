#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STYLE_ROOTS = [
  path.join(ROOT, 'styles', 'scss'),
  path.join(ROOT, 'styles', 'uesrpg.css')
];

const MOJIBAKE_TOKENS = ['в•', 'в”', 'вЂ', 'Ã', 'Â', '\uFFFD'];

async function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(full));
    else if (ent.isFile() && /\.(scss|css)$/i.test(ent.name)) out.push(full);
  }
  return out;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

async function main() {
  const files = [];
  for (const p of STYLE_ROOTS) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) files.push(...await walk(p));
      else if (st.isFile()) files.push(p);
    } catch {}
  }

  const findings = [];

  for (const file of files) {
    const buf = await fs.readFile(file);
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);

    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      findings.push({ type: 'bom', file: rel(file), line: 1, detail: 'UTF-8 BOM present' });
    }

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      if (line.includes('\\n') || line.includes('\\r')) {
        findings.push({ type: 'literal-escape', file: rel(file), line: lineNo, detail: line.trim().slice(0, 200) });
      }
      for (const token of MOJIBAKE_TOKENS) {
        if (line.includes(token)) {
          findings.push({ type: 'mojibake', file: rel(file), line: lineNo, detail: line.trim().slice(0, 200) });
          break;
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log('Encoding audit passed: no BOM, mojibake, or literal escape artifacts found.');
    process.exit(0);
  }

  for (const f of findings) {
    console.log(`[${f.type}] ${f.file}:${f.line} ${f.detail}`);
  }
  console.log(`\nTotal findings: ${findings.length}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Encoding audit failed:', err);
  process.exit(2);
});
