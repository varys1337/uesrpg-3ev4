# Testing - Talents Automation (Resilience, Social)

Target: Foundry VTT `v13.351` + UESRPG 3ev4 system.

This is an end-to-end manual test plan for all Chapter 4 talent automation implemented for:
- Resilience: **Die-Hard**, **Unstoppable**, **Enduring**, **Iron Will**, **Meditation**, **Rapid Recovery**, **Wall of Steel**
- Social: **Into the Fire**, **Inspire Heroism**, **Questioning**

If you are also validating General/Intellectual/Mobility automation, use `docs/testing/talents-general-intellectual-mobility.md`.

## 0) Preflight / Setup
1. Use a test world with:
   - 1 GM user
   - 1 Player user who owns at least one character
2. Create these Actors (recommended):
   - `Test PC A` (owned by Player): talent carrier
   - `Test PC B` (GM-owned or Player-owned): ally/defender control
   - `Test Group` (Actor type `Group`) for any group-actor driven validations
3. Ensure `Test PC A` has:
   - Endurance characteristic total and Willpower characteristic total set to known values
   - A `Command` skill item (for Inspire Heroism)
   - A `Persuade` skill item (for Questioning)
4. Ensure `Test PC B` has:
   - HP/SP/MP not at max for rest tests (or be ready to reduce them)
   - At least one armor item and one shield item available for equip tests

### 0.1) Helpful console snippets (optional)
Inspect last chat message flags:
```js
game.messages.contents.at(-1)?.flags
```

List enabled AEs (for Inspire Heroism):
```js
actor.effects.filter(e => !e.disabled).map(e => ({ name: e.name, key: e.flags?.uesrpg?.key, id: e.id }))
```

Inspect talent keys detected (actor must have matching talent Items):
```js
const a = game.actors.getName("Test PC A");
const api = await import("systems/uesrpg-3ev4/src/core/traits/talents-api.js");
["diehard","unstoppable","enduring","ironwill","meditation","rapidrecovery","wallofsteel","intothefire","inspireheroism","questioning"].map(k => [k, api.hasTalent(a,k)])
```

## 1) Enduring - halve fatigue penalties
1. On `Test PC A`, add talent item `Enduring`.
2. Establish a baseline without the talent:
   - Temporarily remove/disable the talent item.
   - Increase fatigue to a non-zero level.
   - Roll any test where the sheet/roll UI shows the fatigue penalty contribution.
   - Record the fatigue penalty value.
3. Re-enable `Enduring` and reroll the same test.
4. Verify the fatigue penalty is reduced to approximately half of the baseline (rounding consistent with the system).

Does-not-apply:
- With fatigue at 0, verify no change is observed (no penalty to reduce).

## 2) Unstoppable - halve passive wound effects
1. On `Test PC A`, add `Die-Hard` and `Unstoppable` (Unstoppable requires Die-Hard in Chapter 4).
2. Establish baseline wound penalty without Unstoppable:
   - Temporarily remove/disable `Unstoppable`.
   - Apply a wound (or use a test actor already wounded).
   - Roll a test that clearly shows the wound’s passive penalty.
   - Record the penalty magnitude.
3. Re-enable `Unstoppable` and repeat the same check.
4. Verify the passive wound penalty contribution is reduced to approximately half (rounding consistent with the system).

Does-not-apply:
- With no wounds present, verify no observable change.

## 3) Wall of Steel - +1 AR (armor), +1 BR (shields), ignore tower shield speed penalty
### 3.1) Armor Rating (AR) +1
1. On `Test PC A`, equip one or more armor items that contribute AR in your system.
2. Without `Wall of Steel`, make/receive a physical attack that produces damage mitigation breakdown in chat.
3. Record AR contribution for each worn/covering armor item.
4. Add `Wall of Steel` and repeat the same damage scenario.
5. Verify effective AR increases by +1 for each worn armor item that applies to the hit location(s).

### 3.2) Block Rating (BR) +1
1. On `Test PC A`, equip a shield that provides BR.
2. Without `Wall of Steel`, perform a block or trigger a damage mitigation flow that uses shield BR.
3. Record displayed/calculated BR.
4. Add `Wall of Steel` and repeat.
5. Verify BR is increased by +1.

### 3.3) Ignore tower shield speed penalty
1. On `Test PC A`, equip a tower shield (whatever your item config uses to mark `shieldType: tower`).
2. Without `Wall of Steel`, verify Speed decreases by 1 due to the tower shield penalty.
3. Add `Wall of Steel` and verify the Speed penalty is removed (Speed returns to its pre-shield value, accounting for any other speed modifiers).

Does-not-apply:
- With a non-tower shield, verify `Wall of Steel` does not change Speed (only the tower-shield penalty lane is overridden).

## 4) Meditation - short rest doubles MP/SP regeneration
1. On `Test PC A`, add `Meditation`.
2. Ensure:
   - `system.fatigue.bonus` is 0 (so short rest recovers SP instead of removing fatigue)
   - SP is missing (value < max)
   - MP is missing (value < max)
3. Take a short rest.
4. Verify a prompt appears: **Meditation** -> choose **Meditate**.
5. Verify:
   - SP recovery is doubled (compared to a normal short rest under the same conditions)
   - MP recovery is doubled (compared to a normal short rest under the same conditions)
6. Repeat and choose **Normal Rest**; verify recovery matches baseline behavior.

Permission check:
- As a non-owner non-GM, verify no Meditation prompt appears (no permission to decide).

## 5) Rapid Recovery - short rest +1d4 HP; long rest doubles natural HP healing
### 5.1) Short rest: +1d4 HP
1. On `Test PC A`, add `Rapid Recovery`.
2. Set HP to below max.
3. Take a short rest.
4. Verify HP increases by `1d4` (capped at max).
5. Repeat several times and confirm the change varies within 1–4 (unless capped by max HP).

