# Feature clause reviews

These static reviews record each examined clause and its execution path. Manual procedures and outstanding questions remain; no current change is live verified.

## Step Aside (`0goei81tdG76XIX4`)

Source: Chapter 4, p. 80. The character can easily dance through a swirling melee unharmed. Expert (Agility) Evade reactions against attacks of opportunity cost 0 AP unless the character fails the associated evade test.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** An Evade reaction against an attack of opportunity costs 0 AP on success and its normal cost on failure.
  - Paths: `src/core/traits/mobility-talents.js#shouldDeferEvadeApForStepAside`, `src/core/combat/opposed/actions/defender-commit.js`, `src/core/combat/opposed/actions/defender-roll.js`
  - Finding: The prior default zero Active Effect was treated as a free-cost contribution even without the talent; detection now requires an actual contribution or enabled talent. The result-dependent reaction is held before payment because the roll and cost are separate writes.
  - Manual handling: Confirm the attack and any prior roll or payment; roll Evade and charge the applicable AP only on failure. Earlier deferred cards and unrecognized attack labels require GM review.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Red Legion Throw (`1F5hkG8qxqoHhpSJ`)

Source: Chapter 4, p. 87. The character is skilled in the use of the javelin and knows the value of a well aimed throw. Expert (Strength, Agility) When a character throws a Javelin and successfully causes damage to the target (after mitigation), the target location (either a limb or the body) is Speared. A Speared hit location is treated as crippled until the Javelin is removed, either as a Free Action inflicting the Bleeding(1) condition or as a Secondary Action requiring a strength test, which if successful removes the spear without causing further harm. If the Javelin is blocked instead, the shield is Speared. A speared shield requires the wielder to spend one Stamina point in order to even attempt to block with the added weight of the javelin. Removing the javelin from the shield requires the character to succeed on a Strength test as a Secondary Action.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A damaging thrown javelin spears a limb or body; remove it as a Free Action with Bleeding 1 or a Secondary Action and successful Strength test.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: The incorrect generic Crippled application was removed; location, removal choice, action and consequence remain manual.
  - Manual handling: Confirm thrown javelin and post-mitigation damage, record the speared location and removal method, and reconcile any old condition first.
- **Clause:** A blocked javelin spears the shield; blocking requires 1 SP until a Secondary Action Strength test removes it.
  - Paths: `src/core/combat/opposed/actions/attacker.js`, `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`
  - Finding: The recognized blocked path provides a reminder, not a persistent shield state or cost.
  - Manual handling: Record the specific shield, each required SP and the removal test; inspect prior costs and older cards before making changes.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Lionheart (`1GuMmeqXCsDwx4As`)

Source: Chapter 4, p. 88. The Breton is steeled to magic, and taps deeper into their own merish blood to access yet more power. Adept (Any) The Breton gains an additional Power Well (10) and increases their Resistance (Magic) trait by +1.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain an additional Power Well (10).
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds 10 MP for a single enabled talent and standard Power Well (10) without an explicit MP bonus.
  - Manual handling: Check the base Power Well, actor total and manual adjustments before applying the upgrade.
- **Clause:** Increase Resistance (Magic) by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: One standard Resistance (Magic, 2) can be upgraded; duplicate, missing or altered traits are deliberately left ambiguous.
  - Manual handling: Inspect Magic Resistance and the relevant resistance-test option before adding the missing value once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Rapid Reload (`1ceAtTTHztrXxNp4`)

Source: Chapter 4, p. 77. The character is able to quickly reload to take a second shot. Journeyman (Agility) The character reduces the Reload quality of any ranged weapons they wield by 1 (to a minimum of 0, a Free Action).

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce Reload quality by one, to a minimum of zero and a Free Action.
  - Paths: `src/ui/sheets/shared/listeners/combat-actions.js`, `src/core/traits/talents-api.js`
  - Finding: The reload shortcut computes the one-point reduction but spends AP, updates the weapon and posts chat separately; local locking does not prove safe recovery between clients. Recognized Rapid Reload and Dual Rapid Reload Fighter uses now stop before those writes.
  - Manual handling: Confirm the equipped weapon and its Reload value, reduce it once to a minimum of zero, and manually record AP, reload progress and loaded state after inspecting any previous operation.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Eye of Night (`1hl9YFooGyjt8z4F`)

Source: Chapter 4, p. 89. Sharp claws and sharp eyes pave the way. Adept (Any) The Khajiit increases the size of their Natural Weapon damage dice by one step (d4 becomes d6, d12 becomes 2d8, etc), and can make a free Precision Strike with their first attack made while Hidden at night time or in total darkness. See Unarmed Combat on page 104 for details on Natural Weapons.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase the natural-weapon damage die by one step.
  - Paths: `src/core/combat/opposed/damage/roller.js#rollWeaponDamage`
  - Finding: The roller recognizes Hand to Hand quality as its trigger rather than a complete natural-weapon identity. Its step-up can overlap Pugilist or a manually upgraded base die.
  - Manual handling: Confirm the weapon is a natural weapon, the base die and any other upgrade; apply the source-backed step once.
- **Clause:** Make a free Precision Strike with the first attack made while Hidden at night or in total darkness.
  - Paths: `src/core/traits/racial-talents.js#applyRacialTalentAttackPreTN`, `src/core/combat/opposed/dialogs/attacker.js`
  - Finding: The attack dialog offers a checkbox when Hidden; the operator establishes darkness and first eligible attack, and the penalty-removal path accounts for Precise.
  - Manual handling: Confirm night or total darkness, Hidden and first eligible attack before selecting; inspect any Precision modifier already applied.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unnaturally Agile (`3HjmL1zCp90f7CkF`)

Source: Chapter 4, p. 80. The character is so fast they can even dodge arrows. Adept (Agility) If the character successfully evades an area of effect attack, then they may immediately move a number of meters equal to their Evade skill rank. If this move would allow them to escape the affected area, they take no damage from the attack. This movement does not count toward their total movement for the round.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A successful area Evade permits an immediate extra move equal to Evade rank; escape prevents damage and that move does not count toward the round movement.
  - Paths: `src/core/combat/opposed/helpers/workflow.js#maybeSetAoEEvadeEscape`, `src/core/magic/opposed/spell-helpers.js#maybeResolveAoEEvadeEscape`
  - Finding: The inspected area-escape paths use a one-meter step and do not consult this talent; no talent-specific extra movement or exclusion from movement tracking was established.
  - Manual handling: After a successful Evade, the player and GM determine the rank-based move, area exit and damage, and record the extra movement separately.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## High Men (`3cUea1h3K9i7JYIx`)

Source: Chapter 4, p. 90. The men of Yokuda are unaffected by such trifling things as disease or venom. They are above it. Adept (Any) The Redguard becomes Immune to Disease, and increases their Resistance (Poison) trait by +1.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain Disease Immunity.
  - Paths: `src/core/traits/racial-talents.js#applyRacialTalentDerivedBonuses`, `src/core/traits/trait-registry.js`
  - Finding: The derived trait profile grants immunity for an enabled talent without deleting existing disease-related Items.
  - Manual handling: Inspect current disease immunity and existing entries before adding any manual override.
- **Clause:** Increase Resistance (Poison) by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: A single standard Resistance (Poison, 3) and no explicit talent poison bonus enable the contributor; altered or duplicate traits need review.
  - Manual handling: Confirm the base and current poison resistance, including manual adjustments, and add any missing increment once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Skirmisher (`41dL1uMtReW39EGF`)

Source: Chapter 4, p. 76. The character is able to fire on the move. Journeyman (Agility) The character can make a ranged attack as a Free Action whenever they take the Dash action but at a -20 penalty.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Whenever the character Dashes they may make a ranged attack as a Free Action at -20.
  - Paths: `src/ui/sheets/shared/listeners/combat-actions.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: No named Skirmisher character-talent trigger was established in the inspected Dash and attack paths; similarly named mass-combat units are separate.
  - Manual handling: Confirm the Dash, choose an eligible ranged attack and apply -20, ammunition and the Free Action manually; inspect prior costs or shots.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Ancestor's Wrath (`4BavHaWi0LX93Tgh`)

Source: Chapter 4, p. 89. The Dunmer has a special bond with their ancestor, who is capable of manifesting from beyond to lend their aid in battle. Expert (Any), Requires Ancestor’s Protection Increase the Sanctuary spell gained from the Ancestor’s Protection talent from level 2 to level 3. Additionally, once per long rest, the character can use a Secondary Cast Magic Action to cast the Fire Cloak spell at level 2. The spell lasts for three rounds, costs no Magicka Points, and requires no test to successfully cast.

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":1,"period":"longRest","current":1}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase the inherited Sanctuary spell from level 2 to level 3.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/features/feature-config.js`
  - Finding: The recognized activation is held, but an automatic upgrade to an existing Sanctuary spell is not established.
  - Manual handling: The GM checks the existing Sanctuary entry and uses level 3 without duplicating an earlier adjustment.
- **Clause:** Once per long rest use a Secondary Cast Magic Action for level-2 Fire Cloak lasting three rounds with no MP or test.
  - Paths: `src/core/system/activation/activation-executor.js`
  - Finding: The current workspace Item says Passive; the source-only follow-up changes the action label. The recognized activation stops before generic use or costs.
  - Manual handling: Track the long-rest use, Secondary Action and three rounds; apply Fire Cloak manually with no Magicka cost or cast test and inspect prior uses.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Dual Fighter (`5FYHzbaXeCqah809`)

Source: Chapter 4, p. 75. The character is particularly skilled at fighting with two weapons, fluidly weaving attacks and parries together. Master (Strength, Agility) When wielding two weapons, the character raises the maximum number of melee attacks they are allowed to make in one round from two to three as long as they use each weapon to attack at least once.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** While using two weapons, allow a third melee attack only when each weapon is used at least once that round.
  - Paths: `src/core/combat/attack-tracker.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: The tracker gives a talent-based maximum of three; the complete enforcement of melee-only use and each-weapon requirement across all attack entry points is not established.
  - Manual handling: Track the two declared weapons and each attack manually; do not use the third unless both weapons have been used and the group confirms the round limit.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Killing Blow (`5HgYxYtgri8sRu8c`)

Source: Chapter 4, p. 74. The character can put all of themself into a single attack aimed to end the fight. Master (Strength) Requires Crippling Strikes When the character spends a Stamina point to make a power attack, they add three times the amount of stamina spent to a maximum of 3SP for +9 damage.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A Power Attack adds three damage per SP spent, up to 3 SP and +9 damage.
  - Paths: `src/core/stamina/stamina-spend.js#spendStaminaOption`, `src/core/combat/damage/resolver/resolve.js`
  - Finding: The old stamina workflow spent SP before creating the one-use effect and chat record; its outcome was not durably recoverable across partial writes. Power Attack for an enabled Killing Blow owner is now held before SP is spent.
  - Manual handling: Choose 1–3 SP and calculate +3 per SP as part of the attack; check existing effects, SP, chat and damage before recording each change once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Combat Paralysis (`6IGdLjIsj1FGz2Pk`)

