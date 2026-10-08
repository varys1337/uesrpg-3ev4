"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(absolute);
  }
  return output;
}

function checkJavaScriptSyntax(root) {
  const files = ["src", "scripts", "automation"].flatMap((relative) => walk(path.join(root, relative)));
  const errors = [];
  for (const file of files) {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) {
      errors.push(`${path.relative(root, file)}: ${(checked.stderr || checked.stdout).trim()}`);
    }
  }
  return { files, errors };
}

module.exports = { checkJavaScriptSyntax };

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const result = checkJavaScriptSyntax(root);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`UESRPG | Syntax-checked ${result.files.length} JavaScript files.`);
  }
}
