# Task 03 - Repeatable regression testing

**Date:** 24 October 2026.  
**Result:** IMPLEMENTED; 79 Node tests and all five required source checks PASS.  
**Scope:** tests, generated fixtures, existing development/CI/packaging checks and documentation. Production code remains unchanged as selected.

## Baseline and inventory

| Field | Evidence |
| --- | --- |
| Workspace / repository | `C:/dev/uesrpg/uesrpg-3ev4-14.0.0`; manifest repository `https://github.com/varys1337/uesrpg-3ev4` |
| Branch / baseline commit / final commit / PR | Unavailable: Git reports this checkout is not a repository. No repository, commit, branch, PR, tag or release was created. |
| System/package version | `14.2.0`; unchanged |
| Manifest compatibility | Minimum and verified `14.368`, maximum `14`; unchanged. Foundry acceptance target remains a backed-up v14.369+ world. |
| Local Node / dependencies | `v24.13.0`; existing installed locked development dependencies; no new dependency or lockfile change |
| Test world / browser / Foundry | None used; all live acceptance NOT RUN |
| Preserved baseline | Ignored `release/backups/task-03-regression-harness-20261024/`; 962 file copies/checksums, including the complete current production source, changed development files and prior task reports |
| Protected source | `production.sha256.json` records 928 files: `src`, languages, templates, styles, manifest, template schema and dependency lockfile |
| Task 02 preservation | All 23 entries in Task 02's final source/report hash manifest matched before editing. Task 01/02 implementation and reports are retained. |

**Source-confirmed discovery:** no canonical `npm test`, installed test runner, test directory or browser harness existed. Named gameplay files such as enchanting `tests.js` are runtime mechanics, not a Node regression suite. The predicate module already owns a 13-case console self-test; it is invoked rather than copied. Existing build validation already owns schema/catalog consistency, syntax/imports, UI/API contracts, helper ownership, metadata and release policy. These checks remain in place.

**Observed during discovery:** the selected rule modules import and representative functions run in Node without installing `game` or `foundry`. The damage post-application module instead fails its broader import chain without Foundry globals. Production helper extraction and gameplay changes were explicitly excluded, so those integrations remain in the runtime protocol.

The approved Task 03 plan determines scope. The ZIP's newer source reference and generic clean-branch/world-backup instructions do not replace the current Task 02 baseline or authorize live world mutation.

## Changes and canonical ownership

| Change | Owner / effect |
| --- | --- |
| Canonical command | `package.json`: `npm test` runs `node --test "tests/unit/*.test.mjs"`; lint also includes the test directory. Existing commands keep their behavior. |
| Five suites | `tests/unit`: advancement, predicates, initiative, normalization and migrations. Direct imports assert 15 production functions and invoke the existing predicate self-test. No duplicate calculator, loader or Foundry mock framework. |
| Generated source fixtures | Three small JSON files under `tests/fixtures` describe advancement inputs/campaign boundaries, initiative ties and legacy nested data/revisions. All are authored dummy data; no world/database/player export. |
| Lint/syntax | Existing ESLint configuration applies Node ES-module correctness/unused checks to test modules. The existing syntax walker includes tests and `.js`/`.mjs`/`.cjs` sources. Runtime import graph checks retain their existing owner and coverage. |
| CI | Both existing workflows run `npm test` once after `npm ci`, before source validation/builds. No conditional skip or allowed failure was added. The existing release automation validator checks placement/count, and source layout checks the dedicated test command. |
| Packaging | Existing repository-source allow-list includes `tests`; installable allow-list remains unchanged and archive exclusions add `tests/`. No installable folder or ZIP is produced by `npm test` or `validate`. |
| Documentation | [Canonical testing guide](../testing.md) defines Node, Foundry integration and nonfunctional lanes and links prior acceptance owners. [Release guide](../Release.md) includes the test command. |

The 15 function targets and behavior matrix are listed once in the testing guide. Pure planner tests do not execute Item creation, the purchase service, permissions, authority transport, native batch callbacks, migrations or AppV2 submit/close behavior. The earlier Task 02 simulated fixtures remain historical source evidence and are not promoted into compatibility tests.

There are **no production API/interface, schema, persisted field, migration revision, runtime hook, gameplay or UI changes**. Production files are protected by checksums. Native source defaults and catalog generation are not rewritten. Package module configuration, dependency versions and lockfile remain unchanged.

## API and execution model

