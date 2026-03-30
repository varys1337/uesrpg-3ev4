import { customDialog } from "../../utils/dialog-v2-helper.js";
import {
  clearLegacyAlchemyCarrierFlag,
  consumeOwnedItem,
  createAlchemyChatMessage,
  createCarrierEffect,
  createOwnedItem,
  deleteOwnedItem,
  updateAlchemyDocument,
} from "./operations.js";
import { getEffectByKey } from "./effects.js";
import { renderApplyToWeaponCard } from "./render.js";
import { ALCHEMY_DEFAULT_ICON, cloneAlchemyData, getAlchemyFlags, FLAG_NS } from "./shared.js";
import {
  buildCoatedAmmoName,
  buildWeaponAlchemyAEData,
  clearAppliedAlchemy,
  getAlchemyCoatingTargets,
  getAlchemyTargetOptionLabel,
  getAppliedAlchemy,
  isAlchemyAmmoTarget,
  isAlchemyWeaponTarget,
} from "./carrier-state.js";
import { getAlchemyEffectLabel as _effectLabel, normalizeStoredSpellEffect as _normalizeStoredSpellEffect } from "./spell-effects.js";
import { createAlchemyOperationResult, getActorItemsArray } from "./utils.js";

async function _normalizeAlchemyCarrierEffects(alchemyFlags, { mode = "poison" } = {}) {
  const normalizedEffects = [];
  if (String(alchemyFlags?.kind ?? "").trim().toLowerCase() !== "toxin") {
    return { ok: true, effects: normalizedEffects };
  }

  for (const rawEffect of alchemyFlags.effects ?? []) {
    if (String(rawEffect?.effectSource ?? "catalog") !== "spell") {
      normalizedEffects.push(rawEffect);
      continue;
    }
    const normalized = await _normalizeStoredSpellEffect(rawEffect, { mode });
    if (!normalized?.ok) {
      return {
        ok: false,
        reason: normalized?.reason ?? `${_effectLabel(rawEffect)} must be re-brewed before it can be applied as a toxin.`,
      };
    }
    normalizedEffects.push(normalized.effectEntry);
  }

  return { ok: true, effects: normalizedEffects };
}

async function _applyAlchemyToCarrierItem(carrierItem, alchemyItem, alchemyFlags) {
  const existing = getAppliedAlchemy(carrierItem);
  if (existing) await clearAppliedAlchemy(carrierItem, existing);

  const aeData = buildWeaponAlchemyAEData(alchemyItem, alchemyFlags);
  const created = await createCarrierEffect(carrierItem, aeData);
  const createdEffect = created.data ?? null;
  if (!createdEffect) return null;

  if (carrierItem?.flags?.[FLAG_NS]?.alchemyApplied) {
    await clearLegacyAlchemyCarrierFlag(carrierItem, `flags.${FLAG_NS}.alchemyApplied`);
  }
  return createdEffect;
}

function _alchemyApplyResult({ ok = false, targetType = null, carrierItem = null, consumedAlchemyItem = false, reason = "" } = {}) {
  return createAlchemyOperationResult({
    ok,
    targetType: targetType ? String(targetType) : null,
    carrierItem: carrierItem ?? null,
    consumedAlchemyItem: Boolean(consumedAlchemyItem),
    reason,
  });
}

async function _createCoatedAmmoItem(actor, ammoItem, alchemyFlags) {
  const sourceQty = Math.max(0, Number(ammoItem?.system?.quantity ?? 0) || 0);
  if (sourceQty <= 0) {
    ui.notifications.warn(`${ammoItem?.name ?? "Ammunition"}: no ammunition remaining.`);
    return null;
  }

  const clonedFlags = cloneAlchemyData(ammoItem?.flags ?? {});
  if (clonedFlags?.[FLAG_NS]?.alchemyApplied !== undefined) {
    delete clonedFlags[FLAG_NS].alchemyApplied;
  }

  const itemData = {
    name: buildCoatedAmmoName(ammoItem, alchemyFlags),
    type: "ammunition",
    img: ammoItem?.img ?? ALCHEMY_DEFAULT_ICON,
    system: {
      ...cloneAlchemyData(ammoItem?.system ?? {}),
      quantity: 1,
    },
    flags: clonedFlags,
  };

  const created = await createOwnedItem(actor, itemData);
  const coatedAmmo = created.data ?? null;
  if (!coatedAmmo) {
    ui.notifications.warn(`Failed to create coated ammunition from ${ammoItem?.name ?? "ammunition"}.`);
    return null;
  }
  return coatedAmmo;
}

export async function consumeAlchemyItem(actor, item) {
  await consumeOwnedItem(item);
}

