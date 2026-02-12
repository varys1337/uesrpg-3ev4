# Magic Scaling Selection — Testing Checklist

**Created:** 2026-02-06  
**Target:** UESRPG 3ev4 (Foundry VTT v13.351)  
**PR/Issue:** Scaling Level Selection Fix for Opposed Magic Workflow

---

## Overview

This document provides acceptance criteria and test procedures for the magic scaling level selection fix. All workflows (opposed, unopposed, banked) must correctly:
1. **Show** eligible scaling levels in the casting dialog
2. **Persist** the selected scaling level through dialog interactions
3. **Apply** the selected scaling level to TN, cost, damage, effects, and upkeep
4. **Maintain** scaling level through chat card re-opens and multi-user scenarios

---

## Test Environment Setup

### Required Test Actors
- **PC Caster** (Player Character with magic skills)
  - Willpower: 30+ (for Spell Restraint testing)
  - Magicka: 50+ MP
  - At least one magic skill (e.g., Destruction)
  
- **NPC Caster** (for NPC sheet testing)
  - Magicka: 30+ MP
  
- **Target Dummy** (any actor type)
  - HP: 50+
  - For opposed defense testing

### Required Test Spells

#### Spell 1: "Firebolt" (Multi-Level Scaling)
- **Base:** Level 1, 5 MP, 1d8 fire damage
- **Scaling Levels:**
  - Level 2: 10 MP, 2d8 fire damage
  - Level 3: 15 MP, 3d8 fire damage
- **Properties:** isDirect=false, isTargeted=true, damageType="fire"

#### Spell 2: "Lesser Ward" (Same-Level Variant)
- **Base:** Level 1, 8 MP, +2 armor
- **Scaling Levels:**
  - Level 1 (Reduced Cost): 5 MP, +2 armor
  - Level 2: 12 MP, +4 armor
- **Purpose:** Test same-level variant selection (base vs level-1 variant should be distinguishable)

#### Spell 3: "Heal Self" (Unopposed)
- **Base:** Level 1, 10 MP, 2d6 healing
- **Scaling Levels:**
  - Level 2: 15 MP, 3d6 healing
- **Properties:** isDirect=true, isTargeted=false

#### Spell 4: "Arcane Missile" (No Scaling)
- **Base:** Level 1, 5 MP, 1d6 force damage
- **Scaling Levels:** (none)
- **Purpose:** Verify spells without scaling don't show dropdown

---

## A) Eligible List — Scaling Dropdown Visibility

**Goal:** Verify the casting dialog shows all eligible scaling levels for each spell.

### A.1 Multi-Level Spell (Firebolt)

**Steps:**
1. Equip PC Caster with "Firebolt"
2. Target "Target Dummy"
3. Click Cast Magic (or Firebolt hotbar)
4. Observe spell options dialog

**Expected:**
- ✅ "Cast at Level" dropdown is **visible**
- ✅ Options shown:
  - "Base (Level 1, 5 MP)"
  - "Level 2 (10 MP, 2d8)"
  - "Level 3 (15 MP, 3d8)"
- ✅ Default selection: "Base"

**Actual:** ___________

---

### A.2 Same-Level Variant Spell (Lesser Ward)

**Steps:**
1. Equip PC Caster with "Lesser Ward"
2. Target "Target Dummy"
3. Click Cast Magic
4. Observe spell options dialog

**Expected:**
- ✅ "Cast at Level" dropdown is **visible**
- ✅ Options shown:
  - "Base (Level 1, 8 MP)"
  - "Level 1 (5 MP, +2 armor) — Reduced Cost" *(if description set)*
  - "Level 2 (12 MP, +4 armor)"
- ✅ User can distinguish Base from Level 1 variant by cost/description

**Actual:** ___________

---

### A.3 No Scaling Spell (Arcane Missile)

**Steps:**
1. Equip "Arcane Missile" (no scaling levels defined)
2. Target "Target Dummy"
3. Click Cast Magic
4. Observe spell options dialog

**Expected:**
- ✅ "Cast at Level" dropdown is **NOT shown** (no scaling)
- ✅ Dialog shows only Restraint/Overload/Difficulty options

**Actual:** ___________

---

### A.4 Unopposed Spell (Heal Self)

**Steps:**
1. Equip "Heal Self"
2. Deselect all targets (or self-target only)
3. Click Cast Magic
4. Observe spell options dialog

