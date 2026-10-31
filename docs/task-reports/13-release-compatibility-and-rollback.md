# Task 13 - Local package verification and release readiness

**Date:** 25 October 2026.  
**Scope:** source checks, local installable/source packages, archive fidelity, documentation and future release gates.  
**Result:** Local packaging verified; native release acceptance and publishing deferred.  
**Evidence boundary:** no native installation, deployment, publication or compatibility change. Preliminary observations are recorded below; final artifact identities and post-finalization checks belong to the external ledger.

## Baseline and preservation

| Field | Evidence |
| --- | --- |
| Workspace / baseline | `C:/dev/uesrpg/uesrpg-3ev4-14.0.0`; all **995 files** in Task 12's final source/development SHA-256 inventory matched before editing. Tasks 01-12 are preserved, including deferred objectives. |
| Additional inventory | A full workspace inventory records **1,526 files** outside local metadata, dependencies, outputs and backups. It includes assets, packaging wrappers, configuration and pack bytes outside the earlier 995-file inventory. No database is opened or edited. |
| Backup | Ignored `release/backups/task-13-release-verification-20261025-173225/`: originals of `docs/Release.md` and `docs/testing.md`, copied Task 12 inventory, full pre-change inventory, baseline metadata and verified earlier artifacts, all preserved before edits or rebuilds. Timestamp is UTC. |
| Earlier artifacts | Existing installable/source directories and ZIP were dated **8 October 2026**. **2,947 files / 97,823,882 bytes** were copied and individually hash-verified under `artifacts-before/`. These are unverified earlier builds, not a demonstrated known-good release. |
| Git identity | Branch, commit and local tag state unavailable: Git reports `not a git repository`. No replacement repository, commit, branch, tag or PR is created. |
| Runtime / metadata | Windows, PowerShell, Node **v24.13.0**, npm **11.6.2**; package/system/lock version **14.2.0**; Foundry minimum/verified **14.368**, maximum **14**, unchanged. |
| Changes | Two existing guides and this new report only. Final preservation evidence checks the full file inventory as well as the original Task 12 subset. |
| Excluded actions | No Foundry launch, world write, module installation, user-data copy, version lifecycle, tag push, remote CI dispatch, release upload or publication. |

The user's selected plan authorizes local package verification. The attached release task supplies context; it does not authorize publishing or changes to compatibility declarations. Source-confirmed behavior below describes existing tooling. Native behavior and downloadable remote assets remain unknown until observed.

## Canonical owners and release identity

| Owner | Source-confirmed responsibility / boundary |
| --- | --- |
| [Source/build validator](../../scripts/build-release.js) | Owns source safeguards, release/source file selection, staging, archive policy and copied-file equality. `--build-folder` and `--build-github-source` write only the registered staging destinations after source validation. `--archive` inspects the supplied ZIP. Without those options, validation does not build a release. |
| [Windows wrapper](../../build-dist.cmd) | Calls both folder builders, compresses the contents of the installable directory into the ZIP root, then calls archive validation. It replaces existing outputs and removes a ZIP rejected by that final validator. Failure stops its remaining steps; a missing PowerShell executable can leave folders without a ZIP, so output existence must be checked independently. |
| [Deployment verifier](../../scripts/verify-deployment.js) | Reads the staged installable folder and an explicit target; rejects missing, changed or additional files using SHA-256. This task's target is an isolated extraction inside `dist`, not the default Foundry directory. It writes neither tree. |
| [Release metadata](../../automation/release-metadata.js) | Canonical repository, tag, manifest name, archive name and package URL construction. No alternate version/URL owner is added. |
| [Version lifecycle](../../automation/version.js) | An actual separately approved npm version operation uses package/lock lifecycle behavior plus this hook to update the system version and generated URLs; the hook stages the manifest when a Git worktree is available. It is inspected, not executed. |
| [Validation workflow](../../.github/workflows/validate.yml) | Node 24, locked install, unit gate, syntax/lint/audit/schema/source checks and folder staging on branch/PR events. Configuration inspection is not an observed remote run. |
| [Publication workflow](../../.github/workflows/main.yml), [asset verifier](../../automation/verify-github-release.js) | A matching pushed version tag starts publication. The workflow guards tag/package/commit identity, refuses an existing release, tests/validates/builds, creates a draft, compares assets, publishes and verifies public/latest endpoints. Failed-draft cleanup is limited to the draft it created. No step is triggered here. |

For the unchanged 14.2.0 metadata, the existing owner derives:

