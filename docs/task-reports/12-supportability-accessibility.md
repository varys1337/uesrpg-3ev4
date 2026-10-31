# Task 12 - Architecture handbook and supportability audit

**Date:** 25 October 2026.  
**Result:** Documentation complete; diagnostic-export implementation, native accessibility testing/UI corrections and module verification deferred.  
**Scope:** Canonical architecture/support documentation, focused support-report instructions, source inventories and future native procedures. No production change.

## Baseline and deliverable status

| Field | Evidence |
| --- | --- |
| Workspace / baseline | `C:/dev/uesrpg/uesrpg-3ev4-14.0.0`; all **993 files** in Task 11's final source/development SHA-256 manifest matched before editing. No missing, changed or additional inventoried files. Tasks 01-11 are preserved. |
| Backup | Ignored `release/backups/task-12-supportability-docs-20261025-170749/`: originals of `README.md`, `docs/testing.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, their verified hashes, `pre-change.sha256.json` and `baseline.json`, saved before editing. Timestamp is UTC. |
| Branch / commit | Unavailable: `git rev-parse --show-toplevel` reports `not a git repository`. No branch, commit or PR claimed. |
| Package / compatibility | `14.2.0`; declared Foundry minimum/verified `14.368`, maximum `14`; unchanged. Future native procedures use a backed-up v14.369+ v14 world. |
| Environment / historical tests | Windows, PowerShell, Node **v24.13.0**, existing installed locked dependencies. Task 09 recorded **313 passing tests in twenty suites**; this documentation-only task does not rerun or extend them. |
| Native evidence | **NOT RUN**: no Foundry session, module inventory, privacy export, screen-reader session, keyboard/pointer exercise, world mutation, benchmark or native compatibility test was executed. No LevelDB database was opened or modified. |

The approved documentation-only plan bounds the bundle's four independent deliverables. Attached task documents provide context; they do not authorize a new exporter, telemetry, listener, error collector, UI correction or live test. Task 12 A is completed as a handbook; B is an inventory and future privacy requirement set, C is a source audit/future procedure, and D is an explicitly unexecuted compatibility ledger. The broader implementation and verification work remains deferred.

**Source-confirmed** means checked-in code, not native reproduction. **Potential risk** is a testable concern, not a demonstrated defect. **Unknown** needs native evidence. Examples below are illustrative reporting/procedure material, never observed world/compendium data or a sample produced by a new exporter.

## Handbook and documentation changes

[The architecture and support handbook](../architecture.md) is the canonical navigation owner. It maps Actor/Item preparation, TypeDataModel generation, form/render queues, damage, chat outcomes, transient results, authority, purchases, migrations, time and diagnostics to their existing source owners. It separates document source, derived presentation and durable/transient evidence without copying mechanics or creating another registry.

The operator section provides exact-environment capture, copied-world isolation, targeted diagnostics, redaction, interrupted-operation inspection and coherent restoration. The maintainer section explains import/caller tracing, guard ownership, AppV2/API boundaries and the canonical validation workflow. Existing task reports remain the owners of detailed acceptance and rollback procedures.

| Document | Change / preserved boundary |
| --- | --- |
| [README](../../README.md) | Adds handbook/testing links and replaces the abbreviated pre-publish check sentence with the canonical test/validation and separate release-guide references. Credits, disclaimer, installation instructions and compatibility wording are preserved. |
| [Testing guide](../testing.md) | Adds handbook/report navigation and corrects **seven** unit-suite files to **eight**, matching the current source inventory. The 313-test result remains historical, and native lanes remain NOT RUN. |
| [Bug-report template](../../.github/ISSUE_TEMPLATE/bug_report.md) | Requests exact build/browser/system/module versions, role/ownership/token context, reproduction, isolation result and focused redacted evidence. Replaces the blanket browser assertion, upgrade-before-reporting and raw-console-screenshot instructions. Submission front matter is preserved exactly. No issue is submitted or assigned by this task. |
| New handbook and this report | Current navigation plus dated inventory, limitations, future native cases, validation and rollback. Historical task reports, earlier implementation audits and changelog context are unchanged. |

### Documentation status and Task 13 follow-up

README's v14.368 floor/verified text matches `system.json`; package and system versions remain 14.2.0. No current mismatch between those declarations was found. Some earlier documentation filenames/descriptions discuss planned 14.3.0 work, while the original bundle cites a newer reference release. Those are historical/planning contexts, not authority to change the current manifest. The handbook labels that distinction instead of rewriting prior reports.

Task 13 should reconcile the eventual selected source/release, metadata and exact native acceptance evidence before any version or compatibility decision. It is not started here. No browser support or module compatibility expansion follows from asking a bug reporter to identify their actual environment.

## Diagnostic inventory and privacy boundaries

| Existing owner / surface | Access and inspection boundary | Source-confirmed contents / risk |
| --- | --- | --- |
| [Debugging menu registration](../../src/utils/dev/debug-settings.js), [AppV2 panel](../../src/ui/apps/v2/debug-settings.js) | Menu is registered `restricted: true`. Preparation exposes current master settings; Save writes world keys for GM and client keys through existing fan-out lists. | This is settings configuration, not a support-export button. Changing it can alter diagnostic volume and other world users' logging. The panel is not newly exposed to players; native access checks are NOT RUN. |
| [Debug gates](../../src/utils/debug.js), [registered lanes](../../src/hooks/init/settings/debug.js) | Common logger requires world `debugEnabled` and the relevant lane; source also has client-scoped lanes. | Enabling a client setting does not establish that a world-master-gated logger runs. Arbitrary logged payloads are not a privacy allow-list. `timePerformanceDebug` is a separate world setting, independent of the common debug master. |
| [Performance API](../../src/utils/perf-tracker.js), [buffer/export owner](../../src/utils/perf-tracker-support.js) | `game.uesrpg.perf.records`, `summarize` and `exportBatch` read current local records; reset changes the local buffer. Recording depends on the existing gate. | Raw records can carry Actor/operation/message/receipt IDs and other caller-supplied context. The buffer holds 500 records; export defaults to 100 and caps at 200, with cursor/overflow evidence. Summaries group by event and include numeric timings/counters, but event/context provenance still needs review. No complete error counter or sanitized support format is created. |
| Performance benchmark methods | Existing `runSheetBenchmark` renders selected open sheets; `runBenchmark` is GM-only, resets records and advances actual combat turns. | These are actions, not passive export. Their durations are not general visible latency or startup readiness. Task 05/11 measurement limits remain. Do not run them in a live campaign to collect a bug report. |
| [Opposed diagnostics](../../src/utils/dev/opposed-diagnostics.js), [devtools registration](../../src/hooks/init/register-devtools.js) | Loaded through existing diagnostic gates. Dump helpers check GM and return a safe stub/null on non-GM clients; recorder registration is separate. | Dumps include message ID, speaker, author/author ID, opposed flags and trace. The local buffer is bounded to 200 events per card, not a global privacy boundary. Clone/summary helpers are not redactors. |
| PC/NPC Feature Inspector copy | Existing sheet UI prepares diagnostics under its GM/setting conditions; copy handlers write supplied JSON to the clipboard. | Feature configuration, labels and custom metadata may be private. Clipboard success/failure and secure-context behavior require native testing. UI visibility is not permission to distribute the copied JSON. |
| [Model diagnostics](../../src/core/data-models/registry.js) | Existing report compares manifest/registered Actor and Item type keys, including missing/extra entries; it does not construct a new export or validate every model record. | Configuration metadata can identify custom type/module context. It is not an Actor/Item content export, but native caller access and exact output remain untested. Task 07 construction/cleaning results stay NOT RUN. |
| [Migration state](../../src/core/migrations/state.js), [Migration settings](../../src/ui/apps/v2/migration-settings.js) | Status inspection differs from the selected-active-GM Run action. Existing helpers compute pending keys and failure-aware revision truth. | Full records can include attribution, timestamps, errors or affected-document references. A prospective support summary should select pending revision names/counts rather than copy the state. Running migrations or changing stamps is not diagnostic collection. |
| [Attack-tracker diagnostics](../../src/core/combat/attack-tracker-diagnostics.js), drag/drop, container, AE and context inspectors | Existing gates and API-specific role checks vary. Their available functions are inventory context, not newly granted permissions. | May include names, UUIDs, token/combatant provenance, payloads or paths. The attack-tracker recent tail holds 20 events; a tail is neither a complete run nor sanitized evidence. Inspect exact returned fields before sharing. |
| Existing spell/chapter audit downloads and runtime maintenance APIs | Located under `utils/dev/` and current runtime registration; some are GM-only, and some repair/rebuild/flush functions are state-changing. | Existing download/copy utilities do not make the data a general support bundle. Do not invoke remediation, registry rebuild, boundary flush or content synchronization as a passive inspection step. No repair helper is run by this audit. |

The inventory does not claim that every diagnostic path is permission-equivalent or incurs zero work when its setting is off. Gates, initialization and consumer behavior must be read at their existing owner. No additional overhead, upload or error capture is introduced by this task.

### Requirements before a later sanitized exporter

These are a future decision checklist, not a new wire format or API. Reuse the existing diagnostic/settings owner and public v14 interfaces; select only supported metadata, avoid persistent world flags and automatic collection, and assess original-user scope. A future GM UI must not silently become a player endpoint with broader data access.

| Candidate information | Minimum preservation/privacy requirement |
| --- | --- |
| Foundry build and system version | Exact versions only; do not include server URL, world name/path, user identity, package source URL or credentials. Reading metadata is not a compatibility pass. |
| Relevant module IDs/versions | Only when needed for the reported fault, explicitly selected with clear metadata disclosure. No module settings, private configuration or unbounded package dumps. |
| Registered model types | Select known registry keys/counts and identify source. Do not serialize document data, defaults containing user content or arbitrary model objects. |
| Pending migrations | Reuse failure-aware helpers; select revision names/counts under the permitted context. Exclude attribution, error strings and document references by default. |
| Fault-related settings | Explicit key allow-list and value types per fault; separate client/world scope and permission. Never export all settings or enable debug lanes while collecting. |
| Structured timings/counters | Bounded, allow-listed numeric aggregates and known event labels; remove identifiers/context and reject arbitrary payload fields. Preserve overflow/missing evidence instead of inventing zeros or complete coverage. |
| Selected errors | Existing verified numeric categories/counts only if a suitable source exists. Do not add a global collector or derive complete counts from a truncated log. Exclude free-text messages/stacks, paths, names, chat and tokens by default. |

Omit credentials, session/invitation tokens, server addresses, private chat, Actor/Item names and descriptions, notes, user identifiers and unnecessary UUIDs. Retaining those locally for repair does not authorize exporting them. Masking a few key names in an arbitrary payload is insufficient: copying only explicitly allowed fields is the relevant design requirement. Module/configuration metadata itself needs an understandable disclosure and review before sharing.

A later implementation requires deterministic sanitizer tests with adversarial extra fields and immutable inputs, native GM/player checks, manual inspection of the resulting file and proof that collection makes no gameplay/settings writes. None is executed or claimed here. The [handbook's manual reporting example](../architecture.md#choose-focused-diagnostics-and-redact-evidence) is illustrative prose, not a file emitted by an exporter.

## Source accessibility and usability audit

| Surface / source observation | Classification and limit | Native result |
| --- | --- | --- |
| PC [core template](../../templates/v2/sheets/actor/tab-core.hbs) and corresponding NPC parts use native buttons, explicit actions, localized accessible labels and expand/collapse attributes in checked controls. | Source-confirmed semantics exist. Presence of attributes does not establish computed names, focus order, state announcements or every control's coverage. | NOT RUN |
| [Item tabs](../../templates/v2/sheets/item-parts/tabs.hbs) use button controls, navigation labeling, group/tab identifiers and tab roles. | Source-confirmed structure. Selected state, keyboard traversal, focus after part replacement and screen-reader behavior need native checks. | NOT RUN |
| PC/NPC native form configuration, shared [form pipeline](../../src/ui/sheets/v2/shared/form-pipeline.js) and [form queue](../../src/ui/sheets/v2/shared/sheet-runtime-helpers.js) define allow-listed intent, serialization and close/flush paths. | Source-confirmed owners. Rapid editing, unrelated resource updates, errors and close cancellation can only be established natively. No form normalization change is made. | NOT RUN |
| Item `_preClose` / `close` includes existing interrupted-purchase skip-submit behavior. | Source-confirmed route, not proof of native cancellation or persistence. Preserve Task 02's durable record when a sheet closes. | NOT RUN |
| Shared render queue and PC/NPC/Item lifecycle keep focus/selection/scroll state and have cleanup/revision controls. | Source-confirmed implementation; native close/render races and visual stability remain unknown. Task 05/11 own measurement and cleanup cases. | NOT RUN |
| [System tooltips](../../src/ui/shared/system-tooltips.js) and [inline rules help](../../src/ui/sheets/v2/shared/sheet-tooltips.js) centralize tooltip/help binding and preserve existing tooltip attributes. | Source-confirmed ownership and focus-related binding. Mouse appearance is not equivalent to keyboard, touch or screen-reader access. Do not add another tooltip system to address an unverified gap. | NOT RUN |
| [DialogV2 helper](../../src/utils/dialog-v2-helper.js), [enhancements](../../src/utils/dialog-v2/enhancements.js) and current dialog templates provide shared rendering and preference-gated focus/keyboard handling. | Source-confirmed route. Enter/Escape/default/cancel behavior, rich-text interaction, focus return and repeated listeners require checks with the preference enabled and disabled. | NOT RUN |
| Existing settings and sheet styles define scroll owners, resizable windows and dense list controls. Earlier UI-polish records describe specific source changes. | Source-confirmed layout rules; contrast, zoom, overflow, touch target size and absence of infinite growth are unmeasured. Historical captures are not Task 12 native acceptance. | NOT RUN |
| Build validation checks semantic controls, explicit button types, accessible names/localization references and AppV2 part/form safeguards. | Static coverage only; it cannot establish a computed accessibility tree, dynamic label state, native focus behavior or compliance certification. | NOT RUN |

No native defect or accessibility conformance is claimed. Potential risks include focus loss during part replacement, tooltip-only information, insufficient computed labels/state, contrast/overflow under selected themes/fonts, and interrupted submit/close behavior. They require reproduction before a targeted single-surface correction. Templates, CSS, localization, controls, listeners and AppV2 lifecycle code are unchanged.

## Compatibility ledger - no native combination verified

| Environment / integration | Source context | Exact installed version/build | Observed behavior / result |
| --- | --- | --- | --- |
| Native Foundry with no external modules | Current manifest retains verified 14.368; future procedure targets a copied v14.369+ v14 world. This task does not extend that declaration. | Not inspected | NOT RUN |
| Dice So Nice | [Dice visualization owner](../../src/utils/dice-visualization.js) detects the existing dice API, carries source visibility and returns without making animation a gameplay completion barrier; additional alchemy/warfare routes exist. | Not inspected | NOT RUN |
| Token Action HUD | [System adapter](../../src/integrations/token-action-hud/api.js) delegates to existing sheet/domain handlers and Task 09 results. Presence of this adapter does not identify an installed HUD package or prove its external contract. | Not inspected | NOT RUN |
| Relevant chat module | No module selected or inspected in a native world. Select only an actually installed, relevant package and record its ID/version when testing. | Unknown | NOT RUN |
| Relevant Active Effect module | No module selected or inspected in a native world. Existing Actor/effect authority, duration and transfer owners remain. | Unknown | NOT RUN |
| Recorded combined module subset | Repeat only after isolated baseline and individual integrations are recorded. | Not selected | NOT RUN |

No installed-module inventory was collected, package installed, third-party API certified or global/private hook patched. The official Foundry API establishes core contracts; it does not verify a third-party interface merely because a feature works in source. If a module requires unsupported/private core behavior, record that limitation with evidence instead of replacing core internals.

## Future native procedure - every case NOT RUN

1. Use a stopped, coherent copied-world backup and a disposable **Foundry v14.369+** v14 instance. Record exact core/system/source/browser/OS versions, user role, scene/Token context, module IDs/versions, diagnostics, theme/font/zoom, viewport and input/assistive devices. Use sanitized fixtures from the testing guide. Do not collect private world data or alter the live campaign to obtain a report.
2. Establish the no-external-module baseline first. Use a GM, owner player and limited/non-owner perspective, a PC, NPC, representative Item, linked Token and two supported unlinked Tokens. Record unavailable devices/modules as NOT RUN; do not turn a planned row into a supported-platform claim.
3. For each PC/NPC/Item surface and representative DialogV2 prompt, use keyboard only: enter/leave controls, navigate tabs, activate actions and help, submit/cancel and return focus. Repeat rapid editing, targeted re-render, validation/write failure, close/reopen and concurrent updates. Check stored values, unsaved input, selection and scroll against expected source-backed behavior. Test dialog keyboard preferences both ways.
4. Record screen-reader/browser versions and inspect computed names/roles/states, labels, expanded/selected state, help and error announcements. Native labels must reflect the actual current control. Repeat pointer and touch where available, narrow/wide layouts and zoom. Check contrast and overflow from actual rendered styles. A source attribute or a historical screenshot is not a passing observation.
5. Inspect the existing diagnostics in their authorized context without invoking repair APIs. Compare read-only inspection with settings-changing actions. Collect only needed facts; manually redact copied text/screenshots and inspect their final contents for identifiers, private notes/chat, paths, server information and secrets. No automated-export privacy pass can be recorded until an exporter is separately implemented and tested.
6. Repeat the same gameplay cases with actually installed relevant Dice So Nice, HUD, chat and effect modules individually, then the recorded combined subset: activate an Item, perform an opposed roll, apply damage/healing, open/update/submit/close a sheet, use a chat action, import an Item and advance a real combat boundary. Compare source/receipts and visibility, including whisper/blind modes, and inspect interrupted work before retrying. Preserve native APIs; record module-specific failures rather than silently patch core behavior.
7. Reuse the canonical task scenarios below; avoid another mechanics calculator or Foundry simulator. Record exact reproduction and anonymous evidence. After stateful tests, stop clients/processors and restore coherent matching world documents/settings. Do not lower migration markers or erase receipts to undo a run.

| Case | Required invariant / evidence | Result |
| --- | --- | --- |
| A11Y-KEYBOARD | PC/NPC/Item, tabs, help and dialogs are reachable/operable; default/cancel actions and focus return retain existing rules. | NOT RUN |
| A11Y-ANNOUNCEMENT | Computed labels, roles, selected/expanded state, help and failures are meaningful in the recorded screen reader/browser. | NOT RUN |
| A11Y-INPUT | Rapid edit, partial/full render, rejected save, concurrent resource update and close/reopen preserve intended values and unsaved-state handling. | NOT RUN |
| A11Y-LAYOUT | Narrow/wide panes, resize, zoom, fonts/themes, dense lists and available pointer/touch input do not break scroll or obscure controls. | NOT RUN |
| A11Y-PERMISSIONS | GM/owner/limited/non-owner views, linked/unlinked identity and private content boundaries remain correct. | NOT RUN |
| DIAG-ACCESS | Existing GM menu restrictions, world/client scope, read-only versus mutating helpers and disabled diagnostic behavior match actual access. | NOT RUN |
| DIAG-REDACTION | Manually prepared evidence is reviewed for private data and retains useful reproduction context. No new exporter/file is implied. | NOT RUN |
| EXPORT-PRIVACY | Future exporter requires a separate implementation, deterministic privacy tests, role checks, actual output inspection and no collection writes. | NOT RUN; deferred |
| MODULE-BASE | Exact native build, no external modules, representative gameplay and persistence. | NOT RUN |
| MODULE-INDIVIDUAL / COMBINED | Exact installed module IDs/versions, isolated/combined cases, visibility, authority, results and reproducible failures. | NOT RUN |
| REGRESSION | Existing ranks, purchases, migration truth, special recovery, explanations and result companions retain their canonical behavior. | NOT RUN |

Canonical references: [Task 01 ranks](01-skill-rank.md#reproducible-live-acceptance---all-not-run), [Task 02 purchases](02-xp-purchases.md#reproducible-live-acceptance---every-case-not-run), [Task 04 recovery](04-special-action-idempotency.md#reproducible-live-acceptance---every-case-not-run), [Task 06 migrations](06-migration-readiness.md#reproducible-live-acceptance---every-case-not-run), [Task 08 explanations/privacy](08-explainable-combat-calculations.md#native-acceptance-procedure---every-case-not-run), [Task 09 results](09-action-result-contracts.md#native-acceptance---every-case-not-run), [Task 05 sheet procedure](05-appv2-sheet-performance.md#future-benchmark-procedure---not-executed) and [Task 11 startup/refresh procedure](11-startup-combat-event-performance.md#future-native-benchmark-procedure---every-case-not-run). Native submit/close and coherent restoration remain in the [testing guide](../testing.md).

Use `Case | exact environment/module versions | role/document context | action | expected invariant | observed source/UI/assistive result | PASS/FAIL/NOT RUN | redacted evidence/restore reference`. Unknown module/API behavior and absent devices remain unknown/unexecuted, not compatible or inaccessible by assumption.

## Official API references and findings

| Official v14 entry | Classification / relevance |
| --- | --- |
| [ApplicationV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html), [form configuration](https://foundryvtt.com/api/v14/interfaces/foundry.applications.types.ApplicationFormConfiguration.html), [DialogV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DialogV2.html) | Public architecture, form options and dialog APIs used by current surfaces. A supported framework is not accessibility or runtime certification. |
| [ApplicationV2._preClose](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#_preclose), [_onClose](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#_onclose) | Documented protected overrides. Pre-close is awaited; post-close work is not awaited by the close operation. Native tests must follow normal controls and existing cancellation paths. |
| [ClientSettings](https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html), [registerMenu](https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html#registermenu) | Public settings/menu APIs. Scope distinguishes storage/effect; `restricted: true` is documented for GM-only menus. Setting writes are separate from reading diagnostic metadata. |
| [Document.canUserModify](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html#canusermodify), [ChatMessage.isContentVisible](https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html#iscontentvisible) | Public modification and current-user content visibility interfaces. UI hiding, role labels or model schemas do not substitute for native/domain checks. |
| [TypeDataModel](https://foundryvtt.com/api/v14/classes/foundry.abstract.TypeDataModel.html), [Hooks](https://foundryvtt.com/api/v14/classes/foundry.helpers.Hooks.html) | Public model and hook architecture. Existing owners are reused in documentation; no new registration, lifecycle hook, model or API is added. |

| ID | Classification | Finding / disposition |
| --- | --- | --- |
| T12-D1 | Source-confirmed documentation defect | Testing guide's seven-file statement conflicted with the eight current unit files/rows. Corrected to eight; test results were not rerun or reinterpreted. |
| T12-D2 | Source-confirmed reporting instructions | Template demanded upgrades and raw console screenshots and asserted a blanket browser constraint without a version-specific Task 12 test. Replaced with exact-environment capture and redacted evidence, preserving metadata and making no new compatibility claim. |
| T12-S1 | Source-confirmed behavior | Canonical domain/UI/diagnostic owners already exist. Handbook links them; no duplicate helper, logger, collector or support framework is introduced. |
| T12-R1 | Potential privacy risk | Raw snapshots and timing/context exports may disclose identity/private configuration. Future export needs field selection, permission review and output testing; no leak reproduction or exporter privacy pass claimed. |
| T12-R2 | Potential usability risk | Dynamic part replacement, dialog shortcuts, tooltip access and close/submit semantics need native focus/label/input checks before a targeted fix. Source audit alone does not demonstrate a regression or compliance. |
| T12-U1 | Unknown | Exact installed module/browser/assistive behavior and combined compatibility. All native rows remain NOT RUN. |

## Validation, preservation and rollback

| Check | Result | Exit / duration |
| --- | --- | --- |
| Task 11 baseline comparison | PASS: 993 files match, no missing/extra inventoried files. | SHA-256 inspection |
| Original documentation backup | PASS: all three originals copied and hashes verified before edits. | Recorded in `baseline.json` |
| `npm run validate` | PASS locally: 803 JavaScript syntax checks, reference checks for 795 JavaScript files / 105 templates, 31 Markdown documents, source/ownership safeguards, existing schema/catalog consistency and 21 centralized revisions. | Exit **0**; **44,333.248 ms** |
| Unit suite / standalone lint, syntax, schema, catalog commands | NOT RUN for documentation-only scope. Historical 313 tests remain Task 09 evidence. | Not rerun |
| Foundry privacy/accessibility/module tests, runtime/performance and remote CI | NOT RUN. | No native or remote execution claimed |
| Final five-file scope / metadata / links | PASS: **990 baseline files unchanged**, exactly three original documents changed and two documents added, zero missing/unexpected changes; **995** final inventory entries. Bug-template front matter is byte-identical; README's protected preamble is preserved. All 132 local links / 25 heading references checked successfully. | SHA-256 inventory and scope proof |

The full local command log and metadata are retained as `validate.log` and `validate.result.json` in the ignored backup. The import graph remains 784 runtime modules / 4,037 static or literal-dynamic edges, with 778 reachable modules, 7,213 checked bindings and 210 literal/computed dynamic imports. The **25 existing module-binding coverage-limit notices are unchanged** from Task 11 after line-number normalization. They identify dynamic-import promises, escaping namespaces and computed member access outside static export checks; they are limitations, not validation failures.

Final `post-change.sha256.json`, `preservation-proof.json` and `validation-ledger.json` preserve the inventory, original-file hashes, five-file boundary, eight-suite-file count, template/README preservation checks, local link/fragment checks and observed command evidence. Production, schemas, workflows, manifests, generated artifacts, tests and all prior reports retain their baseline hashes. The issue template's front matter and links were checked separately because the source validator's documentation scan covers README and `docs/`, not `.github/ISSUE_TEMPLATE/`.

Source validation checks checked-in syntax/references/ownership, documentation paths, schema/catalog consistency and packaging/CI policy; it does not run Foundry or certify native permissions, accessibility, privacy, module interoperability, recovery or performance. Existing static import/export coverage notices must be reported separately from failures. Local documentation path validation does not establish remote availability, fragment correctness or historical statements' ongoing applicability; these need appropriate separate inspection.

Inventory scope matches Task 11: root development files plus `.github`, `automation`, `docs`, `lang`, `scripts`, `src`, `styles`, `templates`, `tests`; ignored backups/build/dependencies and binary asset/pack trees are excluded. No binary/LevelDB inspection is represented. All content changes are limited to README, the testing guide, bug-report template, new handbook and this report. Production, schemas, workflows, manifests, generated artifacts, tests and prior reports are preserved.

Rollback restores the three originals from `release/backups/task-12-supportability-docs-20261025-170749/source/` and removes only `docs/architecture.md` and `docs/task-reports/12-supportability-accessibility.md`. Verify original hashes and template front matter. Preserve later documentation edits rather than overwrite them if work continues. Ignored inventories/logs remain available for review.

No world restoration is needed for this documentation-only update. Future stateful tests require a coherent copied-world backup and restoration under the existing procedures. No exporter, telemetry, error collector, UI behavior, test/fixture infrastructure, dependency, migration, release artifact, version bump, compatibility declaration, publishing, deployment or Task 13 work is included.

Documentation complete; diagnostic export, native accessibility testing and module verification deferred.
