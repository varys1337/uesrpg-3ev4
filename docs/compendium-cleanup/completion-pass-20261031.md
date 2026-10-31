# Core completion: combat safeguards and handoff, 2026-10-31

This is an **in-progress workspace change**, not a completed review or release.
No automated tests or new Foundry scenarios were run. The 20261029-3 staging
copy is retained unchanged; the workspace still uses the earlier compiled packs.

## Follow-up review and source-only staging

Revision `20261031-core-review-v7` is a **source-only authoring copy** under
`release/staging/20261031-core-review-v7`. It has no compiled pack directories
and must not be installed or promoted. The preserved 20261029-3 and 20261030-6
copies are unchanged. The follow-up contains the earlier staged corrections,
plus 58 equipment records and six feature records changed relative to 20261030-6.
See the copy's `FOLLOWUP-STATUS.md` and manifest for hashes and preserved Item
and embedded-effect IDs. Current workspace authoring and compiled packs remain
matched; these follow-up corrections are not in those packs or existing actors.

The equipment ledger now compares at least selected fields for 1,141 of 1,192
Items, with qualifications recorded per Item; 51 have no exact source match.
This is not a complete review of purchase, materials, capacity or usage. The
workspace comparison identifies 16 Punch Daggers, 24 armor pieces and two
Werebear weapons with source differences. Sixteen Cestus descriptions in the
follow-up additionally explain the required natural-damage configuration.
Uncertain gemstone encumbrance, arcane values, legacy potion prices and unmatched
entries remain unchanged where exact evidence is unavailable.

All 340 features have a comparison against the available named extract and
selected metadata: 334 match those selected fields, and six have no unambiguous
named extract. The diagnostic catalog still has selected traces for 150. The
additional [clause reviews](entries/feature-clause-reviews.md) examine 108 Items:
85 previously had no selected trace, and 23 had earlier traces. These reviews
record source, stored settings, execution paths and manual or unresolved
clauses, but they are not live verification. Thus 105 features have neither a
selected diagnostic trace nor one of the additional reviews, while earlier
traced Items still need their other clauses reviewed. An extract match or one
selected trace alone is not a completed review.

The latest static review found that Questioning's result helper requires a
flag not passed by the inspected opposed-roll callers. Its choice therefore
needs manual handling in those routes. Keen Intuition, Observant, Creative,
Scholar and Weak Bones have partial implementation paths whose coverage,
choice, stacking or payment still needs the individual checklist.

The [51 unmatched equipment reviews](entries/unmatched-item-reviews.md) record
each stored profile, related source, execution path, unresolved exact match and
manual handling. Generic gemstone values, ingredient rarity, material-crafting
guidance and ordinary Welkynd stones do not prove the distinct legacy profiles.
The source-only copy and the workspace retain those Items and values unchanged.

New safeguards correct numeric condition creation and Precision Strike penalty
stacking, distinguish overlapping weapon names, and stop recognized natural
weapons when their source profile has not been configured safely. Recognized
shouts with result-dependent costs, Vampiric Drain, Bat Form, Call of the Wolf,
Thrill of the Chase, The Calling, Ancestor Guardian, Ancestor's Wrath and Lord
of the Hunt, Berserker and Controlled Anger now provide manual instructions
before generic cost or use payment. Frenzied bonuses may still be applied by
the existing condition service; inspect them before making manual changes.
Akaviri Danger-Sense no longer automatically rolls for the optional Luck test;
the operator records the manually resolved choice and result in a DialogV2
confirmation. A closed dialog leaves the surprise state unchanged. Named Items
use the shared feature-enabled check, pending live verification. The dialog does
not obtain remote player consent or retain a roll receipt.
The current Ataxia Item also applies its -10 Subterfuge modifier to
Intelligence-based tests. If that modifier appears on such a roll, offset it;
leave it for Agility-based tests. The source-only follow-up removes the broad
modifier and asks the GM to apply it manually for Agility-based tests after a
verified rebuild and reimport. Current Rockjoint Items reduce the Strength
characteristic instead of its bonus; current common Black Heart Blight Items
use fixed penalties instead of an encumbrance-level increase. Their source-only
effect corrections also await a verified rebuild and reimport. The GM reviews
the old effects before adjusting existing actors. Brain Rot's Magicka drain
needs source review.
Older untagged or edited Items, earlier cards, prior costs, existing conditions,
actor Items and partial outcomes are not repaired by these safeguards.

Magic AR or BR on armor and shields no longer by itself implies the Magic
quality for incorporeal damage reduction. Homebrew relying on that inference
can change behavior. Current Adamantium and Stalhrim piece Items still have
the old quality until a verified rebuild and reimport; review them manually.
Existing runed/charged handling and all changed paths need live verification.
The targeted pre-follow-up rollback is recorded in
`release/checkpoints/20261031-core-review-before-v1/manifest.json`.
The surprise workflow's separate pre-change source is recorded in
`release/checkpoints/20261031-surprise-before-v1/manifest.json`.

