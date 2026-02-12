# Combat & Equipment Test Plan
**System:** UESRPG 3ev4 for Foundry VTT v13.351  
**Date:** 2026-02-03  
**Purpose:** Manual test scenarios for validating Chapter 5 & 7 rules compliance

---

## Quick Test Checklist

Before running a game session or after system updates, verify these core mechanics:

- [ ] Attack limit: 2 attacks per round enforced
- [ ] Hidden: undefendable attack + removed after attack
- [ ] Shield BR: magic damage uses half BR
- [ ] Armor ENC: halved when worn
- [ ] Advantage: independent of attack variants

---

## Test Scenarios

### TS-001: Attack Cap Enforcement (2 per Round)

**Rule:** Chapter 5 - "A character may make no more than two total attacks in a single round"

**Setup:**
1. Create a PC with at least 4 AP
2. Equip a melee weapon
3. Start combat; place a target within melee range

**Test Steps:**
1. On PC's turn, initiate an attack (Attack action) → costs 1 AP
2. Resolve the attack (roll, defender responds, etc.)
3. Initiate a second attack → costs 1 AP
4. Resolve the second attack
5. Attempt to initiate a third attack

**Expected Result:**
- First two attacks: proceed normally
- Third attack: **blocked with warning message** "You have reached your attack limit for this round"
- Attack counter visible in combat tracking (if debug enabled)

**Pass Criteria:** ✅ Third attack prevented with clear user feedback

---

### TS-002: Spell Attacks Count Toward Limit

**Rule:** Chapter 5 - Attack cap includes "spells that count as attacks"

**Setup:**
1. Create a PC with a combat spell (e.g., Fire Bolt)
2. Equip a melee weapon
3. Start combat

**Test Steps:**
1. Cast Fire Bolt at a target (spell attack) → counts as attack 1
2. Make a melee attack → counts as attack 2
3. Attempt a third attack (either spell or melee)

**Expected Result:**
- Third attack blocked with warning
- Both spell and weapon attacks counted toward the same 2-attack limit

**Pass Criteria:** ✅ Spell attacks and weapon attacks share the same limit

---

### TS-003: Dual Fighter Conditional 3rd Attack

**Rule:** Chapter 4/5 - Dual Fighter talent allows 3rd melee attack if both weapons used

**Setup:**
1. Create PC with Dual Fighter talent
2. Equip two different one-handed melee weapons (e.g., Sword + Dagger)
3. Start combat

**Test Steps:**
1. Attack with Weapon A → attack 1
2. Attack with Weapon B → attack 2
3. Attempt attack with Weapon A → attack 3 (should be allowed)
4. **Alternate test:** Attack twice with Weapon A, then try Weapon B (should be **blocked**)

**Expected Result:**
- Scenario 1: Third attack allowed because both weapons used
- Scenario 2: Third attack blocked because "each weapon used once" condition not met

**Pass Criteria:** ✅ 3rd attack allowed only when both weapons used in round

---

### TS-004: Hidden Grants Undefendable Attack

**Rule:** Chapter 5 - "Enemies cannot defend against attacks made by hidden characters"

**Setup:**
1. Create PC with Stealth skill
2. Create NPC target
3. Start combat; apply Hidden condition to PC (via Stealth success or manual)

**Test Steps:**
1. While PC has Hidden condition, initiate attack against NPC
2. Observe defender's options in opposed card

**Expected Result:**
- Defender card shows "Cannot Defend (Hidden)" or equivalent
- Defender cannot select Block/Parry/Evade/Counter-Attack
- Attack proceeds as if defender failed their defense

**Pass Criteria:** ✅ Defender cannot choose a defense method; attack auto-wins if attacker succeeds

---

### TS-005: Hidden Removed After Attack Resolution

**Rule:** Chapter 5 - "Attacking causes the Hidden character to lose the Hidden condition immediately after the attack resolves"

**Setup:**
1. PC with Hidden condition
2. Target NPC

**Test Steps:**
1. Initiate attack while Hidden
2. After attack is fully resolved (damage applied if hit), check PC's conditions

**Expected Result:**
- Hidden condition present at attack declaration
- Hidden condition **removed after attack completes**
- Timing: after damage resolution, not before

**Pass Criteria:** ✅ Hidden removed at correct timing (post-resolution, not pre-roll)

---

### TS-006: Shield BR vs Physical Damage

**Rule:** Chapter 7 - "If damage ≤ BR, nothing happens. If damage > BR, full damage to shield arm"

