# Testing - Talents Automation (General, Intellectual, Mobility)

Target: Foundry VTT `v13.351` + UESRPG 3ev4 system.

This is an end-to-end manual test plan for all Chapter 4 talent automation implemented for:
- General: **Expert (Specialization)**, **Grandmaster (Skill)**, **Untouchable**
- Intellectual: **Businessman**, **Interrogator**, **Prediction**, **Tactician**
- Mobility: **Armored Agility**, **Assassin Strike**, **Hard Target**, **Step Aside**, **Swashbuckler**

It also validates the supporting wiring required by these talents:
- Skill test chat flags for rerolls and DoS overrides
- SkillOpposed "banked lane replacement" when a talent reroll is used

## 0) Preflight / Setup
1. Use a test world with:
   - 1 GM user
   - 1 Player user who owns at least one character
2. Create these Actors (recommended):
   - `Test PC A` (owned by Player): talent carrier
   - `Test PC B` (GM-owned or Player-owned): defender/target
   - `Test Group` (Actor type `Group`) for Tactician tests
3. Add both PCs to the group:
   - In `Test Group`, ensure both member UUIDs are present in `system.members[].id`.
4. Ensure `Test PC A` has usable ranks in:
   - Acrobatics, Commerce, Persuade (distinct ranks are helpful)
5. Ensure `Test PC B` has:
   - Luck Bonus > 0 and Luck Points (`system.luck_points.value`) for Untouchable spend tests
6. Ensure you have armor that produces an Acrobatics/Agility penalty (for Armored Agility tests).

## 0.1) Talent Item naming (required for deterministic parsing)
These automations rely on talent item names being parseable:
- Expert: author as `Expert (<Specialization>)` (example: `Expert (Stealth [Urban])`).
- Grandmaster: author as `Grandmaster (<SkillName>)` (example: `Grandmaster (Commerce)`).
- Hard Target: a normal `Hard Target` talent item should work; activation uses the normalized talent key.

If your world uses different naming conventions, validate parsing first (see Troubleshooting).

## 0.2) Helpful console snippets (optional)
Inspect the last chat message flags:
```js
game.messages.contents.at(-1)?.flags
```

Inspect a specific message:
```js
game.messages.get("<messageId>")?.flags
```

List talent item names on an actor:
```js
actor.items.filter(i => i.type === "talent").map(i => i.name)
```

## 1) Expert (Specialization) - reroll on failed skill tests
### 1.1) Unopposed skill roll path
1. On `Test PC A`, add `Expert (Stealth [Urban])` (or your specialization name).
2. Roll a skill test with the sheet option **Use Specialization** enabled and force a failure.
3. Verify the chat message shows a button: **Reroll (Talent)**.
4. Click **Reroll (Talent)**.
5. Verify:
   - A new roll message appears (and does not itself offer reroll again).
   - The original message becomes reroll-used (cannot be rerolled twice).
6. Verify message flags:
   - Original: `flags.uesrpg.reroll.used === true` and `flags.uesrpg.reroll.source === "expert"`
   - Reroll: `flags.uesrpg.reroll.isReroll === true` and `flags.uesrpg.reroll.parentMessageId` matches the original id

### 1.2) Does-not-apply cases
1. Roll the same skill without **Use Specialization** checked; force failure.
2. Verify **Reroll (Talent)** does not appear (Expert only applies to specialization-marked tests).

## 2) Grandmaster (Skill) - reroll on failed tests + stacking restriction
### 2.1) Unopposed skill roll path
1. On `Test PC A`, add:
   - `Grandmaster (Commerce)`
   - An Expert specialization that could also plausibly match the same roll
2. Roll Commerce and force a failure.
3. Verify only one **Reroll (Talent)** appears.
4. Click **Reroll (Talent)**.
5. Verify source precedence:
   - Original message reroll flags show `source === "grandmaster"` (Grandmaster wins over Expert).

