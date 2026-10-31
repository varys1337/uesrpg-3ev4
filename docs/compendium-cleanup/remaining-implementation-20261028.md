# Remaining implementation after the 2026-10-28 completion pass

This is a continuation backlog, not a claim that the listed mechanics are
implemented. The source book and individual Item IDs in the ledger govern the
rules. Every batch needs source review, existing static checks, an updated
ledger, and isolated Foundry verification. Do not create or run automated
tests for this work.

## 1. Finish the native pack batch

Complete the isolated rebuild and readback in `completion-pass-20261028.md`.
Verify the staged source hashes, exclusive access and complete directory copies;
retain the pre-pass checkpoint. Update native evidence only for the exact
source hashes that actually passed. Existing world and actor Items remain
unchanged and require reimport for corrected authored fields.

The separate `release/staging/20261030-core-followup-v6` authoring copy adds
Soulsnare, typed Armor description, guarded-power instruction and two school
skill-description corrections, plus Rejuvenate's legacy choice metadata, to the
selected revision's authoring data. Its
five copied databases are still the older set and do not match its sources.
Complete revision `20261029-3` first; the follow-up needs its own native rebuild,
readback, exclusive-access checks and matched directory promotion. The earlier
`20261029-core-followup-v4` and `20261030-core-followup-v5` remain intact. The newer manifest and
`FOLLOWUP-STATUS.md` record the additional scope and file hashes.

## 2. Make partial costs and extended powers safe

The former alchemical creation, potion and minor-effect tables did not match
Core page 160. Their exported lookup/roll helpers now report the source entries,
but do not apply their consequences. A detected brew backfire records the table
roll and stops before consuming ingredients or creating an Item; a poison
backfire instead waits for a GM decision without rolling the potion table. The
GM handles the result, ingredients, Item, Trial and Error and affected characters. Drinking
a backfired potion is blocked before action costs for manual resolution. Old
weakened catalog outcomes are held for review, but other outcomes and Items
created with the former tables may not be identifiable automatically. The brew
claim and separate writes do not serialize multiple clients; a failure leaves a
review hold, and users must inspect the card, rolls, ingredients and Items before
retrying. Verify all of these paths in isolated Foundry. Fully recoverable,
source-correct automatic consequences and cross-client coordination remain work.

The Core Rejuvenate spell and catalog alchemy effect now capture a Stamina or
Fatigue choice before their usual costs and preserve it for the pending outcome.
The new paths are not live verified. Choice is discussed with the recipient and
GM; the local dialog does not obtain remote confirmation. A reflected spell
requires manual resolution for its new recipient. An old pending outcome that
lacks a choice requires GM review rather than an automatic preference. The
source spell's recipe label, note and legacy preference metadata in the selected
and compiled copies still say Fatigue is removed first. Revision 20261030-6
corrects those fields and needs its own later native rebuild. Source-recognized
spell potions, backfires, unrecognized old copies, cancellations and receipt recovery also need
verification. The earlier Rejuvenate scenario exercised the old behavior only.
The current range selector does not recognize the `touch` range type used by
Stabilize, Replenish, Cure Paralysis, Rejuvenate and Healing Touch. The GM must
establish the listed one-meter range; reconcile the range field and all casting
entry points before claiming it is enforced. The Rejuvenate dialog reminds the
group to check range but does not enforce it.
Recognized Core Replenish now produces a pending resource-restoration outcome
instead of silently resolving without a panel. The recorded Magicka spend is
used as Casting Cost; verify all levels and reductions, as well as source
semantics for alternate casting sources. Enchanted Items and no-Magicka casts
stop for GM resolution before payment; old cards, altered or unrecognized Items,
failed writes and the one-meter range require review. A serialized Replenish
potion now resolves its chosen spell level explicitly. The identified Replenish
and Rejuvenate scroll paths also avoid consuming a scroll when the cast was
blocked, cancelled or left uncertain; generic scroll failure and cancellation
handling still needs separate review. None of these changes are live verified.

