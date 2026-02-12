# Import Guide for Action Handlers

**Last Updated**: Phase 20 Refactoring (Action Segmentation + Card Renderer Fix) — February 3, 2026

## Critical Pattern: Context Object (ctx)

**All action handlers receive a `ctx` object from dispatch.js containing workflow state AND helper functions.**

### ❌ WRONG: Import updateCard directly
```javascript
import { updateCard as _updateCard } from "../card-updater.js";

export async function handleAttackerAction(action, ctx) {
  const { message, data, attacker } = ctx;
  // ... 
  await _updateCard(message, data);  // ERROR: _renderCard not provided!
}
```

### ✅ CORRECT: Extract _updateCard from ctx
```javascript
// NO import needed - _updateCard is injected via ctx

export async function handleAttackerAction(action, ctx) {
  const { message, data, attacker, _updateCard } = ctx;
  // ... 
  await _updateCard(message, data);  // Works: _renderCard injected by dispatch
}
```

**Why this pattern?**
- `updateCard` requires a `_renderCard` function as its 3rd parameter (dependency injection)
- `dispatch.js` builds the `_renderCard` wrapper and injects it into `ctx._updateCard`
- Action handlers **must not** import `updateCard` directly
- Always extract `_updateCard` from `ctx` destructuring

**ctx contains:**
```javascript
const ctx = {
  message,       // ChatMessage document
  data,          // Opposed workflow data (message.flags.uesrpg-3ev4.opposed)
  attacker,      // Attacker Actor
  defender,      // Primary defender Actor
  defenderData,  // Defender data structure from data.defenders[0]
  defenderIndex, // Index of primary defender
  defenders,     // All defender data structures (data.defenders)
  isMulti,       // Boolean: multi-defender test
  aToken,        // Attacker Token (may be null)
  dToken,        // Defender Token (may be null)
  bankMode,      // Boolean: banked-choice mode enabled
  isAoE,         // Boolean: area-of-effect attack
  opts,          // Additional options passed to workflow
  workflow,      // OpposedWorkflow reference (for _autoRollBanked, createPending)
  _updateCard    // Card updater with _renderCard injected (DO NOT IMPORT)
};
```

## Quick Reference: Common Import Mistakes

| ❌ WRONG | ✅ CORRECT | Reason |
|----------|-----------|---------|
| `import { updateCard as _updateCard } from "../card-updater.js"` | Extract from `ctx`: `const { _updateCard } = ctx;` | Card updater is injected via ctx with _renderCard dependency |
| `import { _updateCard } from "../render.js"` | Extract from `ctx`: `const { _updateCard } = ctx;` | `_updateCard` is in card-updater and must be injected, not imported |
| `import { _opposedFlags } from "../schema.js"` | `import { _opposedFlags } from "../util.js"` | Schema has data accessors, not flag builders |
| `import { computeTN } from "../../../skills/skill-tn.js"` | `import { computeTN } from "../../tn.js"` | Combat TN is in combat/tn.js, not skills/ |
| `import { _allDefendersCommitted } from "../util.js"` | `import { _allDefendersCommitted } from "../banking-state.js"` | Banking state logic separated from util |
| `import { DefenseDialog } from "../defense-dialog.js"` | `import { DefenseDialog } from "../../defense-dialog.js"` | Wrong path depth (missing one `../`) |
| `import { _variantLabel } from "../util.js"` | `import { _variantLabel } from "../render.js"` | Label formatting is in render.js |
| `import { preConsumeAttackAmmo } from "../ammunition-consumption.js"` | `import { preConsumeAttackAmmo } from "../workflow-helpers.js"` | This function is in workflow-helpers |
| `await import("../special-actions-helper.js")` | `await import("../../special-actions-helper.js")` | Wrong path depth from actions/ subfolder |
| `await import("../action-economy.js")` | `await import("../../action-economy.js")` | Wrong path depth from actions/ subfolder |

## Canonical Export Locations

### Opposed Workflow Internals (`../MODULE.js`)

