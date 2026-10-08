# Broader automation fluency for the 14.3.0 release candidate

The eight implementation stages are complete in source for Foundry VTT 14.368 and later supported v14 builds. This pass extends existing document helpers, authority commands, queues, aftermath bundles, and AppV2 surfaces. It preserves the earlier [combat fluency changes](combat-fluency-14.3.0.md).

Live acceptance and matched performance measurements are pending. The local Foundry instance was at administrator authentication, without an active world available for verification. No world, installed system, release folder, or archive was changed. Package and manifest versions remain 14.2.0 until acceptance and the normal 14.3.0 release process.

## Implemented changes

| Plan stage | Implemented behavior | Main source |
| --- | --- | --- |
| 1. Confirmation and diagnostics | The batch updater uses the existing document confirmation routine. Atomic helpers read fresh data after acquiring their existing lock. Optional strict completion is applied at owned workflow boundaries. The disabled tracker now separates rest, consumption, on-hit, spell lifecycle, world-time, worship, travel, and warfare work and supports bounded exports with overwrite detection. | [Document helpers](../src/utils/authority-proxy.js), [tracker](../src/utils/perf-tracker.js) |
| 2. Boundaries and Actor identity | Condition/wound consumers resolve combatants using captured prior/current IDs. Spell expiration uses the captured round/turn. Candidate and activation tracking use Actor UUIDs and include combatant Actors, including synthetic and off-scene participants. Unresolved synthetic Actors use the existing combatant-scan fallback. Consumer failures reach the ordered orchestrator. | [Condition ticks](../src/core/conditions/turn-ticker.js), [candidate registry](../src/core/conditions/round-start-candidate-registry.js), [expiration](../src/core/magic/effects/spell-effect-expiration.js) |
| 3. Rests | Recovery follows the existing single atomic resource write, and healing-dependent work waits for its confirmation. Natural wound healing, reconciliation, applicable usage resets, Ritual blessing replacement, and invocation preparation are awaited. Replacement creates and confirms the new blessing before removing the old one; removal failure triggers checked compensation. Long-rest counters retain their meaning even at resource caps. | [Rest workflow](../src/ui/sheets/rest-workflow.js), [racial usage reset](../src/core/traits/racial-talents.js) |
| 4. Potions, coatings, and charges | Pending uses of the same owned alchemy Item join locally. Quantity and strike-charge decrements reread their source under the existing lock and release in finally. The wrapper returns consumption confirmation. Restoration summaries use actual capped changes; effects committed before later failure produce partial completion. Coating cleanup and presentation are checked. | [Alchemy operations](../src/core/alchemy/operations.js), [potion runtime](../src/core/alchemy/runtime.js), [coatings](../src/core/alchemy/apply.js), [strike charges](../src/core/enchanting/runtime/strike-runtime.js) |
| 5. Owned consequences | Damage awaits wound, strike-enchantment, alchemy, and death-state consequences through its aftermath bundle. Spell application awaits drain, disintegration, paired caster effects, and applicable conjuration/binding. Thin notification adapters skip handled domains. Spell workflow cards preserve partial automation results. Conjured Items are linked for cleanup before summary presentation. | [Damage aftermath](../src/core/combat/damage/post-application.js), [spell stages](../src/core/magic/spell-runtime.js), [spell effects](../src/core/magic/effects/spell-effects.js), [spell cards](../src/core/magic/opposed/render.js) |
| 6. Lifecycle and time | Cancellation joins by origin UUID and awaits deletion, linked teardown, buffer reconciliation, and applicable upkeep pointers. Manual deletion hooks remain fallback adapters on the elected GM. Narrow sealed commands resolve canonical spell documents and permissions. Owned world-time stages execute in order: spell ticks, expiration, wound deadlines, then transient-state cleanup. Group-rest time forwarding requests settlement and reports partial completion if time advanced before cleanup failed. | [Origin lifecycle](../src/core/magic/effects/origin-effect.js), [buffer cleanup](../src/hooks/init/features/register-buffer-cleanup.js), [time service](../src/core/time/time-service.js), [rest time](../src/core/time/rest-time-forwarding.js) |
| 7. State persistence | Worship, travel, and warfare state mutators read/compute/write through the existing atomic helper, skip unchanged persisted state, and return fresh saved state. Owned callers use strict confirmation. Invocation piety is rechecked at commitment after prompts and rolls. Warfare synchronization joins per Scene and includes a final pass for changes arriving during a pass, including a pass which reports failure. Actions and relevant hooks share that coalescer. | [Worship](../src/core/religion/worship-service.js), [travel](../src/core/travel/state.js), [warfare controller](../src/core/mass-warfare/encounter/controller.js) |
| 8. Metadata and rendering | Known over-time tick-state updates do not dirty the configuration index. Configuration/lifecycle changes and unknown updates remain conservative. Receipt, claim, tick, and invisible pointer metadata use render suppression where identified. Warfare actions rely on their existing document-hook render queue. Resources, effects, conditions, equipment, and visible completion retain ordinary rendering. | [Over-time engine](../src/core/magic/ticks/overtime-engine.js), [warfare AppV2 surface](../src/ui/apps/v2/warfare-encounter-app.js) |

