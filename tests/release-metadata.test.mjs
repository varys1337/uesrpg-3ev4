import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getReleaseMetadata } = require("../automation/release-metadata.js");
const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));

test("14.3.4 uses the explicit Foundry compatibility identity", () => {
  const metadata = getReleaseMetadata("14.3.4");
  assert.equal(metadata.version, "14.3.4");
  assert.equal(metadata.manifestVersion, "v14.3.4");
  assert.equal(metadata.tag, "v14.3.4");
  assert.equal(metadata.manifestUrl, "https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json");
  assert.equal(metadata.downloadUrl, "https://github.com/varys1337/uesrpg-3ev4/releases/download/v14.3.4/uesrpg-3ev4.zip");
});

test("checked-in manifests match the release identity and package lock", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const manifest = readJson("system.json");
  const metadata = getReleaseMetadata(pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(manifest.id, pkg.name);
  assert.equal(manifest.version, metadata.manifestVersion);
  assert.equal(manifest.manifest, metadata.manifestUrl);
  assert.equal(manifest.download, metadata.downloadUrl);
});

test("releases use matching prefixed identities and malformed versions fail", () => {
  for (const version of ["14.3.2", "14.3.3", "14.3.5"]) {
    const metadata = getReleaseMetadata(version);
    assert.equal(metadata.tag, `v${version}`);
    assert.equal(metadata.manifestVersion, `v${version}`);
  }
  for (const invalid of ["v14.3.4", "14.3", "", "14.3.4/other"]) {
    assert.throws(() => getReleaseMetadata(invalid), /Invalid release version/);
  }
});