#### **util.js** - Core utilities only
```javascript
import { 
  _canControlActor,    // Permission check
  _logDebug,           // Debug logging (gated by setting)
  _opposedFlags,       // Flag object builder for chat messages
  _anyActiveGMOnline,  // GM presence check
  _getSystemId,        // System ID getter
  _safeGetSetting      // Settings accessor with fallback
} from "../util.js";
```

#### **schema.js** - Data structure accessors
```javascript
import { 
  _getDefenderOutcome,        // Outcome retrieval
  _setDefenderOutcome,        // Outcome mutation
  _setDefenderAdvantage,      // Advantage mutation
  _getDefenderEntries,        // Multi-defender iteration
  _isMultiDefender,           // Multi-defender check
  _getDefenderResolutionState // Resolution state getter
} from "../schema.js";
```

#### **banking-state.js** - Banking workflow state
```javascript
import { 
  _getBankCommitState,       // Commit state for single defender
  _allDefendersCommitted,    // Check if all defenders committed
  _cleanupAutoRollContext,   // Clear auto-roll flags
  _ensureBankedScaffold      // Initialize banking data structure
} from "../banking-state.js";
```

#### **workflow-helpers.js** - Workflow utilities (47+ functions)
```javascript
import { 
  collectSensorySituationalMods,          // Attacker sensory mods
  collectDefenseSensorySituationalMods,   // Defender sensory mods
  asNumber,                               // Safe number coercion
  weaponHasQuality,                       // Weapon quality check
  getTokenMovementAction,                 // Token movement state
  getDefenseGatingContext,                // Defense option context
  applyAoEEvadeOutcome,                   // AoE evade outcome modifier
  preConsumeAttackAmmo,                   // Pre-roll ammo consumption
  getPreferredWeaponUuid,                 // Get last used weapon
  getContextAttackMode,                   // Extract attack mode from context
  inferAttackModeFromPreferredWeapon      // Infer attack mode from weapon
} from "../workflow-helpers.js";
```

#### **card-updater.js** - Card persistence
```javascript
import { 
  updateCard  // Permission-safe card update (alias as _updateCard)
} from "../card-updater.js";
```

#### **render.js** - Rendering utilities (NO UPDATE FUNCTIONS)
```javascript
import { 
  _variantLabel,       // Format variant labels (All Out, Precision, etc.)
  _circumstanceLabel,  // Format circumstance modifier labels
  _formatModifier,     // Format +/- modifiers
  _renderTNBreakdown   // Render TN breakdown HTML
} from "../render.js";
```

#### **constants.js** (from ../../..) - System constants
```javascript
import { UESRPG } from "../../../constants.js";
// Used for: UESRPG.QUALITIES_CORE_BY_TYPE, UESRPG.TRAITS_BY_TYPE, UESRPG.QUALITIES_CATALOG
```

#### **talent-helpers.js** - Talent-specific logic
```javascript
import { 
  _hasUnstoppableMightEligibleWeapons,   // UM eligibility check
  _promptUnstoppableMightUsage,          // UM usage prompt
  _getGladiatorContext,                  // Gladiator free reaction context
  _getFreeDefenseReactionContext,        // Free reaction eligibility
  _markGladiatorFreeReactionUsed,        // Gladiator state update
  _maybeApplyMightyCleave,               // Mighty Cleave handler
  _maybeEnableFollowUpStrike             // Follow-up Strike workflow
} from "../talent-helpers.js";
```

#### **effects.js** - Active Effect management
```javascript
import { 
  breakAimChainIfPresent,             // Aim chain breaking
  consumeOneShotAdvantageEffects,     // Advantage effect cleanup
  consumeHiddenAfterAttack,           // Hidden state cleanup
  consumeOrBreakAimAfterAttack,       // Aim consumption
  applyOverextendEffect,              // Apply Overextend effect
  applyOverwhelmEffect                // Apply Overwhelm effect
} from "../effects.js";
```