The legacy restoration classifier previously treated unrelated operation kinds
as resource restoration, potentially producing unintended HP changes. It now
accepts only resource restoration and Stamina-or-Fatigue kinds (and the legacy
empty-kind default). Confirm the change against Fortify, Resistance, disease
cures, regular healing and resource-restoration outcomes; past writes are not
reversed. Recognized Core Stabilize no longer invokes first aid on the current
token selection: it prompts the group to confirm one dying character within
one meter and manage death tests manually. Core page 44 also permits an Ayleid
with Flesh Shaper to use Stabilize to treat wounds and to choose Magic damage
instead of health restoration; both options remain GM-led. The current stabilization marker is
coupled to first aid and wound-penalty suppression; a separate, recoverable
death-test-only operation remains to be implemented. Older copies without Core
provenance can still run the former handler. Core Cure Paralysis now prompts for
manual condition removal and review of the cause. Neither warning establishes
the target or range, removes an existing marker, or changes already-paid costs.
Healing Touch's configured healing lane produces a pending healing outcome, but
the GM must confirm one recipient and range. All of these paths need live checks.

A first shared progress record now saves the actor, target, action, each AP
payment and completion status. For source-recognized, correctly configured
Consume and Consume Heart, the active GM may confirm a target and spend one AP
at a time on the actor's tracked turn. On completion, the existing healing
outcome is queued. This may span turns, but the record and local lock cannot
serialize other clients or make the Actor and chat writes transactional. The
GM establishes corpse, feeding, transformation, continuity, reactions and
other eligibility that the documents do not determine. Reaction, player-led,
untracked and nonstandard Item configurations stay manual. Live verification,
especially for interruptions and review, is still required.

| Power | Deterministic execution still required after eligibility |
| --- | --- |
| Exsanguinate `9oStHySORcA7g0JV` | Reuse the existing Coup de Grâce/damage and healing outcomes, using the target's relevant remaining HP; apply the remaining AP and thirst consequences without repeating the original 2 AP. |
| Feed `a4X1nyuii5pGvK7T` | Reuse the Fangs attack and final mitigated damage; heal the vampire and, on nonzero damage, apply and later remove the Endurance penalty and record the feeding result. |
| Consume `N6Faw6oo9svWrutk` | Verify the GM-led 2 AP receipt and healing, and record sufficient-feeding eligibility separately; other contexts remain manual. |
| Consume Heart `bDgkogJMl8xSavAG` | Verify the GM-led 3 AP receipt and double-Endurance-Bonus healing, and record sufficient-feeding eligibility separately; other contexts remain manual. |
| Disarm (Zun) `wJ083gfm612PvOUr` | Integrate the Thu'um test, cone/eligible targets, their Agility tests, held-item consequences, and source-defined shout cost and recovery. |
| Latch On `wsvRIb5sXGBJFc3X` | Verify the triggering bite, grapple and hit location before spending SP; tie the Crippled consequence to that specific grapple and remove it when the grapple ends. |

Keep the current manual instructions for unsupported paths. Generic activation
is blocked before costs for the six source-tagged Core powers and copies
retaining their exact Core compendium origin, including older source-ID flags.
The two Consume powers can instead use the limited GM-led path above. Copies
lacking both forms of identity can still use the earlier generic path and may
spend costs without establishing eligibility.
Verify the guard, its manual instructions, cancellation, renamed imports and
older copies in Foundry. An unrelated same-name homebrew power should retain
its own workflow. No existing Item is migrated by this guard.
The six workspace Item descriptions still say their activation control records
the configured cost. The manual guard charges none; the limited Consume path
charges one AP per confirmation. The follow-up authoring copy corrects these
sentences with a repeatable transformation; its native rebuild remains pending.
The selected revision retains the old wording.

## 3. Resolve encounter-limited and targeting abilities

