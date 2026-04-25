export async function registerMagicRuntime() {
  const [
    { initializeUpkeepSystem },
    { initializeSpellEffectExpirationSystem },
    { initializeOriginAELifecycle },
    { initializeSpellTickEngine, registerZoneTickHandler },
    { initializeOverTimeEngine },
    { initializeRuneTriggerService, seedRuneRegistry },
    { initializeConditionTriggers },
    { initializeSummonBinding },
    { initializeMindlockHook },
    { initializeBoundItemService },
    { initializeConjurationRuntime },
    { initializeSoulTrapService },
    { initializeDisintegrateService },
    { initializeDrainService },
    { initializeCloakTickHandler, seedCloakRegistry },
    _magicOpposed,
    { seedZoneRegistry }
  ] = await Promise.all([
    import("../../core/magic/upkeep-workflow.js"),
    import("../../core/magic/effects/spell-effect-expiration.js"),
    import("../../core/magic/effects/origin-effect.js"),
    import("../../core/magic/ticks/spell-tick-engine.js"),
    import("../../core/magic/ticks/overtime-engine.js"),
    import("../../core/magic/services/rune-trigger-service.js"),
    import("../../core/magic/services/condition-triggers.js"),
    import("../../core/magic/conjuration/summon-binding.js"),
    import("../../core/magic/mindlock.js"),
    import("../../core/magic/conjuration/bound-item-service.js"),
    import("../../core/magic/conjuration/conjuration-runtime.js"),
    import("../../core/magic/services/soul-trap-service.js"),
    import("../../core/magic/services/disintegrate-service.js"),
    import("../../core/magic/services/drain-service.js"),
    import("../../core/magic/ticks/cloak-tick-handler.js"),
    import("../../core/magic/opposed-workflow.js"),
    import("../../core/magic/spell-runtime.js")
  ]);

  initializeSpellEffectExpirationSystem();
  initializeUpkeepSystem();
  initializeOriginAELifecycle();
  initializeSpellTickEngine();
  registerZoneTickHandler();
  initializeOverTimeEngine();
  initializeRuneTriggerService();
  initializeConditionTriggers();
  initializeSummonBinding();
  initializeMindlockHook();
  initializeBoundItemService();
  initializeConjurationRuntime();
  initializeSoulTrapService();
  initializeDisintegrateService();
  initializeDrainService();
  initializeCloakTickHandler();

  seedZoneRegistry();
  seedRuneRegistry();
  seedCloakRegistry();
}
