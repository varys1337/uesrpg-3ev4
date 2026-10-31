# Core completion pass: working status and isolated verification

**2026-10-31 update:** See [the current safeguards and handoff](completion-pass-20261031.md)
for the newer combat-talent and Inspire Heroism behavior. The older checklist
below remains historical where it describes the previous automatic effects.

This is an **in-progress** implementation, not a release. No automated tests
or Foundry session were run for this pass. The earlier recorded Foundry
observations do not verify the current code. Existing world and actor Items
have not been migrated; corrected compendium Items must be reimported.

## Checkpoint and staging

The matched pre-pass rollback checkpoint is
`release/checkpoints/20261028-completion-pass-before/manifest.json`. It
contains SHA-256-verified runtime, authoring sources, five compiled Item packs,
scripts and audit records. Restore complete matching directories only after
all Foundry/database consumers are closed; do not overlay individual database
files.

The recommended isolated system preparation is
`release/staging/20261029-core-completion-v3`.
Its JSON authoring sources deliberately differ from its compiled packs until
the native authoring operation below succeeds. The live workspace still has
matching authoring sources and compiled packs; its reports mark the outstanding
records. The staging `completion-pass-manifest.json` identifies revision
`20261029-3` and records SHA-256 values for the source packs and changed runtime
files. It corrects War Cry's misleading short activation text as well as the
earlier staged changes. Revision `20261028-2` remains intact. If you already
started its rebuild, finish or safely stop it and retain the result; that
revision will need a further native rebuild for the short text. Do not replace
an isolated copy while Foundry is using it. The workspace has newer War Cry,
Adrenaline Rush Fatigue, Inspire Heroism,
Imperial stamina, Imperial Luck and Luck entry-point safeguards, Hard Target
combat-step protection, Panic and Snap Out handling, characteristic-roll draft,
character-generation audit handling, Frenzied feature handling, shared
temporary-Stamina activation costs, manual-power guard, GM-led extended feeding,
the ordinary wound-treatment and recovery changes, ammunition consumption and arrow-type damage, the field-kit warning,
escaped Open result text, characteristic-save failure handling, shield cleanup,
recognized armor-spell conflict handling and Soulsnare ritual classification,
including its later actor-sheet grouping correction,
the conjured-Item selector guidance and limited Core weapon-quality handling,
the generic summon-profile warning, arcane-Item guidance, the limited
spell-specialization option, birthsign cost/upgrade handling and Rejuvenate's
Stamina-or-Fatigue choice, Replenish restoration, alchemical backfire safeguards, Combat Style
characteristic handling, restoration-operation classification, touch-spell guidance,
and reload-shortcut safeguards,
and potion action-gate
runtime batches that are not in
this pinned staging revision. Revision `20261029-3` can be used for
the native pack rebuild; refresh the isolated runtime from the later workspace
only after that rebuild and before the manual runtime checklist. Staging contains source corrections for War Cry's text and 1 AP cost,
seven Free Action labels, separate quotations included in Inspire Heroism,
Blending and Meticulous Planning, six Weakness descriptions, Highborn's 1 AP Cast Magic
cost, and the empty Iron Spike and two gemstone descriptions. The gemstone
entries expressly identify loose-gemstone ENC as unspecified by the source.

A separate later authoring copy is prepared at
`release/staging/20261030-core-followup-v6`. It adds the Soulsnare ritual
configuration, four typed Armor effect-description corrections and six power
cost-instruction corrections, plus source examples for the Alteration and
Conjuration skills, and Rejuvenate's legacy choice metadata. Its compiled packs deliberately do not match its sources,
and it has not passed native readback. Continue with the selected `20261029-3`
first; the follow-up requires its own later native rebuild and complete pack
comparison. The prior `20261029-core-followup-v4` and `20261030-core-followup-v5` remain intact. The newer
copy's `FOLLOWUP-STATUS.md` and manifest record scope, hashes and limits.

