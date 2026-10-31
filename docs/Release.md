# Release and deployment

UESRPG targets Foundry VTT 14.368 and later v14 builds. The manifest's `verified` value must only be raised after runtime verification against that exact Foundry build.

## Validate and build

Use Node.js 24 and install the locked development dependencies:

```text
npm ci
npm test
npm run lint
npm run syntax:check
npm run schema:check
npm run data:check
npm run validate
npm audit --audit-level=high
```

`npm test` runs the deterministic Node rules suite described in the [testing guide](testing.md). Both CI workflows run it once after dependency installation and before their existing validation/build steps. Local `npm run validate` remains source validation; run the test command separately. Tests and generated fixtures are included in repository-source handoffs and excluded from installable folders and release archives.

`npm run build:folder` creates the validated installable folder at `dist/uesrpg-3ev4`. `npm run build:github-source` creates a validated repository-source snapshot at `dist/github-source`. `npm run build:release` validates the source without changing release artifacts unless an archive argument is supplied.

On Windows, `build-dist.cmd` runs both folder builds, creates `dist/uesrpg-3ev4.zip`, and validates the ZIP. The three outputs have separate purposes:

- `dist/uesrpg-3ev4` is the installable Foundry system folder.
- `dist/uesrpg-3ev4.zip` is the root-layout GitHub Release archive.
- `dist/github-source` is the repository-root snapshot to transfer into a GitHub checkout. Its contents, not the `github-source` wrapper directory, are committed.

Building these local artifacts is separate from native installation, release acceptance and publishing. Preserve earlier outputs before rebuilding: the folder builders replace their registered staging directories and the Windows wrapper replaces the ZIP. Run the dependency audit with registry access; a network failure is an unavailable result, not a clean audit.

The [Task 13 local package verification report](task-reports/13-release-compatibility-and-rollback.md) records source checks, packaging evidence and remaining gates. Its external local evidence ledger identifies the final artifacts without embedding an archive's own hash inside its packaged documentation. The same version string does not make an earlier ZIP, a local verification build and a published asset interchangeable. Do not distribute or install the local verification ZIP as an accepted release.

The validator checks manifest and schema consistency, import reachability and exported bindings, localization and accessibility contracts, ApplicationV2 architecture, documented Foundry v14 compatibility boundaries, authority-intent isolation, private API usage, Active Effect duration payloads, consolidation boundaries, generated catalogs, and release contents.

Import/export validation uses the existing AST analysis and release path resolver. It checks named/default imports, aliases, re-exports, star-export ambiguity, namespace access, and identifiable literal dynamic-import bindings, including `Promise.all` batches and `.then` callbacks. Errors include source lines and the exporting module, and block both folder builds before artifacts are written. Coverage limits are printed for computed accesses, mutable namespaces, and promises or namespaces passed into untracked code; this check does not execute Foundry runtime modules or replace disposable-world acceptance.

Edit `src/data/spell-effects-catalog.js` and `src/data/strike-enchantments-catalog.js` as the canonical catalogs. Run `npm run data:sync` to regenerate their JSON mirrors, then `npm run data:check`. The generator parses literal data without importing or executing Foundry runtime modules.

The earlier 14.2.0 consolidation was a source update without new installable artifacts at that implementation checkpoint. Task 13 separately verifies local packages; it does not establish runtime acceptance. Review the [consolidation audit](consolidation-audit.md) and complete the [live acceptance checklist](consolidation-acceptance.md) in a backed-up test world before promoting a release. Preserve the existing manifest `verified` build until a newer exact build passes runtime acceptance.

The subsequent planned 14.3.0 combat fluency changes are implemented in source, with the release version still at 14.2.0 pending runtime acceptance. Complete the [combat fluency acceptance and measurement checklist](combat-fluency-14.3.0.md) before a separate version and release decision. Use the eventual accepted release version for the tag in the handoff workflow below.

The broader automation pass is also implemented in source. Complete its [rest, consumption, spell lifecycle, time, state synchronization, and measurement gates](automation-fluency-14.3.0.md) alongside the combat checklist. Review each independent patch and its verified reverse patch before promoting it. Runtime acceptance and live performance measurements remain pending; the source checks do not justify a version bump or a performance claim.