Does-not-apply:
- With HP at max, verify no HP change is applied (no over-heal).

### 5.2) Long rest: double natural healing rate
1. On `Test PC A`, set HP below max and ensure the actor has **no untreated wounds** (per your wounds subsystem).
2. Record END bonus and the HP healed by a long rest without the talent.
3. Add `Rapid Recovery` and repeat long rest under the same wound state.
4. Verify long-rest HP healing is doubled (relative to baseline END-bonus healing), capped at max HP.

Does-not-apply:
- With untreated wounds, verify the system blocks/skips natural HP healing as usual (Rapid Recovery should not bypass the untreated-wounds rule).

## 6) Die-Hard - reroll failed Endurance tests (shock / avoid death), once per test
Die-Hard applies to specific Endurance tests (Chapter 4): resisting shock effects of a wound or avoiding death.

### 6.1) Shock Test reroll (wounds flow)
1. On `Test PC A`, add `Die-Hard`.
2. Trigger a Shock Test from a wound (use your standard wound application flow that prompts/creates a Shock Test chat message).
3. Force a failed Shock Test.
4. Verify a prompt appears asking to use Die-Hard to reroll.
5. Choose reroll and verify:
   - A reroll is made using the same TN.
   - The reroll can only be taken once for that Shock Test instance.
6. Trigger another Shock Test on a different wound instance and verify Die-Hard can be offered again (it’s “once per test”, not “once per session”).

Does-not-apply:
- On a passed Shock Test, verify no reroll prompt.

### 6.2) Endurance characteristic test reroll (if wired via characteristic roll UI)
1. Roll a straight Endurance characteristic test that is explicitly for shock/death avoidance (use whatever UI toggle/label exists).
2. Force a failure and verify Die-Hard offers a single reroll (once per test).

## 7) Iron Will - reroll failed Willpower tests (illusion / manipulation / coercion), once per test
Iron Will applies to specific Willpower tests (Chapter 4): resisting Illusion magic, mental manipulation, or coercion.

1. On `Test PC A`, add `Iron Will`.
2. Roll a Willpower characteristic test and enable the Iron Will toggle (if present).
3. Force a failure.
4. Verify Iron Will offers a single reroll (once per test).
5. Verify that without the toggle enabled, no reroll is offered (the talent is scope-limited to “appropriate tests”).

## 8) Questioning - Persuade info-gathering toggle + DoS substitution
Questioning applies only when a Persuade test is made to elicit information (Chapter 4).

1. On `Test PC A`, add `Questioning`.
2. Roll Persuade from the sheet and enable the **Questioning** checkbox (if present).
3. Force a success.
4. Verify a prompt appears: choose **rolled DoS** or **Persuade rank**.
5. Verify:
   - The chosen DoS value is used for any downstream result display that references DoS.
   - The chat message flags include an audit object like `flags.uesrpg.dosOverride` with `source: "questioning"`.
6. Repeat with the checkbox disabled and verify no prompt/override occurs.

Does-not-apply:
- On a failed Persuade roll, verify no prompt/override.

## 9) Inspire Heroism - activated; Command test; +10 to ally’s next combat test (once/round)
### 9.1) Activation requirements and success path
1. On `Test PC A`, add `Inspire Heroism`.
2. Start an active combat and ensure both `Test PC A` and `Test PC B` tokens are on the scene.
3. Target exactly one allied token (e.g., `Test PC B`).
4. Use the talent item activation flow for `Inspire Heroism`.
5. Verify:
   - A Command test dialog appears (difficulty + manual modifier).
   - A Command test roll message is posted (audit).
6. Force a success and verify:
   - The target gains an enabled Active Effect named `Inspired (Heroism)` (or equivalent), with `flags.uesrpg.key === "inspireHeroism"`.
   - The target’s next combat roll includes a +10 modifier (attack or defense), attributable to the effect.

### 9.2) Once-per-round limit
1. In the same combat round, attempt to activate Inspire Heroism again from `Test PC A`.
2. Verify it is blocked with a warning (once per round).
3. Advance to the next round and verify it can be used again.

### 9.3) Does-not-apply / validation guards
1. Attempt activation outside an active combat -> verify warning and no effect.
2. Attempt activation with 0 or 2+ targets -> verify warning and no effect.
3. Attempt activation targeting self -> verify warning and no effect.
4. Remove `Command` skill from the actor and attempt activation -> verify warning and no effect.

### 9.4) Effect consumption (one-shot)
1. With the `Inspired (Heroism)` effect present on a target, make a single combat test (attack or defense) with that target.
2. Verify the +10 applied on that test.
3. Verify the effect is consumed/removed after that combat test, and does not apply to subsequent combat tests.

## 10) Into the Fire - group-leader + allies Fear mitigation (blocked if no workflow exists)
Into the Fire depends on:
- a Fear test workflow, and
- an “appropriate table” roll on failed Fear tests, and
- a deterministic “group leader” concept.

If your current build does not surface these concepts as data/workflows, treat Into the Fire as **blocked** (do not attempt to validate speculative behavior).

If/when implemented, validate:
1. Group actor membership (leader + allies) resolves deterministically.
2. On a failed Fear test by leader or allies, a table roll is performed twice and the lower result used.
3. On a passed Fear test, no table roll modification occurs.

## 11) Idempotency / Regression checks
1. Re-open the world (or reload Foundry) and repeat:
   - Short rest with Meditation
   - Short rest with Rapid Recovery
   - Inspire Heroism activation + effect application
2. Verify:
   - No duplicate prompts/buttons appear.
   - No duplicate AEs are stacked unexpectedly.
   - No console errors occur during the flows.