| Field | Generated value / observation |
| --- | --- |
| Repository | `varys1337/uesrpg-3ev4` |
| Tag convention | `v14.2.0`; generated expected name only, not a newly created or verified remote tag |
| Manifest | `https://github.com/varys1337/uesrpg-3ev4/releases/latest/download/system.json` |
| Download | `https://github.com/varys1337/uesrpg-3ev4/releases/download/v14.2.0/uesrpg-3ev4.zip` |
| Release assets | `system.json` and `uesrpg-3ev4.zip` |
| Remote evidence | **NOT RUN**: release/tag existence, asset availability, public endpoint hashes, latest-release identity and GitHub Actions execution |

Matching a generated URL string does not demonstrate an asset exists or matches this workspace. Many local artifacts can retain version 14.2.0; use their recorded hashes and source inventories to distinguish them. A tag is not a downloadable release. This task does not run the authenticated remote asset verifier or claim remote release immutability was exercised.

## Compatibility and API evidence

The official v14 [PackageCompatibilityData](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.PackageCompatibilityData.html) documents the minimum/maximum limits separately from the build through which compatibility is verified. [PackageManifestData](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.PackageManifestData.html) documents manifest identity, version, runtime file paths and installation/update URLs. These are documented data interfaces; this task introduces no Foundry API call or protected override.

The current validator also explicitly requires minimum/verified 14.368 and maximum 14. Any later approved declaration change must address the existing validator and actual native evidence together. Preserving those declarations does not retrospectively certify them: no native build is tested here, and the future v14.369+ test target is separate from the unchanged manifest.

