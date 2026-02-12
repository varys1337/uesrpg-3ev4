# UESRPG OverTime Setup Guide

## What is OverTime?

OverTime effects are timed, repeating spell payloads that fire automatically during combat — such as **damage-over-time (DoT)** or **heal-over-time (HoT)** effects. When a spell with an OverTime configuration is cast, a special entry is embedded into the resulting Active Effect's `changes[]` array. The OverTime Engine detects these entries each time combat advances and executes the configured payload.

---

## Architecture Overview

```
┌──────────────┐    cast     ┌─────────────────┐
│  Spell Item  │ ──────────► │ spell-effects.js │
│  (overTime   │             │ buildOverTimeChange()
│   config)    │             │ push into AE changes[]
└──────────────┘             └────────┬────────┘
                                      │ create AE on target
                                      ▼
                              ┌───────────────┐
                              │ ActiveEffect   │
                              │ changes[]:     │
                              │   key: flags.  │
                              │   uesrpg-3ev4. │
                              │   OverTime     │
                              │   value: JSON  │
                              └───────┬───────┘
                                      │ detected by
                                      ▼
┌──────────────────┐  ticks  ┌─────────────────┐
│ spell-tick-engine│ ──────► │ overtime-engine  │
│ (combat hooks)   │         │ _onTick()        │
└──────────────────┘         │ _collectEffects()│
                             │ _processEffect() │
                             └─────────────────┘
```

### Storage Model (midi-qol / DAE inspired)

OverTime config is stored as a **first-class AE `changes[]` entry**:

| Property | Value |
|----------|-------|
| **key** | `flags.uesrpg-3ev4.OverTime` |
| **mode** | `0` (CUSTOM) |
| **value** | JSON string of the OverTime configuration |
| **priority** | `20` |

Mutable runtime state (tick counts, timestamps) is stored separately at `flags.uesrpg-3ev4.overTimeState` on the AE.

**Why changes[] instead of flags?**
Foundry VTT preserves AE `changes[]` through all document operations (cloning, transfer, embedded creation). Deep nested flag structures were unreliable across the cloning pipeline.

---

## Setting Up OverTime on a Spell

### Step 1: Enable OverTime

1. Open the spell item sheet
2. In the **Engine** tab, find the checkboxes row
3. Check **OverTime**
4. The OverTime configuration fieldset appears below

### Step 2: Configure the OverTime Fields

| Field | Description | Options / Values |
|-------|-------------|-----------------|
| **Trigger** | When the payload fires each tick | `Turn Start`, `Turn End`, `Round Start`, `Round End`, `World Time` |
| **Every** | Cadence interval number | Integer ≥ 1 (e.g., `1` = every round, `2` = every 2 rounds) |
| **Unit** | Cadence time unit | `Rounds` or `Seconds` |
| **Max** | Maximum number of ticks before auto-removal | Integer ≥ 1, or blank for unlimited |
| **Payload** | What happens each tick | `Damage`, `Heal`, `End Effect`, `Save Then Apply` |
| **Formula** | Dice/number expression for damage or healing | e.g., `1d6`, `4`, `2d8+3` |
| **Dmg Type** | Damage type (for damage payloads) | Any system damage type (fire, frost, shock, poison, etc.) |
| **Label** | Display name in chat messages | e.g., "Burning", "Regeneration" |
| **Chat Log** | Whether to post chat messages on each tick | Checkbox (default: on) |

#### Save-Based Fields (visible when Payload = "Save Then Apply")

| Field | Description |
|-------|-------------|
| **Save** | Characteristic used for the save (STR, END, AGI, INT, WP, PRC, PRS, LCK) |
| **TN** | Target number for the save roll |
| **Pass** | What happens on a successful save: `End Effect`, `Halve Dmg`, `Negate` |
| **Fail** | What happens on a failed save: `Damage`, `Condition` |

### Step 3: Using Presets (Optional)

Click a preset button to instantly populate all OverTime fields:

| Preset | Description |
|--------|-------------|
| **DoT** | Damage each turn start (1d6 fire) |
| **HoT** | Heal each turn end (1d6) |
| **Save Each Round** | Save vs END each turn end, damage on fail (poison) |
| **End After Rounds** | Damage for 3 rounds then auto-remove |

---

## Common Configurations

### Regeneration (HoT)
```
Trigger:     Turn Start
Every:       1 Round
Payload:     Heal
Formula:     4        (or use SS×2 scaling)
Max:         (blank — unlimited, controlled by Upkeep)
Label:       Regeneration
Chat Log:    ☑
```

