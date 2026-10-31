# Task 12B - Sanitized support export

**Date:** 25 October 2026.  
**Scope:** an explicit, GM-only download from the existing Debugging AppV2 panel. Native privacy/accessibility remains **NOT RUN**.

## Baseline and ownership

All 1,527 files in Task 13's complete final inventory matched before editing (996 source/development files). Node is v24.13.0; branch/commit remain unavailable. Originals and full SHA-256 inventories are under ignored `release/backups/deferred-source-wave-20261025-182237/12b-support-export/source/`. The wave also preserves the existing Task 13 package/source artifacts and hashes before later rebuilds.

The pure [support-report projection](../../src/utils/dev/support-report.js) is the single export allow-list. It reuses canonical generated type keys, migration revision names and the existing performance summarizer. The [collector](../../src/utils/dev/collect-support-report.js) checks GM permission before reading selected metadata. The existing [Debugging panel](../../src/ui/apps/v2/debug-settings.js) supplies a type-button action separate from Save; its module checkbox starts unchecked. Export reads persisted settings, does not apply unsaved switches, and does not enable recording or maintenance.

Migration-state availability is exposed by a read-only accessor at the existing state owner. The original getMigrationState return/fallback semantics remain intact, including legacy object interpretation; no completion marker, revision, transformation, runner or startup behavior changes.

## Export format and privacy

The downloaded JSON has formatVersion 1, exact validated version text, canonical registered Actor/Item keys, known pending revision names, six Boolean diagnostic settings, bounded numeric summaries and explicit unavailable values. This is a local file format, not a persisted gameplay flag or public gameplay API. Custom/unrecognized model/revision keys are omitted.

Module IDs/versions are omitted by default. Explicit opt-in copies active package IDs and version text only. It never copies module settings. The panel explains that configuration metadata can be sensitive and asks the operator to inspect the file before sharing.

At most the latest 500 available buffer records feed the projection; only fixed event names and numeric timings/counters survive. The existing summarizer owns arithmetic; missing/invalid timing samples do not become measured zeros. Recording-disabled and overwritten-buffer evidence is separate from activity. Missing metadata is null; no complete error counter exists, so errorCounts is null. No raw context, labels, names, document content, notes, users, UUIDs, addresses, tokens, logs, errors/stacks, credentials or arbitrary payload properties are exported. No upload, telemetry, background listener, settings write or persistent collection state is introduced.

The [official v14 download API](https://foundryvtt.com/api/v14/functions/foundry.utils.saveDataToFile.html) returns void; the UI says download requested, not that storage was confirmed. [Application click actions](https://foundryvtt.com/api/v14/interfaces/foundry.applications.types.ApplicationConfiguration.html#actions) are the public AppV2 event route. The original form handler and restricted menu registration remain owners of Save/access.

## Verification

The existing Node suite now imports the pure sanitizer directly. Cases cover malicious extra properties, module opt-in, inactive packages, invalid metadata, absent versus empty evidence, canonical keys, immutable inputs, measured zero, mixed missing samples, unknown event names, invalid numbers and the 500-record bound. No Foundry global, Document/DOM simulator, loader or dependency is added.

The suite passed **332 tests in 22 suites** (runner 498.6821 ms). Recorded initial commands:

| Check | Exit | Elapsed |
| --- | --- | --- |
| npm test | 0 | 1209.567 ms |
| npm run lint | 0 | 9891.733 ms |
| npm run syntax:check | 0 | 37927.617 ms |
| npm run schema:check | 0 | 519.808 ms |
| npm run data:check | 0 | 607.833 ms |
| npm run validate | 1 | 47092.884 ms |

The first source validation rejected four property-name references in the new static guard. The guard now distinguishes named properties from actual global access; the final validation result is retained separately in validate-final.result.json. Existing coverage notices and the Node module-type warning remain analysis/environment limits, not native evidence. Source validation is not a native export/privacy pass.

## Native acceptance - NOT RUN

Use the backed-up v14.369+ environment from the [canonical guide](../testing.md#lane-b---real-foundry-integration) and [Task 12 procedure](12-supportability-accessibility.md#future-native-procedure---every-case-not-run). As GM, export with recording disabled/enabled and modules off/on; inspect every byte of the actual file. Exercise missing services, invalid saved migration state, empty/overwritten performance buffers, and version/module metadata. As player/non-owner, test menu and direct collector refusal. Export must not save unsaved debug switches, submit/close the form, alter settings/documents or start maintenance. Verify keyboard labels, narrow panes, download failure and filename behavior. All cases remain **NOT RUN**.

## Rollback and remaining gates

Restore only this checkpoint's changed files and remove its new collector/projection/test/report, preserving subsequent work. The snapshot includes all preceding tasks and package identities. Source rollback requires no world restore because no world was exercised. After later stateful testing, restore coherent snapshots under the existing guide.

The remaining explanation/measurement increments are tracked in the testing guide. Native accessibility/module testing, measured optimization, schema adoption, typed healing messages and release acceptance remain gated. System version 14.2.0, Foundry minimum/verified 14.368, dependencies and publication state remain unchanged.

