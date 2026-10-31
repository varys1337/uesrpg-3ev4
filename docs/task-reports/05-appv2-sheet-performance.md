# Task 05 - AppV2 sheet performance audit only

**Date:** 25 October 2026.  
**Result:** Audit complete; measured optimization deferred.  
**Scope:** source audit, measurement procedure and documentation. Production code and instrumentation are unchanged. The broader Task 05 performance objective remains pending.

## Baseline and evidence boundaries

| Field | Evidence |
| --- | --- |
| Workspace | `C:/dev/uesrpg/uesrpg-3ev4-14.0.0` |
| System/package | `14.2.0`; compatibility minimum/verified `14.368`, maximum `14`; unchanged |
| Branch / commit | Unavailable: `git rev-parse --show-toplevel` reports that this checkout is not a repository. No branch, commit or PR created. |
| Node | `v24.13.0`, Windows |
| Preserved baseline | All **980** entries in Task 04's final SHA-256 manifest matched before this audit. |
| Task 05 backup | Ignored `release/backups/task-05-appv2-sheet-audit-20261024-222154/`; `source/docs/testing.md`, `pre-change.sha256.json` and `baseline.json` preserved before editing. Directory timestamp is UTC; the report date uses the user's local date. |
| Historical tests | Task 04 recorded 151 passing Node tests in ten suites, zero failures/skips/TODOs. This audit does not rerun or extend them. |
| Runtime environment | No Foundry world, client, setting, document or fixture was changed or benchmarked. All runtime cases and performance values are **NOT RUN**. |

The approved **audit-only** plan supersedes the bundle's proposed optimization work for this task. Reading its implementation contract does not authorize installing a system, launching a world, changing settings, generating fixtures or patching production code. No bottleneck or speedup has been demonstrated through live measurements.

Findings below use three classifications: **source-confirmed** describes inspected code; **potential risk** identifies a dependency or correctness question without reproducing a defect; **unmeasured candidate** describes a possible later experiment. None means runtime acceptance. The prior [Task 04 report](04-special-action-idempotency.md) and [testing guide](../testing.md) retain their own evidence boundaries.

## Sheet architecture and canonical ownership

The five sheet classes already use `HandlebarsApplicationMixin` with AppV2 sheet bases. No migration or replacement render framework is proposed. Source inspection covered their imports, shared preparation/signature/form/render helpers, derived cache and invalidation hooks, combat refresh subscriptions, settings, profiling support and existing acceptance documentation.

| Surface / source owner | Preparation and partial-render behavior | Lifecycle and cleanup |
| --- | --- | --- |
| [PC Actor sheet](../../src/ui/sheets/v2/actor-sheet.js) | Builds a lightweight Actor view and localized choices, then returns early for limited viewers. Requested parts gate inventory grouping, combat, wounds, biography, effects and diagnostics. Inventory views are fresh even when structural grouping is reused. | Shared form/render queues; per-part listeners; `_onRender` handles part-dependent DOM work. Close clears seven sheet caches, queued work, filters/tooltips, resize guard and tracker subscriptions. |
| [NPC sheet](../../src/ui/sheets/v2/npc-sheet.js) | Same shared signatures and structural grouping strategy, with NPC presentation options and its own instance caches. Biography enrichment has its own front cache. | Same queue/tracker/cleanup owners as PC; no cross-sheet cache instance is intentionally shared. |
| [Item sheet](../../src/ui/sheets/v2/item-sheet.js) | Builds/sanitizes a document snapshot. `body` requests use full Item preparation; header/tab-only requests use header preparation and skip body enrichment, effect preparation and linked-spell resolution. Owned containers rebuild contents from embedded Items. | Its native pre/post-render snapshots use UI/render revisions so newer navigation wins over stale restoration. Per-part listeners; queued normalized form writes and submit-before-close. The existing skip-submit close path remains. Close clears snapshots, tab-scroll positions, tooltips and form state. |
| [Group sheet](../../src/ui/sheets/v2/group-sheet.js) | Part scope gates member resolution and core rich text. Member rows cache permission-gated summaries. The limited template path has its own enriched description. | Member Actor updates and owned-Item lifecycle events clear member resolution and queue relevant parts. Close removes member hooks and clears member, filter, queue and form state. |
| [Warfare Unit sheet](../../src/ui/sheets/v2/warfare-unit-sheet.js) | Part scope gates sidebar, core, actions, equipment, magic and effects. Uses existing profile/derived system values, a commander summary cache and rich-text cache. Limited preparation returns before commander/action/equipment/magic/effect builders. | A commander Actor-update hook clears the summary and queues sidebar rendering. Close removes that hook, clears the commander summary and render/form queue state. |

