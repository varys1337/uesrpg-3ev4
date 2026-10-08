"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderGeneratedSchemaSeeds } = require("./schema-seeds.js");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "template.json");
const OUTPUT_PATH = path.join(ROOT, "src", "core", "data-models", "defaults.generated.js");

function main() {
  const expected = renderGeneratedSchemaSeeds(JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")));
  const write = process.argv.slice(2).includes("--write");
  if (write) {
    fs.writeFileSync(OUTPUT_PATH, expected, "utf8");
    console.log(`UESRPG | Generated ${path.relative(ROOT, OUTPUT_PATH)} from template.json.`);
    return;
  }

  const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  if (actual !== expected) {
    console.error("UESRPG | Generated TypeDataModel seeds are stale. Run npm run schema:generate.");
    process.exitCode = 1;
    return;
  }
  console.log("UESRPG | Generated TypeDataModel seeds match template.json.");
}

main();