- Verify ordinary Adrenaline Rush's queued fatigue branch and implement its
  encounter-limited SP through the existing resource and outcome services. Attribute temporary SP to
  its source across spending and expiry before changing it automatically;
  existing temporary-SP sources can overlap. Finish Adrenaline Burst using the
  same accounting and preserve the manual fallback when there is no reliable
  encounter boundary.
- Verify War Cry's GM-confirmed listeners and per-target Panic outcomes through
  the shared outcome service. Correctly configured, source-tagged Core powers
  used by the GM in tracked combat can queue one recorded outcome per selected
  Actor; player-led, untracked, unconfigured and unselected listeners remain
  manual. Successful tests record immunity for that Combat ID. A Combat ID can
  be reused, so the GM must review and explicitly clear old immunity before a
  new encounter using the same Combat document; the bounded history also needs
  review if it reaches 100 IDs. Inspect every target's outcome, actor, chat and
  any paid cost before handling interruptions; never repeat the power's cost.
  Verify permissions, authority changes, selection, immunity, cancellation,
  result stages and concurrency in Foundry.
- War Cry's short activation text still says enemies test Panic "or flee" in
  the workspace and staging revision `20261028-2`. A failed test rolls on the
  Panic table and does not always cause flight. A separate staging revision
  `20261029-3` corrects this in its repeatable transformation and source; it
  still needs native rebuild and readback. The earlier staging revision remains
  untouched in case its rebuild is already in progress.
- Verify that configured War Cry and Highborn stop if their original tracked
  combat step changes before use or AP payment, including combat ending and a
  failed use rollback. These local checks do not serialize different clients.
- Integrate Weapon Echo with Conjure Weapon: source-backed option and duration,
  GM-validated placement, controlled movement, Willpower-based attack, AP and
  round attack limit. Maintain token/item provenance and an explicit cleanup
  path; do not create a second attack or bound-item system.
- Connect Bend Reality to both opposed and unopposed skill rolls with its 2 MP
  payment and cancellation/retry semantics. Flow of Magicka needs its reaction,
  Mysticism result and target-spell cancellation linked to one cast. Healer
  needs a distinct one-hour, 10 MP Restoration procedure tied to a chosen
  wound. Their current instructions remain manual until those flows are ready.

## 4. Arcane Items, rituals and summons

Use source-backed identity and any necessary metadata to distinguish normal and
crafted variants. Welkynd and Varla Stones need an atomic/recoverable exchange
of the selected stone for its source-defined resource change and dust; the
flawless crafted Varla variant has different remaining-use semantics. The Dark
Welkynd Stone needs stored Magicka, imbued-spell identity, activation tests,
selected/ignored targets and once-per-round operation. The lantern needs an MP
choice, light, duration, extinguishing and dispel behavior. Preserve unverified
prices and ENC.
Page 189 also gives White-Gold Artificer preservation options: a +0 Enchanting
test for Welkynd or Varla and a separate Willpower description for Welkynd.
The GM must determine how the overlapping Welkynd wording applies; do not
automatically destroy a stone before resolving an eligible preservation choice.

The four source-recognized Items now offer item-specific manual instructions in
the actor sheet's optional item quick menu. If one is marked consumable, the
generic combat Use Item shortcut shows the instructions before paying AP. This
does not automate any resource, stone, light or sentinel change. The quick menu
retains explicitly configured activation, alchemy and enchantment paths ahead of
the guidance; those paths may have their own costs and do not establish the Core
procedure. Source tags or the exact Core compendium origin are required; copies
without them can still use generic paths. These changes need live verification.

