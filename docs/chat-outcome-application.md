# Configurable Chat-Card Outcome Application

## Configuration

Target: Foundry Virtual Tabletop v14.368 or later.

Open **Configure Combat > Combat**. **Damage, Healing, and Effects Application** is immediately below **Combat Sheet: Action Economy UI**.

| Stored value | Label | Policy |
| --- | --- | --- |
| `gm` | GM Gated | Default. A GM confirms resolved target consequences. Missing or invalid values use this policy. |
| `owners` | GM and Player | GMs can confirm any outcome. Players can confirm incoming damage to an actor they own, and healing or effects when they own the recipient or source actor. |
| `automatic` | Everything Automated | Newly resolved, eligible target outcomes apply without an Apply button. Required choices, rolls, and defenses still occur first. |

OWNER permission is required; Observer permission is not sufficient. A result containing damage requires recipient ownership even when it also contains effects. Owning the attacker alone does not authorize applying damage.

When no GM is connected, a manual player request additionally requires ownership of the recipient. Source ownership alone does not authorize cross-owner offline application. One active recipient owner is selected deterministically to execute eligible offline work. Native document permissions are checked again before consequential stages.

GM Gated also covers applicable consequences that previously applied immediately. This broader confirmation behavior is intentional. Action costs, ammunition, item-use accounting, passive effects, and ongoing timing retain their existing workflows. Mechanics requiring GM adjudication remain explicit manual tasks.

## Covered Outcomes

- Combat damage and healing, including blocked-hit handling and damage aftermath.
- Spell damage, healing, effects-only results, self-target effects, characteristic-defense consequences, and supported origin/conjuration consequences.
- Special-action advantages and Coup de Grace outcomes, preserving required choices and rolls.
- Alchemy potion, poison, toxin, and spell results, including stored source data for consumed Items.
- Active ability effects and supported active talent resource or condition consequences.
- Single-actor and batched regeneration results, after their required Endurance rolls.
- Enabled mass-warfare clash outcomes, using the existing warfare calculations and break tests.

Each resolved recipient has an independent outcome identifier, actual result kind, source and target references, stored preparation results, automatic eligibility, and completion status. Existing combat and magic flag fields retain their names. Added outcome metadata is versioned; existing resolved cards are not bulk migrated.

## Execution And Recovery

`ChatOutcomeApplicationService` is the shared execution path for manual clicks and automatic processing. The existing `combat.applyOutcome` request remains supported. Requests identify the card, target or outcome, and expected revision; consequential amounts and effects come from stored document flags, not HTML or request payloads.

The existing active-GM selector, sealed authority requests, damage service, magic helpers, condition engine, aftermath bundle, and domain executors are reused. Outcome and recipient queues serialize conflicting work. Stale card patches cannot overwrite completed application metadata or change stored outcome identity and results.

Preparation saves the required result before consequential writes. Source Item snapshots preserve execution data after consumable deletion, including parent or compendium construction context. Separate targets become eligible independently after their resolution is ready. Rendering presents document and receipt state only; it never applies consequences.

Recipient receipts use the existing `flags.uesrpg-3ev4.damageApplications` storage alongside compatible health receipts. They record authorization, processor identity, stage claims, completion, results, and observed resource/effect changes. Observed changes are diagnostic records, not instructions for replay or automatic reversal.

Owned-recipient stages may proceed without a GM. Stages needing other actors, privileged creation, or otherwise unavailable native permissions remain pending. When the executor cannot update another author's card, its owned-recipient receipt remains authoritative for the displayed state. A permitted card writer reconciles the stored card when available. Unsynchronized outcome receipts are retained until reconciliation; chat displays refresh through the v14 `ChatLog.updateMessage` API.

