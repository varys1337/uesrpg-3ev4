"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getReleaseMetadata } = require("./release-metadata.js");

const ROOT = path.resolve(__dirname, "..");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function getBuffer(url, token = "") {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" } : {},
      redirect: "follow",
    });
    lastStatus = response.status;
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${url} returned HTTP ${lastStatus}`);
}

async function main() {
  const phase = process.argv.includes("--published") ? "published" : "draft";
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const metadata = getReleaseMetadata(packageJson.version);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  const apiResponse = await fetch(`https://api.github.com/repos/${metadata.repository}/releases/tags/${metadata.tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!apiResponse.ok) throw new Error(`GitHub release API returned HTTP ${apiResponse.status}`);
  const release = await apiResponse.json();
  if ((phase === "draft") !== (release.draft === true)) throw new Error(`Release draft state does not match ${phase} verification`);
  if (release.tag_name !== metadata.tag) throw new Error(`Unexpected release tag ${release.tag_name}`);
  if (process.env.GITHUB_SHA && release.target_commitish !== process.env.GITHUB_SHA) {
    throw new Error(`Release target ${release.target_commitish} does not match ${process.env.GITHUB_SHA}`);
  }

  const expectedFiles = [metadata.manifestName, metadata.archiveName];
  const assetNames = (release.assets ?? []).map((asset) => asset.name).sort();
  if (JSON.stringify(assetNames) !== JSON.stringify([...expectedFiles].sort())) {
    throw new Error(`Unexpected release assets: ${assetNames.join(", ")}`);
  }

  for (const filename of expectedFiles) {
    const local = fs.readFileSync(path.join(ROOT, filename));
    const asset = release.assets.find((entry) => entry.name === filename);
    if (asset.size !== local.length) throw new Error(`${filename} size differs from the local artifact`);
    const remote = await getBuffer(asset.url, token);
    if (sha256(remote) !== sha256(local)) throw new Error(`${filename} SHA-256 differs from the local artifact`);
    if (asset.digest && asset.digest !== `sha256:${sha256(local)}`) throw new Error(`${filename} API digest is incorrect`);
  }

  if (phase === "published") {
    const latestResponse = await fetch(`https://api.github.com/repos/${metadata.repository}/releases/latest`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!latestResponse.ok) throw new Error(`GitHub latest release API returned HTTP ${latestResponse.status}`);
    const latest = await latestResponse.json();
    if (latest.id !== release.id) throw new Error(`${metadata.tag} is not the repository's latest release`);
    const publicManifest = await getBuffer(metadata.manifestUrl);
    const localManifest = fs.readFileSync(path.join(ROOT, metadata.manifestName));
    if (sha256(publicManifest) !== sha256(localManifest)) throw new Error("Public manifest endpoint differs from the release artifact");
    const publicArchive = await getBuffer(metadata.downloadUrl);
    const localArchive = fs.readFileSync(path.join(ROOT, metadata.archiveName));
    if (sha256(publicArchive) !== sha256(localArchive)) throw new Error("Public archive endpoint differs from the release artifact");
  }

  console.log(`UESRPG | Verified ${metadata.tag} ${phase} release assets and SHA-256 digests.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
