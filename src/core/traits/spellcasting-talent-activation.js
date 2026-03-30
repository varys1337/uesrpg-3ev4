/**
 * @module traits/spellcasting-talent-activation
 * @description Internal activation and hook helpers for spellcasting talents.
 */

import { resolveTalentSlug } from "./talents-api.js";
import {
  getSpellcastingTalentState,
  setSpellcastingPrimedState,
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

function buildActivationStateAndMessage(actor, slug) {
  switch (slug) {
    case "bendreality":
      return {
        state: { slug: "bendreality", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> activates <strong>Bend Reality</strong>: may use Alteration in place of Athletics or Acrobatics (costs 2 MP).`
      };
    case "control":
      return {
        state: { slug: "control", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> readies <strong>Control</strong>: may test Willpower to negate their next magical backfire.`
      };
    case "flowofmagicka":
      return {
        state: { slug: "flowofmagicka", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> readies <strong>Flow of Magicka</strong>: as a reaction to a spell cast, may make a -20 Mysticism test to negate the spell (DoS must exceed spell level).`
      };
    case "healer":
      return {
        state: { slug: "healer", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> readies <strong>Healer</strong>: may make a Restoration test and spend 10 MP to treat a wound (1 hour ritual).`
      };
    case "overcharge":
      return {
        state: { slug: "overcharge", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> readies <strong>Overcharge</strong>: next damaging spell will roll damage twice and use the highest (cost doubled after restraint).`
      };
    case "voidchanneler":
      return {
        state: { slug: "voidchanneler", usesRemaining: 1 },
        message: `<strong>${actor.name}</strong> activates <strong>Void Channeler</strong>: spends 1 SP to increase all summoned Daedra's Natural Toughness by WB for one Round.`
      };
    default:
      return null;
  }
}

async function postSpellcastingTalentActivationMessage(actor, message) {
  await ChatMessage.create({
    content: `<div class="uesrpg talent-activation">${message}</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

export function isActivatableSpellcastingTalent(talentItem) {
  if (!talentItem || talentItem.type !== "talent") return false;
  return ACTIVATABLE_SPELLCASTING_TALENTS.has(getTalentActivationSlug(talentItem));
}

export async function activateSpellcastingTalent(actor, talentItem) {
  if (!actor || !talentItem) return false;

  const payload = buildActivationStateAndMessage(actor, getTalentActivationSlug(talentItem));
  if (!payload) return false;

  await setSpellcastingPrimedState(actor, payload.state);
  await postSpellcastingTalentActivationMessage(actor, payload.message);
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