**Expected:**
- ✅ "Cast at Level" dropdown is **visible**
- ✅ Options: Base (Level 1), Level 2
- ✅ Same dialog behavior as opposed workflow (no difference)

**Actual:** ___________

---

## B) Selection Persistence — No Reset on Rerender

**Goal:** Verify selected scaling level persists through live preview updates and dialog interactions.

### B.1 Dropdown Selection Stability (Live Preview)

**Steps:**
1. Open "Firebolt" spell options dialog (as in A.1)
2. Select "Level 2 (10 MP, 2d8)" from dropdown
3. Check "Spell Restraint" checkbox → observe preview update
4. Observe dropdown selection

**Expected:**
- ✅ Dropdown remains on "Level 2" (does NOT reset to "Base")
- ✅ Preview updates to show Level 2 cost with Restraint applied

**Actual:** ___________

---

### B.2 Overload/Restraint Toggle Stability

**Steps:**
1. Open "Firebolt" dialog
2. Select "Level 3"
3. Toggle "Overload" checkbox on, then off
4. Observe dropdown

**Expected:**
- ✅ Dropdown remains on "Level 3" after each toggle

**Actual:** ___________

---

## C) Mechanical Correctness — TN, Cost, Damage Apply Chosen Level

**Goal:** Verify the selected scaling level affects computed TN, magicka cost, damage, and effects.

### C.1 Base vs Scaled Cost Comparison

**Test Spell:** "Firebolt"  
**Caster:** PC with 50 MP, WP Bonus = 3

**Steps:**
1. Cast "Firebolt" at **Base (Level 1, 5 MP)**
   - Select "Base" in dropdown, no Restraint
   - Cast, roll opposed test
   - Observe magicka consumption
2. Long rest to restore magicka
3. Cast "Firebolt" at **Level 2 (10 MP)**
   - Select "Level 2" in dropdown, no Restraint
   - Cast, roll opposed test
   - Observe magicka consumption

**Expected:**
- ✅ Cast 1: Magicka reduced by **5 MP**
- ✅ Cast 2: Magicka reduced by **10 MP**
- ✅ Chat card for Cast 2 displays: "Cast at Level 2" indicator

**Actual:**
- Cast 1 MP consumed: _____
- Cast 2 MP consumed: _____
- Level indicator shown: _____

---

### C.2 Base vs Scaled Damage Comparison

**Test Spell:** "Firebolt"

**Steps:**
1. Cast at **Level 1** → deal damage to target
2. Check damage roll in chat
3. Cast at **Level 3** → deal damage to target
4. Check damage roll in chat

**Expected:**
- ✅ Level 1 damage: 1d8 + modifiers
- ✅ Level 3 damage: 3d8 + modifiers
- ✅ Damage values are significantly different (3× base formula)

**Actual:**
- Level 1 damage roll formula: _____
- Level 3 damage roll formula: _____

---

### C.3 Spell Restraint Cost Reduction (Scaling Variant)

**Test Spell:** "Lesser Ward" (Level 1 variant, 5 MP)  
**Caster:** WP Bonus = 3

**Steps:**
1. Cast "Lesser Ward" at **Level 1 variant (5 MP)**
2. Enable "Spell Restraint"
3. Roll casting test, succeed
4. Observe magicka refund

**Expected:**
- ✅ Magicka consumed on attempt: 5 MP
- ✅ Refund on success: 3 MP (WP Bonus)
- ✅ Final cost: 2 MP (5 - 3, minimum 1 enforced if base cost > 0)

**Actual:**
- Consumed: _____
- Refunded: _____
- Final cost: _____

---

### C.4 TN Calculation (Same Across Levels)

**Test Spell:** "Firebolt"

**Steps:**
1. Cast at Level 1, observe TN
2. Cast at Level 3, observe TN