#### **ammunition-consumption.js** - Ammo tracking
```javascript
import { 
  consumePendingAmmo,      // Consume pending ammo
  markWeaponNeedsReload    // Mark weapon as needing reload
} from "../ammunition-consumption.js";
// NOTE: preConsumeAttackAmmo is in workflow-helpers.js, NOT here
```

#### **docs.js** - Document resolution
```javascript
import { 
  _resolveDoc,      // Resolve document from UUID
  _resolveActor,    // Resolve actor from UUID
  _resolveToken     // Resolve token from UUID
} from "../docs.js";
```

#### **outcome-resolution.js** - Outcome computation
```javascript
import { 
  resolveOutcomeRAW,      // Compute raw outcome (attacker/defender/tie)
  computeAdvantageRAW     // Compute advantage value
} from "../outcome-resolution.js";
```

#### **weapon-damage-roller.js** - Damage rolling
```javascript
import { 
  rollWeaponDamage,    // Roll weapon damage
  rollManualDamage     // Roll manual damage (spells, etc.)
} from "../weapon-damage-roller.js";
```

#### **damage-chat-cards.js** - Damage card posting
```javascript
import { 
  postWeaponDamageChatCard,   // Post weapon damage card
  postManualEffectChatCard    // Post manual effect card
} from "../damage-chat-cards.js";
```

#### **attacker-dialogs.js** - Attacker dialog prompts
```javascript
import { 
  attackerDeclareDialog   // Attack declaration dialog
} from "../attacker-dialogs.js";
```

#### **defender-dialogs.js** - Defender dialog prompts
```javascript
import { 
  promptDefenderAdvantage   // Defender advantage selection dialog
} from "../defender-dialogs.js";
```

#### **combat-helpers.js** - Combat computation helpers
```javascript
import { 
  computeRangedRangeContext,   // Ranged attack range context
  computeMeleeReachContext     // Melee attack reach context
} from "../combat-helpers.js";
```

#### **utility-helpers.js** - Miscellaneous utilities
```javascript
import { 
  listEquippedShields   // Get equipped shields
} from "../utility-helpers.js";
```

### Combat System (`../../MODULE.js`)

#### **tn.js** - TN computation (NOT skill-tn.js)
```javascript
import { 
  computeTN,              // Main TN computation with breakdown
  variantMod,             // Variant modifier function (alias: computeVariantMod)
  listCombatStyles,       // Get actor's combat styles
  hasEquippedShield       // Shield equipped check
} from "../../tn.js";
```

#### **defense-dialog.js** - Defense selection
```javascript
import { DefenseDialog } from "../../defense-dialog.js";
```

#### **defense-options.js** - Defense validation
```javascript
import { 
  computeDefenseAvailability,   // Available defense options
  normalizeDefenseType           // Validate/normalize defense choice
} from "../../defense-options.js";
```

#### **action-economy.js** - AP management
```javascript
import { ActionEconomy } from "../../action-economy.js";
```

#### **attack-tracker.js** - Attack limits
```javascript
import { AttackTracker } from "../../attack-tracker.js";
```

#### **combat-utils.js** - Combat utilities
```javascript
import { 
  getHitLocationFromRoll,         // Extract hit location from roll
  resolveHitLocationForTarget,    // Resolve final hit location
  getDamageTypeFromWeapon,        // Get damage type from weapon
  getAttackModeFromWeapon         // Get attack mode from weapon
} from "../../combat-utils.js";
```

#### **mitigation.js** - Damage mitigation
```javascript
import { 
  getBlockValue   // Get block rating value
} from "../../mitigation.js";
```

### Traits & Talents (`../../../traits/MODULE.js`)

#### **combat-talents.js** - Combat talent mechanics
```javascript
import { 
  getDefenseTalentOverrides,      // Talent defense overrides (e.g., Lightning Reflexes)
  applyDefenderTalentTNMods,      // Talent TN modifiers (defender side)
  getEvadeOverrideContext,        // Fearsome evade override context
  applyCombatTalentDoSAdjustments,// Post-roll DoS adjustments
  applyAttackerTalentPreTN        // Pre-TN attacker talent modifiers
} from "../../../traits/combat-talents.js";
```

