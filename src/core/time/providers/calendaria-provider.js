/**
 * src/core/time/providers/calendaria-provider.js
 *
 * Optional adapter for the Calendaria module.
 *
 * This adapter never becomes the authoritative source of world time. It only provides
 * calendar-aware conversions and formatting when Calendaria is enabled and its API is present.
 */

export class CalendariaProvider {
  static id = "calendaria";

  /**
   * @returns {boolean}
   */
  isAvailable() {
    return Boolean(game?.modules?.get?.("calendaria")?.active) && Boolean(globalThis?.CALENDARIA?.api);
  }

  /**
   * @returns {object|null} Calendaria API (shape is module-defined).
   */
  getApi() {
    return this.isAvailable() ? globalThis.CALENDARIA.api : null;
  }

  /**
   * Convert a world time (seconds) to Calendaria DateTime.
   * @param {number} worldTimeSeconds
   * @returns {object|null}
   */
  timestampToDate(worldTimeSeconds) {
    const api = this.getApi();
    const fn = api?.timestampToDate;
    if (typeof fn !== "function") return null;
    const t = Number(worldTimeSeconds ?? 0);
    return fn(Number.isFinite(t) ? t : 0);
  }

  /**
   * Convert a Calendaria DateTime to world time seconds.
   * @param {object} dateTime
   * @returns {number|null}
   */
  dateToTimestamp(dateTime) {
    const api = this.getApi();
    const fn = api?.dateToTimestamp;
    if (typeof fn !== "function") return null;
    const t = fn(dateTime);
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Format a Calendaria DateTime.
   * @param {object} dateTime
   * @param {object} options
   * @returns {string|null}
   */
  formatDateTime(dateTime, options = {}) {
    const api = this.getApi();
    const fn = api?.formatDateTime;
    if (typeof fn !== "function") return null;
    try {
      return fn(dateTime, options ?? {});
    } catch (_err) {
      return null;
    }
  }

  /**
   * @returns {string} Calendaria hook name for time changes.
   */
  getDateTimeChangeHookName() {
    return "calendaria.dateTimeChange";
  }
}
