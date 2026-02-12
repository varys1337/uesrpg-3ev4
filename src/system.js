import startupHandler from './hooks/startup.js';
import initHandler from './hooks/init.js';
import { openStaminaDialog, getActiveStaminaEffect, consumeStaminaEffect } from "./core/stamina/stamina-dialog.js";
import { 
  applyPhysicalExertionBonus, 
  applyPhysicalExertionToSkill,
  applyPowerAttackBonus,
  applySprintBonus,
  applyPowerDrawBonus,
  applyPowerBlockBonus,
  hasStaminaEffect
} from "./core/stamina/stamina-integration-hooks.js";
import { AttackTracker } from "./core/combat/attack-tracker.js";
import { initializeTimeService } from "./core/time/index.js";

Hooks.once('ready', async function () {
  console.log(`UESRPG | Ready`);

  // ── World compatibility gate ──────────────────────────────────────────
  // This build is new-world-only: no document migrations ship.
  // If the world was created under an older system version, warn the GM
  // and bail out of further initialization.
  const currentVersion = game.system?.version ?? "";
  const stampedVersion = game.settings.get("uesrpg-3ev4", "worldDataVersion");

  if (!stampedVersion) {
    // First launch in this world — stamp it.
    try {
      await game.settings.set("uesrpg-3ev4", "worldDataVersion", currentVersion);
      console.log(`UESRPG | World data version stamped: ${currentVersion}`);
    } catch (err) {
      console.warn("UESRPG | Failed to stamp world data version", err);
    }
  } else if (stampedVersion !== currentVersion) {
    // Mismatch — world was last used with a different system build.
    if (game.user?.isGM) {
      ui.notifications.error(
        `UESRPG | This world was created with system version ${stampedVersion} ` +
        `but the current system version is ${currentVersion}. ` +
        `This build does not include data migrations. ` +
        `Please create a new world and import compendia to upgrade.`,
        { permanent: true }
      );
      new Dialog({
        title: "UESRPG — Unsupported World",
        content: `<p>This world was last used with system version <strong>${stampedVersion}</strong>, ` +
          `but the current system is <strong>${currentVersion}</strong>.</p>` +
          `<p>This build is <em>new-world-only</em> and does not include automatic data migrations. ` +
          `Continuing may cause errors or data inconsistencies.</p>` +
          `<p><strong>Recommended:</strong> Create a new world and import your compendia.</p>`,
        buttons: {
          understood: { icon: '<i class="fas fa-check"></i>', label: "Understood", callback: () => {} }
        },
        default: "understood"
      }).render(true);
    }
    console.warn(`UESRPG | World version mismatch: stamped=${stampedVersion}, current=${currentVersion}. Skipping further init.`);
    return;
  }

  await startupHandler();
  
  // Lazy-load magic/combat subsystem initializers (deferred from top-level imports
  // to reduce parse time during initial module load; each is needed exactly once here).
  const [
    { initializeUpkeepSystem },
    { initializeSpellEffectExpirationSystem },
    { initializeOriginAELifecycle },
    { initializeSpellTickEngine, registerZoneTickHandler },
    { initializeOverTimeEngine },
    { initializeRuneTriggerService },
    { initializeConditionTriggers },
    { initializeSummonBinding },
    { initializeBoundItemService },
    { initializeConjurationRuntime },
    { initializeSoulTrapService },
    { initializeDisintegrateService },
    { initializeDrainService },
    { initializeCharacteristicDefenseService },
    { initializeCloakTickHandler }
  ] = await Promise.all([
    import("./core/magic/upkeep-workflow.js"),
    import("./core/magic/effects/spell-effect-expiration.js"),
    import("./core/magic/effects/origin-effect.js"),
    import("./core/magic/ticks/spell-tick-engine.js"),
    import("./core/magic/ticks/overtime-engine.js"),
    import("./core/magic/services/rune-trigger-service.js"),
    import("./core/magic/services/condition-triggers.js"),
    import("./core/magic/conjuration/summon-binding.js"),
    import("./core/magic/conjuration/bound-item-service.js"),
    import("./core/magic/conjuration/conjuration-runtime.js"),
    import("./core/magic/services/soul-trap-service.js"),
    import("./core/magic/services/disintegrate-service.js"),
    import("./core/magic/services/drain-service.js"),
    import("./core/magic/characteristic-defense-service.js"),
    import("./core/magic/ticks/cloak-tick-handler.js")
  ]);

  // Initialize spell upkeep system
  initializeUpkeepSystem();
  initializeSpellEffectExpirationSystem();

  // Initialize Origin AE lifecycle (auto-teardown on deletion)
  initializeOriginAELifecycle();

  // Initialize spell tick engine (zone ticks, rune time triggers, etc.)
  initializeSpellTickEngine();
  registerZoneTickHandler();

  // Initialize OverTime effects engine (DoT/HoT/saves per tick)
  initializeOverTimeEngine();

  // Initialize rune/trap trigger detection (proximity + time triggers)
  initializeRuneTriggerService();

  // Initialize condition triggers (invisibility break, etc.)
  initializeConditionTriggers();

  // Initialize summon binding (Mindlock, Restrained, binding prompt)
  initializeSummonBinding();

  // Initialize bound item service (Conjure [Weapon/Armor] lifecycle — legacy flag-based)
  initializeBoundItemService();

  // Initialize conjuration runtime (engine.conjure-based item conjuring & creature summoning)
  initializeConjurationRuntime();

  // Initialize Soul Trap death hook (soul gem creation on target death)
  initializeSoulTrapService();

  // Initialize Disintegrate automation (Damaged quality on armor/weapon)
  initializeDisintegrateService();

  // Initialize Drain automation (current pool drains without max reduction)
  initializeDrainService();

  // Initialize characteristic defense (save-like defense model for spells)
  initializeCharacteristicDefenseService();

  // Initialize cloak tick handler (AoE aura tick damage at end of turn)
  initializeCloakTickHandler();
});

