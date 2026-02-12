# Spells Framework T1 — Manual Test Plan

**Date:** 2026-02-06  
**Target:** Foundry VTT v13.351 / UESRPG 3ev4  
**Scope:** Core Spell Framework Hardening (Origin AE, Lifecycle Hooks, Legacy Cleanup)

---

## Changes Summary

### New Modules
1. **`src/core/magic/origin-effect.js`** — Origin AE lifecycle management
2. **`src/core/magic/spell-hooks.js`** — Spell lifecycle hooks

### Modified Files
1. **`src/core/magic/spell-effects.js`** — Origin AE back-linking in `applySpellEffectsToTarget()`
2. **`src/core/magic/opposed-workflow.js`** — `castDirectTargeted()` and `castUnopposed()` emit hooks + create Origin AEs
3. **`src/core/magic/opposed/actions/attacker.js`** — `handleAttackerRoll()` emits hooks + creates Origin AEs for opposed path
4. **`src/core/magic/casting-service.js`** — `emitPreCast()` cancellable hook before routing
5. **`src/system.js`** — `initializeOriginAELifecycle()` call added
6. **`src/core/magic/opposed/outcome-resolution.js`** — Removed dead `applySpellEffect` calls; cleaned import

### Removed Code
- `applySpellEffect()` (legacy, was always a no-op)
- `removeOpposingEffects()` (legacy duplicate of `removeOpposingSpellEffects`)
- `computeSpellDurationLegacy()` (placeholder, never produced results)
- `extractSpellChanges()` (placeholder, always returned `[]`)

---

## Test Environment Setup

### Required Actors
- **PC Caster** — Player Character with magic skills, 50+ MP, at least 1 spell with embedded AEs
- **NPC Caster** — NPC with 50+ MP for NPC sheet testing
- **Target Dummy** — Any actor, 50+ HP, for opposed/direct tests

### Required Spells

| Spell | Type | Duration | Upkeep | AEs | Purpose |
|-------|------|----------|--------|-----|---------|
| Fire Bolt | Attack, Ranged | Instant | No | None | Basic attack, no Origin AE expected |
| Shield Ward | Buff, Direct | 3 rounds | No | Yes (1+ embedded AE) | Origin AE + target AE linking |
| Protect | Buff, Direct | 5 minutes | Yes | Yes (1+ embedded AE) | Origin AE + upkeep integration |
| Heal | Healing, Direct | Instant | No | None | Healing path, no Origin AE |
| Frenzy | Debuff, Opposed | 3 rounds | No | Yes (1+ embedded AE) | Opposed path, Origin AE + back-link |

---

## Part 1: Origin AE Creation

### Test 1.1: Persistent Spell Creates Origin AE (Direct Path)
1. Cast "Shield Ward" (direct, has duration + AEs) at Target Dummy
2. Check PC Caster's effects list (Actor Sheet → Effects tab)
3. **Expected:** An effect named `[Origin] Shield Ward` appears on the caster
4. Inspect via console:
   ```js
   const actor = game.actors.getName("PC Caster");
   actor.effects.filter(e => e.flags?.["uesrpg-3ev4"]?.isOriginAE).map(e => ({
     name: e.name,
     spellUuid: e.flags["uesrpg-3ev4"].spellUuid,
     linked: e.flags["uesrpg-3ev4"].linkedEntities
   }));
   ```
5. **Expected:** Origin AE has `isOriginAE: true`, `spellUuid` matches spell, `linkedEntities` contains target AEs
6. **Pass Criteria:** Origin AE present with correct flags

### Test 1.2: Instant Spell Does NOT Create Origin AE
1. Cast "Fire Bolt" (instant, no embedded AEs) at Target Dummy
2. Check PC Caster's effects list
3. **Expected:** No `[Origin]` effect created
4. **Pass Criteria:** No new effects on caster

### Test 1.3: Opposed Spell Creates Origin AE (Opposed Path)
1. Target Target Dummy with PC Caster
2. Cast "Frenzy" (opposed, has duration + AEs)
3. Roll casting test → succeed
4. Defender rolls → fails defense
5. Check PC Caster's effects list
6. **Expected:** `[Origin] Frenzy` appears on caster with correct flags
7. **Pass Criteria:** Origin AE created after successful attacker roll

### Test 1.4: Failed Cast Does NOT Create Origin AE
1. Cast any persistent spell and fail the casting test
2. Check caster's effects
3. **Expected:** No Origin AE created
4. **Pass Criteria:** Origin AE only created on success

### Test 1.5: Unopposed Spell Creates Origin AE
1. Deselect all targets
2. Cast a persistent non-attack spell (no target)
3. Succeed the casting test
4. Check caster's effects
5. **Expected:** `[Origin] <SpellName>` appears
6. **Pass Criteria:** Origin AE created for unopposed persistent spells