**Setup:**
1. PC with shield (e.g., Steel Shield, BR 10)
2. Attacker with weapon dealing ~8-12 damage

**Test Steps:**
1. Attacker makes attack
2. Defender chooses Block
3. Both roll; defender wins or both succeed (block succeeds)
4. Damage rolled (e.g., 8 or 12)

**Expected Result:**
- Damage ≤ 10: **No damage taken** (absorbed by BR)
- Damage > 10: **Full damage applied to shield arm** (BR exceeded)

**Pass Criteria:** ✅ BR threshold behavior correct; binary outcome (all or nothing)

---

### TS-007: Shield BR vs Magic Damage (Halved)

**Rule:** Chapter 7 - "Shields count BR as half (round up) against magic damage unless specific magic BR"

**Setup:**
1. PC with basic shield (e.g., Steel Shield, BR 10, Magic BR (5) - half base)
2. Attacker with magic attack dealing ~6-8 magic damage

**Test Steps:**
1. Attacker makes magic attack (e.g., Fire Bolt)
2. Defender chooses Block
3. Damage rolled (e.g., 6 or 8)

**Expected Result:**
- Effective BR vs magic damage: 5 (half of 10, rounded up)
- Damage ≤ 5: No damage
- Damage > 5: Full damage to shield arm
- Example: 6 damage exceeds BR 5, so 6 damage applied

**Pass Criteria:** ✅ Magic damage uses half BR; specific magic BR (if present) overrides

---

### TS-008: Shield with Specific Magic BR

**Rule:** Chapter 7 - Shields with listed Magic BR use that value, not halved base

**Setup:**
1. PC with Moonstone Shield (BR 9, Magic BR 6 - not halved)
2. Attacker with magic damage

**Test Steps:**
1. Magic attack vs block
2. Damage rolled (e.g., 5 or 7)

**Expected Result:**
- Effective BR vs magic: **6** (specific Magic BR, not 5 from halving)
- Damage ≤ 6: No damage
- Damage > 6: Full damage to shield arm

**Pass Criteria:** ✅ Specific Magic BR takes precedence over half-base rule

---

### TS-009: Armor ENC Halved When Worn

**Rule:** Chapter 7 - "ENC is halved when armor is worn"

**Setup:**
1. Create PC
2. Add Full Steel Armor Body (ENC 4 per piece; full suit = 24 ENC)
3. Equip the body armor piece (equipped = true)

**Test Steps:**
1. Check carry_rating.current before equipping
2. Equip armor (set system.equipped = true)
3. Check carry_rating.current after equipping

**Expected Result:**
- Armor contribution to encumbrance: ENC / 2
- Example: Body piece ENC 4 → contributes 2 to current carry load when worn
- Formula visible in carry_rating calculation: `totalEnc - (armorEnc / 2) - excludedEnc`

**Pass Criteria:** ✅ Worn armor ENC halved in carry calculation

---

### TS-010: Shield ENC NOT Halved

**Rule:** Chapter 7 - Armor ENC halved "but not for carried shields"

**Setup:**
1. PC with shield (e.g., Steel Shield, ENC 3)
2. Shield is equipped (carried, not stored in bag)

**Test Steps:**
1. Check carry_rating.current with shield equipped

**Expected Result:**
- Shield contributes **full ENC** (3) to carry load
- Shields excluded from `armorEnc` aggregation
- Only armor pieces benefit from ENC halving

**Pass Criteria:** ✅ Shield ENC not halved; full weight counted

---

### TS-011: Weight Class Penalty (Heaviest Piece)

**Rule:** Chapter 7 - "When wearing multiple armor pieces, use effects of heaviest armor piece"

**Setup:**
1. PC wearing:
   - Light armor on legs (Light: -10 Acrobatics)
   - Heavy armor on body (Heavy: -20 Agility except Combat Style, -2 Speed)
   - Medium armor on head (Medium: -10 Agility except Combat Style, -1 Speed)

**Test Steps:**
1. Check derived Speed value
2. Make an Acrobatics test
3. Make an Agility-based test (e.g., Evade or Stealth)

**Expected Result:**
- **Heaviest piece = Heavy** (body armor)
- Speed penalty: **-2** (from Heavy, not sum of all pieces)
- Acrobatics penalty: **-20** (from Heavy, not -10 from Light)
- Other Agility tests: **-20** (from Heavy)
- Combat Style tests: **no penalty** (exception per Heavy description)

**Pass Criteria:** ✅ Only heaviest armor weight class penalties apply; no stacking

---

### TS-012: All Out Attack Bonus and Cost

