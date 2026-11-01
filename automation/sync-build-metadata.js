"use strict";

const fs = require("fs");
const path = require("path");
const { getReleaseMetadata } = require("./release-metadata.js");

/** Synchronize only release metadata; package.json remains the version source. */
function syncBuildMetadata(root) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const manifest = read("system.json");
  const metadata = getReleaseMetadata(pkg.version);

  if (!pkg.name || manifest.id !== pkg.name || lock.name !== pkg.name || lock.packages?.[""]?.name !== pkg.name) {
    throw new Error("Package, lockfile, and system manifest IDs must match before building.");
  }

  const lockChanged = lock.version !== metadata.version || lock.packages[""].version !== metadata.version;
  const manifestChanged = manifest.version !== metadata.manifestVersion || manifest.manifest !== metadata.manifestUrl
    || manifest.download !== metadata.downloadUrl;
  if (lockChanged) {
    lock.version = metadata.version;
    lock.packages[""].version = metadata.version;
    fs.writeFileSync(path.join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  }
  if (manifestChanged) {
    manifest.version = metadata.manifestVersion;
    manifest.manifest = metadata.manifestUrl;
    manifest.download = metadata.downloadUrl;
    fs.writeFileSync(path.join(root, "system.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return { metadata, lockChanged, manifestChanged };
}

module.exports = { syncBuildMetadata };

if (require.main === module) {
  try {
    const { metadata, lockChanged, manifestChanged } = syncBuildMetadata(path.resolve(__dirname, ".."));
    console.log(`UESRPG | Build version ${metadata.version}; Foundry manifest ${metadata.manifestVersion}.`);
    console.log(`UESRPG | Fork update: ${metadata.manifestUrl}`);
    console.log(`UESRPG | Fork download: ${metadata.downloadUrl}`);
    if (lockChanged || manifestChanged) console.log("UESRPG | Synchronized build metadata from package.json.");
  } catch (error) {
    console.error(`UESRPG | Cannot synchronize build metadata: ${error.message}`);
    process.exitCode = 1;
  }
}
