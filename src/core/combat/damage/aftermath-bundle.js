import { isDamageAftermathBundlingEnabled } from "../../config/automation-policy.js";
import { isAnyDebugEnabled } from "../../../utils/debug.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";

const DEBUG_LANES = Object.freeze(["woundsDebug", "spellCastingDebug"]);

function _debugEnabled(explicit = null) {
  return explicit === null ? isAnyDebugEnabled(DEBUG_LANES) : explicit === true;
}

function _debug(debug, event, data = {}) {
  if (!_debugEnabled(debug)) return;
  try {
    console.log("[UESRPG][DamageAftermath]", event, data);
  } catch (_e) {
    // no-op
  }
}

function _actorSummary(actor) {
  return {
    actor: actor?.name ?? null,
    actorUuid: actor?.uuid ?? null,
  };
}

export { isDamageAftermathBundlingEnabled };

export function createDamageAftermathBundle({
  applicationId = null,
  targetActor = null,
  source = "Attack",
  debug = null,
} = {}) {
  const operations = [];
  const committed = [];
  const failed = [];
  const base = {
    applicationId,
    source,
    ..._actorSummary(targetActor),
  };

  _debug(debug, "created", base);

  return {
    stage({ key, label, run } = {}) {
      if (typeof run !== "function") return false;
      const op = {
        key: String(key ?? `operation-${operations.length + 1}`),
        label: String(label ?? key ?? "Aftermath Operation"),
        run,
      };
      operations.push(op);
      _debug(debug, "staged", { ...base, key: op.key, label: op.label, operationCount: operations.length });
      return true;
    },

    async commit() {
      const perf = isPerfEnabled();
      const started = perf ? monoMs() : 0;

      for (const op of operations) {
        const opStarted = perf ? monoMs() : 0;
        try {
          const result = await op.run();
          const record = {
            key: op.key,
            label: op.label,
            durationMs: perf ? monoMs() - opStarted : null,
            result: result ?? null,
          };
          committed.push(record);
          _debug(debug, "committed", { ...base, ...record });
        } catch (err) {
          const record = {
            key: op.key,
            label: op.label,
            durationMs: perf ? monoMs() - opStarted : null,
            error: err?.message ?? String(err),
          };
          failed.push(record);
          console.warn(`UESRPG | Damage aftermath operation failed: ${op.label}`, err);
          _debug(debug, "failed", { ...base, ...record });
        }
      }

      const summary = this.summary();
      if (perf) {
        perfRecord({
          event: "damage.aftermath.commit",
          applicationId,
          actorUuid: targetActor?.uuid ?? null,
          operationCount: operations.length,
          committed: committed.length,
          failed: failed.length,
          durationMs: monoMs() - started,
        });
      }
      _debug(debug, "complete", summary);
      return summary;
    },

    summary() {
      return {
        ...base,
        operationCount: operations.length,
        committed: committed.map((op) => ({ ...op })),
        failed: failed.map((op) => ({ ...op })),
      };
    },
  };
}