Of the 55 previously unmatched entries, Soulsnare is now confirmed as the
page 152 ritual; its correction is authored in the follow-up copy and still
needs a native rebuild.
The other 54 entries remain preserved without a verified exact Core counterpart.
The four separately reviewed
arcane-item prices and non-lantern ENC, and the identified legacy potion
variants, still lack exact source evidence. Neither source matching nor static
pack parity establishes that a mechanic works.

## Prepare a disposable Foundry 14.368+ copy

1. Shut down Foundry and make a separate data directory for this work. Copy the
   entire staging system folder to that directory as
   `Data/systems/uesrpg-3ev4`. Do not overwrite an installed system or use a
   production world. Create or use a disposable world whose exact ID is
   `uesrpg-core-authoring`, with this isolated system copy.
2. Start the isolated Foundry server and enter that world as a GM. Create a
   native Script Macro containing the following. The first run only validates
   and reports the plan; it does not write the packs.

   ```js
   const { rebuildCoreCompendia } = await import(
     "/systems/uesrpg-3ev4/src/utils/dev/core-compendium-authoring.js?revision=" + Date.now()
   );
   const result = await rebuildCoreCompendia({
     expectedWorldId: "uesrpg-core-authoring",
     dryRun: true
   });
   console.log({ world: result.world, dryRun: result.dryRun,
     summary: result.summary, verification: result.verification ?? "dry run only" });
   ```

3. In the browser developer console, check that all five Item packs appear with
   counts 35, 24, 1,192, 340 and 169. Stop on any validation error, missing
   pack, unexpected replacement or count. Then change only `dryRun` to `false`
   and run the macro again. The helper uses native pack-scoped Item operations,
   keeps Item and embedded IDs, and compares all native readback to the source.
   Retain errors and their `authoringBackup`; do not copy a partial result.
4. Record the returned `verification` and summary. Return to Setup, stop the
   isolated server completely, and ensure no other Foundry instance has those
   pack databases open. From the staging folder, compare the isolated compiled
   packs to the staging authoring sources (replace the placeholder path):

   ```powershell
   Set-Location 'C:\dev\uesrpg\uesrpg-3ev4-14.0.0\release\staging\20261029-core-completion-v3'
   node scripts/verify-core-compendia.js --root 'C:\path\to\isolated\Data\systems\uesrpg-3ev4' --write-report
   ```

   The comparison must report five passing packs and no differences or extra
   records. Do not update source-hash evidence or copy a pack when either
   native readback or this comparison fails. Share the console results and the
   path to the closed isolated system copy so the complete pack directories can
   be checked and promoted as a matched set, with their previous versions
   retained. After that handoff, the assistant will prepare and verify a
   matching runtime refresh for the isolated copy before the checklist; the
   pinned staging runtime does not contain the later changes. Follow
   `reconciliation-workflow.md` for exclusive-access checks.

## Manual checklist for the isolated world

Record actual observations, Foundry version, actors/items used and any errors;
leave unrun cases marked unverified. Use copies rather than production actors.

