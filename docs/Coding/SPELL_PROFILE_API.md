# Spell Profile API Documentation

## Overview

The Spell Profile API (`game.uesrpg.magic.resolveProfile()`) provides a single source of truth for spell metadata normalization in UESRPG 3ev4. It consolidates logic from multiple modules into a deterministic, composable profile object.

**Introduced**: Phase 1 (Stability & Parity)  
**Target**: Foundry VTT v13.351

---

## API Reference

### `game.uesrpg.magic.resolveProfile(spell, actor, options)`

Resolves a complete spell profile for casting decisions.

**Parameters**:
- `spell` (Item) - The spell item to resolve
- `actor` (Actor) - The caster actor
- `options` (object) - Casting options:
  - `level` (number, optional) - Override spell level (defaults to spell.system.level)
  - `isRestrained` (boolean, optional) - Enable Spell Restraint cost reduction
  - `isOverloaded` (boolean, optional) - Enable Overload (2× cost, enhanced effect)
  - `isOvercharged` (boolean, optional) - Enable Overcharge talent (future)
  - `isCritical` (boolean, optional) - Mark as critical success (for damage resolution)

**Returns**: `SpellProfile` object with the following structure:

```javascript
{
  // Identity
  uuid: string,
  name: string,
  img: string,
  
  // Metadata
  metadata: {
    school: string,      // "Destruction", "Restoration", etc.
    form: string,        // Spell form (if used)
    type: string,        // "conventional" | "unconventional"
    level: number        // 1-7
  },
  
  // Classification flags
  classification: {
    isAttack: boolean,
    isDamaging: boolean,
    isHealing: boolean,
    isDirect: boolean,
    isInstant: boolean,
    hasUpkeep: boolean,
    hasOverload: boolean,
    hasReinforce: boolean
  },
  
  // Cost profile
  cost: {
    base: number,              // Base cost after AE modifiers
    baseRaw: number,           // Raw cost from schema (before AE)
    aeModifier: number,        // Total AE modifier
    aeBreakdown: Array,        // Detailed AE breakdown
    wpBonus: number,           // Caster's Willpower bonus
    restrained: {
      enabled: boolean,
      reduction: number,       // WPB reduction (capped to cost-1)
      appliesOnSuccess: boolean // Always true (RAW)
    },
    overload: {
      enabled: boolean,
      multiplier: number       // 2 if overloaded, 1 otherwise
    },
    overcharge: {
      enabled: boolean         // Future talent support
    },
    final: number,             // Final cost after restrain refund
    attempt: number            // Cost spent upfront (before refund)
  },
  
  // Damage/Healing profile
  damage: {
    formula: string,           // e.g., "2d6+4"
    type: string,              // "fire", "frost", "healing", etc.
    isHealing: boolean,
    overloadBonusFormula: string,
    criticalBehavior: string   // "max-damage" | "double-restrain"
  },
  
  // Duration profile
  duration: {
    value: number,
    unit: string,              // "instant", "rounds", "minutes", "hours", "days", "permanent"
    isInstant: boolean,
    isPermanent: boolean,
    isFinite: boolean          // True for rounds/minutes/hours/days
  },
  
  // Range profile
  range: {
    type: string,              // "none" | "ranged" | "melee" | "aoe"
    maxMeters: number|null,
    requiresTarget: boolean,
    requiresLineOfSight: boolean
  },
  
  // AoE profile
  aoe: {
    isAoE: boolean,
    shape: string|null,        // "circle", "cone", "rect", "ray"
    size: number,              // Radius/distance in meters
    width: number,             // Width for cone/rect
    pulse: boolean,            // Pulse AoE (affects all entering targets)
    includeCaster: boolean,
    config: object|null        // Full MeasuredTemplate config
  },
  
  // Scaling profile
  scaling: {
    levels: Array,             // Scaling levels array from schema
    currentLevel: object|null, // Current level entry (if scaling)
    hasScaling: boolean
  },
  
  // Mindlock profile
  mindlock: {
    value: number,
    isEnabled: boolean         // True if value > 0
  },
  
  // Computed convenience flags
  computed: {
    isTargeted: boolean,       // Attack, Healing, or Direct
    requiresDefense: boolean,  // Attack && !Direct
    appliesEffects: boolean,   // Has upkeep, embedded effects, or finite duration
    blocksOtherCasts: boolean  // Upkeep with no listed duration
  }
}
```

---

### `game.uesrpg.magic.summarizeProfile(profile)`

Generates a human-readable summary of a spell profile.

**Parameters**:
- `profile` (SpellProfile) - The profile to summarize

**Returns**: `string` - Formatted summary