Trace each ritual's preparation, materials, tests and consequences before
adding automation. Keep GM permission and unavailable source-dependent decisions
manual. Recheck bound/unbound summons, ownership restoration, origin cleanup,
effect expiry and recovery using the existing conjuration and outcome services.
All 21 named Daedra and two named Construct spell profiles match the source
table's levels, costs and strengths; their creature Actor mappings and execution
still require verification. The generic Summon Daedra and Summon Construct
Items store multiple profiles, but the inspected path uses only their fixed
configured Actor and does not choose a different profile or adjust the cost.
A source-tagged warning identifies this at resolution. Use the matching named
profile and inspect any cost already paid before changing or retrying a cast.
The source-tagged Core Conjure Weapon and Conjure Armor selectors no longer
repeat the same Item at each Spell Strength and now tell the GM which source
clauses need manual handling. Recognized Core spells using standard-quality
Core Daedric weapon templates for the caster now set the existing weapon
quality field from recorded Spell Strength 1–3 and start reloadable weapons
unloaded. Edited templates, missing strength and shields require review. The creation path still does not establish
the learned type or slot, correct armor strength-based quality and coverage, all armor
replacement and training, ammunition, first reload reduction or disappearance
when a weapon leaves the caster's hands. Weapon Echo remains manual. Inspect
the created Item, other equipment, origin and any paid cost before correcting
or retrying an interrupted cast. Older untagged copies do not get the guidance.

The generic Reload shortcut now stops for GM resolution when a Power Draw
effect or its stored weapon reduction is present. It checks again after the
selection dialog without consuming either. Ordinary reloads check the saved
combat step and weapon state around AP payment, use the shared AP-spending
service, and report unconfirmed AP, weapon or chat writes. These safeguards are
not transactional or a durable recovery hold; another client can still race
them, and an earlier partially completed reload may already have lost its Power
Draw reduction. The first-reload reduction on a conjured weapon remains manual.
Before retrying an interrupted use, inspect the actor's AP and Power Draw
effect, the weapon's saved reload state and chat; do not assume a failed
response means no write occurred. Safe recovery, multi-client handling and live
verification remain required.
The reviewed ritual entries are references; their preparations, payment, tests
and resulting documents remain manual. Soulsnare is the page 152 ritual and its
existing description matches that source, but its authored 3-MP ordinary spell
configuration and soul-trap effect are incorrect. Runtime classifies exact Core
origin copies as rituals without migrating documents. Copies without provenance,
copies with edited spell type whose only provenance is in document statistics,
and previously queued outcomes need GM inspection. PC, NPC and group sheet
preparation now classifies the live Item and rechecks cached grouping; this
later runtime change is not included in the frozen staging copies. The follow-up authoring
corrects the source record and disables its obsolete spell effect while
preserving its Item and embedded-effect IDs; native rebuild remains pending. The frozen
`20261029-3` stage still contains the old data and older runtime.

## 5. Complete the per-ID review and UI failure cases

Expand `clause-traces.json` and the generated per-ID ledger from the current 327
traced identities to the full requested scope, including item values, rules,
execution paths and the actual state of every clause. Preserve the 54 remaining
unmatched entries and explicitly identify unresolved legacy potion and arcane
values. Verify descriptions against the source page, including page boundary
and decorative-text spillover. A source match alone is not execution evidence.

The six Core spellcasting skills have a limited, opt-in +10 specialization
choice in the shared casting dialogs. It requires one trained school skill,
one actor-owned spell with the exact same name and school, and a matching entry
in the existing specialization text. Duplicate names or school skills, renamed
legacy entries, NPCs and non-owned spells require manual adjudication. Do not
also enter the bonus in the manual modifier. Scroll and enchantment paths are
not covered by this change. Pending opposed cards retain their recorded TN,
so inspect earlier cards if the spell or skill changes before resolution. This
is not live verified. The Alteration and Conjuration descriptions retain broad
legacy examples although the book gives examples of individual spells; follow-up
revision `20261030-5` authors their correction for a later native rebuild.