No new Foundry API usage is introduced. The live guide links official v14 [Item creation lifecycle](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#_precreateoperation) and [Actor updates](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html#update) for eventual integration acceptance, alongside the API references in Tasks 01/02. It provides no undocumented browser automation or emulated compatibility environment.

The command follows the official [Node 24 test-runner glob/discovery documentation](https://nodejs.org/download/release/v24.13.0/docs/api/test.html#running-tests-from-the-command-line). The quoted dedicated glob excludes backups, runtime developer tools and fixture files from test discovery. Native process isolation and `node:assert/strict` provide execution/failure reporting; fixture reads are limited to generated repository JSON.

`MODULE_TYPELESS_PACKAGE_JSON` is an observed pre-existing Node warning from importing the package's ES modules. It remains visible. No root `type` change or blanket warning suppression was used, preserving CommonJS automation/build behavior. This warning is distinct from a Foundry runtime error/deprecation.

## Validation ledger

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Initial suite | PASS | 79 tests in five suites; existing 13 predicate self-test cases are invoked inside one test; no Foundry globals/assets/client |
| Deliberately failing sentinel | PASS | Temporary `task03-failure-sentinel.test.mjs` caused the actual `npm test` command to exit 1. Guaranteed cleanup removed it without production edits; full negative output retained locally. |
| Restored `npm test` | PASS | Exit 0 after sentinel cleanup; 79 tests, five suites, zero failures/skips/TODOs; runner duration `207.5572 ms` on Node `v24.13.0`, Windows. No Foundry assets/client. |
| `npm run lint` | PASS | Exit 0; includes tests through the existing configuration |
| `npm run syntax:check` | PASS | Exit 0; 794 JavaScript files including five test ES modules |
| `npm run schema:check` | PASS | Exit 0; generated TypeDataModel defaults match `template.json` |
| `npm run data:check` | PASS | Exit 0; 30 spell effects and 13 strike enchantments match their catalogs |
| `npm run validate` | PASS | Exit 0; 789 `.js` reference checks, 105 templates, 20 Markdown files; unchanged runtime graph of 778 modules / 3,969 edges / 7,070 bindings and 21 migration revisions. Test-command/CI safeguards ran; no recursive test launch. |
| Packaging policy | PASS (static) | Canonical source allow-list includes tests, installable allow-list excludes them, archive exclusions reject `tests/`; no staged folder/ZIP was generated. |
| Protected production / Task 01/02 hashes | PASS | All 928 protected files and Task 01/02 production/report hashes match their baseline. Only the seven intended existing development/documentation files changed. |
| Remote GitHub Actions | NOT RUN | Workflow configuration was edited locally; no push/tag/remote run performed |
| Live Foundry / copied world / linked-unlinked tokens / reload / AppV2 / failure recovery | NOT RUN | No backed-up Foundry v14.369+ world available; see canonical runtime guide and prior reports |
| Performance, deprecation and accessibility capture | NOT RUN | Requires the separate runtime/nonfunctional lane |
| `npm ci`, staged folders and release ZIP | NOT RUN locally | Existing locked dependencies used; CI retains `npm ci`. No dependency or artifact generation was required for source implementation. |

The runner duration is execution evidence, not a product performance benchmark. The same 25 static import/export coverage notices remain unchanged from Task 02 and are distinct from failures. They concern computed namespace access, namespaces passed beyond direct binding/access and unsupported dynamic-import promise patterns. Fixture/plain-data tests cannot prove Foundry cleaning, persistence, permissions, cross-client ordering, cancellation or UI behavior. The CI placement check extends the existing text-based workflow safeguards; it is not a general YAML parser or proof of a remote run.

## Risk, rollback and handoff

Residual risks are unexecuted remote CI/Linux behavior, future production imports that introduce Foundry globals, and the runtime scenarios deliberately outside the Node suite. A failure indicating an actual production defect must be reported for a separate corrective patch; do not modify gameplay, silently skip assertions or edit world data to satisfy this task.

The canonical guide links Task 01 rank-preservation and Task 02 purchase/recovery acceptance rather than duplicating their definitions. Special-action retry behavior remains runtime characterization for Task 04, not a new contract introduced here. No claim of v14.369 compatibility or crash recovery follows from these tests.

Rollback procedure:

1. Preserve any newer work and verify the Task 03 `baseline.sha256.json` backup.
2. Restore changed package/ESLint/syntax/build/workflow/release-guide files from that snapshot. Restore only Task 03 changes, retaining the completed Task 01/02 production source and their reports.
3. Remove only the new Task 03 test modules, three generated fixtures, testing guide and this report identified by the final change manifest. Do not delete a shared directory recursively if it contains newer work.
4. Verify the protected production hashes and run the previous five source checks. No world-data restoration is needed: these tests do not mutate world data.

Final change hashes, protected-source comparison, command output and failure-sentinel evidence are retained under the ignored Task 03 backup directory. No release, deployment, version bump or compatibility update is part of this task.
