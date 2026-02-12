# T5-4: Illusion School — Spell → AE Mapping

**School:** Illusion  
**Source:** Chapter 6 — Magic (pp.138-140)  
**Total spells:** 15

## Spell Inventory

| # | Spell | Tags | Cost (L1-7) | SS (L1-7) | Duration |
|---|---|---|---|---|---|
| 1 | Blind | Upkeep, Direct | 7/10/13/16/19/22/25 | +20/+10/+0/-10/-20/-30/-40 | Upkeep |
| 2 | Calm | Direct | 7/10/13/16/19/22/25 | +20/+10/+0/-10/-20/-30/-40 | 1 round (breaks if attacked) |
| 3 | Chameleon | Upkeep, Instant | 4/7/10/13/16/19/22 | -5/-10/-15/-20/-25/-30/-35 | Upkeep |
| 4 | Charm | Direct, Instant | 6/8/10/12/14/16/18 | +5/+10/+15/+20/+25/+30/+35 | 1 minute |
| 5 | Courage | Upkeep, AoE (7m pulse), Instant | 8/10/12/14/16/18/20 | +5/+10/+15/+20/+25/+30/+35 | 1 minute |
| 6 | Frenzy | Direct | 8/12/16/20/24/28/32 | +20/+10/+0/-10/-20/-30/-40 | Immediate (WP test) |
| 7 | Horror | Direct, Attack | 12/20/28/36/44/52/60 | +20/+10/+0/-10/-20/-30/-40 | Immediate (WP test) |
| 8 | Invisibility | Upkeep | 13 (L5 only) | — | Upkeep (fragile) |
| 9 | Light | Upkeep, Instant | 2/3/4/5/6/7/8 | SS m radius | 1 minute |
| 10 | Muffle | Upkeep, Instant | 4/7/10/13/16/19/22 | -5/-10/-15/-20/-25/-30/-35 | Upkeep |
| 11 | Night Eye | Upkeep, Instant | 4/7/10/13/16/19/22 | 10/20/30/40/50/60/70 | Upkeep |
| 12 | Panic | Direct | 6/8/10/12/14/16/18 | +20/+10/+0/-10/-20/-30/-40 | Immediate (WP test) |
| 13 | Paralyze | Upkeep, Direct | 11/18/25/32/39/46/53 | +20/+10/+0/-10/-20/-30/-40 | Upkeep |
| 14 | Sanctuary | Upkeep, Instant | 8/15/22/29/36/43/50 | 1/2/3/4/5/6/7 | Upkeep |
| 15 | Silence | Upkeep, Direct | 7/10/13/16/19/22/25 | +20/+10/+0/-10/-20/-30/-40 | Upkeep |

---

## AE Profile Mapping

### Category 1: Stealth Modifiers — AE-Ready (2 spells)

| Spell | AE Key | Mode | Value (L1) | Effect |
|---|---|---|---|---|
| Chameleon | `system.modifiers.stealth.visual` | ADD | `-5` | -SS penalty to Observe tests to detect target (visual) |
| Muffle | `system.modifiers.stealth.auditory` | ADD | `-5` | -SS penalty to Observe tests to detect target (auditory) |

### Category 2: Condition Flag AEs — AE-Ready (5 spells)

| Spell | AE Key | Mode | Value | Additional | Notes |
|---|---|---|---|---|---|
| Blind | `system.traits.condition.blinded` | OVERRIDE | `1` | WP save, SS = TN modifier | Debuff: penalizes all sight-based tests |
| Silence | `system.traits.condition.silenced` | OVERRIDE | `1` | WP save, SS = TN modifier | Blocks verbal casting in SpellCastingService preflight |
| Invisibility | `system.traits.condition.invisible` | OVERRIDE | `1` | — | Fragile: breaks on attack/cast/interact. L5 only |
| Paralyze | `system.traits.condition.paralyzed` | OVERRIDE | `1` | WP save, SS = TN modifier | Target incapacitated for duration |
| Calm | `system.traits.condition.calmed` | OVERRIDE | `1` | WP save, SS = TN modifier | Suppresses hostility; breaks if attacked |

