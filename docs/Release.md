# Release and deployment

UESRPG targets Foundry VTT 14.368 and later v14 builds. The manifest's `verified` value must only be raised after runtime verification against that exact Foundry build.

## Validate and build

Use Node.js 24 and install the locked development dependencies:

```text
npm ci
npm run lint
npm run schema:check
npm run data:check
npm run validate
```

`npm run build:folder` creates the validated installable folder at `dist/uesrpg-3ev4`. `npm run build:github-source` creates a validated repository-source snapshot at `dist/github-source`. `npm run build:release` validates the source without changing release artifacts unless an archive argument is supplied.

On Windows, `build-dist.cmd` runs both folder builds, creates `dist/uesrpg-3ev4.zip`, and validates the ZIP. The three outputs have separate purposes:

- `dist/uesrpg-3ev4` is the installable Foundry system folder.
- `dist/uesrpg-3ev4.zip` is the root-layout GitHub Release archive.
- `dist/github-source` is the repository-root snapshot to transfer into a GitHub checkout. Its contents, not the `github-source` wrapper directory, are committed.

The validator checks manifest and schema consistency, import reachability and exported bindings, localization and accessibility contracts, ApplicationV2 architecture, documented Foundry v14 compatibility boundaries, authority-intent isolation, private API usage, Active Effect duration payloads, consolidation boundaries, generated catalogs, and release contents.

Import/export validation uses the existing AST analysis and release path resolver. It checks named/default imports, aliases, re-exports, star-export ambiguity, namespace access, and identifiable literal dynamic-import bindings, including `Promise.all` batches and `.then` callbacks. Errors include source lines and the exporting module, and block both folder builds before artifacts are written. Coverage limits are printed for computed accesses, mutable namespaces, and promises or namespaces passed into untracked code; this check does not execute Foundry runtime modules or replace disposable-world acceptance.

Edit `src/data/spell-effects-catalog.js` and `src/data/strike-enchantments-catalog.js` as the canonical catalogs. Run `npm run data:sync` to regenerate their JSON mirrors, then `npm run data:check`. The generator parses literal data without importing or executing Foundry runtime modules.

The 14.2.0 consolidation is a source update. No new installable folder or ZIP was produced during implementation. Review the [consolidation audit](consolidation-audit.md), complete the [live acceptance checklist](consolidation-acceptance.md) in a disposable world, and only then create and deploy release artifacts. Preserve the existing manifest `verified` build until a newer exact build passes runtime acceptance.

The subsequent combat fluency changes target the selected 14.3.0 release. The package, lockfile, manifest version, and tag-specific download URL must agree before building. Complete the [combat fluency acceptance and measurement checklist](combat-fluency-14.3.0.md) before production deployment; matching release metadata and successful source validation do not certify live-world behavior.

The broader automation pass is also implemented in source. Complete its [rest, consumption, spell lifecycle, time, state synchronization, and measurement gates](automation-fluency-14.3.0.md) alongside the combat checklist. Review each independent patch and its verified reverse patch before promoting it. Runtime acceptance and live performance measurements remain pending; the source checks do not justify a version bump or a performance claim.

## GitHub Desktop source handoff

The source handoff includes `.github`, automation, documentation, development metadata, runtime source, templates, packs, and assets. It excludes local agent configuration, Git metadata, dependencies, generated release folders, backups, ZIP files, and transient compendium locks and logs.

Use a clean checkout of `https://github.com/varys1337/uesrpg-3ev4.git`. A normal merge copy is insufficient because it cannot remove tracked runtime modules or pack files that no longer exist in the source snapshot. Back up the checkout, verify the absolute paths below, and then mirror the snapshot while preserving `.git`:

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

Inspect the resulting changes in GitHub Desktop before committing, including deletions of obsolete source files. Validate the GitHub checkout itself after the handoff. Commit and push the corrected source first, then create and push a new tag matching `package.json` on that exact commit: `v14.3.0` for the current release. A branch push runs source validation; pushing the matching tag runs the immutable release workflow, which creates and publishes `system.json` and `uesrpg-3ev4.zip`. Do not commit the local `dist` wrapper or upload it as repository source. Do not reuse an existing release tag or rerun an old failed commit expecting it to include newer fixes.

## Local deployment

Back up the currently installed system folder before replacing it. Copy the complete `dist/uesrpg-3ev4` directory into the Foundry user-data `Data/systems` directory, then run:

```text
npm run verify:deployment -- "C:\path\to\FoundryVTT\Data\systems\uesrpg-3ev4"
```

The verification command compares every staged release file by SHA-256 hash. It does not modify either directory.

World-data migrations run only when Foundry loads a world with the updated system. Back up affected worlds before the first runtime launch, and keep the previous system folder until the migration and a smoke test have completed successfully.
