/**
 * Shared lightweight view builders for AppV2 sheet contexts.
 *
 * These helpers intentionally avoid full `toObject()` cloning for actor sheets.
 * They provide the minimum stable shape consumed by templates and existing
 * prepare helpers while preserving live derived `system` data.
 */

import { getGenericAEMetadata, isConditionEffect, isGenericAESuppressed } from "../../../../core/active-effects/metadata.js";
import { FLAG_SCOPE } from "../../../../core/system/namespace.js";

function _effectClassification(effect) {
  const flags = effect?.flags?.[FLAG_SCOPE] ?? effect?.flags?.uesrpg ?? {};
  const meta = getGenericAEMetadata(effect);
  const hasLegacy = Boolean(
    flags?.expiresOnTurnStart === true ||
    flags?.effectGroup ||
    flags?.stackRule
  );
  const condition = isConditionEffect(effect);
  const wound = Boolean(flags?.wounds);
  const spell = Boolean(flags?.spellEffect);
  const suppressed = isGenericAESuppressed(effect);
  const temporary = Boolean(effect?.isTemporary || effect?.duration?.rounds || effect?.duration?.seconds);
  return {
    meta,
    hasLegacy,
    condition,
    wound,
    spell,
    suppressed,
    temporary,
    generic: Boolean(meta) && !condition && !wound,
  };
}

function _localize(key, fallback) {
  const value = globalThis.game?.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function _effectBadges(effect) {
  const c = _effectClassification(effect);
  const out = [];
  if (effect?.disabled) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Disabled", "Disabled"), class: "is-disabled", title: _localize("UESRPG.ActiveEffects.Badges.DisabledHint", "This effect is disabled.") });
  if (c.suppressed) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Suppressed", "Suppressed"), class: "is-suppressed", title: _localize("UESRPG.ActiveEffects.Badges.SuppressedHint", "Expired with suppression instead of deletion.") });
  if (effect?.transfer) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Transfer", "Transfer"), class: "is-transfer", title: _localize("UESRPG.ActiveEffects.Badges.TransferHint", "Transfers from item to actor.") });
  if (c.temporary) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Temporary", "Temporary"), class: "is-temporary", title: _localize("UESRPG.ActiveEffects.Badges.TemporaryHint", "Has Foundry duration data.") });
  if (c.meta?.expiry?.mode) out.push({ label: c.meta.expiry.mode, class: "is-expiry", title: _localize("UESRPG.ActiveEffects.Badges.ExpiryHint", "Generic lifecycle expiry mode.") });
  if (c.meta?.stack?.policy && c.meta.stack.policy !== "none") out.push({ label: c.meta.stack.policy, class: "is-stack", title: _localize("UESRPG.ActiveEffects.Badges.StackHint", "Generic stack policy.") });
  if (c.condition) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Condition", "Condition"), class: "is-condition", title: _localize("UESRPG.ActiveEffects.Badges.ConditionHint", "Managed by the condition engine.") });
  else if (c.wound) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Wound", "Wound"), class: "is-wound", title: _localize("UESRPG.ActiveEffects.Badges.WoundHint", "Managed by the wound engine.") });
  else if (c.spell) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Spell", "Spell"), class: "is-spell", title: _localize("UESRPG.ActiveEffects.Badges.SpellHint", "Managed by spell automation.") });
  else if (c.generic) out.push({ label: c.meta?.source ?? _localize("UESRPG.ActiveEffects.Badges.Generic", "Generic"), class: "is-generic", title: _localize("UESRPG.ActiveEffects.Badges.GenericHint", "Generic ActiveEffect lifecycle metadata.") });
  if (c.hasLegacy && !c.meta) out.push({ label: _localize("UESRPG.ActiveEffects.Badges.Legacy", "Legacy"), class: "is-legacy", title: _localize("UESRPG.ActiveEffects.Badges.LegacyHint", "Uses legacy UESRPG effect flags.") });
  return out;
}

export function buildActorSheetActorView(actor) {
  return {
    _id: actor?.id ?? null,
    id: actor?.id ?? null,
    uuid: actor?.uuid ?? null,
    name: actor?.name ?? "",
    img: actor?.img ?? CONST.DEFAULT_TOKEN,
    type: actor?.type ?? "",
    flags: actor?.flags ?? {},
    system: actor?.system ?? {},
  };
}

export function buildActorSheetItemView(item) {
  return {
    _id: item?.id ?? null,
    id: item?.id ?? null,
    name: item?.name ?? "",
    img: item?.img ?? CONST.DEFAULT_TOKEN,
    type: item?.type ?? "",
    flags: item?.flags ?? {},
    system: item?.system ?? {},
  };
}

export function buildActorSheetEffectView(effect) {
  const classification = _effectClassification(effect);
  return {
    _id: effect?.id ?? null,
    id: effect?.id ?? null,
    name: effect?.name ?? "",
    img: effect?.img ?? CONST.DEFAULT_TOKEN,
    transfer: Boolean(effect?.transfer),
    disabled: Boolean(effect?.disabled),
    badges: _effectBadges(effect),
    filters: {
      enabled: !effect?.disabled && !classification.suppressed,
      suppressed: classification.suppressed,
      temporary: classification.temporary,
      generic: classification.generic,
      condition: classification.condition,
      wound: classification.wound,
      spell: classification.spell,
      legacy: classification.hasLegacy && !classification.meta,
    },
  };
}

export function buildActorSheetItems(actor) {
  return Array.from(actor?.items?.contents ?? [], buildActorSheetItemView);
}

export function buildActorSheetEffects(actor, { filter = null } = {}) {
  const out = [];
  for (const effect of actor?.effects?.contents ?? []) {
    if (typeof filter === "function" && !filter(effect)) continue;
    out.push(buildActorSheetEffectView(effect));
  }
  return out;
}
