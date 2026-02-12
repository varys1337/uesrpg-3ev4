# Spells — Regression Test Suite

> UESRPG 3ev4 · Foundry VTT v13.351  
> Last updated: 2026-02-07 (T6 — Regression & Stability Gates)

This document defines deterministic, manually-executable regression tests for the spell system. Each test specifies **preconditions**, **steps**, and **expected outcomes** so that any change to the spell framework can be validated without ambiguity.

Tests are grouped by subsystem. A ✅ pass requires _all_ expected outcomes to hold.

---

## Conventions

| Term | Meaning |
|------|---------|
| **GM** | Game Master user (has authority for mutations) |
| **PC** | Player Character actor |
| **NPC** | Non-Player Character actor |
| **Origin AE** | The caster-side Active Effect that tracks linked entities |
| **Target AE** | The target-side spell Active Effect |
| **SS** | Spell Strength |

---

## 1 · Casting — All Action Channels

### 1.1 Cast via Primary Action (Attack Spell — Fire Bolt)

**Preconditions:** PC with Destruction skill, ≥ 4 MP, ≥ 1 AP, Fire Bolt spell. One NPC target token selected.

| # | Step | Expected |
|---|------|----------|
| 1 | Open actor sheet → click Fire Bolt "Cast" button | Spell options dialog appears (level selection, overload checkbox) |
| 2 | Select Level 1 (cost 4), confirm | `uesrpg.spell.preCast` hook fires; magic opposed workflow card appears in chat |
| 3 | Complete casting roll (success) | `uesrpg.spell.castResolved` fires with `success: true`; MP reduced by 4; AP reduced by 1 |
| 4 | Complete attack resolution (hit) | Damage applied to target; `uesrpg.spell.effectApplied` fires if AEs exist |
| 5 | Complete attack resolution (miss) | No damage; no AEs on target; Origin AE still cleaned up if instant |

### 1.2 Cast via Direct Channel (Heal)

**Preconditions:** PC with Restoration skill, ≥ 6 MP. Friendly target selected.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Heal (Level 1, cost 6) | No attack roll; direct resolution |
| 2 | Cast resolves | Target HP increased by SS×2 (= 4 at L1); MP reduced by 6 |
| 3 | Check chat | Healing amount displayed |

### 1.3 Cast Unopposed (Self-Buff — Fortify Strength)

**Preconditions:** PC with Restoration skill, ≥ 9 MP. No target selected.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Fortify Strength (Level 1) | Casting roll occurs |
| 2 | Success | Origin AE created on caster; Target AE with `system.modifiers.characteristics.str` +5 created on caster |
| 3 | Check actor sheet | STR value reflects +5 modifier |
| 4 | Verify Origin AE flags | `isOriginAE: true`, `linkedEntities` array contains entry with `type: "targetAE"` |

### 1.4 Cast Failure — Insufficient MP

**Preconditions:** PC with 2 MP remaining, Fire Bolt (cost 4).

| # | Step | Expected |
|---|------|----------|
| 1 | Click Cast | UI notification: insufficient magicka (or dialog prevents cast) |
| 2 | Check MP | Unchanged |

### 1.5 Cast Failure — Backfire

**Preconditions:** PC with low casting TN. Any spell.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast and roll above TN | Backfire table consulted for spell's school; result applied |
| 2 | Check MP | Cost still deducted (RAW) |
| 3 | Check AEs | No Origin AE or Target AEs created |

---

## 2 · Upkeep Refresh

### 2.1 Standard Upkeep Prompt (Fortify Strength)

**Preconditions:** Fortify Strength active with Origin AE on caster. Combat active, about to expire.

| # | Step | Expected |
|---|------|----------|
| 1 | Advance combat round to duration expiry | Upkeep dialog appears for caster |
| 2 | Click "Refresh" | MP reduced by original cost (9 at L1); Origin AE duration reset |
| 3 | Check Target AE | Duration reset; effect still active |
| 4 | Check `uesrpg.spell.upkeepRefreshed` hook | Fires with correct payload |

