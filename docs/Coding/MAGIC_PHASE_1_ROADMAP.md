# Magic & Spells Phase 1: Stability & Parity Roadmap
**Target: Foundry VTT v13.351 | UESRPG 3ev4 System**

## Executive Summary

Consolidate and stabilize the magic/spellcasting pipeline to ensure deterministic, regression-resistant behavior across all entry points (sheet buttons, TokenHUD, macros, favorites, chat interactions).

**Definition of Done**
- ✅ Single authoritative spell profile resolver used for cost/damage/duration/range
- ✅ Single authoritative casting ingress API for all surfaces
- ✅ Consistent restrain/overload decision UX and cost application
- ✅ Uniform chat card output across all casting paths
- ✅ Manual test checklist passes for all entry points

---

## Phase 1 Tasks

### Task 1: Centralized Spell Profile Resolution
**Goal**: Create a single source of truth for spell metadata normalization

#### 1.1 Create SpellProfile Resolver Module
**File**: `src/core/magic/spell-profile.js` (new)

**Implementation**:
```javascript
/**
 * Resolve a complete spell profile for casting decisions.
 * Schema-neutral normalization layer (no schema changes).
 * 
 * @param {Item} spell - The spell item
 * @param {Actor} actor - The caster
 * @param {object} options - { level, isRestrained, isOverloaded }
 * @returns {SpellProfile}
 */
export function resolveSpellProfile(spell, actor, options = {}) {
  // Normalize all spell metadata:
  // - Cost (base + restrained delta + overload delta + AE modifiers)
  // - Damage/Heal formula (with scaling)
  // - Duration/Upkeep (instant vs upkeep lanes)
  // - Range & AoE (shape/size/width/pulse/include caster)
  // - Flags (Attack/Direct/Upkeep/Overload/Reinforce/Instant)
  // - School/Form/Type metadata
  // - Mindlock gate values
  // - Scaling resolution (read-only for Phase 1)
}
```

**Dependencies**: 
- Extract logic from `magicka-utils.js`:
  - `getSpellCost()`, `getSpellDamageFormula()`, `getSpellLevel()`, `getSpellScalingEntry()`
- Extract logic from `spell-routing.js`:
  - `classifySpellForRouting()`
- Extract range/AoE logic from `spell-range.js`

**Acceptance Criteria**:
- All existing cost/damage/duration/range reads route through SpellProfile
- SpellProfile includes computed fields (TN modifiers, cost breakdown, etc.)
- No duplicate normalization logic across modules
- Backward compatible - existing functions delegate to profile resolver

#### 1.2 Refactor Existing Modules to Use SpellProfile
**Files to Update**:
- `src/core/magic/magicka-utils.js`
  - Refactor `computeSpellAttemptMagickaCost()` to use `resolveSpellProfile()`
  - Refactor `rollSpellDamage()` to use `resolveSpellProfile()`
- `src/core/magic/opposed-workflow.js`
  - Update `createPending()`, `castUnopposed()`, `castDirectTargeted()` to use SpellProfile
- `src/core/magic/opposed/spell-helpers.js`
  - Update helper functions to accept/return SpellProfile
- `src/ui/sheets/shared/listeners/magic-cast.js`
  - Update `showSpellOptionsDialog()` to display profile-derived costs

**Acceptance Criteria**:
- All spell metadata reads go through `resolveSpellProfile()`
- No direct reads of `spell.system.*` outside of profile resolver
- Existing behavior preserved (regression-free)

---

### Task 2: Spell Sheet Parity (No Schema Changes) ⚙️ 80% COMPLETE
**Goal**: Ensure spell sheet fully surfaces existing schema fields per Chapter 6 RAW

#### 2.1 Expand Spell Sheet Editor ✅ COMPLETE
**File**: [templates/spell-sheet.html](templates/spell-sheet.html)

**Status**: All missing fields have been added to spell sheet template:
1. ✅ **Mindlock** field with hint ("Reduces max AP while active")
2. ✅ **Overload Bonus Damage** formula field (conditional on `hasOverload`)
3. ✅ **Reinforce** mechanics description textarea (conditional on `hasReinforce`)
4. ✅ **Scaling** levels read-only display section (with Phase 2 authoring UI note)
5. ✅ **Range** validation hints added ("RAW: Touch, 10m, 50m, 100m, 500m, Self")
6. ✅ **AoE** fields fully visible with "Affect Caster" checkbox
7. ✅ **Duration** structured input with unit selector maintained

**Implementation Notes**:
- Conditional sections use `{{#if item.system.hasOverload}}` and `{{#if item.system.hasReinforce}}`
- Scaling display shows level/cost/damage/description for each scaling tier
- No layout regressions - maintains scrollable responsive grid
- All fields preserve existing naming conventions (no schema changes)

**Acceptance Criteria**:
- ✅ All existing spell schema fields are editable/viewable on spell sheet
- ✅ Conditional sections only show when relevant
- ✅ Help text/hints reference Chapter 6 RAW where applicable
- ✅ No UX regressions (scrollable, responsive grid layout maintained)

#### 2.2 Add Spell Sheet Field Validation ⏸️ DEFERRED
**File**: `src/ui/sheets/spell-sheet.js` (or inline in template)

**Status**: Deferred to avoid risky changes before live testing

**Planned Validations** (for future implementation):
- `level` must be 1-7
- `cost` must be >= 0
- `damageFormula` must be valid dice notation (if damaging)
- `rangeType` must be one of: none/ranged/melee/aoe
- `aoeShape` required when `rangeType === "aoe"`
- `duration.value >= 0` when `hasUpkeep === true`

**Acceptance Criteria** (pending):
- Invalid inputs produce friendly warnings (not silent failures)
- Validation messages reference RAW constraints

---

### Task 3: Unified Spell Casting Service API ⚙️ 95% COMPLETE
**Goal**: Single ingress API for all casting entry points

#### 3.1 Formalize Casting Service in `game.uesrpg` ✅ COMPLETE
**File**: [src/system.js](src/system.js), [src/core/magic/casting-service.js](src/core/magic/casting-service.js)

**Status**: SpellCastingService fully implemented and exposed on `game.uesrpg.magic`

**API Implementation** (lines 1-300 in casting-service.js):
```javascript
// SpellCastingService provides:
export async function cast(cfg) {
  // 1. Resolve spell profile via resolveSpellProfile()
  // 2. Validate AP/Magicka/Range/Targets with _validateCastPrerequisites()
  // 3. Show spell options dialog via showSpellOptionsDialog() (integrated from magic-cast.js)
  // 4. Route to appropriate workflow:
  //    - MagicOpposedWorkflow.createPending() for opposed spells
  //    - MagicOpposedWorkflow.castUnopposed() for untargeted spells
  //    - MagicOpposedWorkflow.castDirectTargeted() for direct targeting
  // 5. Return unified result { success, messageId, errors }
}

// Exposed on game.uesrpg.magic via src/system.js:
game.uesrpg.magic = {
  cast: SpellCastingService.cast,               // Universal casting API
  resolveProfile: resolveSpellProfile,          // Profile resolver for API consumers
  summarizeProfile: summarizeSpellProfile       // Debug utility
};
```

**Dialog Integration**:
- Service uses `showSpellOptionsDialog()` from `src/ui/sheets/shared/listeners/magic-cast.js`
- Dialog prompts for: restrain/overload toggles, difficulty key, manual modifier, overcharge, magicka cycling
- Dialog integration complete (lines 169-200 in casting-service.js)
- Returns standardized options object for workflow routing

**Acceptance Criteria**:
- ✅ `game.uesrpg.magic.cast()` works from console/macros
- ✅ Dialog integration provides consistent UX for spell options
- ✅ Consistent error handling and user notifications
- ✅ Consistent AP/Magicka spending order (AP check → Magicka check → spend)

#### 3.2 Refactor Entry Points to Use Casting Service ⏸️ DEFERRED
**Files to Update** (pending live testing):
- `src/ui/sheets/shared/listeners/magic-cast.js`
  - `onCastMagicAction()` → calls `game.uesrpg.magic.cast()`
  - `castAttackSpell()` → calls `game.uesrpg.magic.cast()`
- `src/ui/sheets/shared/listeners/rolls.js`
  - `onSpellRoll()` → calls `game.uesrpg.magic.cast()`
- `src/ui/sheets/npc-sheet.js`
  - `_onSpellRoll()` → calls `game.uesrpg.magic.cast()`
  - `_onMagicSkillRoll()` → calls `game.uesrpg.magic.cast()`

**Status**: Deferred to avoid regression risk before comprehensive testing

**Risk Assessment**:
- HIGH: Magic casting entry points are battle-tested; premature refactoring could break existing workflows
- MEDIUM: Dialog already prompts in existing flow; dual-prompting risk if service also shows dialog
- RECOMMENDATION: Validate service API via console/macros first, then progressively migrate entry points

**Acceptance Criteria** (pending):
- All entry points route through single API
- No direct calls to `MagicOpposedWorkflow.createPending()` from UI layers
- Consistent spell options dialog appearance
- TokenHUD casting (if implemented) uses same API

---

### Task 4: Unified Chat Card Rendering
**Goal**: Consistent chat output structure across all casting paths

#### 4.1 Define Baseline Chat Card Contract
**File**: `src/core/magic/opposed/render.js` (update)

**Required Fields** (all casting paths):
- **Header**: Spell name, level, school, type (conventional/unconventional)
- **Caster Info**: Caster name/token, AP spent
- **Cost Info**: Base cost, modifiers (AE, restrained delta, overload delta), final cost
- **Casting TN**: Base TN, modifiers breakdown, final TN, roll result, DoS
- **Targets**: Target names/tokens (if targeted)
- **Defense Info**: Defense type, TN, rolls (if opposed)
- **Duration/Upkeep**: Instant/Rounds/Minutes/Hours/Days, upkeep flag
- **Effects Summary**: Damage/heal total, damage type, status effects applied
- **Action Buttons**: Defender commit/roll, upkeep refresh (context-dependent)

**Acceptance Criteria**:
- `renderCard()`, `renderUnopposedCard()`, and direct cast rendering use same template structure
- Missing fields (e.g., no targets for untargeted) gracefully handled
- Chat cards are visually consistent (same CSS classes, layout)

#### 4.2 Add Restrain/Overload Annotations to Chat Cards
**File**: `src/core/magic/opposed/render.js`

**Enhancements**:
- Cost breakdown shows:
  - Base cost (from schema or scaling)
  - Active Effect modifiers (±X)
  - Restrained indicator (if selected): "Spell Restraint available on success (-WPB to min 1)"
  - Overloaded indicator (if selected): "Overloaded (2× cost, enhanced effect)"
- TN breakdown shows spell level penalty (if applicable)
- Damage section shows overload bonus damage (if applicable)

**Acceptance Criteria**:
- Restrain/overload choices visible in chat card
- Cost deltas clearly explained (no mystery modifiers)
- Chat card accurately reflects `spellOptions` passed to casting service

---

### Task 5: Manual Acceptance Testing
**Goal**: Validate parity across all entry points

#### 5.1 Test Spell: "Fireball" (Destruction L3, 30 MP, Attack, AoE)
**Test Matrix**:

| Entry Point | Target Mode | Restrained | Overloaded | Expected Behavior |
|-------------|-------------|-----------|-----------|-------------------|
| Actor Sheet "Cast Magic" | No targets | Yes | No | Unopposed cast, 30 MP attempt, refund on success |
| Actor Sheet "Cast Magic" | 1 target | Yes | No | Opposed test, 30 MP attempt, refund on success |
| Actor Sheet "Cast Magic" | AoE template → 3 targets | No | No | Opposed test vs 3, 30 MP attempt, no refund |
| NPC Sheet Magic Tab | 1 target | No | Yes (if applicable) | Opposed test, 60 MP attempt (2× cost), enhanced damage |
| Favorites Hotkey | No targets | Yes | No | Unopposed cast, 30 MP attempt, refund on success |
| Macro: `game.uesrpg.magic.cast({...})` | 2 targets | Yes | No | Opposed test vs 2, 30 MP attempt, refund on success |

**Validation Steps** (for each entry):
1. **Cost Spent**: Verify actor's Magicka decreases by correct amount
2. **Targets Hit**: Verify all targets receive damage (or defended successfully)
3. **Chat Card**: Verify all required fields present, restrain/overload annotations correct
4. **AP Spent**: Verify 1 AP deducted (or 0 if Instant + secondary action)
5. **Refund Applied**: If restrained + success, verify WPB refund applied (Magicka increased)

#### 5.2 Test Spell: "Lesser Ward" (Restoration L1, 10 MP, Direct, No Target)
**Test Matrix**:

| Entry Point | Target Mode | Restrained | Expected Behavior |
|-------------|-------------|-----------|-------------------|
| Actor Sheet "Cast Magic" | Self | Yes | Direct cast (no defense), 10 MP, refund on success, effect applied to caster |
| Favorites Hotkey | Self | No | Direct cast, 10 MP, no refund, effect applied to caster |

**Validation Steps**:
1. **Self-Targeting**: Verify spell applies Active Effect to caster
2. **No Defense Test**: Verify no opposed roll triggered
3. **Cost/Refund**: Verify correct Magicka handling
4. **Chat Card**: Verify "Direct" annotation, no defense section

#### 5.3 Test Spell: "Healing Hand" (Restoration L2, 20 MP, Healing, Ranged)
**Test Matrix**:

| Entry Point | Target Mode | Restrained | Expected Behavior |
|-------------|-------------|-----------|-------------------|
| Actor Sheet "Cast Magic" | 1 ally | Yes | Opposed test (no defense for healing), 20 MP, refund on success, HP restored |
| Macro | 2 allies | No | Opposed test vs 2, 20 MP, no refund, HP restored to both |

**Validation Steps**:
1. **HP Restoration**: Verify targets gain correct HP amount
2. **No Defense**: Verify healing spells don't prompt defender actions
3. **Chat Card**: Verify damage type shows "Healing", HP delta shown

---

## Non-Goals (Deferred to Phase 2)

- **Spell Scaling UI**: Phase 1 only displays scaling data read-only; authoring UI deferred
- **Backfire Chat Annotations**: Basic backfire works; detailed rationale/modifiers shown in Phase 2
- **Upkeep Stacking Rules**: Phase 1 assumes simple upkeep; complex stacking (reinforcement, etc.) in Phase 2
- **TokenHUD Integration**: If not already implemented, defer to Phase 2
- **Schema Changes**: No migrations or schema refactoring in Phase 1

---

## Implementation Order

1. **Week 1**: Task 1.1-1.2 (SpellProfile resolver, refactor consumers)
2. **Week 2**: Task 2.1-2.2 (Spell sheet parity, validation)
3. **Week 3**: Task 3.1-3.2 (Casting service API, refactor entry points)
4. **Week 4**: Task 4.1-4.2 (Unified chat cards, annotations)
5. **Week 5**: Task 5.1-5.3 (Manual testing, bug fixes)

---

## Rollback Plan

- **SpellProfile**: If issues arise, fallback to direct `spell.system.*` reads temporarily
- **Casting Service**: Entry points can bypass API and call `MagicOpposedWorkflow` directly if needed
- **Chat Cards**: Preserve legacy rendering functions as `_legacy*()` until fully validated

---

## Success Metrics

- ✅ All 3 test spells pass full test matrix (30+ test cases)
- ✅ No regressions in existing spell behavior (GM verification)
- ✅ Consistent cost display across all entry points (visual inspection)
- ✅ Consistent chat card structure (visual inspection)
- ✅ API usable from macros (`game.uesrpg.magic.cast()` documented and working)

---

## Dependencies & Risks

**Dependencies**:
- Existing `MagicOpposedWorkflow` must remain stable
- `magicka-utils.js` cost logic must not change during refactor
- Chat card templates must support new fields without breaking layout

**Risks**:
- **Regression Risk**: High - magic system touches many surfaces. Mitigation: extensive manual testing, preserve legacy paths during transition.
- **Performance Risk**: Low - profile resolution is O(1) per cast, no loops or expensive operations.
- **Multiplayer Risk**: Medium - ensure authority proxy used for all mutations. Mitigation: review all `actor.update()` calls, use `requestUpdateDocument()`.

---

## Post-Phase 1 Handoff

**Deliverables**:
- `src/core/magic/spell-profile.js` - Spell profile resolver
- `src/core/magic/casting-service.js` - Unified casting API
- Updated `templates/spell-sheet.html` - Full schema coverage
- Updated `src/core/magic/opposed/render.js` - Consistent chat cards
- `docs/Coding/MAGIC_PHASE_1_TEST_RESULTS.md` - Test execution report

**Documentation**:
- Update `docs/Active Effect Wiki.md` with spell cost modifier keys
- Update `docs/Coding/README.md` with casting service API examples
- Add JSDoc to all new/updated functions

**Phase 2 Readiness**:
- Spell profile resolver extensible for advanced scaling authoring
- Casting service extensible for multi-target reinforce/upkeep stacking
- Chat cards support additional annotations (backfire details, stacking rules)
