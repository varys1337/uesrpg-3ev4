# UESRPG 3ev4 — Talents, Traits & Powers Automation Matrix

> Generated from exhaustive cross-referencing of `docs/Core/Chapter 4 - Talents and Traits.md` against all automation source files in `src/`.

## Status Legend

| Status | Meaning |
|--------|---------|
| **Full** | Talent/trait effect is fully automated in code |
| **Partial** | Some aspects automated; others require manual adjudication |
| **Informational** | System posts a reminder/note to chat; player/GM adjudicates |
| **Blocked** | Waiting on prerequisite framework (e.g. summoning, conjure weapon) |
| **Stub** | Code skeleton exists but enforcement is not yet active |
| **Not Automated** | No automation code found; purely manual |
| **Item/AE** | Implemented via Active Effect changes on the compendium item (no bespoke code) |

---

## Awareness Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Combat Senses | **Full** | `src/core/documents/combat.js` | Prompts alternate Initiative Rating formula during `rollInitiative`; batch-aware for multi-combatant rolls |
| Danger Sense | **Not Automated** | — | Passive narrative talent |
| Honed Senses | **Full** | `src/core/traits/awareness-talents.js` → `adjustSensePenalty`, `applySenseLossPenaltyAdjustments` | Halves sense-loss penalties |
| Hyper Awareness | **Full** | `src/core/traits/awareness-talents.js` → `applyHyperAwarenessToResult`; also in `combat-talents.js` | Choose rolled DoS or Observe rank on Evade/Combat Style tests |
| Invisible | **Full** | `src/core/skills/opposed/helpers.js` → `_maybeAddInvisibleTrackingPenalty` | Applies tracking penalty; also a system condition |
| Keen Intuition | **Full** | `src/core/traits/awareness-talents.js` → `applyKeenIntuitionToResult` | Replaces DoS with Observe rank on Observe tests |
| Light Sleeper | **Not Automated** | — | Passive narrative talent |
| Observant | **Full** | `src/core/skills/skill-tn.js` → `_maybeAddObservantEvadeMod` | Adds situational mod allowing Evade as Perception |
| One with All | **Full** | `src/core/traits/awareness-talents.js` → `adjustSensePenalty`, `applySenseLossPenaltyAdjustments` | Negates sense-loss penalties entirely |

