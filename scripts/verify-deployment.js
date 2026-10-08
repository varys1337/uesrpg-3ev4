"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const sourceRoot = path.join(ROOT, "dist", "uesrpg-3ev4");
const defaultTarget = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "FoundryVTT", "Data", "systems", "uesrpg-3ev4")
  : null;
const targetRoot = path.resolve(process.argv[2] ?? defaultTarget ?? "");

function fail(message) {
  console.error(`UESRPG deployment verification failed: ${message}`);
  process.exitCode = 1;
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, output);
    else if (entry.isFile()) output.push(absolutePath);
  }
  return output;
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
  fail(`release folder is missing at ${sourceRoot}; run npm run build:folder first`);
} else if (!targetRoot || !fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
  fail(`deployment folder is missing at ${targetRoot || "<unspecified>"}`);
} else {
  const sourceFiles = walk(sourceRoot);
  const sourceRelativePaths = new Set(sourceFiles.map((file) => path.normalize(path.relative(sourceRoot, file))));
  const targetFiles = walk(targetRoot);
  let mismatches = 0;
  for (const sourceFile of sourceFiles) {
    const relative = path.relative(sourceRoot, sourceFile);
    const targetFile = path.join(targetRoot, relative);
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      console.error(`  missing: ${relative}`);
      mismatches += 1;
      continue;
    }
    if (hash(sourceFile) !== hash(targetFile)) {
      console.error(`  hash mismatch: ${relative}`);
      mismatches += 1;
    }
  }
  for (const targetFile of targetFiles) {
    const relative = path.normalize(path.relative(targetRoot, targetFile));
    if (sourceRelativePaths.has(relative)) continue;
    console.error(`  unexpected: ${relative}`);
    mismatches += 1;
  }

  if (mismatches) fail(`${mismatches} deployed file(s) differ from the staged release at ${targetRoot}`);
  else console.log(`UESRPG | Verified ${sourceFiles.length} deployed files by SHA-256 at ${targetRoot}.`);
}
