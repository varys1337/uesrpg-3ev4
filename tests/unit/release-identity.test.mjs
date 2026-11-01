import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getReleaseMetadata } = require("../../automation/release-metadata.js");
const readJson = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

test("build metadata uses the requested fork release identity", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const manifest = readJson("system.json");
  const metadata = getReleaseMetadata(pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(manifest.id, pkg.name);
  assert.equal(manifest.version, metadata.manifestVersion);
  assert.equal(manifest.manifest, "https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json");
  assert.equal(manifest.manifest, metadata.manifestUrl);
  assert.equal(manifest.download, metadata.downloadUrl);
});

test("other versions retain their existing release tag policy", () => {
  const compatibility = getReleaseMetadata("14.3.4");
  assert.equal(compatibility.tag, "v14.3.4");
  assert.equal(compatibility.manifestVersion, "v14.3.4");
  assert.equal(compatibility.downloadUrl, "https://github.com/varys1337/uesrpg-3ev4/releases/download/v14.3.4/uesrpg-3ev4.zip");
  const metadata = getReleaseMetadata("14.3.5");
  assert.equal(metadata.tag, "v14.3.5");
  assert.equal(metadata.manifestVersion, "v14.3.5");
  assert.throws(() => getReleaseMetadata("v14.3.4"), /Invalid release version/);
});