async function _postApplyCard(actor, carrierItem, algData, effectData) {
  const content = renderApplyToWeaponCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    weaponName: carrierItem.name,
    kind: algData.kind,
    poisonLevel: algData.poisonLevel ?? 1,
    damageFormula: algData.damageFormula ?? "1d4",
    effects: effectData.effects ?? [],
    maxHits: algData.kind === "toxin" ? (algData.maxHits ?? 3) : 1,
    backfired: algData.backfired ?? false,
    getEffectLabel: (k) => getEffectByKey(k)?.label ?? k,
  });

  await createAlchemyChatMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export async function applyAlchemyToWeapon(actor, alchemyItem, weaponItem) {
  if (!actor || !alchemyItem || !weaponItem) {
    return _alchemyApplyResult({ reason: "Missing actor, alchemy item, or weapon." });
  }
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not own this actor.");
    return _alchemyApplyResult({ targetType: "weapon", reason: "You do not own this actor." });
  }

  const algData = getAlchemyFlags(alchemyItem);
  if (!algData || (algData.kind !== "poison" && algData.kind !== "toxin")) {
    ui.notifications.warn("That item is not a brewed poison or toxin.");
    return _alchemyApplyResult({ targetType: "weapon", reason: "That item is not a brewed poison or toxin." });
  }

  if (!isAlchemyWeaponTarget(weaponItem)) {
    ui.notifications.warn("Poisons and toxins can only be applied to equipped weapons.");
    return _alchemyApplyResult({ targetType: "weapon", reason: "Poisons and toxins can only be applied to equipped weapons." });
  }

  const normalized = await _normalizeAlchemyCarrierEffects(algData, { mode: "toxin" });
  if (normalized?.ok === false) {
    ui.notifications.warn(normalized.reason);
    return _alchemyApplyResult({ targetType: "weapon", reason: normalized.reason });
  }

  const effectData = {
    ...algData,
    effects: normalized?.effects?.length ? normalized.effects : (algData.effects ?? []),
  };

  const createdEffect = await _applyAlchemyToCarrierItem(weaponItem, alchemyItem, effectData);
  if (!createdEffect) {
    const reason = `Could not apply ${alchemyItem.name ?? "alchemy item"} to ${weaponItem.name ?? "weapon"}.`;
    ui.notifications.warn(reason);
    return _alchemyApplyResult({ targetType: "weapon", carrierItem: weaponItem, reason });
  }

  try {
    await consumeAlchemyItem(actor, alchemyItem);
  } catch (err) {
    try {
      await clearAppliedAlchemy(weaponItem);
    } catch (_cleanupErr) {
      // no-op
    }
    const reason = `${alchemyItem.name ?? "Alchemy item"} could not be consumed after coating ${weaponItem.name ?? "weapon"}.`;
    console.error("UESRPG | Failed to consume alchemy item after weapon coating", { actor: actor?.uuid, item: alchemyItem?.uuid, weapon: weaponItem?.uuid, err });
    ui.notifications.warn(reason);
    return _alchemyApplyResult({ targetType: "weapon", carrierItem: weaponItem, reason });
  }

  await _postApplyCard(actor, weaponItem, algData, effectData);
  return _alchemyApplyResult({ ok: true, targetType: "weapon", carrierItem: weaponItem, consumedAlchemyItem: true });
}

