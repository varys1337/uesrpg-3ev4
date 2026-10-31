# Character-generation purchase checkpoint repair

The two supplied browser logs report the same blocker: `Purchase checkpoint changed during persistence`, followed by an active purchase requiring review. Starting Resources and Combat Style then stop because the advancement service correctly refuses another purchase while that record is unfinished.

## Confirmed cause and change

Reproduced in the disposable `uesrpg-core-authoring` world on Foundry 14.369. A free Breton skill grant planned an Item update with a literal `system.rank` key. The saved checkpoint expanded that key, including its before-value snapshot, into nested objects. The service's lossless checkpoint comparison therefore failed before the Item write.

Purchase records now use an explicitly tagged JSON encoding inside the existing journal flag. The service decodes and validates records at its existing read boundary. Native Actor updates still own persistence, purchase IDs and intent versions stay unchanged, and existing unencoded records remain readable. No startup migration or automatic replay/erasure of unfinished operations is added. All four journal write paths use the same encoding.

Starting Resources now returns its actual purchase result. The wizard and raw generation flow stop on failure or cancellation. The wizard only completes that stage after successful submission and racial grants. An unfinished racial purchase opens the existing recovery review. Reconciliation clears the corresponding local request cache after its confirmed journal write.

Authority request pruning now uses the documented v14 `ForcedDeletion` operator. A compatibility copy of the shipped Shadow icon serves the old `images/sign-shadow.webp` URL without rewriting imported Items.

## Manual verification

- Reproduced the original failure and inspected the expanded checkpoint through Review XP Purchases.
- Reviewed and reconciled only the stopped disposable operation, whose Item step remained planned, whose skill was still untrained, and whose resources were unchanged.
- Applied the free racial Alteration grant successfully. The race stage then advanced.
- Cancelled Starting Resources and confirmed that Next remained disabled.
- Submitted 100 drakes, 1,000 total XP and 1,000 unspent XP successfully.
- Created one novice combat style for 100 XP; 900 XP remained.
- Review XP Purchases showed completed racial-grant, starting-resources and combat-style receipts and no active purchase. The previous failed record remained as a resolved receipt.
- The new Shadow selection loaded its corrected shipped icon.

Evidence: [before](evidence/chargen-checkpoint-before.png), [completed purchases](evidence/chargen-purchases-after.png). No automated tests were created or run.

## Follow-up: complete generation flow

The follow-up code inspection found additional completion problems that were outside the original purchase-checkpoint reproduction:

- The characteristics stage was marked complete even when its dialog was cancelled, invalid or could not save. Its result now reports a confirmed save; characteristic values and their generation record are written together.
- Characteristic generation records its starting baseline so reopening and rolling or allocating again does not add to the previously generated scores. For older records the configured race baseline is used when available. An older custom or otherwise unknown baseline remains uncertain and is explicitly flagged for review.
- The raw flow called guarded characteristics and luck handlers without an event target, so neither dialog ran. It also opened the optional spell and XP menus without waiting for them to close. It now waits for each step, stops on cancellation or failure, and checks pending racial grants after starting resources. Closing an optional spell or XP menu is the choice to continue without further purchases.
- A failed racial grant stops the remaining grant prompts. The wizard continues to permit race selection before starting resources so that a grant requiring XP can be completed at the resources stage.
- Missing birthsign source items, a cancelled Star-Cursed choice, and unsuccessful race, birthsign or luck saves no longer count as successful selection. The optional manual birthsign Luck cost is saved with the birthsign fields.
- Switching to a different actor resets the wizard's local stage completion. Finishing checks the required stages for the sequential wizard and checks the existing purchase journal for an active or unsupported record. Selecting an existing token retains the established free-navigation behavior.
- Changing race during an unfinished sequential wizard makes characteristics, resources and luck incomplete again. Existing purchases and other dependent choices still need review; they are not automatically changed.
- Completion flags and the final summary are saved together. A summary post is recorded as pending before the chat operation; if the post or its confirmation is uncertain, the user is asked to check chat instead of automatically posting it again on reopening. The completed wizard no longer recreates its cleared resume entry when closing.

These follow-up changes have **not been exercised in a live Foundry session**. The earlier selected purchase observations above predate them. No production Actor or Item data was changed. Any older locally saved wizard progress can still contain completion marks from before this fix: reopen the affected steps and verify their actual Actor data.

