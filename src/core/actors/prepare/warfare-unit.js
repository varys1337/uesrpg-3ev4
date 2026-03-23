/**
 * src/core/actors/prepare/warfare-unit.js
 *
 * Profile-aware derived data preparation for Warfare Unit actors.
 * Isolated from PC/NPC/Group prep — no shared combat, magic, or encumbrance paths.
 *
 * Delegates all catalog lookups and derived computation to the active profile
 * resolved via the mass-warfare profile registry.
 */

import { resolveWarfareProfile } from "../../mass-warfare/index.js";
import { FLAG_SCOPE } from "../../constants.js";

// ── Legacy re-exports for backward compatibility ─────────────────────────────
// Sheet code and external callers that imported these constants directly from
// this module can still do so. The canonical source is now the profile catalog.
export {
  RANKS,
  CATEGORIES,
  TRADITIONS,
  APPAREL,
  GEAR_TIERS,
  MOUNTS,
  RACIAL_PRESETS,
  EQUIPMENT_CATALOG,
  IMPLEMENT_CATALOG,
} from "../../mass-warfare/profiles/uesrpg-0_2.js";

/**
 * Prepare derived data for a Warfare Unit actor.
 * Called from SimpleActor.prepareDerivedData() when actor.type === "Warfare Unit".
 *
 * @param {SimpleActor} _actorContext — actor instance (unused; mutates actorData.system)
 * @param {SimpleActor} actorData — same reference; actorData.system is mutated in-place
 */
export function prepareWarfareUnitData(_actorContext, actorData) {
  const sys = actorData.system;
  if (!sys) return;

  // Resolve the active profile for this unit.
  const profileId = String(sys.profile?.id ?? "uesrpg-0_2");
  const profile = resolveWarfareProfile(profileId);

  // Delegate all derived computation to the profile.
  try {
    profile.computeDerived(sys);
  } catch (err) {
    console.error(`UESRPG | Warfare Unit derive failed for profile "${profileId}"`, err);
    // Ensure _derived exists so templates don't crash.
    sys._derived ??= {
      profileId,
      db: 0,
      bulk: 1,
      conditionMax: 0,
      resolveMax: 0,
      resolveCurrent: 0,
      resolveLossTotal: 0,
      bulkLossThreshold: 1,
      tierLabel: "Light",
      mountLabel: "None",
      mountTrait: "",
      categoryKey: "",
      categoryLabel: "Unassigned",
      rankLabel: "",
      traditionLabel: "",
      isWarrior: false,
      isSkirmisher: false,
      isAuxiliary: false,
      leaderless: false,
      warnings: [`Profile "${profileId}" computation failed.`],
    };
  }

  const effects = Array.from(_actorContext?.effects ?? []);
  const hasWarfareKey = (key) => effects.some((effect) => !effect.disabled && (
    effect?.flags?.[FLAG_SCOPE]?.key === key || effect?.flags?.uesrpg?.key === key
  ));
  sys._derived ??= {};
  sys._derived.holdActive = hasWarfareKey("holdNextDefend");
  if (hasWarfareKey("charge")) {
    const baseSpeed = Number(sys.stats?.speed?.value ?? 0) || 0;
    sys._derived.speedBeforeCharge = baseSpeed;
    sys._derived.chargeActive = true;
    sys.stats.speed.value = Math.max(0, baseSpeed * 2);
  } else {
    sys._derived.chargeActive = false;
  }

  // Commander normalization (profile-independent).
  if (!sys.commander || typeof sys.commander !== "object") {
    sys.commander = { uuid: "", id: "", name: "", img: "" };
  }
  if (!sys.commanderAttachment || typeof sys.commanderAttachment !== "object") {
    sys.commanderAttachment = { leaderActorUuid: "", warfareTokenUuid: "", leaderTokenUuid: "", sceneId: "" };
  }
}