The 18 standard skill Items and two field templates now have selected traces
for the page 63 governing-characteristic table, rank and specialization paths.
These traces are not a review of each skill's full uses or consequences.
The roll dialogs expose all characteristics, so the GM must establish whether
an unlisted choice is allowed by the situation or a talent. Configure each
Profession field and its characteristic before use; choosing a characteristic
in a roll does not establish a missing base value. For eligible owned Combat
Styles, ranged attack contexts now select Agility, and skill-opposed lanes pass
their selected characteristic. These changes are not live verified. NPC
profession fallbacks, styles with a different or missing base, missing totals and
contexts that do not correctly identify a ranged attack require manual review.
The shared skill calculation also now counts a selected-characteristic change
once instead of twice; this can change existing characters' roll TNs and needs
live verification for standard and magic skills. The ordinary melee/defense
dialogs still need a characteristic choice, and the combat path's
characteristic-specific test modifiers need source review.

The remaining nine Core skill identities have selected source traces, not a
complete review of their elite rules. In particular, the generic skill-purchase
planner does not establish that Bestial Instinct advances only through talents,
and its beast-form substitutions are not connected. Hemomancy and Nox Arcana
have distinct payment rules, while Shehai and Conte Frostfall have conditional
skill substitutions; the inspected generic paths do not establish them. Resolve
these cases with the GM and inspect the individual ledger entries. The retained
Necromancy description still needs separate source review beyond its Core
governing-characteristic table entry.

The 24 birthsign Items now have selected acquisition-cost traces. Paid manual
normal choices use 5 Luck; paid Star-Cursed choices confirm 10, while the
Star-Cursed Thief cannot be bought with Luck. An insufficient or changed Luck
value stops the relevant Actor update. A normal rolled sign can be upgraded for
5 Luck, while a naturally rolled Thief can choose its special version without
spending Luck. The submitted roll fields do not independently prove a natural
roll. No-cost manual selection relies on group agreement and does not verify the
Thief's natural-roll condition; the GM must adjudicate that exception. Birthsign grant creation and Actor updates remain
separate writes without a durable recovery hold; an interrupted or unconfirmed
attempt requires inspection of Luck, Items, sign and audit before retrying.
Individual sign benefits and powers need further review and live verification.

The seven Fortify Characteristic entries match the book's cost and strength
table, one-round duration, self target and configured characteristic key. Their
shared effect application, derived-characteristic preparation and Upkeep paths
are traced but not live verified. Replacing an existing effect deletes it before
creating the replacement; inspect both effects, the actor, origin and any paid
cost after an interruption before retrying.

Review ordinary first aid and wound treatment separately from the Healer
talent. The ordinary treatment path now selects recognized Profession
[Medicine] fields, does not require a kit, and asks the GM to confirm the
approximately one-hour procedure and any unrepresented modifiers. Treat-all
uses individual wound attempts, with each prompt requiring a separate GM time
decision; the source's scope for treating multiple wounds needs review.
First aid retains its separate, broader equipment and skill matching.

