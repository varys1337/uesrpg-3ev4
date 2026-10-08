# Consolidation live acceptance — Foundry v14.368+

**Status: not performed.** Source static checks do not establish live Foundry behavior. This checklist is the release gate for the 14.2.0 consolidation described in the [audit](consolidation-audit.md). No runtime tests were run or added during implementation.

Use a backed-up, disposable world on the exact intended Foundry build, with one GM and a separate player client. Start with system-only behavior, then repeat relevant visibility and dice cases with the world's usual modules. Record failures with the build, actor type, action, client, and console error. Stop release acceptance on a regression; the audit describes source rollback.

## Record

- Foundry build: __________
- System checkpoint / source revision: __________
- World backup location and date: __________
- GM and player clients: __________
- Enabled modules: __________
- Completed by / date: __________
- Release decision and unresolved cases: __________

## Damage, healing, and recovery

| Done | Scenario | Expected observation |
| --- | --- | --- |
| [ ] | Apply physical damage, mitigated damage, and damage wholly absorbed by Temp HP. | Temp HP precedes HP. Mitigation and wound results match existing rules. One action produces one resource change and one core outcome. |
| [ ] | Apply typed spell damage with magic resistance, then a multi-component spell. | Source-specific mitigation is preserved and each component applies once. |
| [ ] | Exercise successful, failed, absent, and self-target Spell Absorption. Recover the same pending card. | The same card reuses its absorption decision without rerolling or restoring MP twice. A new action receives its own decision. |
| [ ] | Heal below and at maximum HP, with Bleeding; grant Temp HP. | HP and Bleeding retain existing healing rules. Temp HP uses the intended Actor. A valid capped result does not become a false failure. |
| [ ] | Repeat damage/healing on a world Actor, linked token, and unlinked synthetic Actor, including two unlinked tokens based on one Actor. | Only the addressed document changes; an arbitrary placed token is never substituted for a world Actor. |
| [ ] | Compare sheet, chat, macro, alchemy, and OverTime entry points. | They reach the shared service with original calculation and visibility policies. No second damage application occurs. |
| [ ] | In the disposable world, cause an HP update to be denied or cancelled before commitment. | HP stays unchanged, the failure is visible, and no applied marker or damage-success hook is emitted for the failed write. |
| [ ] | Cause an effect or chat write to fail after HP commits. | The core operation reports partial completion where the failure is surfaced. Already committed HP remains; repair does not reapply damage. Observer-only failures may appear separately in diagnostics. |
| [ ] | Rapidly click Apply from authorized clients. Interrupt a reply after HP commits, reopen the card, and use pending recovery. | Authority serialization and the retained receipt prevent a second HP application. An uncertain follow-up remains partial. |
| [ ] | Drain with and without transfer; deny the recipient write. Restore a current resource below, at, and above its maximum. | Transfer follows a confirmed drain, recipient failure is partial, and capped current-pool restoration does not lower an over-maximum pool. |
| [ ] | Reach zero HP on PC and NPC targets. | PC unconscious effects, NPC death presentation, and death tests retain existing behavior. Unsuccessful unconscious-effect creation is reported through aftermath. |

Inspect Actor receipts before recovering old cards: history is bounded to 50 entries. Existing card target identity uses Actor UUID; check multiple linked-token targeting before treating each token as an independent damage recipient.

## Opposed cards and feature actions

| Done | Scenario | Expected observation |
| --- | --- | --- |
| [ ] | Keep an attacker dialog open while another client commits or rolls a defender, then finish the attacker declaration. | Confirmed defender fields survive. Hidden-attack handling still uses the existing eligibility rule. |
| [ ] | Use deferred spell selection with characteristic defense while a defender card is open. | Spell-owned defense configuration updates without copying stale banked choices or results. |
| [ ] | Commit two defenders close together on physical and magic cards. | Each participant keeps their result, declaration, and target number through the shared updater. |
| [ ] | Retarget physical, magic, and skill cards, including while a result arrives. | Valid retargeting resets intended state; a stale reset is rejected rather than erasing a newer result. |
| [ ] | Compare GM-only, owner-visible, blind, self, and public contexts, with and without Dice So Nice. | Recipient policies survive refreshes and supplemental reports. Hidden results stay hidden. |
| [ ] | Activate existing talents and powers in automatic, confirm, and manual configurations; cancel confirmation. | The intended handler runs once. Cancelling spends nothing. Explicit Use retains its meaning in manual mode. |
| [ ] | Compare row information, confirmation, and AP/SP/MP/LP/HP spending inside and outside a started encounter containing the Actor. | Preview agrees with spending. Actor encounter membership and existing target/equipment requirements are respected. |
| [ ] | Exhaust resources or uses while an activation is open; deny cost or usage writes. | Failure reflects what committed, with no silent legacy fallback. Inspect compensation before retrying. |
| [ ] | Fail an effect, macro, attack launch, or target transfer after activation costs commit. | Costs are reported accurately and the action is partial rather than falsely complete. |
| [ ] | Use granted free special actions and Concussive/Buckler follow-ups from attacker and defender routes. | Existing AP/SP charging and free-action context are preserved through one special-action owner. |

