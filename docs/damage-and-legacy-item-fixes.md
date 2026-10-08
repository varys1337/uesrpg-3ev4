# Faster chat damage and safe legacy item sheets

Target: Foundry VTT 14.368 and above, on the existing UESRPG 14.2.0 source. This change preserves combat mechanics, Item field names, sheet layouts, and the current ApplicationV2 architecture.

## Scope and evidence

Code inspection found local system calls and native Foundry synchronization in the damage path. No external microservice delivery was found. Avoidable serial document writes and the faded busy Apply buttons are addressed here. Foundry synchronization, mechanical decisions, and dependent aftermath still take time; no elapsed-time guarantee is established.

The reported `item-sheet.js:664` exception was the sheet's generic save-failure guard. The attached logs did not identify the invalid legacy field. This change addresses confirmed submission defects and adds strict, reference-specific migration diagnostics; it does not establish which field caused the original live-world failure.

## Damage application

The active GM retains local execution. Other users retain their requester-bound pending request, the native GM query, ownership and revision validation, request locks, outcome locks, and durable completed/rejected receipts. There is one authoritative application path.

`registerAuthorityIntentCommand` accepts an internal `{persistProcessing: true}` option. Only `combat.applyOutcome` registers with `false`: its handler starts from the durable pending request without the intermediate User update to `processing`. Pending and terminal request persistence remains intact.

Ineligible spell absorption produces the same deterministic receipt ID and result, carried into the first damage or healing health commit through the internal `_additionalDamageReceipts` option. For multiple components, only the first component carries this receipt. The existing health commit merges auxiliary receipts and the main application receipt with a 50-entry limit. HP, temporary HP, resource changes, and receipts remain together in that commit.

Actual absorption rolls, including failed rolls, remain persisted before dependent work. Unresolved spell-strength results and the marker preceding secondary spell effects retain their required durable writes. Effects, wounds, and hooks keep their ordering. Replay continues to use persisted receipts.

Receipt-only finalization uses `{render: false}`. Health and other visible updates retain ordinary rendering. The generic direct and atomic update helpers accept this optional rendering argument and preserve their Boolean result contract. Foundry documents the rendering option in [DatabaseUpdateOperation](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DatabaseUpdateOperation.html).

CSS targets only disabled, busy Apply Damage and Apply Healing buttons within the existing damage panel: full opacity, no transition, and no animation. The controls remain disabled, with their existing accessibility attributes and duplicate-click guard. Applied and partial results still derive from persisted workflow data.

## Item submission and save recovery