1. **Inventory and containers:** check quantity boundaries, carried and equipped
   states, zero-ENC groups, nested/cyclic containment, capacity and concurrent
   moves. Confirm underlying embedded Items agree with the sheet after reopen.
   Check the newly traced gear values and leave unsupported light, fuel and
   water use to the GM. For the Healer's Kit, inspect name-based matching and
   compare the separate first-aid and wound-treatment procedures. Verify that a
   new cripple-related wound permits its first treatment before any long rest,
   that a recorded attempt is limited until the next rest, and that incomplete
   legacy records block for review. Verify PC embedded Profession [Medicine]
   Items and NPC profession fields, missing or unusual labels, Survival-only
   characters, and treatment without a kit. The GM confirms the roughly one-hour
   procedure and unrepresented modifiers. Treat-all now prompts separately per
   wound; verify cancellation and mixed outcomes, and have the GM decide the
   time for multiple wounds. Exercise successful and failed attempts, rest
   limits, GM decisions on dramatic failure, permissions, failed or interrupted
   writes and concurrent clients. A wound row offers Review treatment when a
   recorded attempt is unresolved. Stop other processors, inspect the wound,
   roll, conditions and chat, and resolve uncertain consequences before using
   it. A failed initial write or malformed record may need manual repair; the
   local lock cannot prevent another client's concurrent work.
   For ammunition, verify the 13 bolt materials, arrow material and type,
   prices per ten shots, quantity boundaries and zero-ENC bulk. On the
   ammunition Item sheet choose an arrow type, save and reopen; also check
   cancellation, no selection and an unknown older value. Verify Slashing and
   Splitting against armored and unarmored targets, including relevant talent
   interactions. Existing embedded arrows with a selected type can now deal
   different damage. Fire the final shot with Silvered and Magic ammunition,
   resolve damage, and confirm that the empty Item remains available until
   resolution and cannot fire again. Check reload, manually removed or changed
   stacks, permission failures, interruption and concurrent attacks. Inspect the
   ammunition, attack card and reload state before retrying an uncertain action.
   Decide purchases and partial-stack prices manually.
   In the alchemy workshop, check that a source-tagged field kit warns when a
   potion, toxin or poison uses an ingredient above depth 4, including after
   changing the recipe and on a zero-quantity kit. The warning is advisory;
   the GM confirms suitable equipment or an external lab. Untagged older kits
   are not recognized by this warning.
   For Lock, Open, Repair and Burden, let the GM resolve the documented manual
   target and object choices. Inspect Burden's Strength save and Encumbrance
   effect, stacking, upkeep and expiry. Missing, malformed or failed
   characteristic saves should place that target in GM review without applying
   an automatic hit; verify single- and multi-target cards, recorded-roll and
   damage detail display, hidden application controls, permissions, stale
   clicks, interruption and failed card writes. Check interruptions during
   Reflect, consequence creation and spell resolution. The hold cannot stop an
   outcome already processing on another client, and an interrupted card or
   batch write may leave no hold. Stop other processors and inspect prior rolls,
   Reflect, separate chat outcomes and effects before resolving manually.
   Verify Open's chat text and cancellation.
   For physical, magical and the four elemental Shield variants, check matching
   and nonmatching damage, Reinforce, remaining and depleted upkeep, expiration
   and manual removal. When overlapping effects share a pool, the GM must
   inspect the remaining barrier HP; removing one should not silently refill
   the survivor. Verify the warning, surviving cap, legacy elemental pools,
   permissions, interruption and simultaneous clients.
   For Armor, Magic Armor and each typed Armor spell, verify self-targeting,
   scaling, damage reduction, Reinforce, upkeep and expiry with worn armor.
   Apply Magic Armor and a typed Armor spell in each order: for recognized
   effects the second application should require GM review. Check repeated
   casts, potions, older or edited effects, permissions and simultaneous clients.
   Already-active overlaps and effects without the expected identity require
   manual review. Inspect the existing outcome and any paid costs before
   retrying an effect. The typed spells' embedded effect descriptions still say
   Resistance even though their changes apply armor rating.
   For the ritual Items, confirm the GM-led source procedures remain manual.
   For Soulsnare, verify the exact Core compendium Item and imported copies
   with supported provenance appear as a ritual, use the 25-XP ritual purchase
   route and cannot be cast as an ordinary 3-MP soul-trap spell. Check both
   source UUID formats, renamed and untagged imports, edited spell types,
   permissions, cancellation and already-queued outcomes. Untagged or otherwise
   unrecognized copies and the existing effect configuration need GM review.
   Check PC, NPC and group sheets, including reopening and cached regrouping;
   their display should use the same recognized ritual identity as casting.
   For the Core Rejuvenate spell, choose each effect with the recipient and GM,
   including with both Fatigue and missing Stamina, no Fatigue, and full Stamina.
   Confirm the target is within one meter with the GM: the current range
   selector does not recognize this Item's touch type, and the dialog only
   reminds the group. Check the single-target direct cast and deferred selection, cancellation
   before costs, changed recipient state before application, permissions and
   repeat or interrupted actions. Reflected casts and old pending outcomes
   without a saved choice need GM resolution; inspect any paid cost first. The
   local dialog does not collect another player's consent. Older unrecognized
   copies need manual review. The selected and compiled spell records retain
   Fatigue-first metadata; the later v6 authoring copy corrects it but has not
   had a native rebuild.
   For Core Replenish, verify all seven levels and the lower of Spell Strength
   and recorded Casting Cost, including reduced casting costs, full target
   Magicka, a separate recipient and serialized spell potions at multiple levels. The GM confirms
   the one-meter range. Enchanted Items and no-Magicka casts require manual
   resolution; inspect old cards and any paid cost before repeating a cast. For
   identified Rejuvenate and Replenish scrolls, check cancellation, blocked and
   partial casts, successful and failed rolls, quantity and uncertain writes.
   Other scroll types still need separate review.
   For recognized Core Stabilize, confirm the successful cast warns for manual
   resolution and does not add first aid or modify other selected tokens. The GM
   confirms one dying character within one meter for stabilization and manages
   death tests. The Ayleid Flesh Shaper wound-treatment and healing-as-Magic-
   damage options require GM resolution. An
   old unrecognized copy may still invoke the former first-aid handler. For
   Cure Paralysis, confirm the manual guidance and review the condition's source
   before removal. Check failure, cancellation, permissions, old copies and
   pending death-test cards. For Healing Touch, check all levels, the healing
   outcome, wounded and full-health recipients and interruptions. Confirm one
   target and one-meter range manually. Also check that Fortify, Resistance and
   disease cures do not create unintended HP restoration, and that ordinary
   healing and resource restoration remain functional. Previous outcomes and
   markers are not reversed; inspect paid costs before retrying.