## Rollback

`release/checkpoints/20261031-plan-before/manifest.json` records the matched
pre-change runtime, source files, audit and five compiled Item pack directories.
Each compiled-pack file was held with exclusive access while copied, and the
saved compiled packs passed comparison against the saved authoring sources.
Restore matching complete directories only after stopping database consumers;
never merge individual LevelDB files. This checkpoint does not undo changes
already made to actors, chat messages or world Items.

## Current safeguards

- **Step Aside, Gladiator and Defender:** an absent cost effect no longer
  qualifies every actor for Step Aside. Its result-dependent reaction, a
  detected Gladiator free defense and a recognized Core Defender activation now
  stop for manual resolution before their relevant costs or writes. Inspect
  old deferred cards, free-defense markers, tokens, attack cards and prior AP
  before making changes. Token visibility, range, other free defenses and
  unrecognized older Items still require GM review.
- **Perfect Hit, Killing Blow and Combat Senses:** Perfect Hit no longer forces
  Perception Bonus; the recognized weapon path gives a manual choice reminder.
  Killing Blow's Power Attack stops before spending SP. Selecting Combat Senses
  stops before the initiative roll and asks for manual resolution; closing its
  choice dialog cancels that selection, and batch choices are no longer cached
  across operations. Its alternate formula now includes the initiative die,
  but tie-breaks, old results and dynamic rerolls still need review.
- **Further combat talents:** Rapid Reload, Unstoppable Might's selected special
  wield mode, Follow-up Strike, Mighty Cleave and Thunder Charge are held for
  manual resolution before the affected resource payment or attack. Follow-up
  Strike now reads the registered setting. Mighty Cleave checks effective
  handedness and does not award attacker Advantage on recognized existing cards;
  those cards and any prior costs still require review. Crackshot no longer
  forces Agility in place of the player's choice. Armored Agility no longer
  reduces an Agility-based armor penalty that the chosen Acrobatics roll did not
  receive. Other entry points and all changes require live verification.
- **Racial activations:** recognized Highborn, Dragonskin, Histskin, Malacath's
  Fury and Ancestor's Protection activations now stop before charging costs or
  uses. Recognized Adrenaline Rush also stops when Adrenaline Burst is enabled.
  Resolve each source-backed action, healing, effect and expiry with the GM;
  inspect existing effects, earlier usage and pending outcomes first. Their
  separately calculated passive contributions remain subject to the individual
  review notes. The Adrenaline Burst interaction with the base power's Fatigue
  alternative is unresolved.
- **Immunity and wounds:** the main damage resolver now checks damage-type
  immunity for each component and excludes immune typed components from its
  Spell Absorption roll. The alternate wound rule now requires the attack to
  bring HP from above zero to zero for that trigger; a target already at zero
  is not treated as newly reduced by a later zero-damage hit. Non-damaging
  immunity effects, mixed damage and all changed paths still need live review.
  Weakness is represented as negative resistance in the current damage path;
  its stated post-mitigation order, zero damage and non-damaging test penalties
  need GM review. Six corrected Weakness descriptions remain source-only.
- **Poison and toxin:** the former coating workflow could spend a dose or change
  a hit count before a resistance card was confirmed. Coating via the reviewed
  entry points now stops before AP, dose, ammunition or aim changes; existing
  poison/toxin coatings and resistance cards are held for GM review. The GM
  records application, successful hits, expiry, resistance and consequences
  manually after inspecting existing Items, chat, effects and prior costs. The
  guard does not repair already applied outcomes, older unrecognized data, or
  an action that was partially completed before this change.

- **Hammerblow:** the attack card provides the options when the declared weapon
  is recognized. On a hit, the player chooses whether to cause 1 SP loss; on
  an All Out Attack they can instead require an Endurance (+0) test. Only a
  failed test causes Dazed. Resolve the choice, test, condition and removal
  manually. The previous automatic SP loss and Dazed application are removed.
- **Death by a Thousand Cuts:** after at least 1 damage following mitigation,
  the attacker may choose Bleeding (1). The choice and condition are manual.
- **Monster Hunter:** the pike Wound Threshold reduction applies only to a
  recorded Large, Huge or Enormous target. Unknown size produces a GM review
  note. The other talent clauses and the alternate wound rules need review.
- **The Whirling School:** declare the special Precision Strike and its neck
  or legs target. After a successful hit, resolve the chosen effect manually
  even when no damage is dealt. The old damage-gated dialog and its implicit
  legs default are removed. The normal Precision Strike is not automatically
  treated as the special strike.
