# Potion code checkpoint

The backfire table used at this checkpoint was later found not to match the
Core book. The current workspace blocks backfired potion use for manual GM
resolution, and old weakened outcomes require review. See the
`alchemy-backfire-review-20261030` observation and completion checklist. The
historical checks below do not verify that later change.

## Completion-pass changes, 2026-10-28

The book's Ready Weapon / Drink Potion rule on p. 99 gives an accessible potion
a 2 AP cost in combat. Quick Draw on p. 76 allows a choice of a 1 AP cost or
avoiding the opportunity attack. The shared potion workflow now presents that
choice, or confirms accessibility and the standard cost when the talent is
absent. The source classifies this as a Secondary Action, so the shared dialog
distinguishes a turn action from a reaction. The user must establish the event
and reaction limit with the GM and resolve any applicable opportunity attack
before confirming. The workflow uses the existing eligibility and atomic cost
services and breaks Aim through the existing action-economy service. The combat Use Item menu now includes physical Items of
type `item`, which is the type of the numbered Core potions, and no longer
charges a second cost before calling the potion workflow. Item-sheet
cancellation leaves the sheet open; a chat-button cancellation allows another
attempt.

These changes are **not live verified**. The shared path checks surprise and
fear, applies the existing Burning action gate on the actor's turn, and asks the
GM to resolve Burning for reactions outside that turn. It stops if the combat
step changes before payment or consumption. A 2 AP action can be extended across
turns under the book, but this workflow requires the full cost at once; resolve
that case manually. The reaction event and its one-reaction limit are not
tracked. Other combat reaction workflows still need review for the distinction
between a fear effect that blocks all actions and one that blocks reactions.

AP and dose consumption are separate
document operations, not a transaction: if a use is interrupted or another
client consumes the same dose, inspect the actor's AP and Item quantity before
retrying. Container accessibility and the action restrictions still need live
review. Quick Draw's separate first Ready Weapon
benefit is not implemented here. See `verification.json` under
`potion-action-costs-20261028` for the manual checks.

This checkpoint changes runtime code only. The five Core Item packs and previously recorded Foundry observations are unchanged; those observations do not verify this checkpoint.

- Potion doses are consumed before a chat outcome can be created. Consumption uses the existing authority-intent service and an elected GM or actor owner, checks the requester and the prepared potion data, and rechecks quantity under the writer's Item lock. A failed or unconfirmed consumption does not create an applicable outcome. An authority timeout is uncertain and requires review before retrying; a confirmed dose followed by a failed chat write is a partial use, not a free dose or an automatic replay.
- Timed potion effects use v14 duration data. Minute-based potions use world-time seconds in and out of combat; round-based effects use the existing combat-aware duration helper. Potion effects are marked for the existing spell-effect lifecycle. Combat/world-time transitions and expiry still require live verification.
- The Core Armor and Magic Armor descriptions on pages 130–131 allow stacking with physical armor only. The application path detects overlapping identifiable spell/potion armor modifiers and asks the GM to decide which effect applies before retrying. It does not delete another effect or choose a precedence rule. Unmarked custom effects and non-overlapping armor lanes are not automatically classified; review them manually.
- The standard source entries describe Healing and Replenishment I–VII as 2–14 points, Armor and Magic Armor I–VII as 1–7 AR, and Levitation I–VII as Fly 3–21. Configuration/source matching is static evidence, not live execution of every level.

Manual checks remain open for all previously untested levels, timed effects in combat and across combat changes, armor interaction in both application orders, permissions, simultaneous clients, failed writes, authority handoff and recovery after a lost acknowledgement. Do not repeat an uncertain consumption without inspecting the Item and authority request. The earlier world-time and selected-level observations remain listed in `verification.json`.

Pre-change runtime files are retained in `release/backups/potion-authority-20261027`; restore a matched existing code-and-pack checkpoint if a full rollback is needed. No automated tests were created or run.