## Combat time and Soul Trap

| Done | Scenario | Expected observation |
| --- | --- | --- |
| [ ] | Advance turns and rounds with conditions, wounds, fear, spells, OverTime, advantage, surprise, and attack limits. | Internal consumers run in documented order; public refresh follows dispatch. No duplicate legacy tick appears. |
| [ ] | Advance rapidly, reverse one boundary, then advance again. | Queued spells use captured boundary data. A legitimate later traversal is not suppressed as a lifetime duplicate. |
| [ ] | Exercise dynamic initiative, combat end/delete, encounter switching, and out-of-combat world time. | Existing timing eligibility is retained and no orphaned combat listener survives deletion. |
| [ ] | Exercise upkeep acceptance, refusal, insufficient MP, Origin AE expiry, and linked effect cleanup. | One expiry path owns scanning and public upkeep actions retain their behavior. |
| [ ] | Disconnect/reconnect the GM or change the active GM during boundary work. | Inspect resources and tick markers for missing or duplicate work. Record repairs; in-memory progress is not guaranteed across handoff. |
| [ ] | Apply spell Soul Trap, then let the player submit a positive-HP-to-zero transition. | The active GM processes only the confirmed update, creates at most one gem for that capture identifier, records completion, then removes the marker. |
| [ ] | Cancel the HP update; separately deny gem creation, receipt writing, and marker deletion. | Cancellation creates no gem. Creation failure retains recoverable state. An existing capture Item prevents duplication; receipt failure retains the marker. |
| [ ] | Compare captured soul data with canonical Soul Gem tiers and repeat after refresh. | Existing tier definitions and capture identifiers remain consistent; completed capture does not create another gem. |
| [ ] | Trigger capture with no active GM. | Inspect the pending transition and caster inventory on reconnection. Perform deliberate GM repair if needed; automatic background recovery is not promised. |

Soul Trap's HP-zero trigger and creation of a new gem are preserved behavior. This update does not decide that an unconscious PC is dead, consume an empty gem, or connect strike-enchantment Soul Trap markers to spell capture. Keep those rules-dependent cases manual.

## ApplicationV2, compatibility, and package checks

| Done | Scenario | Expected observation |
| --- | --- | --- |
| [ ] | Edit Soul Energy and `isSoulGem` on Item and Equipment sheets, including legacy true-like values. Close immediately and reopen. | Boolean and numeric values persist through the queue; blank portrait or presentation-only fields are not submitted. |
| [ ] | Make rapid Actor/NPC/Group/Item edits, immediately invoke a structural action, and close. | Pending edits flush deterministically; embedded equipment Items stay authoritative and inputs reflect document data. |
| [ ] | Change tabs, partially render, resize, minimize/maximize, and use restricted ownership. | AppV2 parts, permissions, focus, scrolling, and hook cleanup remain stable without legacy lifecycle warnings. |
| [ ] | Compare PC/NPC 910×890 and Item 640×620 at 100%, 150%, and 200% scaling. | Portraits, compact action rows, resource rails, and bounded scrolling retain the restored layout. |
| [ ] | Use names containing ampersands, quotes, and angle brackets in core dialogs. | Names render as text without broken option markup. |
| [ ] | Disable Warfare with historical units present, then re-enable it. | Disabled execution stays gated, historical data is preserved, and enabled calculations retain existing behavior. |
| [ ] | Exercise public damage/healing/roll macros and ESM imports; reload twice. | Public aliases remain available after init and hooks register once, without cycle or export errors. |
| [ ] | Run the release guide's static commands, then separately build and verify an installable folder. | Static checks pass, catalogs match their sources, and deployment hashes match the selected build. |

Record unresolved module interactions and observer failures alongside these cases. Accept the update only after relevant rows pass on the intended Foundry build.
