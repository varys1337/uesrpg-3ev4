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
    if (!api) return null;
    const rawOptions = options ?? {};

    // Legacy/alternate surface.
    const fnDateTime = api?.formatDateTime;
    if (typeof fnDateTime === "function") {
      try {
        const value = fnDateTime(dateTime, rawOptions);
        return value == null ? null : String(value);
      } catch (_err) {
        /* fall through to formatDate */
      }
    }

    // Current Calendaria API surface uses formatDate(components, formatOrPreset).
    const fnDate = api?.formatDate;
    if (typeof fnDate !== "function") return null;
    try {
      const components = dateTime ?? api?.getCurrentDateTime?.() ?? null;
      const formatOrPreset = String(rawOptions?.formatOrPreset ?? rawOptions?.preset ?? "dateLong");
      const value = fnDate(components, formatOrPreset);
      return value == null ? null : String(value);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Advance world time by a delta (seconds).
   * @param {number} deltaSeconds
   * @returns {Promise<number|null>}
   */
  async advanceTimeSeconds(deltaSeconds) {
    const api = this.getApi();
    const fn = api?.advanceTime;
    if (typeof fn !== "function") return null;
    const delta = Number(deltaSeconds ?? 0);
    if (!Number.isFinite(delta) || delta === 0) {
      const now = Number(game?.time?.worldTime ?? 0);
      return Number.isFinite(now) ? now : 0;
    }
    try {
      const out = await fn(delta);
      const n = Number(out);
      return Number.isFinite(n) ? n : null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Advance world time to a supported preset (e.g. sunrise).
   * @param {string} preset
   * @returns {Promise<number|null>}
   */
  async advanceToPreset(preset) {
    const api = this.getApi();
    const fn = api?.advanceTimeToPreset;
    if (typeof fn !== "function") return null;
    const key = String(preset ?? "").trim().toLowerCase();
    if (!key) return null;
    try {
      const out = await fn(key);
      const n = Number(out);
      return Number.isFinite(n) ? n : null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Read Calendaria rest-related settings.
   * @returns {{advanceTimeOnRest:boolean, restToSunrise:boolean}|null}
   */
  getSettings() {
    if (!this.isAvailable()) return null;
    try {
      return {
        advanceTimeOnRest: Boolean(game?.settings?.get?.("calendaria", "advanceTimeOnRest")),
        restToSunrise: Boolean(game?.settings?.get?.("calendaria", "restToSunrise")),
      };
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