### 2.2) Grandmaster (Magical skill) +1 effective rank
1. On an actor with a magical skill in your world, add `Grandmaster (<MagicalSkillName>)`.
2. Use the casting/enchanting/potion workflow that displays/uses "effective skill rank".
3. Verify effective rank gets +1 only when Grandmaster matches that magical skill.

## 3) SkillOpposed - reroll replacement + banking integrity
This validates that a reroll message can replace the currently banked roll result for a lane (instead of creating a second, conflicting lane).

1. Start a SkillOpposed test (PC A vs PC B) using a skill where PC A has Grandmaster.
2. Force PC A's first roll to fail and confirm **Reroll (Talent)** appears on the lane roll message.
3. Click **Reroll (Talent)**.
4. Verify:
   - The reroll message has `flags.uesrpg.reroll.isReroll === true` and a `parentMessageId`.
   - The SkillOpposed parent card reflects the reroll result as the active/banked lane result (no duplicate lane).

## 4) Untouchable - Wound Threshold (WT) override is derived only
1. On `Test PC B`, add `Untouchable`.
2. Record Luck Bonus.
3. Verify the displayed/derived WT equals `3 * LuckBonus`.
4. Verify derived-only behavior:
   - Remove the talent and WT returns to normal.
   - No base WT fields are permanently overwritten in actor data.

## 5) Untouchable - spend Luck Points after being hit (for that attack only)
Note: the prompt is expected only when applied damage would exceed WT.

1. Ensure the Untouchable defender has `system.luck_points.value > 0`.
2. Apply damage (via normal Apply Damage flow) such that total applied damage would exceed WT.
3. Verify a prompt appears to spend `0..available LP`.
4. Choose:
   - Spend 0 -> wound determination should match original WT.
   - Spend max (or enough) -> WT is temporarily increased for this attack and wound triggering respects the increased WT.
5. Verify LP is reduced on the actor by the spent amount.
6. Permission check:
   - As a non-owner non-GM, confirm no prompt is shown and the system warns owner/GM is required.

Optional Rule Note (Chapter 4):
- Chapter 4 includes alternate text for Untouchable under "Alternate Wounds" rules. If your table uses Alternate Wounds, confirm whether the system has an explicit toggle and whether this automation should be treated as not applicable under that option.

## 6) Interrogator - Persuade interrogation toggle + DoS substitution
### 6.1) Unopposed roll dialog
1. On `Test PC A`, add `Interrogator`.
2. Roll Persuade from the sheet and enable the **Interrogation** checkbox.
3. Force a success.
4. Verify a prompt asks to use rolled DoS or Persuade rank.
5. Verify the chosen value is reflected in:
   - The chat card result display
   - Message flags: `flags.uesrpg.dosOverride = { source: "interrogator", mode: "rolled"|"rank", value: n }`
6. Repeat with **Interrogation** unchecked and verify no prompt occurs.

### 6.2) SkillOpposed dialog (if you oppose Persuade)
1. Run a SkillOpposed lane using Persuade.
2. Verify the Interrogation checkbox exists and behaves as in 6.1.

## 7) Businessman - Commerce DoS substitution
### 7.1) Unopposed roll
1. On `Test PC A`, add `Businessman`.
2. Roll Commerce and force a success.
3. Verify a prompt asks to use rolled DoS or Commerce rank.
4. Verify message flags: `flags.uesrpg.dosOverride.source === "businessman"`.

### 7.2) SkillOpposed lane (if you oppose Commerce)
1. Run a SkillOpposed lane using Commerce and confirm behavior matches 7.1.

## 8) Prediction - Initiative Rating uses Int bonus instead of Agi bonus
1. On `Test PC A`, set Agility Bonus and Intelligence Bonus to visibly different values.
2. Record Initiative Rating without Prediction.
3. Add `Prediction`.
4. Verify Initiative Rating changes to use Int bonus in place of Agi bonus.
5. Remove `Prediction` and verify it reverts.