2. **Potions:** exercise Healing, Replenishment, Armor, Magic Armor and
   Levitation at representative levels, including duration and armor stacking.
   Use the combat action, item sheet, quick menu and chat paths. Confirm 2 AP,
   both Quick Draw choices, inaccessible/cancelled selection, insufficient AP,
   Aim removal, manual opportunity attacks, quantity zero/one/multiple,
   permission failures, concurrent clients, combat-step changes and interrupted
   consumption. Check turn and reaction choices, fear, surprise and Burning;
   establish reaction events and resolve applicable opportunity attacks before
   drinking. A 2 AP action spanning turns remains manual. Inspect AP, Aim and
   quantity before retrying a partial or uncertain use.
   Compare the creation, potion and minor-effect table entries and dice with
   Core page 160. For a brew backfire, confirm the saved table roll and GM
   instructions and that no ingredients or result Item were changed; the GM
   resolves consequences, ingredients and Trial and Error. A potential poison
   backfire should wait for a GM decision without rolling the potion table. Drinking a marked
   backfired potion should stop before AP, Aim or quantity changes and direct
   the group to resolve it manually. Check ordinary brews and potions, owner
   and non-owner permissions, old weakened outcomes, cancellation, interrupted
   claims and concurrent clients. Existing Items and older serialized outcomes
   may reflect the former table and need review. Stop all earlier processing and
   inspect the roll, card, ingredients and any Item before retrying.
   For catalog Rejuvenate and a source-recognized serialized spell potion,
   exercise both choices, cancellation, backfire, changed
   Fatigue before application, old outcomes without a recorded choice, and
   simultaneous or interrupted uses. The earlier live scenario covered the old
   Fatigue-first behavior and does not verify this update. Resolve consent and
   any old or partial outcome with the GM before repeating an action.
