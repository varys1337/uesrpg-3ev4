# Core review follow-up: future live checklist

**Not run.** This checklist is for a later authorized verification pass in a
disposable Foundry 14.368+ world, after the applicable source changes have been
natively rebuilt and read back. The current instruction skips that work. Record
the system source hashes, Foundry version, GM/player roles, result and any
observed console messages for every case; do not mark a broad category passed
based on one example. Do not use production actors or Items.

1. **Provenance and configuration.** Compare a freshly imported Core Item, a
   renamed or edited copy, an older untagged copy and a disabled feature. Check
   that the guard and warning apply only when identity is established. Confirm
   old world Items and prior effects were not silently changed.
2. **Attacks and choices.** Check successful, failed, zero-damage and fully
   blocked attacks. Exercise Hammerblow, Death by a Thousand Cuts, The Whirling
   School, Red Legion Throw, Sneak Attack, Assassinate, Bruiser, Dart Thrower,
   Executioner, Knife Fighter, Pugilist and the relevant weapon expertise with
   each permitted choice and cancellation. Verify manual reminders against the
   declared weapon and actual result; apply a manually resolved cost or effect
   only once. Test Large and smaller targets, unknown size, and Great Flail vs
   Flail, Dai-Katana vs Katana and thrown-capable melee weapons.
3. **Precision and natural weapons.** Compare ordinary and Precision Strikes
   with Precise, Eye of Night and Viper's Eye separately and together. For
   Cestus and Punch Dagger, try missing and configured natural-weapon damage,
   Pugilist and Eye of Night. For Werebear bite and claw, try neither, one and
   both alternative qualities, then choose the other alternative. Confirm
   incompatible source profiles are stopped before costs where supported.
4. **Conditions and armor.** Apply Bleeding and Burning to a new condition and
   an existing condition, including immunity and bloodless targets. Check From
   Oblivion's Heart on a wound, a non-wound, an interrupted update and retry.
   Check Incorporeal damage against armor with and without the Magic quality,
   Magic AR/BR alone, the corrected Adamantium and Stalhrim pieces, and
   representative homebrew, runed and charged Items. Resolve existing doubled
   conditions and legacy armor individually; no automatic repair is provided.
5. **Shouts.** Try one and two words for Fleshrend, Frost Breath, Dismay, Slow
   Time and Unrelenting Force, plus Disarm. Check known words, each difficulty,
   success and failure, targets, area evasion, optional choices, effects and
   expiry. Confirm a successful one-word shout incurs no word-based SP cost,
   a failed shout loses one SP, and extra words and relevant Voice talents are
   handled correctly. Track recovery and inspect any earlier payment before
   proceeding. Cancelling the guarded activation must spend no cost or use.
6. **Other manual powers.** Work through Vampiric Drain including reflected
   casts, damage reduction, healing and thirst; Bat Form including its Secondary
   Action, 1 SP, refreshed duration, zero-HP reversion and restoration; Call
   of the Wolf including beast form, listeners, Panic, 1 AP, daily use and
   Bestial Instinct; Thrill of the Chase and its round and direction limit; The
   Calling and its repeated tests and group alternative; and Ancestor Guardian
   and its action, use, fear exception and departure. The guard must charge no
   resource or use; resolve the source procedure manually once.
7. **Racial talents and Inspire Heroism.** Verify Ancestor's Wrath, Lord of the
   Hunt and the selected older racial workflows with costs, targets, cooldowns,
   effects and expiry. Check Inspire Heroism for its next combat test, existing
   effects and pending outcomes. Inspect any earlier effects or use before
   applying a manual bonus or repeating an activation.
   Also check Berserker and Controlled Anger with voluntary and involuntary
   Frenzy, one-time use, existing Stamina and pending end effects. Verify
   Rage-fueled Frenzy and 'Tis But a Scratch separately and together; the GM
   tracks the latter's affected wounds manually until that clause is resolved.
8. **Inventory and purchases.** Check quantities and encumbrance, zero-ENC and
   fractional values, stack splits, purchase units and per-ten ammunition
   prices. Test worn armor, materials and qualities. Preserve uncertain values
   until exact source evidence is available.