## 9) Tactician - allies may use a tactician initiative (via Group actor membership)
1. Ensure the group has:
   - One member with `Tactician`
   - One or more allied members without `Tactician`
2. Start combat with both tokens as combatants.
3. Roll initiative for all:
   - Verify tacticians roll first (so their initiatives exist for ally selection).
4. When rolling initiative for a non-tactician ally, verify a prompt offers using the tactician initiative instead of rolling.
5. Choose "Use Tactician" and verify the ally initiative equals the chosen tactician initiative value.
6. Permission check:
   - As a non-owner non-GM, verify no prompt appears for actors you cannot control.

## 10) Armored Agility - reduce Acrobatics armor penalties
1. On `Test PC A`, add `Armored Agility` and equip armor that produces an Acrobatics/Agility penalty.
2. Roll Acrobatics and inspect TN breakdown.
3. Verify the net armor penalty is reduced by `(AcrobaticsRank - 1) * 10`, capped so it cannot exceed the magnitude of the penalty.
4. Remove the talent and verify the reduction disappears.

## 11) Hard Target - manual activation + ranged attacks at -20 until start of next turn
1. Start an active combat and ensure the Hard Target actor is a combatant.
2. On the Hard Target actor, activate the `Hard Target` talent item.
3. Make a ranged attack against that actor.
4. Verify attacker TN includes a -20 situational modifier labeled for Hard Target.
5. Advance turns until the defender's next turn begins.
6. Verify the Hard Target effect expires at the start of the defender's next turn and no longer applies.
7. Does-not-apply checks:
   - Activate Hard Target outside combat -> warning, no effect created.
   - Activate Hard Target when in combat but not a combatant -> warning, no effect created.

## 12) Step Aside - AoO Evade AP deferral (0 AP unless Evade fails)
Important: this automation keys off the attacker label containing "Attack of Opportunity".

### 12.1) Non-banked opposed flow (defender rolls immediately)
1. On a defender, add `Step Aside` and ensure they have at least 1 AP.
2. Trigger an Attack of Opportunity against them (use the system AoO quick action if available).
3. Choose Evade as the defense.
4. Verify no AP is spent at defense declaration time.
5. Force:
   - Evade success -> verify 0 AP spent.
   - Evade failure -> verify 1 AP spent after the failed Evade roll.

### 12.2) Banked opposed flow (commit then roll committed)
1. Repeat the above with banked choices enabled.
2. Verify the same AP deferral behavior occurs when rolling the committed defense.

## 13) Assassin Strike - target cannot AoO attacker during that turn if damage is inflicted
1. On attacker `Test PC A`, add `Assassin Strike`.
2. In combat, make an attack that deals post-mitigation damage > 0 to `Test PC B`.
3. During the attacker's current turn, attempt an Attack of Opportunity from defender against attacker.
4. Verify AoO is blocked with a warning.
5. Verify it does not over-block:
   - On later turns (after the attacker's turn passes), confirm the defender can AoO the attacker again normally.

## 14) Swashbuckler
Current note: the helper exists but the system does not currently enforce Athletics/Acrobatics rank "limits" on combat-related tests. Verify no behavior changes until such limits exist.

## 15) Idempotency / Regression quick checks
1. Refresh/reload the Foundry world.
2. Repeat a reroll test and confirm only one reroll button appears (no duplicate injection).
3. Activate Hard Target and confirm expiry happens once at turn start (no double cleanup).
4. Run `node scripts/verify-imports.mjs` locally and confirm it passes.

## Troubleshooting
- If reroll buttons do not appear:
  - confirm the roll message has `flags.uesrpg.skillTest` populated and `isSuccess === false`.
  - confirm talent item names match the parsing notes in section 0.1.
- If Step Aside does not defer AP:
  - confirm the attack is labeled as "Attack of Opportunity" by the workflow that created it.
- If Tactician does not prompt:
  - confirm Group actor membership (`system.members[].id`) contains actor UUIDs, and the tactician's initiative is already rolled in the current combat.