#### **talents-api.js** - Talent queries
```javascript
import { hasTalent } from "../../../traits/talents-api.js";
```

#### **trait-registry.js** - Trait queries
```javascript
import { 
  isActorSkeletal   // Check if actor is skeletal
} from "../../../traits/trait-registry.js";
```

#### **awareness-talents.js** - Awareness talent mechanics
```javascript
import { 
  applyHyperAwarenessToResult   // Hyper Awareness Evade override
} from "../../../traits/awareness-talents.js";
```

### Conditions (`../../../conditions/MODULE.js`)

#### **condition-engine.js** - Condition management
```javascript
import { 
  hasCondition,      // Check if actor has condition
  removeCondition    // Remove condition from actor
} from "../../../conditions/condition-engine.js";
```

### Config (`../../../config/MODULE.js`)

#### **special-actions.js** - Special action configuration
```javascript
import { 
  getSpecialActionById   // Get special action by ID
} from "../../../config/special-actions.js";
```

### Stamina (`../../../stamina/MODULE.js`)

#### **stamina-dialog.js** - Stamina management
```javascript
import { 
  getActiveStaminaEffect,   // Get active stamina effect
  consumeStaminaEffect,     // Consume stamina effect
  STAMINA_EFFECT_KEYS       // Stamina effect key constants
} from "../../../stamina/stamina-dialog.js";
```

### Constants (`../../../constants.js`)

#### **constants.js** - System constants
```javascript
import { UESRPG } from "../../../constants.js";
```

### Utils (`../../../../utils/MODULE.js`)

#### **degree-roll-helper.js** - Dice rolling
```javascript
import { 
  doTestRoll,                    // Main test roll function
  maybeApplyDefenderIntercept    // Defender intercept talent
} from "../../../../utils/degree-roll-helper.js";
```

#### **authority-proxy.js** - Permission-safe mutations
```javascript
import { 
  requestUpdateDocument,              // Update document (routes to GM if needed)
  requestCreateEmbeddedDocuments,     // Create embedded docs
  requestUpdateEmbeddedDocuments,     // Update embedded docs
  requestDeleteEmbeddedDocuments      // Delete embedded docs
} from "../../../../utils/authority-proxy.js";
```

#### **chat-message-socket.js** - Chat message updates
```javascript
import { 
  safeUpdateChatMessage   // Permission-safe chat message update
} from "../../../../utils/chat-message-socket.js";
```

### Parent Workflow (`../../opposed-workflow.js`)

#### **opposed-workflow.js** - Internal wrapper exports
```javascript
import { 
  _promptWeaponAndAdvantages,       // Weapon selection + advantage prompt
  _ensureResolvedForPostActions,    // Ensure card resolved before damage
  _applyPressAdvantageEffect        // Apply Press Advantage effect
} from "../../opposed-workflow.js";
```

## Path Depth Reference

From `src/core/combat/opposed/actions/`:

| Target Directory | Path Pattern | Example |
|------------------|--------------|---------|
| **Action sibling** | `./MODULE.js` | `./eligibility.js` |
| **Opposed parent** | `../MODULE.js` | `../util.js`, `../schema.js` |
| **Combat grandparent** | `../../MODULE.js` | `../../tn.js`, `../../defense-dialog.js` |
| **Core great-grandparent** | `../../../MODULE.js` | `../../../traits/combat-talents.js` |
| **Utils** | `../../../../utils/MODULE.js` | `../../../../utils/authority-proxy.js` |

## Common Import Patterns

