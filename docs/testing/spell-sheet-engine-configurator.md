# Spell Sheet Engine Configurator — Test Plan

## Overview

The spell item sheet uses a consolidated 3-tab layout (**Description**, **Casting**, **Information**) that exposes all magic-engine capabilities. The Casting tab contains all configuration in organized subsections: Classification, Casting Attributes, Targeting & Range, Duration & Persistence, Scaling Levels, Effect Recipes, Effect Policies, Active Effects, and Advanced Features.

## Prerequisites

- Foundry VTT v13.351
- UESRPG 3ev4 system loaded
- At least one Actor (Player Character or NPC) in the world
- Create or have available at least one spell item

---

## 1. Sheet Layout & Navigation

### 1.1 Tab Rendering
1. Open any spell item sheet
2. Verify 3 tabs appear in the navigation: **Description**, **Casting**, **Information**
3. Click each tab — content area should update correctly
4. Verify no horizontal scrollbar appears at normal window widths (520px+)
5. Verify consistent field sizing — all inputs/selects should use normalised widths (xs/sm/med/fill)

### 1.2 Header
1. Verify the header shows: Name, Level, MP, School, Type, Active checkbox
2. Change each field and verify it persists after reopening the sheet
3. Verify the Active checkbox toggles `flags.uesrpg-3ev4.activeSpell`

---

## 2. Casting Tab

### 2.1 Classification
1. Check/uncheck **Attack Spell**, **Direct**, **Instant**
2. Verify values persist in `system.isAttackSpell`, `system.isDirect`, `system.isInstant`
3. Select a Damage Type from the dropdown — verify `system.damageType` updates
4. Enter a Damage Formula — verify `system.damageFormula` updates

### 2.2 Casting Attributes
1. Check **Upkeep** — verify `system.hasUpkeep` toggles
2. Check **Overload** — verify the Overload fieldset appears with Effect Description and Bonus Damage fields
3. Check **Reinforce** — verify the Reinforce fieldset appears with a description textarea
4. Uncheck each — verify conditional fieldsets disappear

### 2.3 Scaling Levels
1. Click **Add Level** — verify a new row appears in the scaling table
2. Fill in Level, Cost, Damage Formula, Duration value/unit, Description
3. Click **Add Level** again — verify next level auto-increments
4. Attempt to add past level 7 — verify warning notification appears
5. Click the trash icon on a row — verify it's removed
6. Verify all scaling data persists in `system.scaling.levels` after reopening

---

## 3. Casting Tab — Targeting & Range

### 3.1 Targeting Mode
1. Scroll to the **Targeting & Range** section on the Casting tab
2. Change the Mode dropdown (Single, Multi, Self, AoE, Special)
3. When "Multi" is selected, verify the **Max Targets** field appears
4. Change Max Targets — verify `system.engine.targeting.maxTargets` persists
5. Select a different mode — verify Max Targets field hides

### 3.2 Range & Delivery
1. Change Range Type dropdown (None, Ranged, Melee, AoE)
2. Enter range text — verify `system.range` persists
3. When Range Type is "AoE", verify the **Area of Effect** fieldset appears

### 3.3 Area of Effect (conditional)
1. Set Range Type to "AoE"
2. Select Shape (Circle, Cone, Ray, Rectangle, Pulse)
3. Enter Size and Width values
4. Toggle **Pulse** and **Affect Caster** checkboxes
5. Verify `system.aoeShape`, `system.aoeSize`, `system.aoeWidth`, `system.aoePulse`, `system.aoeIncludeCaster` persist

---

## 4. Casting Tab — Effect Recipes & Policies

### 4.1 Effect Recipe Builder
1. Scroll to the **Effect Recipes** section on the Casting tab
2. Click **Add** — verify a new recipe row appears
3. Select a Key from the dropdown (should show spell-relevant modifier keys)
4. Select a Mode (Add, Multiply, Override, etc.)
5. Enter a Value
6. Select Target (Target or Self)
7. Enter a Label
8. Verify recipe persists in `system.engine.effects.recipes` after reopening
9. Click the trash icon — verify the recipe is removed

### 4.2 Recipe Presets
1. Click **Fortify Attribute** — verify a recipe row is added with Strength key
2. Click **AR Buff** — verify a recipe row is added with armor rating key
3. Click **Ward** — verify a recipe row is added with ward key and "Self" target

### 4.3 Effect Policies
1. Scroll to the **Effect Policies** section
2. Change **Stacking** dropdown — verify `system.engine.effects.stackingPolicy` persists
3. Change **Ownership** dropdown — verify `system.engine.effects.ownershipPolicy` persists

### 4.4 Embedded Active Effects
1. Scroll to the **Active Effects** section
2. Click the "+" icon — verify a new AE is created
3. Click Edit on an AE — verify the AE config sheet opens
4. Click Delete on an AE — verify it's removed
5. Click Enable/Disable toggle — verify the AE changes state

