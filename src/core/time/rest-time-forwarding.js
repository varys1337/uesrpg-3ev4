/**
 * src/core/time/rest-time-forwarding.js
 *
 * Group-rest time forwarding policy for UESRPG.
 * Time forwarding is intentionally scoped to Group actor-initiated rests.
 */

import { TimeService } from "./time-service.js";

const SHORT_REST_SECONDS = 60 * 60;
const LONG_REST_SECONDS = 8 * 60 * 60;

/**
 * @param {object} options
 * @param {string} options.restType - "short" | "long"
 * @param {Actor|null} [options.actor]
 * @param {string|null} [options.actorLabel]
 * @returns {Promise<{applied:boolean, mode:string, deltaSeconds:number, reason:string|null}>}
 */
export async function forwardTimeForGroupRest({ restType, actor = null, actorLabel = null } = {}) {
  const result = {
    applied: false,
    mode: "none",
    deltaSeconds: 0,
    reason: null,
  };

  const normalizedRestType = String(restType ?? "").trim().toLowerCase();
  if (normalizedRestType !== "short" && normalizedRestType !== "long") {
    result.reason = "Invalid rest type.";
    return result;
  }

  // Defensive guard: this utility is only intended for Group actors.
  if (actor && String(actor?.type ?? "").toLowerCase() !== "group") {
    result.reason = "Time forwarding is only enabled for Group actor rests.";
    return result;
  }

  if (!TimeService.isCalendariaActive()) {
    result.reason = "Calendaria is not active.";
    return result;
  }

  const calendaria = TimeService.getCalendariaApi();
  if (!calendaria) {
    result.reason = "Calendaria API is unavailable.";
    return result;
  }

  let advanceTimeOnRest = false;
  let restToSunrise = false;
  try {
    advanceTimeOnRest = Boolean(game?.settings?.get?.("calendaria", "advanceTimeOnRest"));
    restToSunrise = Boolean(game?.settings?.get?.("calendaria", "restToSunrise"));
  } catch (_err) {
    result.reason = "Could not read Calendaria rest settings.";
    return result;
  }

  if (!advanceTimeOnRest) {
    result.reason = "Calendaria rest-time advancement is disabled.";
    return result;
  }

  try {
    const before = Number(TimeService.getWorldTimeSeconds() ?? game.time?.worldTime ?? 0);

    if (normalizedRestType === "short") {
      await TimeService.advanceWorldTimeSeconds(SHORT_REST_SECONDS, {
        source: "group-rest-short",
        actorLabel: actorLabel ?? actor?.name ?? null,
      });
      const after = Number(TimeService.getWorldTimeSeconds() ?? game.time?.worldTime ?? before);
      const delta = Math.max(0, after - before);
      if (delta <= 0) {
        result.reason = "Short-rest time forwarding did not change world time.";
        return result;
      }
      result.applied = true;
      result.mode = "fixed-short";
      result.deltaSeconds = delta;
      return result;
    }

    if (restToSunrise) {
      await TimeService.advanceWorldTimeToPreset("sunrise", {
        source: "group-rest-long-sunrise",
        actorLabel: actorLabel ?? actor?.name ?? null,
      });
      const after = Number(TimeService.getWorldTimeSeconds() ?? game.time?.worldTime ?? before);
      const delta = Math.max(0, after - before);
      if (delta <= 0) {
        result.reason = "Sunrise time forwarding did not change world time.";
        return result;
      }
      result.applied = true;
      result.mode = "sunrise";
      result.deltaSeconds = delta;
      return result;
    }

    await TimeService.advanceWorldTimeSeconds(LONG_REST_SECONDS, {
      source: "group-rest-long",
      actorLabel: actorLabel ?? actor?.name ?? null,
    });
    const after = Number(TimeService.getWorldTimeSeconds() ?? game.time?.worldTime ?? before);
    const delta = Math.max(0, after - before);
    if (delta <= 0) {
      result.reason = "Long-rest time forwarding did not change world time.";
      return result;
    }
    result.applied = true;
    result.mode = "fixed-long";
    result.deltaSeconds = delta;
    return result;
  } catch (err) {
    result.reason = String(err?.message ?? err ?? "Unknown time-forwarding failure.");
    return result;
  }
}