The shared write helper handles a native `update()` result of `undefined` by validating a cloned candidate with `updateSource(..., {dryRun: true, fallback: false})`. An empty differential means the requested state is already satisfied. A remaining differential or validation exception means failure. This extra check runs only for an ambiguous native result. See [Document update behavior](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html#update) and [DataModelUpdateOptions](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DataModelUpdateOptions.html).

Item submission excludes untouched native controls using their document-derived render defaults, then compares normalized values against `toObject(true)`. Checkbox, selection, text, and numeric presentation fallbacks do not become implicit repairs when an unchanged sheet closes. The description remains explicitly submitted from the current ProseMirror value and is compared with source data. An empty submission succeeds before spell-scaling or advancement validation.

Normalization applies only to submitted domains. Quality controls retain unrepresented entries and extra properties; edited numeric qualities merge into existing entries. Damage instances, scaling levels, recipes, and overtime entries merge submitted leaves at edited indices into existing arrays, retaining untouched properties and their absence. Combat-style fields, resource-restoration fields, and invocation fields remain absent from the update when not submitted. Charge-pool mirroring, soul-energy capacity rules, description saving, and XP calculation retain their existing behavior.

Queued writes are awaited before close. A failed queued save can be retried through the current native form submission. A rejected save keeps the sheet open and retains its edits. The public close boundary catches only the sheet's own save-block error; unrelated errors still propagate. A validation dialog or warning is not followed by a duplicate generic notification. Genuine failures expose the document UUID and error message, with available validation failures logged once by the form queue. The implementation uses the documented [ApplicationV2 submit, pre-close, and close lifecycle](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html).

The existing Item-then-Actor XP write sequence remains in place. If the Item save succeeds but its subsequent XP write fails, the error identifies the Actor and calls for XP review before further advancement. This patch does not introduce a cross-document transaction or change XP pricing.

Armor's `item_cat` model field accepts the two representations already used by the system: a category string and a category-label mapping. This prevents strict cleaning from replacing a valid legacy category string with the template mapping. No field is renamed. The field uses the documented [AnyField](https://foundryvtt.com/api/v14/classes/foundry.data.fields.AnyField.html) validation option.

## Manual compatibility repair

The new pass is gated by `itemSheetCompatibility: 1`. The existing Migration settings UI lists **Legacy item sheet compatibility**, and the existing startup notification includes its pending revision. Opening or closing a sheet does not run the repair.

The active GM's manual migration runner invokes this focused pass before older Actor/Item passes validate complete models. It inspects world Items, Actor-owned Items, and Items on unlinked-token Actors across scenes. Linked Actors are deduplicated by UUID. Actorless tokens are skipped. A token whose Actor cannot be resolved is reported and leaves the pass pending. Token Actors are accessed through the documented [TokenDocument actor reference](https://foundryvtt.com/api/v14/classes/foundry.documents.TokenDocument.html#actor).

The pass reuses existing subtype conversion, typed armor parsing, default application, model cleaning, and revision-state helpers. Recognized repairs include:

- Existing legacy `item` to `equipment` and armor-with-shield-marker subtype conversions.
- Finite numeric strings, recognized Boolean representations (`true`/`false`, `1`/`0`), primitive values in string fields, and missing schema defaults.
- Contiguous numeric-keyed records (`0`, `1`, ...) in array fields, preserving entry order and content. Sparse or nonnumeric records are rejected for review.
- Legacy armor/shield numeric fields with an unambiguous number and recognized damage-type label, using the existing typed-value parser.
- A finite nonnegative scalar spell duration, using the existing duration seed for its unit metadata.

Strict cleaning rejects unrecognized shapes or validation exceptions instead of replacing the Item with defaults. Missing values may receive their existing schema defaults; invalid populated values do not become a whole-item default replacement. Unknown properties are retained when merging cleaned system data. Array entries, IDs, embedded effects, flags, document references, and unrelated source fields are preserved by cloning source data and applying only validated changes. Type changes reuse the existing forced-replacement helper for the system object, without recreating the Item.

Every failure reports its scope, Item UUID/name/type, available Actor/token UUIDs, and error. Valid Items can be repaired during a mixed pass; invalid Items remain untouched by that repair. The revision is stamped only when the pass finishes without failures. On retry, already repaired Items are successful no-ops. Unsupported/retired subtypes are counted and remain outside this focused pass.

Retirement, combat, coverage, and gameplay normalization are not added to this pass. The existing manual runner still runs its other pending revisions according to their existing gates. No bulk compendium rewrite or unrelated UI conversion is included.

## Rollout and rollback

1. Back up the world before production repair. Keep the prior system source/package available for rollback.
2. Deploy these source changes through the existing system distribution workflow, then reload clients so the updated JavaScript and CSS are loaded together.
3. As the active GM, open **System Settings → Migration** and review the new pending compatibility revision and any other pending revisions.
4. Use **Run Migrations Now**. If a failure is reported, inspect the console's `Item sheet compatibility repair` references. Correct only the identified data with a world backup available, then rerun; do not replace the invalid Item with defaults or manually mark the revision complete.
5. Perform the manual acceptance scenarios below in a disposable copy before production use.

Rollback consists of restoring the prior system files and, if repairs were already persisted and need reversal, the world backup taken before migration. The compatibility pass does not keep a second mutable copy of every Item in world flags.

## Verification record

Verification for this implementation is **static review only**: source diffs, call sites, imports, write/aftermath ordering, revision gates, official v14 API contracts, JavaScript syntax parsing, and JSON syntax. Syntax parsing does not execute the modules.

No tests, benchmarks, runtime checks, live-world checks, or production migrations were created or run. Source implementation does not imply deployment to an installed Foundry system or repair of a live world.

## Manual acceptance scenarios — all unexecuted

| Scenario | Expected result to verify | Status |
| --- | --- | --- |
| Active GM and player Apply clicks | Health commits through the current authority path; ownership and revision checks remain enforced. | Unexecuted |
| Rapid duplicate clicks and retried requests | One committed application; replay returns the persisted result without duplicate HP/effects. | Unexecuted |
| Concurrent targets and concurrent applications on one target | Independent targets proceed; the existing per-target locks serialize conflicting writes. | Unexecuted |
| Linked and unlinked synthetic-token targets | The selected target's health changes without affecting an unrelated Actor/token. | Unexecuted |
| Interrupted, rejected, stale, or unavailable-GM requests | Pending/terminal receipts and card state remain recoverable and accurate. | Unexecuted |
| Physical and magic damage | Mitigation, wounds, effects, hooks, and visible health updates retain existing behavior. | Unexecuted |
| Immunity, zero damage, and temporary HP | Zero health delta is a valid result; temporary HP absorbs damage in the existing order; receipts remain durable. | Unexecuted |
| Ineligible absorption | Its deterministic receipt is included with the first health/application commit. | Unexecuted |
| Successful and failed absorption rolls | Roll and resource outcomes persist before dependent work; a retry does not reroll. | Unexecuted |
| Multiple damage components | The auxiliary absorption receipt accompanies the first component; replay and partial results remain correct. | Unexecuted |
| Normal and temporary healing, including full health | Existing healing rules and durable results remain intact. | Unexecuted |
| Failure after committed HP or during receipt finalization | Card reports the persisted applied/partial state; retry does not repeat committed damage. | Unexecuted |
| Legacy equipment, weapons, armor/shields, spells, and combat styles: unchanged open/close | Close succeeds with no document write, advancement charge, scaling validation, or implicit repair. | Unexecuted |
| The same Item types: valid edits | Only submitted domains change; unrepresented quality/array properties survive. | Unexecuted |
| The same Item types: invalid edits | Sheet stays open with edits available and one relevant notification, UUID, and validation detail. | Unexecuted |
| Retry after a failed description save | The current description submits again after queued work finishes; a successful retry permits close. | Unexecuted |
| Rank and combat-style advancement; invalid advancement | Existing XP prices/gates remain correct; inspect the reported partial-save case if the Actor write fails. | Unexecuted |
| First migration run and repeat run | Recognized shapes are repaired once; repeat execution does not modify valid data again. | Unexecuted |
| Mixed valid/invalid Items | Valid repairs persist, invalid Items retain original data, failures are identified, and the revision stays pending. | Unexecuted |
| Migration data preservation | Compare IDs, effects, flags, references, categories, unknown properties, and array entry data with the backup. | Unexecuted |
| World, Actor-owned, linked-token, and unlinked-token Items | All required scopes are covered and linked Actors are deduplicated. | Unexecuted |
| Unrecognized or sparse legacy structures and unavailable token Actors | Original data survives; no default replacement occurs; the relevant failure keeps the pass pending. | Unexecuted |
