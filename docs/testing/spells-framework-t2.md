# Spells Framework T2 — Ongoing Spell Entities

## Scope
T2 builds on the Origin AE lifecycle from T1, adding five subsystems:
- **T2-A** — Upkeep Contract on Origin AE
- **T2-B** — Zone Template ↔ Origin AE Linking
- **T2-C** — Unified Spell Tick Engine
- **T2-D** — Rune/Trap Trigger Service
- **T2-E** — Summoning Service

## Files Modified / Created

| File | Status | Notes |
|------|--------|-------|
| `src/core/magic/origin-effect.js` | Modified | Upkeep metadata, `refreshOriginAEUpkeep`, `cancelOriginAEUpkeep`, `findOriginAEByGroupKey` |
| `src/core/magic/upkeep-workflow.js` | Modified | Sync upkeep refresh to Origin AE via new helpers |
| `src/core/magic/spell-zone-service.js` | **New** | Template ↔ Origin AE linking, token containment detection |
| `src/core/magic/spell-tick-engine.js` | **New** | Unified tick engine (turnEnd / roundEnd / worldTime) |
| `src/core/magic/rune-trigger-service.js` | **New** | Proximity + time + manual rune triggers |
| `src/core/magic/summon-service.js` | **New** | GM-only summon token spawn, actor picker, query helpers |
| `src/system.js` | Modified | Init calls for tick engine, zone handler, rune service, summon API |
| `src/core/combat/opposed/actions/attacker.js` | Modified | Template UUID registration on Origin AE after AoE spells |
| `template.json` | Modified | Added `isRuneSpell`, `runeTriggerType`, `runeTriggerRadius`, `runeTriggerDelay`, `isSummonSpell`, `isZonePersistent` |

## Validation
All files pass static analysis with zero errors.

---

## Manual Test Plan

### T2-A: Upkeep Contract

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Origin AE stores upkeep metadata | Cast a spell with upkeep → inspect Origin AE flags | `flags.uesrpg-3ev4.upkeep` contains `originalCost`, `refreshCount: 0`, timestamps |
| 2 | Upkeep refresh syncs to Origin AE | When upkeep prompt fires and player confirms refresh | `refreshCount` increments, `lastRefreshWorldTime` / `lastRefreshRound` updated |
| 3 | `uesrpg.spell.upkeepRefreshed` hook fires | Register listener before refresh | Hook payload includes `originAE`, `costPaid`, `refreshCount` |
| 4 | Cancel upkeep triggers teardown | Click "Cancel" on upkeep dialog | Origin AE deleted → downstream effects/templates cleaned up |
| 5 | No-listed-duration detection | Cast a spell with `duration = ""` or `"0"` | `noListedDuration: true` in upkeep metadata |

### T2-B: Zone Template ↔ Origin AE Linking

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | AoE template linked to Origin AE | Cast an AoE spell that places a template | Origin AE `linkedEntities` includes `{type:"template", uuid:"..."}` |
| 2 | Template teardown on Origin AE deletion | Delete the Origin AE (or let spell expire) | MeasuredTemplate removed from scene |
| 3 | `getTokensInTemplate()` returns tokens | Place tokens inside/outside an AoE template | Only tokens inside template returned |
| 4 | `getActiveSpellZones()` lists active zones | Cast 2+ AoE spells | Both Origin AEs returned with template UUIDs |

### T2-C: Tick Engine

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Turn-end tick fires in combat | Start combat, advance turns | `uesrpg.spell.zoneTick` hook fires with `trigger:"turnEnd"` |
| 2 | Round-end tick fires | Advance past last combatant | Hook fires with `trigger:"roundEnd"` |
| 3 | World-time tick fires outside combat | Advance world time via time controls | Hook fires with `trigger:"worldTime"` |
| 4 | GM-only execution | Connect as player, advance combat | No tick handler execution on player client |
| 5 | Custom handler registration | `registerSpellTickHandler({id:"test", fn:...})` | Custom fn called on each tick |

### T2-D: Rune/Trap Triggers

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Proximity trigger fires | Set `runeTriggerType: "proximity"`, move token within 3m of rune template | `uesrpg.spell.runeDetonated` fires, Origin AE torn down |
| 2 | Time trigger fires | Set `runeTriggerType: "time"`, `runeTriggerDelay: 1` → advance combat round | Rune detonates after delay expires |
| 3 | Manual detonation | Call `detonateRune(originAE)` from console | Rune detonates, chat message posted, Origin AE cleaned up |
| 4 | Token containment on detonation | Place multiple tokens near rune | `affectedTokens` in hook payload includes only tokens within template |
| 5 | Schema fields persist | Create a spell item, set `isRuneSpell: true` | Flag persists on save/reload |

### T2-E: Summoning Service

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Summon actor picker shows NPCs | Call `game.uesrpg.magic.showSummonActorPicker()` | Dialog lists all NPC actors |
| 2 | Token spawned adjacent to caster | Call `spawnSummon({casterActor, originAE, summonActor, casterToken})` | Unlinked token created to right of caster |
| 3 | Token linked to Origin AE | After spawn, inspect Origin AE flags | `linkedEntities` includes `{type:"summon", uuid:"..."}` |
| 4 | Teardown removes summon token | Delete Origin AE | Summoned token deleted from scene |
| 5 | GM-only enforcement | Call `spawnSummon` as player | Returns `{token: null, error: "GM authority required..."}` |
| 6 | `uesrpg.spell.summonSpawned` hook fires | Register listener before spawn | Hook payload includes `casterActor`, `tokenDoc`, `summonActor` |
| 7 | Chat message posted | After spawn | Chat shows "Creature Summoned" with names |

### Integration

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | System loads without errors | Launch Foundry, open world | Console shows no import/init errors |
| 2 | Tick engine + zone handler init | Check console after ready | `[SpellTickEngine] initialized` log visible |
| 3 | Rune service init | Check console after ready | No errors from rune hook registration |
| 4 | Summon API exposed | `game.uesrpg.magic.spawnSummon` in console | Function reference returned |

---

## Architecture Notes

### Authority Proxy Gap
The authority proxy (`src/utils/authority-proxy.js`) does **not** support Scene-level embedded documents (Token, MeasuredTemplate). All T2 services that create/delete scene documents (summon tokens, template teardown) are GM-gated:
- `spawnSummon()` checks `game.user.isGM` and returns error if not GM
- Template teardown in `origin-effect.js` `_deleteLinkedEntity` uses direct `scene.deleteEmbeddedDocuments()` (GM-gated by Origin AE lifecycle)
- Rune detonation teardown routes through Origin AE deletion (GM-gated)

### Tick Engine Pattern
Follows `wound-ticker.js` exactly:
- GM-only execution
- Combat state tracking via `Map` to prevent double ticks
- Post-phase hook registration on `uesrpg.combatTimeChanged`
- World time ticks via `uesrpg.timeChanged` hook

### Data Schema Additions (template.json)
Six new fields added to `spell` type under system data:
```json
"isRuneSpell": false,
"runeTriggerType": "",
"runeTriggerRadius": 3,
"runeTriggerDelay": 0,
"isSummonSpell": false,
"isZonePersistent": false
```
These are backward-compatible defaults — existing spells unaffected.
