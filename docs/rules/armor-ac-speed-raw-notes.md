# Armor AC/Speed RAW Compliance Notes

## Source: UESRPG 3e Core Rules

### Chapter 1: Weight Classes

**Weight Class Table (Armor):**

| Class | Acrobatics Penalty | Agility Test Penalty | Speed Penalty | Applies To |
|---|---|---|---|---|
| None | - | - | - | No training required |
| Light | -10 | - | - | Light armor |
| Medium | - | -10* | -1 | Medium armor |
| Heavy | - | -20* | -2 | Heavy armor |
| Super-Heavy | - | -30* | -3 | Super-Heavy armor |
| Crippling | - | -40 (all tests) | Cannot move | Crippling armor (rare) |

\* Agility-based tests **except Combat Style skill tests**

**Quality Modifiers:**
- **Inferior:** Increases weight class by one step
- **Superior:** Decreases weight class by one step

**Stacking Rule:**
> "When wearing multiple different types of armor and/or carrying a shield, the character always uses the effects of their heaviest armor piece."

**Shields:**
- Do NOT contribute to weight class penalties (handled separately via BR)
- Tower shields: -1 Speed (special rule)

---

### Chapter 7: Armor Tables

**Partial Armor Examples (Magic AR column):**

| Material | AR | Magic AR | Weight Class |
|---|---|---|---|
| Chitin | 1 | 1 (fire) | None |
| Leather | 1 | 1 (fire) | Light |
| Steel | 4 | - | Medium |
| Moonstone | 3 | 1 (magic) | Light |
| Daedric | 6 | 6 (magic) | Heavy |
| Dragonbone | 7 | 7 (magic) | Heavy |
| Stalhrim | 6 | 6 (frost) | Medium |

**Full Armor Examples:**

| Material | AR | Magic AR | Weight Class |
|---|---|---|---|
| Padded | 2 | - | Medium |
| Hide | 2 | 2 (frost) | Medium |
| Steel | 6 | - | Heavy |
| Daedric | 8 | 8 (magic) | Super-Heavy |
| Dragonbone | 9 | 9 (magic) | Super-Heavy |
| Stalhrim | 8 | 8 (frost) | Heavy |

**Shield Examples (Magic BR column):**

| Material | BR | Magic BR | Weight Class |
|---|---|---|---|
| Hide | 6 | (3) 4 vs frost | Light |
| Steel | 10 | (5) | Medium |
| Daedric | 12 | 12 (magic) | Heavy |
| Dragonbone | 13 | 13 (magic) | Heavy |

Note: "(X)" indicates half-BR default; explicit values override

**Special Qualities:**

- **Runed:** +25% price, gains Magic quality and +1 Magic AR
- **Damaged (X):** All AR/BR reduced by X (min 0)

---

### Chapter 5: Damage & Mitigation

**Physical Damage:**
> "Roll the damage of the attack and subtract the Armor Rating (AR) of the hit location struck. Reduce the target's HP by the remaining amount."

**Magic Damage (Elemental Spells):**
> "Resistance to these damage types functions like AR but is derived from traits and conditions rather than armor." (Chapter 6, Magic section)

**Layered Resistance (Elemental Spells):**
- RAW does not explicitly state whether Magic AR applies to elemental spells
- Tables show materials with typed Magic AR (e.g., Stalhrim has "8 frost" for full armor)
- Typed Magic AR explicitly reduces that damage type
- Generic Magic AR (labeled "magic") is listed separately

**Interpretation:**
- **Typed Magic AR** (e.g., "6 frost" on Stalhrim) reduces that specific elemental damage
- **Generic Magic AR** (labeled "magic") should reduce all magical damage, including elemental spells
- Rationale: All spells are magical in nature; elemental spells are a subset

**Natural Toughness:**
> "The character with this trait is naturally tough and reduces incoming damage of all types by X. This functions like AR for the purposes of reducing damage, but it does not count as armor."

---

### Chapter 3: Combat Styles & Armor Training

**Armor Training:**
> "Armor is divided into types using the associated weight class quality: light, medium, heavy, or super heavy. Armor without a quality requires no training."

> "Characters who use armor that they are not trained to use suffer the usual -20 penalty for using an untrained skill on any associated combat tests, movement tests in the case of armor, or any other tests that the GM deems appropriate."

**Implication:**
- Weight class is the PRIMARY categorization for armor
- All game mechanics (penalties, training, talents) reference weight class
- AC status category IS weight class

---

## RAW Compliance Checklist

### Speed Penalties

- [x] None: 0
- [x] Light: 0
- [x] Medium: -1
- [x] Heavy: -2
- [x] Super-Heavy: -3
- [x] Crippling: cannot move (handled separately)
- [x] Quality adjustment (Inferior +1 step, Superior -1 step)
- [x] Only heaviest armor counts (max precedence)
- [x] Shields excluded from armor penalties
- [x] Tower shield: -1 Speed (special)
- [x] Wall of Steel: ignore armor speed penalty

**Verdict:** ✅ **COMPLIANT** (implementation in `armor-mobility.js` is correct)

### AC Status Category

- [x] Derived from equipped armor weight class
- [x] Quality-adjusted
- [x] Max precedence (heaviest armor)
- [x] Shields excluded
- [x] Fallback to actor.system.armor_class (legacy)
- [ ] **MISSING:** UI display of derived category

**Verdict:** ⚠️ **MOSTLY COMPLIANT** (computation correct, UI incomplete)

### Magic AR Mitigation

- [x] Material-based Magic AR stored on items
- [x] Typed Magic AR (fire/frost/shock) reduces specific element
- [x] Generic Magic AR ("magic") reduces magic damage type
- [ ] **BUG:** Generic Magic AR does NOT reduce elemental spell damage (fire/frost/shock spells)
- [x] Runed quality: +1 Magic AR
- [x] Damaged quality: reduces Magic AR
- [x] Natural Toughness: reduces all damage (including magic)

**Verdict:** ❌ **NON-COMPLIANT** (elemental spells bypass Magic AR)

---

## Conclusion

**Armor Speed & Weight Class:**  
✅ RAW-compliant. Implementation is deterministic and correct.

**AC Status Category:**  
⚠️ Mostly compliant. Computation is correct but UI does not expose the derived category consistently.

**Magic AR:**  
❌ Non-compliant. Elemental spells ignore generic Magic AR, which contradicts the design intent (all spells are magical). Typed Magic AR works correctly.