The [shared presentation builders](../../src/ui/sheets/v2/shared/sheet-context.js) preserve the Actor's live `system` reference. Individual Item presentation views shallow-copy `system`, allowing annotations without changing Item source through that copy. [Structural grouping](../../src/ui/sheets/sheet-prepare-items.js) stores Item IDs and group structure, restores against newly built views, checks membership and reapplies presentation work. This is already present; reintroducing a second grouping cache would duplicate ownership. These observations do not prove that every prepare path is free of in-memory annotations or stale derived values.

[Part scope and health narrowing](../../src/ui/sheets/v2/shared/part-context.js) are separate concerns. A partial scope requires a nonempty requested subset smaller than the configured part count. Automatic health narrowing is conservative: only already-rendered, unforced, nonlimited Actor sheets; no explicit parts; an Actor update containing supported HP fields and optional receipt fields only; and no currently applicable effect from `allApplicableEffects()`. Otherwise it retains the broader render. Do not assume every HP update is partial.

The [shared runtime helpers](../../src/ui/sheets/v2/shared/sheet-runtime-helpers.js) own one per-sheet render queue and one per-sheet form queue. Render requests union their parts, drain through the existing animation-frame scheduler, serialize in-flight rendering and fall back to full rendering after a partial failure. UI state restoration respects Item sheets' own lifecycle. Form writes serialize, retain/report errors, and expose flushing before close. Queue cancellation is cleanup, not evidence that a previously started document write was canceled. The [form pipeline](../../src/ui/sheets/v2/shared/form-pipeline.js) and each sheet's existing normalizers/allow-lists remain the submit owners.

## Cache inputs, consumers and invalidation

The following is a source dependency map, not a proposed replacement key format. A revision key cannot safely replace an explicit signature until all its dependencies, including time/user/settings inputs, have equivalent invalidation.