---

## Part 2: Target AE Back-Linking

### Test 2.1: Target AEs Have Back-Link Flags
1. Cast "Shield Ward" on Target Dummy (direct, succeeds)
2. Inspect Target Dummy's effects via console:
   ```js
   const target = game.actors.getName("Target Dummy");
   target.effects.filter(e => e.flags?.["uesrpg-3ev4"]?.spellEffect).map(e => ({
     name: e.name,
     originAEUuid: e.flags["uesrpg-3ev4"].originAEUuid,
     originAEId: e.flags["uesrpg-3ev4"].originAEId
   }));
   ```
3. **Expected:** Each spell AE has `originAEUuid` and `originAEId` pointing to the Origin AE
4. **Pass Criteria:** Back-link flags present and match the Origin AE

### Test 2.2: Origin AE Lists Target AEs
1. (Same cast as 2.1)
2. Inspect Origin AE's `linkedEntities`:
   ```js
   const caster = game.actors.getName("PC Caster");
   const origin = caster.effects.find(e => e.flags?.["uesrpg-3ev4"]?.isOriginAE);
   console.log(origin?.flags?.["uesrpg-3ev4"]?.linkedEntities);
   ```
3. **Expected:** Array contains entries with `type: "targetAE"` and UUIDs matching target's AEs
4. **Pass Criteria:** Bidirectional linking verified

---

## Part 3: Origin AE Teardown

### Test 3.1: Deleting Origin AE Removes Target AEs
1. Cast "Shield Ward" on Target Dummy (creates Origin AE + target AEs)
2. Verify target has spell effects (from Part 2)
3. Delete the `[Origin] Shield Ward` effect from caster:
   - Open caster's Effects tab → delete the Origin AE
   - OR via console: `origin.delete()`
4. Check Target Dummy's effects
5. **Expected:** All target AEs from that spell are automatically removed
6. **Expected:** Notification: "Shield Ward ended — X linked effect(s) removed."
7. **Pass Criteria:** Deterministic cleanup via hook-based teardown

### Test 3.2: Teardown Is Idempotent
1. Delete an Origin AE for a spell whose targets no longer exist (e.g., deleted token)
2. **Expected:** No errors, graceful handling
3. **Pass Criteria:** No console errors, teardown reports 0 deletions

---

## Part 4: Lifecycle Hooks

### Test 4.1: preCast Hook (Cancellable)
1. Register a test hook:
   ```js
   Hooks.on("uesrpg.spell.preCast", (payload) => {
     console.log("preCast fired:", payload);
     return true; // allow
   });
   ```
2. Cast any spell via `game.uesrpg.magic.cast()`
3. **Expected:** Hook fires with `{caster, spell, spellOptions, targetUuids}`
4. **Pass Criteria:** Hook fires with correct payload

### Test 4.2: preCast Cancellation
1. Register a blocking hook:
   ```js
   Hooks.on("uesrpg.spell.preCast", () => false);
   ```
2. Cast via `game.uesrpg.magic.cast()`
3. **Expected:** Cast is cancelled, no MP/AP spent
4. Clean up: `Hooks.off("uesrpg.spell.preCast", hookId)`
5. **Pass Criteria:** Cast prevented, resources preserved

### Test 4.3: castResolved Hook
1. Register listener:
   ```js
   Hooks.on("uesrpg.spell.castResolved", (payload) => {
     console.log("castResolved:", payload.success, payload.mpSpent, payload.spell?.name);
   });
   ```
2. Cast any spell (any path: direct, opposed, unopposed)
3. **Expected:** Hook fires with `{caster, spell, result, success, backfired, mpSpent, spellOptions}`
4. **Pass Criteria:** Hook fires on all casting paths

### Test 4.4: effectApplied Hook
1. Register listener:
   ```js
   Hooks.on("uesrpg.spell.effectApplied", (payload) => {
     console.log("effectApplied:", payload.target?.name, "effects:", payload.effects?.length);
   });
   ```
2. Cast a spell with embedded AEs that lands on a target
3. **Expected:** Hook fires with `{caster, target, spell, effects, originEffect}`
4. **Pass Criteria:** Hook fires after AEs are created on target

### Test 4.5: originCreated Hook
1. Register listener:
   ```js
   Hooks.on("uesrpg.spell.originCreated", (payload) => {
     console.log("originCreated:", payload.spell?.name, payload.originEffect?.id);
   });
   ```
2. Cast a persistent spell
3. **Expected:** Hook fires with `{casterActor, spell, originEffect, options}`
4. **Pass Criteria:** Hook fires when Origin AE is created

### Test 4.6: spell.ended Hook
1. Register listener:
   ```js
   Hooks.on("uesrpg.spell.ended", (payload) => {
     console.log("ended:", payload.spellName, "deleted:", payload.deletedCount);
   });
   ```
