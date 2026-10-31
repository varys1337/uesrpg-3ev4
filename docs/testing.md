# Regression testing

Use Node **24.x** (`>=24 <25` in the package), the locked development dependencies, and the existing repository checkout. The canonical rules command is:

```text
npm ci
npm test
```

`npm test` executes `node --test "tests/unit/*.test.mjs"`. The quoted, dedicated glob works in Windows and Linux shells and avoids accidentally discovering runtime developer utilities or backup files. The suite uses [Node's built-in test runner](https://nodejs.org/download/release/v24.13.0/docs/api/test.html#running-tests-from-the-command-line) and `node:assert/strict`; no runner dependency, transpilation, custom loader or Foundry installation is required.

This guide separates deterministic source tests, real Foundry integration and nonfunctional acceptance. Passing one lane does not establish another lane's results.

Use the [architecture and support handbook](architecture.md) for canonical owners, focused troubleshooting, safe evidence collection and the distinction between inspection and state-changing maintenance.

## Lane A - deterministic Node rules

The twelve files under `tests/unit/` import the canonical production functions directly. Tests do not install `game`, `foundry`, Document classes, DOM shims or socket mocks. They do not load the system entrypoint or read a Foundry world. Migration comparisons always receive explicit state so they do not access world settings. Task 04 adds deterministic special-action decisions; Task 06 extends migration decisions using plain state, callbacks and ID arrays. Task 08 adds read-only damage evidence projections and exact source matching.

| Suite | Canonical functions directly asserted | Covered behavior |
| --- | --- | --- |
| `advancement.test.mjs` | `normalizeRank`, `parseSpecializations`, `discountCostIfFavored`, `computeCharacteristicAdvancementCost`, `buildSkillAdvancementPlan`, `getCampaignRankFromXpTotal`, `getMaxPurchasableSkillRankKeyFromXpTotal` | Existing rank labels, specialization deduplication, favored rounding, characteristic costs, every campaign threshold, sufficient/exact/insufficient XP, sequential ranks, campaign gates, specialization caps/overrides, equipment arrays/indexes, administrative waivers, missing input and source preservation |
| `predicates.test.mjs` | `evaluatePredicate`, `isPredicate`; invokes existing `selfTestPredicate` | Existing 13 self-tests, AND/OR/NOT/NOR/NAND, nested/invalid input, empty predicates, option normalization, depth limit and unchanged inputs |
| `initiative.test.mjs` | `getInitiativeTieBreakTuple`, `compareInitiativeTuples` | Initiative total, rating, Luck, PC precedence, numeric stable IDs, missing/invalid values, comparator ordering and unchanged source |
| `normalization.test.mjs` | `applyDefaults`, `normalizeHitLocation` | Recognized scalar/indexed-array legacy shapes, strict rejection, missing nested data, ignored paths, retained extras/null-default values, idempotence, caller-controlled cloning and damage-location aliases |
| `migrations.test.mjs` | Revision/failure/pending helpers in `state.js`, failure-marker refusal, acknowledgement helpers in `authority-proxy/shared.js`, callback sequencing/coordinator in `execution.js` | Legacy interpretation, failed historical metadata, informational stamps, pending states, partial acknowledgements, failure propagation, explicit retry, authority predicates and startup/manual ordering; no native migration execution |
| `special-actions.test.mjs` | Operation construction/validation, immutable intent, source/result and Advantage-slot planning, eligibility, recovery and GM reconciliation helpers in `special-action-operations.js` | Duplicate identity, changed choices, harmless card revisions, legitimate result generations, missing targets, completed replay, legacy states, saved interruption evidence and reconciliation decisions; no native writes or multiplayer simulation |
| `damage-explanations.test.mjs` | `recordedDamageNumber`, `projectWeaponDamageExplanation`, `selectDamageExplanationLane`, `projectGmDamageExplanation` | Recorded values, missing evidence, public/private field separation, exact source identities, historical fallback, partial receipts, unchanged inputs and presentation signatures; no DOM, native permission test or damage calculation |
| `action-results.test.mjs` | Contract/evidence/receipt projection in `action-results.js`, Node-safe HUD result/feature forwarding | Status and commitment truth, corrected legacy fields, cancellation after costs, batches, transport data, interrupted/replayed/reconciled receipts, immutable plain inputs and callback forwarding; no native execution |
| `support-report.test.mjs` | `projectSupportReport` | Allow-list privacy, bounded numeric summaries, module opt-in, unknown/malformed inputs and immutable source; no runtime collector or browser emulation |
| `test-explanations.test.mjs` | Opposed projections and formatter | Committed evidence, visibility lanes, malformed/missing fields, immutable inputs and escaped text; no recomputation |
| `prepared-values.test.mjs` | Prepared-value projection | Existing numeric fields and feature groups, immutable inputs and no inferred equations or private extra properties |
| `measurement.test.mjs` | Diagnostic span/callback helpers and counters | Disabled recording, valid/missing clocks, exact returns/errors, immutable inputs and numeric support-export privacy; no native performance benchmark |

The original five files cover 15 primary function targets; Tasks 04, 06, 08 and 09 add the decision/projection helpers above. Task 13's pre-follow-up run recorded **313 passing tests in twenty suites**, including Task 08's 53 cases and Task 09's 65 cases in two groups. The predicate self-test remains the existing source owner rather than a copied test table. Tests assert known expected values and contracts; they do not implement another cost, damage, migration or initiative calculator. Task 08's examples are generated inline plain data, including deliberately inconsistent saved values to verify that presentation does not recalculate them. Task 09 uses explicit action facts and callbacks; it does not simulate Foundry Documents, queries or clients. See the [action contract guide](action-results.md) for the intentional legacy flag changes.

The four JSON files under `tests/fixtures/` are generated plain input data for advancement, initiative, legacy normalization and special-action decisions. They contain no actual users, IDs, notes, compendium databases or exported world. They are not complete Foundry Actor/Item fixtures. Task 04's 16 saved-checkpoint cases test decisions from plain state; they are not native failure injection. Tests clone mutable inputs with native `structuredClone` before use. Assertions requiring undefined, invalid numbers or special object containers construct those small values in the test itself.

The advancement planner's rank normalization is an existing calculator behavior. It does **not** test or authorize cleaning/coercion of explicitly supplied Item creation ranks. Task 01's creation lifecycle remains in Lane B.

### Running and interpreting results

The runner reports test/suite counts, failures and `duration_ms`. A failed assertion or import returns a nonzero exit status. Individual suite files may be run with `node --test tests/unit/initiative.test.mjs`; `npm test` remains the one canonical full-suite command.

Node currently emits `MODULE_TYPELESS_PACKAGE_JSON` when loading the system's ES modules from the package's existing mixed module layout. This warning was observed before this harness. It does not fail the tests and is not a Foundry deprecation report. The package has no new `type` field or global warning suppression; its CommonJS build scripts are preserved. A future module-layout change requires its own review.

Both CI workflows execute `npm test` once after `npm ci`, before their existing source checks and build steps. They do not use a skip condition or `continue-on-error` for that step. The release validator checks the canonical command and the placement/count of the test step. This is a source safeguard, not a general YAML interpreter or proof that remote CI has run.

Run the remaining checks separately:

```text
npm run lint
npm run syntax:check
npm run schema:check
npm run data:check
npm run validate
```

Lint and syntax checks include the test directory and `.mjs` files. `validate` retains its source-only behavior and does not launch the Node suite recursively. Existing schema/catalog generators remain their own consistency owners; do not regenerate their output to conceal a failure.

If a test fails, inspect its input, expected contract and the canonical source. Correct an erroneous test with evidence, or record a production defect for a separately authorized corrective patch. Do not change gameplay, world data, migrations or a passing source snapshot merely to obtain a green suite. Do not turn an unexplained failure into a skipped/TODO test or substitute a recreated calculator.

## Lane B - real Foundry integration

**All live cases below are NOT RUN** through the Task 09 source implementation. There is no Foundry browser harness or Node emulation of the document APIs. The historical Task 02 simulated protocol fixtures remain historical source evidence; they are not part of `npm test` and do not establish compatibility.

Use a stopped, complete copied-world backup and a disposable Foundry **v14.369+** v14 instance. Record the exact Foundry/system build, browser, enabled modules and backup/restoration reference. Start with external modules disabled. Prepare generated or sanitized fixtures:

| Fixture | Required contents |
| --- | --- |
| FX-PC-BASIC / FX-ITEM | PC with ordinary skills, magic skill, combat style, representative Talent/spell sources and known XP/Drakes; sufficient, exact and insufficient funds variants |
| FX-NPC / FX-TOKEN | NPC armor and unrelated equipment; a linked Actor token and two supported unlinked token Actors with independent inventories/resources |
| FX-PERM | Active GM, owner, non-owner and second active owner; repeat relevant authority cases with no active GM |
| FX-MESSAGE | A resolved special-action message with an eligible existing action and its actual automation state |
| FX-LEGACY | Sanitized legacy source documents with known missing optional fields/mixed types; export before any migration |

Do not infer token/Actor update equivalence. Record the exact UUID being changed. Before each stateful run, retain coherent Actor/embedded Item/settings exports or the copied-world backup. Use the documented [Item creation lifecycle](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#_precreateoperation) and [Actor update APIs](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html#update), and the system's existing controls/helpers. No undocumented console mutation or custom compatibility mock is authorized by these instructions.

| Scenario | Reproducible procedure and evidence | Status |
| --- | --- | --- |
| RANK-CREATE | Execute the [Task 01 acceptance matrix](task-reports/01-skill-rank.md#reproducible-live-acceptance---all-not-run): omitted and every canonical rank for all three skill types, nested/dotted paths, malformed explicit values, cancellation, copies, duplicate, compendium import and reload/export/reimport. Compare stored source ranks. | NOT RUN |
| PURCHASE-FUNDS | Execute the [Task 02 funds, Item, mixed-draft, spell, free/admin and racial scenarios](task-reports/02-xp-purchases.md#reproducible-live-acceptance---every-case-not-run). Capture quotes, resource values, source changes and grant breakdown/refund totals. Node tests cover only portable planning, not these document writes. | NOT RUN |
| PURCHASE-RECOVERY | Execute Task 02 rejection/interruption cases at every checkpoint, including native single/batch Talent creation and final-resource-write acknowledgement loss. Inspect the durable operation before retrying; verify replay, collision/stale rejection, retained evidence, blocking and GM reconciliation. Never erase evidence or automatically restore fields as a test shortcut. | NOT RUN |
| AUTHORITY | Run the same controls as GM, owner and non-owner, then with multiple owners/no GM. Exercise ritual permission, GM corrections, concurrent workflows and changed permissions. Record the original requester and selected authority. | NOT RUN |
| TOKEN | Repeat supported purchase and creation cases on linked/unlinked tokens; compare UUIDs and each inventory/resource export. | NOT RUN |
| APPV2 | Submit and close affected sheets, inject a controlled write rejection, retain drafts on failure and use Close Sheet Without Retrying where offered. Reopen/reload and compare visible values with persisted source. | NOT RUN |
| SPECIAL-RETRY | Execute the [Task 04 action, identity, permission, interruption and reconciliation matrix](task-reports/04-special-action-idempotency.md#reproducible-live-acceptance---every-case-not-run). Cover all ten actions and entrypoints, AP/effects/token links/child cards, every application mode, duplicate requests, reload/authority change and acknowledgement loss at each checkpoint. Node tests cover decisions only. | NOT RUN |
| MIGRATION | Execute the [Task 06 migration acceptance matrix](task-reports/06-migration-readiness.md#reproducible-live-acceptance---every-case-not-run) on backed-up legacy copies: failed records, partial writes, retry, startup/manual ordering, permissions, authority loss, reconnect and linked/unlinked documents. Node state/callback/ID decisions do not execute migrations or settings persistence. Restore a coherent copied world afterward. | NOT RUN |
| TYPE-MODEL | Follow the [Task 07 TypeDataModel compatibility audit and native validation procedure](task-reports/07-typed-data-model-audit.md#future-native-validation-procedure---not-executed) for model cleaning/validation, source versus transformed serialization, damage-instance shapes, copies/imports and permission/token contexts. This audit changes no schema; native results remain NOT RUN and stricter validation requires separate evidence and a decision. | NOT RUN |
| DAMAGE-EXPLANATION | Execute the [Task 08 opposed-panel matrix](task-reports/08-explainable-combat-calculations.md#native-acceptance-procedure---every-case-not-run): source/receipt identity, missing/historical evidence, public/GM visibility, counter/block damage, resource interactions, interrupted application, reload and disclosure accessibility. | NOT RUN |
| ACTION-RESULTS | Execute the [Task 09 native matrix](task-reports/09-action-result-contracts.md#native-acceptance---every-case-not-run): selected special actions, damage/healing, magic, Item/feature, alchemy, quick-menu/HUD/macro paths; accepted versus applied, cancellation after costs, partial batches, missing acknowledgements, stale/permission refusals, replay, reconciliation and original return types/companions. | NOT RUN |
| TYPED-CHAT | Follow the [Task 10 typed ChatMessage compatibility audit](task-reports/10-typed-chat-outcomes.md#future-native-validation-procedure---every-case-not-run): standalone healing field provenance, historical flags, native model/serialization behavior, visibility, controls, authority, replay and matched creation/update measurements. Adoption is deferred; this audit introduces no subtype or stored-format change. | NOT RUN |
| RESTORE | Stop clients/processors, reconcile pending purchases and special actions, and restore matching Actor/Item/ActiveEffect/Token/ChatMessage/world snapshots. Confirm resources, ranks, flags, effects and provenance describe the same point in time. | NOT RUN |

The detailed Task 01/02/04/06/08/09 reports remain the canonical scenario definitions, avoiding a competing acceptance checklist. For every execution record: scenario/fixture ID, environment, exact input/action, expected result, observed source/UI result, PASS/FAIL/NOT RUN, operation/UUID references and sanitized evidence.

Full damage application, Item-sheet normalization, purchase protocol persistence and special-action execution require Foundry-dependent imports or APIs. Keep them in this lane; do not add fake classes/globals to make them appear portable. Task 03 preserved production source; Task 04's authorized production decision helpers do not emulate document execution.

## Lane C - packaging and nonfunctional acceptance

- Follow the existing [release guide](Release.md) for source/installable-folder/archive checks. Repository-source handoffs include `tests/`; installable folders exclude it, and archive validation rejects the `tests/` prefix. Tests, development metadata and world fixtures must not be copied into the installed runtime. Local source validation and static packaging-policy inspection do not prove a staged folder or ZIP was built correctly.
- Use the [Task 13 local package verification report](task-reports/13-release-compatibility-and-rollback.md) for the observed package checks, external artifact identity ledger and future native installation/release/rollback gates. Byte equality and isolated extraction verification establish local packaging fidelity only; native acceptance, deployment and remote release verification remain NOT RUN.
- Use the [existing combat acceptance/measurement procedure](combat-fluency-14.3.0.md) for warning/deprecation capture, accessibility, render behavior and measured performance in a disposable world. Heavy PC/combat fixtures are for that lane, not the deterministic unit suite.
- Use the [Task 05 AppV2 sheet audit and benchmark procedure](task-reports/05-appv2-sheet-performance.md#future-benchmark-procedure---not-executed) for cache/invalidation dependencies, diagnostic coverage, cold versus warmed renders, targeted updates and correctness parity. This is an audit-only handoff: all measurements remain NOT RUN and no optimization is justified without matched runtime evidence.
- Follow the [Task 11 startup and combat-refresh audit](task-reports/11-startup-combat-event-performance.md#future-native-benchmark-procedure---every-case-not-run) for startup dependencies, deferred-task timing limits, per-sheet hook cleanup and matched 0/5/20-Actor startup / 1/5/10-sheet event workloads. All native measurements remain NOT RUN; scheduling and event-distribution optimization are deferred.
- Follow the [Task 12 supportability and accessibility audit](task-reports/12-supportability-accessibility.md) for diagnostic privacy boundaries, source-visible AppV2 controls and future accessibility/module cases. Diagnostic export and UI changes are deferred; every native privacy, accessibility and module result remains NOT RUN.
- Follow the [Task 09 resumption gates for Tasks 05 and 07](action-results.md#resuming-the-deferred-work) before selecting an optimization or stricter schema. Matched native performance/correctness evidence and a sanitized historical/native model corpus remain required; the broader objectives are pending.
- Do not run the system's turn-advancing benchmark in a live campaign. Record warm-up, sample count, median/p95, writes/renders and environment before making a performance claim. Unit-suite duration is execution evidence only.
- Confirm actual remote CI results separately. Editing a workflow and observing local exit codes does not constitute an observed GitHub Actions run or release acceptance.

See the [Task 03 report](task-reports/03-regression-harness.md) for the original harness ledger and rollback, the [Task 04 report](task-reports/04-special-action-idempotency.md) for special-action recovery, and the [Task 06 report](task-reports/06-migration-readiness.md) for migration completion truth, the unchanged registry, validation evidence and coherent rollback. The Node suite itself changes no world data; its results do not establish Foundry runtime compatibility or crash recovery.

## Deferred-work source follow-ups

Follow-up reports record each separate implementation checkpoint. Native installation, compatibility, accessibility, multiplayer recovery and benchmarks remain NOT RUN until the corresponding copied-world gates are executed.

| Increment | Source position / report | Native position |
| --- | --- | --- |
| 12B support export | [Sanitized support export](task-reports/12b-sanitized-support-export.md) | NOT RUN |
| 08B standalone damage | [Recorded standalone damage](task-reports/08b-standalone-damage-explanations.md) | NOT RUN |
| 08C opposed-test details | [Recorded opposed tests](task-reports/08c-opposed-test-explanations.md) | NOT RUN |
| 08D prepared derived values | [Prepared-value disclosures](task-reports/08d-prepared-value-explanations.md) | NOT RUN |
| 05/11 measurement coverage | [Bounded measurement coverage](task-reports/05-11-measurement-coverage.md); no optimization | NOT RUN |

Tasks 00/03 runtime fixtures and native integration; Tasks 01/02/04/06/08/09 correctness acceptance; Task 12 accessibility/module testing; Tasks 05/11 measurements; Task 07 native damage-instance compatibility; Task 10 healing-model benefit/compatibility; and Task 13 native installation, rollback and remote release gates remain pending. Performance/model adoption is evidence-gated. No global readiness service, universal action engine, broader recovery journal or new schema is implied.


### Gates after the source wave

The five selected source increments are implemented separately. Their reports contain observed local checks; all entries below remain **NOT RUN** or deferred until evidence is available. Source tests do not substitute for these gates.

| Stage | Evidence required before proceeding | Resulting work / decision |
| --- | --- | --- |
| Runtime foundation, 00/03 | Stopped complete copied-world backup, exact environment and sanitized PC/NPC/Item/permission/token/legacy fixtures | Establish the native baseline and restoration rehearsal; observe remote CI separately. |
| Correctness, 01/02/04/06/08/09 | Existing canonical native cases, especially permissions, batches, concurrency, interrupted writes, acknowledgement loss and reconciliation | Record outcomes; fix a reproduced defect separately at its current owner. |
| Accessibility/modules, 12C/D | Keyboard/screen-reader/focus/unsaved-input/layout checks; no-module baseline and exact individual/combined module versions | Correct reproduced issues one surface at a time; make no inferred compatibility claim. |
| Performance, 05/11 | Matched cold/warm measurements, three warm-ups, twenty measured repetitions and agreed numeric thresholds | Consider one measured change at a time; assess scheduling and event distribution independently. |
| Typed fields, 07 | Cloned sanitized historical spell damageInstances corpus, native cleaning/serialization/metadata/round-trip evidence | Tighten only demonstrated compatible shapes; any repair migration needs its own decision. |
| Typed healing cards, 10 | Demonstrated validation/maintenance benefit plus historical/caller/receipt compatibility | Decide bounded queueHealingOutcome adoption or retain existing flags. |
| Release, 13 | Accessible source identity, observed CI, native installation/acceptance and coherent rollback rehearsal | Rebuild accepted artifacts; version, deployment and publishing remain separate decisions. |

Native risk triage includes group-member effect invalidation, enrichment-context changes, competing-GM maintenance, synthetic-token matching and close during in-flight rendering. These remain suspected until reproduced. The rebuilt wave artifacts are identified by the external dist/deferred-source-artifacts.json ledger; Task 13's earlier ZIP is historical. No performance/model adoption gate was passed during source implementation.