**Example**:
```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor, { isRestrained: true });
const summary = game.uesrpg.magic.summarizeProfile(profile);
console.log(summary);
// Output: "**Fireball** | Destruction L3 (conventional) | Cost: 30 MP (restrained: -5 on success) | Damage: 3d6 fire | Range: ranged (100m) | AoE: circle (10m)"
```

---

## Usage Examples

### Example 1: Basic Profile Resolution

```javascript
const actor = game.actors.getName("My Wizard");
const spell = actor.items.getName("Fireball");

const profile = game.uesrpg.magic.resolveProfile(spell, actor);
console.log(profile);
```

### Example 2: Restrained Casting

```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor, {
  isRestrained: true
});

console.log(`Attempt cost: ${profile.cost.attempt} MP`);
console.log(`Final cost (on success): ${profile.cost.final} MP`);
console.log(`Restrain reduction: ${profile.cost.restrained.reduction} MP`);
```

### Example 3: Overloaded Casting

```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor, {
  isOverloaded: true
});

console.log(`Overloaded cost: ${profile.cost.attempt} MP (2x base)`);
console.log(`Overload bonus damage: ${profile.damage.overloadBonusFormula}`);
```

### Example 4: Conditional Routing

```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor);

if (profile.computed.isTargeted) {
  console.log("Spell requires target selection");
}

if (profile.computed.requiresDefense) {
  console.log("Spell uses opposed test");
} else if (profile.classification.isDirect) {
  console.log("Spell is direct (no defense allowed)");
}

if (profile.aoe.isAoE) {
  console.log(`Place ${profile.aoe.shape} template (${profile.aoe.size}m)`);
}
```

### Example 5: Cost Breakdown Display

```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor, { isRestrained: true });

console.log("Cost Breakdown:");
console.log(`  Base: ${profile.cost.baseRaw} MP`);
if (profile.cost.aeModifier !== 0) {
  console.log(`  AE Modifiers: ${profile.cost.aeModifier > 0 ? "+" : ""}${profile.cost.aeModifier} MP`);
  profile.cost.aeBreakdown.forEach(ae => {
    console.log(`    - ${ae.label}: ${ae.value > 0 ? "+" : ""}${ae.value}`);
  });
}
console.log(`  Effective Base: ${profile.cost.base} MP`);
if (profile.cost.overload.enabled) {
  console.log(`  Overload: ×${profile.cost.overload.multiplier}`);
}
console.log(`  Attempt Cost: ${profile.cost.attempt} MP`);
if (profile.cost.restrained.enabled) {
  console.log(`  Restrain Refund (on success): -${profile.cost.restrained.reduction} MP`);
  console.log(`  Final Cost (on success): ${profile.cost.final} MP`);
}
```

---

## Integration with Existing Code

The SpellProfile API is designed to be **gradually adopted**. Existing code can continue using direct `spell.system.*` reads during the transition period.

### Migration Pattern

**Before** (direct schema reads):
```javascript
const cost = Number(spell.system.cost ?? 0);
const damageFormula = spell.system.damageFormula ?? "";
const isAttack = Boolean(spell.system.isAttackSpell);
```

**After** (using SpellProfile):
```javascript
const profile = game.uesrpg.magic.resolveProfile(spell, actor);
const cost = profile.cost.base;
const damageFormula = profile.damage.formula;
const isAttack = profile.classification.isAttack;
```

---

## Backward Compatibility

All existing helper functions in `magicka-utils.js`, `spell-range.js`, and `spell-routing.js` remain available and functional. The SpellProfile API is a **consolidation layer**, not a replacement.

**Legacy functions still work**:
- `getSpellCost(spell, level)`
- `getSpellDamageFormula(spell, level)`
- `getSpellRangeType(spell)`
- `classifySpellForRouting(spell)`

---

## Performance Notes

- Profile resolution is **O(1)** - no loops or expensive operations
- Active Effect evaluation is cached per actor during data prep
- Safe to call multiple times per cast (deterministic outputs)
- Profile objects are plain JS objects (not classes) - serializable for chat messages

---

## Future Enhancements (Phase 2+)

- **Spell Scaling UI**: Authoring interface for `scaling.levels[]` array
- **Talent Integration**: Overcharge, Magicka Cycling, etc. modify profile
- **Multi-Target Cost Sharing**: AoE cost distribution options
- **Upkeep Stacking**: Reinforce mechanics modify duration/cost
- **Backfire Modifiers**: Profile includes backfire risk factors

---

## See Also

- [Magic Phase 1 Roadmap](MAGIC_PHASE_1_ROADMAP.md) - Full implementation plan
- [Active Effect Wiki](../Active%20Effect%20Wiki.md) - AE modifier keys reference
- [Chapter 6 - Magic](../Core/Chapter%206%20-%20Magic.md) - RAW spell rules