| Cache / owner | Inputs or key | Consumer / parts | Refresh or lifetime |
| --- | --- | --- | --- |
| PC/NPC `_uesrpgItemsCache` | Actor ID/type, structural inventory revision, religion setting; cached Item membership/IDs and group shape | Fresh Item views for core/combat/magic/equipment grouping | Structural revision changes or membership mismatch rebuild; close clears cache. Cosmetic Item updates currently bump the structural revision too. |
| PC/NPC `_uesrpgCombatCache` | Broad Item signature, effects signature; tracker document/owner/token/combatant identity and authority; AP, attack/reset/weapon-use state and overrides; combat ID/round/turn; fatigue/wound/carry penalties, In Close and active style | Combat quick/actions, wound manager and attack tracker | Signature mismatch or explicit tracker refresh clears/rebuilds; close clears. Combat and token context must remain in any future key. |
| PC/NPC `_uesrpgWoundsUiCache` | Serialized wounds, injuries, shock and relevant wound-effect IDs, disabled/name/progress/damage/treatment/shock/maiming fields | Combat wound/injury panel | Signature evaluated when combat is needed; changed values rebuild; close clears. |
| PC/NPC `_uesrpgEffectsCache` | Effect count and GM/player view; each effect's identity, disabled/transfer status, change count, remaining/value/expired duration, name/image, temporary status and canonical/legacy flags | Effects and magic views, excluding wound/shock rows | Signature mismatch rebuilds; duration-dependent values are sampled on preparation; close clears. Time can matter without an explicit effect edit. |
| PC/NPC `_uesrpgSheetUiCache` | Actor ID, loadout/diagnostics settings and Actor loadout flags | Sidebar/core UI state | Signature mismatch rebuilds; close clears. Search, encumbrance and some diagnostic presentation values are also refreshed outside this cached result. |
| PC/NPC `_uesrpgEncumbranceCache` | Broad Item signature using sheet revision | Equipment highlights and encumbrance breakdown when enabled | Signature mismatch rebuilds and fresh views receive annotations; close clears. |
| PC/NPC `_uesrpgBioCache` | Raw biography text | Core biography; limited path uses existing enrichment helper | Raw change rebuilds; front cache cleared on close. Shared enrichment has a separate lifetime below. |
| `cachedEnrichHTML` | WeakMap per owner, cache label and exact raw text | PC/NPC biography, Item description, group and warfare descriptions/notes | Raw text change or owner garbage collection. The audited close paths do not explicitly clear this shared WeakMap. User/language/link-target state is not part of its key. |
| Group `#resolvedMembersCache` | Member IDs, stored names/images and sort order | Sidebar/body/limited member summaries, including permission-gated resource snapshots | Member-list signature mismatch; linked Actor updates except receipt-only updates; owned-Item create/update/delete; close. Own installed hooks do not directly include effect lifecycle or Actor deletion. |
| Warfare `_uesrpgCommanderCache` | Commander UUID | Sidebar name/image/type summary | UUID change, matching commander Actor update except receipt-only updates, or close. Missing resolution can also be cached. |
| Actor Item aggregation | Per Actor, keyed additionally by `Boolean(game.combat.started)`; owned Item equipment, container/encumbrance, feature configuration and passive bonus inputs | Actor characteristic/resource/resistance/movement preparation and downstream displays | Item lifecycle invalidates the items lane; combat-start state mismatch rebuilds. `_aggCache` is a legacy alias of the same owner. |
| Actor applicable effects | Per Actor effect collection, including enabled/applicable Actor and transferred Item effects under existing collection rules | AE numeric aggregation and other applicability consumers | AE lane invalidation clears applicability and totals together; owned Item/effect lifecycle and equipped-weapon changes use this lane. `_aeApplicableCache` remains an alias. |
| Actor AE totals | Per Actor map of the existing known Actor-prepare change keys, based on the cached applicable collection | Characteristic/resource/resistance and skill-related modifier consumers | AE lane invalidation; `_aeTotalsMap` alias remains. No independent time/user signature is introduced. |
| Actor prepare context | Per Actor Item references, type buckets, equipment/talent indexes and selected movement/fatigue/wound/form/shield feature flags | `_getPrepareCtx()` and Actor rule preparation helpers | Prepare lane invalidation on Item/effect lifecycle; `_uesrpgPrepareCtx` remains an alias. This Item-index context is not a cached copy of finalized characteristic values. |
| Settings snapshot | Existing registered hot setting names, client-local snapshot of settings | Selected render/prepare builders; other keys fall back to live reads | Ready initialization and existing setting-change invalidation callbacks. Diagnostics remain live-read in their debug owners. |

Canonical definitions: [sheet signatures](../../src/ui/sheets/v2/shared/sheet-signatures.js), [derived cache](../../src/core/actors/derived-cache/actor-derived-cache.js), [invalidation hooks](../../src/hooks/init/register-actor-derived-cache-invalidation.js), [enrichment cache](../../src/utils/enrich-cache.js), [settings cache](../../src/core/config/settings-cache.js).

The central invalidation hook map is source-confirmed:

| Event / data | Sheet revision | Structural inventory revision | Derived lanes explicitly invalidated here |
| --- | --- | --- | --- |
| Owned Item create/update/delete | Increment | Increment | Items, AE applicability/totals, prepare context |
| Actor or owned-Item ActiveEffect create/delete and ordinary update | Increment | Increment | AE applicability/totals and prepare context |
| Effect update identified as over-time tick bookkeeping only | Increment | Unchanged | None in this hook branch |
| Actor update containing only supported resource paths | Increment | Unchanged | None in this branch; equipped-weapon changes are outside the resource-only set |
| Other Actor update | Increment | Increment | Equipped-weapon changes explicitly invalidate AE applicability/totals |
| Actor damage-receipt-only update | Unchanged | Unchanged | None in this hook branch |

Supported resource-only paths are HP and both temporary-HP paths, magicka, stamina, Luck, AP value and the receipt flag. This is a specific allow-list: fatigue level and unrelated Actor changes do not automatically qualify. The table does not claim that these hooks are the only native or system preparation triggers.

[Combat tracker refresh](../../src/ui/sheets/v2/shared/combat-tracker-refresh.js) separately listens for matching tracker changes and post-combat-time notifications. It resolves the sheet's Actor/token/combatant context, clears the combat cache and queues the combat part; registration is guarded and removed on close. Sheet density, search visibility, religion/loadouts, feature inspection and encumbrance settings have distinct readers; a cache audit must not assume one settings revision covers all of them.

[Actor preparation](../../src/core/documents/actor.js) calls the appropriate PC/NPC/group/warfare prepare path. For PCs/NPCs, `_recomputeItemTNs()` follows finalized Actor characteristics, revisiting the three TN-bearing Item types. Its documented source purpose is ordering correctness after initial embedded preparation. The derived cache supplies prepare context, aggregate Item data and AE totals to those calculations. No evidence in this audit justifies removing that pass or changing preparation order.

## Official v14 API verification

The audit uses official v14 documentation as API authority. No API calls or overrides were added.

