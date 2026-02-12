# OverTime Engine — Regression Test Suite

> UESRPG 3ev4 · Foundry VTT v13.351  
> Last updated: 2026-02-07 (T6 — Regression & Stability Gates)

This document defines deterministic regression tests specifically for the **OverTime engine** (`overtime-engine.js`) and its integration with the **Spell Tick Engine** (`spell-tick-engine.js`). The OverTime engine handles per-tick damage, healing, saves, and effect expiration for spell AEs with OverTime configurations.

---

## Architecture Reference

### Data Flow

```
uesrpg.combatTimeChanged  ──►  spell-tick-engine.js  ──►  _dispatchTick()
uesrpg.timeChanged         ──►  spell-tick-engine.js  ──►  _dispatchTick()
                                       │
                                       ▼
                               registered handlers[]
                                       │
                                       ▼
                               overtime-engine._onTick(ctx)
                                       │
                                       ▼
                               _collectOverTimeEffects(trigger, ctx)
                                       │
                                       ▼
                               _processEffect() per candidate
                                       │
                               ┌───────┼────────┐
                               ▼       ▼        ▼
                            damage   heal   saveThenApply
                                       │
                                       ▼
                               _updateTickState()  (lastTick markers)
```

### Trigger Types

| Trigger | Source | When |
|---------|--------|------|
| `turnEnd` | Combat tick engine | A combatant's turn ends |
| `turnStart` | *Not currently dispatched* | Intended for start-of-turn effects |
| `roundEnd` | Combat tick engine | Combat round number changes |
| `worldTime` | Time service hook | World clock advances (non-combat) |

**Known Gap:** `turnStart` is supported in the OverTime config schema and collection filter but the spell-tick-engine does NOT dispatch `turnStart` ticks. Effects configured with `trigger: "turnStart"` will never fire. This is documented, not a bug — it can be added when RAW requires start-of-turn effects.

### Deduplication Mechanisms

| Layer | Mechanism | Location |
|-------|-----------|----------|
| Tick Engine | Combat state snapshot comparison (`_combatState` Map) | `spell-tick-engine.js` L127–L148 |
| OverTime Engine | Cadence gating via `_isCadenceMet()` | `overtime-engine.js` L199 |
| OverTime Engine | `lastTickRound` / `lastTickWorldTime` markers per AE | `overtime-engine.js` L549 |
| OverTime Engine | `maxTicks` cap → auto-delete | `overtime-engine.js` L555 |
| Tick Engine | Handler ID dedup (prevents double registration) | `spell-tick-engine.js` L83 |

### Performance Note: Full-Scan Pattern

`_collectOverTimeEffects()` scans **all** `game.actors.contents` plus **all** `canvas.tokens.placeables` (unlinked tokens) on every tick. For large worlds (100+ actors), this is a linear scan. The cadence gating and trigger-type filtering reduce the work done *per effect*, but the initial enumeration cost scales with world size. 

**Current mitigation:** GM-only execution means only one client performs the scan. Most worlds have <50 actors, making the cost negligible.

**Future optimization (if needed):** Maintain a registration Set of actor UUIDs with OverTime effects, updated on AE create/delete hooks.

---

## 1 · Tick Dispatch — Combat Mode

### 1.1 Turn-End Tick Fires Once Per Turn

**Preconditions:** Combat active with 3 combatants (A, B, C). OverTime DoT AE on combatant A with `trigger: "turnEnd"`, `cadenceEvery: 1`.

| # | Step | Expected |
|---|------|----------|
| 1 | End A's turn (advance to B) | `_dispatchTick({trigger: "turnEnd", actor: A})` fires once |
| 2 | Check OverTime engine | `_onTick()` called; A's DoT processed; damage applied |
| 3 | End B's turn | `_dispatchTick({trigger: "turnEnd", actor: B})` fires; A's DoT NOT re-triggered (wrong actor) |
| 4 | End C's turn → back to A | `_dispatchTick({trigger: "turnEnd", actor: C})`; A's DoT processed again on A's next turn-end |

### 1.2 Round-End Tick Fires Once Per Round

