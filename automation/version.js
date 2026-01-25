const { writeFileSync, readFileSync } = require("fs");
const { execSync } = require("child_process");
const { env } = require("node:process");

const versionArg = env.npm_package_version;
if (!versionArg) {
  console.error("ERROR: npm_package_version is not set. Run this via `npm version ...`.");
  process.exit(1);
}

const systemFilePath = "./system.json";
const systemFileEncoding = "utf-8";
const packageVersion = `v${versionArg}`;

console.log(`Updating system.json with version '${packageVersion}'`);

const systemJson = readFileSync(systemFilePath, systemFileEncoding);
const systemObj = JSON.parse(systemJson);

/**
 * Best practice for Foundry:
 * - manifest should be a stable URL that always points to the latest release asset
 * - download can be versioned (tag-specific) as long as the manifest points to latest for updates
 */
const manifestUrl = "https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json";
const downloadUrl = `https://github.com/varys1337/uesrpg-3ev4/releases/download/${packageVersion}/uesrpg-3ev4.zip`;

systemObj.version = packageVersion;
systemObj.manifest = manifestUrl;
systemObj.download = downloadUrl;

writeFileSync(systemFilePath, JSON.stringify(systemObj, null, 2), systemFileEncoding);

// IMPORTANT: stage synchronously so npm's version commit includes system.json
try {
  execSync("git add system.json", { stdio: "inherit" });
} catch (err) {
  console.error("ERROR: Failed to stage system.json via git add.");
  process.exit(1);
}
