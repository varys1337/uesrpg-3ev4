# Opposed, Defender, Stamina, Dual Wielder, Thunder Charge Test Plan

## Context Menu Debug Trace (Opposed Role Swap Options Missing)
1. Reload the world with browser console open.
2. Enable debug:
```js
game.uesrpg?.debugContextMenu?.enable();
game.uesrpg?.debugContextMenu?.status();
```
3. Create a fresh opposed parent card (combat/skill/magic).
4. Right-click that chat entry and watch logs. Expected baseline logs:
   - `UESRPG | ContextMenuDebug | register.getChatLogEntryContext` (once per reload)
   - `UESRPG | ContextMenuDebug | hook.getChatLogEntryContext.fired`
   - `UESRPG | ContextMenuDebug | hook.getChatLogEntryContext.optionsPushed`
5. If options still do not show, capture message id from the chat `<li>` and inspect:
```js
const li = document.querySelector('#chat-log .message:last-child');
game.uesrpg?.debugContextMenu?.inspectLi(li);
```
6. Interpret `inspectLi/inspectMessage`:
   - `found: false` means message-id extraction failed or wrong `li` selected.
   - `isOpposed: false` means the message is not the opposed parent card (likely a child roll/marker message).
   - `canRetarget: false` means permission gate failed for current user.
7. If `canRetarget` is false, inspect detailed retarget permission traces:
   - `UESRPG | RetargetDebug | canRetarget.noKind/combat/skill/magic`
8. Validate targeting callback stage:
   - Target exactly one token, click context action.
   - Expected log: `callback.changeAttacker.execute` or `callback.changeDefender.execute`.
   - If missing, the context item was filtered out by `condition`.
9. Validate retarget execution stage:
   - Expected log: `UESRPG | RetargetDebug | retarget.start`
   - If followed by warning `noResolvedTokens`, target token UUID/id was not resolved.
10. Disable debug after capture:
```js
game.uesrpg?.debugContextMenu?.disable();
```

## Opposed Role Swaps
1. Create an opposed test card in chat.
2. Select/control exactly 1 token as current user.
3. Right-click the opposed card and click `Change attacker`.
4. Verify the same chat message updates in place (message id unchanged), attacker updates, and TN/context reset for the new attacker.
5. Repeat with `Change defender` and verify defender lane updates in place and dependent fields reset/recomputed.
6. With no selected token, run either action. Verify warning appears and no card change occurs.
7. Select 2+ tokens and run either action. Verify warning appears and no card change occurs.
8. Validate as GM and as player:
   - User with opposed-card authority sees context actions.
   - User without authority cannot execute swap (warning, no-op).

## Defender Talent Automation
1. Create an opposed card where Ally A is current defender.
2. Control Ally B (with Defender talent), target Ally A, and activate Defender.
3. Verify latest opposed card retargets defender from A to B in place (same message id).
4. Verify Ally A and Ally B token positions are swapped on scene.
5. Commit B's next defense on that card:
   - Verify no AP is spent for that defense commit.
   - Verify `flags.uesrpg.combat.freeNextDefenseCommit` is consumed/cleared.
6. Repeat by using B's next defense on a different opposed card:
   - Verify free defense still applies once (fallback consumption if message id differs), then clears.
7. Advance combat turn or end combat without using the free defense:
   - Verify flag is cleaned up automatically.
8. Console debug checkpoints (new):
   - On use, expect `UESRPG | TalentAutomation | dispatch` with `key: "defender"`.
   - Then expect `UESRPG | DefenderActivation | start`.
   - If blocked, use next marker:
     - `invalidTargets`
     - `missingActivatorToken`
     - `notAlly`
     - `noOpposed`
   - On success path, expect:
     - `retargeted`
     - `freeDefenseState` with `granted: true`

## Stamina / Power Attack
1. Spend stamina on `Power Attack` (1-3 SP).
2. Make an attack and apply damage through standard resolver flow.
3. Verify bonus damage is included once in final damage result.
4. Verify result chat includes audit note `Power Attack: +X damage`.
5. Verify Power Attack effect is consumed exactly once and not retained for later damage rolls.
6. Verify no duplicate/stacked application occurs from both AE and manual pipeline paths.

## Dual Wielder Simplification
1. Actor with `Dual Wielder` (or legacy `Dual Fighter`):
   - Verify attack limit is always `3` (passive).
2. Actor without Dual Wielder:
   - Verify attack limit is `2`.
3. As GM, in Combat tab use attacks controls:
   - `-C/+C` adjusts current attacks used this round.
   - `-M/+M` adjusts max attacks for this actor.
4. Verify gating and warnings follow adjusted values immediately.
5. Advance round in combat:
   - Verify counters reset and cap logic remains correct next round.

## Thunder Charge Dialog Toggle
1. Ensure actor has `Thunder Charge` talent.
2. Start attack declaration dialog:
   - Verify a `Thunderous Charge: waive All Out surcharge` checkbox appears only for actors with the talent.
3. Select `All Out Attack` and enable the Thunderous Charge checkbox:
   - Verify AP surcharge is waived for this attack.
   - Verify chat audit note is posted.
4. Select a non-All-Out variant:
   - Verify checkbox is disabled/cleared and no waiver is applied.
5. Actor without Thunder Charge:
   - Verify toggle is not shown.