**Preconditions:** Combat active. OverTime AE with `trigger: "roundEnd"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Advance through full round (all combatants) | `roundEnd` dispatch fires when round number increments |
| 2 | Check tick count | Effect ticked exactly once |
| 3 | Advance to next round | Second tick |

### 1.3 No Double-Tick on Rapid Advancement

**Preconditions:** Combat active. OverTime AE on combatant A.

| # | Step | Expected |
|---|------|----------|
| 1 | Rapidly click "Next Turn" twice | State snapshot comparison detects second click has same `{round, turn, combatantId}` |
| 2 | Check tick count | Only 1 tick processed (deduplicated) |

### 1.4 Combat State Snapshot Seeding

**Preconditions:** No combat. Start new combat encounter.

| # | Step | Expected |
|---|------|----------|
| 1 | Create combat | `_setState()` called via `createCombat` hook; snapshot stored |
| 2 | Begin first turn | First `combatTimeChanged` has a `prev` snapshot to compare against |
| 3 | Delete combat | State entry cleaned up from `_combatState` Map |

---

## 2 · Tick Dispatch — World Time Mode

### 2.1 World Time Tick

**Preconditions:** No active combat. OverTime AE with `trigger: "worldTime"`, `cadenceEvery: 1`, `cadenceUnit: "minutes"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Advance world clock by 1 minute | `uesrpg.timeChanged` fires → `_dispatchTick({trigger: "worldTime"})` |
| 2 | Check OverTime engine | Effect collected and processed |
| 3 | Check `lastTickWorldTime` | Updated to current world time |

### 2.2 World Time — Skip During Combat

**Preconditions:** Active combat. OverTime worldTime AE exists.

| # | Step | Expected |
|---|------|----------|
| 1 | World time somehow advances during combat | Tick engine guard: skips if combat is active |
| 2 | Check OverTime AE | Not ticked (combat ticks handle timing during combat) |

### 2.3 World Time — Skip Negative dt

**Preconditions:** World time moves backward (edge case).

| # | Step | Expected |
|---|------|----------|
| 1 | Time service reports `dtSeconds <= 0` | Tick engine skips dispatch |

---

## 3 · OverTime Effect Processing

### 3.1 Damage Payload

**Preconditions:** Target has OverTime AE: `payloadType: "damage"`, `formula: "1d6"`, `damageType: "fire"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires | `_processEffect()` resolves damage formula → applies fire damage |
| 2 | Check target HP | Reduced by rolled amount (after fire resistance) |
| 3 | Check chat log | Tick notification posted (if `chatLog: true`) |

### 3.2 Healing Payload

**Preconditions:** Target has OverTime AE: `payloadType: "heal"`, `formula: "4"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires | HP increased by 4 (capped at max HP) |
| 2 | Check chat log | Healing notification posted |

### 3.3 Save-Then-Apply Payload

**Preconditions:** Target has OverTime AE: `payloadType: "saveThenApply"`, `saveKey: "wp"`, `saveTN: 50`, `saveSuccess: "endEffect"`, `saveFailure: "damage"`, `formula: "1d8"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires | WP test rolled for target |
| 2 | Save succeeds | Effect ended (AE deleted) |
| 3 | Save fails | Damage applied (1d8); effect continues |
| 4 | Check chat | Save result + outcome posted |

### 3.4 EndEffect Payload

**Preconditions:** OverTime AE with `payloadType: "endEffect"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires | AE deleted immediately |
| 2 | Check actor | AE gone; no further ticks |

---

## 4 · Cadence Gating

### 4.1 Every-N-Rounds Cadence

**Preconditions:** OverTime AE: `cadenceEvery: 2`, `cadenceUnit: "rounds"`, `trigger: "roundEnd"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Round 1 ends | `_isCadenceMet()` = false (only 1 round since `lastTickRound`) |
| 2 | Round 2 ends | `_isCadenceMet()` = true; effect ticked; `lastTickRound` updated |
| 3 | Round 3 ends | false again (1 round since last tick) |
| 4 | Round 4 ends | true; ticked again |

### 4.2 Every-1-Round (Default)

**Preconditions:** OverTime AE: `cadenceEvery: 1`, `trigger: "turnEnd"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Actor's turn ends | `_isCadenceMet()` = true; ticked every turn |

### 4.3 World Time Cadence

