/**
 * src/core/wounds/wound-schema.js
 *
 * Canonical wound constants and helpers.
 */
import { isAnyDebugEnabled, isDebugEnabled } from "../../utils/debug.js";
import { isActiveGMUser } from "../../utils/users.js";

export { isActiveGMUser };

export const WOUND_SOCKET_VERSION = 1;
export const WOUND_SOCKET_TYPES = Object.freeze(["damageApplied", "healingApplied", "resolveShock"]);

// Keep for internal/reference parity with historical wound kind lanes.
const WOUND_KINDS = Object.freeze([
  "wound",
  "bloodLoss",
  "forestall",
  "firstAid",
  "shockCard",
  "shockCripple",
  "shockCrippledLimb",
  "shockCrippleBody",
  "shockStunned",
  "shockLostLimb",
  "shockLostEar",
  "shockLostEye"
]);

export const SHOCK_KINDS = Object.freeze([
  "shockCard",
  "shockCripple",
  "shockCrippledLimb",
  "shockCrippleBody",
  "shockStunned",
  "shockLostLimb",
  "shockLostEar",
  "shockLostEye"
]);

export const SHOCK_KIND_ALIASES = Object.freeze(new Map([
  ["shockCrippledLimb", "shockCripple"]
]));

export const SHOCK_MAGIC_TYPES = Object.freeze(["fire", "frost", "shock", "poison", "magic"]);

export function canonicalizeShockKind(kind) {
  const raw = String(kind ?? "").trim();
  if (!raw) return "";
  return SHOCK_KIND_ALIASES.get(raw) ?? raw;
}

export function isShockKind(kind) {
  const canonical = canonicalizeShockKind(kind);
  return SHOCK_KINDS.includes(canonical);
}

export function shockKindMatches(candidate, expectedCanonical) {
  const a = canonicalizeShockKind(candidate);
  const b = canonicalizeShockKind(expectedCanonical);
  return Boolean(a) && Boolean(b) && a === b;
}

export function normalizeDamageTypeKey(dt) {
  const k = String(dt ?? "").trim().toLowerCase();
  if (k === "electric" || k === "lightning") return "shock";
  return k;
}

function _titleCase(label) {
  return String(label ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function _hitLocationKeyFromLabel(label) {
  const l = String(label ?? "").toLowerCase();
  if (!l) return "body";
  if (l.includes("head")) return "head";
  if (l.includes("body") || l.includes("torso") || l.includes("chest") || l.includes("abd")) return "body";
  if (l.includes("left") && l.includes("arm")) return "leftArm";
  if (l.includes("right") && l.includes("arm")) return "rightArm";
  if (l.includes("left") && l.includes("hand")) return "leftHand";
  if (l.includes("right") && l.includes("hand")) return "rightHand";
  if (l.includes("left") && l.includes("leg")) return "leftLeg";
  if (l.includes("right") && l.includes("leg")) return "rightLeg";
  if (l.includes("left") && (l.includes("foot") || l.includes("feet"))) return "leftFoot";
  if (l.includes("right") && (l.includes("foot") || l.includes("feet"))) return "rightFoot";
  if (l.includes("arm")) return "arm";
  if (l.includes("hand")) return "hand";
  if (l.includes("leg")) return "leg";
  if (l.includes("foot") || l.includes("feet")) return "foot";
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => (i === 0 ? w : (w.charAt(0).toUpperCase() + w.slice(1))))
    .join("");
}

function _hitRegionFromKeyOrLabel(key, label) {
  const k = String(key ?? "").toLowerCase();
  const l = String(label ?? "").toLowerCase();
  if (k.includes("head") || l.includes("head")) return "head";
  if (k.includes("arm") || k.includes("leg") || k.includes("hand") || k.includes("foot")) return "limb";
  if (l.includes("arm") || l.includes("leg") || l.includes("hand") || l.includes("foot")) return "limb";
  return "body";
}

export function normalizeHitLocation(hitLocation) {
  const raw = String(hitLocation ?? "").trim();
  const low = raw.toLowerCase();

  let label = "";
  if (!raw) {
    label = "Body";
  } else if (low.includes("head")) {
    label = "Head";
  } else if (low.includes("arm")) {
    label = low.includes("left") ? "Left Arm" : low.includes("right") ? "Right Arm" : "Arm";
  } else if (low.includes("leg")) {
    label = low.includes("left") ? "Left Leg" : low.includes("right") ? "Right Leg" : "Leg";
  } else if (low.includes("hand")) {
    label = low.includes("left") ? "Left Hand" : low.includes("right") ? "Right Hand" : "Hand";
  } else if (low.includes("foot") || low.includes("feet")) {
    label = low.includes("left") ? "Left Foot" : low.includes("right") ? "Right Foot" : "Foot";
  } else if (low.includes("torso") || low.includes("body") || low.includes("chest") || low.includes("abd")) {
    label = "Body";
  } else {
    label = _titleCase(raw);
  }

  const key = _hitLocationKeyFromLabel(label);
  const region = _hitRegionFromKeyOrLabel(key, label);

  return { label, key, region };
}

// Retained for local wounds debug gating compatibility.
function isWoundsDebugEnabled() {
  if (isDebugEnabled("woundsDebug")) return true;
  return isAnyDebugEnabled(["opposedDebug", "debugSkillTN", "skillRollDebug"]);
}
