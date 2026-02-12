# Spell Automation Implementation — Changelog & Test Checklist

## Overview

Three spell automation features implemented per RAW:

1. **Conjuration Summon Targeting + Scaling** — conjured items go to user-selected targets (not just caster); supports all item types; supports spell-strength-based item scaling.
2. **Disintegrate Weapon/Armor** — applies `Damaged(Spell Strength)` structured quality to hit equipment; no HP damage.
3. **Drain Magicka/Health** — reduces current pool only via direct value update; no max-reducing Active Effects for magicka/health drains.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/core/magic/disintegrate-service.js` | Runtime automation for Disintegrate spells. Hooks into `uesrpg.spell.effectApplied` and `uesrpg.spell.spellHitTarget` to apply `Damaged(SS)` quality to target equipment. Exports `applyDamagedQuality()` helper for macro/API use. |
| `src/core/magic/drain-service.js` | Runtime automation for Drain Magicka/Health spells. Hooks into `uesrpg.spell.effectApplied` and `uesrpg.spell.spellHitTarget` to reduce current pool directly and strip incorrectly created max-reducing AEs. Exports `drainMagicka()` and `drainHealth()` helpers. |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/magic/conjuration-runtime.js` | Added `_resolveConjureTargets()` for user target selection (falls back to caster), `_resolveConjureItemWithScaling()` for spell-strength-based item filtering, `_createConjuredItemOnActor()` extracted helper. Rewrote `_handleConjureItem()` to iterate over multiple targets. |
| `src/core/magic/normalize-spell-config.js` | Added `ENGINE_DEFAULTS.disintegrate`, `ENGINE_DEFAULTS.drain`. Added `_normalizeDisintegrate()`, `_normalizeDrain()` normalizer functions. New exports: `getDisintegrateTargetOptions()`, `getDrainTypeOptions()`. Updated conjure defaults to include `summonItems` and `summonActors` fields. |
| `templates/spell-sheet.html` | Added Disintegrate fieldset (enable checkbox, target select, hint) and Drain fieldset (enable checkbox, pool type select, transfer-to-caster checkbox, hint) in Advanced Features section. Updated conjure item hint text. |
| `src/system.js` | Imported and called `initializeDisintegrateService()` and `initializeDrainService()` in `Hooks.once('ready')`. Exposed `applyDamagedQuality`, `drainMagicka`, `drainHealth` on `game.uesrpg.magic` API. |
| `src/ui/sheets/item/prepare.js` | Imported `getDisintegrateTargetOptions`, `getDrainTypeOptions` from normalize-spell-config. Added `data.disintegrateTargetOptions` and `data.drainTypeOptions` to template data. Updated fallback spellEngine with disintegrate/drain defaults. |
| `template.json` | Added `engine.disintegrate` (`enabled: false`, `target: "armor"`), `engine.drain` (`enabled: false`, `type: "none"`, `transferToCaster: false`), `conjure.summonItems: null`, `conjure.summonActors: null` to spell schema. |
| `src/core/magic/opposed/outcome-resolution.js` | Added `uesrpg.spell.spellHitTarget` hook emission in `resolveDirectUndefendable()`, `resolveDirectNoTest()`, and `resolveOpposedTest()` — fires on all successful spell hits (damaging and non-damaging) with `{caster, target, spell, hitLocation, defenseType, isCritical, isDamaging}` payload. |

---

## New Hook

### `uesrpg.spell.spellHitTarget`

Emitted whenever a spell successfully hits a target (after damage/effects are applied). Fires in all three resolution routes (direct undefendable, direct no-test, opposed). Does NOT fire when spell is absorbed.

**Payload:**
```javascript
{
  caster: Actor,        // Casting actor
  target: Actor,        // Target actor (may be redirected by Spell Reflect)
  spell: Item,          // Spell item
  hitLocation: string,  // Hit location ("Body" for direct, or from roll for opposed)
  defenseType: string,  // "block", "ward", "evade", "" (empty for direct)
  isCritical: boolean,  // Was the cast a critical success
  isDamaging: boolean   // Does the spell have a damage formula
}
```

---

## New API Surface

```javascript
// Disintegrate: apply Damaged quality to any item
await game.uesrpg.magic.applyDamagedQuality(item, magnitude, opts?)

// Drain: reduce current magicka pool
await game.uesrpg.magic.drainMagicka(targetActor, amount, opts?)

// Drain: reduce current health pool
await game.uesrpg.magic.drainHealth(targetActor, amount, opts?)
```

