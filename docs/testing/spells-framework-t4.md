# T4 — OverTime Effects Framework: Manual Test Plan

**Scope:** OverTime engine (DoT/HoT/saves per tick), Origin-linked targeting, spell sheet UX authoring + presets.

**Files Modified/Created:**
- `src/core/magic/overtime-engine.js` — **New**: OverTime effects engine
- `src/core/magic/spell-effects.js` — Modified: OverTime flags injection on AE creation
- `src/ui/sheets/item/listeners/index.js` — Modified: OverTime preset button listeners
- `src/hooks/init.js` — Modified: `spellTickDebug` and `overTimeDebug` settings
- `src/system.js` — Modified: Engine init + API exposure
- `templates/spell-sheet.html` — Modified: OverTime checkbox + config UI + presets
- `template.json` — Modified: `hasOverTime`, `overTime.*` spell schema

---

## Pre-Conditions

1. Foundry VTT v13.351 running with UESRPG 3ev4 system
2. GM user logged in
3. At least one PC actor and one NPC actor in the world
4. An active combat encounter with both actors

---

## T4-A Tests: OverTime Engine + Schema

### Test A1 — Engine Initialization
1. Open browser console
2. Verify no errors during world load
3. Run `game.uesrpg.magic.overTime.createConfig()` — should return a valid OverTime config object with all fields populated

### Test A2 — Manual DoT Effect
1. Open a PC actor sheet
2. Go to Effects tab, create a new ActiveEffect named "Burning Test"
3. In the AE's Details tab, add the following flag (via console):
   ```js
   const actor = game.actors.getName("YourPC");
   const ef = actor.effects.getName("Burning Test");
   await ef.update({
     "flags.uesrpg-3ev4.overTime": game.uesrpg.magic.overTime.createConfig({
       trigger: "turnEnd",
       payload: { type: "damage", formula: "1d6", damageType: "fire" },
       label: "Burning Test"
     })
   });
   ```
4. Advance combat turns so the PC's turn ends
5. **Expected:** Chat message appears showing damage dealt, HP reduced

### Test A3 — Healing Over Time
1. Create AE "Regeneration Test" on an actor
2. Set overTime config with `payload.type: "heal"`, `formula: "1d4"`
3. Advance combat turns
4. **Expected:** Chat message shows healing applied, HP increased (capped at max)

### Test A4 — Max Ticks Auto-End
1. Create DoT effect with `state.maxTicks: 2`
2. Advance 2 combat turns
3. **Expected:** After 2 ticks the effect auto-deletes from the actor

### Test A5 — Cadence Gating (Every 2 Rounds)
1. Create DoT effect with `cadence.every: 2, cadence.unit: "rounds"`
2. Advance combat 3 rounds
3. **Expected:** Effect fires on round 1 (first tick), skips round 2, fires on round 3

### Test A6 — GM-Only Enforcement
1. Log in as a non-GM player
2. Have an OverTime AE on the player's actor
3. Advance combat as GM
4. **Expected:** Tick processing occurs only on GM client

---

## T4-B Tests: Saves + Origin-Linked Targeting

### Test B1 — SaveThenApply Payload
1. Create AE with overTime config:
   ```js
   game.uesrpg.magic.overTime.createConfig({
     trigger: "turnEnd",
     payload: {
       type: "saveThenApply",
       formula: "2d6",
       damageType: "poison",
       saveKey: "end",
       saveTN: 50,
       saveSuccess: "endEffect",
       saveFailure: "damage"
     },
     label: "Poison Save Test"
   })
   ```
2. Advance combat turns
3. **Expected:** Chat shows d100 roll vs END TN, then either damage on failure or effect removal on success

### Test B2 — Save Halve Action
1. Same as B1 but with `saveSuccess: "halve"`
2. On success: damage formula applied at half
3. **Expected:** Chat shows halved damage amount

