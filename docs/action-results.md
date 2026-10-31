# Action result contract

Task 09 adds transient evidence to the existing action owners. The canonical implementation is [action-results.js](../src/application/action-results.js); it imports no runtime dependency and performs no action, document lookup, roll or write. Read the [Task 09 implementation report](task-reports/09-action-result-contracts.md) for the caller inventory, validation ledger, native acceptance and rollback.

## Reading a result

Plain action return objects include `actionResult`. Its version is **1**. Existing Boolean, nullable and native Document APIs retain their return types; their `Result` companions return `{value, actionResult}`. Never assign a descriptor to a native Document. Descriptors describe the named **scope**, which can be AP spending, submission, application, or a combined workflow.

```js
const {getActionResult} = await import("systems/uesrpg-3ev4/src/application/action-results.js");
const response = await game.uesrpg.application.damage.applyResult(actor, payload);
const result = getActionResult(response);
if (result?.ok) {
  // The named scope completed, including any rule-defined no-effect result.
} else if (result?.accepted && ["pending", "processing"].includes(result.status)) {
  // Use its existing message/operation reference. Do not submit another action.
} else if (result?.status === "needsReview" || result?.status === "partial") {
  // Inspect the existing receipt/card and documents before any manual repair.
}
```

`getActionResult` also reads the existing authority transport's `data.actionResult`. Transport delivery and domain completion are different evidence. A transport response may have `status: "rejected"` while its descriptor reports `processing`; inspect the descriptor for application state. The existing authority error code is retained, including `UNAUTHORIZED`, `INVALID_REQUEST`, `STALE_REVISION`, `EXPIRED`, `CONFLICT`, `NO_ACTIVE_GM` and `FAILED`. This contract defines no replacement error-code registry.

| Descriptor field | Meaning |
| --- | --- |
| `version`, `owner`, `scope` | Contract version and the existing domain owner/work covered by this result. |
| `status`, `ok` | `ok` is true only for `complete` in that scope. A completed roll can still have an unsuccessful rule result. |
| `accepted` | Submission was acknowledged, or an existing pending/terminal operation is known. This is not an application confirmation. A review result can retain acknowledged submission evidence. |
| `commitment` | `confirmed` means a consequential write has positive confirmation; `uncertain` means a consequential attempt or completion is unresolved; `none` exposes no positive consequential-write confirmation. It includes no-op results, preflight failures and protected historical completion/replays lacking a separate write acknowledgement. It does not assert that historical documents were never changed. |
| `references` | Allow-listed existing `operationId`, `applicationId`, `requestId`, `messageId`, `outcomeId`, `receiptId`, `actorUuid`, `itemUuid`, `targetUuid`. No new identity or retry guarantee is manufactured. |
| `code`, `reason`, `warnings` | Existing authority code and bounded plain text; control characters are removed. Text is not trusted HTML and must be escaped by an HTML renderer. No receipt/payload is copied wholesale. |
| `targets` | Allowed target UUID and child descriptor for available per-target/per-stage evidence. No native Documents are transported here. A mixed batch cannot become complete merely because its last target succeeded. |

| Status | Meaning and consumer behavior |
| --- | --- |
| `complete` | All work required by the named scope is confirmed done. A manual instruction, immunity or rule-defined no-effect can terminate without a resource write. |
| `pending` | A saved submission or later managed consequences await application/authority. Retain existing identity and card. |
| `processing` | The existing processor is active. Inspect/wait; no new submission. |
| `blocked` | A rule or prerequisite prevents work before a confirmed consequential write. |
| `cancelled` | Explicit cancellation before consequential work. Cancellation after a confirmed cost becomes `partial`; unresolved writes become `needsReview`. |
| `rejected` | Invalid, unauthorized or stale work was refused before consequential execution. |
| `partial` | Confirmed work and remaining/failed work coexist. Paid costs are retained; no new automatic compensation or retry is introduced. |
| `needsReview` | An attempted write, interrupted stage or acknowledgement is uncertain. Inspect durable evidence before repair/retry. |

## Compatibility and APIs

Existing action-facing Boolean fields on eligible object returns remain Boolean, but `ok`/`success` now mean confirmed completion. **Macros that previously branched on a queued card's truthy `success` must inspect `accepted`/`status` instead.** Underlying test fields such as `isSuccess`, roll totals and damage calculations keep their rule meanings. Durable receipt states (`waitingGM`, `partial`, `applied`, etc.) and transport states are not renamed.

