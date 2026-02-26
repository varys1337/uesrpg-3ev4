/**
 * src/core/wounds/wound-rules.js
 *
 * Canonical Chapter 5 wound trigger routing.
 * - Standard: wound on damage in excess of WT.
 * - Alternate: wound on critical success with damage OR reduced to 0 HP.
 */

const SYSTEM_ID = "uesrpg-3ev4";

export const WOUNDS_MODE = Object.freeze({
  STANDARD: "standard",
  ALTERNATE: "alternate"
});

export function getWoundsMode() {
  try {
    const raw = String(game?.settings?.get?.(SYSTEM_ID, "woundsMode") ?? WOUNDS_MODE.STANDARD).trim().toLowerCase();
    if (raw === WOUNDS_MODE.ALTERNATE) return WOUNDS_MODE.ALTERNATE;
  } catch (_e) {
    // no-op
  }
  return WOUNDS_MODE.STANDARD;
}

export function shouldTriggerWound({
  damageApplied = 0,
  woundThreshold = 0,
  isCriticalSuccess = false,
  newHp = null
} = {}) {
  const mode = getWoundsMode();
  const dmg = Math.max(0, Number(damageApplied) || 0);
  const wt = Math.max(0, Number(woundThreshold) || 0);
  const crit = isCriticalSuccess === true;
  const hpAfter = Number(newHp);
  const reducedToZero = Number.isFinite(hpAfter) ? hpAfter <= 0 : false;

  if (mode === WOUNDS_MODE.ALTERNATE) {
    return {
      mode,
      triggered: (dmg > 0 && crit) || reducedToZero,
      reason: (dmg > 0 && crit) ? "alternate:critical" : (reducedToZero ? "alternate:zeroHp" : "none")
    };
  }

  return {
    mode,
    triggered: (wt > 0 && dmg > wt),
    reason: (wt > 0 && dmg > wt) ? "standard:excessWT" : "none"
  };
}

