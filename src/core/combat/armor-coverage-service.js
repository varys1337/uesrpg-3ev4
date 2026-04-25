/**
 * src/core/combat/armor-coverage-service.js
 *
 * Pure armor coverage resolver for canvas/sheet presenters.
 */

import {
  ARMOR_LOCATION_KEYS,
  getArmorCoverageState,
  isArmorCoveringLocation
} from "./armor-state.js";

export const ARMOR_COVERAGE_GROUP_STATES = Object.freeze({
  NONE: "none",
  PARTIAL: "partial",
  FULL: "full"
});

const LOCATION_KEYS = Object.freeze(["Head", "Body", "LeftArm", "RightArm", "LeftLeg", "RightLeg"]);

function _emptyLocation() {
  return { covered: false, sources: [] };
}

function _emptyPayload({ actor = null, token = null } = {}) {
  const locations = {};
  for (const key of LOCATION_KEYS) locations[key] = _emptyLocation();
  return {
    actorId: actor?.id ?? null,
    tokenId: token?.id ?? token?.document?.id ?? null,
    locations,
    grouped: {
      head: ARMOR_COVERAGE_GROUP_STATES.NONE,
      body: ARMOR_COVERAGE_GROUP_STATES.NONE,
      arms: ARMOR_COVERAGE_GROUP_STATES.NONE,
      legs: ARMOR_COVERAGE_GROUP_STATES.NONE
    }
  };
}

function _resolveSubject(subject) {
  if (!subject) return { actor: null, token: null };

  if (subject?.documentName === "Actor" || subject?.items) {
    return { actor: subject, token: null };
  }

  if (subject?.documentName === "TokenDocument") {
    return { actor: subject.actor ?? null, token: subject };
  }

  if (subject?.document?.documentName === "TokenDocument" || subject?.actor) {
    return { actor: subject.actor ?? null, token: subject };
  }

  return { actor: null, token: null };
}

function _isEquippedArmor(item) {
  return String(item?.type ?? "") === "armor" && item?.system?.equipped === true;
}

function _safeSource(item, coverageState) {
  return {
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    name: String(item?.name ?? "Armor"),
    coverageState
  };
}

function _groupPair(leftCovered, rightCovered) {
  if (leftCovered && rightCovered) return ARMOR_COVERAGE_GROUP_STATES.FULL;
  if (leftCovered || rightCovered) return ARMOR_COVERAGE_GROUP_STATES.PARTIAL;
  return ARMOR_COVERAGE_GROUP_STATES.NONE;
}

function _finalizeGroups(locations) {
  return {
    head: locations.Head.covered ? ARMOR_COVERAGE_GROUP_STATES.FULL : ARMOR_COVERAGE_GROUP_STATES.NONE,
    body: locations.Body.covered ? ARMOR_COVERAGE_GROUP_STATES.FULL : ARMOR_COVERAGE_GROUP_STATES.NONE,
    arms: _groupPair(locations.LeftArm.covered, locations.RightArm.covered),
    legs: _groupPair(locations.LeftLeg.covered, locations.RightLeg.covered)
  };
}

/**
 * Resolve equipped armor coverage for an Actor/Token/TokenDocument.
 *
 * @param {Actor|Token|TokenDocument|object|null} subject
 * @param {object} [options]
 * @param {boolean} [options.isProneForArmor=false]
 * @param {number} [options.coverageDowngradeSteps=0]
 * @returns {{
 *   actorId: string|null,
 *   tokenId: string|null,
 *   locations: Object<string, {covered:boolean, sources:Array}>,
 *   grouped: {head:string, body:string, arms:string, legs:string}
 * }}
 */
export function resolveArmorCoverage(subject, options = {}) {
  const { actor, token } = _resolveSubject(subject);
  const payload = _emptyPayload({ actor, token });
  if (!actor) return payload;

  const itemList = actor.items?.contents ?? actor.items ?? [];
  for (const item of itemList) {
    if (!_isEquippedArmor(item)) continue;

    const coverageState = getArmorCoverageState(item.system ?? {}, {
      isProneForArmor: options.isProneForArmor === true,
      coverageDowngradeSteps: Number(options.coverageDowngradeSteps ?? 0) || 0
    });
    if (coverageState === ARMOR_COVERAGE_GROUP_STATES.NONE) continue;

    for (const key of ARMOR_LOCATION_KEYS) {
      if (!payload.locations[key]) continue;
      if (!isArmorCoveringLocation(item, key)) continue;
      payload.locations[key].covered = true;
      payload.locations[key].sources.push(_safeSource(item, coverageState));
    }
  }

  payload.grouped = _finalizeGroups(payload.locations);
  return payload;
}

