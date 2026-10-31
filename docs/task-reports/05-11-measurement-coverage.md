# Tasks 05/11 follow-up: measurement coverage

**Date:** 25 October 2026. **Scope:** bounded, opt-in diagnostic evidence only. **All native measurements: NOT RUN.**

## Baseline, ownership and preservation

The 08D checkpoint passed at 1,541 complete-inventory files and 373 Node tests. Original source and SHA-256 inventories were verified before this increment under ignored release/backups/deferred-source-wave-20261025-182237/05-11-measurement/. Branch and commit remain unavailable; Node v24.13.0. The wave began with Task 13's verified 996 source/development and 1,527 complete-inventory files. Each preceding source increment has its own originals, hashes, validation ledger and preservation proof.

The canonical [performance buffer and deterministic helpers](../../src/utils/perf-tracker-support.js) and [runtime gate/record owner](../../src/utils/perf-tracker.js) remain the only collection pipeline. New spans use the existing world timePerformanceDebug gate. They neither enable that gate nor change settings. There is no collector, timer service, dispatcher, readiness barrier, new cache, dependency or persisted report. Recording remains client-local, opt-in and limited to 500 entries. Export batches default to 100, cap at 200 and report overwritten cursors; frequent events can exhaust that history quickly.

The pure beginPerfMeasurement/measurePerfCall helpers accept explicit clocks and record callbacks. Disabled calls do not read clocks or record. Invalid/missing/reversed clocks leave duration absent; zero is retained. Finishing a span twice emits only once. Diagnostic failures cannot replace the measured return value or thrown error. Synchronous measurement returns an existing Promise unchanged and measures only the call boundary. Explicit finish spans surround the actual awaited work where appropriate.

## Coverage and exact boundaries

| Owner / evidence | Observed source boundary | Limitations |
| --- | --- | --- |
| [Five shared signatures](../../src/ui/sheets/v2/shared/sheet-signatures.js), event sheet.signature | Existing effect, wounds, combat, UI and Item signature bodies execute once inside the gated synchronous wrapper. The ignored token-comparison proof checks all five original bodies. | Inclusive signature timings overlap enclosing context spans; do not sum them. Serialization inputs, output, cache keys and invalidation stay unchanged. |
| Existing PC/NPC shared trace owner | Existing context phases and _prepareContext/_onRender/_onClose spans remain at their original boundaries and event names. | Phase spans overlap. They are neither a browser paint measurement nor a guarantee that every asynchronous initializer finished. |
| Existing Item trace owner | Item already had structured context/render timings under the world gate; no Item timing implementation was added. | Existing client trace and structured timing are different diagnostic switches. |
| [Group sheet](../../src/ui/sheets/v2/group-sheet.js) | Existing trace calls now also reach the structured buffer when the world gate is enabled; the console switch remains independent. Existing context/render/close boundaries are retained. | Full context duration includes its awaited enrichment. No new per-member/effect resolution or enrichment scan runs for diagnostics. |
| [Warfare sheet](../../src/ui/sheets/v2/warfare-unit-sheet.js) | New spans wrap existing context preparation and synchronous render/close callback bodies, including early return and thrown-error paths. | Context covers its awaited body. Render/close measure synchronous callback execution, not any unawaited superclass continuation, teardown completion or visible latency. |
| [Shared render queue](../../src/ui/sheets/v2/shared/sheet-runtime-helpers.js), sheet.queue | Request/coalescing/closed-request counters; native render-call duration and fulfilled/rejected counts; queued-resolver cancellation count on cleanup. Existing fallback render has its own attempt. | A fulfilled render call is not proof of a visible update. Request coalescing counts joining queued/in-flight work, not eliminated full renders. Cleanup cancels queued resolvers and records in-flight state; it does not claim an in-flight native render was cancelled. |
| [PC/NPC refresh](../../src/ui/sheets/v2/shared/combat-tracker-refresh.js), sheet.refresh.match/lifecycle | Existing eligible Actor/token matching expressions execute once; counts distinguish matched/skipped, and stored hook registrations/removals are counted. | Combat payload early filters run before matching and are not included in its timing. Two hooks per sheet remain the existing design. Counts do not prove absence of retained instances or unrelated listeners. |
| Group / warfare refresh | Existing group Actor/Item member matching, its four guarded hooks, warfare commander matching and its one guarded hook use the same diagnostic events. | No new effect hook or token matching rule was introduced. Item sheets have no equivalent combat refresh registration here. |
| [Deferred ready tasks](../../src/hooks/ready/register-system-deferred-tasks.js), system.deferred.scheduled/started/finished | Scheduled event records a request; started duration is scheduling-to-callback delay when both gated timestamps exist; finished duration surrounds the awaited task callback. Existing eight task registrations, idle/timer choice, timeout, order and failure handling are retained. | Callback fulfilment is not domain success or usable gameplay. Unawaited initialization remains outside its span. Existing legacy deferred event names are retained and overlap the new task span. Enabling recording after scheduling does not invent a scheduling timestamp. |

The existing startup callback timing and task spans do not establish a global readiness barrier. No migration pass, registry, startup coverage, manual-retry policy, active-GM selection or informational version stamp changed. No performance improvement is claimed.

