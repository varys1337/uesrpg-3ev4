const { readFileSync, writeFileSync } = require("fs");
const { execSync } = require("child_process");
const { env } = require("node:process");
const { getReleaseMetadata } = require("./release-metadata.js");

/**
 * version.js
 * -------
 * This script is executed by the npm "version" lifecycle hook.
 * It updates system.json to the correct version and sets Foundry package URLs:
 *  - version: v-prefixed Foundry version used by the permanent update channel
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

let release;
try {
  release = getReleaseMetadata(rawVersion);
} catch (err) {
  console.error("ERROR: Invalid production release version.", err.message);
  process.exit(1);
}

// Read current system.json
let systemObj;
try {
  const systemJson = readFileSync(systemFilePath, systemFileEncoding);
  systemObj = JSON.parse(systemJson);
} catch (err) {
  console.error("ERROR: Failed to read/parse system.json.", err);
  process.exit(1);
}

// The v prefix is intentionally permanent. It preserves Foundry's automatic
// upgrade path from the historical v14.0.0 manifest as well as 14.0.7.
systemObj.version = release.systemVersion;
systemObj.manifest = release.manifestUrl;
systemObj.download = release.downloadUrl;

console.log(`Updating system.json with Foundry version '${release.systemVersion}'`);
console.log(`Setting manifest: ${release.manifestUrl}`);
console.log(`Setting download: ${release.downloadUrl}`);

// Write system.json back (pretty-printed, 2 spaces)
try {
  writeFileSync(systemFilePath, JSON.stringify(systemObj, null, 2), systemFileEncoding);
} catch (err) {
  console.error("ERROR: Failed to write system.json.", err);
  process.exit(1);
}

// Stage system.json when this script is running inside a Git worktree.
try {
  execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  execSync("git add system.json", { stdio: "inherit" });
} catch (err) {
  console.warn("WARNING: system.json was updated but not staged because no Git worktree is available.");
}
