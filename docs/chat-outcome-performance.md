# Chat Outcome Delivery Performance

Target: Foundry Virtual Tabletop v14.368 or later.

## Findings And Scope

The supplied console log showed the same eleven aftermath operations for the GM-confirmed and automatic attacks. Repeated `complete` messages are accumulated bundle summaries, not evidence that HP was reduced eleven times. The bundle's completed-operation guard remains in place.

The previous shared executor persisted a started and completed checkpoint even when an operation had nothing to do. Receipt updates could also scan chat history and request updates for every retained outcome card belonging to that actor. Full Actor serialization for before/after evidence copied Items and receipt flags that were not used by the comparison. Receipt-only writes additionally invalidated sheet caches and notified unrelated actor-observing interfaces.

These are confirmed sources of avoidable work in the implementation. The supplied log contains neither full delivery timing nor a frame trace, so it does not establish their individual FPS impact or a before/after speedup.

## Changes

- Operations with an explicitly inapplicable consequence return before receipt writes, document-permission preflight, and snapshots. Their skip records join the next real checkpoint or final receipt. Previously applied, started, and uncertain stages are checked first.
- Strike, alchemy, weapon-expertise, charge, trait, target-state, and summary eligibility reuse the existing mechanics' conditions. Expired and legacy alchemy coatings still reach their cleanup workflow. NPC death-state synchronization remains conservative.
- The inline GM report payload is prepared without journaling it as a consequential operation. Actual standalone ChatMessage creation still receives a checkpoint.
- Evidence snapshots read source system data and Active Effects without serializing the whole Actor. Effect-change evidence and real consequential checkpoints remain intact.
- Receipt-only updates no longer invalidate actor-sheet revisions or refresh armor overlays, group sheets, warfare sheets, travel planning, or campaign interfaces. Mixed updates containing HP, ownership, effects, or other data keep their normal behavior.
- Receipt presentation comparisons identify affected message IDs. Requests are coalesced and native chat refreshes are skipped when the rendered outcome presentation is already current. Larger recovery refreshes yield between expensive cards.
- Scheduling ignores unrelated chat updates and uses lightweight descriptors until execution re-reads canonical results. An identical inline receipt synchronization does not enter the card update pipeline.
- Existing opt-in performance recording now includes outcome totals, skipped stages, receipt writes, snapshots, requested/coalesced refreshes, native refresh calls, and native HTML-render hook counts.

Presentation caches and diagnostic correlation never authorize work, select damage amounts, or mark completion. Execution continues to read document flags and recipient receipts. Ownership checks, deterministic authority selection, locks, queues, atomic HP/receipt writes, and interrupted-stage recovery are unchanged. No schema migration or new automation setting is introduced.

## Manual Capture

No automated tests or live-world mutations were performed for this patch. Use a backed-up review world for the following manual comparison.

1. Use the same scene, attacker, recipient, weapon, modules, and open panels for both modes. Keep verbose wound/spell debug logging off, or keep its configuration identical across captures. Restore HP and other consequences between runs.
2. Select **GM Gated** in **Configure Combat > Combat > Damage, Healing, and Effects Application**.
3. Open the browser developer console and enable quiet recording:

   ```js
   await game.settings.set("uesrpg-3ev4", "timePerformanceDebug", true);
   game.uesrpg.perf.console(false);
   game.uesrpg.perf.reset();
   ```

4. Resolve one attack and click Apply. Wait for its final card state. Then wait two browser frames before exporting:

   ```js
   await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
   console.table(game.uesrpg.perf.summarize());
   const gmBatch = game.uesrpg.perf.exportBatch({ after: 0, limit: 200 });
   copy(JSON.stringify(gmBatch, null, 2));
   ```

5. `copy` is a browser developer-console convenience, not a Foundry API. Keep the exported JSON with the capture label. If `hasMore` is true, export another batch using the returned `nextCursor`; repeat until `hasMore` is false. An `overwritten: true` result means the 500-record buffer lost data, so use a shorter capture. Reset before each attack rather than accumulating a whole combat.
6. Select **Everything Automated**, restore the same starting conditions, and reset recording. Resolve a new attack: old resolved cards deliberately do not become automatically eligible. Repeat the export using a different variable such as `autoBatch`.
7. Record the browser Performance panel around each delivery as well. Its main-thread/frame trace is needed to assess canvas FPS and long tasks; the system tracker does not measure token-animation smoothness. Repeat a few comparable runs rather than treating a single duration as representative.
8. Disable recording when finished and restore your previous application mode:

   ```js
   await game.settings.set("uesrpg-3ev4", "timePerformanceDebug", false);
   game.uesrpg.perf.console(true);
   ```