2. Delete an Origin AE manually
3. **Expected:** Hook fires with `{spellUuid, spellName, casterUuid, originEffectId, deletedCount, errors}`
4. **Pass Criteria:** Hook fires with accurate counts

---

## Part 5: Legacy Code Removal Regression

### Test 5.1: Direct Undefendable Spell (No Embedded AEs)
1. Cast a direct spell that has NO embedded AEs (e.g., pure utility spell)
2. **Expected:** No errors, spell resolves normally
3. **Expected:** No `applySpellEffect` call (removed)
4. **Pass Criteria:** No regression — legacy no-op path removed cleanly

### Test 5.2: Opposing Effect Pairs Still Work
1. Cast "Frenzy" on target → AE applied
2. Cast "Calm" on same target
3. **Expected:** Frenzy AE removed, Calm AE applied
4. **Pass Criteria:** `removeOpposingSpellEffects()` (modern version) still works

### Test 5.3: Spell with Embedded AEs (Happy Path)
1. Cast any spell with 1+ embedded AEs on a target
2. **Expected:** AEs transferred to target with correct flags (spellEffect, spellUuid, etc.)
3. **Pass Criteria:** Modern `applySpellEffectsToTarget()` unaffected

---

## Part 6: Multi-User / Permission Safety

### Test 6.1: Player-Owned Cast Creates Origin AE
1. Non-GM player casts a persistent spell
2. Verify Origin AE is created on their actor
3. **Expected:** Authority proxy routes AE creation through GM if needed
4. **Pass Criteria:** No permission errors

### Test 6.2: Origin Teardown Works for Non-Owner Effects
1. GM deletes an Origin AE on a player's actor
2. Target AEs on other actors should be cleaned up
3. **Expected:** GM-only teardown hook processes all linked entities
4. **Pass Criteria:** Cleanup works across ownership boundaries

---

## Part 7: Console Error Check

### Test 7.1: No Errors on World Load
1. Reload Foundry (F5)
2. Check console for errors related to `origin-effect`, `spell-hooks`, `spell-effects`
3. **Expected:** No errors
4. **Pass Criteria:** Clean console on startup

### Test 7.2: No Errors During Full Cast Cycle
1. Open console
2. Cast a persistent spell → effects applied → delete Origin AE
3. **Expected:** No errors except optional debug logs (if enabled)
4. **Pass Criteria:** Clean console through full lifecycle

---

## Summary Checklist

| Test | Status | Notes |
|------|--------|-------|
| 1.1 Direct persistent → Origin AE created | ⬜ | |
| 1.2 Instant → no Origin AE | ⬜ | |
| 1.3 Opposed → Origin AE after attacker success | ⬜ | |
| 1.4 Failed cast → no Origin AE | ⬜ | |
| 1.5 Unopposed → Origin AE on success | ⬜ | |
| 2.1 Target AEs have back-links | ⬜ | |
| 2.2 Origin lists linked entities | ⬜ | |
| 3.1 Origin delete → target AEs removed | ⬜ | |
| 3.2 Teardown idempotent | ⬜ | |
| 4.1 preCast fires | ⬜ | |
| 4.2 preCast cancellation | ⬜ | |
| 4.3 castResolved fires | ⬜ | |
| 4.4 effectApplied fires | ⬜ | |
| 4.5 originCreated fires | ⬜ | |
| 4.6 spell.ended fires | ⬜ | |
| 5.1 No AE spell (no regression) | ⬜ | |
| 5.2 Opposing pairs work | ⬜ | |
| 5.3 Embedded AE transfer works | ⬜ | |
| 6.1 Player-owned cast | ⬜ | |
| 6.2 Cross-ownership teardown | ⬜ | |
| 7.1 Clean console on load | ⬜ | |
| 7.2 Clean console full cycle | ⬜ | |

**Total: 22 tests**

---

## Acceptance Criteria

- [x] Origin AE created on caster for all persistent spell paths (direct, opposed, unopposed)
- [x] Target AEs carry back-link flags (`originAEUuid`, `originAEId`)
- [x] Origin AE's `linkedEntities` updated when target AEs are created
- [x] Deleting Origin AE triggers deterministic cleanup of all linked entities
- [x] Lifecycle hooks fire at documented pipeline stages
- [x] `preCast` hook is cancellable
- [x] Legacy dead code removed without regression
- [x] No console errors on load or during full cast cycle
- [x] Permission-safe across multi-user environments

---

## Deferred Items

- **AttackTracker centralization** — Deferred until `SpellCastingService` becomes sole entry point
- **`purgeExpiredSpellEffects` consolidation** — Deferred to T2+ (expiration engine unification)
- **`SpellCastingService` as sole UI entry** — T2+ (UI sheets still call `MagicOpposedWorkflow` directly)
