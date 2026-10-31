/**
 * @module traits/spellcasting-talent-activation
 * @description Internal activation and hook helpers for spellcasting talents.
 */

import { resolveTalentSlug } from "./talents-api.js";
import { getSummonedTokens } from "../magic/conjuration/conjuration-state.js";
import { queueStatusEffect } from "../system/activation/feature-effects.js";
import { buildEffectChange } from "../../utils/compat.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { escapeHtml } from "../../utils/html.js";
import {
  getSpellcastingTalentState,
  consumeSpellcastingPrimedState
} from "./spellcasting-talent-state.js";

const ACTIVATABLE_SPELLCASTING_TALENTS = new Set([
  "bendreality",
  "control",
  "flowofmagicka",
  "healer",
  "overcharge",
  "voidchanneler"
]);

function getTalentActivationSlug(talentItem) {
  const byAlias = resolveTalentSlug(talentItem?.name ?? "");
  if (byAlias) return byAlias;
  return String(talentItem?.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildActivationMessage(actor, slug) {
  const name = escapeHtml(actor.name);
  switch (slug) {
    case "bendreality":
      return `<strong>${name}</strong> uses <strong>Bend Reality</strong>. Manually roll Alteration in place of Athletics or Acrobatics and spend 2 MP for that test. Check any cost already paid by the activation before deducting it.`;
    case "control":
      return `<strong>${name}</strong> has <strong>Control</strong>. The backfire workflow offers a Willpower test when a magical backfire occurs.`;
    case "flowofmagicka":
      return `<strong>${name}</strong> uses <strong>Flow of Magicka</strong>. Manually make a Mysticism test at -20 as a reaction to a spell. If the degrees of success exceed its spell level, the GM must negate the spell; effects without a spell level cannot be negated this way.`;
    case "healer":
      return `<strong>${name}</strong> uses <strong>Healer</strong>. Manually perform the one-hour ritual, make a Restoration test, spend 10 MP, and mark the selected wound treated on success. Check any cost already paid by the activation before deducting it.`;
    case "overcharge":
      return `<strong>${name}</strong> has <strong>Overcharge</strong>. Select Overcharge in the spell-casting dialog when casting a damaging spell; the cost is doubled after restraint and damage is rolled twice.`;
    default:
      return null;
  }
}

async function postSpellcastingTalentActivationMessage(actor, message) {
  const created = await ChatMessage.create({
    content: `<div class="uesrpg talent-activation">${message}</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
  if (!created) throw new Error("The spellcasting talent instructions could not be posted.");
}

export function isActivatableSpellcastingTalent(talentItem) {
  if (!talentItem || talentItem.type !== "talent") return false;
  return ACTIVATABLE_SPELLCASTING_TALENTS.has(getTalentActivationSlug(talentItem));
}

export async function activateSpellcastingTalent(actor, talentItem, { onOutcome = null, activationCostPaid = false } = {}) {
  if (!actor || !talentItem) return false;

  if (getTalentActivationSlug(talentItem) === "voidchanneler") {
    // The ordinary activation executor spends the configured SP before entering
    // this handler; callers without that confirmed step cannot grant the effect.
    if (!activationCostPaid) throw new Error("Void Channeler requires a confirmed 1 SP activation cost.");
    const bonus = Math.max(0, Number(actor.system?.characteristics?.wp?.bonus ?? 0) || 0);
    const tokens = getSummonedTokens(actor, { kind: "daedra", allScenes: true });
    const failures = [];
    for (const token of tokens) {
      const target = token.actor;
      if (!target) { failures.push(token.name); continue; }
      try {
        const message = await queueStatusEffect(target, {
          name: "Void Channeler",
          img: talentItem.img,
          flags: { [FLAG_SCOPE]: { key: "voidChanneler", source: "talent", casterUuid: actor.uuid } },
          changes: [buildEffectChange({ key: "system.modifiers.resistance.natToughness", type: "add", value: String(bonus), priority: 20 })]
        }, {
          sourceActor: actor,
          onOutcome,
          durationAtApplication: "oneRound",
          instructions: "In combat, this lasts until the end of the initiative step where it took effect, one round later. It ends if that combat or combatant is removed."
        });
        if (!message?.id) throw new Error("The target outcome was not saved.");
      } catch (_error) { failures.push(token.name); }
    }
    if (failures.length) throw Object.assign(new Error(`Void Channeler could not queue outcomes for: ${failures.join(", ")}.`), { committed: true, uncertain: true });
    return true;
  }

  const message = buildActivationMessage(actor, getTalentActivationSlug(talentItem));
  if (!message) return false;
  // These options are resolved by their casting workflow or manually. Creating
  // a primed flag here would claim a pending effect which no workflow consumes.
  await postSpellcastingTalentActivationMessage(actor, message);
  return true;
}

export async function handlePostCastTalentConsumption(payload) {
  if (!payload?.caster || !payload?.success) return;

  const actor = payload.caster;
  const primed = getSpellcastingTalentState(actor);
  if (!primed) return;

  if (primed.slug === "overcharge" && payload.spellOptions?.useOvercharge) {
    await consumeSpellcastingPrimedState(actor);
  }
}

let _hooksRegistered = false;

export function registerSpellcastingTalentHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  Hooks.on("uesrpg.spell.castResolved", (payload) => {
    handlePostCastTalentConsumption(payload).catch((err) => {
      console.error("UESRPG | spellcasting-talents | postCast hook error:", err);
    });
  });
}