### 2.2 Upkeep Declined

| # | Step | Expected |
|---|------|----------|
| 1 | Upkeep dialog appears | — |
| 2 | Click "Cancel" / "Let Expire" | Origin AE deleted; cascade teardown fires |
| 3 | Check target | Target AE removed |
| 4 | Check caster | No orphan AEs remain |

### 2.3 Upkeep — Insufficient MP

| # | Step | Expected |
|---|------|----------|
| 1 | Caster's MP < upkeep cost when prompt fires | Dialog shows insufficient MP warning, or auto-expires |
| 2 | Check result | Spell expires; Origin + Target AEs cleaned up |

### 2.4 Prompt Deduplication

| # | Step | Expected |
|---|------|----------|
| 1 | Two upkeep-eligible spells expire on same round for same caster | Each gets exactly one prompt (no duplicate dialogs) |
| 2 | Rapidly advance 3 rounds without responding | Only one prompt per spell group key at a time |

---

## 3 · Origin AE Teardown — No Orphans

### 3.1 Target AE Cleanup

**Preconditions:** Caster has Absorb Strength active on Target A. Origin AE on caster has `linkedEntities` with `type: "targetAE"` + `type: "casterBuff"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE from caster's effects tab | `deleteActiveEffect` hook fires → `teardownOriginAE()` |
| 2 | Check Target A | Debuff AE removed |
| 3 | Check caster | Paired buff AE removed |
| 4 | Check chat | `uesrpg.spell.ended` notification posted |

### 3.2 Template Cleanup (Zone Spell)

**Preconditions:** Fire Storm active. Origin AE has `linkedEntities` with `type: "template"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE | Measured template removed from canvas |
| 2 | Check scene templates | No orphan template remains |

### 3.3 Summon Cleanup

**Preconditions:** Summon Daedra active. Origin AE has `type: "summon"` in linked entities.

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE | Summoned token removed from canvas |
| 2 | Check scene tokens | No orphan summon token remains |

### 3.4 Bound Item Cleanup

**Preconditions:** Conjure Weapon active. Origin AE has `type: "boundItem"`.

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE | Temporary weapon item deleted from caster's inventory |
| 2 | Check caster's items | No orphan bound item remains |

### 3.5 Belt-and-Suspenders Orphan Scan