export async function applyAlchemyToAmmo(actor, alchemyItem, ammoItem) {
  if (!actor || !alchemyItem || !ammoItem) {
    return _alchemyApplyResult({ reason: "Missing actor, alchemy item, or ammunition." });
  }
  if (!isAlchemyAmmoTarget(ammoItem)) {
    ui.notifications.warn("Poisons and toxins can only be applied to ammunition with quantity remaining.");
    return _alchemyApplyResult({ targetType: "ammunition", reason: "Poisons and toxins can only be applied to ammunition with quantity remaining." });
  }

  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not own this actor.");
    return _alchemyApplyResult({ targetType: "ammunition", reason: "You do not own this actor." });
  }

  const algData = getAlchemyFlags(alchemyItem);
  if (!algData || (algData.kind !== "poison" && algData.kind !== "toxin")) {
    ui.notifications.warn("That item is not a brewed poison or toxin.");
    return _alchemyApplyResult({ targetType: "ammunition", reason: "That item is not a brewed poison or toxin." });
  }

  const normalized = await _normalizeAlchemyCarrierEffects(algData, { mode: "toxin" });
  if (normalized?.ok === false) {
    ui.notifications.warn(normalized.reason);
    return _alchemyApplyResult({ targetType: "ammunition", reason: normalized.reason });
  }

  const effectData = {
    ...algData,
    effects: normalized?.effects?.length ? normalized.effects : (algData.effects ?? []),
  };

  const coatedAmmo = await _createCoatedAmmoItem(actor, ammoItem, effectData);
  if (!coatedAmmo) {
    return _alchemyApplyResult({ targetType: "ammunition", carrierItem: ammoItem, reason: `Failed to create coated ammunition from ${ammoItem?.name ?? "ammunition"}.` });
  }

  const createdEffect = await _applyAlchemyToCarrierItem(coatedAmmo, alchemyItem, effectData);
  if (!createdEffect) {
    try {
      await deleteOwnedItem(actor, coatedAmmo.id);
    } catch (_cleanupErr) {
      // no-op
    }
    const reason = `Could not apply ${alchemyItem.name ?? "alchemy item"} to ${ammoItem.name ?? "ammunition"}.`;
    ui.notifications.warn(reason);
    return _alchemyApplyResult({ targetType: "ammunition", carrierItem: ammoItem, reason });
  }

  const sourceQty = Math.max(0, Number(ammoItem?.system?.quantity ?? 0) || 0);
  try {
    if (sourceQty <= 1) {
      await deleteOwnedItem(actor, ammoItem.id);
    } else {
      await updateAlchemyDocument(ammoItem, { "system.quantity": sourceQty - 1 });
    }
  } catch (err) {
    console.error("UESRPG | Failed to consume source ammunition for alchemy coating", { actor: actor?.uuid, ammo: ammoItem?.uuid, err });
    try {
      await deleteOwnedItem(actor, coatedAmmo.id);
    } catch (_cleanupErr) {
      // no-op
    }
    const reason = `Failed to split ${ammoItem?.name ?? "ammunition"} for coating.`;
    ui.notifications.warn(reason);
    return _alchemyApplyResult({ targetType: "ammunition", carrierItem: ammoItem, reason });
  }

  try {
    await consumeAlchemyItem(actor, alchemyItem);
  } catch (err) {
    console.error("UESRPG | Failed to consume alchemy item after ammo coating", { actor: actor?.uuid, item: alchemyItem?.uuid, ammo: ammoItem?.uuid, coatedAmmo: coatedAmmo?.uuid, err });
    try {
      await deleteOwnedItem(actor, coatedAmmo.id);
    } catch (_cleanupErr) {
      // no-op
    }
    const restoreQty = Math.max(0, Number(ammoItem?.system?.quantity ?? 0) || 0);
    try {
      if (ammoItem?.parent?.items?.get?.(ammoItem.id)) {
        await updateAlchemyDocument(ammoItem, { "system.quantity": restoreQty + 1 });
      } else {
        const restored = {
          name: ammoItem.name,
          type: ammoItem.type,
          img: ammoItem.img,
          system: {
            ...cloneAlchemyData(ammoItem.system ?? {}),
            quantity: 1,
          },
          flags: cloneAlchemyData(ammoItem.flags ?? {}),
        };
        await createOwnedItem(actor, restored);
      }
    } catch (_restoreErr) {
      // no-op
    }
    const reason = `${alchemyItem.name ?? "Alchemy item"} could not be consumed after coating ${ammoItem.name ?? "ammunition"}.`;
    ui.notifications.warn(reason);
    return _alchemyApplyResult({ targetType: "ammunition", carrierItem: ammoItem, reason });
  }

  await _postApplyCard(actor, coatedAmmo, algData, effectData);
  return _alchemyApplyResult({ ok: true, targetType: "ammunition", carrierItem: coatedAmmo, consumedAlchemyItem: true });
}

export async function applyAlchemyToTarget(actor, alchemyItem, targetItem) {
  const targetType = String(targetItem?.type ?? "").trim().toLowerCase();
  if (targetType === "weapon") return applyAlchemyToWeapon(actor, alchemyItem, targetItem);
  if (targetType === "ammunition") return applyAlchemyToAmmo(actor, alchemyItem, targetItem);
  const reason = "Poisons and toxins can only be applied to equipped weapons or ammunition.";
  ui.notifications.warn(reason);
  return _alchemyApplyResult({ reason });
}

export async function pickAlchemyWeapon(actor) {
  const weapons = getActorItemsArray(actor).filter((item) => isAlchemyWeaponTarget(item));
  if (weapons.length === 0) {
    ui.notifications.warn("No equipped weapons found.");
    return null;
  }

  if (weapons.length === 1) return weapons[0];

  const options = weapons.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  const content = `<p>Select a weapon to coat:</p><select name="weaponId" style="width:100%;">${options}</select>`;

  const result = await customDialog({
    title: "Apply to Weapon",
    content,
    buttons: {
      ok: {
        label: "Apply",
        icon: "fas fa-check",
        callback: (html) => {
          if (!html) return null;
          return html.querySelector("select[name='weaponId']")?.value ?? null;
        },
      },
      cancel: { label: "Cancel", icon: "fas fa-times" },
    },
    default: "ok",
  });

  if (!result) return null;
  return actor.items.get(result) ?? null;
}

export async function pickAlchemyCoatingTarget(actor) {
  const targets = getAlchemyCoatingTargets(actor);
  if (targets.length === 0) {
    ui.notifications.warn("No valid equipped weapons or ammunition found.");
    return null;
  }

  if (targets.length === 1) return targets[0];

  const options = targets
    .map((item) => `<option value="${item.id}">${getAlchemyTargetOptionLabel(item)}</option>`)
    .join("");
  const content = `<p>Select a weapon or ammunition item to coat:</p><select name="targetId" style="width:100%;">${options}</select>`;

  const result = await customDialog({
    title: "Apply Poison/Toxin",
    content,
    buttons: {
      ok: {
        label: "Apply",
        icon: "fas fa-check",
        callback: (html) => {
          if (!html) return null;
          return html.querySelector("select[name='targetId']")?.value ?? null;
        },
      },
      cancel: { label: "Cancel", icon: "fas fa-times" },
    },
    default: "ok",
  });

  if (!result) return null;
  return actor.items.get(result) ?? null;
}