## Combat Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Arms Master | **Full** | `src/core/documents/actor.js`, `src/core/documents/item.js` | Ignores -20 untrained penalty for Combat Styles |
| Assassinate | **Full** | `src/core/traits/combat-talents.js` → `applyTalentDamageModifiers` | Ignores AR with one-handed Exploit Weakness weapon when hidden |
| Back to Back | **Not Automated** | — | Alias exists in `talents-api.js`; no enforcement code found |
| Berserker | **Full** | `src/core/conditions/frenzied.js` | Automated within Frenzied condition engine |
| Brawler | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | +1 DoS when 2+ opponents in melee |
| Champion | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | Choose rolled DoS or skill rank (1 opponent) |
| Controlled Anger | **Full** | `src/core/conditions/frenzied.js` | Automated within Frenzied condition engine |
| Crackshot | **Full** | `src/core/combat/damage/calc.js` | Adds AGI bonus to arrow damage |
| Crippling Strikes | **Full** | `src/core/traits/combat-talents.js` → `getEnemyWoundThresholdDelta` | −1 WT for melee |
| Cutthroat | **Full** | `src/core/combat/damage/resolver/resolve.js` | Applies Bleeding after post-mitigation damage on qualifying weapons |
| Dauntless Bulwark | **Not Automated** | — | No automation code found |
| Defender | **Full** | `src/core/system/activation/activation-executor.js` → `_activateDefenderTalent` | Activation redirects attack to Defender user via retarget system |
| Dual Fighter | **Full** | `src/core/combat/attack-tracker.js` | Sets max attacks per round to 3 |
| Duelist | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | +1 DoS when exactly 1 opponent in melee |
| Exploit Advantage | **Full** | `src/core/combat/opposed/effects.js`, `opposed/dialogs/attacker.js`, `opposed/dialogs/defender.js` | Doubles Press Advantage/Overextend in isolated duel; proximity check |
| Eye of Vengeance | **Full** | `src/core/traits/combat-talents.js` → `getEnemyWoundThresholdDelta` | −1 WT for ranged |
| Fearsome | **Full** | `src/core/traits/combat-talents.js` → `getEvadeOverrideContext`; `opposed/actions/defender-commit.js` | Allows Persuade(STR) in place of Evade vs melee; dialog prompt |
| Follow-up Strike | **Full** | `src/core/combat/opposed/helpers/talents.js` → `_maybeEnableFollowUpStrike` | Enables in opposed workflow |
| Gladiator | **Full** | `src/core/combat/opposed/helpers/talents.js` | Free defensive reaction once per round |
| God of War | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | Choose rolled DoS or skill rank (2+ opponents) |
| Killing Blow | **Full** | `src/core/stamina/stamina-dialog.js` | Power attack ×3 multiplier |
| Lightning Reflexes | **Full** | `src/core/traits/combat-talents.js` → `getDefenseTalentOverrides`, `applyDefenderTalentTNMods` | Allows parry vs ranged at −20 |
| Mighty Cleave | **Full** | `src/core/combat/opposed/helpers/talents.js` → `_getMightyCleave` | Prompts for second target |
| Perfect Hit | **Full** | `src/core/combat/damage/calc.js` | PRC bonus for quality damage |
| Precise | **Full** | `src/core/traits/combat-talents.js` → `applyAttackerTalentPreTN` | Cancels −20 precision strike penalty |
| Quick Draw | **Not Automated** | — | No enforcement code found |
| Rage-fueled Frenzy | **Full** | `src/core/conditions/frenzied.js` | Automated within Frenzied condition engine |
| Rapid Reload | **Full** | `src/ui/sheets/shared/listeners/combat-actions.js` | Reduces weapon Reload quality by 1 |
| Shadow Strike | **Not Automated** | — | No automation code found |
| Skirmisher | **Not Automated** | — | No automation code found |
| Slash and Stash | **Not Automated** | — | No automation code found |
| Sneak Attack | **Full** | `src/core/traits/combat-talents.js` → `applyTalentDamageModifiers` | Adds Stealth rank to damage when hidden |
| Teamwork | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | +1 DoS when ally with Teamwork in melee of opponent |
| Thunder Charge | **Full** | `src/core/system/activation/activation-executor.js`; `opposed/helpers/workflow.js`; `opposed/dialogs/attacker.js` | Full activation + eligibility check + dialog integration |
| 'Tis But a Scratch | **Full** | `src/core/conditions/frenzied.js` | Automated within Frenzied condition engine |
| Tricky Fighter | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments` | Choose rolled DoS or Deceive rank in melee |
| Unarmed Defender | **Not Automated** | — | No automation code found |
| Unarmed Prowess | **Full** | `src/core/combat/damage/resolver/resolve.js` | Adds STR bonus to hand-to-hand damage |
| Unrelenting | **Full** | `src/ui/sheets/shared/listeners/combat-actions.js`; `src/core/combat/combat-proximity.js` | Prevents target Disengage; `hasOpponentWithTalentInMeleeRange` check |
| Unstoppable Might | **Full** | `src/core/combat/opposed/helpers/talents.js` | Weapon eligibility system for opposed workflow |
| Wrestler | **Full** | `src/core/traits/combat-talents.js` → `applyCombatTalentDoSAdjustments`, `applyCombatTalentDoSAdjustmentsUnopposed` | DoS adjustments for grapple tests |

## Crafting Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Alchemist (School) | **Not Automated** | — | Alchemy system not implemented |
| Manifold Enchanter | **Not Automated** | — | Enchanting system not implemented |
| Master Alchemist | **Not Automated** | — | Alchemy system not implemented |
| Nothing Ventured Nothing Gained | **Not Automated** | — | Alchemy system not implemented |
| Procedural Enchanting | **Not Automated** | — | Enchanting system not implemented |
| Salvage Energy | **Not Automated** | — | Enchanting system not implemented |
| Trial and Error | **Not Automated** | — | Alchemy system not implemented |

## General Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Expert (Specialization) | **Full** | `src/core/traits/general-talents.js` → `getGeneralTalentRerollEligibility`, `rerollSkillTestFromChatMessage` | Reroll button on chat cards |
| Grandmaster (Skill) | **Full** | `src/core/traits/general-talents.js` → same functions + `hasGrandmasterForSkill` | Reroll + magic skill +1 rank bonus |
| Untouchable | **Full** | `src/core/combat/damage/resolver/resolve.js` → `_promptUntouchableLpSpend` | LP spend dialog to increase WT post-hit; authority-proxy aware |

## Intellectual Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Attention to Detail | **Not Automated** | — | No automation code found |
| Blending | **Not Automated** | — | No automation code found |
| Businessman | **Full** | `src/core/traits/intellectual-talents.js` → `applyIntellectualTalentDoSOverrides` | Commerce test DoS replacement |
| Interrogator | **Full** | `src/core/traits/intellectual-talents.js` → `applyIntellectualTalentDoSOverrides` | Persuade interrogation DoS replacement |
| Prediction | **Full** | `src/core/traits/intellectual-talents.js` → `getPredictionInitiativeAgiBonus` | Uses INT bonus in place of AGI bonus for Initiative Rating |
| Questioning | **Full** | `src/core/traits/intellectual-talents.js` → `applyIntellectualTalentDoSOverrides` | Persuade info-gathering DoS replacement |
| Scholar | **Not Automated** | — | No automation code found |
| Tactician | **Full** | `src/core/traits/intellectual-talents.js` → `listTacticianInitiativeProvidersForActor` | Allies can use Tactician's initiative result; Group member scan |

## Mobility Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Armored Agility | **Full** | `src/core/traits/mobility-talents.js` → `getArmoredAgilityAcrobaticsBonus` | Acrobatics bonus while armored |
| Assassin Strike | **Full** | `src/core/traits/mobility-talents.js` → `recordAssassinStrikeAoOBlock`, `isActorBlockedFromAoOAgainstTarget` | Blocks AoO from target this turn |
| Catfall | **Not Automated** | — | Passive; mentioned in racemenu data only |
| Ghost | **Not Automated** | — | No automation code found |
| Hard Target | **Full** | `src/core/traits/mobility-talents.js` → `activateHardTargetEffect`; `activation-executor.js` | Creates AE with −20 ranged penalty; activation dispatch |
| Leap Up | **Not Automated** | — | No automation code found |
| Step Aside | **Full** | `src/core/traits/mobility-talents.js` → `shouldDeferEvadeApForStepAside` | Evade vs AoO costs 0 AP |
| Swashbuckler | **Stub** | `src/core/traits/mobility-talents.js` → `swashbucklerIgnoresCombatSkillRankLimits` | Code skeleton exists; system doesn't yet enforce rank limits |
| Unnaturally Agile | **Not Automated** | — | No automation code found |

## Resilience Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Die-Hard | **Full** | `src/core/wounds/engine/apply.js` | Reroll failed shock test, once per test |
| Enduring | **Full** | `src/core/documents/actor.js`; `src/core/traits/features/talent-contributors.js` | Halves fatigue penalties in derived data prep |
| Fearless | **Not Automated** | — | No automation code found |
| Iron Jaw | **Not Automated** | — | No automation code found |
| Iron Will | **Full** | `src/core/traits/resilience-talents.js` → `applyIronWillReroll` | Prompts reroll on failed WP resistance test |
| Meditation | **Full** | `src/ui/sheets/rest-workflow.js` → `_promptMeditationChoice` | Doubles MP/SP regeneration on short rest; dialog prompt |
| Rapid Recovery | **Full** | `src/ui/sheets/rest-workflow.js` | Heals 1d4 HP on short rest; doubles natural healing on long rest |
| Stubborn | **Not Automated** | — | No automation code found |
| Unstoppable | **Full** | `src/core/documents/actor.js` | Halves passive wound effects in derived data |
| Wall of Steel | **Full** | `src/core/traits/resilience-talents.js` → `getWallOfSteelArmorItemBonus`, `getWallOfSteelShieldBlockBonus` | +1 AR, +1 BR |

## Social Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Big Words | **Not Automated** | — | No automation code found |
| Charlatan | **Not Automated** | — | No automation code found |
| Inspire Heroism | **Full** | `src/core/traits/social-talents.js` → `handleInspireHeroismActivation` | Full workflow: Command test, target validation, once-per-round, AE creation |
| Into the Fire | **Not Automated** | — | Alias in `talents-api.js` only; no enforcement code |

## Spellcasting Talents

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Arcane Defender | **Full** | `src/core/traits/spellcasting-talents.js` → `_applyArcaneDefender` | Reinforce bonus increased to WB/2 |
| Bend Reality | **Partial** | `src/core/traits/spellcasting-talents.js` → `_applyBendReality` (stub + activation priming) | Activation/priming framework exists; actual skill substitution partially implemented |
| Bladecaller | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires Conjure Weapon spell framework |
| Control | **Full** | `src/core/traits/spellcasting-talents.js` | Backfire negation flag |
| Creative | **Full** | `src/core/traits/spellcasting-talents.js` | +1 WB for unconventional spell restraint |
| Cryomancer | **Full** | `src/core/traits/spellcasting-talents.js` | +1 frost damage via modifier stage |
| Depth of Understanding | **Full** | `src/core/documents/actor.js` | Grants Power Well (IB × 5); computed directly in derived data |
| Electromancer | **Full** | `src/core/traits/spellcasting-talents.js` | +1 shock damage |
| Flow of Magicka | **Partial** | `src/core/traits/spellcasting-talents.js` (activation priming) | Priming exists; reaction-based counter handled by defense system |
| Healer | **Partial** | `src/core/traits/spellcasting-talents.js` (activation) | Activation handled; standalone ritual workflow separate |
| Living Armory | **Full** | `src/core/traits/spellcasting-talents.js` | AP instead of MP for Conjure upkeep |
| Mage Guard | **Full** | `src/core/traits/spellcasting-talents.js` | +1 Reinforce effect (not restraining) |
| Magicka Cycling | **Full** | `src/core/traits/spellcasting-talents.js` | +2 WB for restraint |
| Master of Magicka | **Full** | `src/core/traits/spellcasting-talents.js` | Allow overload while restraining |
| Master of the Hordes | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires summoning framework |
| Methodical | **Full** | `src/core/traits/spellcasting-talents.js` | +1 WB for conventional spell restraint |
| Overcharge | **Full** | `src/core/traits/spellcasting-talents.js` | Double cost, roll damage 2× keep highest |
| Pyromancer | **Full** | `src/core/traits/spellcasting-talents.js` | +1 fire damage |
| Seasoned Conjurer | **Full** | `src/core/traits/spellcasting-talents.js` | Use Conjuration rank as DoS |
| Spell Sword | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires equipment interaction framework |
| Strong Willed | **Full** | `src/core/traits/spellcasting-talents.js` | +1 DoS on Conjuration tests |
| Taskmaster | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires Mindlock / summoning framework |
| The Mending Tides of Oblivion | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires summoned creature management |
| Thought Caster | **Not Automated** | — | Alias in `talents-api.js` only; no enforcement code |
| Trickster | **Not Automated** | — | Alias in `talents-api.js`; intent is Illusion-for-Deceive substitution, no code |
| Unfettered Conjuration | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires summoning spell framework |
| Void Channeler | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires summoned creature management |
| Weapon Echo | **Blocked** | `src/core/traits/spellcasting-talents.js` (milestone) | Requires Conjure Weapon spell framework |

## Weapon Expertise Talents

All 27 weapon expertise talents are defined in `src/core/traits/weapon-expertise/weapon-expertise-map.js` (455 lines) with handlers in `weapon-expertise-handlers.js` (527 lines).

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Bearded Warrior | **Informational** | `weapon-expertise-handlers.js` (post-damage note) | Posts move impediment note to chat |
| Beast of Steel | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Blademaster | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Bruiser | **Full** | `weapon-expertise-handlers.js` (damage mod + post-damage) | STR for thrown axes; mace SP loss effect |
| Cleaver of Men | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Daisho | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Dart Thrower | **Full** | `weapon-expertise-handlers.js` (damage mod) | AGI for thrown damage |
| Death by a Thousand Cuts | **Full** | `weapon-expertise-handlers.js` (post-damage) | Applies Bleeding condition |
| Executioner | **Full** | `weapon-expertise-handlers.js` (pre-TN + informational damage) | +10 AoA bonus; informational +1d4 damage note |
| Firing Line | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| From Oblivion's Heart | **Full** | `weapon-expertise-handlers.js` (post-damage) | Aplies Bleeding on wound |
| Halberdier | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Hammerblow | **Full** | `weapon-expertise-handlers.js` (post-damage) | SP loss or Dazed condition |
| Kensai | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Knife Fighter | **Informational** | `weapon-expertise-handlers.js` (informational damage) | Posts +1d4 damage note |
| Monster Hunter | **Full** | `weapon-expertise-handlers.js` (WT delta) | −1 enemy WT |
| Point Blank | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Power Draw | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Pugilist | **Full** | `weapon-expertise-handlers.js` (damage mod) | +1 quality bonus to unarmed |
| Red Legion Throw | **Full** | `weapon-expertise-handlers.js` (post-damage) | Applies Crippled condition |
| Riposte | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Rip and Tear | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Simple Yet Effective | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Slinger's Wail | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| Staff Mastery | **Informational** | `weapon-expertise-handlers.js` | Posts reminder to chat |
| The Whirling School | **Full** | `weapon-expertise-handlers.js` (post-damage) | Dialog → Immobilized or SP drain |
| Viper's Eye | **Full** | `weapon-expertise-handlers.js` (pre-TN) | Precision strike penalty reduced to −10 |

## Racial Talents — Core Races

| Name | Race | Status | Implementation | Notes |
|------|------|--------|----------------|-------|
| Blood of Aldmeris | Altmer | **Not Automated** | — | Passive: Power Well (10) + Disease Resistance; likely item/AE-based |
| Highborn | Altmer | **Not Automated** | — | Once/day meditate to regen 20 MP; no code found |
| Child of the Sap | Argonian | **Full** | `src/core/traits/racial-talents.js` → `applyRacialTalentDerivedBonuses` | +1 speed, disease immunity |
| Histskin | Argonian | **Full** | `src/core/traits/racial-talents.js` → `handleRacialTalentActivation` | Heals EB HP, per-short-rest tracking |
| Nature's Blessing | Bosmer | **Full** | `src/core/traits/racial-talents.js` → `applyRacialTalentDerivedBonuses` | +25% disease resistance, +1 poison resistance |
| Lord of the Hunt | Bosmer | **Not Automated** | — | Stealth test + Invisible condition; no code found |
| Lionheart | Breton | **Not Automated** | — | Power Well (10) + Magic Resistance +1; likely item/AE-based |
| Dragonskin | Breton | **Full** | `src/core/traits/racial-talents.js` → `handleRacialTalentActivation` | Creates Spell Absorption(5) AE for 1 round |
| Ancestor's Protection | Dunmer | **Not Automated** | — | Fire Resistance +1, free Sanctuary level 2; no code found |
| Ancestor's Wrath | Dunmer | **Not Automated** | — | Upgraded Sanctuary + Fire Cloak; no code found |
| Red Diamond | Imperial | **Full** | `src/core/traits/racial-talents.js` → `applyRacialTalentDerivedBonuses` | SP bonus from Star of the West → 2 |
| Imperial Luck | Imperial | **Full** | `src/core/traits/racial-talents.js` → `applyRacialTalentDerivedBonuses` | SP bonus → 3; +2 DoS on first LP spend (chargen gate) |
| Eye of Night | Khajiit | **Partial** | `src/core/traits/racial-talents.js` → `applyRacialTalentAttackPreTN` | Free precision strike when hidden; lighting check is manual |
| Eye of Fear | Khajiit | **Not Automated** | — | Once/LR Panic test at −30; no code found |
| Sons of Skyrim | Nord | **Full** | `src/core/traits/racial-talents.js` → `applyRacialTalentDerivedBonuses` | +1 frost resistance, +1 WT |
| Star Woad | Nord | **Not Automated** | — | Ritual Woad paint with shield mechanic; no code found |
| Wrothgarian | Orsimer | **Not Automated** | — | Tough +1, Resilient HP +2; likely item/AE-based |
| Malacath's Fury | Orsimer | **Full** | `src/core/traits/racial-talents.js` → `handleRacialPowerActivation` | Passive HP bonus + activation: heal EB, +STR, +magicR for 1 min |
| High Men | Redguard | **Not Automated** | — | Disease immunity, Poison Resistance +1; likely item/AE-based |
| Adrenaline Burst | Redguard | **Full** | `src/core/traits/racial-talents.js` → `handleRacialPowerActivation` | Modifies Adrenaline Rush: +2 SP, heal 5 HP, suppress wound penalties |

## Racial Talents — Expanded Races

| Name | Race | Status | Implementation | Notes |
|------|------|--------|----------------|-------|
| Birds of Prey | Ayleid | **Not Automated** | — | +1 Speed, +10 Power Well; likely item/AE-based |
| Lords of the Niben | Ayleid | **Not Automated** | — | Enhanced Empowered by Starlight; no code found |
| Born of Ice | Falmer | **Not Automated** | — | Frost Resistance +1, frost effect +1; likely item/AE-based |
| Legacy of the Snow Prince | Falmer | **Not Automated** | — | Frost Cloak level 3 activation + blizzard ritual; no code found |
| Shimmerskin | Maormer | **Not Automated** | — | Power Well +10, stealth bonus; likely item/AE-based |
| Serpent-Sorcerer | Maormer | **Not Automated** | — | Snake binding ritual; no code found |
| Baleful Bloating | Sload | **Not Automated** | — | Power Well +10, +3 HP; likely item/AE-based |
| Meticulous Planning | Sload | **Not Automated** | — | Pre-rolled d100 substitution; no code found |

## Traits (Chapter 4, pp. 92–95)

Traits are generally implemented via **Active Effect changes** on compendium items or actor data model fields rather than bespoke code modules. The table below indicates where specific code automation exists beyond simple AE values.

| Name | Status | Implementation | Notes |
|------|--------|----------------|-------|
| Amphibious | **Item/AE** | — | Passive; handled by AE changes on trait items |
| Bestial | **Item/AE** | — | Passive; narrative |
| Blind | **Item/AE** | — | Links to Blinded condition |
| Bound | **Item/AE** | — | Passive; narrative rules |
| Climber (X) | **Item/AE** | — | Sets climb speed |
| Crawler | **Item/AE** | — | Halves speed |
| Dark Sight | **Item/AE** | — | Passive |
| Dawn-Cursed (X) | **Item/AE** | — | Damage in sunlight; narrative |
| Deaf | **Item/AE** | — | Links to Deafened condition |
| Disease Resistance (X%) | **Full** | `src/core/traits/trait-automation.js` via `getDiseaseResistancePercent`; `racial-talents.js` | Race-aware calculation integrated with racial bonuses |
| Diseased (+/- X) | **Full** | `src/core/traits/trait-automation.js` → `postDiseasedCheckCard`; `damage/resolver/resolve.js` | Chat card for Endurance test; triggered on natural weapon damage |
| Flyer (X) | **Item/AE** | — | Sets flight speed |
| Frightening (X) | **Item/AE** | — | Panic test; narrative |
| From Beyond | **Item/AE** | — | Immunities; passive |
| Immunity (*) | **Item/AE** | — | Passive |
| Incorporeal | **Full** | `src/core/combat/damage/resolver/resolve.js` | Blocks non-magic damage; implemented in damage resolver |
| Natural Toughness (X) | **Full** | `src/core/magic/damage-application.js`; `damage/resolver/resolve.js`; `features/rule-elements.js` | Counted in damage mitigation pipeline |
| Natural Weapons | **Item/AE** | — | Weapon profile override on actor data |
| Power Well (X) | **Full** | `src/core/documents/actor.js` | Item-based `addIBToMP` + Depth of Understanding; computed in `prepareData` |
| Quadruped | **Item/AE** | — | Speed modifiers; passive |
| Regeneration (X) | **Full** | `src/core/traits/trait-automation.js` → `postRegenerationPrompt`; `conditions/turn-ticker.js` | Prompted at start of round via turn ticker |
| Resistance (*, X) | **Full** | `src/core/combat/damage/resolver/resolve.js`; `magic/damage-application.js` | Reduces damage by type in mitigation pipeline |
| Resist Normal Weapons (X) | **Full** | `src/core/combat/damage/resolver/resolve.js` | Reduces non-magic weapon damage |
| Running Out of Luck | **Item/AE** | — | Doubles luck burn; narrative |
| Savage | **Item/AE** | — | Proven quality; passive |
| Silver-Scarred (X) | **Item/AE** | — | Increased silver damage |
| Skeletal | **Item/AE** | — | −20 to ranged; passive |
| Spell Absorption (X) | **Full** | `src/core/combat/damage/resolver/resolve.js` | d10 check to absorb spell; MP recovery |
| Strong Jaws | **Item/AE** | — | Auto-grapple on bite; narrative |
| Stunted Magicka | **Item/AE** | — | Passive |
| Summoned | **Item/AE** | — | Passive |
| Sun-Scarred (X) | **Item/AE** | — | Increased sunlight damage |
| Swimmer | **Item/AE** | — | Doubles swim speed |
| Telepathy (X) | **Item/AE** | — | Passive |
| Telekinesis (X) | **Item/AE** | — | Passive |
| Terrifying (X) | **Item/AE** | — | Horror test; narrative |
| Thick Skull | **Item/AE** | — | Stun/Dazed immunity; passive |
| Tough (X) | **Full** | `src/core/documents/actor.js` | Increases WT in derived data; supports Alt Wounds setting |
| Undead | **Item/AE** | — | Comprehensive immunities; passive |
| Undying | **Item/AE** | — | Disease/aging immunity; passive |
| Unnatural Senses (*, X) | **Item/AE** | — | Passive |
| Vicious (X) | **Item/AE** | — | Treats SB as X for damage |
| Weak Bones (X) | **Item/AE** | — | Reduces WT |
| Weakness (*, X) | **Full** | `src/core/combat/damage/resolver/resolve.js`; `magic/damage-application.js` | Increases type damage in mitigation pipeline |

---

## Summary Statistics

| Category | Total | Full | Partial | Informational | Blocked | Stub | Not Automated | Item/AE |
|----------|-------|------|---------|---------------|---------|------|---------------|---------|
| Awareness | 9 | 7 | 0 | 0 | 0 | 0 | 2 | 0 |
| Combat | 42 | 33 | 0 | 0 | 0 | 0 | 9 | 0 |
| Crafting | 7 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| General | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| Intellectual | 8 | 5 | 0 | 0 | 0 | 0 | 3 | 0 |
| Mobility | 9 | 4 | 0 | 0 | 0 | 1 | 4 | 0 |
| Resilience | 10 | 7 | 0 | 0 | 0 | 0 | 3 | 0 |
| Social | 4 | 1 | 0 | 0 | 0 | 0 | 3 | 0 |
| Spellcasting | 28 | 15 | 3 | 0 | 8 | 0 | 2 | 0 |
| Weapon Expertise | 27 | 10 | 0 | 14 | 0 | 0 | 0 | 3 |
| Racial (Core) | 20 | 10 | 1 | 0 | 0 | 0 | 9 | 0 |
| Racial (Expanded) | 8 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| Traits | 37 | 10 | 0 | 0 | 0 | 0 | 0 | 27 |
| **TOTAL** | **212** | **105** | **4** | **14** | **8** | **1** | **50** | **30** |

### Coverage Rate

- **Fully Automated**: 105/212 (49.5%)
- **Any Automation** (Full + Partial + Informational + Stub + Blocked + Item/AE): 162/212 (76.4%)
- **No Automation at All**: 50/212 (23.6%)

### Key Gaps

1. **Crafting** — Entire category (7 talents) has no automation; requires Alchemy/Enchanting subsystems
2. **Expanded Racial** — All 8 talents unimplemented
3. **Spellcasting Blocked** — 8 talents waiting on Conjure Weapon, Summoning, and Mindlock frameworks
4. **Social** — 3 of 4 talents not automated (Big Words, Charlatan, Into the Fire)
5. **Core Racial passive bonuses** — Several (Blood of Aldmeris, Lionheart, Wrothgarian, High Men) likely rely on manually-placed AE items rather than code enforcement
