# Manual verification: summon control and recovery

These scenarios have not been run against the current implementation. Use an
isolated Foundry 14.368+ world with disposable actors, a GM, and a player who
owns the caster. Record the Foundry version, result, and any console messages in
`verification.json`. No production-world data is needed.

## Binding and control

1. Cast Summon Daedra or Summon Construct with a normal successful casting test.
   Check both binding outcomes and an equal result. The unbound creature remains
   free; a tie stays pending for the GM. A bound creature has the Summoned and
   Bound traits, the applicable restraint, one linked Mindlock, and ownership for
   the caster's player.
2. Cast the same spell from an enchantment without a casting roll. Check that the
   saved Binding Strength supplies the caster's degrees of success. A historical
   origin lacking a usable result must instead ask the GM to resolve the test.
3. With a bound summon, have its master or an ally attack it. Confirm the action
   on the GM review card, including a missed attack. Check that the token becomes
   hostile, Bound and restraint are removed, and only permissions granted by
   binding are restored. Repeat using the summon card for an action outside the
   automated combat workflow. Cancelling the confirmation must change nothing.
4. Give the same origin one bound and one unbound summon. End the origin: the
   bound summon should depart, the unbound summon should remain, and unrelated
   tokens should be unchanged. Releasing one of two bound summons must retain
   Mindlock while the other remains bound.
5. Cancel placement and check that no token appears and that the message states
   the paid cost and origin remain. Exercise a failed linked deletion in the
   disposable world, then inspect the GM review card and retry after correcting
   the failure. An unresolvable link or unknown binding must remain for review;
   it must not be reported as a confirmed deletion.

## Void Channeler

1. Activate the talent, apply outcomes to multiple summoned Daedra, and check
   that the single Stamina cost is paid once. Refresh one target and confirm one
   effect remains and starts at the new application time.
2. In combat, reorder initiative after applying the effect. It should expire at
   the end of the same combatant's step in the following round, including for a
   target outside the tracker. Delete the anchor combatant and, separately, the
   combat; the corresponding effects should expire immediately.
3. Queue an outcome, change or end combat, and apply it afterward. Its duration
   must use the state at application. Repeat outside combat using world time.
   With no active GM in combat, confirm that the effect waits for authority.
4. Repeat with targets on another scene, two clients, a GM handoff, denied
   permissions, and an interruption after an effect write. Inspect the saved
   outcome before retrying; a started but unconfirmed write needs review.

## Special Action receipts

Submit the same action from two clients, repeat an applied action, and change
the source result while its card is pending. Interrupt processing before a
consequence, after a consequence, and before card synchronization; then reload
and change the active GM. Confirm that a completed receipt is displayed without
another application, while an uncertain or conflicting stage requires explicit
GM reconciliation. Check AP, conditions, and movement for duplicates. Also
review a completed card whose Actor receipt is unavailable.

Ghost and Wraith binding, summon initiative, and unbound end-of-round
maintenance still require their separate manual procedures.