9. **Containers, ammunition and potions.** Exercise nested and invalid
   containment, capacity, item transfers, full and empty ammunition stacks,
   reload and last-shot damage, standard and unusual potions, consumption,
   cancelled choices, expiry and recovery. Verify what happens when an Item or
   target is deleted or changed during a pending operation.
10. **Permissions and recovery.** Repeat affected paths as the owning player,
    a non-owner and the GM. Try missing permissions, cancelled confirmations,
    failed or interrupted Item, Actor, effect and chat writes, repeated clicks
    and two simultaneous clients. Inspect resources, Items, effects and chat
    before any retry. Local locks and separate document writes do not prove
    cross-client serialization or transactional recovery.
11. **Birthsign powers and surprise.** For Mara's Gift, Blessed Touch and
    Blessed Word, verify the selected blessing, replacement at rest, daily use,
    duration and complete manual outcome; check optional Luck burn and partial
    wound or HP writes. Check Moonshadow's optional Luck extension, temporary
    break and reformation, and Treasure Seeker's eligible failed test and use.
    For Akaviri Danger-Sense, let the player decline or manually attempt the
    Luck test; verify success, failure, closing the confirmation, a changed
    combat or state, disabled or renamed Items, denied updates and concurrent
    clients. The dialog records the operator's decision, not a remote consent
    or a durable roll receipt; inspect prior results before repeating.
12. **Diseases.** Compare Ataxia with Agility- and Intelligence-based
    Subterfuge tests and Block; verify the current Item's broad penalty and the
    source-only correction after rebuild and reimport. Check Brain Rot's
    Magicka drain against the complete source rules and both resource pools.
    Check each reviewed Ash Chancre and Chanthrax stage, gestation, Endurance
    tests, shared Diseased and Social Stigma effects, stage transitions,
    Frenzied at Ash Chancre stage three and cure. Inspect duplicate stage Items,
    disabled effects and partial or concurrent writes before adjustment.
    Check Rockjoint's Strength Bonus and common Black Heart Blight at each
    encumbrance level, plus the manually resolved Blood Lung, Droops, Bone
    Break Fever, Frostlimb and Red Fever clauses.
    Also check the three reviewed stages of Ash Woe and Black-Heart Blight,
    Astral Vapors, Lycanthropic Disease and Vampiric Disease. Track weaknesses,
    Stunted Magicka, sunlight, the source wound, progression and transformations
    individually; these clauses are not established as one automated outcome.
    Check Swamp Fever's transmission and seven-day cure, Yellow Tick contact,
    Witbane's Magicka drain, fine-motor tests for The Rattles and Rust Chancre's
    Ugly trait and post-cure test. Verify the remaining reviewed common
    diseases' characteristic, Speed, AP, skill and all-tests changes separately.
13. **Character traits.** Check the reviewed pain, disease-resistance,
    lingering-injury, unlucky-number, Blind, surprise, initiative, Lore and
    Acrobatics clauses. Confirm enabled and disabled Items and review existing
    actor adjustments before applying a manual modifier or session reroll.
14. **Remaining feature and coating safeguards.** For Step Aside, compare an
    actor with neither the talent nor a cost effect, an enabled and disabled
    talent, and explicit cost effects; try successful and failed Evade reactions,
    old deferred cards and each other free-defense source. Confirm the guarded
    case spends no AP and inspect earlier rolls and costs. For Gladiator and
    Defender, check distances, opponent counts, once-per-round state, token and
    attack-card updates, cancellation, simultaneous clients and interrupted
    writes. For Killing Blow, confirm the guard runs before SP is spent and
    inspect older Power Attack effects and already applied damage. For Perfect
    Hit, choose Strength or Perception with each eligible quality, armor
    restriction, ammunition and previously resolved damage. For Combat Senses,
    check single and batch choices, closing each dialog, normal and alternate
    ratings, Lightning Reflexes, tie-breaks and interrupted initiative writes.
    Review all other clauses in `entries/feature-clause-reviews.md` individually.
    For poison and toxin, check both the sheet's Use Item action and direct
    weapon/ammunition application: no AP, dose, ammunition, coating or aim state
    should change when guarded. Inspect pre-existing coatings and old resistance
    cards; verify zero damage, successful hits, expiry and manual tracking.
    Check permissions, partial writes, concurrent clients and prior chat before
    retrying. Confirm the seven legacy rarity poisons have no alchemy payload and
    keep the 51 unmatched profiles unchanged until exact evidence is available.
