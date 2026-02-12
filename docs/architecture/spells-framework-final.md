# Spell Framework — Final Architecture Document

> UESRPG 3ev4 · Foundry VTT v13.351  
> Last updated: 2026-02-07 (T6 — Regression & Stability Gates)  
> Supersedes: `spells-framework-baseline.md` (T0, 2026-02-06)

This document captures the **current, implemented** architecture of the UESRPG spell system after completion of phases T0 through T6. Where the T0 baseline identified gaps, this document records how they were resolved.

---

## Table of Contents

1. [Spell Item Schema](#1--spell-item-schema)
2. [Casting Pipeline](#2--casting-pipeline)
3. [Spell Routing & Classification](#3--spell-routing--classification)
4. [Spell Effect Application](#4--spell-effect-application)
5. [Origin AE Lifecycle](#5--origin-ae-lifecycle)
6. [Upkeep Workflow](#6--upkeep-workflow)
7. [Spell Tick Engine](#7--spell-tick-engine)
8. [OverTime Engine](#8--overtime-engine)
9. [Damage & Healing Pipelines](#9--damage--healing-pipelines)
10. [Spell Hooks](#10--spell-hooks)
11. [Condition Triggers](#11--condition-triggers)
12. [Spell Reflect](#12--spell-reflect)
13. [Paired AE (Absorb)](#13--paired-ae-absorb)
14. [Summon Service & Binding](#14--summon-service--binding)
15. [Bound Item Service](#15--bound-item-service)
16. [Soul Trap Service](#16--soul-trap-service)
17. [Rune Trigger Service](#17--rune-trigger-service)
18. [Zone Service](#18--zone-service)
19. [Dispel Service](#19--dispel-service)
20. [Modifier Registry](#20--modifier-registry)
21. [Backfire System](#21--backfire-system)
22. [Casting TN Computation](#22--casting-tn-computation)
23. [Migrations & Normalization](#23--migrations--normalization)
24. [Service Initialization Order](#24--service-initialization-order)
25. [Dependency Map](#25--dependency-map)
26. [Performance Guardrails](#26--performance-guardrails)
27. [Resolved Gaps from Baseline](#27--resolved-gaps-from-baseline)
28. [Known Limitations](#28--known-limitations)

---

## 1 · Spell Item Schema

Spells are `Item` documents with `type: "spell"`. Key `system` fields:

| Field | Type | Purpose |
|-------|------|---------|
| `school` | string | `alteration\|conjuration\|destruction\|illusion\|mysticism\|restoration` |
| `spellType` | string | `conventional` (future: `power`, `ritual`) |
| `level` | number | Spell level (1–7) |
| `cost` | number | Base MP cost |
| `spell_str` | string | Spell Strength (dice formula or numeric) |
| `scaling.levels[]` | array | `{level, cost, spellStr}` per purchasable level |
| `isAttackSpell` | boolean | Requires attack roll |
| `isDamagingSpell` | boolean | Deals damage |
| `isHealingSpell` | boolean | Restores HP |
| `isDirect` | boolean | No attack roll; may require save |
| `hasUpkeep` | boolean | Duration can be refreshed |
| `hasOverload` | boolean | Can spend extra for bonus damage |
| `damageType` | string | `fire\|frost\|shock\|magic\|healing` |
| `damageFormula` | string | Dice expression for damage |
| `isRuneSpell` | boolean | Uses rune trigger mechanics |
| `isSummonSpell` | boolean | Spawns a creature |
| `mindlockValue` | number | AP reduction on caster for summons |
| `overTime` | object | OverTime tick config (see §8) |

### Spell Flags (`flags.uesrpg-3ev4`)

| Flag | Purpose |
|------|---------|
| `conjureType` | `"weapon"\|"armor"` — triggers bound item service |
| `tempItemProfiles` | SS → profile name mapping for bound items |
| `summonType` | `"daedra"\|"construct"` |
| `summonProfiles[]` | `{name, level, cost, spellStr}` per summonable creature |

---

## 2 · Casting Pipeline

**Entry point:** `SpellCastingService.cast(cfg)` in `casting-service.js`

```
User clicks "Cast" on spell sheet
        │
        ▼
SpellCastingService.cast({actorUuid, spellUuid, options})
        │
        ├─ resolveSpellProfile()     — level/cost/SS selection
        ├─ _validateCastPrerequisites() — MP/AP/ownership checks
        ├─ _showSpellOptionsDialog()  — overload, target selection
        ├─ emitPreCast()             — cancellable hook
        │
        ▼
   _routeToWorkflow()
        │
        ├─ isDirect ──► MagicOpposedWorkflow.castDirectTargeted()
        ├─ hasTargets ─► MagicOpposedWorkflow.createPending()
        └─ else ───────► MagicOpposedWorkflow.castUnopposed()
```

### Action Channels

- **Primary Action**: Default; costs 1 AP
- **Secondary Action**: Instant spells; no AP cost
- AP deduction handled inside `MagicOpposedWorkflow`

### Post-Cast Flow

After the opposed/direct/unopposed workflow resolves:
1. `emitCastResolved()` — fires regardless of success/failure
2. If successful: spell effects applied via `applySpellEffectsToTarget()`
3. `emitEffectApplied()` — fires after AE creation
4. If Origin AE required: `createOriginAE()` → `uesrpg.spell.originCreated`

---

## 3 · Spell Routing & Classification

**Module:** `spell-routing.js`

`classifySpellForRouting(spell)` returns:
- `isAttack` — from `system.isAttackSpell`
- `isHealing` — from `system.isHealingSpell` or healing damage types
- `isDirect` — from `system.isDirect`
- `isTargeted` — derived: `isAttack || isHealing || isDirect`

`shouldUseModernSpellWorkflow()` always returns `true` (legacy path fully deprecated).

---

## 4 · Spell Effect Application

**Module:** `spell-effects.js`

`applySpellEffectsToTarget(targetActor, spell, casterActor, options)`:

1. **De-stacking**: Removes existing AEs from same spell origin (RAW: spells don't stack with themselves)
2. **Opposing effects**: Removes mutually exclusive effects (e.g., Frenzy removes Calm)
3. **Duration computation**: `computeSpellDuration()` → `{rounds, seconds, unit}`
4. **AE creation**: Clones spell's embedded AEs with comprehensive system flags:
   - `spellEffect`, `spellUuid`, `spellName`, `spellSchool`, `spellLevel`
   - `casterUuid`, `originalCastWorldTime`
   - `hasUpkeep`, `upkeepCost`, `noListedDuration`
   - `effectGroup`, `stackRule`, `source`
5. **Key validation**: `validateAEChanges()` from modifier registry
6. **Origin AE integration**: `createOriginAE()` + `registerTargetAEs()`
7. **Hook emission**: `emitEffectApplied()`

### Tracking Modes

| Mode | Condition | Duration Object |
|------|-----------|-----------------|
| `combat` | In combat + rounds unit | `{startRound, startTurn, rounds, combat}` |
| `time` | Seconds-based | `{startTime, seconds}` |
| `none` | Instant | No duration |
| `permanent` | Permanent | No expiry |

---

## 5 · Origin AE Lifecycle

**Module:** `origin-effect.js` (~716 lines)

The Origin AE is the **single source of truth** for a spell's lifecycle. It lives on the **caster** and tracks all downstream entities created by the spell.

### Creation

`createOriginAE(caster, spell, options)`:
- Creates a disabled AE with `isOriginAE: true` flag
- Stores spell metadata, duration, upkeep config
- Initializes empty `linkedEntities: []`
- Emits `uesrpg.spell.originCreated`

### Linked Entity Registration

`registerLinkedEntity(originEffect, {type, uuid, actorUuid?, label?})`:

| Entity Type | Registered By | Cleanup Action |
|-------------|---------------|----------------|
| `targetAE` | `spell-effects.js` | Delete AE from target actor |
| `template` | `spell-zone-service.js` | Delete MeasuredTemplate from scene |
| `summon` | `summon-service.js` | Delete Token from scene |
| `casterBuff` | `paired-ae.js`, `summon-binding.js` | Delete AE from caster |
| `boundItem` | `bound-item-service.js` | Delete Item from caster |

### Teardown Cascade

`teardownOriginAE(originEffect)`:
1. Iterates all `linkedEntities` → calls `_deleteLinkedEntity()` per entry
2. Runs `_cleanOrphanTargetAEs()` — belt-and-suspenders scan of all world actors
3. Emits `uesrpg.spell.ended`

### Hook Registration

- `Hooks.on("deleteActiveEffect")` → triggers `teardownOriginAE()` when an Origin AE is deleted (GM-only)

### Idempotency

- `teardownOriginAE()` is idempotent: already-deleted entities produce warnings, not errors
- `registerLinkedEntity()` deduplicates by UUID
- Re-entrant deletion (cancel → deleteAE hook → teardown) is safe due to the linked-entities-already-cleaned check

---

## 6 · Upkeep Workflow

**Module:** `upkeep-workflow.js` (~851 lines)

### Flow

1. Duration approaches expiry → time hooks detect
2. Upkeep prompt displayed to caster (dialog)
3. If **accepted**: MP deducted (original cost); `refreshOriginAEUpkeep()` resets Origin AE duration
4. If **declined**: `cancelOriginAEUpkeep()` deletes Origin AE → cascade teardown

### Deduplication (Three Layers)

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| `_recentPromptCache` | In-memory Map with TTL | Prevents re-prompting within same round |
| `_promptLocks` | Set-based concurrency lock | Prevents concurrent prompts for same group key |
| Prompt signature | Group key + prompt metadata | Deduplicates across rapid time advances |

### Group Key

Format: `{casterUuid}::{spellUuid}::{originalCastWorldTime}`

Uniquely identifies a spell cast instance across all actors and time.

---

## 7 · Spell Tick Engine

**Module:** `spell-tick-engine.js` (~236 lines)

Central dispatcher that converts time/combat hooks into typed tick events consumed by registered handlers.

### Input Hooks

| Hook | Dispatched Ticks |
|------|-----------------|
| `uesrpg.combatTimeChanged` | `turnEnd` (for ended combatant), `roundEnd` (on round change) |
| `uesrpg.timeChanged` | `worldTime` |

### Double-Tick Prevention

- **Combat state snapshots**: `_combatState` Map stores `{round, turn, combatantId}` per combat. On each `combatTimeChanged`, compares previous snapshot with current; only dispatches if values actually changed.
- **Handler ID dedup**: `registerSpellTickHandler()` prevents duplicate handler registration by checking `id` uniqueness.
- **GM-only execution**: Only the GM client dispatches ticks.

### Handler Interface

```javascript
registerSpellTickHandler({
  id: "overtime-engine",  // unique string
  onTick: async (ctx) => { /* ctx = {trigger, actor, round, turn, worldTime, dtSeconds, combat} */ }
});
```

### Built-in Zone Tick

`registerZoneTickHandler()` emits `uesrpg.spell.zoneTick` on `turnEnd` for zone-persistent spells.

---

## 8 · OverTime Engine

**Module:** `overtime-engine.js` (~609 lines)

Processes per-tick damage, healing, saves, and auto-deletion for spell AEs with OverTime configurations.

### Config Schema

```javascript
{
  trigger: "turnEnd"|"turnStart"|"roundEnd"|"worldTime",
  cadenceEvery: 1,        // tick every N units
  cadenceUnit: "rounds",  // "rounds"|"minutes"|"hours"
  payloadType: "damage"|"heal"|"endEffect"|"saveThenApply",
  formula: "1d6",         // dice or numeric
  damageType: "fire",     // for damage payloads
  saveKey: "wp",          // characteristic for saves
  saveTN: 50,             // save target number
  saveSuccess: "endEffect", // what happens on save success
  saveFailure: "damage",    // what happens on save failure
  maxTicks: null,         // auto-delete after N ticks (null = unlimited)
  label: "Poison DoT",
  chatLog: true,          // post chat per tick
  state: {
    tickCount: 0,
    lastTickRound: 0,
    lastTickTurn: 0,
    lastTickWorldTime: 0,
    maxTicks: null
  }
}
```

### Effect Collection

`_collectOverTimeEffects(trigger, ctx)`:
- **Full scan**: Iterates all `game.actors.contents` + all `canvas.tokens.placeables`
- **Per-effect filters**: trigger type match, cadence gate, maxTicks cap
- **Actor scope**: For `turnEnd`/`turnStart`, only processes effects on the actor whose turn just ended

### Cadence Gating

`_isCadenceMet(effect, ctx)`: Compares `lastTickRound`/`lastTickWorldTime` against current values plus `cadenceEvery` interval.

### Tick State Persistence

`_updateTickState()`: After each tick, writes updated `{tickCount, lastTickRound, lastTickWorldTime}` to the AE's flags. If `tickCount >= maxTicks`, AE is auto-deleted.

### Emitted Hook

`uesrpg.overTime.tick` — payload: `{effect, actor, trigger, result, tickCount}`

---

## 9 · Damage & Healing Pipelines

**Module:** `damage-application.js` (~333 lines)

### Spell Damage Flow

1. **Spell Absorption check**: `_applySpellAbsorption()` reads trait registry + AE flags; threshold-based `1d10` roll; if absorbed → MP restored to target, spell negated
2. **Delegate to combat pipeline**: `applyDamage()` from `combat/damage-automation.js`
3. **Authority proxy**: HP updates routed through `requestUpdateDocument()`

### Spell Healing Flow

- `applyMagicHealing()`: Direct HP restoration, capped at max HP
- Authority proxy for mutations

### Overload

- `+WB to Dmg` — adds caster's Willpower Bonus to damage roll
- Checked in opposed workflow before damage resolution

---

## 10 · Spell Hooks

**Module:** `spell-hooks.js` (~100 lines)

Pure emitter module — provides functions that other modules call to fire hooks.

| Hook | Type | When | Key Payload Fields |
|------|------|------|--------------------|
| `uesrpg.spell.preCast` | `Hooks.call()` (cancellable) | Before resources spent | `caster, spell, profile, spellOptions, targetUuids` |
| `uesrpg.spell.castResolved` | `Hooks.callAll()` | After casting roll | `caster, spell, result, success, backfired, mpSpent, messageId` |
| `uesrpg.spell.effectApplied` | `Hooks.callAll()` | After AEs on target | `caster, target, spell, effects[], originEffect` |
| `uesrpg.spell.originCreated` | `Hooks.callAll()` | After Origin AE created | `casterActor, spell, originEffect, options` |
| `uesrpg.spell.ended` | `Hooks.callAll()` | After teardown | `spellUuid, spellName, casterUuid, deletedCount, errors` |
| `uesrpg.spell.upkeepRefreshed` | `Hooks.callAll()` | After upkeep payment | `originEffect, cost` |
| `uesrpg.spell.summonSpawned` | `Hooks.callAll()` | After summon token created | `casterActor, summonActor, tokenDoc, spell, originEffect` |
| `uesrpg.spell.runeDetonated` | `Hooks.callAll()` | After rune detonation | `originAE, targets` |
| `uesrpg.spell.dispelled` | `Hooks.callAll()` | After dispel resolution | `targetActor, dispellerActor, spellStrength, dispelled` |
| `uesrpg.spell.zoneTick` | `Hooks.callAll()` | Zone tick via tick engine | `trigger, round, turn` |
| `uesrpg.overTime.tick` | `Hooks.callAll()` | OverTime tick processed | `effect, actor, trigger, result, tickCount` |

---

## 11 · Condition Triggers

**Module:** `condition-triggers.js` (~158 lines)

### Invisibility Break

`breakInvisibility(actor, reason)`:
1. Clears `system.traits.condition.invisible` flag
2. Removes AEs that set the invisible condition
3. Removes Origin AEs for "Invisibility" spell (cascade teardown)
4. Posts chat notification with reason

### Trigger Points

| Trigger | Source | Condition |
|---------|--------|-----------|
| Attack spell cast | `uesrpg.spell.castResolved` hook | `success: true` + `isAttackSpell` + caster is invisible |
| Melee/ranged attack | `attack-tracker.js` `incrementAttacks()` | Actor is invisible |

### GM-Only

Both hook handler and `breakInvisibility()` guard on `game.user.isGM`.

---

## 12 · Spell Reflect

**Module:** `spell-reflect.js` (~134 lines)

### Threshold

`getSpellReflectThreshold(actor)`: `max()` of AE-aggregated `system.modifiers.magic.spellReflect` and direct data path.

### Resolution

`trySpellReflect(target, spell, caster, options)`:

| Condition | Result |
|-----------|--------|
| `spellLevel > threshold` | Not reflected |
| Self-target | Not reflected (guard) |
| `options.alreadyReflected` | Not reflected (loop prevention) |
| Absorb [Char] spell (Mysticism, not Life/Magicka) | `behavior: "cancel"` — no net effect |
| All other spells | `behavior: "redirect"` — apply to caster instead |

### Integration

Injected into all 4 resolution functions in `outcome-resolution.js`:
- `resolveDirectUndefendable`, `resolveDirectNoTest`, `resolveHealingDirect`: **effectiveTarget pattern** — `const effectiveTarget = reflected ? caster : target`
- `resolveOpposedTest`: **early-return pattern** — reflect check before opposed mechanics, synthetic outcome, self-contained damage application

---

## 13 · Paired AE (Absorb)

**Module:** `paired-ae.js` (~178 lines)

Hooks `uesrpg.spell.effectApplied`. For Absorb [Characteristic] spells (Mysticism school, name "Absorb {Str|End|Agi|Int|WP|Prc|Prs}"):

1. Each target debuff AE's numeric change values are negated (e.g., `-5` → `+5`)
2. Mirrored buff AE created on caster
3. Registered with Origin AE as `type: "casterBuff"`
4. On Origin AE teardown: both target debuff and caster buff are deleted

---

## 14 · Summon Service & Binding

### Summon Service (`summon-service.js`, ~274 lines)

`spawnSummon(cfg)`:
1. Resolves summon actor (by UUID)
2. Computes spawn position within 5m of caster token
3. Creates unlinked token: `actorLink: false`, friendly disposition, "(Summoned)" suffix
4. Emits `uesrpg.spell.summonSpawned`
5. Registers token with Origin AE as `type: "summon"`

### Summon Binding (`summon-binding.js`, ~268 lines)

Hooks `uesrpg.spell.summonSpawned`:

1. **Mindlock AE**: `system.modifiers.action_points.max` ADD `-mindlockValue` on caster; registered as `type: "casterBuff"`
2. **Restrained penalty**: If spell was Restrained, applies `-1` max AP on summoned creature
3. **Binding prompt**: GM-whispered chat card with creature WP, spell strength, and instructions for manual opposed WP test

On Origin AE teardown: summon token removed, Mindlock AE removed, Restrained AE removed.

---

## 15 · Bound Item Service

**Module:** `bound-item-service.js` (~253 lines)

Hooks `uesrpg.spell.originCreated`. For spells with `flags.uesrpg-3ev4.conjureType`:

1. **Profile lookup**: `_resolveProfileFromCompendium(profileName, conjureType)` — searches all Item compendium packs by name variations (exact, "bound X", "daedric X")
2. **Item creation**: If found, clones item to caster inventory with `isBoundItem: true`, auto-equips. If not found, creates placeholder with GM notification.
3. **Registration**: Item registered as `type: "boundItem"` with Origin AE

Profile selection uses spell strength → `tempItemProfiles` mapping from spell flags.

---

## 16 · Soul Trap Service

**Module:** `soul-trap-service.js` (~244 lines)

### Hook

`Hooks.on("preUpdateActor")` — uses `preUpdateActor` (NOT `updateActor`) because the actor still has old HP values at this point.

### Death Detection

1. `changes.system.hp.value` is finite and ≤ 0
2. `actor.system.hp.value` (old value) was > 0 (alive → dead transition)
3. Actor has Soul Trap marker AE (matched by name or `spellName` flag, case-insensitive)

### Deferred Mutation Pattern

All mutations deferred via `setTimeout(async () => {...}, 100)` to avoid blocking the `preUpdateActor` pipeline:

1. Re-resolves actor via `fromUuid()`
2. Re-verifies HP is actually ≤ 0 (idempotency)
3. Re-verifies Soul Trap AE still exists
4. Resolves caster from AE flags
5. Determines soul size (level-based lookup)
6. Creates filled soul gem item on caster
7. Posts chat notification
8. Deletes Soul Trap marker AE

### Soul Size Table

| Actor Type / Level | Size | Energy |
|---|---|---|
| Player Character | Black | 5 |
| NPC Level 1–2 | Petty | 1 |
| NPC Level 3–4 | Lesser | 2 |
| NPC Level 5–6 | Common | 3 |
| NPC Level 7–8 | Greater | 4 |
| NPC Level 9+ | Grand | 5 |

---

## 17 · Rune Trigger Service

**Module:** `rune-trigger-service.js` (~259 lines)

### Trigger Types

| Type | Mechanism |
|------|-----------|
| `proximity` | `updateToken` hook — checks distance to rune template |
| `time` | Spell tick engine — delay-based detonation |
| `manual` | Cast Magic action — caster explicitly detonates |

### Detonation

`detonateRune(originAE, opts)`:
1. Collects tokens within detonation radius (3m burst)
2. Emits `uesrpg.spell.runeDetonated`
3. Tears down Origin AE (template + linked entities removed)

---

## 18 · Zone Service

**Module:** `spell-zone-service.js` (~165 lines)

- `linkTemplateToOriginAE(originAE, templateUuid, label)` — registers template with Origin AE
- `getTokensInTemplate(templateDocOrUuid)` — geometric point-in-template check
- `getActiveSpellZones(casterActor?)` — returns all zone-linked Origin AEs
- Zone ticks dispatched by spell tick engine's built-in zone handler (`uesrpg.spell.zoneTick`)

---

## 19 · Dispel Service

**Module:** `dispel-service.js` (~256 lines)

### Three Removal Routes

| Route | Condition | Method |
|-------|-----------|--------|
| 1 | `originAEUuid` resolvable | `cancelOriginAEUpkeep()` (cleanest; cascade teardown) |
| 2 | Caster lookup finds Origin AE | `cancelOriginAEUpkeep()` |
| 3 | No Origin AE found (legacy/orphan) | Direct batch delete of target AEs |

### UI

`showDispelDialog(target, opts)`: Dialog with checkboxes for each dispellable effect. Buttons: "Dispel", "Dispel All", "Cancel".

### Filtering

Effects filtered by `spellLevel <= spellStrength` (Dispel SS). Non-spell AEs excluded. De-duplicated by `spellUuid::casterUuid`.

---

## 20 · Modifier Registry

**Module:** `modifier-registry.js` (~308 lines)

Single source of truth for all valid AE modifier keys. Used by:
- `validateAEChanges()` — warns on unrecognized keys during AE creation
- UI — modifier key dropdown population
- Documentation generation

### Key Categories (count)

| Category | Keys |
|----------|------|
| characteristics | 8 (str, end, agi, int, wp, prc, prs, lck) |
| combat | 6 (attackTN, defenseTN.total/.evade/.block/.parry/.counter) |
| magic | castingTN._all + per-school + spellReflect + spellAbsorption |
| skills | tests.all, skills._all + per-school |
| stealth | visual, auditory |
| damage | dealt, penetration, taken, mitigation.flat |
| armor | armorRating (global + per-location dynamic) |
| resistance | fire/frost/shock/poison/magic/disease/physical/silver/sunlight |
| initiative | base, bonus, value, mult.{agi,int,prc}, flat |
| speed | base, bonus, value, flySpeed, swimSpeed |
| resources | hp.max, magicka.{base,bonus,max,value}, stamina.max, luck_points.max, action_points.{max,value} |
| wounds | wound_threshold.{bonus,value}, immunity.passiveWounds |
| encumbrance | carry.{base,bonus,override}, encumbrance.{testPenalty,penalty,speedPenalty,staminaPenalty} |
| fatigue | fatigue/exhaustion.{bonus,penalty} |
| conditions | 13 immunity keys + 8 condition state flags |
| tests | fear, social, observe |

### Dynamic Patterns

`isKnownModifierKey()` accepts any key matching:
- `system.modifiers.skills.*`
- `system.modifiers.combat.armorRating.*`

---

## 21 · Backfire System

Per-school backfire tables stored in the opposed workflow modules. When casting roll exceeds TN:

1. School-specific table consulted
2. Random outcome from table applied (damage, condition, wild surge, etc.)
3. `Control` talent (if present) allows re-roll once per scene

MP is still deducted on backfire (RAW). No Origin AE or Target AEs created.

---

## 22 · Casting TN Computation

**Module:** `magicka-utils.js`, function `computeMagicCastingTN()`

### Modifier Sources (Aggregated)

| Source | Effect |
|--------|--------|
| Base skill rank | Primary TN component |
| Governing characteristic | Skill governing stat bonus |
| Specialization | Trained/expert/master bonuses |
| Active Effect modifiers | `system.modifiers.magic.castingTN._all` + per-school |
| Talent modifiers | School-specific casting talents |
| Wound penalty | Wound count × penalty per wound |
| Fatigue penalty | Current fatigue level |
| Encumbrance penalty | If over carry capacity |
| **Silence penalty** | **-20 TN** if `system.traits.condition.silenced` is true |
| Armor spell failure | If wearing armor without proficiency |

### Branches

Both NPC and PC computation branches include all the above modifiers. The silence penalty was added in Phase 6-A.

Returns: `{ finalTN, breakdown[] }` where breakdown entries include label + value for UI transparency.

---

## 23 · Migrations & Normalization

### Architecture

| Function | Version-Gated | Idempotent | When |
|----------|--------------|------------|------|
| `normalizeActors()` | No | Yes | Every startup |
| `normalizeItems()` | No | Yes | Every startup |
| `migrateActorsIfNeeded()` | Yes | Yes | Startup if version changed |
| `migrateItemsIfNeeded()` | Yes | Yes | Startup if version changed |

### Version Gating

- State stored in `game.settings.get("uesrpg-3ev4", "migrationState")` (JSON string)
- Format: `{ actors: "1.2.3", items: "1.2.3" }`
- If `state.actors === game.system.version` → skip migration
- Version stamped after successful completion
- `disableMigrations` setting bypasses all migrations (GM-only toggle)

### Idempotency

- Normalization functions produce update objects only when values actually need changing
- `_ensureResistanceDefaults()` only sets `undefined` fields (never overwrites)
- `applyDefaults()` uses structural merge with `changed` tracking flag
- Spell scaling normalization deduplicates base-level entries

### Execution Order (in `system.js` ready hook)

1. `normalizeActors()` → `normalizeItems()`
2. `migrateActorsIfNeeded()` → `migrateItemsIfNeeded()`

Normalization runs first to ensure consistent data shape before migrations inspect field values.

---

## 24 · Service Initialization Order

All services initialized in the `Hooks.once("ready")` handler in `system.js`:

| Order | Service | Module | Dependencies |
|-------|---------|--------|-------------|
| 0 | Time service | `time/index.js` | *(initialized in `init` hook, before ready)* |
| 1 | Migrations | `migrations/*.js` | — |
| 2 | Upkeep system | `upkeep-workflow.js` | Time service |
| 3 | Spell effect expiration | `spell-effect-expiration.js` | Time service |
| 4 | Damage application | `damage-application.js` | Combat pipeline |
| 5 | Origin AE lifecycle | `origin-effect.js` | Authority proxy |
| 6 | **Spell tick engine** | `spell-tick-engine.js` | Time hooks |
| 6a | Zone tick handler | `spell-tick-engine.js` | Tick engine (registered immediately after init) |
| 7 | **OverTime engine** | `overtime-engine.js` | **Tick engine** (registers handler) |
| 8 | Rune trigger service | `rune-trigger-service.js` | Tick engine, Origin AE |
| 9 | Condition triggers | `condition-triggers.js` | Spell hooks |
| 10 | Paired AE | `paired-ae.js` | Spell hooks, Origin AE |
| 11 | Summon binding | `summon-binding.js` | Spell hooks, Authority proxy |
| 12 | Bound item service | `bound-item-service.js` | Spell hooks, Origin AE, Compendium API |
| 13 | Soul trap service | `soul-trap-service.js` | preUpdateActor hook, Authority proxy |

**Critical ordering**: Tick engine (6) must initialize before OverTime engine (7).

### Lazy-Loaded Services (exposed on `game.uesrpg.magic.*`)

| Service | Key |
|---------|-----|
| `SpellCastingService` | `game.uesrpg.magic.SpellCastingService` |
| `spawnSummon()` | `game.uesrpg.magic.spawnSummon` |
| `showDispelDialog()` | `game.uesrpg.magic.showDispelDialog` |
| `resolveSpellProfile()` | `game.uesrpg.magic.resolveSpellProfile` |
| `createOverTimeConfig()` | `game.uesrpg.magic.createOverTimeConfig` |
| Modifier registry | `game.uesrpg.modifierRegistry` |

---

## 25 · Dependency Map

```
casting-service.js
  ├── spell-routing.js
  ├── spell-hooks.js (emitPreCast)
  └── magic/opposed-workflow.js
        ├── outcome-resolution.js
        │     ├── spell-reflect.js
        │     ├── damage-application.js
        │     └── spell-effects.js
        │           ├── origin-effect.js
        │           │     └── authority-proxy.js
        │           ├── modifier-registry.js (validateAEChanges)
        │           └── spell-hooks.js (emitEffectApplied)
        └── spell-hooks.js (emitCastResolved)

origin-effect.js (deleteActiveEffect hook)
  └── teardownOriginAE()
        ├── _deleteLinkedEntity("targetAE") → authority-proxy
        ├── _deleteLinkedEntity("template") → scene API
        ├── _deleteLinkedEntity("summon") → scene API
        ├── _deleteLinkedEntity("casterBuff") → authority-proxy
        ├── _deleteLinkedEntity("boundItem") → authority-proxy
        └── _cleanOrphanTargetAEs() → authority-proxy

spell-tick-engine.js
  ├── uesrpg.combatTimeChanged → dispatch(turnEnd, roundEnd)
  └── uesrpg.timeChanged → dispatch(worldTime)
        └── overtime-engine.js (registered handler)
              └── _processEffect() → damage/heal/save

upkeep-workflow.js
  ├── uesrpg.timeChanged, uesrpg.combatTimeChanged
  └── origin-effect.js (refreshOriginAEUpkeep, cancelOriginAEUpkeep)

condition-triggers.js
  └── uesrpg.spell.castResolved → breakInvisibility()

paired-ae.js
  └── uesrpg.spell.effectApplied → create caster buff AE

summon-binding.js
  └── uesrpg.spell.summonSpawned → Mindlock + Restrained + prompt

bound-item-service.js
  └── uesrpg.spell.originCreated → create bound item

soul-trap-service.js
  └── preUpdateActor → deferred soul gem creation

dispel-service.js
  └── origin-effect.js (cancelOriginAEUpkeep)
```

---

## 26 · Performance Guardrails

### OverTime Engine

| Concern | Mitigation | Status |
|---------|-----------|--------|
| Full-scan per tick | Cadence gating + trigger filter reduces per-effect work | ✅ Implemented |
| Double-tick | `lastTickRound`/`lastTickWorldTime` markers on each AE | ✅ Implemented |
| Handler dedup | `registerSpellTickHandler()` checks ID uniqueness | ✅ Implemented |
| Combat snapshot | `_combatState` Map prevents re-dispatch on same turn/round | ✅ Implemented |
| GM-only | Only one client performs scans | ✅ Implemented |

### Orphan Cleanup

| Concern | Mitigation | Status |
|---------|-----------|--------|
| Full world-actor scan | Only runs on Origin AE deletion (not per-tick) | ✅ Acceptable |
| Already-cleaned entities | `_deleteLinkedEntity()` catches "not found" gracefully | ✅ Implemented |

### Upkeep Dedup

| Concern | Mitigation | Status |
|---------|-----------|--------|
| Multiple prompts | Three-layer dedup (cache + lock + signature) | ✅ Implemented |
| Stale prompts | TTL-based cache expiry | ✅ Implemented |

---

## 27 · Resolved Gaps from Baseline

The T0 baseline (`spells-framework-baseline.md` §15) identified 10 gaps. Status:

| # | Gap | Resolution | Phase |
|---|-----|-----------|-------|
| 1 | No Origin AE for spell lifecycle tracking | `origin-effect.js` — full lifecycle with linked entities | T1 |
| 2 | No spell hooks for automation | `spell-hooks.js` — 5+ hooks covering full lifecycle | T1 |
| 3 | No tick engine for periodic effects | `spell-tick-engine.js` — combat + world time dispatch | T2-C |
| 4 | No OverTime engine for DoT/HoT | `overtime-engine.js` — damage/heal/save per tick | T4-A |
| 5 | Legacy `_onSpellRoll` bypass | All routing goes through `SpellCastingService.cast()` | T1 |
| 6 | No rune/trap support | `rune-trigger-service.js` — proximity/time/manual triggers | T2-D |
| 7 | No summon service | `summon-service.js` + `summon-binding.js` — spawn + mindlock + binding | T2-E, T6-E |
| 8 | No zone template linking | `spell-zone-service.js` — template registration + token detection | T2-B |
| 9 | No dispel automation | `dispel-service.js` — 3-route removal with dialog | T3-D |
| 10 | No modifier key validation | `modifier-registry.js` — `validateAEChanges()` warns on unknown keys | T3-A |

### Additional Features Not In Baseline (Added T5–T6)

| Feature | Module | Phase |
|---------|--------|-------|
| Silence casting penalty (-20 TN) | `magicka-utils.js` | T6-A |
| Invisibility break automation | `condition-triggers.js` | T6-B |
| Spell Reflect pipeline | `spell-reflect.js` + `outcome-resolution.js` | T6-C |
| Absorb [Char] paired caster buff | `paired-ae.js` | T6-D |
| Bound item lifecycle (Conjure spells) | `bound-item-service.js` | T6-F |
| Soul Trap death hook | `soul-trap-service.js` | T6-G |
| 117 spell items across 6 schools | `tools/t5-*-spells.js` macros | T5 |
| 19 new modifier keys | `modifier-registry.js` | T5 |

---

## 28 · Known Limitations

1. **`turnStart` trigger not dispatched**: OverTime supports `trigger: "turnStart"` in schema but the spell-tick-engine only dispatches `turnEnd` and `roundEnd`. Add dispatch when RAW requires start-of-turn effects.

2. **Full-scan in OverTime**: `_collectOverTimeEffects()` scans all actors + unlinked tokens per tick. Acceptable for typical worlds (<100 actors). Consider registration-based indexing for very large worlds.

3. **Bound item compendium profiles**: No actual Daedric weapon/armor stat profiles exist in compendia yet. The bound item service creates placeholder items with GM notification when profiles are missing.

4. **Summon binding WP test**: The opposed Willpower test for controlling summoned creatures is manual (chat prompt to GM), not an automated roll.

5. **Soul Trap `setTimeout(100)`**: Death detection uses `preUpdateActor` with deferred mutations. Race conditions are theoretically possible if multiple actors die simultaneously within 100ms. Mitigated by re-verification in the deferred callback.

6. **Reflected spells in `resolveOpposedTest`**: Reflected spells are always treated as non-critical (`isCritical = false`) to avoid complexity in the early-return path.

7. **Condition triggers scope**: Only Invisibility break is automated. Silence, Paralysis, Frenzy/Calm condition breaks are not yet hooked (GM handles manually).

8. **No `turnStart` in tick engine**: Effects cannot fire at the *start* of a turn. This could matter for pre-turn buffs/debuffs. Implementation would require the tick engine to identify the *current* combatant (not just the *previous* one).

9. **Dispel route fallthrough**: If `originAEUuid` resolution fails, dispel silently falls through to caster lookup then direct deletion. This is robust but makes partial failures harder to diagnose.

10. **Zone tick consumers**: `uesrpg.spell.zoneTick` is emitted by the tick engine's zone handler, but no subscriber module is implemented. Zone-persistent spells (e.g., Fire Storm) apply damage manually per the GM rather than automatically via zone ticks.