- **Red Legion Throw:** record the speared hit location or shield and handle
  the associated penalties and removal manually. The system no longer applies
  a generic Crippled condition. A fully blocked recognized thrown javelin gives
  a shield reminder. Review ambiguous and already resolved blocks with the GM.
- **Executioner and Knife Fighter:** the relevant 1d4 benefits and Executioner
  Shock penalty remain manual. The attack reminder requires a declared weapon;
  Knife Fighter's later damage reminder now recognizes the Penetrate Armor flag.
  All Out Attack context is not preserved through every damage path.
- **Pugilist:** the previous unconditional +1 damage is removed because the
  source increases the value of Slashing or Crushing, whose armor restrictions
  still apply. Adjust the applicable quality manually. The natural-weapon die
  and open-hand clauses also need separate review.
- **Bruiser and Dart Thrower:** the thrown-weapon damage bonuses are manual.
  The old path could add them to melee attacks and apply mitigation to the
  bonus separately from the attack. Bruiser replaces Dart Thrower's Agility
  bonus for a thrown axe; do not add both. The mace's 1 SP loss after a
  damaging All Out Attack is also manual, because a repeated or unconfirmed
  write could not be recovered reliably. Inspect prior changes before applying
  it. Concussive and the other clauses remain to be verified.
- **Sneak Attack and Assassinate:** the Sneak Attack bonus and the optional
  armor-ignoring choice are manual. The former damage path could apply armor
  and resistance separately to the bonus, and Assassinate's choice was applied
  without asking. The attack card gives a reminder for a recognized declared
  weapon; the GM confirms the attacker was hidden from that target. Resolve the
  bonus and any armor exception with the attack's damage, inspecting any
  already applied damage before making changes.
- **Inspire Heroism:** new successful activations instruct the group to track
  and apply +10 to the ally's next combat test manually. They create no timed
  Inspired effect. A recognized existing Inspired effect blocks a new use for
  GM review; an older queued Inspired outcome is also blocked. Existing effects,
  previously applied outcomes and prior costs are not reversed. The GM should
  inspect them before a bonus is added or an activation is repeated.

These reminders do not establish that an attack hit. Follow the resolved combat
result and check the applicable source clause. The standard attack declaration
offers a collapsible manual-procedure reminder for a recognized selected weapon;
it updates when that selection changes. If the attack card cannot
resolve its declared weapon, consult the talent description. Earlier cards may
retain old text. Separate document writes and concurrent clients are not made
transactional by these changes; inspect the actor, chat and prior costs before
retrying an uncertain operation.

## Remaining review

The per-ID [feature ledger](entries/powers-talents-traits.md) and
[equipment ledger](entries/items-revised.md) include the individual reviews
above and generated open questions for the other entries. Generated questions
identify stored values or clauses that still need comparison and do **not**
represent completed reviews. A selected clause trace, source match or old live
observation does not verify all clauses. Unmatched
entries, unknown gemstone ENC, arcane values and legacy potion prices remain
preserved as uncertainties. No existing actor or world Item has been migrated.

## Deferred native rebuild and live verification

The user requested that the Foundry readback be skipped. The staged corrections
are therefore not promoted, and the current compiled packs remain unchanged.
The procedure below is retained for a future verification pass; it has not been
performed for this update.

The selected first rebuild is still `release/staging/20261029-core-completion-v3`
(revision 20261029-3). Follow [the isolated rebuild instructions](completion-pass-20261028.md)
to copy it to a separate Foundry 14.368+ data directory and use the disposable
`uesrpg-core-authoring` world. As GM, run the documented native helper with
`dryRun: true`, inspect all five counts and errors, then run it with
`dryRun: false`. Capture the native readback result and keep any recovery backup.
Do not copy a partial or failing database.

After a clean shutdown, compare all five complete pack directories to the
selected staging sources and verify exclusive access. Retain the previous
matched set before promotion. Only then prepare and natively rebuild the later
source-only follow-up, `release/staging/20261031-core-review-v7`, using an
isolated system copy with properly prepared pack directories, its own readback
and complete comparison. It contains no compiled packs. Refresh the isolated runtime from
the final workspace and rebuild the staged distribution only after the code and
packs match. No installed-system deployment or public release is authorized by
this plan.

The remaining isolated-world scenarios include every changed feature, normal
and zero-damage hits, blocked attacks,
selection cancellation, target sizes, old effects and pending cards, resource
costs, permissions, partial writes and concurrent clients. Inventory, potions,
ammunition, containers and zero-ENC boundaries also remain to be checked.
Use the detailed [future live checklist](core-review-live-checklist-20261031.md)
to record results by scenario. Unrun cases stay unverified; static checks do not
substitute for them.