3. **Features:** check the staged action labels, preserved passive benefits,
   activation costs, disabled features, duplicate clicks, failed writes,
   short/long rests and manual day/encounter resets. Verify Highborn's 1 AP,
   daily use, turn restriction and queued recovery. For Highborn and War Cry,
   change or end combat before and during use/AP payment, and inspect any
   rollback or uncertain cost before retrying. Check Inspire Heroism's
   round tracking across new combats, legacy records and a failed Command test;
   its existing one-round effect expiry still needs review against the next-test
   rule, and skill-opposed combat-style tests currently may not consume the bonus.
   For a correctly configured, source-tagged War Cry in tracked combat, let the
   GM select and confirm the enemies who can hear it. Check each queued Panic
   test, table result, effect and successful target's immunity, including
   cancellation, permissions and interrupted stages. Player-led or unconfigured
   uses and unselected listeners remain manual. Revision `20261029-3` corrects
   the short text; a failed Panic test rolls on the table. Check
   that a new or older Lost Composure fear effect blocks both reactions and
   other actions until it is removed, and that Startled only blocks reactions.
   Check new Frightened lasts through the encounter without Snap Out. Running
   and Screaming's flight and eligibility to Snap Out are manual; the current
   action restriction also blocks normal movement. Inspect older fear effects,
   whose flags and broad non-combat penalty may differ. For non-combat fear the
   GM applies -20 only to concentration tests near the source. Check unconfirmed
   initial and table-roll messages, Panic effects and summaries, including a
   failure after the table roll was recorded. Test the optional Snap Out prompt,
   cancellation, test modifiers, failed attempt, successful attempt that stays in
   effect through the turn, end-of-turn settlement and lingering penalty. Check
   a changing or rewound turn, GM disconnect, interrupted writes, other clients,
   an ended encounter and review of an uncertain record. Fixed-round Horror
   effects still require GM timing. Inspect any successful or uncertain attempt
   before repeating it. For Horror, check
   Hopeless 1d6 rounds, Blackout and survived Scared to Death 1d4 hours, plus
   duration and effect-write failures. The GM verifies round timing, tracks
   long-blackout expiry, and applies Vomiting and Hopeless Stamina loss and
   Fatigue after their effects end. Other Horror results need further review.
   Check Adrenaline Burst's
   healing and wound suppression, and manually account for its SP and expiry;
   inspect old effects created before this correction. For Red Diamond and
   Imperial Luck, check both Star of the West names, either or both upgrades,
   disabled/duplicate Items, unrelated bonuses and character-generation gating.
   Existing actors may show corrected Stamina totals. Check Imperial Luck's
   LP/test writes, first and subsequent bonuses, the recorded-result note,
   recorded Stamina use, untracked earlier Luck, message permissions, a
   refreshed card, interrupted writes, general Luck entry points and simultaneous
   clients. A synchronized pending
   operation should show **Check Imperial Luck spend status** on that Actor's
   skill-test cards. Before the GM selects **Mark reviewed**, stop the operation
   on every client, inspect the Actor's LP and the original message identified in
   the dialog, and correct any partial result manually. Releasing the hold does
   not refund or replay a spend. If the original message is gone, use another
   skill-test card for the same Actor to inspect the hold; a malformed flag needs
   direct GM inspection. The Actor and message writes remain separate, and the
   local lock does not guarantee cross-client exclusion. Earlier test cards may
   lack their spend counter because it was discarded by the previous sanitizer;
   a GM must review those before further spends. Generic +1 DoS and linked Burn 1
   defer Imperial Luck to the dedicated skill-test button or GM; test that a
   selected Burn 1 or Burn 3 side cannot charge a different Actor. Luck burning
   and other test types remain manual. For Hard Target, confirm Dash and actual distance with the GM,
   and check cancellation, changing turns while confirming or paying, applying
   the queued outcome on its original step, the ranged penalty and expiry. A
   late outcome or an older outcome without a recorded step should be blocked;
   the GM must handle any remaining benefit manually and review prior costs.
   Check initiative changes and concurrent clients as well. The confirmation is
   an acknowledgement, not a separate GM approval; direct helper callers must
   establish the Dash requirement themselves.
   For Controlled Anger and related Frenzied talents, check enabled and disabled
   Items, changes during an existing effect, the manual Free Action and control
   test, failed end writes, deletion failure followed by a later-round retry,
   re-enabling the same effect and older round-only records. Check unconfirmed
   effect creation, duplicate effects, initial and repeated grants, failed grant
   writes and a re-enable while an earlier loss remains unresolved. Check zero, low
   and mixed Stamina pools: only available SP are deducted, and the recorded
   remainder requires GM review of Fatigue and the non-lethal limit before
   re-enabling. Do not repeat the portion already paid. Temporary Stamina is not
   attributed to its source; the GM must reconcile any expired Frenzy-only SP.
   For Histskin and Malacath's Fury, check Item and Actor use records, rest
   resets, partial outcome submission, permissions and simultaneous clients.
   Apply Malacath's healing before its timed outcome and check that only Strength
   Bonus, not the Strength score, changes. Inspect old effects and queued cards.
   Check Wrothgarian with the standard Tough and Resilient racial traits, its
   enabled/disabled prerequisite for Malacath, edited and duplicate traits,
   explicit talent bonus fields and existing manual bonuses. Derived HP and
   Wound Threshold can change; reconcile any pre-existing manual adjustments.
   For High Men, check disease immunity, standard poison resistance and
   non-damaging resistance tests, including disabled, missing, edited or
   duplicate traits and prior manual bonuses. Existing resistance can change.
   For Lionheart and Blood of Aldmeris, check standard and structured Power
   Wells and resistance traits, disabled, edited or duplicate Items, disease and
   magic resistance tests, and existing manual bonuses. Derived Magicka and
   resistance totals can change.
   Check Child of the Sap, Nature's Blessing and Sons of Skyrim with standard,
   disabled, edited and duplicate talents and traits, explicit and manual bonus
   fields, disease checks and optional wounds. Their derived Speed, resistances
   and Wound Threshold can change.
   Check resistance selection for structured and legacy traits on PC and NPC
   dialogs, highest-value duplicates, the listed racial upgrades and active or
   expired Malacath's Fury. Equipment and percentage Disease Resistance should
   not appear as trait X. Reopen a dialog if the Actor or effects change before
   submission; other manual and Active Effect sources still require GM review.
   Check feature costs with temporary-only, regular-only and mixed Stamina,
   insufficient SP, permission denial and interrupted writes. Below-zero
   feature costs and their Fatigue remain manual. For Dragonskin, check the
   Free Action and one-round expiry after rebuilding the pack. The GM must
   resolve unsupported effect-only magic and review Spell Absorption versus
   Reflect ordering; the existing combat typed-damage path is separate.
   Check source-tagged powers and older imports with their exact Core origin,
   including after renaming. Exsanguinate, Feed, Disarm and Latch On remain
   manual and stop before costs. For correctly configured Consume and Consume
   Heart, as the active GM on the actor's tracked turn, target one corpse and
   confirm one AP at a time. Verify two or three payments in one or more turns,
   healing, GM feeding judgment, insufficient AP, missing or changed target,
   cancellation, reactions, combat changes, repeated actions, permissions,
   concurrent clients and interrupted Actor/chat writes. Other contexts remain
   manual. Copies with neither source tag nor original compendium identity can
   retain their generic path; inspect costs before resolving or retrying. The
   authored descriptions still say the activation records the configured cost;
   the manual guard charges none and the GM-led path charges one AP at a time.
   The follow-up authoring copy corrects that sentence; its native rebuild is pending.
