"use strict";

const REPOSITORY = "varys1337/uesrpg-3ev4";
const ARCHIVE_NAME = "uesrpg-3ev4.zip";
const MANIFEST_NAME = "system.json";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function getReleaseMetadata(version) {
  const normalized = String(version ?? "").trim();
  if (!SEMVER_PATTERN.test(normalized)) throw new Error(`Invalid release version: ${normalized || "<empty>"}`);
  const tag = `v${normalized}`;
  const base = `https://github.com/${REPOSITORY}/releases`;
  return Object.freeze({
    version: normalized,
    tag,
    repository: REPOSITORY,
    manifestName: MANIFEST_NAME,
    archiveName: ARCHIVE_NAME,
    manifestUrl: `${base}/latest/download/${MANIFEST_NAME}`,
    downloadUrl: `${base}/download/${tag}/${ARCHIVE_NAME}`,
  });
}

module.exports = { getReleaseMetadata, SEMVER_PATTERN };

if (require.main === module) {
  const version = process.argv[2];
  try {
    process.stdout.write(`${JSON.stringify(getReleaseMetadata(version))}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
