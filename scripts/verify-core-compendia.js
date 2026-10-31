"use strict";

// Static, read-only comparison of native compiled packs against JSON authoring
// sources. Foundry alone writes the databases. Native-added defaults are listed
// individually; authored values, identities and embedded ordering must match.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readPack } = require("./lib/compendium-read.js");

const ROOT = path.resolve(__dirname, "..");
const REPORT = path.join(ROOT, "docs/compendium-cleanup/compiled-pack-verification.json");

function compareAuthored(expected, actual, field, differences, additions) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      differences.push({ field, expected, actual: actual ?? null });
      return;
    }
    expected.forEach((value, index) => compareAuthored(value, actual[index], `${field}.${index}`, differences, additions));
  } else if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      differences.push({ field, expected, actual: actual ?? null });
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (key === "_stats") continue;
      compareAuthored(value, actual[key], field ? `${field}.${key}` : key, differences, additions);
    }
    for (const [key, value] of Object.entries(actual)) {
      if (key === "_stats" || Object.hasOwn(expected, key)) continue;
      additions.push({ field: field ? `${field}.${key}` : key, value });
    }
  } else if (!Object.is(expected, actual)) differences.push({ field, expected, actual: actual ?? null });
}

function verifyCoreCompendia({ compiledRoot = ROOT } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
  const summaries = [];
  for (const pack of manifest.packs.filter(entry => entry.type === "Item")) {
    const sourceFile = path.join(ROOT, "packs/_source", pack.name, "pack.json");
    const sourceBytes = fs.readFileSync(sourceFile);
    const source = JSON.parse(sourceBytes);
    if (source.pack !== `${manifest.id}.${pack.name}`) throw new Error(`Source identity mismatch for ${pack.name}`);
    const records = readPack(path.resolve(compiledRoot, pack.path)).docs;
    const byKey = new Map(records.map(record => [record.key, record]));
    const used = new Set();
    const differences = [];
    const nativeDefaults = [];
    const cleanRecord = key => {
      const record = byKey.get(key);
      if (!record) throw new Error(`Missing compiled record ${pack.name}:${key}`);
      used.add(key);
      const { key: _key, ...document } = record;
      return structuredClone(document);
    };
    for (const expected of source.documents) {
      const actual = cleanRecord(`!items!${expected._id}`);
      actual.effects = (actual.effects ?? []).map(id => cleanRecord(`!items.effects!${actual._id}.${id}`));
      compareAuthored(expected, actual, `Item.${expected._id}`, differences, nativeDefaults);
    }
    for (const expected of source.folders ?? []) {
      compareAuthored(expected, cleanRecord(`!folders!${expected._id}`), `Folder.${expected._id}`, differences, nativeDefaults);
    }
    const extraRecords = records.filter(record => !used.has(record.key)).map(record => record.key);
    const files = fs.readdirSync(path.resolve(compiledRoot, pack.path)).filter(name => !["LOCK", "LOG", "LOG.old"].includes(name));
    const fileHashes = Object.fromEntries(files.map(name => [name,
      crypto.createHash("sha256").update(fs.readFileSync(path.resolve(compiledRoot, pack.path, name))).digest("hex")]));
    summaries.push({ pack: source.pack, documents: source.documents.length, folders: (source.folders ?? []).length,
      sourceHash: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
      status: differences.length || extraRecords.length ? "failed" : "passed",
      differences, extraRecords, nativeDefaults, fileHashes });
  }
  return { status: summaries.every(pack => pack.status === "passed") ? "passed" : "failed",
    method: "Static compiled record comparison; native-added defaults explicitly listed; _stats bookkeeping excluded",
    compiledRoot: path.resolve(compiledRoot), packs: summaries };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0 && !args[rootIndex + 1]) throw new Error("--root requires the compiled system directory");
  const report = verifyCoreCompendia({ compiledRoot: rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : ROOT });
  if (args.includes("--write-report")) fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, packs: report.packs.map(pack => ({ pack: pack.pack,
    documents: pack.documents, status: pack.status, differences: pack.differences.length,
    extraRecords: pack.extraRecords.length, nativeDefaults: pack.nativeDefaults.length })) }, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
}

module.exports = { verifyCoreCompendia };