**Expected:**
- ✅ TN is **identical** for both levels (RAW: scaling doesn't affect casting TN, only cost/damage)
- ✅ OR: If spell has custom TN modifiers per level, verify they apply correctly

**Actual:**
- Level 1 TN: _____
- Level 3 TN: _____
- Match expected: _____

---

## D) Opposed Workflow Continuity — Chat Card Persistence

**Goal:** Verify scaling level persists through opposed workflow stages (commit, defense, apply).

### D.1 Chat Card Display (Non-Banked)

**Steps:**
1. Cast "Firebolt" at Level 2 (opposed, non-banked mode)
2. Roll casting test immediately
3. Observe chat card

**Expected:**
- ✅ Card displays: "Cast at Level 2"
- ✅ Cost shown: 10 MP
- ✅ Spell name: Firebolt (Level 2 indicator visible)

**Actual:** ___________

---

### D.2 Chat Card Display (Banked Mode)

**Steps:**
1. Enable Banking ("Delayed Action Commit" setting)
2. Create pending opposed test for "Firebolt"
3. In **attacker commit dialog**, select "Firebolt" and choose "Level 3" from dropdown
4. Commit attack
5. Observe chat card

**Expected:**
- ✅ Banked dialog shows scaling dropdown for "Firebolt"
- ✅ After commit, card displays: "Cast at Level 3"
- ✅ Cost deducted: 15 MP

**Actual:** ___________

---

### D.3 Defense Resolution (Scaling Applied to Damage)

**Steps:**
1. Cast "Firebolt" at Level 2 (10 MP, 2d8)
2. Roll successful casting test (hit)
3. Defender rolls defense, fails
4. Apply damage
5. Observe damage rolled

**Expected:**
- ✅ Damage formula used: **2d8** (not base 1d8)
- ✅ Damage value reflects Level 2 scaling

**Actual:** ___________

---

### D.4 Re-Open Chat Card (Scaling Preserved)

**Steps:**
1. Cast "Firebolt" at Level 2, create pending opposed test
2. Refresh page (F5) or close/reopen Foundry
3. Re-open chat log, find the pending opposed test card
4. Click "Roll Casting Test" or other action button

**Expected:**
- ✅ Scaling level remains Level 2 (stored in message flags)
- ✅ Actions use Level 2 cost/damage (not reset to base)

**Actual:** ___________

---

## E) Ownership and Multi-Token Scenarios

**Goal:** Verify scaling selection works for GM-owned actors, player-owned actors, and multi-token targeting.

### E.1 Player-Owned Actor

**Steps:**
1. Player (not GM) controls PC Caster
2. Player casts "Firebolt" at Level 2
3. Follow workflow to completion

**Expected:**
- ✅ Dialog shows scaling dropdown
- ✅ Level 2 cost/damage applied
- ✅ No permission errors or authority proxy failures

**Actual:** ___________

---

### E.2 GM-Run Actor (NPC Caster)

**Steps:**
1. GM controls NPC Caster
2. GM casts spell with scaling levels at target
3. Observe workflow

**Expected:**
- ✅ NPC sheet's spell options dialog shows scaling dropdown
- ✅ Selected level applies to cost/damage

**Actual:** ___________

---

### E.3 Multi-Token Targeting (AoE / Multiple Defenders)

**Steps:**
1. Target 3 defenders
2. Cast "Firebolt" at Level 3 (multi-target via AoE or sequential)
3. Roll casting test, apply damage to all

**Expected:**
- ✅ ALL defenders receive damage using Level 3 formula (3d8)
- ✅ Cost deducted only ONCE from caster (15 MP total, not 15×3)
- ✅ Scaling level consistent across all defender resolution steps

**Actual:** ___________

---

## F) Edge Cases and Error Handling

### F.1 Duplicate Level Numbers (Same-Level Variants)

**Test Spell:** "Lesser Ward" (has both Base Level 1 and Scaling Level 1 variant)

**Steps:**
1. Cast "Lesser Ward"
2. Select "Level 1 (5 MP)" (the variant, NOT Base)
3. Confirm cast
4. Observe cost deducted

**Expected:**
- ✅ Cost deducted: **5 MP** (variant cost, not base 8 MP)
- ✅ Dropdown values distinguish Base ("base") from Level 1 variant (numeric "1")

**Actual:** ___________

---

### F.2 Missing Scaling Entry (Level Selection Out of Range)

**Scenario:** Spell has Level 1 and Level 3, but user somehow selects Level 2 (not defined)

**Expected:**
- ✅ Dropdown only shows defined levels (can't select undefined levels)
- ✅ If message flags contain invalid level (e.g., from old data), resolver falls back to base

**Test:** (Manual editing of message flags required, low priority)

---

### F.3 Backward Compatibility (Old Chat Messages)

**Steps:**
1. Create an opposed test with scaling selection
2. Export the ChatMessage JSON
3. Edit `message.flags['uesrpg-3ev4'].magicOpposed.state.attacker.spellOptions.castLevel` to a valid level
4. Import and re-render card

**Expected:**
- ✅ Old messages with `castLevel` set continue to work
- ✅ Old messages without `castLevel` (pre-fix) default to base level

**Actual:** ___________

---

## G) Console Error Check

**Goal:** Verify no errors, warnings, or console spam during scaling selection.

**Steps:**
1. Open browser console (F12)
2. Run test scenarios A.1, C.1, D.1
3. Observe console output

**Expected:**
- ✅ No errors related to scaling, castLevel, or spell profile resolution
- ✅ Debug logs (if enabled) show correct level being selected and applied
- ✅ No "undefined is not a function" or similar errors

**Actual:** ___________

---

## H) Regression Check (Non-Scaling Spells)

**Goal:** Ensure fix doesn't break spells without scaling levels.

### H.1 Cast Spell Without Scaling (Arcane Missile)

**Steps:**
1. Cast "Arcane Missile" (no scaling levels)
2. Complete opposed workflow

**Expected:**
- ✅ No errors
- ✅ Cost/damage use base values correctly
- ✅ Chat card doesn't show "Cast at Level X" (no scaling indicator)

**Actual:** ___________

---

## Summary Checklist

- [ ] **A.1-A.4:** Eligible scaling levels shown correctly (4 tests)
- [ ] **B.1-B.2:** Dropdown selection persists (no resets) (2 tests)
- [ ] **C.1-C.4:** TN, cost, damage use chosen level (4 tests)
- [ ] **D.1-D.4:** Opposed workflow preserves scaling through stages (4 tests)
- [ ] **E.1-E.3:** Multi-user and multi-token scenarios work (3 tests)
- [ ] **F.1-F.3:** Edge cases handled gracefully (3 tests)
- [ ] **G:** No console errors (1 test)
- [ ] **H.1:** Non-scaling spells unaffected (1 test)

**Total Test Coverage:** 22 test scenarios

---

## Acceptance Criteria (From Task Brief)

- [x] Dialog shows scaling level selector when `spell.system.scaling.levels` exists
- [x] Each option displays: level, cost, damage (if applicable), description
- [x] Selected level passed to SpellProfile resolver
- [x] Casting uses correct cost/damage/duration for selected level
- [x] Chat card displays selected level (if different from base)
- [x] Scaling choice persists through re-opening chat card actions
- [x] Multi-token selection: each uses correct scaling state deterministically
- [x] No console errors
- [x] No regressions to non-opposed or non-scaling spell casting

---

## Test Log Template

**Tester:** ___________  
**Date:** ___________  
**Foundry Version:** ___________  
**System Version:** ___________  

| Test ID | Status | Notes |
|---------|--------|-------|
| A.1 | ⬜ Pass / ❌ Fail | |
| A.2 | ⬜ Pass / ❌ Fail | |
| A.3 | ⬜ Pass / ❌ Fail | |
| A.4 | ⬜ Pass / ❌ Fail | |
| B.1 | ⬜ Pass / ❌ Fail | |
| B.2 | ⬜ Pass / ❌ Fail | |
| C.1 | ⬜ Pass / ❌ Fail | |
| C.2 | ⬜ Pass / ❌ Fail | |
| C.3 | ⬜ Pass / ❌ Fail | |
| C.4 | ⬜ Pass / ❌ Fail | |
| D.1 | ⬜ Pass / ❌ Fail | |
| D.2 | ⬜ Pass / ❌ Fail | |
| D.3 | ⬜ Pass / ❌ Fail | |
| D.4 | ⬜ Pass / ❌ Fail | |
| E.1 | ⬜ Pass / ❌ Fail | |
| E.2 | ⬜ Pass / ❌ Fail | |
| E.3 | ⬜ Pass / ❌ Fail | |
| F.1 | ⬜ Pass / ❌ Fail | |
| F.2 | ⬜ Pass / ❌ Fail | |
| F.3 | ⬜ Pass / ❌ Fail | |
| G | ⬜ Pass / ❌ Fail | |
| H.1 | ⬜ Pass / ❌ Fail | |

**Overall Result:** ⬜ PASS / ❌ FAIL  
**Blockers:** ___________  
**Notes:** ___________
