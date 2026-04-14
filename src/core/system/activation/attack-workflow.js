import { OpposedWorkflow } from "../../combat/opposed-workflow.js";
import { getHitLocationFromRoll } from "../../combat/combat-utils.js";
import { filterTargetsBySpellRange, getSpellAoEConfig, getSpellRangeType, getSpellMaxRangeMeters } from "../../magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../aoe/index.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import {
  getTargetsFromContext,
  resolveTokenForActor,
  resolveTokenTarget,
  getHitLocationMode,
  getAttackModeFromActivation,
  normalizeActivationDamage,
  normalizeActivationTags
} from "./helpers.js";

async function promptHitLocationChoice({ title = "Select Hit Location", defaultValue = "Body" } = {}) {
  const locations = ["Head", "Body", "Right Arm", "Left Arm", "Right Leg", "Left Leg"];
  const options = locations.map((location) => {
    const selected = location === defaultValue ? " selected" : "";
    return `<option value="${location}"${selected}>${location}</option>`;
  }).join("\n");

  return customDialog({
    title,
    content: `
      <div class="uesrpg-hit-location-choice">
        <div class="form-group">
          <label><b>Hit Location</b></label>
          <select name="hitLocation">${options}</select>
        </div>
      </div>
    `,
    buttons: {
      ok: {
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const value = root?.querySelector('select[name="hitLocation"]')?.value;
          return String(value ?? "").trim() || null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok"
  });
}

export async function prepareAttackActivationContext({
  actor,
  item,
  activation,
  context = {},
  featureConfig = null,
  resolver = null
} = {}) {
  if (!actor) {
    ui.notifications?.warn?.("Attack activation requires an owning actor.");
    return { ok: false };
  }

  let rangeType = item ? getSpellRangeType(item) : "none";
  const attackerToken = resolveTokenForActor(actor);
  let workingTargets = getTargetsFromContext(context);
  let aoeAreaUuid = null;
  let aoeAreaId = null;
  let aoeRegionUuid = null;
  let aoeRegionId = null;

  if (item?.type === "power") {
    const targetPolicy = featureConfig?.targetPolicy;
    if (targetPolicy && targetPolicy !== "self") {
      if (targetPolicy === "single") {
        if (workingTargets.length > 1) {
          ui.notifications?.info?.(`${item.name}: target policy limits to a single target.`);
          workingTargets = [workingTargets[0]];
        }
      } else if (targetPolicy === "template") {
        rangeType = "aoe";
      }
    } else if (targetPolicy === "self" && attackerToken) {
      workingTargets = [attackerToken];
      rangeType = "none";
    }
  }

  const aoeSpec = getSpellAoEConfig(item);
  const hasValidAoe = aoeSpec && (aoeSpec.sizeMeters > 0 || aoeSpec.pulse);
  if ((rangeType === "ranged" || rangeType === "melee" || rangeType === "aoe" || hasValidAoe) && !attackerToken) {
    ui.notifications?.warn?.("Please place and select a token for this actor.");
    return { ok: false };
  }

  if (hasValidAoe) {
    const includeCaster = Boolean(item?.system?.aoeIncludeCaster);
    const maxRange = getSpellMaxRangeMeters(item);
    const sourceType = (item?.type === "power") ? AOE_SOURCE_TYPES.POWER
      : (item?.type === "weapon") ? AOE_SOURCE_TYPES.WEAPON
      : (item?.type === "spell") ? AOE_SOURCE_TYPES.SPELL
      : AOE_SOURCE_TYPES.ITEM;
    const placed = await AoEService.place({
      sourceType,
      actor,
      token: attackerToken,
      item,
      aoe: {
        shape: aoeSpec?.shape ?? "circle",
        distance: aoeSpec.sizeMeters || 1,
        width: aoeSpec?.widthMeters,
        pulse: Boolean(aoeSpec?.pulse),
        includeCaster
      },
      options: { maxRange: maxRange ?? undefined, collectTargets: true }
    });
    if (!placed) return { ok: false };
    aoeAreaId = placed.areaId ?? placed.regionId ?? null;
    aoeAreaUuid = placed.areaUuid ?? placed.regionUuid ?? null;
    aoeRegionId = placed.regionId ?? null;
    aoeRegionUuid = placed.regionUuid ?? null;
    if (placed.targets?.length) {
      workingTargets = placed.targets;
    } else if (!workingTargets.length) {
      ui.notifications?.info?.("No tokens are affected by the area.");
      workingTargets = [];
    }
  } else if (rangeType === "ranged" || rangeType === "melee") {
    if (workingTargets.length) {
      const result = filterTargetsBySpellRange({
        casterToken: attackerToken,
        targets: workingTargets,
        spell: item
      }) ?? {};

      const validTargets = Array.isArray(result.validTargets) ? result.validTargets : [];
      const rejected = Array.isArray(result.rejected) ? result.rejected : [];
      const maxRange = Number.isFinite(Number(result.maxRange)) ? Number(result.maxRange) : null;
      if (rejected.length) {
        const names = rejected.map((entry) => entry?.token?.name ?? entry?.token?.document?.name ?? "Target").join(", ");
        const rangeLabel = (maxRange != null) ? `${maxRange}m` : "range";
        ui.notifications?.warn?.(`Targets out of range (${rangeLabel}): ${names}`);
      }
      workingTargets = validTargets;
    }
  }

  workingTargets = Array.from(workingTargets ?? [])
    .map((target) => resolveTokenTarget(target, { resolver }) ?? target)
    .filter((target) => target?.actor);
  if (!workingTargets.length) {
    ui.notifications?.warn?.("This attack requires a target.");
    return { ok: false };
  }

  const hitLocationMode = getHitLocationMode(activation);
  let hitLocation = null;
  if (hasValidAoe) {
    hitLocation = "Body";
  } else if (hitLocationMode === "manual") {
    hitLocation = await promptHitLocationChoice({ title: "Select Hit Location" });
    if (!hitLocation) return { ok: false };
  } else {
    const roll = new Roll("1d10");
    await roll.evaluate();
    hitLocation = getHitLocationFromRoll(roll.total);
  }

  const attackMode = getAttackModeFromActivation(activation);
  const aoeConfig = hasValidAoe
    ? {
        ...(aoeSpec ?? {}),
        isAoE: true,
        areaType: "region",
        areaUuid: aoeAreaUuid ?? aoeRegionUuid,
        areaId: aoeAreaId ?? aoeRegionId,
        regionUuid: aoeRegionUuid,
        regionId: aoeRegionId
      }
    : null;

  return {
    ok: true,
    attackerToken,
    defenderToken: workingTargets[0] ?? null,
    defenderActor: workingTargets[0]?.actor ?? null,
    targets: workingTargets,
    attackMode,
    hitLocation,
    isAoE: hasValidAoe,
    aoe: aoeConfig,
    context: {
      targets: workingTargets,
      hitLocation,
      isAoE: hasValidAoe,
      aoe: aoeConfig
    }
  };
}

export async function startAttackWorkflow({
  actor,
  item,
  activation,
  attackContext,
  actorSnapshot = null
} = {}) {
  const attackerToken = attackContext?.attackerToken ?? resolveTokenForActor(actor);
  if (!attackerToken) {
    ui.notifications?.warn?.("Please place and select a token for this actor.");
    return false;
  }

  const defenderTokens = Array.isArray(attackContext?.targets)
    ? attackContext.targets
    : (attackContext?.defenderToken ? [attackContext.defenderToken] : []);
  if (!defenderTokens.length) {
    ui.notifications?.warn?.("Please target an enemy token.");
    return false;
  }

  const snapshot = actorSnapshot ?? {};
  const attackMode = attackContext?.attackMode ?? getAttackModeFromActivation(activation);

  let attackerItemUuid = null;
  let attackerLabel = item?.name ?? "Attack";
  let attackerTarget = 0;

  if (String(actor?.type ?? "") === "NPC") {
    const base = Number(actor?.system?.professions?.combat ?? 0) || 0;
    attackerTarget = base + Number(snapshot.fatiguePenalty ?? 0) + Number(snapshot.carryPenalty ?? 0) + Number(snapshot.woundPenalty ?? 0);
    attackerItemUuid = "prof:combat";
  } else {
    const style = snapshot.activeCombatStyle ?? null;
    if (!style) {
      ui.notifications?.warn?.("No Combat Style found on this actor.");
      return false;
    }
    const base = Number(style?.system?.value ?? 0) || 0;
    attackerTarget = base + Number(snapshot.fatiguePenalty ?? 0) + Number(snapshot.carryPenalty ?? 0) + Number(snapshot.woundPenalty ?? 0);
    attackerItemUuid = style.uuid;
    attackerLabel = `${attackerLabel} - ${style.name}`;
  }

  const activationDamage = normalizeActivationDamage(activation);
  const activationTags = normalizeActivationTags(activation);
  const activationContext = (activationDamage || activationTags.length)
    ? {
        itemUuid: item?.uuid ?? null,
        itemName: item?.name ?? null,
        itemImg: item?.img ?? null,
        damage: activationDamage,
        tags: activationTags
      }
    : null;

  await OpposedWorkflow.createPending({
    attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
    defenderTokenUuids: defenderTokens.map((token) => token?.document?.uuid ?? token?.uuid).filter(Boolean),
    attackerActorUuid: actor.uuid,
    attackerItemUuid,
    attackerLabel,
    attackerTarget,
    mode: "attack",
    attackMode,
    forcedHitLocation: attackContext?.hitLocation ?? null,
    aoe: attackContext?.aoe ?? null,
    isAoE: Boolean(attackContext?.isAoE),
    activation: activationContext
  });

  return true;
}