For a comparison with the original build, use the retained source snapshot on a separate review installation and the same world starting state. New `outcome.*` events exist only in this patch; compare existing health/authority events and browser traces across builds, and use the new events to explain the patched run.

## Reading The Records

| Event | Meaning |
| --- | --- |
| `outcome.application` | Authority-side application duration including actor queue waiting; automatic work also includes its outcome queue wait. Excludes prior declaration, roll, defense, and remote-request transport. `queueWaitMs` is recorded separately. |
| `outcome.healthCommit` | Time from application scheduling/request on the executing client to a confirmed HP update. A card with multiple real health changes may record more than one. |
| `damage.health.commit` | Existing health helper duration and write counter, including its atomic HP/health-receipt write. Check `ok` when interpreting its write attempts. |
| `outcome.receipt.persist` | Standalone receipt write attempts and confirmed helper results, excluding the atomic health write above. Identical receipt updates produce no write record. |
| `outcome.stage.skipped` | Inapplicable stage count. Its standalone `writeCount` is zero; its skip metadata can be included in a later real receipt write. |
| `outcome.stage` | Inclusive stage duration, including checkpoints and nested mechanics. `stageKey` identifies the operation; `outcomeKind` identifies damage, healing, or effects. |
| `outcome.snapshotBefore` / `outcome.snapshotAfter` | Evidence capture and change-comparison durations for consequential stages only. |
| `outcome.chat.refreshRequested` | Requested message refresh count and requests coalesced into an already pending message ID. |
| `outcome.chat.refreshSkipped` | Refresh requests whose native-render presentation was already current. |
| `outcome.chat.refresh` | `ChatLog.updateMessage` call duration and `refreshCount`. A call is not proof of a visible paint. |
| `outcome.chat.render` | `renderCount` of the system's native HTML-render hook for cards containing outcomes, including Foundry's own card updates. This is not a canvas-frame count. |
| `damage.visibleHP` / `healing.visibleHP` | Existing visible HP input measurement for an open Actor sheet, with `outcomeToVisibleMs` added when correlated. Does not measure token bars or canvas FPS. |

Summary counters are grouped by event. Durations and counters from outer stages, health helpers, and authority helpers overlap: do not sum them as independent work. `renderImpact()` is time-window correlation, not causal attribution. Recording is diagnostic-only and remains gated by `timePerformanceDebug`; `console(false)` prevents per-event logging without disabling recording.

## Review Checklist

- [ ] Plain damage at positive HP commits once; inapplicable stages show skips without standalone checkpoint pairs.
- [ ] Wounds, zero-HP conditions, NPC death-state changes, strike effects/charges, alchemy coatings, and weapon-expertise consequences still occur when applicable.
- [ ] Healing, effects-only spells, multi-target cards, and synthetic actors retain their correct final state and presentation.
- [ ] Receipt updates do not repaint unrelated older cards or invalidate unrelated actor-observing interfaces; actual HP/effect/ownership updates still refresh normally.
- [ ] Repeated clicks, reconnection, and uncertain interrupted stages do not repeat committed consequences. Offline recipient-owned receipts remain visible and reconcile when a permitted writer returns.
- [ ] Switching to GM Gated stops unstarted automatic consequences without reversing committed changes.

## Delivery And Recovery

The workspace already contains the changes. Sequential reviewable diffs are under `.codex/patches/chat-outcome-performance/`:

1. `01-stage-preparation.patch`: applicability guards, skipped-stage batching, shared domain guards, lightweight evidence, and inline report preparation.
2. `02-receipt-render-optimization.patch`: targeted/coalesced presentation refreshes, receipt-only update filters, scheduling, and synchronization guards.
3. `03-diagnostics.patch`: opt-in timing/counter extensions and this capture guide.

Do not reapply them to this already modified workspace. These are sequential source patches, not three independently deployable releases.

Recoverable pre-change source: `.codex/snapshots/chat-outcome-performance-source-20261008-132332.zip`.

For rollback, compare against that snapshot and restore only this task's changes, preserving unrelated or later edits. A source rollback cannot undo HP, resource, or effect changes already committed to a Foundry world. Keep a separate world backup.

## Official v14 API References

- [TypeDataModel source-data extraction](https://foundryvtt.com/api/v14/classes/foundry.abstract.TypeDataModel.html#toObject)
- [ChatLog message refresh](https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html#updateMessage)
- [Document update rendering option](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DatabaseUpdateOperation.html)
- [Document deletion hook](https://foundryvtt.com/api/v14/functions/hookEvents.deleteDocument.html)