| State | Recovery behavior |
| --- | --- |
| Pending | Awaits permitted confirmation or eligible automatic processing. |
| Applying | A selected executor has persisted stage claims. Repeated requests do not run committed stages again. |
| Pending: requires an active GM | Owned work may already be committed. Deferred, unstarted stages resume when an authorized executor can perform them. |
| Applied | Terminal. Committed stages are not replayed. |
| Failed | No consequential stage was confirmed committed. A permitted user can retry the unstarted work. |
| Partial / review required | Committed or uncertain work is not blindly retried. Review the stage receipt and documents before any manual correction. |

Reconnection resumes only automatically eligible work or previously authorized pending work. An interrupted stage whose write outcome is uncertain is marked for review rather than assumed safe to repeat.

Automatic eligibility is captured when an outcome resolves. Selecting Everything Automated does not sweep previously resolved cards into automatic application; those cards remain available to a GM for manual application. Selecting a manual mode stops further unstarted automatic stages, including a mode recheck after saving a stage claim. It never reverses committed results.

## Reviewable Patches

The implementation is already present in the workspace. Four review-oriented unified diffs are provided under `.codex/patches/chat-outcome-application/`:

1. `01-shared-service.patch`: shared service and policy, receipt/recovery support, authority integration, immutable card persistence, and source snapshots.
2. `02-combat-magic.patch`: combat/magic application, resolution preparation, chat lifecycle integration, and native damage/effect plumbing.
3. `03-additional-outcomes.patch`: special actions, Coup de Grace, alchemy, abilities, regeneration, and warfare.
4. `04-settings-integration.patch`: setting registration, ApplicationV2 configuration, localization, outcome presentation styles, and this document.

These are review groups for one feature, not independently deployable releases. Do not reapply them to the already modified workspace. They are relative to the pre-implementation source snapshot, and no unrelated source files or release metadata have been changed.

Recoverable source snapshot:

`.codex/snapshots/chat-outcomes-source-20261007-222646.zip`

For source rollback, compare against the snapshot and restore only the relevant feature changes, preserving any later independent edits. Source rollback or selecting GM Gated cannot undo changes already committed to a Foundry world. Keep a separate world backup before campaign review.

## Validation

Static checks:

- `npm run lint`
- `npm run syntax:check`
- JSON parsing of `lang/en.json`
- Patch applicability and source-content comparison against the saved snapshot

No tests have been created or executed. No live Foundry world has been modified for validation. Multiplayer behavior and the acceptance scenarios below still require in-world review before production campaign use.

## Manual Acceptance Checklist

- [ ] Check all three modes, including missing/invalid setting fallback, denied attacker-owned damage, damage-plus-effects recipient ownership, source-owned healing/effects, and Observer denial.
- [ ] Confirm native calculations and consequences for combat, healing, effects-only spells, alchemy, special actions, ability effects, regeneration, and enabled warfare.
- [ ] Check independent multi-target readiness, synthetic actors, blocked hits, deleted recipient references, and consumed source Items.
- [ ] Use multiple GMs or owners, repeat clicks, deliver stale updates, refresh clients, and interrupt execution; verify committed stages are not repeated and uncertain stages require review.
- [ ] Disconnect all GMs and apply a resolved card written by another author to an owned recipient. Confirm cross-owner or privileged stages wait, the receipt is displayed, and the card reconciles when a permitted writer returns.
- [ ] Switch to automatic mode with old resolved cards present; confirm they remain manual. Resolve new cards and verify automatic application. Switch back to GM Gated during pending work and confirm unstarted automatic stages stop without reversing committed changes.
- [ ] Confirm action costs, ammunition, item-use accounting, passive effects, ongoing timing, existing Luck restrictions, and explicit GM adjudication tasks are unchanged.

## Official v14 API References

- [ApplicationV2 form submission configuration](https://foundryvtt.com/api/v14/interfaces/foundry.applications.types.ApplicationFormConfiguration.html)
- [Actor ownership checks](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html#testUserPermission)
- [Active GM selection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.Users.html#activeGM)
- [User queries](https://foundryvtt.com/api/v14/classes/foundry.documents.User.html#query)
- [ChatLog message refresh](https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html#updateMessage)
