import {
  openStaminaDialog,
  getActiveStaminaEffect,
  consumeStaminaEffect
} from "../../core/stamina/stamina-dialog.js";
import {
  applyPhysicalExertionBonus,
  applyPhysicalExertionToSkill,
  applyPowerAttackBonus,
  applySprintBonus,
  applyPowerDrawBonus,
  applyPowerBlockBonus,
  hasStaminaEffect
} from "../../core/stamina/stamina-integration-hooks.js";
import { AttackTracker } from "../../core/combat/attack-tracker.js";
import {
  initializeTimeService,
  initializeCombatBoundaryOrchestrator
} from "../../core/time/index.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { registerReadyRuntimeApi } from "../../api/runtime-registration.js";
import { ApplyDamageService } from "../../application/combat/apply-damage-service.js";

function buildStaminaApi() {
  return {
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
}

export async function registerSystemRuntimeApi() {
  initializeTimeService();
  initializeCombatBoundaryOrchestrator();

  const [
    { AoEService },
    { LuckAPI },
    { resolveSpellProfile, summarizeSpellProfile },
    { CastSpellService },
    { AdvanceCampaignTurnService },
    { spawnSummon, getSummonedTokens, showSummonActorPicker },
    { enumerateDispellableEffects, dispelEffects, showDispelDialog },
    { applyDamagedQuality },
    { drainMagicka, drainHealth },
    { createOverTimeConfig, hasOverTimeConfig, getOverTimeConfig, buildOverTimeChange, OVERTIME_CHANGE_KEY }
  ] = await Promise.all([
    import("../../core/aoe/index.js"),
    import("../../core/luck/luck-workflow.js"),
    import("../../core/magic/spell-profile.js"),
    import("../../application/magic/cast-spell-service.js"),
    import("../../application/campaign/advance-campaign-turn-service.js"),
    import("../../core/magic/conjuration/summon-service.js"),
    import("../../core/magic/services/dispel-service.js"),
    import("../../core/magic/services/disintegrate-service.js"),
    import("../../core/magic/services/drain-service.js"),
    import("../../core/magic/ticks/overtime-engine.js")
  ]);

  const magicApi = {
    resolveProfile: resolveSpellProfile,
    summarizeProfile: summarizeSpellProfile,
    cast: CastSpellService.cast.bind(CastSpellService),
    spawnSummon,
    getSummonedTokens,
    showSummonActorPicker,
    enumerateDispellable: enumerateDispellableEffects,
    dispel: dispelEffects,
    showDispelDialog,
    applyDamagedQuality,
    drainMagicka,
    drainHealth,
    overTime: {
      createConfig: createOverTimeConfig,
      hasConfig: hasOverTimeConfig,
      getConfig: getOverTimeConfig,
      buildChange: buildOverTimeChange,
      CHANGE_KEY: OVERTIME_CHANGE_KEY
    }
  };

  let modifierRegistry = null;
  if (game.user?.isGM && isDebugEnabled(null)) {
    const { getAllModifierKeys, validateAEChanges, isKnownModifierKey } = await import("../../core/active-effects/modifier-registry.js");
    modifierRegistry = { getAllKeys: getAllModifierKeys, validate: validateAEChanges, isKnown: isKnownModifierKey };
  }

  registerReadyRuntimeApi({
    aoe: AoEService,
    luck: LuckAPI,
    staminaApi: buildStaminaApi(),
    attackTracker: AttackTracker,
    magicApi,
    modifierRegistry,
    dumpAEKeys: (game.user?.isGM && isDebugEnabled(null))
      ? async (...args) => {
          const { dumpAEKeys } = await import("../../utils/dev/ae-keys-dump.js");
          return dumpAEKeys(...args);
        }
      : null,
    talentsApi: game.user?.isGM
      ? {
          validateLearning: async (...args) => {
            const { validateTalentLearning } = await import("../../core/traits/talent-learning.js");
            return validateTalentLearning(...args);
          }
        }
      : null,
    applicationApi: {
      damage: {
        apply: ApplyDamageService.applyResolved.bind(ApplyDamageService),
        applySimple: ApplyDamageService.applySimple.bind(ApplyDamageService),
        applyHealing: ApplyDamageService.applyHealing.bind(ApplyDamageService),
      },
      magic: {
        cast: CastSpellService.cast.bind(CastSpellService),
      },
      campaign: {
        advanceTurn: AdvanceCampaignTurnService.advanceTurn.bind(AdvanceCampaignTurnService),
      },
    },
    rootApi: game.user?.isGM
      ? {
          auditSpellPack: async (...args) => {
            const { auditSpellPack } = await import("../../utils/dev/spell-audit.js");
            return auditSpellPack(...args);
          },
          showSpellAuditReport: async (...args) => {
            const { showSpellAuditReport } = await import("../../utils/dev/spell-audit.js");
            return showSpellAuditReport(...args);
          },
          auditChapter4: async (...args) => {
            const { auditChapter4 } = await import("../../utils/dev/chapter4-audit.js");
            return auditChapter4(...args);
          },
          auditChapter6: async (...args) => {
            const { auditChapter6 } = await import("../../utils/dev/chapter6-audit.js");
            return auditChapter6(...args);
          },
          auditChapter6Spells: async (...args) => {
            const { auditChapter6Spells } = await import("../../utils/dev/chapter6-audit.js");
            return auditChapter6Spells(...args);
          },
          planChapter6SpellRemediation: async (...args) => {
            const { planChapter6SpellRemediation } = await import("../../utils/dev/chapter6-spell-remediation.js");
            return planChapter6SpellRemediation(...args);
          },
          applyChapter6SpellRemediation: async (...args) => {
            const { applyChapter6SpellRemediation } = await import("../../utils/dev/chapter6-spell-remediation.js");
            return applyChapter6SpellRemediation(...args);
          },
          syncReligionContentPacks: async (...args) => {
            const { syncReligionContentPacks } = await import("../../core/religion/content-sync.js");
            return syncReligionContentPacks(...args);
          }
        }
      : null,
  });

  if (game.user?.isGM && isDebugEnabled(null)) {
    const { registerSpellProfileTest } = await import("../../utils/dev/spell-profile-test.js");
    registerSpellProfileTest();
  }
}