---

## Test Checklist

### Conjuration — Summon Item Targeting + Scaling

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| C1 | Conjure item to self (no targets) | Cast a Conjuration spell with `engine.conjure.mode = "item"`. Do NOT select any targets. | Item created in **caster's** inventory (fallback behavior). |
| C2 | Conjure item to single target | Select one target token, cast Conjuration spell with `mode = "item"`. | Item created in **target's** inventory, not caster's. |
| C3 | Conjure item to multiple targets | Select 2+ target tokens, cast Conjuration spell with `mode = "item"`. | Item created in **each** target's inventory. |
| C4 | Conjure item with scaling | Set up a spell with `scaling.levels` containing entries at different SS values, each with different item UUIDs. Cast at SS 3. | Only items with SS ≤ 3 are eligible. If multiple eligible items exist, a selection dialog appears. Selected item is created on targets. |
| C5 | Conjure creature (unchanged) | Cast a Conjuration spell with `mode = "actor"`. | Summon creature workflow fires as before (no regression). |
| C6 | Conjure item — origin AE teardown | Cast conjure item spell, then dismiss/expire the origin AE. | Conjured item(s) are deleted from target inventory on AE removal. |

### Disintegrate — Damaged Quality Application

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| D1 | Disintegrate Armor | Create/edit a spell with `engine.disintegrate.enabled = true`, `target = "armor"`. Cast against a target wearing armor. | Target's armor gains `Damaged(SS)` structured quality entry (or existing Damaged value incremented). No HP damage applied (spell has no damage formula). |
| D2 | Disintegrate Shield | Set `target = "shield"`. Cast against a target who used Block defense. | Target's shield item gains `Damaged(SS)`. |
| D3 | Disintegrate Weapon | Set `target = "weapon"`. Cast against a target who has an equipped weapon. | Target's first equipped weapon gains `Damaged(SS)`. |
| D4 | Disintegrate — no equipment | Cast Disintegrate against a target with no armor/weapon. | Chat warning "no eligible item found". No crash. |

### Drain — Current Pool Only

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| DR1 | Drain Magicka | Create/edit a spell with `engine.drain.enabled = true`, `type = "magicka"`. Spell has AE changes that reduce `system.magicka.max`. Cast against target with Magicka 50/100. | Current magicka reduced (e.g., to 45 at SS 5). Max magicka **unchanged** (AE stripped if present). |
| DR2 | Drain Health | Set `type = "health"`. Cast against target with HP 80/100. | Current HP reduced. Max HP **unchanged**. |
| DR3 | Absorb Magicka (transfer to caster) | Set `type = "magicka"`, `transferToCaster = true`. Caster has 40/100 MP, target has 60/100 MP. | Target's current MP reduced. Caster's current MP increased by same amount (capped at max). No max-reducing AEs on target. |

### Regression Tests

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| R1 | Normal damaging spell | Cast a standard Destruction damage spell (no Disintegrate/Drain engine flags). | Damage applied normally. spellHitTarget hook fires but services ignore it (engine flags not enabled). |
| R2 | Healing spell | Cast a Restoration healing spell. | Healing applied normally. No Disintegrate/Drain side effects. |
| R3 | Existing spell effects | Cast a spell with embedded Active Effects (non-Drain). | AEs transfer normally. No stripping. |
| R4 | Drain Characteristic (not pool) | Cast a Drain spell with `type = "none"` (not magicka/health). Spell has AE changes on `system.characteristics.*`. | AEs transfer normally — no stripping, no direct pool drain. Standard Drain behavior preserved. |

---

## Architecture Notes

- **Disintegrate** and **Drain** services use idempotent initialization (`_initialized` flag) with `Hooks.on()` for `effectApplied` and `spellHitTarget`.
- Both services check `spell.system.engine.disintegrate.enabled` / `spell.system.engine.drain.enabled` before acting — spells without these flags are completely unaffected.
- `applyDamagedQuality()` uses `requestUpdateEmbeddedDocuments()` for permission safety.
- `drainMagicka()` / `drainHealth()` use `requestUpdateDocument()` for permission safety.
- Drain service's `_stripMaxReducingEffects()` only removes AEs that target `system.magicka.max` or `system.hp.max` — AEs targeting characteristics/skills are preserved.
- Both services avoid double-processing by checking whether the spell has embedded AEs (`hasEnabledEffects`) and only responding to the appropriate hook.
