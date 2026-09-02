import initHandler from "./hooks/init.js";
import { isPerfEnabled, monoMs, perfRecord } from "./utils/perf-tracker.js";
import { registerWarfareProfiles } from "./hooks/init/register-warfare-profiles.js";
import { registerSystemRuntimeApi } from "./hooks/init/register-system-runtime-api.js";
import { registerSystemMacroApis } from "./hooks/init/register-system-macro-apis.js";
import { runWorldReadyMaintenance } from "./hooks/ready/run-world-ready-maintenance.js";
import { registerReadyRuntimeDevApi } from "./hooks/ready/register-ready-runtime-api.js";
import { registerMagicRuntime } from "./hooks/ready/register-magic-runtime.js";
import { registerSystemDeferredTasks } from "./hooks/ready/register-system-deferred-tasks.js";

function registerSystemHandlebarsHelpers() {
  Handlebars.registerHelper("capitalize", function(str) {
    const s = String(str || "");
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  if (!Handlebars.helpers?.inc) {
    Handlebars.registerHelper("inc", function(n) { return Number(n ?? 0) + 1; });
  }
}

Hooks.once("ready", async function () {
  const readyStartedAt = isPerfEnabled() ? monoMs() : 0;

  await runWorldReadyMaintenance();
  await registerMagicRuntime();
  registerReadyRuntimeDevApi();
  registerSystemDeferredTasks();

  if (isPerfEnabled()) {
    perfRecord({
      event: "system.ready",
      durationMs: monoMs() - readyStartedAt,
    });
  }
});

Hooks.once("setup", function() {
  void Promise.all([
    registerWarfareProfiles(),
    registerSystemRuntimeApi(),
    registerSystemMacroApis(),
  ]).catch((err) => {
    console.error("UESRPG | Optional setup initialization failed", err);
  });
});

Hooks.once("init", function() {
  const initStartedAt = isPerfEnabled() ? monoMs() : 0;

  initHandler();
  registerSystemHandlebarsHelpers();
  if (isPerfEnabled()) {
    perfRecord({
      event: "system.init.initHandler",
      durationMs: monoMs() - initStartedAt,
    });
  }

});
