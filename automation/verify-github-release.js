"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  RELEASE_ARCHIVE_NAME,
  RELEASE_REPOSITORY,
  getReleaseMetadata,
} = require("./release-metadata.js");

const ROOT = path.resolve(__dirname, "..");
const RETRY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000, 15_000]);

function readArgument(argv, option, fallback = null) {
  const index = argv.indexOf(option);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requestHeaders({ authenticated = true } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "uesrpg-release-verifier",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (authenticated && token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchResponse(url, { method = "GET", authenticated = true } = {}) {
  const response = await fetch(url, {
    method,
    headers: requestHeaders({ authenticated }),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${method} ${url} returned HTTP ${response.status}.`);
  return response;
}

async function fetchJson(url, options) {
  return (await fetchResponse(url, options)).json();
}

async function retry(label, operation) {
  let lastError;
  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`UESRPG | ${label} not ready: ${error.message}`);
    }
  }
  throw new Error(`${label} failed after ${RETRY_DELAYS_MS.length} attempts: ${lastError?.message}`);
}

function validateReleaseMetadata(release, expected, assets, stage) {
  assert(release.tag_name === expected.tag, `GitHub release tag ${release.tag_name} does not match ${expected.tag}.`);
  assert(release.prerelease === false, `${expected.tag} must not be a prerelease.`);
  assert(release.draft === (stage === "draft"), `${expected.tag} has an unexpected draft state.`);
  if (stage === "draft") assert(release.immutable === false, `Draft ${expected.tag} must remain mutable until published.`);
  else assert(release.immutable === true, `Published release ${expected.tag} is not immutable.`);

  const remoteAssets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  const expectedNames = assets.map((asset) => asset.name).sort();
  const remoteNames = [...remoteAssets.keys()].sort();
  assert(equalJson(remoteNames, expectedNames),
    `${expected.tag} assets differ (expected ${expectedNames.join(", ")}; received ${remoteNames.join(", ") || "none"}).`);

  for (const expectedAsset of assets) {
    const asset = remoteAssets.get(expectedAsset.name);
    assert(asset.state === "uploaded", `${expectedAsset.name} is not fully uploaded.`);
    assert(asset.size === expectedAsset.size,
      `${expectedAsset.name} size ${asset.size} does not match local size ${expectedAsset.size}.`);
    assert(asset.digest === `sha256:${expectedAsset.digest}`,
      `${expectedAsset.name} digest ${asset.digest} does not match local sha256:${expectedAsset.digest}.`);
  }
}

async function validatePublishedEndpoints(expected, sourceManifest) {
  const cacheBuster = `verify=${Date.now()}`;
  const remoteManifest = await fetchJson(`${expected.manifestUrl}?${cacheBuster}`, { authenticated: false });
  for (const field of ["id", "version", "manifest", "download", "compatibility"]) {
    assert(equalJson(remoteManifest[field], sourceManifest[field]),
      `Published manifest ${field} does not match the validated source manifest.`);
  }
  assert(remoteManifest.version === expected.systemVersion,
    `Published manifest version ${remoteManifest.version} does not match ${expected.systemVersion}.`);
  assert(remoteManifest.manifest === expected.manifestUrl, "Published manifest does not retain the stable update URL.");
  assert(remoteManifest.download === expected.downloadUrl, "Published manifest does not use the version-specific ZIP URL.");
  await fetchResponse(`${expected.downloadUrl}?${cacheBuster}`, { method: "HEAD", authenticated: false });
}

async function main() {
  const argv = process.argv.slice(2);
  const stage = readArgument(argv, "--stage");
  assert(stage === "draft" || stage === "published", "--stage must be either draft or published.");

  const packageJson = readJson(path.join(ROOT, "package.json"));
  const sourceManifest = readJson(path.join(ROOT, "system.json"));
  const expected = getReleaseMetadata(packageJson.version);
  const requestedTag = readArgument(argv, "--tag", expected.tag);
  assert(requestedTag === expected.tag, `Requested tag ${requestedTag} does not match ${expected.tag}.`);

  const manifestPath = path.resolve(ROOT, readArgument(argv, "--manifest", "system.json"));
  const archivePath = path.resolve(ROOT, readArgument(argv, "--archive", RELEASE_ARCHIVE_NAME));
  const assets = [manifestPath, archivePath].map((filePath) => {
    assert(fs.existsSync(filePath), `Release asset is missing: ${filePath}`);
    return {
      name: path.basename(filePath),
      size: fs.statSync(filePath).size,
      digest: sha256(filePath),
    };
  });

  const endpoint = stage === "draft"
    ? `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/tags/${expected.tag}`
    : `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
  const release = await retry(`GitHub ${stage} release verification`, () => fetchJson(endpoint));
  validateReleaseMetadata(release, expected, assets, stage);

  if (stage === "published") {
    await retry("public Foundry update endpoint verification", () => validatePublishedEndpoints(expected, sourceManifest));
  }
  console.log(`UESRPG | Verified ${stage} GitHub release ${expected.tag}.`);
}

main().catch((error) => {
  console.error(`UESRPG | GitHub release verification failed: ${error.message}`);
  process.exitCode = 1;
});