**Rule:** Chapter 5 - All Out Attack: melee only, +20 bonus, costs +1 AP (total 2 AP)

**Setup:**
1. PC with melee weapon, 2+ AP
2. Target in melee range

**Test Steps:**
1. Declare attack; select "All Out Attack" variant
2. Check AP cost before rolling
3. Check attack TN

**Expected Result:**
- AP cost: **2 AP** (1 base + 1 variant)
- Attack TN: **+20 modifier** visible in TN breakdown
- Can only be selected for melee attacks (ranged attacks should not show option or should be disabled)

**Pass Criteria:** ✅ +20 bonus applied; 2 AP spent; melee-only restriction enforced

---

### TS-013: Precision Strike Penalty (No Advantage)

**Rule:** Chapter 5 - Precision Strike: -20 penalty; choosing hit location requires winning AND spending advantage

**Setup:**
1. PC vs NPC in melee
2. Combat tracker active

**Test Steps:**
1. Declare attack; select "Precision Strike" variant
2. Roll attack (with -20 penalty visible)
3. **Case A:** Win opposed roll → gain advantage → damage dialog shows "Precision Strike" checkbox
4. **Case B:** Lose opposed roll → no advantage → cannot choose hit location

**Expected Result:**
- Attack TN: **-20 modifier** from variant
- Advantage: **gained from winning roll** (not from variant itself)
- Hit location choice: **available only if advantage gained AND Precision Strike selected in damage dialog**

**Pass Criteria:** 
- ✅ Variant applies -20 penalty
- ✅ Advantage NOT auto-granted by variant
- ✅ Hit location choice requires both: (1) advantage from winning roll, (2) spending advantage on Precision Strike

---

### TS-014: Advantage Independent of Variant

**Rule:** Chapter 5 - Advantage gained from roll results (one fails, crits), NOT from attack variants

**Setup:**
1. Two PCs with identical stats
2. PC1 uses Normal Attack
3. PC2 uses All Out Attack (+20)

**Test Steps:**
1. Both attack same target
2. Both succeed; opponent fails defense
3. Check advantage gained

**Expected Result:**
- Both PCs gain **1 advantage** (opponent failed)
- PC2's +20 bonus helps win the roll but does NOT grant extra advantage
- Advantage computation: determined by success/failure/crits only

**Pass Criteria:** ✅ Advantage count identical for both PCs despite different variants

---

### TS-015: Defensive Stance Blocks Attacks

**Rule:** Chapter 5 - Defensive Stance: +10 to defensive tests; attack limit = 0 until next Turn

**Setup:**
1. PC with Defensive Stance action available
2. Target NPC

**Test Steps:**
1. PC takes Defensive Stance action on their turn
2. Check effects applied (should see Defensive Stance active effect)
3. On same turn (before next turn), attempt to initiate an attack

**Expected Result:**
- Defensive tests: **+10 modifier** visible in TN
- Attack attempt: **blocked with warning** "Defensive Stance is active: you cannot attack until your next Turn"
- Can still defend normally

**Pass Criteria:** ✅ Cannot attack while Defensive Stance active; defensive bonus applied

---

### TS-016: Tower Shield +10 to Block

**Rule:** Chapter 7 - Tower shields grant +10 to block tests; -1 Speed when carried

**Setup:**
1. PC with Tower Shield variant of any shield type
2. Shield equipped

**Test Steps:**
1. Incoming attack; choose Block
2. Check block TN calculation

**Expected Result:**
- Block TN: **+10 modifier** from Tower Shield
- Speed: **-1** from carrying tower shield (visible in derived Speed)

**Pass Criteria:** ✅ +10 block bonus and -1 Speed both applied

---

### TS-017: Buckler Cannot Block, Parry Advantage

**Rule:** Chapter 7 - Bucklers: cannot block; +1 DoS to successful Parry; always gain advantage on Parry win

**Setup:**
1. PC with Buckler variant shield
2. Incoming melee attack

**Test Steps:**
1. Attempt to select "Block" as defense → should not be available or should warn
2. Select "Parry" as defense
3. Win the opposed roll
4. Check DoS and advantage

**Expected Result:**
- Block option: **disabled** or shows warning
- Successful Parry: **+1 DoS** added to result
- Parry win: **automatically gain advantage** (even if both succeeded with equal base DoS)

**Pass Criteria:** ✅ Block unavailable; Parry grants +1 DoS and auto-advantage

---

### TS-018: Ranged Attacks Cannot Gain Advantage