These are source-level behavior changes. Their effect on live latency, networking, layout, and module interoperability has not been measured. No additional UI framework migration was justified by the inspected AppV2/DialogV2 surfaces.

## Completion and interruption contracts

Rest results retain `line` and `updatesApplied` and add `recovery`, `hpHealed`, `execution`, and `aftermathSummary`. `recovery` distinguishes confirmed recovery, no resource recovery, and failure. `execution.status` distinguishes completed, partial, and failed work. A confirmed long-rest counter write can exist with no resource recovery. Group and travel rests consume the same result contract and preserve one time advance per group.

Alchemy results retain existing fields and add completion information. A full-resource potion can confirm zero restoration and still consume its Item according to existing mechanics. If an effect, resource change, or consumption has committed before a later stage fails, the result remains partial. Pending uses join on this client; a later deliberate activation is allowed after settlement. No whole potion, coating, charge, or application is automatically retried.

Damage/healing retain the primary `newHP`/`newTempHP` result. Additive `settledHP`/`settledTempHP` describe the pools after awaited owned consequences, including nested on-hit damage or restoration. Final summaries use the settled pools. A live internal application context authorizes a same-Actor child operation without deadlocking the parent's application lock; it is not exposed in public notification payloads and cannot be manufactured through caller-provided IDs.

Owned effect stages claim before consequential work using additive metadata on their canonical ActiveEffect. Started or partial claims are not blindly repeated. Existing health receipts, absorption rolls, card follow-up claims, bounded retention, and authority request/completion writes remain in use. If persistence succeeds but terminal metadata or presentation fails, the result is partial. Manual adjudication and future resistance decisions remain descriptive or interactive; settlement confirms creation of the applicable prompt, not a future player decision.

`uesrpgDamageApplied`, spell effect/origin/hit notifications, and summon notifications retain their existing fields and add handled-domain/completion metadata. Built-in compatibility adapters skip domains already executed by the owned pipeline. External listeners still receive notifications; their asynchronous work is outside the system's completion guarantee. Foundry documents `Hooks.callAll` as returning void, so it does not provide an awaited completion contract. [Official v14 Hooks API](https://foundryvtt.com/api/v14/classes/foundry.helpers.Hooks.html#callAll).

Origin cancellation retains a Boolean result by default and supports optional strict completion. Owned sheet, upkeep, and spell replacement callers surface failure. Upkeep cancellation uses origin teardown when an origin exists and reports partial cleanup; dispel does not fall through to another deletion route after a known origin cancellation failure. Confirmed absence is idempotent success. Rejected deletion, unresolved linked cleanup, or buffer/pointer failure is not a successful cancellation.

`advanceWorldTimeSeconds(delta, {settleOwned: true})` and `advanceWorldTimeToPreset(preset, {settleOwned: true})` retain numeric successful return values. The option waits for the existing clock boundary's owned settlement. Failure after confirmed clock advancement rejects with `advanced` and `worldTime` metadata; forwarding reports that partial result. It must not advance time again to retry cleanup. Default public observation subscriptions remain available and their asynchronous work is outside owned settlement.

The new sealed `spell.settleOwned`, `spell.cancelOrigin`, and `time.settle` commands validate narrow canonical identifiers. They accept neither arbitrary document updates nor caller-supplied linked-entity lists. Spell authority resolves the saved spell, caster, effect, and stored context; a missing canonical source produces partial/failure instead of trusting a serialized caller payload. Time authority joins a GM-observed boundary and cannot fabricate a tick or advance the clock.

Local coordination and bounded receipts retain their existing limits. They do not provide distributed atomicity against arbitrary external writes, indefinite replay protection, or automatic recovery of every interrupted operation after reload.

## Documented v14 boundaries

