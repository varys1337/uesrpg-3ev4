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
  kind = "damage",
  outcomeContext = null,
} = {}) {
  const operations = [];
  const committed = [];
  const failed = [];
  const pending = [];
  const completedKeys = new Set();
  const base = {
    applicationId,
    source,
    ..._actorSummary(targetActor),
  };

  _debug(debug, "created", base);

  return {
    stage({ key, label, run, operation = null, applicable = null } = {}) {
      if (typeof run !== "function") return false;
      const op = {
        key: String(key ?? `operation-${operations.length + 1}`),
        label: String(label ?? key ?? "Aftermath Operation"),
        run,
        operation,
        applicable,
      };
      operations.push(op);
      _debug(debug, "staged", { ...base, key: op.key, label: op.label, operationCount: operations.length });
      return true;
    },

    async commit() {
      const perf = isPerfEnabled();
      const started = perf ? monoMs() : 0;

      for (const op of operations) {
        if (completedKeys.has(op.key)) continue;
        // Each staged operation runs once, including an operation that failed
        // after a partial mutation. Retrying requires a domain-specific repair.
        completedKeys.add(op.key);
        const opStarted = perf ? monoMs() : 0;
        try {
          const result = outcomeContext ? await outcomeContext.stage(`aftermath:${applicationId}:${kind}:${op.key}`, op.run, {
            documents: op.operation?.documentUuids?.map(uuid => fromUuidSync(uuid)) ?? [targetActor],
            requiresGM: op.operation?.requiresGM === true,
            applicable: op.applicable,
          }) : op.applicable && !await op.applicable() ? { skipped: true } : await op.run();
          if (result?.failed === true || result === false || result?.ok === false || ["partial", "failed"].includes(result?.execution?.status)) throw new Error(`${op.label} was not completely applied.`);
          const record = {
            key: op.key,
            label: op.label,
            durationMs: perf ? monoMs() - opStarted : null,
            result: result ?? null,
          };
          committed.push(record);
          _debug(debug, "committed", { ...base, ...record });
        } catch (err) {
          if (err.pendingGM && op.operation) {
            pending.push({ key: op.key, stageKey: `aftermath:${applicationId}:${kind}:${op.key}`, operation: op.operation });
            continue;
          }
          const record = {
            key: op.key,
            label: op.label,
            durationMs: perf ? monoMs() - opStarted : null,
            error: err?.message ?? String(err),
          };
          failed.push(record);
          console.warn(`UESRPG | Damage aftermath operation failed: ${op.label}`, err);
          _debug(debug, "failed", { ...base, ...record });
        } finally {
          if (perf) perfRecord({
            event: "damage.aftermath.operation", kind, applicationId,
            actorUuid: targetActor?.uuid ?? null, operation: op.key,
            failed: failed.some(entry => entry.key === op.key),
            writeCount: op.key === "chatSummary" ? 1 : 0, durationMs: monoMs() - opStarted,
          });
        }
      }

      const summary = this.summary();
      if (perf) {
        perfRecord({
          event: "damage.aftermath.commit",
          kind,
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
        pending: pending.map(op => ({ ...op })),
      };
    },
  };
}