| API | Documented classification / use in audit |
| --- | --- |
| [ApplicationV2.render](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#render) | Public, returns a Promise resolving to the rendered application; useful for render-call timing, not a general browser-paint metric. |
| [ApplicationV2 lifecycle](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html) | `_prepareContext`, `_preRender`, `_onRender`, `_onChangeForm`, `_onSubmitForm`, `_preClose` and `_onClose` are documented protected subclass lifecycle methods. The report inspects their existing overrides, not calls them as public controls. |
| [HandlebarsApplication](https://foundryvtt.com/api/v14/classes/foundry.HandlebarsApplication.html) | `PARTS` supports partial rendering; `_configureRenderParts`, `_preparePartContext` and `_attachPartListeners` are protected subclass extension points. |
| [Rendered AppV2 registry](https://foundryvtt.com/api/v14/variables/foundry.applications.instances.html) | Public `foundry.applications.instances` Map, used by the existing benchmark to discover rendered sheets. |

Public/protected classification does not prove that each existing subclass uses every lifecycle correctly at runtime. No private/internal hook, replacement scheduler or unsupported compatibility assumption is needed for this documentation patch.

## Existing diagnostics and measurement gaps

Canonical owners are [performance tracker](../../src/utils/perf-tracker.js), [record/export support](../../src/utils/perf-tracker-support.js), shared runtime helpers and [debug traces](../../src/utils/debug.js). They already exist and are unchanged.

| Measure | Available source evidence | Limit / interpretation |
| --- | --- | --- |
| PC/NPC context and DOM work | Structured `sheet.render.*` lifecycle/phase records; item/combat/wound/effect/UI/encumbrance cache hit/miss phases, skips and selected sizes; parent and remaining preparation; some DOM/listener timings | Signature calls are included within larger phases or lazy dependencies, not independent signature spans. Nested spans cannot be added as disjoint totals. A hit rate must count only hit/miss decisions for the same cache; exclude skipped/disabled phases. |
| Item preparation/rendering | Structured overall `_prepareContext` and `_onRender`, lightweight counters/tab details | No equivalent per-signature or per-body-builder breakdown. Snapshot/sanitization still occurs before body/header branching. |
| Group sheet | Its own `sheetPerfTrace` console lifecycle timings | Its trace method does not publish the same structured events to the shared ring buffer. No PC/NPC-equivalent member cache hit/miss phase series. |
| Warfare sheet | Source part gates and commander cache | No equivalent sheet lifecycle/phase timing calls in the audited class. Missing events are not zero latency. |
| Full versus partial work | Requested-part details in PC/NPC lifecycle records and existing queue/fallback source | An inventory tab change is not necessarily an inventory render. Record actual rendered parts and any full fallback. No universal physical-paint or render-coalescing counter is supplied. |
| Writes | Shared authority-proxy attempts/confirmed results, embedded batches, receipt and card persistence events where routed through those owners | Layered phase/proxy spans can describe the same physical update. Other native or module paths may not be counted. Zero recorded writes does not prove zero writes. |
| Visible update | Existing `<kind>.visibleHP` probe after confirmed health commitment, a visible matching HP input and two animation frames; includes after-commit timing and optional outcome correlation | Specific to eligible health operations and rendered HP controls. It is not generic click-to-paint, all resources, all sheets, or proof of browser compositing. Closed/hidden/unchanged/superseded cases may yield no sample. |
| General render-call benchmark | `game.uesrpg.perf.runSheetBenchmark(n)` | Measures elapsed awaited `app.render()` calls for one open sheet per recognized class: `player-character`, `npc`, `item`. It does not select all instances or group/warfare sheets, open cold sheets, drive updates, request target parts, retain raw elapsed trials, or establish visible latency. |
| Exports | Per-client ring buffer of **500 records**; `exportBatch({after, limit})` defaults to 100 and caps each batch at 200; exposes `nextCursor`, `hasMore`, `overwritten` | More events overwrite earlier records. Export promptly in short batches and check loss. A twenty-render run can exceed capacity. Do not combine clocks from separate clients or treat exported gaps as no activity. |

`timePerformanceDebug` enables structured recording independently of the debug master gate. `sheetPerfTrace` enables the sheets' console traces; `perfDebug` is a different diagnostic lane. `game.uesrpg.perf.console(false)` suppresses the tracker's console output, not every independent sheet trace. Record all switches and keep them identical on comparison sides. Traces can contain document names/UUIDs; use sanitized fixtures and review exports before sharing.

## Potential risks and unmeasured candidates

| Classification / ID | Source basis | Required follow-up; no production change here |
| --- | --- | --- |
| Potential risk R1: time-dependent effects | Effect signatures currently inspect remaining/expired/temporary duration on render, not just revision counters | A revision-only replacement must account for time and applicability without assuming an effect update fires. Verify expiry, turn progression and transferred effects in a real world. |
| Potential risk R2: group summary refresh | Group cache snapshots member resources and permissions; its own hooks cover Actor updates and Item lifecycle but not effect lifecycle or Actor deletion directly | Test member AE edits, derived changes, deletion and permission changes; determine whether other system/native routes refresh the group. This is a suspected refresh gap, not a reproduced stale-data defect. Any correction is separate work. |
| Potential risk R3: enrichment dependencies | Shared enrichment key includes raw text and owner, not user role, language or referenced document changes; close does not explicitly evict it | Test unchanged text with changed relevant enrichment context. Do not declare a privacy or stale-link defect without reproduction; any corrective invalidation change needs separate authorization. |
| Unmeasured candidate A: signature serialization | Effects/wounds/UI signatures serialize selected state, including flags | Profile each signature on the heavy fixture and map every dependency before considering a revision key. Serialization in source alone is not evidence of material latency. |
| Unmeasured candidate B: presentation reuse | Structural grouping is already reused against fresh Item views; annotations and bonuses are reapplied | Measure view construction and presentation separately. Avoid caching live derived values or creating another grouping owner. |
| Unmeasured candidate C: part-scoped work | Existing gates skip builders, but common Actor setup and Item snapshot/sanitization remain | Measure actual builder counts/costs for each requested part and verify cross-part consumers. Do not infer a benefit from fewer source lines. |
| Unmeasured candidate D: derived pass | PC/NPC TN recomputation intentionally follows finalized characteristics | Profile preparation independently from rendering and preserve ordering. No repeated-work defect has been demonstrated. |
| Unmeasured candidate E: render coalescing | Existing queue unions parts and has full fallback/UI restoration | Measure requested versus completed renders, focus and writes before changing the canonical queue. No second animation-frame scheduler. |

There is no measured basis to rank these candidates by user-visible benefit. No optimization or suspected-defect fix is shipped. The selected audit scope is complete; the optimization decision remains gated on matched measurements and correctness parity.

## Future benchmark procedure - not executed

### Environment and fixtures

Use a stopped, complete copied-world backup and a disposable Foundry **v14.369+** instance. Record exact core/system snapshots, client role, browser/OS/hardware, window size, display scaling, open tabs/sheets, relevant settings, module list and fixture exports/hashes. Keep external modules disabled for the first comparison, then repeat an explicitly recorded module subset. Restore a consistent fixture state for every matched action; respect linked versus synthetic Actor UUIDs.

Use generated/sanitized data only:

| Fixture | Required contents |
| --- | --- |
| FX-PC-BASIC | Ordinary skills/magic/combat style, armor/shield, moderate inventory, known resources and representative descriptions |
| FX-PC-HEAVY | At least 150 owned Items, at least 20 ActiveEffects, wounds/injuries and at least ten magic Items; record actual counts and description sizes |
| FX-NPC | Creature and armor coverage, effects and representative proficiency/training |
| FX-ITEM | Advancement Item plus representative body-heavy/container/linked-spell variants where applicable; owned and world Item cases |
| Supporting contexts | GM, owner and limited/non-owner; linked token and two independent unlinked tokens; group/member and warfare/commander references for correctness coverage |

No new fixture generator is part of this task. Use existing supported controls and fixture procedures in the testing guide. Obtain project-approved improvement criteria **before** any later optimization experiment; no arbitrary speedup threshold is selected by this audit.

### Collection sequence

1. Record the original diagnostic switch values. In the disposable world only, enable the existing recording lane and choose the same sheet-console trace setting on both snapshots. Use the existing `game.uesrpg.perf.console(false)` while collecting and restore the agreed prior diagnostic state afterward. None of these settings was changed during this audit.
2. Measure **cold first-open** separately: after a fresh client reload, open the named fixture's sheet for the first time. Record browser asset-cache conditions; this definition is an application/client cold state, not an assertion that disk/network caches are empty. Capture the browser timeline and existing traces. Reopen-only timings are a separate category. Repeat cold trials with a reload for each trial; record sample count and do not calculate a useful tail percentile from one observation.
3. For **warmed full render-call summaries**, keep only the intended fixture open in each supported class so registry ordering cannot select a different PC/Item. Run `await game.uesrpg.perf.runSheetBenchmark(3)` for three warm-ups, reset recording, then run `await game.uesrpg.perf.runSheetBenchmark(20)` for twenty measured calls. Preserve the returned count/median/p95/min/max with fixture and client metadata. Do not call `perf.runBenchmark`: that different helper advances combat turns.
4. Collect **phase/cache/write traces** in a separately labeled pass using twenty matched ordinary render/update trials, with three warm-ups per scenario. Export between short groups of trials, using `exportBatch`, following `hasMore`/`nextCursor` until drained. Preserve raw records outside the client buffer and check `overwritten`. Reset only after the preceding records are safely retained. A full twenty-call benchmark summary remains valid as its own render-call summary even if detailed traces overrun, but incomplete phase data cannot support hit rates or counts. Do not average batch medians/p95s into a twenty-trial percentile; summarize complete raw records for the same metric or report the metric unavailable.
5. For **targeted updates**, use normal resource, equip, effect and inventory controls, recording the expected native write and actual rendered parts. Include HP with/without applicable effects, equipment changes, AE create/update/delete, and inventory-tab use. Separate tab navigation, a direct part refresh and a document-driven update. Test magicka/AP/fatigue as correctness cases even where they retain a full render.
6. For **visible update latency**, use a browser performance recording of the same action and correlate supported existing health probes where available. Label the actual start/end boundary. Where existing coverage cannot identify the visible boundary, leave that metric NOT RUN/unavailable; do not substitute `_prepareContext`, `_onRender` or awaited-render duration for it. This audit adds no probe or monkeypatch.
7. Keep failures, canceled writes, full fallbacks and missing samples as separate outcomes. Compare the same metric, fixture state, client role, settings and source snapshot. Do not sum nested spans or subtract clocks from different clients. Recheck source/UI correctness and document-write expectations before interpreting a timing difference.
8. Any later candidate must be independently backed up, patched in its canonical owner, remeasured against the unchanged baseline, and reverted if improvement is within observed variance or any correctness regression appears. This is a future gate, not authorization to patch during this audit.

### Runtime worksheet - every result NOT RUN

This table intentionally contains no measured duration, hit rate or write/render count.

| Scenario | Required observations | Baseline median / p95 | Candidate median / p95 | Status |
| --- | --- | --- | --- | --- |
| PERF-COLD, each basic/heavy PC, NPC and Item | First-open boundary, client reload, cache conditions, source context/DOM trace and visible boundary where measurable | NOT RUN | NOT RUN | NOT RUN |
| PERF-FULL, same four fixtures | Three warm-ups, twenty awaited calls; separate complete phase/counter pass | NOT RUN | NOT RUN | NOT RUN |
| PERF-HP | Confirmed HP update, applicable-effect branch, actual parts, health probe eligibility and writes | NOT RUN | NOT RUN | NOT RUN |
| PERF-EQUIP | Equip/unequip armor/shield/weapon, derived combat/movement, actual parts and writes | NOT RUN | NOT RUN | NOT RUN |
| PERF-EFFECT | Effect create/update/delete, time/expiry, cache decisions and affected values | NOT RUN | NOT RUN | NOT RUN |
| PERF-INVENTORY | Item lifecycle/cosmetic changes, tab navigation versus actual equipment render | NOT RUN | NOT RUN | NOT RUN |
| PERF-GROUP/WARFARE | Existing trace/browser coverage, reference refresh and unsupported metrics explicitly identified | NOT RUN | NOT RUN | NOT RUN |

Retain a run ledger with scenario/fixture, source hashes, environment, exact action, warm-up/sample counts, expected/observed value, metric boundary, raw export/timeline reference, failures, export loss and PASS/FAIL/NOT RUN. An unavailable metric is never recorded as zero.

## Correctness acceptance - every case NOT RUN

| ID | Procedure / evidence required | Status |
| --- | --- | --- |
| COR-RESOURCES | Change HP, temporary HP, fatigue, magicka and AP with sheets open; compare visible values and stored source after partial/full refresh and reload. Check expected write count and no extra writes from rendering. | NOT RUN |
| COR-TN | Change characteristics, each canonical skill rank and relevant ActiveEffects; compare skill/combat-style/magic TN displays with stored/derived values and supported roll controls. Preserve the Actor-then-Item order. | NOT RUN |
| COR-EQUIPMENT | Equip/unequip armor and shield, switch weapons/styles and inspect combat, carry and movement values; repeat with transferred effects and homebrew settings recorded. | NOT RUN |
| COR-CACHE | Create/update/delete Actor and owned-Item effects; advance effect time through supported controls. Check all affected parts, including wound/effect displays; no stale duration or delayed derived values. | NOT RUN |
| COR-INVENTORY | Create/update/delete/reorder Items; edit names/images/labels and descriptions; verify structural grouping and fresh presentation without accumulating bonuses. Containers must match embedded Items. | NOT RUN |
| COR-SETTINGS | Change density, search visibility, diagnostics/feature inspection, loadouts and relevant religion/encumbrance settings through existing controls; verify the next render and cache dependencies. | NOT RUN |
| COR-FORM | Type rapidly, trigger a targeted refresh, change tabs and close. Verify text/checkbox/numeric data, focus/selection, scroll, disclosures, tab state and stable layout; no duplicate listeners. Reject a controlled save and confirm retained form/errors. | NOT RUN |
| COR-MULTI | Open two PC/NPC sheets and an Item sheet simultaneously; update one and verify no cross-Actor or cross-instance values/scroll/filter leakage. Repeat close/reopen. | NOT RUN |
| COR-PRIVACY | Compare GM, owner and limited/non-owner context/rendering; verify private inventory/combat/effect context and group member stats respect permissions, including permission changes while open. | NOT RUN |
| COR-TOKEN | Repeat supported resource/equipment cases on linked and two independent unlinked token Actors; record exact Actor/Token UUID and compare both inventories/resources. | NOT RUN |
| COR-REFERENCES | Update group members and commander name/image/resources/ownership; create/edit/delete relevant effects and delete a referenced Actor. Inspect cached summaries and supported fallback behavior before/after reopen. | NOT RUN |
| COR-ITEM-BODY | Compare header-only and body renders for advancement, container and linked-spell Items; verify source rank and values survive normalization, render, close and reload. | NOT RUN |
| COR-PRIOR | Run [Task 01 rank acceptance](01-skill-rank.md#reproducible-live-acceptance---all-not-run), [Task 02 purchase/AppV2 recovery acceptance](02-xp-purchases.md#reproducible-live-acceptance---every-case-not-run) and [Task 04 special-action recovery acceptance](04-special-action-idempotency.md#reproducible-live-acceptance---every-case-not-run), including close without retrying an interrupted purchase. | NOT RUN |

## Validation, preservation and rollback

| Check | Result / evidence |
| --- | --- |
| Pre-edit baseline | PASS: all 980 Task 04 final manifest entries matched; guide copied before edits |
| Official v14 references | Consulted for public/protected classifications above; no new API usage |
| `npm run validate` | PASS, exit 0 on Node 24.13.0; command wall duration `38,975.596 ms`. Checked 798 JavaScript syntax files, 792 JavaScript references, 105 templates and 22 Markdown files; graph unchanged at 781 modules / 3,986 edges / 775 reachable; 7,109 bindings, 204 literal/computed dynamic imports, 21 migration revisions and both catalogs pass. This is validation execution time, not a sheet-performance measurement. |
| Production/tests/workflows/manifests/prior reports | PASS: all 979 baseline files other than the testing guide match their pre-edit hashes; only the guide changed and this new report was added. Tasks 01-04 source, six unit files/four fixtures, workflow gates, manifests and prior reports remain unchanged. |
| Node test suite | NOT RERUN for this documentation-only task; Task 04's historical 151-pass result remains historical |
| Standalone lint/syntax/schema/data commands | NOT RERUN separately; use the existing `validate` command and record what it actually checks |
| Foundry, benchmarks, correctness matrix, runtime warnings/accessibility and remote CI | NOT RUN; no live environment used and no performance result inferred |
| Dependency installation, fixtures, build archives, release/deployment | NOT RUN; outside scope |

The ignored backup retains `validate.log`, `validation.json`, `post-change.sha256.json`, `change-manifest.json` and `preservation.json`. The validator's **25 existing import/export coverage notices** remain separate from failures: dynamic-import promise patterns, namespaces passed beyond direct access and computed namespace use. Its source checks do not exercise native document persistence, forms, paint, permissions or multiplayer behavior. No tests, fixture generator, schema field, migration, API, setting, package version or compatibility declaration is added or changed.

Rollback:

1. Preserve any newer documentation edits; verify the backup's baseline guide hash before restoring it.
2. Restore only `docs/testing.md` from this task's `source/docs/testing.md` backup and remove only this new report if it still matches this task's final hash. Do not recursively delete shared folders or alter the earlier source snapshots.
3. Recompare the 980-file Task 04 manifest. No world restoration is needed for this audit because it performed no stateful work. A later live experiment requires its own coherent source/world backup and restoration record.

Audit complete; measured optimization deferred.
