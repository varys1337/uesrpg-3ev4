# Stamina System Quick Reference Guide

**For Players & GMs**  
**UESRPG 3ev4 - Foundry VTT Implementation**

---

## What is Stamina?

Stamina Points (SP) represent your character's ability to push their physical limits. You spend SP to perform heroic feats, land devastating blows, and push beyond normal capabilities.

**Your SP Maximum = Your Endurance Bonus**

Example: END 38 → END Bonus 3 → 3 SP maximum

---

## How to Access Stamina

### Click the Green Stamina Bar
On your character sheet, **click the green "Stamina" button** to open the stamina spending dialog.

**You'll see:**
```
Current SP: 5
Temporary SP: +2 (consumed first)
Effective SP: 7 / 8
```

- **Current SP:** Your normal stamina pool
- **Temporary SP:** Bonus SP from Frenzy, potions, etc. (used first)
- **Effective SP:** Total available = Current + Temp

---

## Spending Stamina

### The Six Stamina Actions

#### 1. Physical Exertion (1 SP)
**When:** Before making a STR or END skill/characteristic test  
**Effect:** +20 bonus on your next test  
**Restrictions:** Does NOT work on Combat Style tests

**Example:** Athletics (STR) to climb a cliff → +20 bonus

---

#### 2. Sprint (1 SP)
**When:** Before using a Dash action  
**Effect:** Move up to 2× your speed instead of 1× your speed  

**Example:** Speed 12m → Dash normally moves 12m → Sprint moves 24m

---

#### 3. Power Draw (1 SP)
**When:** Before shooting a ranged weapon  
**Effect:** Reduce reload time by 1 for your next shot  

**Example:** Crossbow (Reload 2) → becomes Reload 1 for next shot

---

#### 4. Power Attack (1-3 SP)
**When:** Before rolling damage  
**Effect:** +2 damage per SP spent (max +6)  
**Talent Bonus:** Killing Blow talent → +3 damage per SP (max +9)

**Example:** Spend 2 SP → +4 damage to your hit

---

#### 5. Power Block (1 SP)
**When:** After damage roll, when blocking with a shield  
**Effect:** Double your shield's BR (Block Rating) against physical damage  

**Example:** Shield BR 5 → becomes BR 10 for this block

---

#### 6. Heroic Action (1 SP)
**When:** During combat  
**Effect:** Immediately regain 1 Action Point  
**Restriction:** Only once per round

**Example:** Out of AP but need to attack → Heroic Action → +1 AP

---

## Temporary Stamina Points

### What is Temp SP?

Temporary SP is **bonus stamina** from special effects like:
- 🔥 **Frenzied condition** (+1 temp SP)
- 🧪 **Potions** (future feature)
- ✨ **Magic effects** (future feature)

### Consumption Order

**Temp SP is ALWAYS consumed before regular SP.**

**Example:**
```
Current SP: 3
Temp SP: +2
Total: 5 SP available

Spend 3 SP for Power Attack:
→ Uses 2 temp, 1 regular
→ Remaining: 2 regular, 0 temp
```

### Chat Message
```
Cost: 3 SP (2 temp, 1 regular)
Remaining SP: 2 / 8
```

---

## Going Below Zero SP

### Fatigue System

**If you spend SP when at 0 or below, you gain fatigue.**

Each point of SP below zero = 1 level of fatigue:

| SP | Fatigue Level | Effect |
|----|---------------|--------|
| 0 to -1 | Fatigued (1) | -10 penalty to all tests |
| -2 to -3 | Exhausted (2) | -20 penalty to all tests |
| -4 to -5 | Drained (3) | -30 penalty to all tests |
| -6 to -7 | Unconscious (4) | Fall unconscious |
| -8+ | Death (5+) | Die from exhaustion |

**Warning:** The stamina dialog will warn you if you're at or below 0 SP!

### Special Case: Undead

**Undead characters CANNOT spend SP below 0.**  
They'll see an error if they try.

---

## Recovering Stamina

### Long Rest (8 hours)
- **Regain:** END Bonus SP (or remove fatigue if below 0)
- **Priority:** Removes fatigue first, then restores SP

**Example:** END Bonus 3, currently at -2 SP (2 fatigue)
- After long rest: Removes 2 fatigue (now 0 SP), then +1 SP (now 1 SP)

### Short Rest (1 hour)
- **Regain:** 1 SP (or remove 1 level of fatigue)

**Example:** At -1 SP (1 fatigue)
- After short rest: Either remove fatigue (now 0 SP) OR gain 1 SP (now 0 SP)

---

## Frenzy & Stamina

### When Frenzied Starts
- **Gain +1 temporary SP immediately**
- This can exceed your maximum
- Shows as `5 (+1 temp) / 8` on your sheet

### When Frenzy Ends
- **Lose 2 SP** (temp consumed first, cannot kill you)
- Talent modifiers:
  - **Controlled Anger:** No SP loss
  - **Berserker:** Only lose 1 SP

**Example:**
```
Start Frenzy: 5 SP → becomes 5 (+1 temp)
End Frenzy: 5 (+1 temp) → loses 2 SP
Result: 4 SP (consumed 1 temp, 1 regular)
```

---

## Combat Integration

### Attack Limit
- You can make **max 2 attacks per round**
- Stamina spending is SEPARATE from this limit
- You can spend stamina AND attack twice

### Action Points
- **Heroic Action** regains 1 AP
- Can only use once per round
- Great for emergency reactions