Source: Chapter 2, p. 56. +3 Trait Points The character has a habit of freezing in dangerous situations, and must make a Willpower test any time combat breaks out. If they fail, they cannot take any actions or reactions during the first Round.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** At the start of combat, fail a Willpower test and take no actions or reactions during the first round.
  - Paths: `src/core/combat/surprise-state.js`, `src/core/traits/features/contributors.js#contributeTraitMods`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: At combat start roll Willpower once; on failure track the first-round action and reaction restriction and remove it after that round.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Poison) (`6WPqBoNulGtd4ekr`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to effects of the specified poison type.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/combat/damage/resolver/resolve.js#applyDamageResolved`, `src/core/combat/damage/apply.js`
  - Finding: The stored trait parameter is poison, the activation is passive and there are no embedded effects. The profile recognizes this damage type. The main resolver previously omitted immunity; it now zeroes immune components before damage modifiers and excludes them from typed Spell Absorption. Non-damage poison effects and every entry point are not established.
  - Manual handling: Confirm that the enabled Item and incoming effect are of the specified type. Inspect any earlier damage or conditions; the GM manually prevents unsupported non-damaging effects and resolves mixed damage once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Dragonskin (`6fMqxbAYgrajQFCL`)

Source: Chapter 4, p. 88. The Breton taps into ancient Merethic powers, drinking in the powers of their ancestral enemies like a nourishing milk to slake their unquenchable thirst for magic. Expert (Any), Requires Lionheart The Breton can spend a Stamina as part of a Free Action to gain the Spell Absorption (5) trait for one round.

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":1,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Spend one SP as a Free Action for Spell Absorption (5) for one round.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/racial-talents.js#handleRacialTalentActivation`, `src/core/magic/damage-application.js`
  - Finding: The former one-round effect is only consumed by selected magic paths and does not establish all effect-only magic or Reflect ordering. Recognized Core activation now stops before spending SP.
  - Manual handling: Check prior SP and effects; pay 1 SP, resolve Spell Absorption for each applicable incoming spell and its expiry manually. The Free Action label exists only in the unbuilt follow-up.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Teamwork (`6ryQeAIE7S6tIiEA`)

Source: Chapter 4, p. 77. The character is able to coordiante their efforts with their allies. Novice (Perception) The character adds a bonus degree of success to any successful Combat Style tests made to attack or defend against opponents in melee range as long as that opponent is also within melee range of an ally who also has this talent.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A successful Combat Style attack or defense against an opponent in melee range gains one DoS when a nearby ally with Teamwork also has that opponent in reach.
  - Paths: `src/core/traits/combat-talents-dos.js#applyCombatTalentDoSAdjustments`, `src/core/traits/combat-proximity.js#hasAllyWithTalentInMeleeOfOpponent`
  - Finding: The opposed path checks an allied token with the talent and adds one; it uses a fixed two-meter ally reach, excludes hidden/neutral tokens and classifies non-Evade results broadly as Combat Style.
  - Manual handling: Confirm both talents, the actual opponent and each reach, eligible successful Combat Style test and any DoS already added; correct once with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Direction Sense (`796MFisXWyYgXBsh`)

Source: Chapter 2, p. 55. 1 Trait Point The character has a good sense of direction, and can always find north when outdoors. Additionally, the character can reroll one failed Navigate test per Long Rest.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Always find north when outdoors; reroll one failed Navigate test per Long Rest.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM identifies north outdoors. Track the once-per-Long-Rest reroll and the failed Navigate result manually; inspect existing rolls before rerolling.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Eye of Vengeance (`7jnFT4rUwv2aomvS`)

Source: Chapter 4, p. 75. The character’s well aimed shots can inflict terrible wounds. Apprentice (Agility) The character treats all enemy Wound Thresholds as being one lower than normal when making ranged attacks. Optional Rule Note: Alternate Wounds If your group is using the alternate rules for Wounds defined in the Physical Health section in Chapter 5, replace the rules of the Eye of Vengeance talent with the following: “The character causes enemies wounded by them with a ranged weapon attack to have a -10 penalty to their shock test. This stacks with any other penalties to shock tests.”

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Under standard wounds, ranged attacks reduce enemy Wound Threshold by one.
  - Paths: `src/core/traits/combat-talents.js#getEnemyWoundThresholdDelta`, `src/core/combat/damage/resolver/resolve.js`, `src/core/wounds/wound-rules.js`
  - Finding: The resolver applies the ranged threshold adjustment in its weapon context; threshold-zero and other damage paths require review.
  - Manual handling: Confirm the ranged attack, damage and target threshold; do not apply the adjustment twice.
- **Clause:** Under alternate wounds, replace the threshold rule with a stacking -10 Shock-test penalty for a ranged weapon wound.
  - Paths: `src/core/wounds/wound-rules.js`, `src/core/combat/damage/resolver/resolve.js`
  - Finding: The inspected alternate wound route does not establish the talent-specific Shock penalty; a threshold note can still be produced.
  - Manual handling: Determine the ranged wound under alternate rules and manually add the -10 Shock penalty once after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Addictions (`86KAVUIRr02HDGhO`)

Source: Chapter 2, p. 56. +2 Trait Points The character is addicted to some substance, such as alcohol, moonsugar, skooma, or even more alien or outlandish drugs such as felldew. Should the character not be able to indulge in the drug regularly (more accessible drugs require more frequent access), they suffer a -10 penalty on all tests, which increases in severity by an additional -10 to a maximum of -30 for each passing day until they get their fix.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Without regular access to the chosen substance, all tests suffer -10, increasing by -10 per day up to -30 until the character gets a fix.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Agree the substance and required frequency, track missed access and days, and apply the current -10/-20/-30 penalty to each relevant test until the condition ends.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Armored Agility (`A7v6qg3fYOoJEjes`)

Source: Chapter 4, p. 80. With enough training even heavily armored warriors can maneuver with grace. Expert (Agility) The character reduces Acrobatics test penalties gained from their armor class by their Acrobatics skill rank minus 1 multiplied by 10.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce only Acrobatics penalties from armor class by (Acrobatics rank minus one) times ten.
  - Paths: `src/core/traits/mobility-talents.js#getArmoredAgilityAcrobaticsBonus`, `src/core/skills/skill-tn.js`
  - Finding: The skill path caps the benefit at counted armor penalties. It previously included an Agility-based armor penalty even when the chosen Acrobatics characteristic did not receive it; the call now includes only an applied Agility penalty. Other armor and selected-characteristic combinations remain unverified.
  - Manual handling: Check the chosen characteristic, Acrobatics rank and each actually applied armor penalty; do not reduce unrelated penalties or add the benefit twice.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Silver) (`BfWJnlMiKly0UAf7`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase silver damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores silver and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed silver sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging silver effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic silver weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Power Well (X) (`Bkf01VPm7lvsbQ7f`)

Source: Chapter 4, p. 93. Characters with this trait have more magicka than usual. The size of their Magicka Pool is increased by X. If the character would receive this trait twice, combine the X values.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase the Magicka Pool by X; combine values if the trait is received more than once.
  - Paths: `src/core/traits/trait-registry.js#getTraitNumericBonuses`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/actors/prepare/shared/humanoid-derived.js`
  - Finding: The template has X=0. Numeric trait values are gathered into Magicka bonuses and the aggregation sums Items; racial upgrades and legacy explicit bonuses may overlap.
  - Manual handling: Set each source-backed X and inspect the derived Magicka and any racial or manually entered bonus before adding another contribution.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Aversion (`C0C7uC2oMCQCL3Cm`)

Source: Chapter 2, p. 56. +1 Trait Point per Y The character is afraid of or averse to something (X). This can be used to represent a phobia, compulsive avoidance, or strong dislike of a certain thing. When exposed to their aversion, the character suffers a -10 per Y on all tests.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** When exposed to the chosen aversion X, suffer -10 per chosen Y on all tests.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Record the chosen aversion and severity Y; the GM confirms exposure and applies -10 per Y once to affected tests.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Frost) (`Cldx7icGtZwk4clj`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to effects of the specified frost type.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/combat/damage/resolver/resolve.js#applyDamageResolved`, `src/core/combat/damage/apply.js`
  - Finding: The stored trait parameter is frost, the activation is passive and there are no embedded effects. The profile recognizes this damage type. The main resolver previously omitted immunity; it now zeroes immune components before damage modifiers and excludes them from typed Spell Absorption. Non-damage frost effects and every entry point are not established.
  - Manual handling: Confirm that the enabled Item and incoming effect are of the specified type. Inspect any earlier damage or conditions; the GM manually prevents unsupported non-damaging effects and resolves mixed damage once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Crippling Strikes (`D4KZcKAbmSYFNQ5q`)

Source: Chapter 4, p. 74. The character can direct and focus the force of their blow to inflict bone-shattering injuries. Apprentice (Strength) The character treats all enemy Wound Thresholds as being one lower than normal when making melee attacks. Optional Rule Note: Alternate Wounds If your group is using the alternate rules for Wounds defined in the Physical Health section in Chapter 5, replace the rules of the Crippling Strikes Talent with the following: “The character causes enemies wounded by them with a melee weapon attack to take a -10 penalty to their shock test. This stacks with any other penalties to shock tests.”

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Under standard wounds, melee attacks reduce enemy Wound Threshold by one.
  - Paths: `src/core/traits/combat-talents.js#getEnemyWoundThresholdDelta`, `src/core/combat/damage/resolver/resolve.js`, `src/core/wounds/wound-rules.js`
  - Finding: The resolver applies the melee threshold adjustment in its weapon context; exact behavior at threshold zero and alternate damage paths is not established.
  - Manual handling: Check attack mode and target threshold before applying a wound; do not stack the adjustment twice.
- **Clause:** Under alternate wounds, replace the threshold rule with a stacking -10 Shock-test penalty for a melee weapon wound.
  - Paths: `src/core/wounds/wound-rules.js`, `src/core/combat/damage/resolver/resolve.js`
  - Finding: The alternate mode changes the wound trigger; the inspected talent handler still reports the threshold reduction and does not establish this Shock penalty.
  - Manual handling: With alternate wounds enabled, determine the wound and manually include the -10 Shock penalty once; inspect the roll and other penalties first.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Blood of Aldmeris (`DzglL6dvx2ZrCmZb`)

Source: Chapter 4, p. 88. The Altmer directly traces their unbroken family line to Aldmeris, and is empowered by their lineage. Adept (Any) The Altmer receives an additional Power Well (10), and increases their Disease Resistance trait by an additional 25%.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain an additional Power Well (10).
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds 10 Magicka only with one enabled unmodified standard Power Well (20) and no explicit talent MP bonus; altered or duplicate source traits are not automatically inferred.
  - Manual handling: Inspect the Power Well, feature modifiers and any manual Magicka adjustment before adding a missing benefit.
- **Clause:** Increase Disease Resistance by 25 percentage points.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds 25 only for one standard Disease Resistance (50%) and no explicit talent disease bonus; resistance selection and stacking remain unverified.
  - Manual handling: Check the base trait and current derived disease resistance; apply any missing upgrade once and verify disease tests with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Fire) (`EsZ7yvlMWPNbncuH`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to effects of the specified fire type.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/combat/damage/resolver/resolve.js#applyDamageResolved`, `src/core/combat/damage/apply.js`
  - Finding: The stored trait parameter is fire, the activation is passive and there are no embedded effects. The profile recognizes this damage type. The main resolver previously omitted immunity; it now zeroes immune components before damage modifiers and excludes them from typed Spell Absorption. Non-damage fire effects and every entry point are not established.
  - Manual handling: Confirm that the enabled Item and incoming effect are of the specified type. Inspect any earlier damage or conditions; the GM manually prevents unsupported non-damaging effects and resolves mixed damage once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Resist Normal Weapons (`FJnMMla8HqpIjqGK`)

Source: Chapter 4, p. 93. Characters with this trait are resistant to mundane weapons. If the character suffers damage from a weapon/attack without the Magic quality, reduce that damage by X after any other mitigation.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce damage from attacks without the Magic quality by X after other mitigation.
  - Paths: `src/core/combat/damage/resolver/resolve.js#applyDamageResolved`, `src/core/combat/damage/reduction.js#isItemMagicSource`
  - Finding: The template has X=0. The resolver applies the highest value after positive damage, while the source-recognition helper also treats certain silver, runed or charged weapon states as magic; equivalence to the source’s Magic-quality rule needs review.
  - Manual handling: Set X from the source, confirm the actual attacking weapon/attack and Magic quality, then check whether the post-mitigation reduction has already been applied.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Brawler (`FPr5ed5cq5rtZJPa`)

Source: Chapter 4, p. 74. The character is used to fighting in chaotic brawls and can use that chaos to their advantage. Novice (Strength, Agility) The character adds a bonus degree of success to any successful Combat Style or Evade tests made while within melee range of two or more opponents.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Successful Combat Style or Evade tests while within melee range of at least two opponents gain one rolled DoS.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: The opposed path adds one when its token count is at least two and the tested opponent is in range; it can treat non-Evade tests as eligible and excludes hidden or neutral tokens. Coverage of independent tests is unresolved.
  - Manual handling: Confirm the test and number of opponents with the GM; inspect the roll before adding or removing a single DoS.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Malacath's Fury (`FrMBvu2WVLEvHhF0`)

Source: Chapter 4, p. 90. The Orsimer can tap into the primal fury of Malacath. Expert (Any), Requires Wrothgarian The Orsimer increases their bonus HP from their Resilient trait by yet another 2 (total 7). Additionally, once per Long Rest, as a Free Action, the Orsimer can immediately heal themselves for EB Health Points then increase their Strength Bonus and Resistance (Magic) trait by EB / 2 (round down) for 1 minute.

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":1,"period":"longRest","current":1}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase Resilient HP by two more, for a total of seven.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`
  - Finding: The contributor requires one enabled Wrothgarian and recognized Resilient values; edited traits or separately recorded HP remain ambiguous.
  - Manual handling: Inspect Wrothgarian, Resilient and existing HP bonuses before adding the increase once.
- **Clause:** Once per Long Rest as a Free Action heal EB HP, then gain EB/2 rounded down to Strength Bonus and Magic Resistance for one minute.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/racial-talents.js#handleRacialTalentActivation`
  - Finding: The former use, healing and timed-effect writes were separate. Recognized Core activation now stops before use; existing effects or queued outcomes are not repaired.
  - Manual handling: Inspect prior use and healing, resolve healing first, then record the two timed bonuses and one-minute expiry manually.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Resistance (Fire) (`Fx5ZWdxqtJwgLmLf`)

Source: Chapter 4, p. 93. Characters with this trait reduce damage of * type by X after any other mitigation and gain a +10 bonus per X to tests made to resist non-damaging effects of the listed type. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, increase that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce fire damage by X after other mitigation.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`
  - Finding: The fire template stores X=0 and must be configured from the actual source. Trait values use the highest value per type and feed the corresponding reduction lane; whether every fire source is classified into that lane and the exact order relative to other mitigation remain unverified.
  - Manual handling: Enter only the source-established X, confirm the incoming type and check the final damage and previous reduction before correcting it once.
- **Clause:** Gain +10 per X on tests resisting non-damaging fire effects, or increase the relevant characteristic by 10X when an opposing roll targets it.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: A resistance choice is available in selected skill dialogs when the profile has a positive value; effect identification, opposed characteristic cases and all other test paths are not established.
  - Manual handling: The GM confirms the qualifying effect and X, applies the appropriate test or opposed-characteristic adjustment once, and checks whether a dialog already added it.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Child of the Sap (`G9UV6nif3YHrqyCY`)

Source: Chapter 4, p. 88. The Argonian is hardier than their peers, toughened by the blood of the marsh and the sap of the trees. Adept (Any) The Argonian exchanges their Resist Disease trait for Immunity to Disease, and permanently gains +1 to their movement Speed.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Exchange Disease Resistance for Disease Immunity.
  - Paths: `src/core/traits/racial-talents.js#applyRacialTalentDerivedBonuses`, `src/core/traits/trait-registry.js`
  - Finding: The derived profile sets disease immunity for an enabled talent while retaining existing resistance Items; duplicate or manually edited trait state needs review.
  - Manual handling: Check the actor’s current immunity and retained resistance before making manual changes; use disease immunity for relevant checks.
- **Clause:** Permanently gain +1 Speed.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/actors/rules/item-aggregation.js`
  - Finding: The feature contributor adds one Speed for a single enabled talent when its explicit Speed bonus is zero. Other manual adjustments and duplicates need review.
  - Manual handling: Inspect derived Speed, the talent’s field and any manual bonus before adding one; the benefit lasts while the qualifying talent is active.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Poison) (`GEcPz5K1B9qjnBFf`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase poison damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores poison and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed poison sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging poison effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic poison weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Crackshot (`H6Y2n0IdaBXnTAdg`)

Source: Chapter 4, p. 74. The character unleashes agile precision as their bow becomes an extension of their grace. Expert (Agility) The character can use their Agility Bonus for the purposes of determining Splitting or Slashing damage in place of their Strength bonus for attacks made using Splitting or Slashing arrows.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** For attacks using Slashing or Splitting arrows, choose Agility Bonus instead of Strength Bonus for that quality’s damage.
  - Paths: `src/core/combat/damage/calc.js#computeBigThreeBonus`, `src/core/traits/combat-talents.js#applyTalentDamageModifiers`
  - Finding: The former quality calculation automatically selected Agility on broader ranged weapons. It now keeps the ordinary bonus and provides a manual reminder; arrow identity, the selected bonus and armor conditions still need review.
  - Manual handling: Confirm the arrow type, choose the permitted bonus and calculate the applicable quality with armor restrictions; inspect any applied damage before correcting it.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Inspire Heroism (`HVKf22nMGAtacGLe`)

Source: Chapter 4, p. 81. The character can inspire their comrades to acts of heroism in battle. Apprentice (Personality) Once per round as a Free Action, the character can make a command test to inspire an ally who can perceive them. When inspired, the ally gains +10 to their next combat test. "One sure mark of a fool is to dismiss anything that falls outside his experience as being impossible." - Farngar Secret-Fire

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Once per round as a Free Action, make a Command test for an ally who can perceive the character.
  - Paths: `src/core/traits/social-talents.js#handleInspireHeroismActivation`, `src/core/system/activation/activation-executor.js`
  - Finding: The handler checks combat, one allied token and round state, asks for the test and saves usage after posting the roll. Perception is confirmed manually; chat and usage are separate writes. The source-only stage corrects the action label.
  - Manual handling: Confirm perception, round and earlier roll; on uncertain chat or usage inspect both before retrying.
- **Clause:** On success the ally gains +10 to the next combat test.
  - Paths: `src/core/traits/social-talents.js#handleInspireHeroismActivation`, `src/core/system/activation/feature-effects.js`
  - Finding: A successful new use posts manual instructions rather than creating a timed effect; old Inspired effects and pending outcomes are guarded for GM review.
  - Manual handling: Track the recipient and apply +10 to the next combat test once, then clear the manual reminder; inspect old effects before changing anything.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Combat Senses (`HqBjSSlmAvCUA1ha`)

Source: Chapter 4, p. 72. The character has keen combat instincts. Novice (Perception) The character can choose to calculate their Initiative Rating by taking twice their Perception Bonus and adding two instead of the usual formula.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Choose an Initiative Rating equal to twice Perception Bonus plus 2 instead of the ordinary rating.
  - Paths: `src/core/documents/combat.js#rollInitiative`, `src/core/combat/dynamic-initiative.js#resolveCombatantInitiative`, `src/core/documents/combat/initiative-helpers.js#getCombatSensesInitiativeRating`
  - Finding: The old alternative omitted the initiative die. Its formula is corrected, but the selected alternate is held for manual resolution because its choice, roll and combatant write are not durably combined; dynamic rerolls do not retain that choice. Closing either choice dialog now cancels the corresponding operation; a batch choice is not reused in later operations.
  - Manual handling: Choose the rating, roll 1d6 plus it (or apply Lightning Reflexes), record the result, and adjudicate tie-breaks and rerolls manually after checking prior chat.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Tricky Fighter (`I5NennYPmLNxqNIg`)

Source: Chapter 4, p. 77. The character uses deceit and trickery to their advantage in combat. Expert (Intelligence, Personality) When the character passes a Combat Style skill test made against an opponent in melee range they can choose to take the number of degrees of success that they rolled, or take a number equal to their Deceive skill rank.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful Combat Style test against a melee-range opponent, choose rolled DoS or Deceive rank.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: The opposed handler adds a rank option when its range and rank checks pass; its non-Evade classification and choice persistence need review.
  - Manual handling: Confirm a successful Combat Style test and melee reach, choose the Deceive rank or rolled DoS, and inspect the existing card before correction.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Common Sense (`JFL1ONWnxndsQanH`)

Source: Chapter 2, p. 55. 3 Trait Points The character has innately good judgement, allowing them to avoid the simple disasters in life. Any time the character is about to make an objectively bad decision, the GM should intervene to prompt the character to reassess things.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** The GM prompts reassessment before an objectively bad decision.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM supplies the prompt when the situation meets the rule; no roll, cost or lasting effect is required.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Fire) (`JXmmoHj9R7Q0kA5C`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase fire damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores fire and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed fire sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging fire effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic fire weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Follow-up Strike (`L7NhhFUPs0vCc3Gk`)

Source: Chapter 4, p. 75. The character has mastered the art of following up any attack at unexpected angles. Journeyman (Agility) Whenever this character fails a Combat Style test made to attack while dual wielding, they can choose to spend a SP to make a follow-up attack with the other weapon at a -20 penalty as a Free Action. This follow-up attack does not count towards the character's attacks per round.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** After a failed dual-wield Combat Style attack, choose to spend 1 SP and attack with the other weapon at -20 as a Free Action outside the round attack limit.
  - Paths: `src/core/combat/opposed/helpers/talents.js#_maybeEnableFollowUpStrike`, `src/core/combat/opposed/actions/talents.js#handleFollowUpStrike`, `src/core/combat/opposed/createPending.js`
  - Finding: The registered setting used different capitalization from the handlers; they now refer to the registered name. The old sequence spent SP, updated the old card and created a new attack separately, so the action now stops before SP.
  - Manual handling: Confirm the failed Combat Style roll, the other equipped weapon and any earlier spend or follow-up; resolve 1 SP, -20 and the free attack manually.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Duelist (`LkbUeef5keVuGNLE`)

Source: Chapter 4, p. 75. The character is used to fighting one on one, where they can focus entirely on their opponent. Novice (Strength, Agility) The character adds a bonus degree of success to any successful Combat Style or Evade tests made while within melee range of only one opponent.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Successful Combat Style or Evade tests while within melee range of only one opponent gain one rolled DoS.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: The opposed path counts visible non-neutral opposing tokens and also requires the tested opponent in range. It treats every non-Evade defense as Combat Style; unopposed tests and hidden or neutral opponents are not established.
  - Manual handling: The GM counts all relevant opponents and eligible tests, checks whether a bonus was already added and corrects DoS once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Mighty Cleave (`MWwCYhDrQNFbErh4`)

Source: Chapter 4, p. 76. The character cleaves through multiple targets in one blow. Expert (Strength) While wielding a weapon in two hands the character can, as part of an All Out Attack, strike two viable targets within their melee range. Each target must be within 2 meters of one another. The character only rolls once for the attack and each defender has an opportunity to defend separately against that attack roll. Roll damage separately for each target that is hit. This attack cannot gain advantages and only counts as a single attack for the round.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** With a weapon wielded in two hands, an All Out Attack may target two viable targets in reach and within two meters of each other.
  - Paths: `src/core/combat/opposed/helpers/talents.js#_maybeApplyMightyCleave`, `src/core/combat/opposed/actions/attacker.js`, `src/core/combat/combat-utils.js#getEffectiveWeaponHands`
  - Finding: The old handedness check converted a returned object to a number and failed to enforce two-handed use. The check now reads effective hands and excludes the special one-handed mode; selecting the ability stops before attack costs for manual handling.
  - Manual handling: Confirm both targets and distances, two-handed wielding and the All Out declaration; inspect any existing attack before recording costs.
- **Clause:** Use one attack roll, separate defenses and damage, no attacker Advantage, and count the attack once.
  - Paths: `src/core/combat/opposed/outcome-resolution.js#computeAdvantageRAW`, `src/core/combat/opposed/actions/attacker.js`, `src/core/combat/attack-tracker.js`
  - Finding: Recognized existing Mighty Cleave contexts now deny attacker Advantage; complete shared-roll, per-target and recovery behavior remains unverified and selected new uses are manual.
  - Manual handling: Roll once, resolve each defense and hit’s damage separately, give the attacker no Advantage from this attack, and count one attack; inspect earlier outcomes first.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Big Words (`MfAEtfKB6SSymPNK`)

Source: Chapter 4, p. 81. The character can flood a conversation with technical jargon to befuddle others. Journeyman (Intelligence) The character can use the Lore skill in place of the Deceive skill in appropriate situations (GM discretion).

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** May use Lore in place of Deceive in appropriate situations at GM discretion.
  - Paths: `src/core/skills/opposed-workflow/core/dialogs.js`, `src/core/skills/skill-tn.js`
  - Finding: Generic skill selection does not establish the source condition or the GM’s permission for this substitution.
  - Manual handling: Ask the GM whether the situation qualifies; if so, select and resolve Lore in place of Deceive, including any opposed outcome.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Paralysis) (`Mj9G08B6oyTl17jO`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to paralysis effects.
  - Paths: `src/core/traits/trait-registry.js#isActorImmuneToCondition`, `src/core/conditions/engine/index.js`
  - Finding: The stored parameter paralysis is normalized to the canonical paralyzed condition in the trait profile. The condition engine consults that profile; non-condition paralysis effects and already present effects remain unverified.
  - Manual handling: Confirm the enabled Item and actual effect, prevent new Paralyzed condition application where applicable, and have the GM inspect existing effects and other paralysis paths.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Disturbing Voice (`NOXgu48SjqyaYh8F`)

Source: Chapter 2, p. 56. +1 Trait Point The character has an intimidating, disturbing voice. They gain a +10 bonus to Persuade tests made to intimidate, but suffers a -10 to all other Personality based tests that involve speaking.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +10 Persuade to intimidate and suffer -10 on other speaking-based Personality tests.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Confirm whether the speaking test is intimidation or another Personality test; apply the corresponding modifier once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Thunder Charge (`NmmbZBZLRNUFyKjT`)

Source: Chapter 4, p. 76. The character rushes their opponents with a wild charge. Journeyman (Strength, Agility) The character can make an All Out Attack using 1 AP, instead of the usual 2, whenever they take the Dash action on their Turn. This is applicable only if their movement would bring them into melee range with someone they were not initially within melee range of at the start of their Turn. Additionally, they must move at least half their base Speed toward the target during that Turn.

Workspace configuration: activation enabled, type action, costs {"action_points":1,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A Dash during the turn allows an All Out Attack for 1 AP only when the target began outside melee range and at least half base Speed was moved toward them.
  - Paths: `src/core/combat/opposed/helpers/workflow.js#getThunderChargeEligibility`, `src/core/combat/opposed/actions/attacker.js`, `src/core/system/activation/activation-executor.js`
  - Finding: The existing eligibility helper checks a fixed initial distance and positions, not the complete half-Speed and movement-direction clause. The selected attack toggle and recognized Core Item activation now stop before their costs.
  - Manual handling: Confirm the start position, target reach, actual movement toward the target and half base Speed; inspect earlier AP or rolls and resolve the 1 AP attack manually.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Shock) (`NxnRdAULVCkG2rwU`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase shock damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores shock and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed shock sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging shock effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic shock weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Frost) (`O00VOKv5Kuyb5ZKj`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase frost damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores frost and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed frost sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging frost effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic frost weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unstoppable Might (`PHrw5Sf2GaURqTVJ`)

Source: Chapter 4, p. 77. The character is capable of wielding the mightiest of weapons in only one hand. Expert (Strength) The character can dual wield using hand-and-a-half weapons while still benefitting from the two-handed damage value. Additionally, the character can wield two-handed weapons in a single hand, but cannot benefit from the effects of the Dual Fighter talent while doing so. When using their weapons in either of these ways, the character cannot use those weapons to Parry or Counter-Attack.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Dual-wield hand-and-a-half weapons using their two-handed damage; a two-handed weapon may instead be wielded in one hand.
  - Paths: `src/core/combat/opposed/helpers/talents.js#_promptUnstoppableMightUsage`, `src/core/combat/opposed/actions/attacker.js`, `src/core/combat/opposed/damage/roller.js`
  - Finding: The special mode was prompted separately for each attack and defense without a durable shared wield choice. The special choice now stops the reviewed attack before cost; closing the dialog cancels it.
  - Manual handling: Choose and record the actual wield mode and weapon profile with the GM; use the correct damage and inspect old attack cards before resolving.
- **Clause:** Two-handed weapons held in one hand cannot use Dual Fighter, and weapons in either special mode cannot Parry or Counter-Attack.
  - Paths: `src/core/combat/opposed/actions/defender-roll.js`, `src/core/combat/opposed/actions/defender-commit.js`, `src/core/combat/attack-tracker.js`
  - Finding: The prior defense prompt did not establish a persistent wield state shared with the attack limit. The selected special defense now stops before reaction cost; unrelated or older cards remain unresolved.
  - Manual handling: Track special-wield state across the round, prohibit the restricted defenses and Dual Fighter benefit when applicable, and check prior AP or attacks before applying corrections.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Gladiator (`PKlZrP51Yw3gBq7R`)

Source: Chapter 4, p. 74. The character is accustomed to fighting outnumbered and can easily defend themself against multiple opponents. Expert (Strength, Agility) Requires Brawler If the character is the target of a melee attack while within the melee range of at least two opponents, then they make a free defensive reaction against that attack, but only once per round.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Against a melee attack while within melee range of at least two opponents, one defensive reaction per round is free.
  - Paths: `src/core/combat/opposed/helpers/talents.js#_getGladiatorContext`, `src/core/combat/opposed/actions/defender-roll.js`, `src/core/combat/opposed/actions/defender-commit.js`
  - Finding: Proximity relies on token disposition and visibility. The previous once-per-round flag write did not confirm or atomically reserve usage with the reaction. Detected free reactions now stop for manual handling.
  - Manual handling: The GM confirms the opponents and current round, checks prior uses and AP, then records one free defense and its outcome. Existing flags and old cards are not repaired.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Natural Toughness (`RUgCoASHi3w1nhRe`)

Source: Chapter 4, p. 93. The character with this trait is naturally tough and reduces incoming damage of all types by X. This functions like AR for the purposes of reducing damage, but it does not count as armor.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce incoming damage of all types by X; it functions like AR but is not armor.
  - Paths: `src/core/traits/trait-registry.js#getTraitNumericBonuses`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/magic/damage-application.js`
  - Finding: The template has X=0. The actor derives a highest-wins toughness value and damage reduction includes it; bypass and ignore-reduction paths, physical/magic layering and edited or duplicated traits remain unverified.
  - Manual handling: Set the source-backed X, confirm applicable damage and any bypass rule, and inspect the reduction breakdown before making a manual correction.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Light Sleeper (`Rij4MOfrLQfJ78PW`)

Source: Chapter 4, p. 73. The character is a particularly light sleeper and seems to be able to sense danger approaching. Apprentice (Perception) The character always counts as being awake for the purposes of making Observe tests and determining surprise, even if asleep.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Counts as awake when making Observe tests or determining surprise, even while asleep.
  - Paths: `src/core/combat/surprise-state.js`, `src/core/skills/skill-tn.js`
  - Finding: The inspected surprise and skill paths do not establish this talent-specific exception.
  - Manual handling: The GM treats the character as awake for these two purposes and resolves the Observe test or surprise normally; sleep still applies to other purposes.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Bruiser (`RxWAFMPFFQnzpE9I`)

Source: Chapter 4, p. 85. The character fights with simple, repeated, crushing blows. Expert (Strength) The character increases their damage with thrown axes by their Strength bonus. This replaces the Agility bonus added by Dart Thrower, if chosen. Making throwing attacks with hand axes does not provoke attacks of opportunity, and thrown axes can be retrieved as a Free Action if the character is able to move to where the axe landed. Drawing hand axes does not provoke attacks of opportunity. Maces the character wields gain the Concussive quality, and All Out Attacks made with maces cause the target to lose one stamina if the target takes damage from the attack after mitigation.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Thrown axes gain Strength Bonus damage instead of Dart Thrower’s Agility bonus.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`
  - Finding: A recognized thrown weapon receives manual guidance; the old separately mitigated bonus was removed.
  - Manual handling: Include the Strength bonus once in the attack damage, in place of the Dart Thrower bonus, and resolve mitigation together.
- **Clause:** Drawing or throwing hand axes does not provoke attacks of opportunity; retrieve a thrown axe as a Free Action when able to reach it.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-map.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: The inspected expertise handler does not establish automatic drawing, retrieval or opportunity-attack exceptions.
  - Manual handling: The GM applies the correct exception and tracks the recovered weapon and action manually.
- **Clause:** Maces gain Concussive; a damaging All Out Attack with a mace causes one SP loss.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-map.js`, `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`, `src/core/combat/opposed/helpers/workflow.js`
  - Finding: The post-damage SP loss is manual; Concussive handling exists for a recognized weapon quality, but automatic granting by this talent is not established.
  - Manual handling: Confirm the mace, quality, attack variant and damage after mitigation; resolve Concussive and one SP loss manually after checking previous changes.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Oblivious (`SmGOdAYYsWa6RnEX`)

Source: Chapter 2, p. 56. +2 Trait Points The character is often oblivious to danger. The character suffers a -20 on Perception based tests that would determine if the character is surprised by an enemy or not.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Suffer -20 on Perception tests to determine surprise by an enemy.
  - Paths: `src/core/combat/surprise-state.js`, `src/core/skills/skill-tn.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM confirms the test is determining enemy surprise and applies -20 once; do not apply it to unrelated Perception tests.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Adrenaline Burst (`T91ITKCr0MUk9g3j`)

Source: Chapter 4, p. 90. Some Redguards revel in the thrill of combat to such a degree that their delight numbs them to mortal agony. Expert (Any), Requires High Men The Redguard’s Adrenaline Rush power instead regenerates 2 Stamina Points immediately, and also heals the Redguard for 5 Health Points. Additionally, the Redguard ignores all Shock penalties from wounds until the Adrenaline Rush expires.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Adrenaline Rush instead grants two SP and heals five HP.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/racial-talents.js#handleRacialPowerActivation`
  - Finding: With enabled Adrenaline Burst, recognized Adrenaline Rush now stops before use because SP, healing and usage were not one recoverable outcome. The interaction with the base power’s Fatigue alternative remains unresolved.
  - Manual handling: Inspect existing usage, SP, Health and pending cards; agree the Fatigue interaction with the GM and resolve the modified power once.
- **Clause:** Ignore wound Shock penalties until Adrenaline Rush expires.
  - Paths: `src/core/traits/racial-talents.js#handleRacialPowerActivation`, `src/core/wounds/wound-engine.js`
  - Finding: The former tracked-combat effect and encounter cleanup were partial; existing suppression effects may still be present and are not automatically removed by the new guard.
  - Manual handling: Track the actual rush duration and Shock exception manually; inspect old effects and restore the correct penalties at expiry.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Resistance (Sunlight) (`TAsC47qEwKL74IX2`)

Source: Chapter 4, p. 93. Characters with this trait reduce damage of * type by X after any other mitigation and gain a +10 bonus per X to tests made to resist non-damaging effects of the listed type. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, increase that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce sunlight damage by X after other mitigation.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`
  - Finding: The sunlight template stores X=0 and must be configured from the actual source. Trait values use the highest value per type and feed the corresponding reduction lane; whether every sunlight source is classified into that lane and the exact order relative to other mitigation remain unverified.
  - Manual handling: Enter only the source-established X, confirm the incoming type and check the final damage and previous reduction before correcting it once.
- **Clause:** Gain +10 per X on tests resisting non-damaging sunlight effects, or increase the relevant characteristic by 10X when an opposing roll targets it.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: A resistance choice is available in selected skill dialogs when the profile has a positive value; effect identification, opposed characteristic cases and all other test paths are not established.
  - Manual handling: The GM confirms the qualifying effect and X, applies the appropriate test or opposed-characteristic adjustment once, and checks whether a dialog already added it.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Imperial Luck (`UQsPxdPNfGBteLHf`)

Source: Chapter 4, p. 89. The Empire was founded on the blade, but was built with gold. Expert (Any), Requires Red Diamond The Imperial increases their bonus Stamina Points from Star of the West to 3 SP. Additionally, any time the Imperial spends LP or burns luck to increase the DoS of a test, the first LP they spend or luck they burn on that test adds 2 DoS to the test instead of the usual 1.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase the Stamina from Star of the West to a total of 3 SP.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`
  - Finding: The Imperial Luck contribution supersedes Red Diamond and calculates only the missing difference from a recognized active Star. Character-generation gating and duplicate traits still matter.
  - Manual handling: Check both talents, the base Star and any existing modifier; ensure the Star contribution totals 3 without stacking Red Diamond twice.
- **Clause:** The first Luck Point spent or Luck burned on a test to increase DoS adds 2 DoS rather than 1.
  - Paths: `src/core/luck/imperial-luck.js`, `src/core/luck/luck-workflow.js`, `src/core/combat/chat-handlers/combat-chat-render.js`
  - Finding: The skill-test chat control tracks selected LP spends and an actor hold; Luck burn, other test types, old untracked messages and cross-client transactionality are not established.
  - Manual handling: Track the first qualifying spend or burn for each test, inspect actor and chat records and any pending hold, then apply the correct DoS once with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Slash and Stash (`VYDDXB5AZv1KyQPf`)

Source: Chapter 4, p. 76. An unaware opponent and their coin are soon parted. Adept (Agility) After the character deals damage to an unaware or surprised enemy, they can spend a Stamina Point to roll Subterfuge against the enemy's Observe in order to grab a random item that is on said enemy's person, such as a potion hanging off their belt or a coin pouch. The item must be within reach and not stashed anywhere that would require extensive effort to acquire, like if it were inside a backpack.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** After damaging an unaware or surprised enemy, spend 1 SP for Subterfuge opposed by Observe to take a random accessible item.
  - Paths: `src/core/combat/damage/resolver/resolve.js`, `src/core/skills/opposed-workflow/index.js`
  - Finding: The inspected damage and skill-opposed paths do not establish a named trigger, randomized reachable Item selection or transactional transfer for this talent.
  - Manual handling: Confirm damage, awareness, reach and accessible items; inspect prior SP and inventory, resolve the opposed roll and random choice, then transfer the selected Item once with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Lightning Reflexes (`WTV58pvNlx3cEh9g`)

Source: Chapter 4, p. 75. The character reacts rapidly to danger. Expert (Agility) When making an initiative roll, the character can roll twice and choose the higher of the two rolls. Additionally, the character can attempt to parry ranged attacks (but not spells) at a -20.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Roll initiative twice and choose the higher result.
  - Paths: `src/core/combat/dynamic-initiative.js#resolveCombatantInitiative`, `src/core/documents/combat.js#rollInitiative`
  - Finding: The normal initiative formula uses 2d6 keep highest for the enabled talent. Combat Senses selection is currently held for manual resolution; initiative messages and combatant updates are separate.
  - Manual handling: Inspect existing initiative and roll messages before rerolling; use the higher result and resolve interactions and tie-breaks with the GM.
- **Clause:** Parry ranged attacks, excluding spells, at -20.
  - Paths: `src/core/traits/combat-talents.js#getDefenseTalentOverrides`, `src/core/combat/opposed/actions/defender-commit.js`, `src/core/combat/opposed/actions/defender-roll.js`
  - Finding: The weapon-opposed defense path enables ranged parry and adds -20 when a ranged weapon context is present; spell separation and all entry points are not live verified.
  - Manual handling: Confirm a ranged weapon rather than a spell, and check that the -20 is applied once before resolving the defense.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unarmed Defender (`WTeiOdMhvAgzrgRq`)

Source: Chapter 4, p. 77. The character is a master of defending themself while unarmed. Expert (Strength, Agility) Requires Unarmed Prowess While unarmed the character can attempt to parry attacks made with weapons with an equal or longer range than their own (instead of merely longer ones) if they are within their own melee range of the attacker.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** While unarmed and within own melee reach, permit the source-described parry against equal or longer weapon range.
  - Paths: `src/core/combat/defense-options.js`, `src/core/combat/opposed/actions/defender-commit.js`, `src/core/combat/opposed/actions/defender-roll.js`
  - Finding: No talent-specific named eligibility check was established in the inspected defense paths. The item is passive and has no activation or embedded effect.
  - Manual handling: Confirm the character is unarmed, the weapon ranges and own reach; adjudicate the permitted parry manually and preserve the defense cost and roll.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Naive (`WXpsMFXemtVpveaw`)

Source: Chapter 2, p. 56. +2 Trait Points The character lacks experience in certain settings. Whenever they see fit to do so, the GM can call for the character to make an Intelligence test in order to not misunderstand a certain social situation.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** The GM may call for an Intelligence test to avoid misunderstanding a social situation.
  - Paths: `src/core/traits/features/contributors.js`, `src/core/skills/skill-tn.js`
  - Finding: The inspected passive contribution and skill paths do not decide when the GM calls this situational test.
  - Manual handling: The GM identifies the situation and requests and interprets an Intelligence test; retain the result with the encounter notes.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Bat Form (`X8hD6hE67XwpWlr3`)

Source: Chapter 8, p. 225. To Cast: 1 SP, Secondary Action The Vampire becomes a swarm of bats. They gain the Flyer (10) trait, change their size to Tiny (-20 to hit by larger characters or at range), and reduce their max HP to 5. The effect ends after 3 rounds unless the character spends 1 SP, which refreshes the effect for another 3 rounds. The spell ends immediately and the vampire reverts to their true form if the HP is reduced to 0.

Workspace configuration: activation enabled, type action, costs {"action_points":1,"stamina":1,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"none","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Pay 1 SP and a Secondary Action to become a bat swarm with Flyer 10, Tiny size and maximum 5 HP.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/actors/rules/forms.js`
  - Finding: The recognized activation is held before costs; the current Item says Primary while the source-only follow-up corrects its label. An automatic reversible swarm form is not established.
  - Manual handling: Record original actor values, pay the appropriate costs and apply the swarm values manually after checking prior activations.
- **Clause:** After three rounds pay 1 SP to refresh for three rounds, or revert; revert immediately at zero HP.
  - Paths: `src/core/system/activation/activation-executor.js`
  - Finding: Duration, refresh, zero-HP reversion and restoration are not automated by the guarded activation.
  - Manual handling: Track each three-round expiry and optional SP payment, restore the previous form on expiry or zero HP, and inspect old effects before changing values.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Incompetent (X, Y) (`XRPOyjgEHpTU707x`)

Source: Chapter 2, p. 56. +1 Trait Point per X The character is particularly bad at something. Pick a skill that the character possesses, and choose something related to that skill the character would be considered incompetent in, just like you would choose a specialty. It must be something general enough that the character could conceivably be forced to roll at some point and must be a skill that the character has trained to at least +0, like Swimming for Athletics (the GM is the final arbiter of what qualifies as such). Whenever the character is forced to make a roll with the chosen skill that would be affected by the chosen Incompetence, gain a -10 penalty to said roll per X.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Choose a trained skill and qualifying incompetence; affected rolls suffer -10 per X.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is a passive parameterized template with no configured skill penalty or embedded effect; a named execution path for the GM’s selected incompetence was not established.
  - Manual handling: Record the qualifying skill, incompetence and source-backed X with the GM; apply -10 per X to affected rolls only, checking prior modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Keen Intuition (`XXDhe3n6ejBjRiOw`)

Source: Chapter 4, p. 73. The character has a powerful intuition developed through experience and rarely misses important details. Expert (Perception) When the character passes an Observe skill test they can choose to take the number of degrees of success that they rolled or take a number equal to their Observe skill rank instead.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful Observe test choose rolled degrees of success or Observe rank.
  - Paths: `src/core/traits/awareness-talents.js#applyKeenIntuitionToResult`, `src/core/skills/opposed-workflow/actions/attacker.js`, `src/core/skills/opposed-workflow/actions/defender.js`, `src/core/skills/opposed-workflow/index.js`
  - Finding: Opposed attack and defense routes call a choice helper, and reconstruction applies a stored choice without prompting. The inspected calls do not establish coverage for every ordinary test or persistence after an interrupted roll.
  - Manual handling: For each successful Observe test, choose rolled degrees or rank; verify any displayed result and stored card before applying an adjustment, and handle unprompted or interrupted outcomes with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Illiterate (`Xou6hsnk4tbEieaz`)

Source: Chapter 2, p. 56. +3 Trait Points The character cannot read or write.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** The character cannot read or write.
  - Paths: `src/core/traits/trait-registry.js#hasActorTrait`, `src/core/integrations/polyglot.js#registerPolyglotProvider`
  - Finding: The Polyglot provider checks the trait key or name and removes written-language entries for an illiterate actor. Other system reading/writing interactions and disabled or legacy Items require review.
  - Manual handling: Record literacy with the GM and check written-language availability; handle reading, writing and module integration manually where unsupported.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## First Impression (`aIwdKYDiIWCfpXhS`)

Source: Chapter 2, p. 55. 1 Trait Point The character makes a good impression and gains a +10 bonus on any Personality test when first meeting someone new.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +10 on Personality tests when first meeting someone new.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM confirms a first meeting and qualifying Personality test, then applies +10 once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Hammerblow (`aTl2piSSOZKNj5lm`)

Source: Chapter 4, p. 86. The character can use their hammer to rattle the most armored foes. Expert (Strength) When the character lands a hit with a warhammer or maul they can cause their target to lose one Stamina Point. Alternatively, if the attack was an All Out Attack, they can instead force the target to make an Endurance (+0) test which, on failure, causes the target to gain the Dazed condition. The target may attempt one Endurance (+10) test as a Free Action on their Turn each round to remove the condition.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a warhammer or maul hit, choose one SP loss; alternatively an All Out Attack can require Endurance +0 and Dazed on failure.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: The recognized attack card provides a manual reminder; the choice, SP loss, test and Dazed application are not performed by the former damage handler.
  - Manual handling: Confirm the hit, declared weapon and attack type; choose one option and resolve it once, even if the hit deals zero damage.
- **Clause:** A Dazed target may make an Endurance +10 Free Action test on each turn to remove it.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-map.js`, `src/core/conditions/condition-engine.js`
  - Finding: The inspected expertise path does not automatically run the source-specific removal test.
  - Manual handling: Track the condition and eligible turn; resolve the +10 test and remove the correct condition on success.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## The Calling (`b2EpOzHDAfANKfUn`)

Source: Chapter 2, p. 60. The Dwemer have developed the capability to form connections with the minds of others, allowing silent and instant communication across great distances. A Dwemer may do this at any time, though they may not attempt to contact someone they have not met. Forming a mental connection requires the character to pass a Willpower test or gain a level of fatigue. Once a connection is formed the two minds may communicate as they see fit. Every minute of communication beyond the first imposes another Willpower test, where failure incurs a level of fatigue. Alternatively, they may form a connection with a number of others equal to their Willpower bonus, but doing so causes them to automatically fail the Willpower tests imposed by normal communication.

Workspace configuration: activation enabled, type action, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Contact only a met recipient; a Willpower failure causes one Fatigue, with another test each minute beyond the first.
  - Paths: `src/core/system/activation/activation-executor.js`
  - Finding: The recognized activation is held before generic use; participant eligibility, repeated tests and Fatigue are not established in the generic Item activation.
  - Manual handling: Confirm the recipient, make the initial and elapsed-minute tests, and record each failed test and Fatigue once.
- **Clause:** The alternative connects up to Willpower Bonus others and automatically fails the normal tests.
  - Paths: `src/core/system/activation/activation-executor.js`
  - Finding: The group choice and participant limit are not automatically retained by the guarded activation.
  - Manual handling: Choose and record eligible recipients, the connection time and resulting Fatigue manually with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Ugly (`b2YBlVgMTwWONxpp`)

Source: Chapter 2, p. 57. +2 Trait Points The character is ugly and suffers a -10 penalty to any Personality based tests where their appearance plays a major role in the outcome.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Suffer -10 on Personality tests where appearance is a major factor.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM determines whether appearance is a major factor for the specific test and applies -10 once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Red Diamond (`bLTjftMOOgjdZMAd`)

Source: Chapter 4, p. 89. The Imperial endures like the cornerstones of the White Gold Tower. Unbreakable. Adept (Any) The Imperial increases their bonus Stamina Points from Star of the West to 2 SP.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase the Stamina from Star of the West to a total of 2 SP.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`
  - Finding: The contributor recognizes the racial or unsuffixed Star, computes the difference from its stored SP and yields to enabled Imperial Luck. Duplicate Items and manually entered upgrades need review.
  - Manual handling: Inspect the active Star trait, talent and total Stamina; ensure the final Star contribution is 2 rather than adding an extra 2.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Amnesia (`bT3bFW1SCCR7wMlY`)

Source: Chapter 2, p. 57. +5 Trait Points The character has a gap in their memory, they cannot remember anything that happened during that time period. This is something that should be worked out with the GM, and should come back to haunt the character.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** A gap in memory is agreed with the GM and affects roleplaying.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Record the agreed lost period and consequences with the GM; no invented automatic duration, roll or cost is applied.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Tactician (`bwG8dXxvrevE9QaM`)

Source: Chapter 4, p. 79. The character is a skilled tactical commander, able to make sure their allies are all in the right place at the right time. Expert (Intelligence) Allies of this character may use the character's initiative result in place of their own when determining initiative for combat.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Allies may use the tactician’s initiative result in place of their own.
  - Paths: `src/core/traits/intellectual-talents.js#listTacticianInitiativeProvidersForActor`, `src/core/documents/combat.js#rollInitiative`, `src/core/combat/dynamic-initiative.js#prepareDynamicRoundInitiativeUpdate`
  - Finding: Interactive provider selection uses shared Group membership and an already recorded initiative. Dynamic rerolls pick a deterministic provider without a per-ally choice; group membership is not proof of every ally relationship.
  - Manual handling: The GM confirms alliance and the ally’s choice, then records the intended result and tie-break; inspect previous rolls and dynamic rerolls before changing initiative.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Stubborn (`cOPDymeXWodvaSAF`)

Source: Chapter 4, p. 81. The character is used to the sight of mundane horrors. Journeyman (Willpower) The character may reroll failed Panic tests once per test.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** May reroll a failed Panic test once per test.
  - Paths: `src/core/fear/index.js`, `src/core/traits/talents-api.js`
  - Finding: No Stubborn-specific reroll path was established in the inspected fear and talent registry paths.
  - Manual handling: After a failed Panic test, decide whether to reroll once, record the reroll against that test, and use its result; inspect earlier results before repeating.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Observant (`ck7OwGCiWMTWTFLd`)

Source: Chapter 4, p. 72. The character can spot threats coming at a distance. Expert (Perception) The character can treat their Evade skill as also being governed by Perception.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** May treat Evade as also governed by Perception.
  - Paths: `src/core/skills/skill-tn-situational.js#maybeAddObservantEvadeMod`, `src/core/combat/tn.js`
  - Finding: The ordinary skill and combat-defense calculations derive a positive difference when the Perception alternative is higher. The paths choose that difference rather than explicitly recording a choice; other modifiers and rolls need verification.
  - Manual handling: Compare the selected Evade calculation and the Perception alternative, avoid adding the displayed benefit a second time, and resolve any lower-alternative choice or unsupported roll with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Attention to Detail (`dehnAqgiTdSIFvcR`)

Source: Chapter 4, p. 79. The character is always scrutinizing those around them. Novice (Intelligence, Perception) The character can use the Investigate skill to oppose attempts to deceive them.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** May use Investigate to oppose attempts to deceive the character.
  - Paths: `src/core/skills/opposed-workflow/core/dialogs.js`, `src/core/skills/opposed-workflow/index.js`
  - Finding: The generic opposed workflow exists; the inspected path does not establish automatic eligibility or selection for this talent.
  - Manual handling: When an attempt to deceive is opposed, choose Investigate if desired and have the GM confirm the opposed pairing and result.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Timid (`eo31USXWbJfqpJGm`)

Source: Chapter 2, p. 57. +3 Trait Points The character is timid and scares easily. They suffer a -10 penalty on Willpower based tests to resist Panic tests or intimidation, and a -20 penalty on Horror tests.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Suffer -10 on Willpower tests resisting Panic or intimidation and -20 on Horror tests.
  - Paths: `src/core/fear/index.js`, `src/core/skills/skill-tn.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Identify the actual Panic, intimidation or Horror test and apply the matching penalty once; inspect other fear modifiers first.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Sons of Skyrim (`eoI3mSTwDqfbBxu7`)

Source: Chapter 4, p. 89. The Nord is tough, haughty, and enduring, as their people are famed for. Adept (Any) The Nord increases both their Resistance (Frost) trait and their Tough trait by 1.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase Resistance (Frost) by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds one for a single enabled talent and standard Resistance (Frost, 2), subject to explicit-bonus and duplicate checks.
  - Manual handling: Confirm the base trait and current frost resistance before applying any missing increment.
- **Clause:** Increase Tough by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds one wound-threshold bonus for an unambiguous standard Tough (1); optional wound rules and manual adjustments need review.
  - Manual handling: Check the Tough Item and existing threshold modifiers and apply the increase once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Dampened Senses (`etNkNGvWLqnJIU2F`)

Source: Chapter 2, p. 56. +1 Trait Point The character suffers a -10 penalty on Perception tests based on the selected sense.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Suffer -10 on Perception tests based on the selected sense.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Record the chosen sense and apply -10 only when the Perception test uses it; check any other sense penalty before adjustment.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Disease) (`etPUvZSkCZygommG`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to disease effects.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/combat/chat-handlers/combat-chat-actions.js`, `src/core/conditions/engine/index.js`
  - Finding: The stored immunity parameter is disease. The Diseased chat check recognizes disease immunity; other disease acquisition, existing disease effects and magical diseases are not established by that single check.
  - Manual handling: Check the actor’s enabled Item and existing diseases; the GM prevents new disease effects and resolves any existing effect or exceptional source without duplicating changes.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Attractive (`fSVxAbBrwjxTiojg`)

Source: Chapter 2, p. 55. 2 Trait Points The character is attractive. They gain a +10 bonus to any Personality test where their beauty plays a major role in the outcome.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +10 on Personality tests where beauty is a major factor.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: The GM determines whether appearance is a major factor for the test and applies +10 once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Brave (`gOgwbkKfImpJGK1u`)

Source: Chapter 2, p. 55. 3 Trait Points The character is lionhearted and does not scare easily. They gain a +20 bonus on Willpower tests to resist Fear or Intimidation.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +20 on Willpower tests to resist Fear or Intimidation.
  - Paths: `src/core/fear/index.js`, `src/core/skills/skill-tn.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Confirm the Willpower test resists Fear or Intimidation and apply +20 once; inspect other modifiers before resolving.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Nature's Blessing (`hBosPPJL847IQqJw`)

Source: Chapter 4, p. 88. The Bosmer is blessed by the Y’ffre, and is toughened to the deadly toxins and blights of the wild. Adept (Any) The Bosmer increases their Disease Resistance by an additional 25%, and increases their Resistance (Poison) trait by +1.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase Disease Resistance by 25 percentage points.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor adds 25 for one enabled talent and standard unmodified Disease Resistance (50%); edits and duplicates are not automatically resolved.
  - Manual handling: Inspect the current trait, existing modifier and disease checks before adding a missing benefit.
- **Clause:** Increase Resistance (Poison) by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The contributor handles a single standard Resistance (Poison, 1) with no explicit talent bonus; the trait-selection path needs live review.
  - Manual handling: Confirm the poison trait value and derived resistance, including any existing manual bonus; apply the upgrade once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unarmed Prowess (`htDQZ2pNrH7tkpYh`)

Source: Chapter 4, p. 77. The character is a master of attacking while unarmed. Journeyman (Strength, Agility) The character adds their Strength bonus to their unarmed damage.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Add Strength Bonus to unarmed damage.
  - Paths: `src/core/combat/damage/resolver/resolve.js`, `src/core/combat/damage/tokens.js`
  - Finding: The damage resolver adds Strength Bonus to recognized Hand to Hand weapons unless the configured formula appears to contain Strength. Whether every recognized Hand to Hand weapon is unarmed, and all formula variants and alternate paths, remain unresolved.
  - Manual handling: Confirm the attack is unarmed and Strength Bonus was not already included in its formula or damage; apply it once before mitigation.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Ancestor's Protection (`mxoaAwBJcysTRfAE`)

Source: Chapter 4, p. 89. The Dunmer has paid great respect to their ancestors, and in return, their spirits smile upon them. Adept (Any) The Dunmer increases their Resistance (Fire) trait by 1. Additionally, once per long rest, the dunmer can cast Sanctuary at level 2 as a Free Action. The spell lasts for three rounds, costs no Magicka Points, and requires no test to successfully cast.

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":1,"period":"longRest","current":1}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase Resistance (Fire) by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`, `src/core/traits/trait-registry.js`
  - Finding: The reviewed Item has no explicit Fire Resistance bonus, and no named passive contributor was established. Existing manual racial adjustments and the race-menu description need separate review.
  - Manual handling: Inspect the Fire Resistance trait, current modifiers and other racial sources before applying +1 once.
- **Clause:** Once per Long Rest cast level-2 Sanctuary as a Free Action for three rounds, with no Magicka or casting test.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/magic/effects/spell-effects.js`
  - Finding: The workspace Item records a long-rest use but the named Sanctuary outcome is not established. Recognized activation now stops before use; Ancestor’s Wrath changes the listed Sanctuary to level 3.
  - Manual handling: Confirm whether the higher talent is present and whether a Sanctuary use or effect already exists; record the Free Action, appropriate level, use and three-round expiry manually.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Immunity (Shock) (`n6VmyipCGgalaEyR`)

Source: Chapter 4, p. 92. The character is immune to any effects of the type specified in parenthesis. The character may have multiple instances of this trait for different effects *.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Immunity to effects of the specified shock type.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/combat/damage/resolver/resolve.js#applyDamageResolved`, `src/core/combat/damage/apply.js`
  - Finding: The stored trait parameter is shock, the activation is passive and there are no embedded effects. The profile recognizes this damage type. The main resolver previously omitted immunity; it now zeroes immune components before damage modifiers and excludes them from typed Spell Absorption. Non-damage shock effects and every entry point are not established.
  - Manual handling: Confirm that the enabled Item and incoming effect are of the specified type. Inspect any earlier damage or conditions; the GM manually prevents unsupported non-damaging effects and resolves mixed damage once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Situational Awareness (`oLOpAExGCx9qztk9`)

Source: Chapter 2, p. 55. 2 Trait Points The character is hyper-aware of their surroundings, and can ignore any negative modifiers to Perception for being distracted, but not for poor lighting or environmental conditions.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Ignore Perception penalties for distraction, but not poor lighting or environmental conditions.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Separate distraction penalties from lighting and environmental penalties on the test; remove only the distraction portion once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Wrothgarian (`oTbLfMom0VX3IHHd`)

Source: Chapter 4, p. 89. The Orsimer embodies the mountain: strong, tall, triumphant. Adept (Any) The Orsimer increases their Tough trait by 1, and increases the HP gained from their Resilient trait by 2 to a total of 5.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Increase Tough by one.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`
  - Finding: The contributor uses a single enabled talent and unambiguous standard Tough (1); explicit WT bonuses or duplicate traits require review.
  - Manual handling: Inspect the original trait and current threshold before adding a missing increase.
- **Clause:** Increase Resilient HP by two to a total of five.
  - Paths: `src/core/traits/features/contributors.js#contributeTalentMods`
  - Finding: The contributor adds two to the standard Resilient (3) when its inputs are unambiguous. Malacath’s Fury can add the next two separately.
  - Manual handling: Check Resilient, any manually entered HP and the higher talent so the racial contribution is not counted twice.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Wrestler (`oWyoxYDMd1DHqTpU`)

Source: Chapter 4, p. 77. The character is particularly skilled at subduing their opponents. Adept (Strength, Agility) When the character passes a characteristic or skill test made to grapple, restrain or entangle their opponent they can choose to take the number of degrees of success that they rolled, or take a number equal to their Combat Style skill rank.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful grapple, restrain or entangle characteristic or skill test, choose rolled DoS or Combat Style rank.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: Opposed and unopposed paths identify qualifying actions from the test label and offer a replacement; the unopposed fallback can choose the highest owned Combat Style. Stored choice and cancellation recovery are not established.
  - Manual handling: Identify the governing Combat Style and eligible successful test, choose the result, and reconcile the roll and card before applying it once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Resistance (Silver) (`pmAae1lkvM98VEf1`)

Source: Chapter 4, p. 93. Characters with this trait reduce damage of * type by X after any other mitigation and gain a +10 bonus per X to tests made to resist non-damaging effects of the listed type. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, increase that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce silver damage by X after other mitigation.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`
  - Finding: The silver template stores X=0 and must be configured from the actual source. Trait values use the highest value per type and feed the corresponding reduction lane; whether every silver source is classified into that lane and the exact order relative to other mitigation remain unverified.
  - Manual handling: Enter only the source-established X, confirm the incoming type and check the final damage and previous reduction before correcting it once.
- **Clause:** Gain +10 per X on tests resisting non-damaging silver effects, or increase the relevant characteristic by 10X when an opposing roll targets it.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: A resistance choice is available in selected skill dialogs when the profile has a positive value; effect identification, opposed characteristic cases and all other test paths are not established.
  - Manual handling: The GM confirms the qualifying effect and X, applies the appropriate test or opposed-characteristic adjustment once, and checks whether a dialog already added it.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Disease Resistance (X) (`pwdyXwe21UmWbmt0`)

Source: Chapter 4, p. 92. Whenever a character with this trait would be infected by a common disease, roll a d100. If the roll is less than or equal to X, the character doesn’t get the disease.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** When exposed to a common disease, roll d100 and prevent infection on a result no greater than X percent.
  - Paths: `src/core/traits/trait-registry.js#getDiseaseResistancePercent`, `src/core/combat/chat-handlers/combat-chat-actions.js`, `src/core/traits/trait-automation.js`
  - Finding: The template has X=0. The Diseased card makes a disease-resistance roll after a failed Endurance test; it sums the derived disease field and trait values, so mixed legacy fields and duplicate traits require review. This path alone does not establish all exposure or magical-disease handling.
  - Manual handling: Set the source-backed percentage, confirm this is a common-disease exposure and inspect any prior test; roll d100 against the correct percentage once and track the result with the GM.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Questioning (`qGtpETqhpUh02Ws1`)

Source: Chapter 4, p. 81. The character is skilled at drawing information out of others. Journeyman (Intelligence) When the character passes a Persuade skill test made to try to elicit information from a character through conversation they can choose to take the number of degrees of success that they rolled or take a number equal to their Persuade skill rank instead.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful Persuade conversation to elicit information choose rolled degrees of success or Persuade rank.
  - Paths: `src/core/traits/intellectual-talents.js#applyIntellectualTalentDoSOverrides`, `src/core/skills/opposed-workflow/actions/attacker.js`, `src/core/skills/opposed-workflow/actions/defender.js`, `src/core/skills/opposed-workflow/index.js`
  - Finding: The helper supports an explicit questioning flag, but the inspected opposed-workflow calls do not pass that flag; an automatic Questioning prompt is therefore not established for these calls.
  - Manual handling: Confirm a qualifying conversation and successful test, choose rolled degrees or Persuade rank, and record the chosen result manually after checking the existing card.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weakness (Magic) (`rJefaGZFsTrCJuX3`)

Source: Chapter 4, p. 95. Characters with this trait are weak to a certain damage or effect type. They increase damage of * type by X after any other mitigation and suffer a -10 penalty per X to tests made to resist non-damaging effects of this type. If this trait would stack for a single damage type, instead only apply the highest value of X. Different values of * damage type are considered different traits. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, decrease that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Increase magic damage by X after other mitigation; when duplicate weaknesses apply to that type use the highest X.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`, `src/core/combat/damage/calc.js#calculateDamage`
  - Finding: This template stores magic and X=0. The profile selects the highest typed weakness and the actor aggregation subtracts it from resistance before the final damage calculation. The source specifies post-mitigation addition, so blocked or over-mitigated damage and mixed magic sources require review. The current description also contains unrelated Chapter 5 text; a corrected description exists only in the source-only follow-up.
  - Manual handling: Set X only from the creature/source, confirm the incoming type and highest matching weakness, then inspect the final damage and have the GM resolve the source’s post-mitigation order once.
- **Clause:** Apply -10 per X to tests resisting non-damaging magic effects, or reduce the targeted characteristic by 10X for an opposing roll.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`
  - Finding: The inspected resistance selection presents positive resistance bonuses; a corresponding automatic magic weakness penalty or opposed-characteristic adjustment was not established.
  - Manual handling: Confirm the non-damaging effect and highest X; apply the -10X test penalty or opposing-characteristic adjustment manually after checking existing modifiers.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Preferred Enemy (`rmrxabZPs1sou4QH`)

Source: Chapter 2, p. 55. 1 Trait Point (Character) / 3 Trait Points (Faction) The character holds a grudge for a specific character or faction. The character gains a +10 on any tests made that bring direct harm to their preferred enemy, including Cast Magic actions, melee and ranged attacks, and other insidious means of harm.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Choose a specific character or faction and gain +10 on tests that directly harm that enemy.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Record the chosen character or faction and confirm the specific test directly harms it; apply +10 once across the relevant attack, casting or other test.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Creative (`rqNSlvSRzAniH6HX`)

Source: Chapter 4, p. 82. The character takes joy in the experiemental side of magic and is more efficient when not bound by traditional rules. Apprentice (Willpower) The character cannot take the Methodical talent The character improves their Willpower bonus by 1 for spell restraint purposes when casting unconventional spells.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Cannot take Methodical; improves Willpower bonus by 1 for restraint when casting unconventional spells.
  - Paths: `src/core/traits/spellcasting-talents.js`, `src/core/magic/magic-modifiers.js`, `src/core/traits/chapter4-catalog.js`
  - Finding: Both inspected magic modifier modules contain Creative handling for unconventional spells; the paths and acquisition exclusion need end-to-end verification, including avoiding duplicated benefit.
  - Manual handling: Confirm the spell is unconventional, inspect the restraint breakdown for an existing Creative bonus, apply any missing +1 only once, and have the GM check the Methodical exclusion when acquiring a talent.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Scholar (`s3mRmbgmIrZKn6gV`)

Source: Chapter 4, p. 79. The character is a burgeoning academic, capable of learning about many subjects in great depth. Apprentice (Intelligence) The character halves the base XP cost required to gain Specializations for the Lore skill (50 instead of 100), and may take twice the usual number.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Lore specializations cost 50 XP instead of 100 and may be taken up to twice the usual number.
  - Paths: `src/core/advancement/item-advancement.js#buildAdvancementPlan`, `src/core/advancement/skill-advancement.js`
  - Finding: The Player Character Lore advancement plan applies a 50-XP unit cost and doubles the calculated cap; other purchase routes, current rank, existing specializations and payment recovery are not established by this inspection.
  - Manual handling: Check Lore rank, existing specializations, calculated cap, available XP and the purchase record; for other routes use the source cost and cap manually, inspecting any partial payment before retrying.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Weak Bones (X) (`sBeF5CF1nYfDM5Ms`)

Source: Chapter 4, p. 95. Reduce Wound Threshold by X.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce Wound Threshold by X.
  - Paths: `src/core/actors/prepare/shared/humanoid-fatigue.js`, `src/core/traits/trait-registry.js#getActorTraitValue`
  - Finding: Humanoid preparation subtracts the highest recognized Weak Bones value after wound-threshold effects, clamped to zero; other actor preparation paths, stacking and configured X need live review.
  - Manual handling: Record X and compare the derived Wound Threshold and active effects before making any manual correction; the GM adjudicates duplicates and unsupported actor types.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Good with Animals (`sQaqAD9q9AJXHmhb`)

Source: Chapter 2, p. 55. 2 Trait Points The character has an affinity for animals and gains a +10 bonus on any Profession: Animal Handling, Ride, or Survival tests to train or calm an animal.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +10 on Animal Handling, Ride or Survival tests to train or calm an animal.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Confirm the listed skill and that the action trains or calms an animal; apply +10 once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Histskin (`sbcOPLJMM61v3a0E`)

Source: Chapter 4, p. 88. The Argonian can call upon the reservoirs of Hist sap stored within their glands to rapidly regenerate injury. Expert (Any), Requires Child of the Sap The Argonian doubles their swimming speed, and gains +30 to any Stealth or Athletics tests made while underwater. Additionally, once per Short Rest, the Argonian can immediately regenerate EB Health Points as a Free Action.

Workspace configuration: activation enabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":1,"period":"shortRest","current":1}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Double swimming speed and gain +30 Athletics or Stealth underwater.
  - Paths: `src/core/traits/racial-talents.js#applyRacialTalentPostSpeedDerived`, `src/core/skills/opposed-workflow/helpers/selection-and-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: Swimming speed is doubled in derived preparation and the opposed skill dialog offers a declared underwater modifier; ordinary skill rolls and actual underwater status are not established.
  - Manual handling: Confirm the active talent, actual water context and derived swim speed; apply +30 to a qualifying test only once.
- **Clause:** Once per Short Rest heal Endurance Bonus HP as a Free Action.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/racial-talents.js#handleRacialTalentActivation`
  - Finding: The old usage and healing writes were separate; recognized Core activation now stops before use. The source-only follow-up corrects the action label, while the workspace Item retains the older label.
  - Manual handling: Inspect the short-rest use, prior chat and Health, then record the Free Action and heal Endurance Bonus once; do not repeat an uncertain use.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## God of War (`sxVlZHeqiNRFOGuk`)

Source: Chapter 4, p. 74. The character fights best when surrounded by foes and is at home in the swirling tide of battle. Master (Strength, Agility) Requires Brawler and Gladiator When the character passes a Combat Style or Evade skill test made while within melee range of two or more opponents (and made against those opponents) they can choose to take the number of degrees of success that they rolled, or take a number equal to the corresponding skill rank instead. Note: The Brawler talent only applies to the rolled DoS.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful Combat Style or Evade test against an opponent while within range of at least two opponents, choose rolled DoS or corresponding skill rank; Brawler affects only rolled DoS.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: The opposed replacement path has the same token-count and choice-retention limits as Champion, including automatic best-option selection and a rolled default on dialog closure.
  - Manual handling: Confirm eligible test and opponents, choose the intended result, and inspect the saved card and previous result before making adjustments.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Defender (`tAX3zBoCnkFXYtmw`)

Source: Chapter 4, p. 74. The character is willing to step in and take a hit for their allies. Journeyman (Endurance, Willpower, Perception) As a 1 AP reaction the character can switch positions with an ally within 2 meters if that ally is attacked. They become the new target of the attack and either block, parry, or counter attack it for 0 AP. Neither the character nor the ally spend movement or provoke Attacks of Opportunity when this talent is used.

Workspace configuration: activation enabled, type reaction, costs {"action_points":1,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Spend a 1 AP reaction to exchange positions with an attacked ally within two meters and become the target.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/system/activation/talent-automation.js#activateDefenderTalent`
  - Finding: The prior path retargeted the card, moved tokens separately and then granted free-defense state; a partial failure could leave mismatched records. Recognized Core activation now stops before cost or writes.
  - Manual handling: Confirm ally, attack and distance; inspect card, positions and AP for earlier changes, then spend 1 AP and swap/retarget manually.
- **Clause:** The defender makes a block, parry or counterattack for 0 AP; the exchange costs neither movement nor attacks of opportunity.
  - Paths: `src/core/combat/activation-state-flags.js`, `src/core/combat/opposed/helpers/talents.js`
  - Finding: An older free-defense marker may remain after an interrupted or previous activation; its use is not made transactional with the token and card changes.
  - Manual handling: Confirm the allowed defensive choice, existing marker and previous defense; resolve the free reaction and movement/AoO exceptions once.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Perfect Hit (`tFD5Aa6wa8zCosV7`)

Source: Chapter 4, p. 76. The character’s attacks land exactly where they need to inflict the most damage. Expert (Perception) The character can use their Perception Bonus for the purposes of determining Splitting, Slashing, or Crushing damage in place of their Strength bonus.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** The character may substitute Perception Bonus for Strength Bonus when determining Splitting, Slashing or Crushing.
  - Paths: `src/core/combat/damage/calc.js#computeBigThreeBonus`, `src/core/traits/combat-talents.js#applyTalentDamageModifiers`
  - Finding: The former calculation unconditionally selected Perception. It now leaves the ordinary bonus and provides a manual reminder for a recognized weapon; quality restrictions and other damage entry points still require review.
  - Manual handling: Choose the desired bonus, calculate the applicable quality with its armor restrictions, and inspect already applied damage before a single manual correction.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Pugilist (`u5DbQmxtz2Ee4BfM`)

Source: Chapter 4, p. 87. The character is skilled in the art of unarmed martial combat and can deal devastating blows to their target. Expert (Strength) The character upgrades the damage die of their Natural Weapon by one step and increases the Slashing or Crushing value of Hand to Hand weapons by 1. Also, the character does not suffer the -10 penalty for performing actions that require an open hand from the Hand to Hand Weapon Quality.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Upgrade the natural weapon damage die by one step.
  - Paths: `src/core/combat/opposed/damage/roller.js#rollWeaponDamage`, `src/core/traits/weapon-expertise/weapon-expertise-map.js`
  - Finding: The inspected damage roller upgrades for Eye of Night, not Pugilist; the source profile and stacking need manual review.
  - Manual handling: Configure and roll the source-backed upgraded natural die with the GM; check any other die upgrade before rolling.
- **Clause:** Increase Slashing or Crushing of Hand to Hand weapons by one.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-handlers.js`, `src/core/combat/damage/calc.js#computeBigThreeBonus`
  - Finding: A recognized Hand to Hand weapon produces a manual reminder; the flat bonus was removed because armor restrictions differ.
  - Manual handling: Apply the chosen eligible quality increase with its armor condition, accounting for any quality bonus already calculated.
- **Clause:** Ignore the Hand to Hand open-hand action penalty.
  - Paths: `src/core/traits/weapon-expertise/weapon-expertise-map.js`, `src/core/combat/combat-style-utils.js`
  - Finding: The catalog lists the benefit but the inspected open-hand action execution is not established.
  - Manual handling: The GM checks the action and omits the Hand to Hand -10 when applicable; avoid correcting an already unpenalized test twice.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Back to Back (`uipQdabWQhIiRXnC`)

Source: Chapter 4, p. 77. The character fights best with allies, each watching over the other. Journeyman (Perception) Requires Teamwork The character can make an attack of opportunity whenever an enemy within their melee range makes a melee attack against an ally who also has this talent.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** The character may make an attack of opportunity when an enemy in their melee range makes a melee attack against an ally who also has this talent.
  - Paths: `src/ui/sheets/shared/listeners/combat-actions.js`, `src/core/combat/opposed/actions/attacker.js`
  - Finding: No named talent-specific trigger or ally validation was established in the inspected opposed and action paths.
  - Manual handling: Confirm both characters have the talent, the enemy is in reach and is making a melee attack against the ally; resolve the optional reaction and its ordinary costs manually.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unremarkable (`wMzJLc4dFEu5xvjR`)

Source: Chapter 2, p. 56. 2 Trait Points The character is exceptionally average looking, which for better or worse makes them harder to remember and recognize. Whenever this character attempts to blend in with a crowd (that being the general public, or dressed similarly to any group in which they’re trying to pass for a member by looks alone) they gain a +10 to all Subterfuge and Stealth tests made to fit in. Additionally when appropriate and at the GM’s discretion, any character or NPC trying to remember or describe the character will either have trouble doing so, such as wrongly describing them, or simply being unable to remember them entirely (for better or worse).

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Gain +10 on Subterfuge and Stealth tests to blend into an appropriate crowd; recognition difficulty is at GM discretion.
  - Paths: `src/core/traits/features/contributors.js#contributeTraitMods`, `src/core/skills/skill-tn.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: The Item is passive, has no embedded effect or configured numeric modifier, and the inspected named trait, skill and opposed paths did not establish automatic handling of this conditional clause.
  - Manual handling: Confirm a qualifying crowd or disguise and test, add +10 once, and let the GM adjudicate attempts to remember or describe the character.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Champion (`wuOOSOCTmo4YqoEh`)

Source: Chapter 4, p. 75. The character fights best one on one, where they can take the full measure of their opponent. Master (Strength, Agility) Requires Duelist and Exploit Advantage When the character passes a Combat Style or Evade skill test made while within melee range of only one opponent (and made against that opponent) they can choose to take the number of degrees of success that they rolled or take a number equal to the corresponding skill rank instead. Note: The Duelist talent only applies to the rolled DoS.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** On a successful Combat Style or Evade test against the sole opponent in melee range, choose rolled DoS or corresponding skill rank; Duelist affects only the rolled option.
  - Paths: `src/core/traits/combat-talents-dos.js`, `src/core/traits/combat-proximity.js`, `src/core/combat/opposed/banking/external-roll.js`
  - Finding: The opposed path offers a rank replacement after proximity checks and applies the rolled bonus separately. It selects the highest eligible replacement and defaults a closed dialog to rolled; proximity and durable recovery of a choice need review.
  - Manual handling: Confirm the opponent and number of foes, choose the eligible rolled or rank result and verify the stored roll/card before resolving or retrying.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Resistance (Shock) (`wwwPFionGSKqgBuY`)

Source: Chapter 4, p. 93. Characters with this trait reduce damage of * type by X after any other mitigation and gain a +10 bonus per X to tests made to resist non-damaging effects of the listed type. In cases where the character is not making the * related test, but rather a * related roll is being made against one of their Characteristics, increase that characteristic by 10 times X for the purposes of resolving that roll.

Workspace configuration: activation disabled, type , costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Reduce shock damage by X after other mitigation.
  - Paths: `src/core/traits/trait-registry.js#collectTraitDamageModifiers`, `src/core/actors/rules/item-aggregation.js#aggregateItemStats`, `src/core/combat/damage/reduction.js#getDamageReduction`
  - Finding: The shock template stores X=0 and must be configured from the actual source. Trait values use the highest value per type and feed the corresponding reduction lane; whether every shock source is classified into that lane and the exact order relative to other mitigation remain unverified.
  - Manual handling: Enter only the source-established X, confirm the incoming type and check the final damage and previous reduction before correcting it once.
- **Clause:** Gain +10 per X on tests resisting non-damaging shock effects, or increase the relevant characteristic by 10X when an opposing roll targets it.
  - Paths: `src/core/traits/trait-registry.js#getResistanceBonusOptions`, `src/core/traits/trait-resistance-ui.js`, `src/core/skills/opposed-workflow/core/dialogs.js`
  - Finding: A resistance choice is available in selected skill dialogs when the profile has a positive value; effect identification, opposed characteristic cases and all other test paths are not established.
  - Manual handling: The GM confirms the qualifying effect and X, applies the appropriate test or opposed-characteristic adjustment once, and checks whether a dialog already added it.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Social Stigma (X) (`xqf5BGgZzNImin1T`)

Source: Chapter 2, p. 56. +1 Trait Points The character suffers from a stigma (chosen when the trait is gained) in certain social situations. They suffer a -10 penalty to socially related tests in these situations. The character may have multiple instances of this trait for different stigmas.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0,"health":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Choose a stigma and suffer -10 on socially related tests in situations where it applies; different stigmas may have separate instances.
  - Paths: `src/core/traits/features/contributors.js`, `src/core/skills/skill-tn.js`
  - Finding: The inspected passive and skill paths do not establish the chosen social context or automatic per-test penalty.
  - Manual handling: Record each chosen stigma, have the GM determine when it applies, and apply the source penalty to relevant social tests once; adjudicate overlapping stigmas without inventing stacking rules.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Highborn (`xrpzc0xhIVs8ohVJ`)

Source: Chapter 4, p. 88. The Altmer harnesses their pure elven ancestry to empower their magic, as the Aldmeri were the fathers of magicka. Expert (Any), Requires Blood of Aldmeris Once per day the Altmer can rapidly meditate as a Cast Magic action to immediately regenerate 20 Magicka Points.

Workspace configuration: activation enabled, type action, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":1,"period":"day","current":1}, 0 embedded effect(s). The source-only follow-up differs; see the machine-readable review.

- **Clause:** Once per day, use a Cast Magic action to recover 20 Magicka.
  - Paths: `src/core/system/activation/activation-executor.js`, `src/core/traits/racial-talents.js#handleRacialTalentActivation`, `src/core/system/activation/costs-and-usage.js`
  - Finding: The workspace Item records a daily use but lacks the staged action cost correction; Item use, action payment and queued resource outcome are separate writes. Recognized Core activation now stops before cost or use.
  - Manual handling: Check prior daily usage, AP and Magicka; resolve the Cast Magic action and restore 20 MP manually without duplicating an earlier outcome.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

## Unrelenting (`zfCAd2Gx4nNvdbno`)

Source: Chapter 4, p. 77. The character is relentless in their assault, and few foes can escape them. Journeyman (Strength) Enemies within melee range of the character cannot take the Disengage action.

Workspace configuration: activation disabled, type passive, costs {"action_points":0,"stamina":0,"magicka":0,"luck_points":0}, usage {"max":0,"period":"","current":0}, 0 embedded effect(s). The reviewed follow-up configuration matches these fields.

- **Clause:** Enemies within the character’s melee range cannot Disengage.
  - Paths: `src/ui/sheets/shared/listeners/combat-actions.js`, `src/core/traits/combat-proximity.js#hasOpponentWithTalentInMeleeRange`
  - Finding: The sheet shortcut checks nearby opponents and a capability flag before AP; the proximity helper excludes hidden and neutral tokens and other entry points were not established.
  - Manual handling: The GM determines enemy status and the talent holder’s actual reach, blocks only eligible Disengage actions and checks whether AP was previously paid.

NOT RUN; source, permissions, cancellation, concurrency and partial writes require the live checklist.

