# Testing - Talents Automation (Racial)

Target: Foundry VTT `v13.351` + UESRPG 3ev4 system.

This is an end-to-end manual test plan for Chapter 4 racial-talent automation implemented for:
- Argonian: **Child of the Sap**, **Histskin**
- Bosmer: **Nature’s Blessing**
- Breton: **Dragonskin**
- Imperial: **Red Diamond**, **Imperial Luck**
- Khajiit: **Eye of Night**
- Nord: **Sons of Skyrim**
- Orsimer: **Malacath’s Fury**
- Redguard: **Adrenaline Burst** (via the **Adrenaline Rush** power)

## 0) Preflight / Setup
1. Use a test world with:
   - 1 GM user
   - 1 Player user who owns at least one character
2. Create these Actors:
   - `Test PC A` (owned by Player): main test actor
   - `Test PC B` (any ownership): optional target/defender
3. For tests involving activated talents/powers:
   - Ensure the item has `system.activation.enabled = true` so the sheet "Use" button runs the activation engine.
4. For Imperial gating tests:
   - Setting: `uesrpg-3ev4.enforceCharGenMilestones` (default `false`)
   - Actor flag used by enforcement: `flags.uesrpg.charGen.completed` (default false/missing)

## 1) Argonian — Child of the Sap (passive)
1. On `Test PC A`, add the Talent item `Child of the Sap`.
2. Verify derived movement Speed increases by `+1` on the sheet.
3. Trigger any `Disease Check` card against `Test PC A` (e.g., from a `Diseased` trait automation card) and verify the result reports immunity (no roll required).

## 2) Argonian — Histskin (passive + activated)
**2.1 Passive (swim + underwater skill bonus UI)**
1. On `Test PC A`, add the Talent item `Histskin`.
2. Verify derived Swim Speed is doubled (compare before/after adding the talent).
3. Roll an untargeted `Athletics` test:
   - Confirm the roll options dialog shows `Histskin (Underwater) +30`.
   - Check it ON and roll: TN breakdown includes `Histskin (Underwater) +30`.
   - Check it OFF and roll: TN breakdown does not include that entry.
4. Repeat step 3 for `Stealth`. Confirm the checkbox exists and behaves the same.

**2.2 Activated (once per Short Rest)**
1. Ensure `Histskin` is an activated Talent (Activation tab enabled).
2. Reduce `Test PC A` HP below max.
3. Click `Use` on `Histskin`.
4. Verify:
   - HP increases by `EB` (Endurance Bonus).
   - A second immediate `Use` is blocked with a warning (already used this Short Rest).
5. Take a Short Rest from the sheet.
6. Verify `Histskin` can be used again.

## 3) Bosmer — Nature’s Blessing (passive)
1. On `Test PC A`, add the Talent item `Nature’s Blessing`.
2. Verify derived resistances update:
   - Disease Resistance increases by `+25%` (the system uses `system.resistance.diseaseR`).
   - `Resistance (Poison)` increases by `+1` (poison resistance value increases).

## 4) Breton — Dragonskin (activated)
1. On `Test PC A`, add the Talent item `Dragonskin` and enable activation.
2. Start combat and ensure `Test PC A` is a combatant (so "1 round" is combat-anchored).
3. Click `Use` on `Dragonskin`.
4. Verify an Active Effect is created on the actor for ~1 round.
5. Have a caster apply a spell to `Test PC A` (any spell with a defined MP cost):
   - Confirm a `Spell Absorption (5)` roll card appears while Dragonskin is active.
6. Advance time (end of round) and confirm the Dragonskin absorption no longer triggers once the effect expires.

## 5) Imperial — Red Diamond / Imperial Luck (passive + spend button)
**5.1 Stamina bonus scaling**
1. On `Test PC A`, add `Star of the West` (trait) and note Stamina max.
2. Add `Red Diamond` and verify Stamina max increases so that the Star of the West bonus is effectively `2 SP`.
3. Add `Imperial Luck` and verify Stamina max increases so that the Star of the West bonus is effectively `3 SP`.

**5.2 Character Generation gating**
1. Enable setting `uesrpg-3ev4.enforceCharGenMilestones = true`.
2. Ensure `Test PC A` does NOT have `flags.uesrpg.charGen.completed = true`.
3. Verify:
   - Red Diamond / Imperial Luck stamina-bonus automation does not apply.
   - A warning is shown (once per session per actor/talent).
4. Set `flags.uesrpg.charGen.completed = true` on `Test PC A`.
5. Verify the stamina-bonus automation now applies.

**5.3 Imperial Luck — Spend LP to add DoS**
1. Ensure `Test PC A` has `Imperial Luck` and at least `2` Luck Points.
2. Make a successful Skill Test chat roll (any skill).
3. Verify the chat message shows a button `Spend 1 LP (+2 DoS)`.
4. Click it and verify:
   - Actor LP decreases by 1
   - A note is posted indicating `Imperial Luck` DoS increase
5. Verify the next click on the same test (if LP remains) applies `+1 DoS`.

## 6) Khajiit — Eye of Night (passive + conditional precision)
**6.1 Natural weapon dice step-up**
1. On `Test PC A`, add the Talent item `Eye of Night`.
2. Make an unarmed/natural weapon attack damage roll (a weapon with the `handToHand` token).
3. Verify the weapon damage card displays an upgraded `Damage` expression (example: `d4` -> `d6`, `d12` -> `2d8`).
4. Remove `Eye of Night` and repeat: confirm the damage expression reverts.

**6.2 Free Precision Strike (hidden + night/darkness toggle)**
1. Ensure `Test PC A` has the `Hidden` condition.
2. Start an opposed attack and choose `Precision Strike`.
3. Confirm an `Eye of Night (night/darkness)` checkbox appears in the attack options dialog.
4. Check it ON and confirm TN breakdown includes an `Eye of Night` `+20` modifier (cancels the Precision Strike `-20`).

## 7) Nord — Sons of Skyrim (passive)
1. On `Test PC A`, add the Talent item `Sons of Skyrim`.
2. Verify:
   - Frost resistance increases by `+1`.
   - Wound Threshold increases by `+1` (Tough +1).

## 8) Orsimer — Malacath’s Fury (passive + activated)
**8.1 Passive**
1. On `Test PC A`, add the Talent item `Malacath’s Fury`.
2. Verify HP max increases by `+2` (resilient bonus increase component).

**8.2 Activated (once per Long Rest)**
1. Enable activation on `Malacath’s Fury`.
2. Reduce HP below max.
3. Click `Use` and verify:
   - Heals `EB` HP
   - Applies a 1-minute buff which increases Strength Bonus and Magic Resistance by `floor(EB/2)`
4. Click `Use` again and verify it is blocked until a Long Rest.
5. Take a Long Rest and verify it can be used again.

## 9) Redguard — Adrenaline Burst (power override)
1. On `Test PC A`, add the Talent item `Adrenaline Burst` and the Power item `Adrenaline Rush` (activation enabled).
2. Start combat and ensure `Test PC A` is a combatant.
3. Click `Use` on `Adrenaline Rush`.
4. Verify:
   - HP heals by `5` (Adrenaline Burst)
   - Stamina increases by `+2` as a temporary encounter effect (may exceed max while active)
   - Passive wound penalties are suppressed while the effect is active
5. End combat and verify the temporary Adrenaline Rush effect is removed and wound penalties re-apply if the actor remains wounded.