---

## 5. Casting Tab — Duration & Persistence

### 5.1 Duration
1. Scroll to the **Duration & Persistence** section
2. Change duration value and unit
3. Verify `system.duration.value` and `system.duration.unit` persist
4. Set unit to "instant" or "permanent" — verify the value field hides

### 5.2 Mindlock
1. Enter a mindlock value — verify `system.mindlockValue` persists
2. Set to 0 — verify it saves correctly

### 5.3 Upkeep Contract
1. Check **Upkeep** in the Casting Attributes section
2. Verify the Duration & Persistence section shows "Enabled — engine will auto-prompt renewal"

### 5.4 Dispel Identity
1. Change **Dispel Strength** dropdown — verify `system.engine.persistence.dispelStrength` persists
2. Select "Fixed" — verify the **Fixed Value** field appears
3. Enter a fixed value — verify `system.engine.persistence.dispelFixedValue` persists
4. Select a different option — verify the Fixed Value field hides

---

## 6. Casting Tab — Advanced Features

### 6.1 Rune/Trap
1. Scroll to the **Advanced Features** section
2. Check the **Rune / Trap** checkbox — verify the config fieldset appears
3. Select a Trigger type, set Radius and Delay
4. Uncheck — verify section hides
5. Verify `system.isRuneSpell`, `system.runeTriggerType`, `system.runeTriggerRadius`, `system.runeTriggerDelay` persist

### 6.2 Persistent Zone
1. Check **Persistent Zone** — verify hint text appears
2. Verify `system.isZonePersistent` persists

### 6.3 OverTime
1. Check **OverTime** — verify the config fieldset appears
2. Configure Trigger, Cadence, Max Ticks
3. Select Payload type, Formula, Damage Type
4. Select "Save Then Apply" payload — verify the save fields appear
5. Test preset buttons: DoT, HoT, Save Each Round, End After 3 Rounds
6. Each preset should fill all OverTime fields with appropriate defaults
7. Verify all `system.overTime.*` fields persist

### 6.4 Summon
1. Check **Summon** — verify Actor UUID and Quantity fields appear
2. Enter an Actor UUID and set Quantity
3. Verify `system.engine.summon.actorUuid` and `system.engine.summon.quantity` persist

---

## 7. Information Tab

### 7.1 Validation
1. Switch to the **Information** tab
2. Click **Validate** on a minimally configured spell
3. Verify errors (red) and warnings (orange) appear in the output area
4. Fix the issues (e.g., add a school, set cost > 0) and re-validate
5. Verify "valid" status when all critical fields are configured

### 7.2 Coverage Report
1. Verify the coverage checklist renders with green checkmarks for configured features and gray circles for unconfigured ones
2. Configure additional features (AoE, OverTime, Scaling) and reopen the sheet
3. Verify the checklist updates to reflect the new configuration

### 7.3 Resolved Profile Preview
1. Open a spell owned by an actor
2. Click **Preview** — verify a JSON-formatted resolved profile appears
3. Verify the profile includes: metadata, classification, cost, damage, duration, range, aoe, scaling, mindlock, engine
4. Open a world-level spell (not owned by an actor)
5. Click **Preview** — verify an error message says the spell must be owned

---

## 8. Back-Compatibility

### 8.1 Legacy Spell Items
1. Open a pre-existing spell that was created before the engine configurator
2. Verify the sheet renders without errors
3. Verify all existing fields (cost, level, school, type, duration, etc.) display correctly
4. Verify the QA coverage report shows unconfigured engine fields appropriately

### 8.2 Data Preservation
1. Open a pre-existing spell and make NO changes — close the sheet
2. Verify no unexpected data was written to the item (check browser console for update calls)
3. Open the spell again — verify all data is intact

---

## 9. Multi-User (Authority Proxy)

### 9.1 Non-Owner Editing
1. Log in as a non-GM player
2. Open a spell owned by the player's character
3. Verify all fields are editable and changes persist
4. Verify the QA tab validation and preview work correctly

### 9.2 Read-Only Access
1. Log in as a player without edit access to a spell
2. Open the spell sheet — verify all fields are disabled/read-only
3. Verify Add/Remove buttons for scaling levels and recipes are disabled

---

## Known Limitations

- **Effect recipes are advisory**: The recipe builder defines structured effects, but the engine doesn't automatically create Active Effects from them yet. This is planned for a future update.
- **Resolved profile preview requires an actor**: World-level spells can't be previewed because `resolveSpellProfile` requires both spell and actor.
- **No automated tests**: Verification is manual. Use `game.uesrpg.dumpAEKeys(actor)` for AE debugging.

## Debug Settings

Enable these in the Debug Settings menu for verbose logging:
- `spellCastingDebug` — Spell casting workflow logs
- `effectsProxyDebug` — Authority proxy mutation logs
- `aeLifecycleDebug` — Active Effect lifecycle logs
