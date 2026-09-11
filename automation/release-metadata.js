"use strict";

const RELEASE_REPOSITORY = "varys1337/uesrpg-3ev4";
const RELEASE_REPOSITORY_URL = `https://github.com/${RELEASE_REPOSITORY}`;
const RELEASE_ARCHIVE_NAME = "uesrpg-3ev4.zip";
const RELEASE_MANIFEST_URL = `${RELEASE_REPOSITORY_URL}/releases/latest/download/system.json`;
const STABLE_PACKAGE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const LEGACY_INSTALLED_VERSIONS = Object.freeze(["v14.0.0", "14.0.7"]);

function requireStablePackageVersion(value, label = "Package version") {
  const version = String(value ?? "").trim();
  if (!STABLE_PACKAGE_VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must use stable X.Y.Z SemVer; received ${JSON.stringify(value)}.`);
  }
  return version;
}

function getReleaseTag(packageVersion) {
  return `v${requireStablePackageVersion(packageVersion)}`;
}

function parseReleaseTag(tag, label = "Release tag") {
  const value = String(tag ?? "").trim();
  if (!value.startsWith("v")) {
    throw new Error(`${label} must use vX.Y.Z; received ${JSON.stringify(tag)}.`);
  }
  return requireStablePackageVersion(value.slice(1), label);
}

function getReleaseMetadata(packageVersion) {
  const version = requireStablePackageVersion(packageVersion);
  const tag = getReleaseTag(version);
  return Object.freeze({
    packageVersion: version,
    systemVersion: tag,
    tag,
    manifestUrl: RELEASE_MANIFEST_URL,
    downloadUrl: `${RELEASE_REPOSITORY_URL}/releases/download/${tag}/${RELEASE_ARCHIVE_NAME}`,
  });
}

function compareStablePackageVersions(left, right) {
  const leftParts = requireStablePackageVersion(left, "Proposed package version").split(".").map(Number);
  const rightParts = requireStablePackageVersion(right, "Existing package version").split(".").map(Number);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] === rightParts[index]) continue;
    return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isNumericVersionPart(value) {
  return value !== "" && Number.isFinite(Number(value));
}

/**
 * Mirror Foundry v14's documented dot-separated numeric/string comparison for
 * release-time validation without loading the Foundry runtime in Node.js.
 */
function isFoundryNewerVersion(target, reference) {
  if (target === null || target === undefined) return false;
  if (reference === null || reference === undefined) return true;
  if (typeof target === "number" && typeof reference === "number") return target > reference;

  const targetParts = String(target).split(".");
  const referenceParts = String(reference).split(".");
  for (const [index, targetPart] of targetParts.entries()) {
    const referencePart = referenceParts[index];
    if (referencePart === undefined) return true;
    if (isNumericVersionPart(referencePart) && isNumericVersionPart(targetPart)) {
      if (Number(targetPart) !== Number(referencePart)) return Number(targetPart) > Number(referencePart);
    } else if (targetPart !== referencePart) return targetPart > referencePart;
  }
  if (referenceParts.length > targetParts.length) return false;
  return targetParts.some((part, index) => part !== referenceParts[index]);
}

module.exports = {
  LEGACY_INSTALLED_VERSIONS,
  RELEASE_ARCHIVE_NAME,
  RELEASE_MANIFEST_URL,
  RELEASE_REPOSITORY,
  RELEASE_REPOSITORY_URL,
  compareStablePackageVersions,
  getReleaseMetadata,
  getReleaseTag,
  isFoundryNewerVersion,
  parseReleaseTag,
  requireStablePackageVersion,
};