**Rule:** Chapter 5 - "Ranged attackers and spells cannot gain or utilize Advantage"

**Setup:**
1. PC with bow (ranged weapon)
2. Target NPC

**Test Steps:**
1. Make ranged attack
2. Win opposed roll (opponent fails defense)
3. Check advantage count in damage dialog

**Expected Result:**
- Opposed roll: **attacker wins**
- Advantage gained: **0** (not 1, even though opponent failed)
- Damage dialog: **no advantage spending options** available

**Pass Criteria:** ✅ Ranged attack wins but gains zero advantage; cannot spend advantage

---

### TS-019: Counter-Attack: Higher DoS Hits

**Rule:** Chapter 5 - Counter-Attack: both attack; higher DoS hits; equal DoS neither resolves

**Setup:**
1. Attacker vs Defender
2. Defender chooses Counter-Attack

**Test Steps:**
1. Both roll attacks
2. **Case A:** Attacker 3 DoS, Defender 1 DoS → attacker hits
3. **Case B:** Attacker 2 DoS, Defender 2 DoS → neither hits

**Expected Result:**
- Case A: **Attacker wins; attack hits defender**
- Case B: **Tie; neither attack resolves**
- Both roll simultaneously; no advantage from counter-attack ties

**Pass Criteria:** ✅ Higher DoS wins; tie means neither resolves

---

### TS-020: Evade Free Movement (No AoO)

**Rule:** Chapter 5 - Successful evade grants up to 1m movement that does not provoke Attacks of Opportunity

**Setup:**
1. Defender successfully evades an attack
2. Defender chooses to move 1m away from attacker

**Test Steps:**
1. Defender evades attack successfully
2. Defender moves 1m (using evade's free movement)

**Expected Result:**
- Defender can move **up to 1m** without spending AP
- Movement does **not** trigger Attack of Opportunity from attacker
- If defender moves beyond 1m (using normal movement), that additional movement CAN trigger AoO

**Pass Criteria:** ✅ 1m free movement granted; no AoO triggered for evade movement

---

## Regression Test Suite (Quick Smoke Test)

After any system update, run this abbreviated test:

1. **Attack Cap**: Make 3 attacks in one round → 3rd blocked ✅
2. **Hidden**: Attack from Hidden → undefendable; Hidden removed after ✅
3. **Shield BR**: Block physical damage ≤ BR → no damage; > BR → full damage ✅
4. **Armor ENC**: Worn armor ENC halved; shield full ✅
5. **Advantage**: Precision Strike has -20 penalty but does NOT auto-grant advantage ✅

**Total Time:** ~15 minutes

---

## Notes for GMs

### Manual vs Automated Enforcement

Some rules require **GM discretion** or **manual tracking**:
- **Coup de Grâce helpless check**: System flags special resolution; GM determines if target qualifies
- **Complex weapon reload**: "Cannot move while reloading" is documented but not hard-enforced by system
- **Weapon quality caps** (e.g., Crushing capped at AR): Damage automation implements logic, but edge cases may need manual verification

### Debug Tools

Enable debug settings for enhanced visibility:
- `game.settings.set("uesrpg-3ev4", "effectsProxyDebug", true)` - Authority proxy logs
- `game.uesrpg.dumpAEKeys(actor)` - Inspect Active Effect modifier keys
- `actor.system.combat_tracking` - View attack counter, weapon uses

---

## Test Log Template

```
Test ID: TS-XXX
Date: YYYY-MM-DD
Tester: [Name]
System Version: [e.g., 3ev4.1.0]
Foundry Version: [e.g., 13.351]

Result: [ ] PASS [ ] FAIL [ ] PARTIAL

Notes:
[Any observations, edge cases, or deviations from expected behavior]
```

---

## Appendix: Creating Test Actors

Quick setup for common test scenarios:

**Test PC (Combat Focus):**
- Str 50, Agi 50, End 50
- Combat Style [Melee]: 60
- Evade: 50
- 5 AP, 50 HP
- Equipped: Steel Sword (1d8, 2m), Steel Shield (BR 10)

**Test PC (Dual Wielder):**
- Same stats as above
- Add Dual Fighter talent
- Equipped: Short Sword + Dagger (both 1H, melee)

**Test PC (Ranged):**
- Same base stats
- Combat Style [Ranged]: 60
- Equipped: Longbow (1d8, 10/250/350, Reload 2)

**Test NPC (Basic Target):**
- 40 in all characteristics
- 50 HP, 3 AP
- Evade 40
- No armor (for baseline testing)

These templates allow rapid setup for test scenarios.
