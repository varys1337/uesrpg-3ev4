# Passive Transfer Active Effects — Test Checklist

## 1) Skill item passive AE works
1. As GM, ensure setting default includes `skill`.
2. Put an Active Effect on a Skill item with `transfer=true`:
   - key: `system.modifiers.skills.athletics`
   - mode: ADD
   - value: `10`
3. Roll Athletics.
**Expected:** TN/value reflects +10 (in breakdown/logs depending on your UI).

## 2) Conditional types remain conditional by default
1. Put a transfer AE on a weapon:
   - key: `system.modifiers.skills.athletics`
   - value: `10`
2. Ensure weapon is **not equipped**.
**Expected:** No bonus (unless GM added `weapon` to allowlist).
3. Equip weapon.
**Expected:** Bonus applies (existing behavior preserved).

## 3) Allowlist override works
1. Set `passiveTransferItemTypes` to include `weapon`.
2. Repeat weapon test with weapon unequipped.
**Expected:** Bonus applies because allowlist overrides conditional behavior.

## 4) Non-GM behavior
1. As non-GM client, ensure effects apply to your own rolls (read-only evaluation).
**Expected:** Roll reflects passive effects; no world writes.