### Burning (DoT)
```
Trigger:     Turn Start
Every:       1 Round
Payload:     Damage
Formula:     2d6
Dmg Type:    Fire
Max:         3        (burns for 3 rounds)
Label:       Burning
Chat Log:    ☑
```

### Poison (Save to End)
```
Trigger:     Turn End
Every:       1 Round
Payload:     Save Then Apply
Formula:     1d6
Dmg Type:    Poison
Save:        END
TN:          50
Pass:        End Effect
Fail:        Damage
Max:         10       (max 10 rounds)
Label:       Poisoned
Chat Log:    ☑
```

### Slow Drain (Every 2 Rounds)
```
Trigger:     Turn Start
Every:       2 Rounds
Payload:     Damage
Formula:     1d4
Dmg Type:    Magic
Max:         (blank)
Label:       Mana Drain
Chat Log:    ☑
```

---

## How It Works at Runtime

### 1. Spell Cast → AE Creation

When `applySpellEffectsToTarget()` is called:
- If the spell has `hasOverTime: true` and `overTime` data, `buildOverTimeChange()` creates an AE changes entry
- This entry is pushed into the AE's `changes[]` array before creation on the target
- Two paths exist:
  - **Embedded AE path**: Spell has its own ActiveEffects → OverTime change pushed into cloned effect's changes
  - **Tracker AE path**: Spell has no embedded AEs → A tracker AE is created with the OverTime change

### 2. Combat Advances → Tick Dispatch

The **Spell Tick Engine** (`spell-tick-engine.js`) listens for combat hooks:
- `updateCombat` → detects turn/round changes
- Dispatches `turnStart`, `turnEnd`, `roundStart`, `roundEnd` triggers
- Calls all registered tick handlers, including the OverTime engine

### 3. OverTime Engine Processes Effects

For each tick:
1. **Index Check**: The engine maintains a cached **effect index** of actors carrying OverTime effects. The index is lazily rebuilt when any ActiveEffect is created, updated, or deleted — avoiding full-scan on every tick.
2. **Collection**: Iterates indexed actors only, resolving live effects and applying filter gates
3. **Filter Gates** (in order):
   - Effect must not be **disabled**
   - Effect must not be **awaiting upkeep** (`upkeepAwaiting` flag) — OverTime pauses while the upkeep decision is pending
   - Config trigger must match the current tick trigger
   - Turn-based triggers require actor UUID match (prevents cross-token bleeding for unlinked tokens)
   - Cadence gating (every N rounds/seconds)
   - Max ticks gating
4. **Execution**: Runs the configured payload (damage, healing, save, or end effect)
5. **State Update**: Increments tick count, records last-tick timestamps
6. **Chat**: Posts results if chatLog is enabled

### 4. Upkeep Integration

For spells with **Upkeep**, the OverTime engine cooperates with the upkeep workflow:

1. When a spell's duration expires, `spell-effect-expiration.js` **disables** the AE and sets `upkeepAwaiting: true`
2. The OverTime engine **skips** effects with `upkeepAwaiting: true` — no payload fires while the upkeep prompt is pending
3. If the player **confirms** upkeep: the AE is re-enabled, `upkeepAwaiting` is cleared, and OverTime resumes on the next tick
4. If the player **cancels** upkeep (or the grace window expires): the AE is deleted, and the associated Origin AE triggers teardown of all linked effects

This ensures OverTime payloads never fire for effects in upkeep limbo.

### 5. Effect Cleanup

- **Max Ticks**: When `tickCount >= maxTicks`, the AE is automatically deleted
- **Upkeep Expiry**: For Upkeep spells, the AE is removed when upkeep lapses
- **Manual Removal**: GM or player can delete the AE from the effects tab

---

## Debugging

### Enable Debug Logging

Open the UESRPG Debug Settings menu and enable **OverTime Debug**. This sends detailed logs to the console:

```
[UESRPG][OverTime] ═══ OverTime Tick START ═══
[UESRPG][OverTime] Collection Summary: 1 eligible | scanned 3 effects on 4 actors
[UESRPG][OverTime]   Skipped: disabled=0, upkeepAwaiting=0, stale=0, wrongTrigger=1, wrongActor=0, cadence=0, maxTicks=0
```

### Inspect an AE's OverTime Data