### Test B3 — Origin-Linked Targeting
1. Cast a spell with OverTime from Actor A targeting Actor B
2. The spell's Origin AE on Actor A should have `linkedEntities` entries with Actor B's UUID
3. Advance combat (Actor A's turn ends)
4. **Expected:** The OverTime payload (damage/heal) applies to Actor B (the linked target), NOT Actor A
5. **Expected:** Chat message names Actor B as the affected target

### Test B4 — Multiple Linked Targets
1. Cast an AoE spell with OverTime targeting Actors B and C
2. Advance combat
3. **Expected:** Both B and C receive the OverTime tick

### Test B5 — Characteristic Labels
1. Create saveThenApply effect with `saveKey: "wp"`
2. Advance combat
3. **Expected:** Chat shows "WP" label (from `characteristics.wp.name`) in the save result

---

## T4-C Tests: Spell Sheet UX Authoring + Presets

### Test C1 — OverTime Checkbox
1. Open a spell item sheet → Attributes tab
2. Check "OverTime" checkbox
3. **Expected:** OverTime configuration section appears with all fields

### Test C2 — OverTime Config Fields
1. With OverTime enabled, change:
   - Trigger → "Turn End"
   - Every → 2
   - Cadence Unit → "Rounds"
   - Payload → "Damage"
   - Formula → "2d10"
   - Damage Type → "Frost"
   - Max Ticks → 5
   - Label → "Frostbite"
2. Save the spell
3. Reopen → **Expected:** All values persist correctly

### Test C3 — SaveThenApply Conditional Fields
1. Set Payload type to "Save Then Apply"
2. **Expected:** Additional fields appear: Save Characteristic dropdown, Save TN, On Success, On Failure
3. Set saveKey to "END", saveTN to 40
4. Save and reopen → values persist

### Test C4 — DoT Preset
1. Click "DoT (Turn Start)" preset button
2. **Expected:** Fields auto-fill:
   - Trigger: "Turn Start"
   - Formula: "1d6"
   - Damage Type: "Fire"
   - Label: "Burning"
   - Payload: "Damage"

### Test C5 — HoT Preset
1. Click "HoT (Turn End)" preset button
2. **Expected:** Fields auto-fill with heal payload, trigger turnEnd, label "Regeneration"

### Test C6 — Save Each Round Preset
1. Click "Save Each Round" preset button
2. **Expected:** Payload type changes to "saveThenApply", saveKey "end", saveTN 50

### Test C7 — End After 3 Rounds Preset
1. Click "End After 3 Rounds" preset button
2. **Expected:** maxTicks set to 3, payload damage

### Test C8 — Spell Cast → AE Has OverTime Flags
1. Configure a spell with OverTime (DoT preset)
2. Cast the spell targeting an actor
3. Inspect the created AE on the target: `ef.flags["uesrpg-3ev4"].overTime`
4. **Expected:** OverTime config is present with matching values from the spell's config

---

## Integration Tests

### Test I1 — Full DoT Workflow (End-to-End)
1. Create a fire spell with DoT preset, Level 1, Duration 5 rounds
2. Cast it on NPC target
3. Verify Origin AE created on caster
4. Verify target AE has `overTime` flags
5. Advance 3 combat rounds
6. **Expected:** 3 damage chat messages appear, HP reduced each time

### Test I2 — Full Save Workflow (End-to-End)
1. Create a poison spell with Save Each Round preset, Duration 10 rounds
2. Cast it on NPC target
3. Advance combat turns
4. **Expected:** Each turn, a save is rolled. On success: effect ends. On failure: damage applied.

### Test I3 — Debug Logging
1. Enable `overTimeDebug` via console: `game.settings.set("uesrpg-3ev4", "overTimeDebug", true)`
2. Also enable `spellTickDebug`: `game.settings.set("uesrpg-3ev4", "spellTickDebug", true)`
3. Advance combat with active OverTime effects
4. **Expected:** Console shows `[UESRPG][OverTime]` and `[UESRPG][SpellTick]` diagnostic messages

### Test I4 — No OverTime When hasOverTime is false
1. Create a normal spell without OverTime checkbox
2. Cast it
3. Inspect target AE flags
4. **Expected:** No `overTime` property in the flags

### Test I5 — OverTime API Exposure
1. Run in console:
   - `game.uesrpg.magic.overTime.createConfig()` → returns default config
   - `game.uesrpg.magic.overTime.hasConfig(someEffect)` → returns boolean
   - `game.uesrpg.magic.overTime.getConfig(someEffect)` → returns config or null
2. **Expected:** All three functions work as documented

---

## Regression Checks

- [ ] Existing spell casting (without OverTime) remains unchanged
- [ ] Spell upkeep prompts still function normally
- [ ] Spell effect expiration still works
- [ ] Spell tick engine zone handlers still function
- [ ] Rune/trap triggers unaffected
- [ ] Actor sheet spell effects breakdown shows OverTime effects properly
- [ ] Dispel service can remove OverTime effects
