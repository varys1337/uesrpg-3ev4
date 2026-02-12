# Magic & Spells Phase 3: Feature Growth Roadmap
**Target: Foundry VTT v13.351 | UESRPG 3ev4 System**

## Executive Summary

Build high-value authoring and gameplay extensions on top of the stabilized Phase 1 casting ingress (SpellCastingService) and Phase 2 rule-complete core (backfire automation, AoE targeting, upkeep workflows). All Phase 3 features should be additive, low-risk, and leverage existing infrastructure.

**Definition of Done**
- ✅ Spell scaling/variants are first-class for authoring and in-game variant selection
- ✅ Spell wrappers (scrolls/staves) reuse SpellCastingService ingress with custom cost sources
- ✅ GM tooling for compendium quality validation (spell pack audit tool)
- ✅ Enhanced chat card presentation with scaling/variant data
- ✅ Manual acceptance tests pass for all Phase 3 features

---

## Prerequisites & Foundation Review

### ✅ Phase 1 Deliverables (Required for Phase 3)

**SpellProfile API** ([src/core/magic/spell-profile.js](../../src/core/magic/spell-profile.js)):
- ✅ `resolveSpellProfile(spell, actor, options)` normalizes all spell metadata
- ✅ Scaling resolution via `_resolveScaling()` (reads `spell.system.scaling.levels`)
- ✅ Cost/damage/duration/range/AoE normalization
- ✅ Active Effect modifier integration
- ✅ Exposed on `game.uesrpg.magic.resolveProfile()`

**SpellCastingService API** ([src/core/magic/casting-service.js](../../src/core/magic/casting-service.js)):
- ✅ `cast(cfg)` universal spell casting ingress
- ✅ Routes to opposed/unopposed/direct workflows
- ✅ Validates prerequisites (AP, Magicka, range, targets)
- ✅ Dialog integration for restrain/overload/difficulty selection
- ✅ Exposed on `game.uesrpg.magic.cast()`

**Spell Schema** ([template.json](../../template.json) "spell" type):
- ✅ `system.scaling.levels` array exists (read-only in Phase 1)
- ✅ Each level: `{ level, cost, damageFormula, duration, description }`
- ✅ `getSpellScalingEntry(spell, level)` in magicka-utils.js

### ⚠️ Phase 1 Gaps (Must Address Before Phase 3)

**Entry Point Refactoring** (Phase 1 Task 3.2):
- ⚠️ **Blocker**: Existing entry points (`onCastMagicAction`, `onSpellRoll`, `castAttackSpell`) do NOT use `game.uesrpg.magic.cast()` yet
- **Recommendation**: Complete entry point refactoring before implementing Phase 3 scrolls/staves
- **Reason**: Scroll/staff casting must route through same ingress; inconsistent if base spell casting doesn't

**Chat Card Unification** (Phase 1 Task 4):
- ⚠️ **Blocker**: Chat cards not yet unified across opposed/unopposed/direct workflows
- **Impact**: Phase 3 chat card enhancements (scaling display, variant selection display) require stable baseline

### ✅ Phase 2 Deliverables (Supporting Infrastructure)

**Backfire Automation** ([src/core/magic/backfire.js](../../src/core/magic/backfire.js)):
- ✅ All 77 backfire effects automated
- ✅ Scrolls/staves exempt from backfire (RAW: backfire only on spell failures)

**AoE Targeting** ([src/core/magic/spell-range.js](../../src/core/magic/spell-range.js)):
- ✅ Hardened template placement (no token conflicts)
- ✅ Scrolls/staves use same AoE targeting workflow

**Spell Effect Tracking** ([src/core/magic/upkeep-workflow.js](../../src/core/magic/upkeep-workflow.js)):
- ✅ SpellInstance identity tracking
- ✅ Upkeep refresh prompts
- ✅ Duration expiration
- ✅ Scrolls/staves create effects with same tracking

---

## Phase 3 Tasks

### Task 1: Scaling UI as First-Class Authoring ✏️ (Priority: Medium)
**Goal**: Enhance spell item sheet to make `system.scaling.levels` editable with validation

**Current State**:
- ✅ Spell schema has `system.scaling.levels` array
- ✅ Spell sheet ([templates/spell-sheet.html](../../templates/spell-sheet.html)) displays scaling read-only (Phase 1 Task 2)
- ❌ No authoring UI for adding/editing/removing scaling levels
- ❌ No validation for scaling consistency (level order, missing formulas, etc.)

**Implementation**:

#### 1.1 Add Scaling Levels Editor to Spell Sheet
**File**: [templates/spell-sheet.html](../../templates/spell-sheet.html)

**Enhancement**: Replace read-only scaling display with interactive editor

**Mockup Structure**:
```handlebars
{{#if item.system.scaling}}
<section class="attribute-section">
  <h4>Scaling Levels 
    <button class="add-scaling-level" type="button" title="Add Scaling Level">
      <i class="fas fa-plus"></i>
    </button>
  </h4>
  <table class="scaling-levels-table">
    <thead>
      <tr>
        <th>Level</th>
        <th>Cost (MP)</th>
        <th>Damage Formula</th>
        <th>Duration</th>
        <th>Description</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {{#each item.system.scaling.levels as |scalingEntry idx|}}
      <tr data-level-index="{{idx}}">
        <td><input type="number" name="system.scaling.levels.{{idx}}.level" value="{{scalingEntry.level}}" min="1" max="7" /></td>
        <td><input type="number" name="system.scaling.levels.{{idx}}.cost" value="{{scalingEntry.cost}}" min="0" /></td>
        <td><input type="text" name="system.scaling.levels.{{idx}}.damageFormula" value="{{scalingEntry.damageFormula}}" placeholder="e.g., 3d6" /></td>
        <td>
          <input type="number" name="system.scaling.levels.{{idx}}.duration.value" value="{{scalingEntry.duration.value}}" min="0" style="width:60px;" />
          <select name="system.scaling.levels.{{idx}}.duration.unit" style="width:100px;">
            <option value="instant" {{#if (eq scalingEntry.duration.unit "instant")}}selected{{/if}}>Instant</option>
            <option value="rounds" {{#if (eq scalingEntry.duration.unit "rounds")}}selected{{/if}}>Rounds</option>
            <option value="minutes" {{#if (eq scalingEntry.duration.unit "minutes")}}selected{{/if}}>Minutes</option>
            <option value="hours" {{#if (eq scalingEntry.duration.unit "hours")}}selected{{/if}}>Hours</option>
          </select>
        </td>
        <td><input type="text" name="system.scaling.levels.{{idx}}.description" value="{{scalingEntry.description}}" placeholder="Effect at this level" /></td>
        <td>
          <button class="delete-scaling-level" type="button" data-index="{{idx}}" title="Delete Level">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
      {{/each}}
    </tbody>
  </table>
</section>
{{/if}}
```

**Sheet Listeners** ([src/ui/sheets/item/listeners/index.js](../../src/ui/sheets/item/listeners/index.js)):
- `.add-scaling-level` click: Add new entry to `system.scaling.levels`
- `.delete-scaling-level` click: Remove entry by index
- Auto-save on input blur (existing AppV1 behavior)

**Acceptance Criteria**:
- ✅ Can add new scaling levels via "+" button
- ✅ Can edit all fields (level, cost, damage, duration, description) inline
- ✅ Can delete scaling levels via trash icon
- ✅ Fields persist on save/reload
- ✅ Table is scrollable if many levels (no infinite growth)

#### 1.2 Add Scaling Validation Logic
**File**: [src/ui/sheets/spell-sheet.js](../../src/ui/sheets/spell-sheet.js) or new file [src/core/magic/scaling-validator.js](../../src/core/magic/scaling-validator.js)

**Validation Rules**:
```javascript
/**
 * Validate scaling levels for consistency.
 * @param {Array} levels - Array of scaling level objects
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateScalingLevels(levels) {
  const errors = [];
  
  if (!Array.isArray(levels) || levels.length === 0) {
    return { valid: true, errors: [] }; // No scaling is valid
  }
  
  // Rule 1: Level values must be 1-7
  for (const [idx, entry] of levels.entries()) {
    const lvl = Number(entry.level);
    if (!Number.isFinite(lvl) || lvl < 1 || lvl > 7) {
      errors.push(`Scaling entry ${idx + 1}: Level must be 1-7 (got ${entry.level})`);
    }
  }
  
  // Rule 2: Level values must be unique
  const usedLevels = new Set();
  for (const entry of levels) {
    if (usedLevels.has(entry.level)) {
      errors.push(`Duplicate scaling level: ${entry.level}`);
    }
    usedLevels.add(entry.level);
  }
  
  // Rule 3: Cost must be >= 0
  for (const [idx, entry] of levels.entries()) {
    const cost = Number(entry.cost);
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push(`Scaling entry ${idx + 1}: Cost must be >= 0 (got ${entry.cost})`);
    }
  }
  
  // Rule 4: If spell has damage, scaling entries should have damageFom formula (warning, not error)
  // (Implemented as soft validation in UI hint)
  
  return { valid: errors.length === 0, errors };
}
```

**Integration**: Call validation in spell sheet `_updateObject()` before persisting

**Acceptance Criteria**:
- ✅ Invalid levels (< 1 or > 7) produce error messages
- ✅ Duplicate levels produce error messages
- ✅ Negative costs produce error messages
- ✅ Validation errors prevent save and display friendly warnings
- ✅ Valid scaling configurations save successfully

---

### Task 2: Cast-Time Variant Selection 🎯 (Priority: High)
**Goal**: Extend casting dialog to allow level selection for scaled spells

**Current State**:
- ✅ `showSpellOptionsDialog()` ([src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js)) prompts for restrain/overload/difficulty
- ✅ SpellProfile resolver accepts `options.level` parameter
- ❌ No UI for selecting casting level (always uses base level)
- ❌ No preview of resolved profile before confirming cast

**Implementation**:

#### 2.1 Enhance Spell Options Dialog with Variant Selector
**File**: [src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js)

**Current Dialog** (`showSpellOptionsDialog()` lines 179-300):
- Prompts for: restrain, overload, difficulty, manual modifier, overcharge, magicka cycling

**Enhancement**: Add variant selector section before difficulty

**Mockup Insertion** (after line ~210):
```javascript
// NEW: Variant/Scaling Level Selector
const scalingLevels = spell?.system?.scaling?.levels ?? [];
const hasScaling = Array.isArray(scalingLevels) && scalingLevels.length > 0;
const baseLevel = spell?.system?.level ?? 1;

let scalingHTML = '';
if (hasScaling) {
  scalingHTML = `
    <div class="form-group">
      <label>Cast at Level:</label>
      <select id="spell-cast-level">
        <option value="${baseLevel}">Base (Level ${baseLevel}, ${spell.system.cost} MP)</option>
        ${scalingLevels.map(entry => {
          // Resolve cost for this level (use SpellProfile if available)
          const previewCost = entry.cost ?? spell.system.cost;
          const previewDamage = entry.damageFormula ?? spell.system.damageFormula ?? '';
          return `<option value="${entry.level}">
            Level ${entry.level} (${previewCost} MP${previewDamage ? ', ' + previewDamage : ''})
            ${entry.description ? ' — ' + entry.description : ''}
          </option>`;
        }).join('')}
      </select>
    </div>
  `;
}

// Insert scalingHTML into dialog content before difficulty section
```

**Dialog Return Value**: Add `castLevel` to returned options object
```javascript
return {
  isRestrained,
  isOverloaded,
  difficultyKey,
  manualModifier,
  useOvercharge,
  useMagickaCycling,
  restraintValue,
  baseCost,
  castLevel: hasScaling ? parseInt(html.find("#spell-cast-level").val()) : null  // NEW
};
```

**Integration with SpellCastingService**:
Update [src/core/magic/casting-service.js](../../src/core/magic/casting-service.js) `cast()` to pass `castLevel` to profile resolver:
```javascript
// In cast() function, line ~80
const profile = resolveSpellProfile(spell, casterActor, {
  isRestrained: spellOptions?.isRestrained,
  isOverloaded: spellOptions?.isOverloaded,
  level: spellOptions?.castLevel ?? null  // NEW: Pass selected variant level
});
```

**Acceptance Criteria**:
- ✅ Dialog shows scaling level selector only when `spell.system.scaling.levels` exists
- ✅ Each option displays: level, cost, damage (if applicable), description
- ✅ Selected level passed to SpellProfile resolver
- ✅ Casting uses correct cost/damage/duration for selected level
- ✅ Chat card displays selected level (Task 4 dependency)

#### 2.2 Add Profile Preview in Dialog (Optional Enhancement)
**Goal**: Show live-updated cost/damage preview as user changes restrain/overload/level selections

**Approach**: Add reactive `<div id="profile-preview">` section that updates on select/checkbox change
```javascript
// Pseudo-code for profile preview
html.find("#spell-cast-level, #restrain-toggle, #overload-toggle").on("change", () => {
  const tempOptions = {
    isRestrained: html.find("#restrain-toggle").is(":checked"),
    isOverloaded: html.find("#overload-toggle").is(":checked"),
    level: parseInt(html.find("#spell-cast-level").val())
  };
  const preview = game.uesrpg.magic.resolveProfile(spell, actor, tempOptions);
  html.find("#profile-preview").html(`
    <strong>Total Cost:</strong> ${preview.cost} MP<br/>
    <strong>Damage:</strong> ${preview.damageFormula ?? 'N/A'}<br/>
    <strong>Duration:</strong> ${preview.duration.value} ${preview.duration.unit}
  `);
});
```

**Acceptance Criteria** (Optional):
- ✅ Preview updates in real-time as user changes selections
- ✅ Preview shows final cost (including AE modifiers, overload 2×, restrain refund note)
- ✅ Preview shows final damage formula

---

### Task 3: Spell Wrappers (Scrolls & Staves) 📜 (Priority: Medium)
**Goal**: Add item types for scrolls/staves that cast spells via SpellCastingService with custom cost sources

**Current State**:
- ✅ Item types: item, container, armor, weapon, spell, trait, power, talent, combatStyle, skill, magicSkill, ammunition, language, faction
- ❌ No "scroll" or "staff" item types exist
- ✅ SpellCastingService can route any spell cast request

**Design Constraints**:
- **No schema migrations**: Use existing "item" type with flags or add new item type
- **Reuse casting ingress**: All casts go through `game.uesrpg.magic.cast()`
- **RAW compliance**: Scroll/staff rules from Chapter 6 (if documented)

**Implementation**:

#### 3.1 Add "scroll" Item Type (Schema Change)
**File**: [template.json](../../template.json)

**Addition**: Add "scroll" to `Item.types` array (line 779)
```json
"types": [
  "item",
  "container",
  "armor",
  "weapon",
  "spell",
  "scroll",  // NEW
  "staff",   // NEW (optional, or do in separate subtask)
  "trait",
  // ...existing types
]
```

**Scroll Schema** (add after existing item types):
```json
"scroll": {
  "templates": ["physicalObject"],
  "description": "",
  "quantity": 1,
  "enc": 0.1,
  "price": 0,
  "spellUuid": "",            // Embedded spell reference (UUID of spell in compendium or actor)
  "spellLevel": 1,            // Level at which scroll was scribed
  "spellSchool": "",          // School (for flavor, e.g., "Destruction")
  "spellName": "",            // Spell name (denormalized for display)
  "casterLevel": 0,           // Level of original scribe (optional, affects potency)
  "consumeOnUse": true,       // Always true for scrolls
  "requiresSkillCheck": false // If true, reader must pass Magic (Opposition) check
}
```

**Acceptance Criteria**:
- ✅ "scroll" appears in item type creation dropdown
- ✅ Scroll sheet renders with spell selection field

#### 3.2 Create Scroll Item Sheet Template
**File**: [templates/scroll-sheet.html](../../templates/scroll-sheet.html) (new)

**Template Structure**:
```handlebars
<form class="{{cssClass}} flexcol" autocomplete="off">
  <header class="sheet-header">
    <img class="profile-img" src="{{item.img}}" data-edit="img" title="{{item.name}}" />
    <div class="header-fields">
      <h1 class="charname"><input name="name" type="text" value="{{item.name}}" placeholder="Scroll Name" /></h1>
    </div>
  </header>

  <nav class="sheet-tabs tabs" data-group="primary">
    <a class="item" data-tab="details">Details</a>
  </nav>

  <section class="sheet-body">
    <div class="tab details active" data-group="primary" data-tab="details">
      
      <div class="attribute-row">
        <label>Embedded Spell</label>
        <input type="text" name="system.spellUuid" value="{{item.system.spellUuid}}" placeholder="Drag spell here or enter UUID" readonly />
        <button class="select-spell" type="button">Select Spell</button>
      </div>
      
      {{#if item.system.spellUuid}}
      <div class="attribute-row">
        <label>Spell Name</label>
        <input type="text" name="system.spellName" value="{{item.system.spellName}}" readonly />
      </div>
      <div class="attribute-row">
        <label>Scribed at Level</label>
        <input type="number" name="system.spellLevel" value="{{item.system.spellLevel}}" min="1" max="7" />
      </div>
      <div class="attribute-row">
        <label>School</label>
        <input type="text" name="system.spellSchool" value="{{item.system.spellSchool}}" readonly />
      </div>
      <div class="attribute-row">
        <label>Quantity</label>
        <input type="number" name="system.quantity" value="{{item.system.quantity}}" min="0" />
      </div>
      {{/if}}
      
      <div class="attribute-row">
        <label>Description</label>
        <textarea name="system.description" rows="6">{{item.system.description}}</textarea>
      </div>
      
      <div class="attribute-row">
        <label>Encumbrance</label>
        <input type="number" name="system.enc" value="{{item.system.enc}}" step="0.1" />
      </div>
      
      <div class="attribute-row">
        <label>Price</label>
        <input type="number" name="system.price" value="{{item.system.price}}" min="0" />
      </div>
      
    </div>
  </section>
</form>
```

**Sheet Class** ([src/ui/sheets/scroll-sheet.js](../../src/ui/sheets/scroll-sheet.js), new):
```javascript
import ItemSheet from "../item-sheet.js";

export default class ScrollSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["uesrpg-3ev4", "sheet", "item", "scroll"],
      template: "systems/uesrpg-3ev4/templates/scroll-sheet.html",
      width: 560,
      height: 420
    });
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    
    // Select spell button
    html.find(".select-spell").on("click", this._onSelectSpell.bind(this));
  }
  
  async _onSelectSpell(event) {
    event.preventDefault();
    
    // Open compendium browser or item picker for spells
    // For now, simple prompt for UUID
    const uuid = await Dialog.prompt({
      title: "Select Spell",
      content: `<p>Enter spell UUID (drag spell to scroll item to auto-populate):</p>
                <input type="text" id="spell-uuid" placeholder="UUID" style="width:100%;" />`,
      callback: (html) => html.find("#spell-uuid").val()
    });
    
    if (!uuid) return;
    
    try {
      const spell = await fromUuid(uuid);
      if (!spell || spell.type !== "spell") {
        ui.notifications.error("Invalid spell UUID.");
        return;
      }
      
      // Update scroll with spell metadata
      await this.item.update({
        "system.spellUuid": uuid,
        "system.spellName": spell.name,
        "system.spellSchool": spell.system.school ?? "",
        "system.spellLevel": spell.system.level ?? 1
      });
    } catch (err) {
      ui.notifications.error("Failed to load spell.");
      console.error(err);
    }
  }
}
```

**Register Sheet** ([src/hooks/init.js](../../src/hooks/init.js)):
```javascript
import ScrollSheet from "../ui/sheets/scroll-sheet.js";

Items.registerSheet("uesrpg-3ev4", ScrollSheet, {
  types: ["scroll"],
  makeDefault: true
});
```

**Acceptance Criteria**:
- ✅ Scroll item sheet renders with spell selection UI
- ✅ Can select spell via UUID input or drag-drop
- ✅ Spell metadata (name, school, level) auto-populates
- ✅ Quantity decrements on use

#### 3.3 Implement Scroll Casting Workflow
**File**: [src/core/magic/scroll-casting.js](../../src/core/magic/scroll-casting.js) (new)

**Workflow**:
```javascript
/**
 * Cast a spell from a scroll item.
 * Consumes scroll quantity and routes through SpellCastingService.
 * 
 * @param {Actor} reader - Actor reading the scroll
 * @param {Item} scrollItem - The scroll item (type: "scroll")
 * @param {object} options - Casting options (targets, etc.)
 * @returns {Promise<object|null>} - Cast result
 */
export async function castFromScroll(reader, scrollItem, options = {}) {
  if (scrollItem.type !== "scroll") {
    ui.notifications.error("Item is not a scroll.");
    return null;
  }
  
  const spellUuid = scrollItem.system.spellUuid;
  if (!spellUuid) {
    ui.notifications.error("Scroll has no embedded spell.");
    return null;
  }
  
  const spell = await fromUuid(spellUuid);
  if (!spell || spell.type !== "spell") {
    ui.notifications.error("Embedded spell not found.");
    return null;
  }
  
  // Check quantity
  const quantity = scrollItem.system.quantity ?? 0;
  if (quantity < 1) {
    ui.notifications.warn("No scrolls remaining.");
    return null;
  }
  
  // Optional: Skill check requirement (RAW-dependent)
  if (scrollItem.system.requiresSkillCheck) {
    // Prompt for Magic (Opposition) skill check
    // (Implement if RAW requires skill check for scroll reading)
  }
  
  // Route to SpellCastingService
  // **KEY**: Scrolls do NOT cost Magicka; AP cost still applies
  const castConfig = {
    spellUuid: spell.uuid,
    casterActorUuid: reader.uuid,
    casterTokenUuid: options.casterTokenUuid ?? null,
    targetTokenUuids: options.targetTokenUuids ?? [],
    spellOptions: {
      ...options.spellOptions,
      // Override cost source: scrolls cost 0 MP
      costOverride: 0,
      // Use scroll's scribed level
      castLevel: scrollItem.system.spellLevel
    },
    castActionType: options.castActionType ?? "primary"
  };
  
  const result = await game.uesrpg.magic.cast(castConfig);
  
  // Consume scroll on successful cast
  if (result?.success) {
    await scrollItem.update({ "system.quantity": quantity - 1 });
    ui.notifications.info(`${scrollItem.name} consumed (${quantity - 1} remaining).`);
  }
  
  return result;
}
```

**Integration**: Add scroll casting button to scroll item sheet or actor sheet inventory

**Acceptance Criteria**:
- ✅ Scroll casting routes through `game.uesrpg.magic.cast()`
- ✅ Scroll costs 0 Magicka (AP still required)
- ✅ Scroll quantity decrements on successful cast
- ✅ Spell cast at scribed level (from `scroll.system.spellLevel`)
- ✅ Chat card shows scroll source (not caster's spell list)

#### 3.4 Staff Item Type (Optional Extension)
**Similar Approach**:
- Add "staff" item type to `template.json`
- Staff schema: `{ charges, maxCharges, rechargeRule, embeddedSpells: [] }`
- Staff sheet: Manage charges and embedded spell list
- Casting workflow: Deduct charges instead of Magicka

**Defer to Phase 3.5 or Phase 4** if scope is too large.

---

### Task 4: Chat Card Quality of Life Enhancements 💬 (Priority: Low)
**Goal**: Improve chat card presentation after stability proven

**Current State**:
- ✅ Chat cards render for opposed/unopposed/direct casts
- ⚠️ Chat cards NOT yet unified (Phase 1 Task 4 incomplete)
- ❌ No scaling level display in chat cards
- ❌ No compact vs expanded modes

**Prerequisite**: Complete Phase 1 Task 4 (unified chat card rendering) before implementing enhancements

**Implementation** (Pending Phase 1 Task 4 Completion):

#### 4.1 Add Scaling Level Display to Chat Cards
**File**: [src/core/magic/opposed/render.js](../../src/core/magic/opposed/render.js) or unified chat card renderer

**Enhancement**: Add scaling level annotation to spell header
```handlebars
<div class="spell-header">
  <h3>{{spellName}}</h3>
  <p class="spell-metadata">
    Level {{baseLevel}}
    {{#if castLevel}}
      <span class="cast-level">(Cast at Level {{castLevel}})</span>
    {{/if}}
    | {{schoolName}} | {{spellType}}
  </p>
</div>
```

**Data Source**: Pass `castLevel` from SpellProfile to chat card renderer

**Acceptance Criteria**:
- ✅ Chat card displays "Cast at Level X" when variant selected
- ✅ Base level still shown for reference
- ✅ Scaling level annotation styled distinctly (color/font)

#### 4.2 Compact vs Expanded Chat Card Modes
**Goal**: Allow users to collapse/expand chat card details

**Approach**: Add toggle button to chat card header
```javascript
// In chat card template
<button class="toggle-details" data-message-id="{{messageId}}">
  <i class="fas fa-chevron-down"></i> Details
</button>

<div class="spell-details {{#if compact}}hidden{{/if}}">
  <!-- Cost breakdown, modifiers, targets, etc. -->
</div>
```

**Listener** ([src/core/magic/opposed/chat-listeners.js](../../src/core/magic/opposed/chat-listeners.js), new or existing):
```javascript
Hooks.on("renderChatMessage", (message, html, data) => {
  html.find(".toggle-details").on("click", (event) => {
    const details = html.find(".spell-details");
    details.toggleClass("hidden");
    const icon = $(event.currentTarget).find("i");
    icon.toggleClass("fa-chevron-down fa-chevron-up");
  });
});
```

**Acceptance Criteria**:
- ✅ Chat cards can be toggled between compact and expanded views
- ✅ Compact view shows: spell name, level, caster, result (success/fail)
- ✅ Expanded view shows: full breakdown, modifiers, targets, damage, etc.
- ✅ Toggle state persists per message (CSS class toggle)

#### 4.3 Copy Cast Profile Debug Block (Developer QoL)
**Goal**: Behind a debug setting, add "Copy Profile" button to chat cards

**Setting** ([src/hooks/init.js](../../src/hooks/init.js)):
```javascript
game.settings.register("uesrpg-3ev4", "debugChatProfile", {
  name: "Show Copy Profile Button in Chat Cards",
  hint: "Adds a button to copy SpellProfile JSON for debugging.",
  scope: "client",
  config: true,
  type: Boolean,
  default: false
});
```

**Chat Card Addition**:
```handlebars
{{#if (setting "debugChatProfile")}}
<button class="copy-profile" data-profile="{{json profile}}">
  <i class="fas fa-clipboard"></i> Copy Profile
</button>
{{/if}}
```

**Listener**:
```javascript
html.find(".copy-profile").on("click", (event) => {
  const profileJson = event.currentTarget.dataset.profile;
  navigator.clipboard.writeText(profileJson);
  ui.notifications.info("SpellProfile copied to clipboard.");
});
```

**Acceptance Criteria**:
- ✅ Button only visible when debug setting enabled
- ✅ Clicking button copies JSON to clipboard
- ✅ Useful for debugging spell cost/damage/duration issues

---

### Task 5: GM Spell Pack Audit Tool 🛠️ (Priority: High)
**Goal**: Implement GM-facing utility to validate compendium spell quality

**Current State**:
- ✅ Spell compendia: `spells-revised/` pack exists
- ❌ No automated quality checks
- ❌ No reporting for missing/invalid metadata

**Implementation**:

#### 5.1 Create Audit Utility Module
**File**: [src/utils/dev/spell-audit.js](../../src/utils/dev/spell-audit.js) (new)

**Audit Logic**:
```javascript
/**
 * Audit spell pack for missing/invalid metadata.
 * 
 * @param {string} packName - Compendium pack name (e.g., "uesrpg-3ev4.spells-revised")
 * @returns {Promise<object>} - Audit report
 */
export async function auditSpellPack(packName) {
  const pack = game.packs.get(packName);
  if (!pack || pack.documentName !== "Item") {
    return { error: `Pack ${packName} not found or not an Item pack.` };
  }
  
  const spells = await pack.getDocuments({ type: "spell" });
  const report = {
    packName,
    totalSpells: spells.length,
    issues: [],
    warnings: []
  };
  
  for (const spell of spells) {
    const issues = _auditSpell(spell);
    if (issues.errors.length > 0 || issues.warnings.length > 0) {
      report.issues.push({ spell: spell.name, id: spell.id, ...issues });
    }
  }
  
  return report;
}

/**
 * Audit a single spell for issues.
 * @param {Item} spell
 * @returns {{errors: string[], warnings: string[]}}
 */
function _auditSpell(spell) {
  const errors = [];
  const warnings = [];
  
  // Check 1: School metadata
  if (!spell.system.school || spell.system.school === "") {
    errors.push("Missing school");
  }
  
  // Check 2: Type metadata (Attack/Direct/Healing)
  if (!spell.system.type || spell.system.type === "") {
    errors.push("Missing type");
  }
  
  // Check 3: Form metadata (Conventional/Unconventional)
  if (!spell.system.form || spell.system.form === "") {
    warnings.push("Missing form (defaults to Conventional)");
  }
  
  // Check 4: Attack spells should have damage formula
  if (spell.system.type === "Attack" && (!spell.system.damageFormula || spell.system.damageFormula === "")) {
    errors.push("Attack spell missing damageFormula");
  }
  
  // Check 5: Healing spells should have damageFormula (used for healing amount)
  if (spell.system.type === "Healing" && (!spell.system.damageFormula || spell.system.damageFormula === "")) {
    warnings.push("Healing spell missing damageFormula (healing amount)");
  }
  
  // Check 6: Upkeep spells should have duration
  if (spell.system.hasUpkeep && (!spell.system.duration?.unit || spell.system.duration.unit === "instant")) {
    errors.push("Upkeep spell has instant duration (invalid)");
  }
  
  // Check 7: AoE spells should have shape/size
  if (spell.system.rangeType === "aoe") {
    if (!spell.system.aoeShape || spell.system.aoeShape === "") {
      errors.push("AoE spell missing aoeShape");
    }
    if (!spell.system.aoeSize || spell.system.aoeSize <= 0) {
      errors.push("AoE spell missing or invalid aoeSize");
    }
  }
  
  // Check 8: Scaling levels validation
  if (spell.system.scaling?.levels && spell.system.scaling.levels.length > 0) {
    const scalingValidity = validateScalingLevels(spell.system.scaling.levels);
    if (!scalingValidity.valid) {
      errors.push(...scalingValidity.errors.map(e => `Scaling: ${e}`));
    }
  }
  
  // Check 9: Cost >= 0
  const cost = Number(spell.system.cost);
  if (!Number.isFinite(cost) || cost < 0) {
    errors.push("Invalid cost (must be >= 0)");
  }
  
  // Check 10: Level 1-7
  const level = Number(spell.system.level);
  if (!Number.isFinite(level) || level < 1 || level > 7) {
    errors.push("Invalid level (must be 1-7)");
  }
  
  return { errors, warnings };
}
```

**Expose on `game.uesrpg`** ([src/system.js](../../src/system.js)):
```javascript
import { auditSpellPack } from "./utils/dev/spell-audit.js";

game.uesrpg.auditSpellPack = auditSpellPack;
```

**Acceptance Criteria**:
- ✅ Can run `game.uesrpg.auditSpellPack("uesrpg-3ev4.spells-revised")` from console
- ✅ Returns report with errors and warnings per spell
- ✅ Detects all 10 validation rules listed above

#### 5.2 Create GM Audit Report UI (Optional)
**Goal**: Display audit report in user-friendly dialog instead of console

**Mockup**:
```javascript
/**
 * Display spell audit report in a dialog.
 * @param {string} packName
 */
export async function showSpellAuditReport(packName) {
  const report = await auditSpellPack(packName);
  
  if (report.error) {
    ui.notifications.error(report.error);
    return;
  }
  
  const issueCount = report.issues.length;
  const errorCount = report.issues.reduce((sum, i) => sum + i.errors.length, 0);
  const warningCount = report.issues.reduce((sum, i) => sum + i.warnings.length, 0);
  
  const content = `
    <h3>Spell Pack Audit: ${report.packName}</h3>
    <p><strong>Total Spells:</strong> ${report.totalSpells}</p>
    <p><strong>Spells with Issues:</strong> ${issueCount}</p>
    <p><strong>Errors:</strong> ${errorCount} | <strong>Warnings:</strong> ${warningCount}</p>
    <hr/>
    ${issueCount > 0 ? `
      <table style="width:100%; font-size:0.9em;">
        <thead>
          <tr>
            <th>Spell</th>
            <th>Errors</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          ${report.issues.map(issue => `
            <tr>
              <td>${issue.spell}</td>
              <td style="color:red;">${issue.errors.join('; ')}</td>
              <td style="color:orange;">${issue.warnings.join('; ')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p>No issues found!</p>'}
  `;
  
  new Dialog({
    title: "Spell Audit Report",
    content,
    buttons: {
      export: {
        icon: '<i class="fas fa-download"></i>',
        label: "Export JSON",
        callback: () => {
          const json = JSON.stringify(report, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          saveDataToFile(blob, "text/json", `spell-audit-${Date.now()}.json`);
        }
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: "Close"
      }
    },
    default: "close"
  }).render(true);
}

game.uesrpg.showSpellAuditReport = showSpellAuditReport;
```

**Acceptance Criteria**:
- ✅ Dialog displays summary (total spells, issue count, error/warning counts)
- ✅ Table lists all spells with issues
- ✅ Export button downloads JSON report
- ✅ Can run via `game.uesrpg.showSpellAuditReport("uesrpg-3ev4.spells-revised")`

---

## Phase 3 Testing & Acceptance

### Manual Test Checklist

**Test 1: Scaling UI Authoring**
1. Open spell item sheet (e.g., "Fireball")
2. Click "+" to add scaling level
3. Enter: Level 5, Cost 50, Damage 5d6, Duration "instant", Description "Enhanced blast"
4. Save and reload sheet
5. Verify entry persists
6. Click trash icon to delete entry
7. Verify deletion persists
**Expected**: All CRUD operations work, data persists

**Test 2: Variant Selection in Casting Dialog**
1. Create spell with 2 scaling levels (L1: 10 MP, L3: 30 MP)
2. From actor sheet, click "Cast Magic" on spell
3. Observe dialog shows variant selector dropdown
4. Select "Level 3"
5. Verify preview (if implemented) shows 30 MP cost
6. Confirm cast
7. Check chat card displays "Cast at Level 3"
8. Verify caster spent 30 MP (not base 10 MP)
**Expected**: Variant selection works, correct cost applied

**Test 3: Scroll Creation & Usage**
1. Create new item of type "scroll"
2. Enter spell UUID for "Lesser Ward" (L1 Restoration, 10 MP)
3. Set scribed level to 1
4. Set quantity to 3
5. Drag scroll to actor inventory
6. Click scroll cast button (or macro)
7. Verify spell casts without Magicka cost
8. Verify scroll quantity decrements to 2
9. Repeat until quantity = 0
10. Verify warning "No scrolls remaining"
**Expected**: Scroll casts spell, consumes quantity, costs 0 MP

**Test 4: Chat Card Enhancements**
1. Cast spell with variant selection (L3)
2. Verify chat card shows "Cast at Level 3"
3. Click "Details" toggle button
4. Verify card collapses to compact mode
5. Click again, verify expands
6. Enable debug setting `debugChatProfile`
7. Verify "Copy Profile" button appears
8. Click button, paste into text editor
9. Verify JSON contains spell profile data
**Expected**: All chat card features work

**Test 5: Spell Pack Audit**
1. Run `game.uesrpg.auditSpellPack("uesrpg-3ev4.spells-revised")` in console
2. Review console output (or dialog if UI implemented)
3. Verify spells with missing school flagged as errors
4. Verify Attack spells without damageFormula flagged as errors
5. Verify AoE spells without shape/size flagged as errors
6. Fix one error (e.g., add missing school to spell in compendium)
7. Re-run audit, verify error resolved
**Expected**: Audit detects all defined issues, report accurate

---

## Implementation Order & Timeline

**Week 1-2: Scaling UI & Variant Selection** (Tasks 1-2)
- Task 1.1: Add scaling table editor to spell sheet
- Task 1.2: Add scaling validation logic
- Task 2.1: Enhance spell options dialog with variant selector
- Task 2.2 (Optional): Add profile preview to dialog
- Testing: Manual tests 1-2

**Week 3-4: Scroll/Staff Wrappers** (Task 3)
- Task 3.1: Add "scroll" item type to schema
- Task 3.2: Create scroll item sheet template
- Task 3.3: Implement scroll casting workflow
- Task 3.4 (Optional): Staff item type (deferred if time-constrained)
- Testing: Manual test 3

**Week 5: Chat Card Enhancements** (Task 4)
- Prerequisites: Complete Phase 1 Task 4 (unified chat cards)
- Task 4.1: Add scaling level display to chat cards
- Task 4.2: Implement compact/expanded modes
- Task 4.3: Add copy profile debug button
- Testing: Manual test 4

**Week 6: GM Tooling & Testing** (Task 5)
- Task 5.1: Create spell audit utility
- Task 5.2: Create audit report UI dialog
- Testing: Manual test 5 + full regression testing

**Week 7: Documentation & Polish**
- Update `docs/Active Effect Wiki.md` with scroll/staff examples
- Create `SPELL_SCALING_GUIDE.md` for authors
- Create `SCROLL_STAFF_GUIDE.md` for GMs
- Record demo video (optional)

---

## Risks & Mitigation

**Risk 1: Phase 1/2 Dependencies Not Complete**
- **Impact**: HIGH - Cannot implement scrolls/staves if base casting ingress not unified
- **Mitigation**: Prioritize completing Phase 1 Task 3.2 (entry point refactoring) before starting Phase 3 Task 3
- **Contingency**: Implement scroll/staff as separate code paths (technical debt)

**Risk 2: Scaling UI Complexity**
- **Impact**: MEDIUM - Table editor with add/delete requires careful state management
- **Mitigation**: Use existing Foundry patterns (similar to Active Effects editor)
- **Contingency**: Simplified UI with manual JSON editing (worse UX but functional)

**Risk 3: Scroll/Staff RAW Ambiguity**
- **Impact**: MEDIUM - If Chapter 6 doesn't define scroll/staff rules, design decisions subjective
- **Mitigation**: Research RAW, consult with system maintainer, make conservative choices
- **Contingency**: Mark as "homebrew extension" in documentation

**Risk 4: Chat Card Unification Blocker**
- **Impact**: LOW - Task 4 can be deferred if Phase 1 Task 4 incomplete
- **Mitigation**: Task 4 marked as lowest priority
- **Contingency**: Skip Task 4 entirely, focus on functional features (Tasks 1-3, 5)

---

## Success Metrics

- ✅ Spell scaling table editor functional with validation (Task 1)
- ✅ Variant selection works in casting dialog, correct costs applied (Task 2)
- ✅ Scroll item type exists, casting works via SpellCastingService, quantity consumed (Task 3)
- ✅ Chat cards display scaling level (Task 4.1)
- ✅ Spell audit tool detects all defined validation rules (Task 5)
- ✅ All 5 manual tests pass without errors
- ✅ No regressions in Phase 1/2 functionality
- ✅ Documentation complete for new features

---

## Post-Phase 3 Handoff

**Deliverables**:
- Scaling table editor UI ([templates/spell-sheet.html](../../templates/spell-sheet.html), [src/core/magic/scaling-validator.js](../../src/core/magic/scaling-validator.js))
- Variant selection in casting dialog ([src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js))
- Scroll item type, sheet, and casting workflow ([template.json](../../template.json), [templates/scroll-sheet.html](../../templates/scroll-sheet.html), [src/core/magic/scroll-casting.js](../../src/core/magic/scroll-casting.js))
- GM spell audit utility ([src/utils/dev/spell-audit.js](../../src/utils/dev/spell-audit.js))
- Enhanced chat cards with scaling display (Task 4 files)
- Documentation: `SPELL_SCALING_GUIDE.md`, `SCROLL_STAFF_GUIDE.md`

**Phase 4 Readiness** (Future Enhancements):
- Staff item type (charges + embedded spells)
- Enchanting container patterns (weapon/armor spell effects)
- Advanced scaling authoring (formula builders, visual editors)
- Compendium browser integration for scroll creation
- Ritual casting mechanics (extended casting times)

---

## Appendix: Code Archaeology

### Existing Scaling Implementation

**Schema** ([template.json](../../template.json) ~line 1200):
```json
"spell": {
  "scaling": {
    "levels": [
      {
        "level": 1,
        "cost": 10,
        "damageFormula": "1d6",
        "duration": { "value": 1, "unit": "rounds" },
        "description": "Base effect"
      }
    ]
  }
}
```

**Profile Resolver** ([src/core/magic/spell-profile.js](../../src/core/magic/spell-profile.js) lines 313-326):
```javascript
function _resolveScaling(spell, options = {}) {
  const levels = spell?.system?.scaling?.levels ?? [];
  const hasScaling = Array.isArray(levels) && levels.length > 0;
  const currentLevel = getSpellScalingEntry(spell, options.level ?? null);
  
  return {
    levels,
    currentLevel,
    hasScaling
  };
}
```

**Scaling Entry Getter** ([src/core/magic/magicka-utils.js](../../src/core/magic/magicka-utils.js) lines 120-130):
```javascript
export function getSpellScalingEntry(spell, level = null) {
  const levels = spell?.system?.scaling?.levels;
  if (!Array.isArray(levels) || levels.length === 0) return null;
  if (level === null) return null;
  return levels.find(entry => entry.level === level) ?? null;
}
```

### Existing Item Type Patterns

**Container Item** ([templates/container-sheet.html](../../templates/container-sheet.html)):
- Uses drag-drop for adding items
- Containment logic in [src/ui/sheets/item/listeners/containment.js](../../src/ui/sheets/item/listeners/containment.js)
- Pattern: Parent-child item relationships using `flags` for storage

**Ammunition Item** ([templates/ammunition-sheet.html](../../templates/ammunition-sheet.html)):
- Consumable pattern: decrements quantity on use
- Integrated with weapon sheet for ammo selection
- Pattern: Quantity tracking + consumption hooks

**Scroll/Staff Pattern**:
- Hybrid approach: Containment (embedded spell reference) + Consumable (quantity/charges)
- Scroll: One spell, consumed on use
- Staff: Multiple spells, charges depleted per cast

---

## Appendix: Validation Reference

### Scaling Validation Rules (Task 1.2)

| Rule | Type | Check | Error Message |
|------|------|-------|---------------|
| 1 | ERROR | `level` in range 1-7 | "Level must be 1-7" |
| 2 | ERROR | `level` unique within array | "Duplicate scaling level: X" |
| 3 | ERROR | `cost >= 0` | "Cost must be >= 0" |
| 4 | WARNING | Damage spell → all scaling entries have `damageFormula` | "Scaling entry missing damage formula" |
| 5 | WARNING | Duration consistency (unit matches base) | "Duration unit mismatch" |

### Spell Audit Rules (Task 5.1)

| Rule # | Type | Field | Check | Fix Suggestion |
|--------|------|-------|-------|----------------|
| 1 | ERROR | `school` | Not empty | "Add school: Alteration/Conjuration/Destruction/Illusion/Mysticism/Necromancy/Restoration" |
| 2 | ERROR | `type` | Not empty | "Add type: Attack/Direct/Healing" |
| 3 | WARNING | `form` | Not empty | "Add form: Conventional/Unconventional (defaults to Conventional)" |
| 4 | ERROR | `damageFormula` (Attack) | Exists when `type=Attack` | "Add damageFormula for Attack spell" |
| 5 | WARNING | `damageFormula` (Healing) | Exists when `type=Healing` | "Add damageFormula (healing amount) for Healing spell" |
| 6 | ERROR | `duration.unit` (Upkeep) | Not "instant" when `hasUpkeep=true` | "Set duration to rounds/minutes/hours/days for upkeep spell" |
| 7 | ERROR | `aoeShape` (AoE) | Exists when `rangeType=aoe` | "Add aoeShape: circle/cone/ray/rect/pulse" |
| 8 | ERROR | `aoeSize` (AoE) | `> 0` when `rangeType=aoe` | "Add aoeSize > 0" |
| 9 | ERROR | `scaling.levels` | Passes validation rules 1-5 | "Fix scaling table (see error details)" |
| 10 | ERROR | `cost` | `>= 0` | "Set cost >= 0" |
| 11 | ERROR | `level` | In range 1-7 | "Set level 1-7" |

---

## End of Roadmap
