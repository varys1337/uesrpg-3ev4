const VALID_TRIGGERS = Object.freeze(new Set([
  "turnStart",
  "turnEnd",
  "roundStart",
  "roundEnd",
  "worldTime",
]));

function _str(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _numOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _timingForTrigger(trigger) {
  if (trigger === "turnStart" || trigger === "turnEnd") return "turn";
  if (trigger === "roundStart" || trigger === "roundEnd") return "round";
  if (trigger === "worldTime") return "worldTime";
  return "unknown";
}

/**
 * Normalize an OverTime runtime config into an internal cadence descriptor.
 * This descriptor is not stored on documents.
 *
 * @param {object} config
 * @returns {{trigger:string,timing:string,unit:string,every:number,key:string,valid:boolean}}
 */
export function normalizeOverTimeCadence(config = {}) {
  const trigger = _str(config?.trigger, "turnStart");
  const unit = _str(config?.cadenceUnit, "rounds").toLowerCase();
  const every = Math.max(0, _num(config?.cadenceEvery, 1));
  const timing = _timingForTrigger(trigger);
  return {
    trigger,
    timing,
    unit,
    every,
    key: `${trigger}:${unit}:${every}`,
    valid: VALID_TRIGGERS.has(trigger),
  };
}

/**
 * Determine whether a normalized cadence is eligible for the current tick.
 *
 * Unknown units keep legacy behavior by matching, but report that reason for
 * debug provenance.
 *
 * @param {{trigger:string,timing:string,unit:string,every:number,key:string,valid:boolean}} cadence
 * @param {object} tickState
 * @param {{round?:number,worldTime?:number}} ctx
 * @returns {{matched:boolean,reason:string,elapsed:number|null,required:number}}
 */
export function doesCadenceMatch(cadence, tickState = {}, ctx = {}) {
  if (!cadence?.valid) {
    return { matched: false, reason: "invalidTrigger", elapsed: null, required: Math.max(0, _num(cadence?.every, 1)) };
  }

  const every = Math.max(0, _num(cadence?.every, 1));
  if (every <= 0) return { matched: true, reason: "everyTick", elapsed: 0, required: every };

  if (cadence.unit === "rounds") {
    const lastRound = _numOrNull(tickState?.lastTickRound);
    if (lastRound === null) return { matched: true, reason: "firstTick", elapsed: null, required: every };
    const elapsed = _num(ctx?.round, 0) - lastRound;
    return {
      matched: elapsed >= every,
      reason: elapsed >= every ? "elapsed" : "cadencePending",
      elapsed,
      required: every,
    };
  }

  if (cadence.unit === "seconds") {
    const lastTime = _numOrNull(tickState?.lastTickWorldTime);
    if (lastTime === null) return { matched: true, reason: "firstTick", elapsed: null, required: every };
    const elapsed = _num(ctx?.worldTime, 0) - lastTime;
    return {
      matched: elapsed >= every,
      reason: elapsed >= every ? "elapsed" : "cadencePending",
      elapsed,
      required: every,
    };
  }

  return { matched: true, reason: "unknownUnitAllowed", elapsed: null, required: every };
}

export { VALID_TRIGGERS as OVERTIME_VALID_TRIGGERS };