### Category 3: Test Modifier AEs — AE-Ready (3 spells)

| Spell | AE Key | Mode | Value (L1) | Effect |
|---|---|---|---|---|
| Courage | `system.modifiers.tests.fear` | ADD | `5` | +SS bonus to Fear tests. AoE 7m pulse |
| Charm | `system.modifiers.tests.social` | ADD | `5` | +SS bonus to social/persuasion tests |
| Sanctuary | `system.modifiers.combat.defenseTN.evade` | ADD | `1` | +SS to Evade defense TN |

### Category 4: Behavioral / No Persistent AE (3 spells)

| Spell | Mechanism | Flag | Notes |
|---|---|---|---|
| Frenzy | WP test → forced hostility | `system.traits.condition.frenzied` | Soft automation: apply condition + penalties, GM-managed behavior |
| Horror | WP test → severe fear | `system.traits.condition.horrified` | Stronger than Panic. WP save or flee |
| Panic | WP test → fear flight | `system.traits.condition.panicked` | WP test, SS = TN modifier. Target flees |

### Category 5: Utility — No Modifier AE (2 spells)

| Spell | Mechanism | Notes |
|---|---|---|
| Light | Creates light source | Token light config, not AE modifier. SS = radius in meters |
| Night Eye | Grants darkvision | SS = range in meters for vision in darkness. Token vision config |

---

## Coverage Summary

| Category | Count | AE Required? | Status |
|---|---|---|---|
| Stealth modifiers (Chameleon, Muffle) | 2 | Yes | ✅ Keys exist |
| Condition flags (Blind, Silence, Invisible, Paralyze, Calm) | 5 | Yes (boolean) | ✅ Keys added |
| Test modifiers (Courage, Charm, Sanctuary) | 3 | Yes | ✅ Keys exist |
| Behavioral conditions (Frenzy, Horror, Panic) | 3 | Flag only | ✅ Flags added |
| Utility (Light, Night Eye) | 2 | No | ✅ No AE needed |
| **Total** | **15** | **13 AE-capable** | |

---

## Framework Deferred Items

1. **Visibility state break triggers** (Invisibility, Chameleon): Combat workflow integration to define exact break events per RAW (attack initiation vs hit vs damage). Phase 6 task.
2. **Silence casting suppression**: `SpellCastingService` preflight check for `system.traits.condition.silenced`. Phase 6 task.
3. **Control effect enforcement** (Frenzy/Calm): Soft automation with condition + chat guidance. Hard enforcement is a Phase 6 task.
4. **Light/Night Eye token config**: Automated token light/vision modification. Not critical for spell pack creation.

---

## Test Matrix

| # | Test Case | Spells | Validation |
|---|---|---|---|
| 1 | Chameleon L3 stealth | Chameleon | Target gets -15 to visual stealth (Observe penalty); remove on upkeep end |
| 2 | Muffle L2 stealth | Muffle | Target gets -10 to auditory stealth; remove on upkeep end |
| 3 | Blind L4 condition | Blind | Target gets `blinded: true` condition flag; WP save TN modified by -10 |
| 4 | Silence L1 casting block | Silence | Target gets `silenced: true`; casting should warn/fail |
| 5 | Invisibility L5 | Invisibility | Target gets `invisible: true`; fragile break on action |
| 6 | Paralyze L3 incapacitate | Paralyze | Target gets `paralyzed: true`; WP save TN +0 |
| 7 | Courage L5 fear bonus | Courage | Allies in 7m get +25 to Fear tests |
| 8 | Charm L4 social bonus | Charm | Target gets +20 to social tests for 1 minute |
| 9 | Sanctuary L3 dodge bonus | Sanctuary | Caster gets +3 to Evade defense TN |
| 10 | Calm L2 suppress hostility | Calm | Target gets `calmed: true`; stops hostile actions |
| 11 | Frenzy L1 forced hostility | Frenzy | Target gets `frenzied: true` on failed WP save |
| 12 | Horror L5 severe fear | Horror | Target gets `horrified: true` on failed WP save |