In the browser console:
```javascript
// Get an actor
const actor = canvas.tokens.controlled[0]?.actor;

// List all effects with OverTime changes
for (const ef of actor.effects) {
  const otChanges = ef.changes.filter(c => c.key.startsWith("flags.uesrpg-3ev4.OverTime"));
  if (otChanges.length) {
    console.log(ef.name, otChanges.map(c => JSON.parse(c.value)));
  }
}

// Check using API
game.uesrpg.magic.overTime.hasConfig(actor.effects.contents[0]);
game.uesrpg.magic.overTime.getConfig(actor.effects.contents[0]);
```

### Manually Add OverTime to an AE (API)

```javascript
// Build a change entry
const change = game.uesrpg.magic.overTime.buildChange({
  trigger: "turnStart",
  payloadType: "heal",
  formula: "1d8",
  label: "Custom Regen"
});

// Add to an existing AE
const effect = actor.effects.getName("My Effect");
const updatedChanges = [...effect.changes, change];
await effect.update({ changes: updatedChanges });
```

---

## Payload Types Reference

| PayloadType | Behavior |
|-------------|----------|
| `damage` | Rolls `formula`, subtracts from target HP. Posts damage type and amount. |
| `heal` | Rolls `formula`, adds to target HP (capped at max HP). Posts healing amount. |
| `endEffect` | Removes the AE from the target. No roll. |
| `saveThenApply` | Rolls 1d100 vs `saveTN + characteristic bonus`. On pass: executes `saveSuccess` action. On fail: executes `saveFailure` action. |

### Save Success Actions

| Value | Behavior |
|-------|----------|
| `endEffect` | Removes the AE from the target |
| `halve` | Applies half damage (formula ÷ 2) |
| `negate` | No effect this tick |

### Save Failure Actions

| Value | Behavior |
|-------|----------|
| `damage` | Applies full damage from formula |
| `condition` | Posts "condition persists" message (effect stays) |

---

## Trigger Reference

| Trigger | When it fires | Best for |
|---------|--------------|----------|
| `turnStart` | At the start of the affected actor's turn | DoT that should fire before they act |
| `turnEnd` | At the end of the affected actor's turn | HoT, save-to-end-at-end-of-turn |
| `roundStart` | At the start of each combat round | Round-based group effects |
| `roundEnd` | At the end of each combat round | Round-based cleanup effects |
| `worldTime` | When world time advances outside combat | Out-of-combat effects (use `seconds` cadence unit) |

---

## Troubleshooting

### "0 eligible effects found"

1. **Are you the GM?** OverTime processing is GM-only
2. **Are the tokens unlinked?** The engine scans synthetic token actors correctly — make sure the AE was actually created (check the token actor's Effects tab)
3. **Is the AE disabled?** Disabled AEs are skipped
4. **Does the AE have the changes entry?** Open the AE's Changes tab — you should see a `flags.uesrpg-3ev4.OverTime` key with mode `Custom (0)` and a JSON value
5. **Does the trigger match?** If OverTime is set to `turnStart` but the combatant hasn't started their turn yet, it won't fire

### "Effect created but changes[] is empty"

The spell's `hasOverTime` is `false` or `overTime` sub-object is missing/empty. Check:
- Spell sheet → Engine tab → OverTime checkbox is checked
- OverTime fieldset shows correct values (not all defaults)
- The spell was properly saved after enabling OverTime

### "OverTime stopped firing after duration expired"

This is expected behavior when the spell has **Upkeep**. When the duration boundary is reached:
1. The AE is disabled and `upkeepAwaiting` is set to `true`
2. The OverTime engine skips effects with `upkeepAwaiting`
3. Respond to the upkeep chat prompt — **Upkeep** re-enables it; **End** deletes it
4. If neither button is clicked within 1 round (grace window), the effect is automatically deleted

Check the debug console for `upkeepAwaiting=N` in the skip counters to confirm this is happening.

### "Heal payload shows as Damage in dropdown"

If you imported from an older compendium, the spell might have `payloadType: "healing"` (legacy value). The engine handles both `"heal"` and `"healing"`, but the UI normalizes to `"heal"`. Re-save the spell sheet to update.

---

## API Reference

Available at `game.uesrpg.magic.overTime`:

| Method | Description |
|--------|-------------|
| `createConfig(overrides)` | Create a default OverTime config object |
| `hasConfig(effect)` | Check if an AE has OverTime configuration |
| `getConfig(effect)` | Get the first OverTime config from an AE |
| `buildChange(config)` | Build a changes[] entry for AE creation |
| `CHANGE_KEY` | The AE changes key constant (`flags.uesrpg-3ev4.OverTime`) |