Race and birthsign Item creation and Actor updates are separate writes. If a warning says a race or birthsign save is uncertain, a GM must inspect the Actor's existing Items, characteristics and selected label and reconcile any partial changes before retrying. This follow-up reports that condition; it does not add automatic rollback or migrate existing Actors. Concurrent finalization from multiple clients and the failure of a purchase request before its journal becomes visible remain unverified.

The characteristic dialog offers up to three distinct individual 2d10 set rerolls after an explicit acknowledgement that the GM allowed them. Each new set is final, Luck is not rerolled, and the pool must be finalized before assignment. A later batch saves the pool as an Actor draft after its initial roll, each reroll and finalization, and stores the draft's submitted state with the characteristic update. Closing and reopening should recover the saved pool. New draft-based roll results are calculated from that pool; existing saved results and the separate manual/point-buy paths retain their editable behavior. The acknowledgement records the user's assertion, not a remote GM approval. These changes have not yet been exercised in Foundry.

An inconsistent or unconfirmed draft stops this dialog and asks for GM review. The write guard rechecks a draft revision under a local document lock, but that lock is not shared between clients. Concurrent clients, delayed acknowledgements and direct document edits are not prevented by this mechanism; inspect the Actor's `flags.uesrpg-3ev4.chargen.statsRollDraft`, saved characteristics and generation record before retrying an uncertain operation. Keep the older roll record when resolving a conflict. The checkpoint `release/checkpoints/20261028-chargen-draft-before/manifest.json` preserves the preceding files.

### Live checklist still required

In an isolated Foundry 14.368+ world, use a new disposable player character and record actual results:

1. Start the wizard, select a race, set characteristics, choose a birthsign, enter resources and complete racial grants, create a combat style, spend XP, learn a spell, set luck, and finish. Verify the Actor values, Items, purchase receipts and one summary chat message.
2. Cancel and submit invalid characteristics, reopen saved characteristics and check their baseline, cancel the Star-Cursed penalty choice and luck selection, and deny Actor or Item updates. Verify that the affected stages do not report completion and inspect any partially saved race or birthsign before retrying.
3. Cancel a racial grant after resources and then complete it; confirm that paid and free grants and resources are not repeated or reset unexpectedly.
4. Close the optional XP and spell menus with and without staged changes. Check purchase failure, interruption, a stopped receipt, explicit GM review and reconciliation, and refusal to finish while the journal is unresolved.
5. Change race after completing characteristics and resources, and review the reset stages and existing purchases. Return to the Actor stage, choose a different Actor and confirm the previous Actor's completion marks do not carry over. Close and resume an incomplete wizard, then confirm that finishing removes the saved resume entry.
6. Run `game.uesrpg.chargen.runRaw()` with a suitable selected Actor. Verify that race, characteristics, birthsign, resources, racial grants, spells, XP and luck appear in sequence and that cancellation stops the flow. The raw helper remains a sequence of menus; it does not mark the wizard complete or post its final summary.
7. Exercise player ownership, an unavailable GM, repeated clicks, a failed chat post or confirmation, and simultaneous clients. Check the character and chat before any retry when a result is uncertain.
8. Roll a new pool in fixed-order and manual-assignment modes. Close and reopen after the initial pool, after each reroll, and after finalization. Without GM permission acknowledgement, verify rerolls are refused. With permission, reroll three distinct sets; verify a fourth or repeated set is unavailable, Luck is unchanged, and assignment and submission are unavailable until the pool is finalized. Save and reopen the dialog and verify results and reroll history. Exercise point-buy switching, an older saved character, denied writes, closure during a pending write and simultaneous clients; inspect the draft and Actor before retrying an uncertain result.

## Existing affected characters

Installing the code fix prevents new malformed checkpoints. A character already carrying an unfinished purchase still needs explicit GM review. Open **Advancement Options → Experience & Advancement → Review XP Purchases**. Compare the recorded steps and resources against the character. Repair only any uncertain changes that actually occurred, then record manual reconciliation with a reason. Recording reconciliation changes the journal; it does not spend/refund XP or alter Items. Retry the intended generation choice after reconciliation.

The separate `tokenizer/pc-avatars/Avatar.Nazradin_al-Qadir.webp` 404 refers to a missing world portrait outside the system package. The supplied logs contain no copy of that image. Restore that file or select an existing portrait in the character sheet. The system does not replace the character's saved image path.

## API references

- [v14 expandObject](https://foundryvtt.com/api/v14/functions/foundry.utils.expandObject.html)
- [v14 Document updates and flags](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html)
- [v14 ForcedDeletion](https://foundryvtt.com/api/v14/classes/foundry.data.operators.ForcedDeletion.html)