**Preconditions:** Manually create a "fake orphan" spell AE on an actor (matching `spellUuid` + `casterUuid` + `originalCastWorldTime` but NOT registered in Origin AE's `linkedEntities`).

| # | Step | Expected |
|---|------|----------|
| 1 | Delete Origin AE | `_cleanOrphanTargetAEs()` finds and removes the fake orphan |
| 2 | Check all actors | No matching orphan AEs remain |

### 3.6 Idempotent Teardown

| # | Step | Expected |
|---|------|----------|
| 1 | Call `teardownOriginAE()` on an already-torn-down Origin | No errors thrown; returns gracefully |
| 2 | Check linked entities were already cleaned | No duplicate deletion attempts |

---

## 4 · Dispel

### 4.1 Dispel — Single Effect Removal

**Preconditions:** Target has Fortify Strength (L1) active. Caster casts Dispel at SS 1.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Dispel on target | Dispel dialog appears with list of dispellable effects |
| 2 | Select Fortify Strength, click "Dispel" | Effect removed via Origin AE cancel pathway |
| 3 | Check target | AE gone; STR returns to base |
| 4 | Check caster (of Fortify) | Origin AE deleted |

### 4.2 Dispel — Level Filter

**Preconditions:** Target has L3 spell and L1 spell active. Dispel cast at SS 2.

| # | Step | Expected |
|---|------|----------|
| 1 | Open dispel dialog | L1 spell appears; L3 spell does NOT appear |
| 2 | Dispel L1 spell | Only L1 effect removed |

### 4.3 Dispel All

**Preconditions:** Target has 3 dispellable effects ≤ SS.

| # | Step | Expected |
|---|------|----------|
| 1 | Click "Dispel All" | All 3 effects removed |
| 2 | Check chat | `uesrpg.spell.dispelled` hook fires with correct count |

### 4.4 Dispel — No Eligible Effects

**Preconditions:** Target has no spell AEs, or all are above Dispel SS.

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Dispel | Dialog shows "No dispellable effects" or empty list |

---

## 5 · Per-School Representative Spells

### 5.1 Alteration — Shield (Armor buff)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Shield L1 on self | AR bonus AE applied; Origin AE created |
| 2 | Check armor rating | Reflects bonus |
| 3 | Upkeep cycle | Refreshes correctly |
| 4 | Teardown | AR returns to base |

### 5.2 Conjuration — Conjure Weapon

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Conjure Weapon L2 | Origin AE created; `uesrpg.spell.originCreated` fires |
| 2 | Check inventory | Bound weapon item appears (from compendium or placeholder) |
| 3 | Delete Origin AE | Weapon item removed from inventory |

### 5.3 Conjuration — Summon Daedra (Scamp)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Summon Daedra (Scamp profile) | Token spawned on canvas; `uesrpg.spell.summonSpawned` fires |
| 2 | Check caster for Mindlock AE | AP reduced by mindlockValue |
| 3 | Check chat | Binding prompt posted (GM-whispered) |
| 4 | Delete Origin AE | Summon token + Mindlock AE removed |

### 5.4 Destruction — Fire Ball (AoE)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Fire Ball L1 with 2+ targets in AoE | Damage applied to all targets in radius |
| 2 | Check damage type | Fire damage after resistance |

### 5.5 Illusion — Silence (Condition Spell)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Silence on target (WP test or direct) | Target gains `silenced` condition AE |
| 2 | Target attempts to cast a spell | Casting TN modified by -20 (silence penalty in `computeMagicCastingTN`) |
| 3 | Origin AE deleted | Silenced condition removed |

### 5.6 Illusion — Invisibility + Break

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Invisibility on self | `invisible` condition flag set; AE applied |
| 2 | Cast an attack spell while invisible | `breakInvisibility()` fires; AE removed; chat notification |
| 3 | Or: call `incrementAttacks()` while invisible | Same break behavior |

### 5.7 Mysticism — Absorb Strength (Paired AE)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Absorb Strength on target | Target AE: STR -5; `uesrpg.spell.effectApplied` fires |
| 2 | Check caster | Paired buff AE: STR +5 automatically created |
| 3 | Delete Origin AE | Both Target debuff and Caster buff removed |

### 5.8 Mysticism — Reflect + Incoming Spell

| # | Step | Expected |
|---|------|----------|
| 1 | Target has Reflect (SS 3) active | `spellReflect` modifier = 3 |
| 2 | Caster casts Fire Bolt L2 at target | `trySpellReflect()` returns `reflected: true, behavior: "redirect"` |
| 3 | Check damage | Applied to caster (not target) |
| 4 | L4 spell against same target | Reflect threshold (3) < spell level (4); no reflect |

### 5.9 Mysticism — Soul Trap

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Soul Trap on NPC target | Marker AE placed on target (no modifier changes) |
| 2 | Reduce target HP to 0 | `preUpdateActor` detects death; deferred callback fires |
| 3 | Check caster inventory | Filled soul gem item created |
| 4 | Check soul size | Correct for NPC level (e.g., L3 → Lesser) |
| 5 | Check Soul Trap AE | Removed after capture |

### 5.10 Restoration — Regeneration (OverTime HoT)

| # | Step | Expected |
|---|------|----------|
| 1 | Cast Regeneration on target in combat | Origin AE + HoT AE created |
| 2 | End target's turn | OverTime engine ticks; target healed by SS×2 |
| 3 | Check tick markers | `lastTickRound` updated |
| 4 | Same round, trigger again | Cadence gate prevents double-tick |

---

## 6 · Spell Reflect Edge Cases

### 6.1 Reflect — Cancel Behavior (Absorb [Char])

| # | Step | Expected |
|---|------|----------|
| 1 | Target has Reflect; incoming Absorb Strength | `trySpellReflect()` returns `behavior: "cancel"` |
| 2 | Check both actors | No AEs applied to either (no net effect) |

### 6.2 Reflect — Self-Target Skip

| # | Step | Expected |
|---|------|----------|
| 1 | Caster casts spell on themselves; caster has Reflect | Reflect skipped (self-target guard) |

### 6.3 Reflect — Loop Prevention

| # | Step | Expected |
|---|------|----------|
| 1 | Both caster and target have Reflect | `alreadyReflected` flag prevents infinite loop; spell applies to caster after one redirect |

---

## 7 · Condition Triggers

### 7.1 Invisibility Break on Attack Spell

| # | Step | Expected |
|---|------|----------|
| 1 | Invisible caster casts attack spell (success) | `castResolved` hook → `breakInvisibility()` |
| 2 | Check condition flag | `invisible: false` or flag cleared |
| 3 | Check AEs | Invisibility Origin AE torn down |

### 7.2 Invisibility Break on Melee Attack

| # | Step | Expected |
|---|------|----------|
| 1 | Invisible actor calls `incrementAttacks()` | Non-blocking `breakInvisibility()` fires |
| 2 | Attack proceeds normally | No blocking; invisibility cleared in background |

---

## 8 · Silence Casting Penalty

### 8.1 Silenced Caster — TN Reduction

**Preconditions:** PC with `system.traits.condition.silenced = true`.

| # | Step | Expected |
|---|------|----------|
| 1 | Compute casting TN for any spell | TN reduced by 20 |
| 2 | Check breakdown | Entry: "Silenced (no verbal)" = -20 |

### 8.2 Not Silenced — No Penalty

| # | Step | Expected |
|---|------|----------|
| 1 | PC without silenced condition | No silence entry in breakdown; TN unaffected |

---

## 9 · Cross-Cutting Concerns

### 9.1 Multi-User Authority (Non-Owner Mutations)

**Preconditions:** Player A owns PC-A. Player B (not owner) triggers a spell effect on PC-A.

| # | Step | Expected |
|---|------|----------|
| 1 | GM casts damage spell on PC-A | Damage routed through authority proxy |
| 2 | Check HP | Reduced correctly even though GM doesn't own PC-A |

### 9.2 Hook Idempotency

| # | Step | Expected |
|---|------|----------|
| 1 | Register same initializer twice (e.g., call `initializeConditionTriggers()` × 2) | No duplicate hooks; guard prevents double-registration |

### 9.3 GM-Only Guards

| # | Step | Expected |
|---|------|----------|
| 1 | Non-GM user triggers a tick/overtime/soul-trap event | Handler early-returns; no mutations attempted |

---

## Appendix A — Regression Checklist (Quick Reference)

Use this as a go/no-go gate before merging spell framework changes:

- [ ] 1.1 Primary action cast (attack spell)
- [ ] 1.2 Direct cast (healing)
- [ ] 1.3 Unopposed cast (self-buff)
- [ ] 2.1 Upkeep refresh
- [ ] 2.2 Upkeep decline
- [ ] 3.1 Target AE teardown
- [ ] 3.3 Summon teardown
- [ ] 3.4 Bound item teardown
- [ ] 4.1 Dispel single effect
- [ ] 5.5 Silence condition + penalty
- [ ] 5.6 Invisibility break
- [ ] 5.7 Absorb paired AE
- [ ] 5.8 Spell Reflect redirect
- [ ] 5.9 Soul Trap death hook
- [ ] 5.10 Regeneration HoT tick
- [ ] 9.1 Authority proxy (non-owner)