### Combat Style Tests
- **Physical Exertion does NOT apply to Combat Style**
- Use it for Athletics, not your sword skill

---

## Tips & Best Practices

### 1. Save Temp SP
Temp SP is consumed first, so:
- Use stamina actions when you have temp SP
- Don't waste temp SP - it might disappear

### 2. Watch Your Pool
- Check Effective SP before spending
- At 0 SP? Think twice about spending (fatigue!)
- Frenzied? You have +1 temp to work with

### 3. Timing Matters
- **Physical Exertion:** Spend BEFORE rolling
- **Power Attack:** Spend BEFORE damage roll
- **Power Block:** Spend AFTER damage roll
- **Heroic Action:** Immediate (regains AP now)

### 4. Plan Your Spending
- You can only spend for one effect per Turn (RAW)
- Choose wisely: +20 to hit OR +6 damage, not both
- Exception: Heroic Action (immediate) can stack with other actions

### 5. Long Fights
- Stamina is a limited resource
- Don't blow all SP in round 1
- Save some for emergencies (Heroic Action)
- Rest when you can (short rest = 1 SP)

---

## Common Questions

### Q: Can I spend SP multiple times per turn?
**A:** RAW says one effect per turn. Ask your GM - some allow it, some don't. The system won't block you, but follow your table's ruling.

### Q: Can I use Luck and SP on the same test?
**A:** No (RAW). Use one or the other, not both.

### Q: What happens if I have 0 SP and Frenzy ends?
**A:** You'd lose 2 SP, but Frenzy grants +1 temp first. So:
- Start: 0 SP
- Frenzy starts: 0 (+1 temp)
- Frenzy ends: Lose 2 → uses 1 temp, loses 1 from regular pool
- Result: -1 SP (1 fatigue)

**Special:** The system prevents death - minimum 1 SP after Frenzy loss.

### Q: Do potions give temp SP?
**A:** Not yet implemented. Future feature will use the same temp SP system.

### Q: Can I see all my active stamina effects?
**A:** Yes! Check your Active Effects tab. Stamina effects show:
- Physical Exertion: +20 skill modifier
- Power Attack: +X damage modifier
- Others: Listed in effects panel

### Q: How do I know if I have a stamina effect active?
**A:** Check your character sheet's Active Effects section. Each stamina effect creates a temporary Active Effect that's consumed when you use it.

---

## Visual Guide

### Character Sheet Display

```
┌─────────────────────────────┐
│  Stamina    [↑] [↻] [↓]   │
│  ━━━━━━━━━━━━━━━━━━━━━━  │
│  5  (+2 temp)  / 8         │
│  ━━━━━━━━━━━━━━━━━━━━━━  │
└─────────────────────────────┘
```

**Green overlay = Current + Temp SP fill level**

### Chat Message Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stamina: Power Attack
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cost: 2 SP (1 temp, 1 regular)
Effect: +4 damage before roll
Damage Bonus: +4
Remaining SP: 3 (+1 temp) / 8

Effect will persist until consumed
by the appropriate action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## GM Notes

### Enforcing Restrictions

**One Effect Per Turn:**
- System doesn't block multiple spending
- GM should enforce RAW if desired
- Clear with players at session zero

**Luck + SP Prohibition:**
- System doesn't prevent combination
- GM watches for violations
- Separate prompts make it unlikely

### Tracking

- All spending creates chat messages
- Check chat log for audit trail
- Active Effects panel shows current buffs

### Temp SP Sources

**Current:**
- Frenzied condition (+1)

**Future Enhancements:**
- Potions of Stamina
- Magic effects
- Trait/racial bonuses
- Use same `system.stamina.temp` field

---

## Quick Reference Card

```
╔══════════════════════════════════════════════╗
║        STAMINA SPENDING QUICK REF           ║
╠══════════════════════════════════════════════╣
║ Physical Exertion  │ 1 SP │ +20 STR/END    ║
║ Sprint             │ 1 SP │ 2× speed        ║
║ Power Draw         │ 1 SP │ -1 reload       ║
║ Power Attack       │ 1-3  │ +2/+4/+6 dmg    ║
║ Power Block        │ 1 SP │ 2× shield BR    ║
║ Heroic Action      │ 1 SP │ +1 AP (1×/rnd) ║
╠══════════════════════════════════════════════╣
║ RECOVERY                                     ║
║ Long Rest (8h)     │ +END Bonus SP          ║
║ Short Rest (1h)    │ +1 SP or -1 fatigue    ║
╠══════════════════════════════════════════════╣
║ TEMP SP: Consumed before regular SP         ║
║ BELOW 0: Gain fatigue levels                ║
║ DEATH: -8 SP (5 fatigue levels)             ║
╚══════════════════════════════════════════════╝
```

---

## Related Documentation

- **Full System Analysis:** [docs/Coding/STAMINA_SYSTEM_ANALYSIS.md](STAMINA_SYSTEM_ANALYSIS.md)
- **RAW Reference:** [docs/Core/Chapter 1 - Getting Started.md](../Core/Chapter%201%20-%20Getting%20Started.md)
- **RAW Reference:** [docs/Core/Chapter 5 - Advanced Mechanics.md](../Core/Chapter%205%20-%20Advanced%20Mechanics.md)
- **Frenzied Condition:** [Condition system documentation](../Core/Chapter%205%20-%20Advanced%20Mechanics.md#frenzied)

---

**Last Updated:** 2026-02-04  
**System Version:** UESRPG 3ev4 for Foundry VTT v13.351