4. **Snare and Bash:** cover range and size boundaries, the GM's maximum-range
   decision, attack/opposed outcomes, missing targets, insufficient AP,
   cancellation, repeated cards, permissions and interrupted/recovered stages.
5. **Summons and rituals:** cover binding successes, failures and ties, ownership,
   upkeep, origin cancellation, linked cleanup, unavailable targets and
   concurrent/recovered actions. Verify Void Channeler timing through combat and
   initiative changes. For source-tagged Conjure Weapon and Conjure Armor, check
   that identical choices are shown once at higher strengths and the GM guidance
   appears. Review the learned weapon type or armor slot, strength-based quality,
   paired limbs and armor replacement, ammunition, reload, training and cleanup
   when a weapon leaves the caster's hands; those clauses remain manual. Verify
   the created Core weapon's Primitive, Standard or Proven quality at strengths
   1–3, including damage rolls, and that supported reloadable weapons start
   unloaded. Edited templates, shields and missing strength require GM review. Check old untagged Items, cancellations, paid costs, origin
   links and partial writes.
   Confirm the generic Reload shortcut stops before AP payment when Power Draw
   is pending, including a benefit added while its selection dialog is open.
   Resolve those reloads manually. Check ordinary free, single-AP and multi-step
   reloads, insufficient AP, cancellation, combat-step and weapon changes,
   owner/non-owner permissions, unconfirmed writes, chat failures and concurrent
   clients. Its checks do not provide a cross-client transaction or a durable
   recovery hold. Older partially completed reloads may already have lost a
   Power Draw reduction. Inspect AP, effect, weapon state and chat before retry.
   Verify the 23 named Daedra and Construct profiles, their Actor mappings and
   costs. The generic summon Items have multiple listed profiles but currently
   resolve their fixed configured Actor without choosing or repricing another
   profile. Confirm the warning, use a matching named Item and inspect any cost
   already paid before retrying.
   Check standard and magic skills at trained and untrained ranks with different
   selected and base characteristics: the change in characteristic should be
   counted once. Existing characters' roll TNs may change. Confirm the chosen
   characteristic and applicable specialization. Set a Profession field and
   its governing characteristic before rolling. For owned Combat Styles with
   Strength or Agility bases, compare ranged and melee TN previews and committed
   rolls with different characteristic totals; verify the selected characteristic
   on each skill-opposed side. Check modifiers, caps, permissions and changes
   between declaration and roll. NPC profession fallbacks, missing or unusual
   base values, incorrect attack contexts and ordinary melee/defense choice
   still need GM review. These changes have not been live verified.
   Verify spell-school specialization with an owned learned spell whose name
   matches an entry on one trained school skill: select and clear the +10 option
   in the unopposed and targeted casting dialogs, check the TN preview and roll,
   and cover different learned levels, cancellation, duplicates, renamed and
   unowned spells, NPCs, scrolls and enchantments. Do not also enter the bonus
   manually. Previously saved opposed cards retain their recorded TN; inspect
   them if the skill or spell changes before resolution. The Alteration and
   Conjuration Item descriptions still have outdated examples.
   Ritual procedures and the identified arcane Items remain manual. For the
   four source-recognized arcane Items, enable the item quick menu and verify
   the manual instructions, closing without changes, renamed Core imports,
   older source-origin flags and an unrelated same-name homebrew Item. Mark an
   identified Item consumable and verify the combat Use Item shortcut shows
   guidance without spending AP. Explicit custom activation, alchemy and
   enchantment paths keep their earlier behavior and may charge costs; inspect
   these before resolving anything manually. Check crafted and preserved stones
   with the GM, and test owner/non-owner access and copies without provenance.
   For the seven Fortify Characteristic spells, check each strength and level,
   self targeting, derived values, same-spell replacement, concurrent effects,
   Upkeep and expiry. Replacement can remove an old effect before the new one
   is created; inspect the actor, origin, effects and paid cost before retrying
   any interrupted or unconfirmed application.
