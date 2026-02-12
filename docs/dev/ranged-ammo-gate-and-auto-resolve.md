# Ranged Ammo Gate + Auto Weapon Selection (Foundry v13.351)

This system enforces two guardrails for **ranged** opposed attacks:

1) **Ammo / load gating happens before ammo is decremented**
   - If a ranged weapon **requires reload** and is **unloaded**, the attack is blocked.
   - If a ranged weapon consumes ammo and the bound ammo is missing or empty, the attack is blocked.

2) **No “Select Weapon / Advantages” dialog for ranged damage follow-through**
   - For ranged attacks, damage and block-resolution flows auto-select the attacker’s currently equipped ranged weapon (or the declared `context.weaponUuid`) and proceed without prompting.

## Implementation

- Gate helper: `src/core/combat/opposed/damage/ranged-ammo-gate.js`
- Gate wiring (canonical): `src/core/combat/opposed/helpers/workflow.js` (`preConsumeAttackAmmo`)
- Auto-selection helper: `src/core/combat/opposed/helpers/select-equipped-ranged-weapon.js`
- Dialog skip:
  - `src/core/combat/opposed/actions/damage.js` (attacker damage roll)
  - `src/core/combat/opposed/actions/resolve.js` (block resolution)

## Manual verification

### 1) Ammo missing blocks (pre-commit)
- Equip a ranged weapon with `consumeAmmo` enabled and an `ammoId` binding.
- Remove the ammo item or set `system.quantity` to `0`.
- Attempt a ranged attack.
- Expected: warning; no ammo decrement; no damage follow-through.

### 2) Unloaded blocks (pre-commit)
- Use a ranged weapon with Reload (X) so `system.reloadState.requiresReload === true`.
- Set `system.reloadState.isLoaded` to `false` (or fire once and verify it becomes unloaded).
- Attempt a ranged attack.
- Expected: warning; no ammo decrement.

### 3) Normal ranged attack consumes once
- Ensure ammo quantity > 0 and weapon is loaded (if required).
- Attack once.
- Expected: ammo decremented exactly once; weapon becomes unloaded if it requires reload; no duplicate warnings.

### 4) Ranged damage follow-through does not prompt
- Win a ranged opposed test and trigger “Roll Damage” / block resolution as applicable.
- Expected: no weapon-selection dialog appears; weapon is resolved automatically.