Hooks.once("init", async function() {
  console.log(`UESRPG | Initializing`);
  await initHandler();
  
  // Register Handlebars helpers
  Handlebars.registerHelper('capitalize', function(str) {
    const s = String(str || '');
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  if (!Handlebars.helpers?.inc) {
    Handlebars.registerHelper('inc', function(n) { return Number(n ?? 0) + 1; });
  }
  // Expose AE key inspection helper (lazy-loaded; dev/debug only)
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.dumpAEKeys = async (...args) => {
    const { dumpAEKeys } = await import("./utils/dev/ae-keys-dump.js");
    return dumpAEKeys(...args);
  };

  // Initialize system-wide time API
  initializeTimeService();

  // Expose AoE service (universal template placement)
  const { AoEService } = await import("./core/aoe/index.js");
  game.uesrpg.aoe = AoEService;
  
  // Expose stamina helpers
  game.uesrpg.stamina = {
    openDialog: openStaminaDialog,
    getActiveEffect: getActiveStaminaEffect,
    consumeEffect: consumeStaminaEffect,
    applyPhysicalExertion: applyPhysicalExertionBonus,
    applyPhysicalExertionToSkill,
    applyPowerAttack: applyPowerAttackBonus,
    applySprint: applySprintBonus,
    applyPowerDraw: applyPowerDrawBonus,
    applyPowerBlock: applyPowerBlockBonus,
    hasEffect: hasStaminaEffect
  };
  
  // Expose attack tracker
  game.uesrpg.AttackTracker = AttackTracker;
  
  // Expose magic spell profile API (Phase 1: Stability & Parity)
  const { resolveSpellProfile, summarizeSpellProfile } = await import("./core/magic/spell-profile.js");
  const { SpellCastingService } = await import("./core/magic/casting-service.js");
  game.uesrpg.magic = game.uesrpg.magic || {};
  game.uesrpg.magic.resolveProfile = resolveSpellProfile;
  game.uesrpg.magic.summarizeProfile = summarizeSpellProfile;
  game.uesrpg.magic.cast = SpellCastingService.cast.bind(SpellCastingService);
  
  // Expose summon service API (GM-only token spawning)
  const { spawnSummon, getSummonedTokens, showSummonActorPicker } = await import("./core/magic/conjuration/summon-service.js");
  game.uesrpg.magic.spawnSummon = spawnSummon;
  game.uesrpg.magic.getSummonedTokens = getSummonedTokens;
  game.uesrpg.magic.showSummonActorPicker = showSummonActorPicker;
  
  // Expose dispel service API
  const { enumerateDispellableEffects, dispelEffects, showDispelDialog } = await import("./core/magic/services/dispel-service.js");
  game.uesrpg.magic.enumerateDispellable = enumerateDispellableEffects;
  game.uesrpg.magic.dispel = dispelEffects;
  game.uesrpg.magic.showDispelDialog = showDispelDialog;
  
  // Expose disintegrate helper API
  const { applyDamagedQuality } = await import("./core/magic/services/disintegrate-service.js");
  game.uesrpg.magic.applyDamagedQuality = applyDamagedQuality;
  
  // Expose drain helper API
  const { drainMagicka, drainHealth } = await import("./core/magic/services/drain-service.js");
  game.uesrpg.magic.drainMagicka = drainMagicka;
  game.uesrpg.magic.drainHealth = drainHealth;
  
  // Expose modifier registry API (dev/debugging)
  const { getAllModifierKeys, validateAEChanges, isKnownModifierKey } = await import("./core/active-effects/modifier-registry.js");
  game.uesrpg.modifierRegistry = { getAllKeys: getAllModifierKeys, validate: validateAEChanges, isKnown: isKnownModifierKey };
  
  // Expose OverTime helpers (authoring, inspection)
  const { createOverTimeConfig, hasOverTimeConfig, getOverTimeConfig, buildOverTimeChange, OVERTIME_CHANGE_KEY } = await import("./core/magic/ticks/overtime-engine.js");
  game.uesrpg.magic.overTime = { createConfig: createOverTimeConfig, hasConfig: hasOverTimeConfig, getConfig: getOverTimeConfig, buildChange: buildOverTimeChange, CHANGE_KEY: OVERTIME_CHANGE_KEY };
  
  // Register spell profile test utility (development/debugging)
  const { registerSpellProfileTest } = await import("./utils/dev/spell-profile-test.js");
  registerSpellProfileTest();

  // Expose spell audit utility (GM debugging/quality assurance)
  const { auditSpellPack, showSpellAuditReport } = await import("./utils/dev/spell-audit.js");
  game.uesrpg.auditSpellPack = auditSpellPack;
  game.uesrpg.showSpellAuditReport = showSpellAuditReport;

  // Note: The prior GM-only "AE Keys" sheet header button was a debugging aid.
  // It has been removed; the helper remains available as game.uesrpg.dumpAEKeys(...).
});