The treatment path saves a wound-local attempt record before rolling and holds
interrupted or unconfirmed stages for GM review. For a failed treatment of a
cripple-related wound, the GM decides whether the result is the source's
dramatic failure; confirmed dramatic failure uses the existing maiming path.
The GM can use Review treatment on the wound row after stopping other
processors and inspecting the roll, Actor, effects and chat. A malformed record
or a failed initial record write may need manual repair. These separate writes
and the local lock do not serialize other clients; a lost or concurrent write
can still leave no reliable hold. No earlier attempts are migrated. The new
selection, records, failure decisions and sheet control need live verification.
Generic wound CRUD and legacy macro calls remain separate administrative paths.
The Torch description's one-hour burning time is not established by the
adventuring-gear table; preserve it until a source supports a correction.
The 13 source-listed bolt materials and 42 original arrow identities have now
been traced to their authored values and the shared inventory and attack paths.
Configured Slashing or Splitting arrow types now supply their matching quality
in the shared ranged damage calculation; the ammunition sheet exposes the
existing type field for untyped arrows and preserves unknown values. Existing
embedded arrows can therefore change derived damage. These paths need live
verification. Their price field represents ten shots, as the Item header and
description indicate. Check purchasing and partial stacks manually. The attack-time
path now retains a zero-quantity ammunition Item so the last shot can still
read its damage and qualities, and checks that the quantity update succeeded.
It does not make the Item, reload and chat writes atomic or serialize clients.
Inspect ammunition, attack card and reload state before retrying an interrupted
or uncertain attack. Legacy pending-consumption paths remain separate.
The alchemy workshop warns when a source-tagged field kit is present and a
selected ingredient exceeds depth 4. It does not select the equipment, confirm
an external lab or prevent an unsupported brew; the GM must determine the
actual equipment. Untagged legacy field kits do not produce this warning.
The Alteration review found that Lock and Repair have no dedicated utility
handler, while Open only records a manually selected result. The GM must check
range and thresholds and update the object or Item. Burden's Item configures
Strength and a stacking Encumbrance-level effect, but the historical warning
incorrectly says Endurance. Its save, encumbrance exemption, effect application,
independent upkeep and expiry need live review. Missing, malformed or failed
characteristic saves now put the affected target in GM review instead of
automatically treating it as undefended. Interrupted Reflect, consequence or
spell-resolution stages also request review. The card retains any recorded
roll and damage details, hides application controls, and avoids rediscovering
its held inline outcome. The review requires manual resolution; it cannot stop
another client or an outcome already processing. If the card or batch write is
interrupted, the hold may not persist. Stop other processors and inspect prior
rolls, Reflect, separate chat outcomes and effects before resolving manually.
Repair's stored one-round duration has no
explicit counterpart in the source entry and remains unchanged pending review.
The six Shield variants use one shared pool per damage type, so overlapping
sources do not retain separately attributable remaining HP. Cleanup no longer
refreshes a surviving pool just because another effect ended; it caps the
current pool at the surviving maximum and asks the GM to review the overlap.
The GM must establish each source's remaining barrier HP and resolve overlap,
including legacy elemental pools. Damage order, upkeep, cleanup and failure
handling need live verification.
The Armor, Magic Armor and four typed Armor source tables are traced. The
shared spell application now holds a recognized Magic Armor/typed Armor overlap
in either casting order for GM review. The check does not repair existing
overlaps, cover unrecognized legacy or edited effects, serialize clients or
resolve every other armor interaction. Inspect the existing cast outcome and
any paid costs before retrying its effect. The four workspace typed Armor
embedded-effect descriptions incorrectly call their typed armor-rating changes
Resistance. A repeatable correction is authored in the follow-up copy; its
native rebuild is pending. Self-targeting,
damage, stacking, Reinforce, upkeep, expiry and failure handling need live
verification.