6. **Languages and character generation:** save/reopen spoken and written
   languages and aliases, test Illiterate and Polyglot with its own configured
   languages, and check cancelled or failed saves. Complete a character from
   race through summary and purchase recovery. Verify up to three distinct
   characteristic-set rerolls, permission acknowledgement, unchanged Luck,
   finalization before assignment, cancellation after each saved roll, write
   failures and reopening. Check successful and denied audit writes, malformed
   existing audit data, and purchase recovery; an unconfirmed audit write should
   warn without replaying a character change. The acknowledgement is not a
   remote GM approval; local revision checks and audit locking do not establish
   cross-client atomicity, and manual or point-buy entry remains available.
   Inspect the saved draft and Actor before retrying an uncertain write.
   Check normal paid birthsign selection at 5 Luck, Star-Cursed selection at 10
   with confirmation, insufficient or changed Luck, cancellation and the ban on
   buying Star-Cursed Thief with Luck. Check upgrading an ordinary roll for 5
   Luck and the naturally rolled Thief's no-Luck exception. Recorded roll fields
   do not independently prove the roll. No-cost manual selection requires group
   agreement; the GM must also adjudicate that sign's natural-roll exception. Birthsign grant Items and
   Actor fields are separate writes without a durable recovery hold; inspect
   both, Luck and the audit before retrying an interrupted or unconfirmed use.