### Pattern 1: Attacker Action Handler
```javascript
// Eligibility & state
import { canAttackerRoll, markAttackFromHidden } from "./eligibility.js";

// Core utilities
import { _canControlActor, _logDebug, _opposedFlags } from "../util.js";
import { _getBankCommitState, _allDefendersCommitted } from "../banking-state.js";

// Workflow helpers
import { 
  collectSensorySituationalMods,
  preConsumeAttackAmmo,
  getPreferredWeaponUuid 
} from "../workflow-helpers.js";

// Card operations
import { updateCard as _updateCard } from "../card-updater.js";
import { _variantLabel } from "../render.js";

// Combat system
import { computeTN, listCombatStyles } from "../../tn.js";
import { AttackTracker } from "../../attack-tracker.js";

// Traits
import { applyCombatTalentDoSAdjustments } from "../../../traits/combat-talents.js";

// Utils
import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
```

### Pattern 2: Defender Action Handler
```javascript
// Core utilities
import { _canControlActor, _logDebug, _opposedFlags } from "../util.js";
import { _getDefenderOutcome, _setDefenderOutcome } from "../schema.js";

// Defense system
import { DefenseDialog } from "../../defense-dialog.js";
import { computeDefenseAvailability } from "../../defense-options.js";

// Talent checks
import { getDefenseTalentOverrides } from "../../../traits/combat-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";

// Helpers
import { maybeApplyDefenderIntercept } from "../../../../utils/degree-roll-helper.js";
```

### Pattern 3: Damage Handler
```javascript
// Core
import { _resolveDoc } from "../docs.js";
import { _opposedFlags } from "../util.js";
import { _getDefenderOutcome } from "../schema.js";

// Damage system
import { rollWeaponDamage } from "../weapon-damage-roller.js";
import { postWeaponDamageChatCard } from "../damage-chat-cards.js";

// From parent workflow (internal wrappers)
import { 
  _promptWeaponAndAdvantages,
  _ensureResolvedForPostActions 
} from "../../opposed-workflow.js";
```

## Debugging Import Errors

### Error: "does not provide an export named X"

1. **Check the error message** - It tells you the file and export name
2. **Search this guide** for the function name (Ctrl+F)
3. **Verify the module** - Use grep to find where it's exported:
   ```bash
   rg -n "export.*FUNCTION_NAME" src/core/combat/opposed --type js
   ```
4. **Update the import** to match the canonical location
5. **Reload Foundry** and verify the error is gone

### Error: Module not found

1. **Check path depth** - Count `../` from `actions/` to target
2. **Verify file exists** - Use file explorer or `ls` command
3. **Check for typos** - Module names are case-sensitive

### Common False Assumptions

| Assumption | Reality |
|------------|---------|
| "All helpers are in util.js" | They're split across 10+ modules |
| "render.js has _updateCard" | It's in card-updater.js |
| "TN is in skill-tn.js" | Combat TN is in combat/tn.js |
| "_opposedFlags is in schema.js" | It's in util.js (flag builder ≠ data accessor) |
| "Ammo functions are together" | preConsumeAttackAmmo is in workflow-helpers.js |

## Before Adding New Imports

1. **Search for the function first**:
   ```bash
   rg -n "export.*FUNCTION_NAME" src/core/combat/opposed --type js
   ```

2. **Check this guide** for similar functions to find the right module

3. **Verify path depth** using the table above

4. **Test in Foundry** - Reload and check console for errors

5. **Update this guide** if you discover a commonly-used export not listed

## Maintenance Guidelines

### When Adding New Functions to Opposed Modules

1. **Choose the right module**:
   - **util.js**: Core utilities (permissions, logging, flag builders)
   - **schema.js**: Data structure accessors/mutators
   - **workflow-helpers.js**: Workflow-specific utilities
   - **effects.js**: Active Effect operations
   - **render.js**: UI rendering utilities only

2. **Export clearly**:
   ```javascript
   export function myNewFunction() { ... }
   ```

3. **Document in this guide** if it will be used by action handlers

### When Refactoring

1. **Update this guide** if you move exports between modules
2. **Search for usage** before moving:
   ```bash
   rg -n "import.*FUNCTION_NAME" src/core/combat/opposed/actions --type js
   ```
3. **Update all imports** in one commit to prevent breakage

---

**Pro Tip**: Bookmark this file and use Ctrl+F to quickly find where to import from. The quick reference table at the top covers 90% of common cases.