Captured combat histories contain round, turn, combatant ID, and token ID. Consumers use those captured values rather than taking a later turn from the live Combat. [CombatHistoryData](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.CombatHistoryData.html).

Native expiration refresh takes a Combat, not extra round/turn options. When the queued boundary no longer matches the live Combat, the service passes an unsaved public Combat clone with the captured round/turn. Live validation must confirm the complete native expiration behavior for rapid advances and rewinds. [Combat.clone](https://foundryvtt.com/api/v14/classes/foundry.documents.Combat.html#clone), [DocumentCloneOptions](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DocumentCloneOptions.html).

Synthetic identity comes from the documented TokenDocument Actor and its UUID; a base Actor ID is not substituted for an unresolved synthetic Actor. [TokenDocument.actor](https://foundryvtt.com/api/v14/classes/foundry.documents.TokenDocument.html#actor).

Render suppression changes application rendering for an identified update; it does not replace persistence, permission checks, hooks, or confirmation. The existing AppV2 lifecycle and queues remain authoritative for surfaces. [DatabaseUpdateOperation](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DatabaseUpdateOperation.html), [ApplicationV2.render](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#render).

## Static verification

Existing checks passed after the implementation and completion review:

- `npm run lint`.
- `npm run schema:check`: TypeDataModel seeds match the existing template.
- `npm run data:check`: 30 spell-effect and 13 strike-enchantment entries agree with their canonical catalogs.
- `npm run syntax:check`: 777 JavaScript files.
- `npm run validate`: JavaScript/template references, import graph and exported bindings, localization/accessibility, public v14/authority boundaries, AppV2 architecture, migration registry, catalogs, and ordered combat dispatch.

No new test suite was created. No live Foundry tests or timings were collected during this broader pass. Static validation is not live-world acceptance. The source snapshots and forward/reverse patch chain were additionally verified byte-for-byte in an isolated copy; live source matches the final saved snapshot.

### World startup repair

The reported world-boot failure came from seven automation modules importing `requestAtomicDocumentUpdate`; the existing canonical export is `requestAtomicUpdateDocument`. Earlier syntax/path checks passed but did not validate export names. The affected imports and calls now use the canonical helper, preserving its existing permissions, locks, confirmation, and no-op handling.

The same audit found an older unavailable dynamic import in the Exploit Advantage check. It now uses the existing opposed document/token and isolated-duel helpers. Spell settlement authority is registered directly in the joined magic-runtime initialization before origin lifecycle hooks; registration success is marked only after the command is confirmed. The ready callback reports failure through documented [Hooks.onError](https://foundryvtt.com/api/v14/classes/foundry.helpers.Hooks.html#onError) and stops dependent initialization without recording successful readiness.

The strengthened release gate validates static and identifiable dynamic import/export bindings without evaluating runtime code. It rejects the saved unrepaired source with the seven incorrect imports and the missing duel helper. The repaired source passes 6,836 binding checks across 766 modules and 168 dynamic imports. It reports 13 coverage limits: 12 uses of namespaces/promises passed onward and one computed namespace access. These limits are not confirmed runtime failures.

Focused verification used 29 in-memory binding cases, 11 source-helper duel cases, and startup failure/retry, joining, order, idempotency, and ready-reporting checks. Node's native ES-module linker independently linked all 766 repaired modules without evaluating them and rejected the unrepaired snapshot with the reported missing helper export. No test files or new test suite were added. Existing lint, schema/catalog checks, and complete release validation passed. Foundry 14.368 was opened at administrator authentication; live GM/player startup, workflow acceptance, deployment, and performance measurements remain pending access to a disposable world.

## Live acceptance gates — pending

Use a disposable world copy on Foundry 14.368 or the exact newer supported build being targeted. Record the build, source snapshot, automation settings, client roles, enabled modules, and Actor/token UUIDs. Preserve a world backup before failure injection because source restoration does not undo committed resources or effects.

| Area | Required cases and acceptance |
| --- | --- |
| Rests | Short/long recovery at caps; untreated/treated wounds; usage entries changing and unchanged; meaningful long-rest counter at full resources; failed recovery write blocks healing-dependent work; blessing creation failure keeps the old blessing; old removal plus compensation failure reports unresolved duplication; individual/group/travel summaries agree; mixed permissions and privacy; one time advance per group. |
| Consumption | Ordinary, full-resource, capped and multi-effect potions; backfire and manual effects; serialized healing/effects; weapon and ammunition coatings; exhausted/deleted Items; strike charges; repeated pending clicks join; a new deliberate use works after completion. Inject consumption, later effect, linking, cleanup and summary failures. Confirm actual restoration and visible partial status; no repeated resource grants or decrements. |
| Boundaries and identity | Rapid turn advances, round transitions, rewinds and combat deletion; captured earlier boundary still selects its combatant; no extra ticks for skipped turns; original consumer order/direction semantics; two unlinked tokens sharing one base Actor; linked, unlinked and off-scene combatants; missing synthetic Actor resolution uses combatant fallback. |
| Owned consequences | Real strike and alchemy on-hit effects, nested toxin damage, resistance prompt creation, drain/disintegration, paired effects, conjured Items, summons/Mindlock/binding and caster ownership. Mechanical completion waits for owned work. Missing authority/source or rejected writes is partial/failure; observer adapters do not run handled stages again. Final HP display and summaries agree with settled pools. |
| Lifecycle | Cancellation and expiration of origins with target effects, paired caster buffs, Items, Regions and summons; concurrent cancellation joins; missing linked entities; rejected deletion; overlapping physical/magical/elemental buffers; unchanged buffer values skip writes; upkeep pointer cleanup; manual/external deletion fallback with multiple GMs; upkeep/dispel cards report incomplete cleanup. |
| Time | Native clock and Calendaria forwarding, with and without the settlement option; missing GM, timeout, interrupted cleanup and queued advances. Spell ticks, expiration, wound deadlines and transient cleanup run in order. A clock advance followed by cleanup failure remains partial and is not advanced again automatically. |
| Worship/travel/warfare | Concurrent state edits return saved data without local lost updates; retained history/normalization; piety depleted during prompts cannot be spent again; warfare Actor/Token/Region/Scene bursts during active synchronization receive a final pass, including after a failed pass; action and hook refreshes join; elected GM and all-scene coverage; movement restrictions remain unchanged. |
| Surfaces and compatibility | Open/closed PC/NPC, travel, worship and warfare surfaces; equipment remains authoritative in embedded Items; fresh derived values; focus, unsaved inputs, scroll position and layout size; chat privacy; representative enabled modules; unchanged automation defaults and source-specific calculations. |

The [combat fluency acceptance cases](combat-fluency-14.3.0.md) remain required, including `30/40 + 5 -> 35/40` without a full-health wound outcome, temporary HP semantics, Bleeding/overhealing, death status, receipts, absorption and stale-card handling.

Every completed card must agree with confirmed documents and owned consequences. Partial results must remain visible without duplicate application. Relevant changes arriving during reconciliation must receive a final pass. The completion button may remain pending longer because it now waits for previously detached work; this is a changed measurement boundary and is not evidence of a speed regression by itself.

## Matched local performance collection — pending

Diagnostics remain disabled by default. Enable them only in the disposable world; collect on each participating client separately and avoid console logging overhead:

```js
await game.settings.set("uesrpg-3ev4", "timePerformanceDebug", true);
game.uesrpg.perf.console(false);
game.uesrpg.perf.reset();
const exported = [];
let cursor = 0;
// Repeat after a short batch of matched actions, before the 500-record ring fills:
let batch;
do {
  batch = game.uesrpg.perf.exportBatch({ after: cursor, limit: 100 });
  if (batch.overwritten) console.warn("Discard this run: diagnostic records were overwritten.");
  exported.push(...batch.records);
  cursor = batch.nextCursor;
} while (batch.hasMore);
// Preserve this JSON outside the world, labelled with this client and scenario:
JSON.stringify(exported, null, 2);
console.table(game.uesrpg.perf.summarize(exported, { kind: "rest" }));
// At the end of collection:
await game.settings.set("uesrpg-3ev4", "timePerformanceDebug", false);
game.uesrpg.perf.console(true);
```

The export limit is clamped to 1–200. Cursors remain monotonic across reset; overwrite detection covers a delayed initial export as well as later batches. Keep the collector's cursor while appending more batches. Exclude overwritten runs, failure/replay samples, and unmatched scenarios from successful-duration comparisons.

| Measure | Interpretation |
| --- | --- |
| Rest and consumption settlement | `rest.settlement` and `consumption.settlement` cover their awaited owned workflow. Rest uses an operation ID; Item UUID/effect key and record sequence identify consumption spans. Failed/partial results are marked. |
| Queue, calculation and persistence | Atomic helper spans use the workflow kind (`rest`, `worship`, `travel`, `warfare`, or generic atomic). Consumption records lock wait and decrement persistence. Compare confirmation as well as duration. |
| Owned consequence stages | `damage.aftermath.operation`/`damage.aftermath.commit`, filtered by kind (`damage`, `healing`, `rest`, `spellLifecycle`), separate built-in stages. `onHit.alchemy` records alchemy consequences. `spellLifecycle.teardown` records linked teardown. |
| World-time settlement | `worldTime.queueWait`, `worldTime.settlement` and ordered stage records distinguish waiting from actual owned work. The boundary is identified by world time; the authority client has its own request interval. |
| Warfare synchronization | `warfare.synchronization` records each pass; report pass count and failures when a burst requests a final pass. |
| Confirmed/visible HP | Use the existing health-commit and `healing.visibleHP` records as described in the combat checklist. Visible HP observes an open sheet's laid-out input after confirmation and two animation frames; closed sheets and unchanged/superseded values have no sample. |
| Writes and renders | Count document-helper write attempts and available confirmations, embedded batch sizes, authority metadata, and card persistence/render records. Count a physical path once: phase records overlap helper records. Native status APIs and external modules can add writes outside helper counters. Sheet render records observe lifecycle completions; card render counts describe HTML construction attempts. |

Warm matched actors/sheets before recording. Match source, client role, route, inventory/effect size, automation settings, modules, and sheet state. Cover GM-local/player-to-GM ordinary/basic magic healing plus representative rest, potion, on-hit, cancellation, time and warfare actions. Save small batches before ring overwrite and report sample count, median, p95, write/render counts and failures for each scenario.

Do not subtract timestamps across clients or sum nested durations as independent work. `renderImpact()` is a time-window correlation report, not causal attribution. The existing turn-advance convenience benchmark is not a substitute for observing complete mechanical settlement. The baseline's older application return does not establish that detached automation had finished; independently observe its final documents before comparing settlement.

| Comparison | Before median/p95 | After median/p95 | Write/render counts | Status |
| --- | --- | --- | --- | --- |
| Visible HP, matched open sheets | Pending | Pending | Pending | Requires live traces |
| Healing/card mechanical settlement | Pending | Pending | Pending | Requires live traces |
| Rest, potion and on-hit settlement | Pending | Pending | Pending | Requires live traces |
| Cancellation/world-time settlement | Pending | Pending | Pending | Requires live traces |
| Warfare burst synchronization | Pending | Pending | Pending | Requires live traces |

No speed improvement is claimed before measurement. Global over-time index redesign, generic lock replacement, receipt compaction, broad cloning, and parallel combat consumers remain deferred. Their cost can be assessed from the existing traces without implementing them in this release candidate.

## Source snapshots and rollback

The independent source snapshots and matching forward/reverse patches are outside the checkout at `C:/dev/uesrpg/automation-fluency-rollback-20261007`. `00-baseline` already includes the earlier combat fluency implementation. `stages.py` declares the verified chain:

1. `01-confirmation`.
2. `02-boundaries`.
3. `03-rests`.
4. `04-consumption`.
5. `05-confirmed-consequences`.
6. `06-lifecycle-time`.
7. `07-state-synchronization`.
8. `08-metadata-rendering`.
9. `09-completion-review`.
10. `10-workflow-confirmation`.
11. `11-synchronization-review`.
12. `12-trace-export`.
13. `13-documentation`.
14. `14-module-contracts`.
15. `15-startup-settlement`.
16. `16-module-binding-validation`.

The separate `05-owned-consequences` directory was superseded during validation and is not part of this chain. Use the declared chain and `verification.json`. Each reverse patch restores its immediate predecessor; apply reverse patches in descending order for a broader source rollback. Acceptance of each source patch remains a live-world gate; none was promoted to an installed system here.

The guarded restoration tool defaults to a dry run, checks all touched preimages and absolute workspace paths before any write, and refuses to overwrite later edits:

```text
python C:/dev/uesrpg/automation-fluency-rollback-20261007/restore-source.py --to-stage 00-baseline
```

Only add `--apply` after reviewing the chosen source restoration. Keep snapshots and both patch directions with the release candidate. Source rollback cannot reverse resources, effects, flags, tokens or time already committed to a world; restore or explicitly repair world data from its own backup when required.

After both combat and broader automation acceptance pass, use the [normal release workflow](Release.md) to set 14.3.0, validate/build the accepted source and verify deployment. No document schema migration, new authority transport, automation default change, or additional UI migration is introduced by this pass.