Counters are registered once in the existing pure buffer owner and reused by the [12B sanitizer](12b-sanitized-support-export.md). The allow-list adds fixed Item/group/warfare lifecycle names and bounded numeric matching/registration/completion counters. It still excludes names, UUIDs, phase/task labels, arbitrary context, raw logs and stacks. Raw native diagnostic APIs retain their existing privacy risks; use the explicit GM support export for sharing. Counter-only records have unavailable timing in that export.

## API boundaries

The public [ApplicationV2 render](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#render) and [named parts option](https://foundryvtt.com/api/v14/interfaces/foundry.HandlebarsRenderOptions.html#parts) remain the render entry points. Context/render/close subclass callbacks are protected documented lifecycle overrides; [post-close is not awaited](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#_onclose). The [Handlebars application](https://foundryvtt.com/api/v14/classes/foundry.HandlebarsApplication.html) supplies part rendering. Diagnostics do not invoke protected callbacks independently.

Public [Hooks.on/off](https://foundryvtt.com/api/v14/classes/foundry.helpers.Hooks.html) provide registration IDs and unregistration. Recording registration/removal calls is not proof of native listener lifetime, exclusive authority or global initialization completion.

## Validation

Observed **393 tests / 26 suites**, 0 failed; runner duration 418.1862 ms. Node v24.13.0.

| Check | Exit | Elapsed |
| --- | --- | --- |
| npm test | 0 | 800.138 ms |
| npm run lint | 0 | 8205.654 ms |
| npm run syntax:check | 0 | 37330.244 ms |
| npm run schema:check | 0 | 591.606 ms |
| npm run data:check | 0 | 424.227 ms |
| npm run validate | 0 | 46769.984 ms |

The initial source check recorded 25 static binding coverage notices. Final source/documentation validation, exact hashes and the allowed change set are recorded separately in this checkpoint's validate-final.result.json and preservation-proof.json. Native execution and remote CI remain NOT RUN.

The direct-import suite covers explicit clocks, missing/invalid values, zero duration, disabled gates, exact return/throw/Promise identity, single completion, unchanged inputs, counter aggregation and adversarial private properties. No native document, Hook bus, DOM, loader or dependency is simulated. Ownership checks keep measurement helpers at their existing canonical owners. The ignored signature-body proof and exact change-set hashes are source evidence, not runtime benchmarks.

The existing Node module-type warning and static import/export coverage notices remain limitations, separate from failed checks. The 08C follow-up report's headline is corrected here to distinguish its initial failed attempt from its passing retry; both logs remain intact. No earlier Task 01-13 report changes. Remote CI and native execution remain NOT RUN.

## Native benchmark gate - every result NOT RUN

Reuse [Task 05](05-appv2-sheet-performance.md#future-benchmark-procedure---not-executed) and [Task 11](11-startup-combat-event-performance.md#future-native-benchmark-procedure---every-case-not-run), including three warm-ups and twenty measured repetitions, copied-world fixtures, fixed diagnostics, cold/warm controls and separately recorded visible latency. Capture bounded exports before overwrite; use raw numeric events locally for fixed phase/task/class comparisons because the sanitized aggregate intentionally removes that context.

Exercise targeted HP/equipment/effect/inventory updates; startup with 0/5/20 Actors and separately counted restored sheets; 1/5/10 simultaneous relevant sheets; repeated render/close/reopen; close during queued/in-flight work; unrelated Actors and multiple synthetic tokens; authority changes; and limited views. Compare recording disabled/enabled with matched conditions to quantify instrumentation overhead before interpreting any timing.

Correctness regressions use existing [Task 04](04-special-action-idempotency.md), [Task 06](06-migration-readiness.md), [Task 09](09-action-result-contracts.md), [AppV2 procedure](05-appv2-sheet-performance.md) and [integration guide](../testing.md). Pending/failed revisions, explicit manual retry, competing/no GM, interrupted startup and optional service failures must retain their current behavior. Suspected group effect invalidation, enrichment context, competing-GM maintenance, synthetic-token matching and in-flight close issues require reproduction before a corrective patch.

No optimization is authorized by these source checks. Agree numerical thresholds and compare matched median/p95 and correctness before selecting one change. Startup scheduling and event distribution require independent decisions. Typed fields and typed healing cards require their separate native compatibility/benefit gates.

## Wave artifacts and rollback

After final documentation, the existing Windows build wrapper rebuilds the local installable folder, root-layout ZIP and source handoff. Final artifact hashes, sizes, exact file counts, build duration and extraction/deployment verification are recorded externally in dist/deferred-source-artifacts.json and the ignored wave backup ledger. The previous Task 13 archive/sidecar is historical and must not be described as containing these follow-ups. No archive embeds its own hash in packaged documentation.

Restore this increment's changed source/tests/checks/guide and remove its new report/test to retain 12B/08B/08C/08D. Each earlier increment can be restored independently from its own snapshot. Restoring the entire wave also restores the preserved Task 13 local artifacts when required. Source-only rollback needs no world restoration; stateful acceptance requires stopped processors, inspection of unresolved evidence and coherent world/package snapshots. Never clear receipts or lower migration revisions to simulate rollback.

All native correctness/privacy/accessibility/module/performance/model gates remain pending as listed in the [testing guide](../testing.md). Version 14.2.0, Foundry minimum/verified 14.368, dependencies, public gameplay interfaces and publication state remain unchanged.
