const { readFileSync, writeFileSync } = require("fs");
const { execSync } = require("child_process");
const { env } = require("node:process");

/**
 * version.js
 * -------
 * This script is executed by the npm "version" lifecycle hook.
 * It updates system.json to the correct version and sets Foundry package URLs:
 *  - manifest: stable URL pointing to the latest release asset system.json
 *  - download: tag-specific URL pointing to the release ZIP uploaded by GitHub Actions
 *
 * IMPORTANT:
 * - This script stages system.json synchronously so that `npm version` includes it
 *   in the version commit.
 */

const systemFilePath = "./system.json";
const systemFileEncoding = "utf-8";

// npm provides the target version without the leading "v" (e.g. "1.0.0-RC.85")
const rawVersion = env.npm_package_version;
if (!rawVersion) {
  console.error("ERROR: npm_package_version is not set. Run via `npm version <semver>`.");
  process.exit(1);
}

const packageVersion = `v${rawVersion}`;

// Read current system.json
let systemObj;
try {
  const systemJson = readFileSync(systemFilePath, systemFileEncoding);
  systemObj = JSON.parse(systemJson);
} catch (err) {
  console.error("ERROR: Failed to read/parse system.json.", err);
  process.exit(1);
}

// Set version and Foundry URLs
// - manifest should be stable so Foundry can always find the newest release metadata.
// - download must match the exact ZIP filename uploaded as a Release asset by your workflow.
const manifestUrl = "https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json";
const downloadUrl = `https://github.com/varys1337/uesrpg-3ev4/releases/download/${packageVersion}/uesrpg-3ev4.zip`;

systemObj.version = packageVersion;
systemObj.manifest = manifestUrl;
systemObj.download = downloadUrl;

console.log(`Updating system.json with version '${packageVersion}'`);
console.log(`Setting manifest: ${manifestUrl}`);
console.log(`Setting download: ${downloadUrl}`);

// Write system.json back (pretty-printed, 2 spaces)
try {
  writeFileSync(systemFilePath, JSON.stringify(systemObj, null, 2), systemFileEncoding);
} catch (err) {
  console.error("ERROR: Failed to write system.json.", err);
  process.exit(1);
}

// Stage system.json synchronously so npm version commit includes it
try {
  execSync("git add system.json", { stdio: "inherit" });
} catch (err) {
  console.error("ERROR: Failed to stage system.json via `git add system.json`.", err);
  process.exit(1);
}