**Preconditions:** OverTime AE: `cadenceEvery: 5`, `cadenceUnit: "minutes"`, `trigger: "worldTime"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Advance 3 minutes | Not enough time elapsed; not ticked |
| 2 | Advance 2 more minutes (total 5) | Cadence met; ticked; `lastTickWorldTime` updated |

---

## 5 · Max Ticks & Auto-Deletion

### 5.1 Finite maxTicks

**Preconditions:** OverTime AE: `maxTicks: 3`, current `tickCount: 2`.

| # | Step | Expected |
|---|------|----------|
| 1 | Next tick fires | `tickCount` incremented to 3; effect processed |
| 2 | Post-tick check | `tickCount (3) >= maxTicks (3)` → AE auto-deleted |
| 3 | Subsequent ticks | Effect no longer collected (doesn't exist) |

### 5.2 Unlimited Ticks (maxTicks: null)

**Preconditions:** OverTime AE: `maxTicks: null`, `tickCount: 50`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires | Processed normally; no auto-deletion |
| 2 | `tickCount` | Incremented to 51 |

---

## 6 · Tick State Persistence

### 6.1 State Written After Each Tick

**Preconditions:** OverTime AE with initial state `{tickCount: 0, lastTickRound: 0}`.

| # | Step | Expected |
|---|------|----------|
| 1 | Tick fires at round 3 | `_updateTickState()` writes `{tickCount: 1, lastTickRound: 3}` to AE flags |
| 2 | Re-read AE flags | `flags.uesrpg-3ev4.overTime.state` reflects updated values |

### 6.2 State Survives Page Refresh

**Preconditions:** OverTime AE has been ticked mid-combat.

| # | Step | Expected |
|---|------|----------|
| 1 | Refresh browser (GM client) | AE flags persist in DB |
| 2 | Resume combat, advance turn | `_isCadenceMet()` correctly uses persisted `lastTickRound` |
| 3 | No double-tick | Previous tick state prevents re-processing |

---

## 7 · Handler Registration

### 7.1 No Duplicate Registration

| # | Step | Expected |
|---|------|----------|
| 1 | Call `initializeOverTimeEngine()` twice | Second call is a no-op (guard) |
| 2 | Check handler registry | Only one `"overtime-engine"` handler |

### 7.2 Registration Order Dependency

| # | Step | Expected |
|---|------|----------|
| 1 | `initializeSpellTickEngine()` called before `initializeOverTimeEngine()` | OT engine successfully registers with tick engine |
| 2 | Reverse order (hypothetical) | `registerSpellTickHandler()` would succeed but dispatch wouldn't work if tick engine hooks aren't set up |

---

## 8 · GM-Only Execution

### 8.1 Non-GM Receives Tick Hooks

| # | Step | Expected |
|---|------|----------|
| 1 | Player client receives `combatTimeChanged` | `spell-tick-engine` guard: `!game.user.isGM` → early return |
| 2 | Check mutations | No damage/healing/state-write attempted by player client |

### 8.2 GM Reconnection Mid-Combat

| # | Step | Expected |
|---|------|----------|
| 1 | GM disconnects during combat | No ticks processed |
| 2 | GM reconnects | `createCombat` hook re-seeds state (or manual `_setState` on existing combat) |
| 3 | Next turn advance | Normal tick processing resumes; persisted `lastTickRound` prevents re-ticking old rounds |

---

## 9 · Integration with Spell Effects

### 9.1 OverTime Config from Spell Item

**Preconditions:** Regeneration spell with `system.overTime` config on spell item.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Regeneration | AE created with `flags.uesrpg-3ev4.overTime` populated from `createOverTimeConfig()` |
| 2 | Check AE flags | `trigger`, `cadenceEvery`, `payloadType`, `formula` all set; `state.tickCount = 0` |

### 9.2 OverTime AE Removed via Dispel

| # | Step | Expected |
|---|------|----------|
| 1 | Dispel removes the OverTime AE | AE deleted; next tick doesn't find it |
| 2 | No orphan ticks | `_collectOverTimeEffects()` returns empty for this actor/effect |

### 9.3 OverTime AE Removed via Origin AE Teardown

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE (caster side) | Target's OverTime AE deleted via cascade |
| 2 | Next tick | No processing for deleted effect |

---

## 10 · `uesrpg.overTime.tick` Hook

### 10.1 Hook Payload

| # | Step | Expected |
|---|------|----------|
| 1 | OverTime tick fires | `uesrpg.overTime.tick` emitted with `{effect, actor, trigger, result, tickCount}` |
| 2 | External listener | Can observe tick events for custom automation |

---

## Appendix A — Quick Regression Checklist

- [ ] 1.1 Turn-end tick fires once per turn
- [ ] 1.2 Round-end tick fires once per round
- [ ] 1.3 No double-tick on rapid advancement
- [ ] 2.1 World time tick
- [ ] 3.1 Damage payload
- [ ] 3.2 Healing payload
- [ ] 3.3 Save-then-apply payload
- [ ] 4.1 Every-N-rounds cadence
- [ ] 5.1 Finite maxTicks + auto-delete
- [ ] 6.1 State written after each tick
- [ ] 6.2 State survives page refresh
- [ ] 7.1 No duplicate handler registration
- [ ] 8.1 Non-GM guard
- [ ] 9.1 OverTime config from spell item
- [ ] 9.3 Cascade deletion via Origin AE

## Appendix B — Known Limitations

1. **`turnStart` trigger not dispatched**: The spell-tick-engine only dispatches `turnEnd` and `roundEnd`. Effects with `trigger: "turnStart"` will never fire. Add `turnStart` dispatch to the tick engine if RAW requires start-of-turn processing.

2. **Full-scan enumeration**: `_collectOverTimeEffects()` visits all actors + unlinked tokens on every tick. Acceptable for typical world sizes but may need indexing for very large worlds (500+ actors).

3. **Unlinked token AE updates**: OverTime state is written to AE flags via authority proxy. For unlinked tokens, this modifies the synthetic actor, which may not persist across scene changes. This is acceptable for combat-scoped effects.