15. **Additional combat talents.** Verify Rapid Reload at zero and nonzero
    reduced cost, including the old reload state, ammunition, AP and interrupted
    updates. For Unstoppable Might, choose normal, special and close the prompt
    on attack and defense; confirm two-handed damage, Parry/Counter restrictions
    and Dual Fighter interactions with the GM. Check Follow-up Strike with its
    setting enabled and disabled, failed and successful attacks and earlier SP
    or cards. Check Mighty Cleave with one- and two-handed weapons, special wield
    modes, both target distances, cancelled choice, one roll, independent
    defenses and damage, attacker and defender Advantage and old cards. Verify
    Thunder Charge's Dash distance and direction, AP, old activation and toggle.
    For Crackshot and Perfect Hit, compare arrow type, chosen characteristic,
    armor restrictions and already applied damage. Verify Armored Agility with
    Agility and other chosen characteristics, each armor penalty and rank. The
    reviewed manual procedures and all other paths remain unverified.
16. **Racial feature clauses.** Verify the individual passive Power Well,
    disease immunity/resistance, Poison/Frost/Magic resistance, Speed, Tough,
    Resilient and Star of the West contributions with standard, missing,
    disabled, duplicate and edited Items and pre-existing manual adjustments.
    For Highborn, Dragonskin, Histskin, Malacath's Fury and Ancestor's
    Protection, confirm the recognized activation stops before use or cost and
    supplies the correct manual procedure. Check Adrenaline Rush both with and
    without enabled Adrenaline Burst, including Fatigue and encounter expiry.
    Review prior healing, absorption, Sanctuary, AP/SP, use records and queued
    effects before retrying; verify permissions, interruptions and concurrency.
17. **Immunity, resistance, weakness and wounds.** For each reviewed damage
    type, compare an enabled and disabled immunity with ordinary, zero,
    mixed-component and ignore-reduction damage, positive damage-taken effects,
    Spell Absorption and earlier results. Check Paralysis and Disease immunities
    separately for non-damaging conditions and acquisition. For the Resistance,
    Weakness, Disease Resistance, Power Well, Natural Toughness and Resist Normal
    Weapons templates, supply source-backed X values, use duplicate and edited
    Items, and inspect damage type, mitigation order, opposing tests and legacy
    fields. Under alternate wounds, compare an attack that brings positive HP to
    zero, a later zero-damage hit against an actor already at zero, immunity,
    temporary HP, critical hits and standard wound mode. No case is yet verified.
18. **Additional character traits.** Check the 20 individual reviews for
    Direction Sense, Addictions, Aversion, Combat Paralysis, Common Sense,
    Disturbing Voice, Oblivious, First Impression, Attractive, Amnesia, Timid,
    Dampened Senses, Incompetent, Good with Animals, Brave, Preferred Enemy,
    Situational Awareness, Unremarkable, Illiterate and Ugly. Confirm each
    selected subject, circumstance, modifier, reroll or duration with the GM;
    check that any manual modifier is not already applied. Verify Illiterate
    with Polyglot and disabled or legacy Items. No scenario has been run.
19. **Awareness and intellectual features.** Review Light Sleeper, Naive,
    Keen Intuition, Stubborn, Observant, Attention to Detail, Big Words,
    Questioning, Creative, Scholar, Weak Bones and Social Stigma using their
    individual source clauses. Check each offered or manual choice, skill
    route, stored roll, rank, disabled or duplicate Item, modifier, acquisition
    restriction and payment. Inspect the Questioning flag, Scholar XP and
    specialization cap, Creative stacking and Weak Bones on each actor type;
    verify cancellations, permissions, interrupted writes and concurrent use.

Record individual failures and unresolved cases in `verification.json` and
the corresponding per-Item ledger. Re-run only the affected scenario after an
authorized correction; keep all other cases not run until observed.