| Existing API | Result access / preserved value |
| --- | --- |
| `ApplyDamageService.applySimple`, `applyResolved`, `applyHealing`, `applyChatCard` | `applySimpleResult`, `applyResolvedResult`, `applyHealingResult`, `applyChatCardResult`. Legacy calls return their original object/null; object results carry the descriptor. |
| `Actor.applyDamage`, `Actor.applyHealing`; ESM damage façades | `Actor.applyDamageResult`, `applyHealingResult`; façade exports `applyDamageResult`, `applyHealingResult`, `applyDamageResolvedResult`. |
| `game.uesrpg.application.damage` | `applyResult`, `applySimpleResult`, `applyHealingResult`, `applyChatCardResult`; existing entries retained. `game.uesrpg.combat` has the corresponding three damage/healing companions. |
| `applyMagicDamage`, `applyMagicHealing` | `applyMagicDamageResult`, `applyMagicHealingResult` preserve nullable values and aggregate absorption/typed-component evidence. |
| `ChatOutcomeApplicationService.apply` | Boolean remains; `applyResult` returns the descriptor. Chat controls use the companion. Reconciliation object results also carry it. |
| `executeSpecialAction`, `postSpecialActionOutcome` | Same object signatures and existing operation/message references, with descriptor and corrected `success`. No changes to ten action implementations or identity construction. |
| `executeAdvantageSpecialActions` | Combined action result. Existing `onAutoWinSuccess` fires for completion; optional `onAutoWinAccepted` handles source bookkeeping. Existing marker callbacks use the latter. |
| `SpellCastingService.cast`, `CastSpellService.cast`, `castScrollFromItem` | Descriptor on the existing object. Saved targeted cards report pending; AP/MP and scroll consumption acknowledgements remain separate. |
| `MagicOpposedWorkflow.createPending`, `castDirectTargeted`, `castUnopposed` | `createPendingResult`, `castDirectTargetedResult`, `castUnopposedResult`; original native Message/null returns remain. |
| `castFromEnchantedItem` | `castFromEnchantedItemResult`; original Message/null API retained. |
| `executeActivation`, `executeItemActivation`, potion/coating entrypoints | Descriptor on object result. Queued effects do not imply applied effects. Existing cost/order/rollback rules remain. |
| `ActionEconomy.spendAP`, sheet `spendActionPoints` | Boolean retained; `spendAPResult` / `spendActionPointsResult` carry confirmation. An unconfirmed update no longer returns true. |
| `executeItemMacroBestEffort` | Boolean retained; `executeItemMacroBestEffortResult` reports **external macro dispatch** only. Arbitrary module/macro effects remain unverifiable. |
| HUD selected actions | Forward the descriptor and corrected `ok`. Missing evidence for a required action is a review result. Ordinary roll/dialog dispatch remains outside this action-completion contract. |

Companions enter the same owner once and unwrap the same execution; they do not issue an extra action. AP/quantity/native create/update/delete acknowledgement checks reuse existing supported helpers. Foundry's [Document update](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html#update) can return no updated Document; embedded operations have their own returned confirmations. The system's existing helpers own native permission and acknowledgement handling. A [User query](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query) timeout cannot establish what gameplay writes completed. Receipt inspection precedes any decision to retry.

## Evidence and limits

Descriptors are transient, except where the existing authority response stores its JSON-safe `data` slot. They are excluded by the existing compact gameplay-receipt projection. No Actor journal, operation retention policy, schema, migration, setting or dispatcher is added. Existing source/Actor locks, authority selection, requester checks, special-action recovery and receipt pruning protections remain their owners' responsibilities.

Health writes record attempt/confirmation facts on the invocation's existing application context. Reading current AP/HP, condition presence, a truthy return object, elapsed time, an empty observed diff or a saved card is never a substitute for write confirmation. Historical health receipts do not always contain a separate write fact. Completed replay remains closed under the existing receipt owner; its descriptor cannot invent a new confirmation. GM reconciliation is terminal evidence of the recorded manual disposition, not automatic re-execution or proof of each historical write.

This work adds **no new crash recovery or cross-client idempotency guarantee** for standalone casting/consumption. Task 04's existing special-action protocol remains the recovery owner. An uncertain standalone cast/quantity/card requires inspection; do not submit a new card simply because acknowledgement is missing. Automatic refunds, deletions and retries are not added. Existing explicit rollback branches remain, and an unconfirmed rollback is reported as uncertain.

Scroll rules are unchanged: consumption is skipped for the existing explicit **user-dialog cancellation**; hook cancellation and other failed attempts retain their existing `consumeOnCast` behavior. A cancelled/blocked cast plus confirmed scroll consumption consequently reports partial completion. Ordinary quick Use Item still follows its existing report-only behavior outside brewed potion/coating routes; this contract does not invent quantity consumption for that path.

Native acceptance is **NOT RUN**. The [testing guide](testing.md) separates pure Node decisions from document lifecycle, authority, AppV2, privacy and performance acceptance.

## Resuming the deferred work

These are concrete handoffs under the selected source-only gate, with no optimization or stricter schema in Task 09.

| Earlier objective | Required evidence before a later implementation decision |
| --- | --- |
| [Task 05 sheet performance](task-reports/05-appv2-sheet-performance.md#future-benchmark-procedure---not-executed) | Use basic/heavy PCs, NPC and Item fixtures in a backed-up v14.369+ world. Agree correctness and performance criteria first; match environments/modules/diagnostics. Measure cold first-open separately, then three warm-ups and twenty warmed samples for full and targeted updates. Existing `runSheetBenchmark` measures awaited render calls on one open supported sheet per class; it does not measure visible latency, cold starts or targeted parts. Keep group/warfare, signature timings and visible-update gaps explicit. Choose a candidate only after matched baseline evidence and correctness parity. |
| [Task 07 TypeDataModels](task-reports/07-typed-data-model-audit.md#future-native-validation-procedure---not-executed) | Begin with spell `system.damageInstances` and a sanitized historical export corpus. Clone inputs; record native validation, strict/non-strict cleaning/fallback, `toObject(true)`, transformed output and persisted round trips. Exercise metadata/custom types, indexed edits, import/embedding/duplicate/export and permissions/tokens. Establish writer-control reachability and runtime consumers empirically. No LevelDB probing, simulator or generated world evidence. Stricter fields and any corrective migration require a separate evidence-backed decision. |

Performance measurements, native compatibility results and both broader objectives remain pending. There are no populated benchmark numbers or speedup/compatibility claims.