Client package metadata, a source scanner and ZIP byte equality do not establish server-side permission enforcement, document lifecycle behavior, native model cleaning, migration success, privacy or gameplay correctness. Use the [architecture handbook](../architecture.md) and [integration lane](../testing.md#lane-b---real-foundry-integration) for those owners and evidence boundaries.

## Packaging procedure and observed boundaries

1. Validate the baseline, copy and hash-check both documentation originals and all earlier outputs, and verify resolved staging paths remain in this workspace. No external checkout or Foundry user-data path is used.
2. Install exact locked dependencies, then run the existing tests and source checks. No generator's write option, production refactor, new dependency or test is introduced.
3. Build preliminary packages through the existing Windows wrapper. Use its actual results to finish this report; preliminary outputs are superseded by the final build.
4. Use an ignored, one-off inspection script with the platform ZIP reader. Enumerate all non-directory entries, reject unsafe or duplicate/case-colliding paths, read/decompress every file, and compare its byte length and SHA-256 with the corresponding staged file. Require exact file-set equality. This supplements the existing archive validator without changing its owner or public interface.
5. Extract only into a new checked directory below `dist/task-13-verification-preliminary/` or `dist/task-13-verification-final/`. Invoke `verify:deployment` with that explicit extracted system directory and record the result as isolated extraction verification.
6. Check manifest runtime entrypoints/styles/languages/pack CURRENT paths, consistent package versions and source-to-stage equality. Confirm the source handoff retains tests, fixtures, workflows and development owners while the installable tree/ZIP excludes them. Verify pack bytes without constructing or altering a LevelDB database.
7. Finalize documentation, run the wrapper again, repeat full archive/extraction checks and write final hashes/timings to the external sidecar and backup evidence. Make no subsequent packaged-content edit without rebuilding and re-verifying.

### Preliminary artifact observations

The preliminary Windows wrapper completed with **exit 0 in 157,791.840 ms**, including source validation for all three steps: installable folder, source handoff and ZIP. It produced **1,490 installable files** and **1,524 source-handoff files**. The ZIP contained exactly those 1,490 root-layout installable files, **21,059,472 compressed bytes / 38,990,576 payload bytes**. These size figures identify the preliminary draft build only; final documentation changes require the separate final artifact ledger.

The independent complete entry/payload comparison and extraction completed **PASS in 4,572.296 ms**. Every entry matched the staged file length and SHA-256; no missing, additional, unsafe or case-colliding file was found. The existing verifier against the explicit preliminary extraction completed **exit 0 in 937.241 ms**, confirming all 1,490 files. **15 required manifest paths across ten packs** were present. All **25 development files** under tests, scripts, automation and workflow directories were retained in the source handoff and excluded from the runtime package. The source handoff omitted exactly the three existing transient pack files selected by the owner: LOCK, LOG and LOG.old. Numbered pack data/WAL files were retained.

The first one-off inspection attempt stopped while reading the lockfile: PowerShell's JSON object reader requires its hashtable option to preserve the empty root package key. Correcting that ignored reader allowed verification to proceed; no artifact, source owner or lockfile was changed. The setup issue and successful rerun are recorded separately. Preliminary packages contain the earlier draft of this report and are superseded by the final build after documentation is frozen.

The existing archive validator rejects unsafe/duplicate entry paths, ZIP64 archives and development entries; it checks required root files/runtime prefixes and archived manifest identity/version. Its content reader supports stored/deflated entries, but the archive check reads the manifest rather than independently hashing every payload. The one-off comparison closes that local byte-fidelity gap for the produced ZIP. It does not add persistent test infrastructure, fuzz the ZIP parser or prove native pack usability.

### External final artifact evidence

Final evidence is stored beside the local ZIP as `dist/task-13-artifacts.json` and copied into the ignored Task 13 backup as `final-artifacts.json`. The ledger records the ZIP SHA-256/size, manifest hash, complete installable/source/extracted file inventories, observed command timing/results, preservation checks and native/remote NOT RUN status. Individual large inventories may be adjacent files identified by hash in that ledger.

This report is included in the packaged documentation. Embedding the final ZIP's own hash or final build duration here would require changing the bytes being identified; final fingerprints and timings therefore stay outside the package. The sidecar is local verification evidence, excluded from the installable tree and repository-source handoff by their existing file selection. It is not a new persisted gameplay format or a published release manifest.

## Validation ledger

All durations below are observed local elapsed command times. Independent checks ran concurrently after the successful locked install; durations are not native performance measurements.

| Check | Exit / duration | Observed result |
| --- | --- | --- |
| Initial `npm ci` | 4294963248 / 977.852 ms | Failed: sandbox could not stat/write the default npm cache. Preserved as an environment failure. |
| Workspace-cache retry | 1 / 844.253 ms | Failed: registry requests were denied; npm reported its exit-handler error. The detailed log contains EACCES requests. Not a completed install. |
| Authorized `npm ci`, workspace cache | **0 / 2,549.636 ms** | PASS: added 78 packages, audited 79, reported zero vulnerabilities. Exact lockfile retained. |
| `npm test` | **0 / 1,066.248 ms** | PASS: **313 tests, twenty suites**, zero failed/skipped/cancelled/todo; runner duration **572.0968 ms**. Eight existing unit files; no suite added. |
| `npm run lint` | **0 / 9,558.053 ms** | PASS. |
| `npm run syntax:check` | **0 / 37,474.198 ms** | PASS: 803 JavaScript files. |
| `npm run schema:check` | **0 / 609.894 ms** | PASS: generated TypeDataModel seeds match template source. No generation performed. |
| `npm run data:check` | **0 / 555.626 ms** | PASS: 30 spell-effect and 13 strike-enchantment catalog entries. |
| Initial `npm run validate`, before documentation edits | **0 / 46,399.555 ms** | PASS: source safeguards and release metadata. Later build invocations also validate the finalized documentation. |
| Separate `npm audit --audit-level=high` with registry access | **0 / 1,956.222 ms** | PASS: zero vulnerabilities reported by that observed registry audit. No dependency change or permanent npm configuration. |
| Preliminary Windows wrapper | **0 / 157,791.840 ms** | PASS: folder, source handoff and ZIP validation; 1,490 / 1,524 / 1,490 files respectively. |
| Preliminary full ZIP comparison / extraction | **0 / 4,572.296 ms** | PASS: exact file set and all payloads equal stage. The one-off JSON-reader setup issue was corrected and retained separately. |
| Existing verifier against preliminary extraction | **0 / 937.241 ms** | PASS: 1,490 extracted files; explicit local target only. |
| Final wrapper / archive / extraction / preservation | External ledger | Final observations and exact artifact identities are written after documentation is frozen. |

The initial source validation checked 795 JavaScript references, 105 templates, a 784-module runtime graph with 4,037 import edges / 778 reachable modules, 7,213 import/export bindings including 210 literal/computed dynamic imports, 31 Markdown documents and 21 centralized migration revisions. Each preliminary build validation checked **32 Markdown documents**, including this new report. Final build observations and local link/fragment checks are recorded in the external ledger, with no later packaged-content edit.

The pre-finalization preservation check passed: exactly the two guides changed and this report was added; all **822 production files, twelve existing test/fixture files, two workflows and twelve prior task reports** retained their hashes. The full inventory preserved **1,524 of 1,526 existing files**, with only the two authorized guide edits; the new report makes **1,527 total / 996 source-development inventoried files**. All 2,947 earlier artifact backup files still match their preserved hashes. The local documentation check resolved **53 file links and twenty heading fragments** without errors. Final preservation and link checks repeat after final staging and are recorded externally.

**Coverage limits, separately from failures:** the validator reports **25 existing binding-coverage notices** for computed members and promises/namespaces passed beyond statically tracked accesses. They are not failures or evidence those runtime paths executed. The existing Node module-type warning is recorded without changing package module configuration. Static accessibility/ownership and workflow checks cannot establish computed labels, multiplayer authority, native privacy, performance, completed CI or real recovery. No Foundry simulator or loader is used.

## Future native acceptance - every case NOT RUN

Use a separately selected backed-up Foundry **v14.369+ v14** test environment. Record exact server/client build, browser, OS, system artifact hash, roles, ownership, modules and fixture IDs. Preserve a coherent world copy and a separately identified known-good prior package/source before the first launch. Keep all clients/processors stopped while copying backups. Do not infer that the preserved October artifact is known-good.

| Gate | Existing acceptance owner / procedure | Status |
| --- | --- | --- |
| Clean package installation and assets | Install the exact local candidate only after the native test decision. Check system discovery, initialization, runtime imports/assets/packs, warning/deprecation output and a fresh world. Use the explicit installed path with the existing verifier; do not replace a campaign system. | **NOT RUN** |
| Rank, purchase and form behavior | [Task 01 rank persistence](01-skill-rank.md#reproducible-live-acceptance---all-not-run), [Task 02 purchase/recovery cases](02-xp-purchases.md#reproducible-live-acceptance---every-case-not-run), including draft preservation, native Talent batches, owner/GM rules and submit/close. | **NOT RUN** |
| Combat, authority and explanations | [Task 04 special-action cases](04-special-action-idempotency.md#reproducible-live-acceptance---every-case-not-run), [Task 08 damage visibility/presentation](08-explainable-combat-calculations.md#native-acceptance-procedure---every-case-not-run) and [Task 09 result contracts](09-action-result-contracts.md#native-acceptance---every-case-not-run), including interruption, replay, GM takeover, linked/unlinked tokens and all message visibility modes. | **NOT RUN** |
| Legacy data, models and migration truth | [Task 06 revision/failure/retry cases](06-migration-readiness.md#reproducible-live-acceptance---every-case-not-run), [Task 07 native model procedure](07-typed-data-model-audit.md) and [Task 10 historical chat procedure](10-typed-chat-outcomes.md). Use cloned legacy inputs and supported compendium import, embedding, duplication, export/reimport and reload paths. | **NOT RUN** |
| Broader gameplay, modules and nonfunctional checks | [Consolidation acceptance](../consolidation-acceptance.md), [combat](../combat-fluency-14.3.0.md), [automation](../automation-fluency-14.3.0.md), [Task 12 supportability](12-supportability-accessibility.md), plus [Task 05](05-appv2-sheet-performance.md) and [Task 11](11-startup-combat-event-performance.md) matched benchmark procedures. Preserve their separate evidence gates and module/version ledgers. | **NOT RUN** |
| Installed deployment, rollback rehearsal and remote publication | Compare the selected installed package, stop processors, inspect pending operations, restore matching pre-test package/world snapshots and recheck representative documents. Only a separate explicit publication decision can start Git/tag/upload steps or remote asset verification. | **NOT RUN** |

Startup maintenance covers the existing settings and NPC armor passes through the migration runner. A selected active GM can explicitly run the full manual sequence; known failed historical revisions remain pending until a manual retry succeeds. Inspect persisted pending revisions after a run. The informational world version stamp is not completion, a gameplay gate or evidence every migration executed.

Do not approve a release with failed checks, unresolved schema/permission/authority defects or uncertain operations. If native testing exposes a defect, preserve evidence and request a separate corrective patch within its owner; this local packaging task does not silently fix mechanics or narrow data compatibility. A later version/compatibility decision must use actual results, the existing metadata owner and aligned validator policy.

## Rollback

Local documentation/artifact rollback requires no world restoration because this task never launches Foundry:

1. Restore the two guide originals from the Task 13 `source/` backup and remove only this new report. Verify the original source inventories; preserve every prior task result.
2. If reverting local outputs, first preserve any newer evidence. Verify absolute paths and restore the earlier installable/source directories and ZIP from `artifacts-before/`; compare the `artifacts-before.sha256.json` exact file set and hashes. Restore whole trees rather than merge-copying, so candidate-only files do not remain.
3. Remove only this task's isolated extraction directories and local sidecar/inventory outputs when no longer needed, after checking their resolved paths stay below the intended workspace `dist` directory. Keep backup/evidence material recoverable. No external checkout, user-data directory or world is a cleanup target.

After any later stateful test, stop clients, authority processors and purchase activity; inspect and reconcile unresolved operations using their existing GM review procedures. Restore the matching system plus the complete coherent pre-test world snapshot, including Actor, Item, ActiveEffect, Token, ChatMessage and settings/receipt state. A system-folder downgrade does not undo data transformations, and lowering migration revisions is never rollback. Native restore/rollback rehearsal remains **NOT RUN**.

The broader Task 05/11 optimization, Task 07 stricter schema, Task 10 typed ChatMessage and Task 12 diagnostic-export/accessibility/module objectives stay deferred. No later task begins.

The overall release gate remains pending native acceptance.

Local packaging verified; native release acceptance and publishing deferred.

