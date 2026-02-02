/**
 * src/core/time/providers/foundry-core-provider.js
 *
 * Authoritative world time provider based on Foundry core GameTime.
 *
 * This provider is always available and is the source of truth for canonical world time seconds.
 */

export class FoundryCoreProvider {
  static id = "foundry-core";

  /**
   * @returns {number} The current world time in seconds.
   */
  getWorldTimeSeconds() {
    const wt = Number(game?.time?.worldTime ?? 0);
    return Number.isFinite(wt) ? wt : 0;
  }

  /**
   * @returns {number} The configured combat round time in seconds.
   */
  getRoundTimeSeconds() {
    const rt = Number(CONFIG?.time?.roundTime ?? 6);
    return Number.isFinite(rt) && rt > 0 ? rt : 6;
  }

  /**
   * @returns {foundry.data.CalendarData | null}
   */
  getCalendar() {
    return game?.time?.calendar ?? null;
  }

  /**
   * Convert seconds to calendar components.
   * @param {number} worldTimeSeconds
   * @returns {object|null}
   */
  timeToComponents(worldTimeSeconds) {
    const cal = this.getCalendar();
    if (!cal || typeof cal.timeToComponents !== "function") return null;
    const t = Number(worldTimeSeconds ?? 0);
    return cal.timeToComponents(Number.isFinite(t) ? t : 0);
  }

  /**
   * Convert calendar components to seconds.
   * @param {object} components
   * @returns {number|null}
   */
  componentsToTime(components) {
    const cal = this.getCalendar();
    if (!cal || typeof cal.componentsToTime !== "function") return null;
    if (!components || typeof components !== "object") return null;
    const t = cal.componentsToTime(components);
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Format a timestamp or calendar components using Foundry's calendar.
   * @param {number|object|null} time
   * @param {string|Function|null} formatter
   * @param {object} options
   * @returns {string}
   */
  format(time = null, formatter = "timestamp", options = {}) {
    const cal = this.getCalendar();
    if (!cal || typeof cal.format !== "function") return String(time ?? "");

    try {
      return cal.format(time ?? this.getWorldTimeSeconds(), formatter ?? "timestamp", options ?? {});
    } catch (_err) {
      return String(time ?? "");
    }
  }
}