7. Across all cases, repeat with owner and non-owner users, an absent or changed
   active GM, multiple clients, partial writes and lost acknowledgements. Never
   replay a cost merely because an outcome or message was not confirmed.

## Reviewing an extended feeding action

Select the feeding actor. Inspect its Action Points, the target, and the healing
card in chat. A `queueing` or `review` record can represent an incomplete or
uncertain write, and a healing card may already have applied. Stop earlier
processing on every client; do not repeat the AP payment or healing while the
result is uncertain. The active GM may then run this Foundry macro:

```javascript
const actor = canvas.tokens.controlled[0]?.actor;
await game.uesrpg.combat.reviewExtendedAction(actor);
```

The dialog also permits abandoning an incomplete action. Confirm only after
reviewing or resolving it manually: releasing the record does not refund AP,
apply healing, or cancel a pending outcome. The review blocks while its known
healing card is still pending or processing. If that card is missing or its
creation was uncertain, locate and inspect any corresponding chat outcome first.
This operation and its recovery have not yet been verified in Foundry.

## Reviewing an interrupted Snap Out

Stop the previous operation on every client. Inspect the recorded roll in chat,
the actor's fear effects, any lingering penalty, and any Stamina loss that needs
manual resolution. A `pending` record may also mean its combat boundary was
missed; a `settling` record may already have removed some effects. Do not reroll
or replay those changes. After resolving the result, the active GM can select
the affected token and run this script as a Foundry macro:

```javascript
const actor = canvas.tokens.controlled[0]?.actor;
await game.uesrpg.fear.reviewSnapOut(actor);
```

The review dialog displays the attempt and known effects. Confirm only after
the inspection and manual resolution; releasing the hold applies no effects.
A malformed record requires direct GM inspection. A local lock cannot stop a
different client that is still processing the earlier operation.

## Reviewing War Cry immunity

Immunity is recorded against the Combat document's ID. If that same document is
reused for a new encounter, the active GM must review and clear the earlier
immunity for each affected actor before resolving a new War Cry. Stop earlier
processing, select the token, and run this Foundry macro:

```javascript
const actor = canvas.tokens.controlled[0]?.actor;
await game.uesrpg.fear.reviewWarCryImmunity(actor);
```

The dialog names the recorded encounter. Confirm only if the old encounter
ended or the record is incorrect. Clearing an immunity that still applies would
allow an extra Panic test. Old encounter IDs are retained and the history has a
100-entry limit; a GM can pass a specific old ID as the second argument after
reviewing it. These workflows have not yet been verified in Foundry.

## Remaining implementation

Four named feeding/shout/grapple powers, the unsupported Consume contexts and
feeding eligibility, ordinary Adrenaline Rush's encounter-limited Stamina branch, Weapon
Echo, player-led or unselected War Cry targets, Bend Reality, Flow of Magicka, Healer, the four
arcane Item activations, and parts of rituals and conjuration remain manual or
incomplete. Their current traces describe actual paths and limitations. The
full per-clause review of all 1,760 entries is not complete; most entries have
classification but no source-to-execution trace. The ordered implementation
work and acceptance criteria are in `remaining-implementation-20261028.md`.

Do not rebuild or treat `dist/uesrpg-3ev4` as a final distribution until code,
native packs and applicable checks pass together. The current distribution is
stale. No installed-system deployment or release is authorized by this staging
workflow.