## GitHub Desktop source handoff

The source handoff includes `.github`, automation, documentation, development metadata, runtime source, templates, packs, and assets. It excludes local agent configuration, Git metadata, dependencies, generated release folders, backups, ZIP files, and transient compendium locks and logs.

Use a clean checkout of `https://github.com/varys1337/uesrpg-3ev4.git`. A normal merge copy is insufficient because it cannot remove tracked pack files that no longer exist in the source snapshot. Back up the checkout, verify the absolute paths below, and then mirror the snapshot while preserving `.git`:

```powershell
$sourceSnapshot = (Resolve-Path "C:\path\to\development\dist\github-source").Path
$githubCheckout = (Resolve-Path "C:\path\to\GitHub\uesrpg-3ev4").Path

if ($sourceSnapshot -eq $githubCheckout) { throw "Source and destination must be different directories." }
if (-not (Test-Path -LiteralPath (Join-Path $githubCheckout ".git"))) { throw "Destination is not a Git checkout." }
if ((git -C $githubCheckout remote get-url origin) -ne "https://github.com/varys1337/uesrpg-3ev4.git") { throw "Unexpected Git origin." }
if (git -C $githubCheckout status --porcelain) { throw "Git checkout must be clean before transfer." }

git -C $githubCheckout -c core.quotepath=false ls-files | ForEach-Object {
  $trackedFile = Join-Path $githubCheckout $_
  if (Test-Path -LiteralPath $trackedFile) { Remove-Item -LiteralPath $trackedFile -Force }
}

Get-ChildItem -LiteralPath $sourceSnapshot -Force | Copy-Item -Destination $githubCheckout -Recurse -Force
git -C $githubCheckout status --short
```

After the applicable acceptance and publication decision, inspect and commit the accepted source first. Use the existing npm version lifecycle and `automation/release-metadata.js` for version changes; do not hand-edit one version or invent package URLs. The release tag must equal the package version without a leading `v` and resolve to the exact release commit. Pushing the matching numeric tag starts the workflow that creates, verifies and publishes `system.json` and `uesrpg-3ev4.zip`; a tag alone is not a downloadable release. Do not commit the local `dist` wrapper or push a tag as a verification exercise.

## Local deployment

Native installation and deployment are separate future actions. Back up the installed system and copy the complete affected world before its first launch with a candidate package. Install only into the selected test environment, then pass its explicit system directory to the verifier:

```text
npm run verify:deployment -- "C:\path\to\FoundryVTT\Data\systems\uesrpg-3ev4"
```

The verification command compares the exact file set and every staged release file by SHA-256 hash. It does not modify either directory or establish native acceptance. Task 13 uses it only against an isolated ZIP extraction inside `dist`, never against a Foundry user-data directory.

Startup migration maintenance retains the settings and NPC armor coverage passes. The selected active GM's Run Migrations control requests the full existing manual sequence. Failed historical revisions remain pending until an explicit manual retry succeeds; the informational `worldDataVersion` stamp does not establish completion. Use [Task 06's status, failure and retry procedures](task-reports/06-migration-readiness.md) and inspect persisted pending revisions instead of assuming every migration ran at startup.

## Acceptance and rollback

Use the [canonical integration lane](testing.md#lane-b---real-foundry-integration) and Task 13's linked acceptance owners in a backed-up Foundry v14.369+ v14 test world. Record the exact native build, roles, modules, source/artifact identity and observed results before any compatibility declaration or release decision. Source checks, a successful extraction and CI configuration do not establish native permissions, rendering, migration recovery or multiplayer behavior.

Keep a separately identified known-good prior package, its source identity and a coherent pre-test world backup. An unverified earlier artifact is not a demonstrated rollback release. Stop clients and processors, inspect/reconcile uncertain operations, and restore the matching system and complete world snapshots together after stateful testing. A package downgrade cannot reverse document transformations; never lower migration revision markers to undo them. The [Task 13 report](task-reports/13-release-compatibility-and-rollback.md#rollback) distinguishes local artifact restoration from native rollback rehearsal, which remains NOT RUN.