Verify the new characteristic roll draft through cancellation and write failures.
Its revision check uses a local document lock, so a shared authority or explicit
conflict-recovery design is still needed before claiming cross-client enforcement.
The GM permission checkbox is an acknowledgement; the separate manual and
point-buy workflows and direct Actor edits remain available. Preserve existing
saved characters and purchase recovery.
The shared character-generation audit append now uses a local lock, verifies
its saved entry and warns on an uncertain write without replaying a preceding
change. Verify successful, denied, malformed-data and concurrent writes in
Foundry; the local lock does not serialize separate clients.
Review Inspire Heroism's next-combat-test consumption paths before replacing its
existing one-round fallback expiry with a source-correct lifetime. In particular,
skill-opposed combat-style tests can receive its modifier without consuming the
effect; correct consumption after a confirmed card commit, with interruption and
concurrency recovery. Verify combat-ID tracking and legacy round-only records.
Histskin and Malacath's Fury now claim their Actor usage before queuing outcomes;
the generic Item use is a separate write. Inspect both records and chat after a
partial activation. New Malacath's Fury effects increase Strength Bonus instead
of the Strength score; review older active effects and previously queued cards.
The healing and timed benefit remain separate outcomes whose source ordering and
activation-relative duration need live review. Wrothgarian's standard Tough and
Resilient increases now use the shared feature contributor; Malacath's passive
HP requires the enabled prerequisite and a recognized Resilient value. Missing,
disabled, edited or duplicate traits, explicitly configured bonuses and manual
adjustments need review. Existing derived HP and Wound Threshold can change;
unrelated manual bonuses may overlap because their origin is not recorded.
High Men now adds disease immunity to the derived trait profile and increases a
single recognized standard Resistance (Poison, 3). Other edited or duplicate
traits need GM review. Existing Actor resistance totals can change.
Lionheart and Blood of Aldmeris now contribute their additional Power Well and
standard racial resistance upgrades for unambiguous, unmodified base traits.
Review edited or duplicate Power Wells and resistance traits, explicit talent
bonuses and unrelated manual adjustments. Existing Magicka and resistance totals
can change; resistance-test selection and disease checks need live verification.
Child of the Sap, Nature's Blessing and Sons of Skyrim now guard their automatic
numeric contributions against duplicate talents, explicit talent bonuses and,
where applicable, missing or nonstandard base traits. Existing totals can change;
review separately hand-adjusted bonuses, immunity behavior and optional wounds.
The shared resistance selector now includes legacy numeric trait fields and
selected racial and Malacath's Fury upgrades, without treating percentage
Disease Resistance or equipment fields as an X trait. Review other Active Effect
and manual sources, the damage/selector relationship and stale dialog selections
after actor or effect changes. The GM determines whether a test qualifies.
Imperial Luck's first-spend benefit still needs a shared receipt across LP and
Luck burning and across all eligible test types. A pending Actor flag saved with
the LP deduction exposes a GM review hold on skill-test cards and blocks the
general Luck entry points while observed. The dedicated button blocks recorded
Stamina use or untracked earlier Luck; generic +1 DoS and linked Burn 1 defer
Imperial Luck to that button or the GM. Actor and chat
writes are still separate and the local lock does not serialize other clients.
Stop all clients, inspect both records, and correct them manually before a GM
releases a hold. A malformed flag needs direct GM inspection. The prior
chat-update sanitizer dropped the Imperial Luck spend counter; a GM must review
existing affected test messages before additional spends. These changes have not
been verified in Foundry. Hard Target's Dash and movement eligibility needs a
GM determination; its acknowledgement is not a separate GM approval. A queued
effect is accepted only during its recorded combat step. This conservative
guard blocks late and older unanchored outcomes for manual review even if the
source benefit has some time remaining. Verify timing, initiative changes,
multi-client races and expiry in Foundry; direct helper callers remain
responsible for establishing Dash.
Controlled Anger's once-per-rest removal and involuntary-control test remain
manual. Frenzied now uses the shared enabled-feature lookup for new or repaired
effects and end handling, but an existing effect is not refreshed when its
talents change. Source attribution for temporary SP is still missing: any
remaining pool needs GM reconciliation. A Frenzied end pays only SP available
in the temporary and regular pools and records the paid and unresolved amounts;
the GM reviews any remaining loss, Fatigue and the non-lethal limit before
re-enabling the effect. It no longer raises SP at zero or reports the full loss
as paid when only part was paid. Verify end-write and
removal failures, later-round retries and re-enable. New end records guard by
effect identity until a confirmed re-enable; older records only guard the same
round, and the guard and local lock are not a cross-client transaction.
New grants require a confirmed active effect and save the pool and effect ID
together. Re-enable does not grant additional SP while a recorded end loss is
unresolved or its preceding end is unconfirmed. Older effects, a failed effect
or grant write, duplicate effects and simultaneous clients still require review.
Generic activation costs now use the existing temporary SP pool before regular
SP, but still block spending below zero for GM handling. The book ties each SP
below zero to a Fatigue level. The humanoid preparation pipeline currently
clamps negative SP to zero before calculating that derived level, while separate
spending, Fatigue controls, restoration and rest paths use different counters.
Repair these together and review existing actors, Active Effects, Undead,
encumbrance and interrupted payments before enabling automatic overdraw. The
current change does not establish source attribution for temporary SP.
Dragonskin's effect-only magic does not pass through the damage/healing
absorption check, combat typed damage uses a separate trait-only path, and several
spell-resolution paths check Reflect before absorption regardless of the source's
reverse application order. The GM resolves
unsupported magic manually until those shared pathways are reconciled.
Review save failures and cancellation on the affected AppV2 surfaces, language
aliases and Polyglot. Verify the shared potion reaction, fear, burning and
surprise checks across entry points, including event eligibility, and implement
recoverable 2 AP actions across turns. Source-keyed Lost Composure now blocks
reactions, including on older effects with that key; verify this and review the
other fear effects and Snap Out failure handling separately. The potion path's
broader block-actions check is not identical to the generic reaction gate.
New Frightened effects last for the encounter without a Snap Out option, as
specified on page 114. New Running and Screaming effects leave both compulsory
flight and the eligibility to Snap Out to the GM: the action restriction also
blocks normal movement, and the actor must first be away from danger. Older
effects keep their saved flags and need review. New non-combat fear effects do
not apply a global -20 to every test; the GM applies it to concentration tests
only while near the source. Older effects may still carry the broad modifier.
Fear tests stop before applying a result when the initial or table-roll message
is not confirmed, and Panic result creation reports unconfirmed effects. If a
table outcome fails, the recorded table roll is retained for GM review. Fear and Snap
Out Willpower tests use the shared characteristic-test calculation, including
all-test and Willpower Active Effect modifiers. These changes are not live
verified; fear outcomes do not have cross-client receipts.
The fear combat-boundary consumer now uses the time service's prior/current
turn data. A turn-start dialog offers, rather than forces, Snap Out. A confirmed
roll is recorded on the Actor; a success waits for the end of that exact turn
before eligible effects are removed and any lingering penalty is applied. A
claim remains if settlement is interrupted or uncertain, and the active GM can
inspect and reconcile it using the procedure in the handoff. The local lock does
not serialize separate clients; a failed roll-message or attempt write can lack
a durable hold. If the boundary is skipped, rewound, delayed, loses its active GM
or the encounter ends, inspect the record and resolve it manually. First-turn,
initiative changes, concurrent clients and recovery need live verification.
Old Frightened, Running and Screaming and Mind Break effects are excluded from
automatic Snap Out because their eligibility differs or needs GM judgment.
Generic Active Effect expiry has a separate turn ticker and also needs live
verification. Fixed-round Horror ticking remains manual until its timing is
source-correct.
Horror's Hopeless duration now rolls 1d6 rounds, and
Blackout and survived Scared to Death roll 1d4 hours; the GM tracks long-blackout
expiry. Vomiting and Hopeless no longer deduct Stamina immediately: the GM
verifies duration and applies the loss and Fatigue afterwards. The current
next-turn and fixed-round expiry paths need timing review, and older effects
remain unchanged. Momentary Blackout's unconsciousness and subsequent encounter
penalty, Manic Terror's forced attack and delayed loss, and Mind Break's staged
effects still need a complete source-to-execution review. Selected failures are
reported without an automatic retry, but the outcome has no cross-client
receipt. Review the Actor and chat before repeating a result.
Verify container
accessibility without assuming a source rule for closed or nested storage. The
quiver currently accepts any ammunition Item, rather than distinguishing the
source's arrows and bolts; identify a compatible, source-backed subtype before
enforcing that distinction. Sack hand use and physical fit remain GM decisions.

## 6. Final delivery gate

Use the isolated-world checklist to verify representative and boundary cases,
permissions, cancellation, duplicate actions and interruption recovery. Record
only observed results. After the code and native packs are matched and pass
their applicable checks, rebuild the staged distribution and compare its code
and packs to the workspace. Keep unresolved source and GM-dependent cases
visible. Do not deploy to the installed system or release from this task.
