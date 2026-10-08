"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("espree");

const ROOT = path.resolve(__dirname, "..");
const CATALOGS = Object.freeze([
  { source: "spell-effects-catalog.js", name: "SPELL_EFFECTS_CATALOG", output: "spell-effects.json" },
  { source: "strike-enchantments-catalog.js", name: "STRIKE_ENCHANTMENTS_CATALOG", output: "strike-enchantments.json" },
]);

// Read data, never execute runtime modules during source validation.
function readLiteral(node) {
  if (node?.type === "Literal" && !node.regex && !node.bigint) return node.value;
  if (node?.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
    const value = readLiteral(node.argument);
    if (typeof value === "number") return node.operator === "-" ? -value : value;
  }
  if (node?.type === "ArrayExpression") return node.elements.map(readLiteral);
  if (node?.type === "ObjectExpression") {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") {
        throw new Error("Catalogs must contain only literal data properties.");
      }
      const key = property.key.type === "Identifier" ? property.key.name : readLiteral(property.key);
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate catalog property: ${key}`);
      result[key] = readLiteral(property.value);
    }
    return result;
  }
  throw new Error(`Unsupported catalog expression: ${node?.type ?? "missing value"}`);
}

function checkDataCatalogs({ root = ROOT, write = false } = {}) {
  const messages = [];
  for (const catalog of CATALOGS) {
    const source = fs.readFileSync(path.join(root, "src/data", catalog.source), "utf8");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const declaration = ast.body.flatMap((node) => node.type === "ExportNamedDeclaration"
      ? node.declaration?.declarations ?? [] : []).find((node) => node.id.name === catalog.name);
    const value = readLiteral(declaration?.init);
    if (!Array.isArray(value)) throw new Error(`${catalog.name} must be an array.`);
    const keys = new Set();
    for (const entry of value) {
      if (!entry?.key || keys.has(entry.key)) throw new Error(`${catalog.source} has a missing or duplicate key: ${entry?.key}`);
      keys.add(entry.key);
    }
    const expected = JSON.stringify(value, null, 2) + "\n";
    const outputPath = path.join(root, "src/data", catalog.output);
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") : "";
    if (write) fs.writeFileSync(outputPath, expected, "utf8");
    else if (actual !== expected) throw new Error(`${catalog.output} differs from ${catalog.source}. Run npm run data:sync.`);
    messages.push(`${write ? "Generated" : "Validated"} ${catalog.output} (${value.length} entries) from ${catalog.source}.`);
  }
  return messages;
}

if (require.main === module) {
  try {
    for (const message of checkDataCatalogs({ write: process.argv.includes("--write") })) console.log(`UESRPG | ${message}`);
  } catch (error) {
    console.error(`UESRPG | ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkDataCatalogs };
