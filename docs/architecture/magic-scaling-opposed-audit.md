# Magic Scaling Selection in Opposed Workflow — Code Audit

**Created:** 2026-02-06  
**Target:** UESRPG 3ev4 (Foundry VTT v13.351)  
**Scope:** Scaling level selection in opposed magic casting workflow

---

## Executive Summary

The opposed magic casting workflow **does call** the spell options dialog that **should** show scaling level selection, but users report the dropdown doesn't appear or selection doesn't persist. This audit maps the complete call chain and identifies potential failure points.

---

## 1. Call Chain: Targeted Spell Cast → Scaling Selection → Opposed Workflow

### 1.1 Entry Point (Actor Sheet / Token HUD)

**File:** [src/ui/sheets/shared/listeners/rolls.js](../../src/ui/sheets/shared/listeners/rolls.js#L370-L395)

```javascript
// Line 370: onSpellRoll handler
async function onSpellRoll(event) {
  const spellToCast = /* resolve from click event */;
  const targets = getUserSpellTargets();
  
  // Line 381: Check if spell should use targeted workflow (opposed)
  if (shouldUseTargetedSpellWorkflow(spellToCast, targets)) {
    // ✅ Dialog IS being called here
    const spellOptions = await sheet._showSpellOptionsDialog(spellToCast);
    if (spellOptions === null) return;
    
    // Line 384: Pass spellOptions to opposed workflow
    await sheet._castAttackSpell(spellToCast, targets, spellOptions, "primary");
    return;
  }
  
  // Line 388: Unopposed workflow (self-cast, no targets)
  if (shouldUseModernSpellWorkflow(spellToCast)) {
    const spellOptions = await sheet._showSpellOptionsDialog(spellToCast);
    // ...
    await MagicOpposedWorkflow.castUnopposed({ spellOptions });
  }
}
```

**Conclusion:** The dialog IS called for both opposed and unopposed workflows. No branching issue here.

---

### 1.2 Spell Options Dialog (Scaling Level Dropdown Logic)

**File:** [src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js#L259-L575)

```javascript
// Line 259: showSpellOptionsDialog
export async function showSpellOptionsDialog(actor, spell) {
  const baseCost = Number(spell.system?.cost ?? 0);
  const baseLevel = spell.system?.level ?? 1;
  
  // Line 279: Canonical scaling reader
  const allScalingLevels = getSpellScalingLevels(spell);
  
  // Line 296-315: Filter to ONLY levels DIFFERENT from base level
  const scalingLevels = Array.isArray(allScalingLevels) 
    ? allScalingLevels.filter(entry => {
        const lvl = Number(entry?.level ?? 0);
        const isValid = Number.isFinite(lvl) && lvl !== baseLevel && lvl > 0;
        return isValid;
      })
    : [];
  
  // Line 318: Dropdown only shown if filtered array is non-empty
  const hasScaling = scalingLevels.length > 0;
  
  // Line 339-350: Scaling dropdown HTML (conditional rendering)
  ${hasScaling ? `
    <div class="form-group">
      <label><b>Cast at Level</b></label>
      <select name="castLevel" id="castLevelSelect">
        <option value="${baseLevel}">Base (Level ${baseLevel}, ${baseCost} MP)</option>
        ${scalingLevels.map(entry => {
          const lvl = entry.level ?? 1;
          const cost = entry.cost ?? baseCost;
          const dmg = entry.damageFormula ? `, ${entry.damageFormula}` : '';
          return `<option value="${lvl}">Level ${lvl} (${cost} MP${dmg})</option>`;
        }).join('')}
      </select>
    </div>
  ` : ''}
  
  // Line 420-453: Return spellOptions with castLevel
  return {
    isRestrained: /* ... */,
    isOverloaded: /* ... */,
    castLevel: hasScaling ? parseInt(form?.castLevel?.value) : null, // ← Returned here
    // ...
  };
}
```

**Potential Failure Point #1: Filter Logic**
- If all scaling entries have `entry.level === baseLevel`, the filter returns empty array → `hasScaling = false` → no dropdown shown
- If scaling levels aren't properly defined in spell item data, dropdown won't appear

**Potential Failure Point #2: Data Model Mismatch**
- If spell.system.scaling.levels is not an array (e.g., object, null, undefined), filter returns empty array

---

### 1.3 Canonical Scaling Reader

**File:** [src/core/magic/magicka-utils.js](../../src/core/magic/magicka-utils.js#L122-L193)

```javascript
// Line 122: getSpellScalingLevels
export function getSpellScalingLevels(spell) {
  const candidates = [
    spell?.system?.scaling?.levels,
    spell?.system?.scalingLevels,
    spell?.system?.scaling
  ];

  const rows = [];

  const collect = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach((entry, idx) => {
        if (!entry || typeof entry !== "object") return;
        const explicit = Number(entry?.level);
        // ⚠️ If entry.level is missing, infer level from index (idx + 1)
        const level = Number.isFinite(explicit) && explicit > 0 ? explicit : (idx + 1);
        rows.push({ ...entry, level, __inferredLevel: !(Number.isFinite(explicit) && explicit > 0) });
      });
      return;
    }

    // ... handle other data shapes (objects, Maps, etc.) ...
  };

  for (const c of candidates) {
    if (!rows.length) collect(c);
  }

  // Sort by level ascending
  return rows.sort((a, b) => Number(a.level) - Number(b.level));
}
```

**Potential Failure Point #3: Level Inference**
- If spell has 1 scaling entry with no explicit `level` field, it's inferred as level 1
- If base spell is also level 1, filter excludes it (lvl === baseLevel)
- Result: No eligible scaling levels → no dropdown

---

### 1.4 Opposed Workflow Entry (castAttackSpell)

**File:** [src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js#L578-L614)

```javascript
// Line 578: castAttackSpell
export async function castAttackSpell(sheet, spell, targets, spellOptions = null, ...) {
  const defenderTokenUuids = Array.from(targets ?? [])
    .map(t => t?.document?.uuid ?? t?.uuid)
    .filter(Boolean);

  // Line 603: Pass spellOptions directly to opposed workflow
  await MagicOpposedWorkflow.createPending({
    attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
    defenderTokenUuids,
    spellUuid: spell?.uuid ?? null,
    spellOptions: spellOptions ?? undefined, // ← Passed here
    castActionType,
    // ...
  });
}
```

**Finding:** `spellOptions` (including `castLevel`) is passed directly to opposed workflow. No filtering or transformation here.

---

### 1.5 Opposed Workflow Message Storage

**File:** [src/core/magic/opposed-workflow.js](../../src/core/magic/opposed-workflow.js#L37-L195)

```javascript
// Line 37: MagicOpposedWorkflow.createPending
async createPending(cfg = {}) {
  let spell = await fromUuid(cfg.spellUuid);
  let spellOptions = cfg.spellOptions ?? {};
  let tn = computeMagicCastingTN(attacker, spell, spellOptions); // ← Uses spellOptions
  
  // Line 146-180: Build message data structure
  const data = {
    context: { /* ... */ },
    attacker: {
      actorUuid: attacker.uuid,
      spellUuid: spell?.uuid ?? null,
      spellOptions: deferSpellChoice ? null : spellOptions, // ← Stored here
      castActionType: String(cfg.castActionType ?? "primary"),
      // ...
    },
    defenders: [ /* ... */ ],
    // ...
  };

  // Line 189: Persist to ChatMessage flags
  const message = await ChatMessage.create({
    content: renderCard(data, ""),
    flags: { 
      [_FLAG_NS]: { 
        [_FLAG_KEY]: { 
          version: _CARD_VERSION, 
          state: data // ← spellOptions buried inside data.attacker.spellOptions
        } 
      } 
    },
  });
}
```

**Finding:** `spellOptions.castLevel` is stored in `message.flags['uesrpg-3ev4'].magicOpposed.state.attacker.spellOptions.castLevel`.

---

### 1.6 Opposed Workflow Rendering (Chat Card Display)

**File:** [src/core/magic/opposed/render.js](../../src/core/magic/opposed/render.js#L498-L527)

```javascript
// Line 498: Extract castLevel from attacker state
const castLevel = a.spellOptions?.castLevel;
const castLevelLine = (castLevel != null && castLevel !== spellLevel)
  ? `<div style="color:#8a2be2; font-weight:bold;">Cast at Level ${castLevel}</div>`
  : '';

// Line 527: Display in chat card
<div><b>Level:</b> ${spellLevel}</div>${castLevelLine}
```

**Finding:** Card DOES display "Cast at Level X" if `spellOptions.castLevel` is present and different from base.

---

### 1.7 Deferred Spell Selection (Banked Mode)

**File:** [src/core/magic/opposed/actions/attacker.js](../../src/core/magic/opposed/actions/attacker.js#L66-L230)

```javascript
// Line 66: promptCastingCommitChoice (used in banked/deferred mode)
async function promptCastingCommitChoice(attacker, attackerState = {}) {
  // ... builds spell pool, shows dialog ...
  
  // Line 83: Cast level dropdown (SEPARATE from showSpellOptionsDialog)
  <div class="form-group" id="ues-cast-level-group" style="display:none;">
    <label><b>Cast at Level</b></label>
    <select name="castLevel" id="ues-cast-level"></select>
  </div>
  
  // Line 135-150: Extract and return castLevel
  callback: (html) => {
    const levelRaw = Number(root?.querySelector('select[name="castLevel"]')?.value ?? baseLevel);
    const castLevel = Number.isFinite(levelRaw) && levelRaw > 0 ? levelRaw : baseLevel;
    
    resolve({
      spell: selectedSpell,
      spellOptions: {
        // ...
        castLevel,
        level: castLevel // ← Also stored as 'level' for compatibility
      }
    });
  }
  
  // Line 166-195: render callback - populate scaling levels on spell change
  render: (html) => {
    const rebuildForSpell = () => {
      const levels = getSpellScalingLevels(selectedSpell)
        .filter((entry) => Number(entry.level) !== baseLevel)
        .sort((a, b) => Number(a.level) - Number(b.level));
      
      if (castLevelSelect) {
        const levelOptions = [
          `<option value="${baseLevel}">Base (Level ${baseLevel}, ${baseCost} MP)</option>`,
          ...levels.map(entry => /* ... */)
        ];
        castLevelSelect.innerHTML = levelOptions.join("");
      }
      
      if (castLevelGroup) {
        castLevelGroup.style.display = levels.length ? "" : "none"; // ← Hidden if no scaling
      }
    };
    
    spellSelect.addEventListener("change", rebuildForSpell);
    rebuildForSpell(); // ← Initial population
  }
}
```

**Finding:** Banked mode uses a **separate dialog** (`promptCastingCommitChoice`) with its own scaling dropdown logic. Same filter rule applies: `levels.filter(entry => entry.level !== baseLevel)`.

---

## 2. Scaling Selection Object: Canonical Contract

### 2.1 Current Implementation (Scattered Keys)

| Location | Key Used | Notes |
|----------|----------|-------|
| `showSpellOptionsDialog` return | `castLevel` | Returned from non-banked opposed/unopposed dialog |
| `promptCastingCommitChoice` return | `castLevel` AND `level` | Banked commit dialog returns both keys |
| `magicka-utils.js` functions | `options.level` | Used by cost/damage/TN computation |
| `spell-profile.js` resolver | `options.level` | Used to select scaling entry |
| Opposed workflow storage | `spellOptions.castLevel` | Stored in message flags |
| Opposed render | `a.spellOptions?.castLevel` | Read for display |

**Problem:** Dual keys (`castLevel` vs `level`) create ambiguity. Some downstream functions expect `options.level`, others read `options.castLevel`.

### 2.2 Resolution Logic (spell-helpers.js)

**File:** [src/core/magic/opposed/spell-helpers.js](../../src/core/magic/opposed/spell-helpers.js#L102-L105)

```javascript
// Line 102: Map castLevel → level for downstream functions
const profile = resolveSpellProfile(spell, caster, {
  isRestrained: spellOptions?.isRestrained,
  isOverloaded: spellOptions?.isOverloaded,
  level: spellOptions?.castLevel ?? spellOptions?.level ?? null // ← Unified here
});
```

**Finding:** The `spell-helpers.js` module already attempts to unify the keys by preferring `castLevel`, falling back to `level`.

---

## 3. Root Cause Hypothesis

Based on the code audit, the most likely failure modes are:

### **Hypothesis A: Eligible Scaling Levels Filtered Out (Most Likely)**

**Cause:**
- Spell item has scaling levels defined, BUT all entries have `entry.level === baseLevel` (e.g., a level 1 spell with one scaling entry also marked as level 1)
- Filter rule `lvl !== baseLevel` excludes all entries
- Result: `hasScaling = false`, no dropdown shown

**Test:**
- Inspect spell item's `system.scaling.levels` array
- Check if any `entry.level` differs from `spell.system.level`

**Fix:**
- Do NOT filter out base level entry; instead, always include all defined levels
- OR: Change filter to `lvl > 0` (allow selecting base level explicitly in dropdown)

---

### **Hypothesis B: Scaling Levels Not Properly Defined in Spell Item**

**Cause:**
- Spell has no `system.scaling.levels` array, OR array is empty, OR entries are malformed
- `getSpellScalingLevels` returns empty array
- Result: `hasScaling = false`

**Test:**
- Check spell item template/schema
- Verify authoring workflow populates `system.scaling.levels` correctly

**Fix:**
- Ensure spell authoring UI creates valid scaling entries
- Add validation to prevent empty/malformed entries

---

### **Hypothesis C: Dialog State Reset on Rerender (Less Likely)**

**Cause:**
- User selects scaling level, but dialog rerenders (e.g., from live preview update) and loses selection
- Foundry Dialog class doesn't preserve form state across rerenders

**Test:**
- Open dialog, select level 2, verify selection persists after preview updates

**Fix:**
- Use `preventRender: true` for form updates (already used in item sheet, not in this dialog)
- OR: Persist selection in a closure variable scoped to the dialog instance

---

### **Hypothesis D: Scaling Selection Not Used by Opposed Workflow (Unlikely)**

**Cause:**
- `spellOptions.castLevel` is stored but ignored by TN/cost/damage computation
- Workflow always uses base level regardless of selection

**Test:**
- Cast spell at level 2, check if cost/damage/TN reflect level 2 values

**Fix:**
- Ensure `computeMagicCastingTN`, `computeSpellAttemptMagickaCost`, `computeSpellDamageShared` all accept and use `spellOptions.level` (aliased from `castLevel`)

---

## 4. File Index

### 4.1 Scaling Selection & Display

| File | Role | Key Functions |
|------|------|---------------|
| [src/ui/sheets/shared/listeners/magic-cast.js](../../src/ui/sheets/shared/listeners/magic-cast.js) | **Main spell dialog** | `showSpellOptionsDialog()` — renders scaling dropdown, returns `castLevel` |
| [src/core/magic/opposed/actions/attacker.js](../../src/core/magic/opposed/actions/attacker.js) | **Banked commit dialog** | `promptCastingCommitChoice()` — separate dialog with own scaling dropdown |
| [src/core/magic/magicka-utils.js](../../src/core/magic/magicka-utils.js) | **Canonical scaling reader** | `getSpellScalingLevels(spell)` — normalizes multiple data shapes to array |
| [src/ui/sheets/item/prepare.js](../../src/ui/sheets/item/prepare.js#L40-L50) | **Item sheet data prep** | Normalizes scaling levels for editing UI |

### 4.2 Opposed Workflow Orchestration

| File | Role |
|------|------|
| [src/core/magic/opposed-workflow.js](../../src/core/magic/opposed-workflow.js) | Main facade, `createPending()` stores `spellOptions` in message flags |
| [src/core/magic/opposed/spell-helpers.js](../../src/core/magic/opposed/spell-helpers.js) | Maps `castLevel` → `level` for profile resolver |
| [src/core/magic/opposed/render.js](../../src/core/magic/opposed/render.js) | Renders chat card, displays "Cast at Level X" |

### 4.3 Spell Profile Resolution

| File | Role |
|------|------|
| [src/core/magic/spell-profile.js](../../src/core/magic/spell-profile.js) | `resolveSpellProfile(spell, actor, { level })` — master resolver |
| [src/core/magic/magicka-utils.js](../../src/core/magic/magicka-utils.js) | `getSpellScalingEntry(spell, level)` — finds specific level entry |
| [src/core/magic/magicka-utils.js](../../src/core/magic/magicka-utils.js) | `getSpellCost(spell, level)`, `getSpellDamageFormula(spell, level)` — use scaling or base |

### 4.4 Entry Points (Where Dialog is Called)

| File | Context | Line |
|------|---------|------|
| [src/ui/sheets/shared/listeners/rolls.js](../../src/ui/sheets/shared/listeners/rolls.js#L382) | Spell hotbar click (targeted) | `const spellOptions = await sheet._showSpellOptionsDialog(spellToCast);` |
| [src/ui/sheets/shared/listeners/rolls.js](../../src/ui/sheets/shared/listeners/rolls.js#L388) | Spell hotbar click (self-cast) | `const spellOptions = await sheet._showSpellOptionsDialog(spellToCast);` |
| [src/ui/sheets/npc-sheet.js](../../src/ui/sheets/npc-sheet.js#L324) | NPC sheet wrapper | `_showSpellOptionsDialog(spell)` → delegates to shared |
| [src/ui/sheets/actor-sheet.js](../../src/ui/sheets/actor-sheet.js) | Actor sheet wrapper | (same pattern) |

---

## 5. Next Steps

1. **Reproduce bug**: Create test spell with scaling levels, attempt opposed cast, verify dropdown doesn't appear
2. **Inspect spell data**: Check `item.system.scaling.levels` structure of failing spell
3. **Confirm hypothesis**: Log `allScalingLevels`, `scalingLevels`, `hasScaling` in dialog
4. **Implement fix**: Adjust filter logic or spell authoring validation
5. **Test coverage**: Verify opposed, unopposed, banked modes all work with scaling selection
6. **Document**: Update test checklist and implementation summary

---

## 6. Hard Stop Conditions (Per Task Brief)

- [x] **Can identify canonical scaling selection contract**: YES — `spellOptions.castLevel` (aliased to `level` in some contexts)
- [x] **No schema-breaking changes needed**: YES — all needed fields already exist
- [x] **Single pipeline for opposed/unopposed**: YES — both use `showSpellOptionsDialog()`; banked mode uses separate but equivalent dialog

**Conclusion:** No hard stop triggered. Proceeding to reproduction and fix implementation.
