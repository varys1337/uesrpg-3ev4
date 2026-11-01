import { SYSTEM_ID } from "../system/namespace.js";
import { buildAdvancementPlan } from "./item-advancement.js";
import { buildSkillAdvancementPlan, computeCharacteristicAdvancementCost } from "./skill-advancement.js";
import { computeCombatSetupCost } from "./combat-style-setup.js";
import { getCampaignRankFromXpTotal } from "./progression.js";
import { validateTalentLearning, TALENT_LEARNING_MODE } from "../traits/talent-learning.js";
import { validateSpellLearningPurchase, normalizeSpellLearningType, computeSpellLearningSummary } from "./spell-learning.js";
import { extractCoreSkillSourceDocumentId, getCoreSkillMetadata, getEmbeddedCoreSkillFolderId } from "../compendium/core-skills.js";
import {
  clonePurchaseData as clone, createPurchaseProjection, purchaseActorFacade, spendPurchaseResources,
  addPurchaseCreate, addPurchaseUpdate, finishPurchaseProjection,
} from "./purchase-projection.js";

function correction(actor, reason, requester) {
  const completed = actor.getFlag(SYSTEM_ID, "chargen")?.completed
    || actor.flags?.uesrpg?.charGen?.completed || actor.getFlag(SYSTEM_ID, "chargen")?.finalSummary?.postedAt;
  if (reason != null && (!requester?.isGM || String(reason).trim().length < 3)) throw new Error("A GM Administrative Correction reason is required.");
  return { completed: Boolean(completed), waiveXp: Boolean(reason) };
}

function resolveItem(state, reference) {
  const ref = String(reference ?? "");
  const id = ref.startsWith("id:") ? ref.slice(3) : ref.startsWith("temp:") ? state.refs.get(ref.slice(5)) : ref;
  return state.items.find(item => item.id === id);
}

function spellRow(source, validation, paymentMode, key) {
  return { outcome: "learned", reason: "", paymentMode,
    spell: { name: source.name, school: String(source.system?.school ?? "").toLowerCase(),
      level: Math.max(1, Number(source.system?.level ?? 1)), type: normalizeSpellLearningType(source) },
    costs: { xp: paymentMode === "xp" ? validation.costs.xpCost : 0, drakes: paymentMode === "drakes" ? validation.costs.drakesCost : 0 },
    sourceUuid: source.uuid ?? source.flags?.core?.sourceId ?? "", purchaseStep: key };
}

function planSpell(state, source, paymentMode, requester, { waiveXp = false } = {}) {
  const facade = purchaseActorFacade(state);
  if (waiveXp) facade.system = { ...state.system, xp: Number.MAX_SAFE_INTEGER };
  const validation = validateSpellLearningPurchase(facade, source, paymentMode, { requester });
  if (!validation.ok) throw new Error(validation.reason);
  const xp = paymentMode === "xp" ? validation.costs.xpCost : 0;
  const wealth = paymentMode === "drakes" ? validation.costs.drakesCost : 0;
  spendPurchaseResources(state, xp, wealth, { waiveXp });
  const data = clone(source);
  data.type = "spell";
  data.flags ??= {};
  data.flags[SYSTEM_ID] ??= {};
  if (source.uuid ?? source.flags?.core?.sourceId) data.flags[SYSTEM_ID].spellSourceUuid = source.uuid ?? source.flags.core.sourceId;
  const item = addPurchaseCreate(state, data);
  const row = spellRow(source, validation, paymentMode, item._purchaseRef);
  if (waiveXp) row.costs.xp = 0;
  state.spellRows.push(row);
  return { item, xp, wealth, validation };
}

function purchaseLogs(state, intent, actor, results) {
  const chargen = actor.getFlag(SYSTEM_ID, "chargen") ?? {};
  const patch = {};
  if (state.spendRows.length) {
    const log = Array.isArray(chargen.spendLog) ? clone(chargen.spendLog) : [];
    if (!log.some(row => row.operationId === intent.id)) log.push(...state.spendRows.map(row => ({ ...row, operationId: intent.id, timestamp: new Date().toISOString() })));
    patch[`flags.${SYSTEM_ID}.chargen.spendLog`] = log;
  }
  if (state.spellRows.length) {
    const log = Array.isArray(chargen.spellLearning?.log) ? clone(chargen.spellLearning.log) : [];
    if (!log.some(row => row.operationId === intent.id)) log.push(...state.spellRows.map(row => {
      const { purchaseStep, ...entry } = row;
      return { ...entry, operationId: intent.id, timestamp: new Date().toISOString(),
        spell: { ...entry.spell, id: results[purchaseStep]?.id ?? "" } };
    }));
    const cap = Number(game.settings.get(SYSTEM_ID, "chargenSpellLearningLogCap") ?? 0);
    const kept = Number.isFinite(cap) && cap > 0 ? log.slice(-Math.trunc(cap)) : log;
    patch[`flags.${SYSTEM_ID}.chargen.spellLearning.log`] = kept;
    patch[`flags.${SYSTEM_ID}.chargen.spellLearning.lastSummary`] = computeSpellLearningSummary(kept);
  }
  return patch;
}

/** Canonical authority-side dispatcher; previews call this same planner. */
export async function buildXpPurchasePlan(actor, intent, { requester, nativeItemIds = [] } = {}) {
  try {
    const choices = intent.choices ?? {};
    const state = createPurchaseProjection(actor, { nativeItemIds });
    const workflow = intent.workflow;
    if (["awardXp", "setXp", "startingResources"].includes(workflow)) {
      if (workflow !== "startingResources" && !requester?.isGM) throw new Error("Only a GM can change XP administratively.");
      if (workflow === "awardXp") {
        const amount = Number(choices.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive XP award.");
        state.system.xp = Math.max(0, Number(state.system.xp ?? 0)) + amount;
        state.actorPatch["system.xpTotal"] = Math.max(0, Number(state.system.xpTotal ?? 0)) + amount;
      } else {
        for (const key of ["xp", "xpTotal"]) {
          const value = Number(choices[key]);
          if (!Number.isFinite(value) || value < 0) throw new Error("XP must be a non-negative number.");
          if (key === "xp") state.system.xp = value;
          else state.actorPatch["system.xpTotal"] = value;
        }
      }
      state.actorPatch["system.campaignRank"] = getCampaignRankFromXpTotal(state.actorPatch["system.xpTotal"]);
      if (workflow === "startingResources") {
        const wealth = Number(choices.wealth);
        if (!Number.isFinite(wealth) || wealth < 0) throw new Error("Starting Drakes must be a non-negative number.");
        state.system.wealth = wealth;
        state.actorPatch[`flags.${SYSTEM_ID}.chargen.startingResources`] = {
          wealth, xp: state.system.xp, xpTotal: state.actorPatch["system.xpTotal"], setAt: new Date().toISOString(),
        };
      }
      return finishPurchaseProjection(state, intent);
    }
    if (actor.type !== "Player Character") {
      throw new Error(`XP purchases require a Player Character. The selected Actor's type is ${String(actor.type ?? "unknown")}.`);
    }

    if (workflow === "itemSheet") {
      const item = resolveItem(state, choices.itemId);
      if (!item || !["skill", "magicSkill", "combatStyle"].includes(item.type)) throw new Error("The advancement Item is unavailable.");
      const plan = buildAdvancementPlan({ ...item, actor: purchaseActorFacade(state) }, choices.flatData);
      if (!plan.ok) throw new Error(plan.reason);
      spendPurchaseResources(state, Number(plan.xpCost ?? 0));
      addPurchaseUpdate(state, item, choices.flatData);
      return finishPurchaseProjection(state, intent);
    }

    if (workflow === "combatStyleSetup") {
      const access = correction(actor, choices.administrativeReason, requester);
      if (access.completed && !access.waiveXp) throw new Error("A GM Administrative Correction is required after character generation.");
      const input = choices.input;
      const facade = purchaseActorFacade(state);
      facade.items = { get: id => state.items.find(item => item.id === id) };
      const cost = computeCombatSetupCost(facade, input);
      if (!cost.ok) throw new Error(cost.reason);
      let item = input.styleId === "__new__" ? null : resolveItem(state, input.styleId);
      if (!item) item = addPurchaseCreate(state, { name: input.styleName || "Combat Style", type: "combatStyle",
        img: "systems/uesrpg-3ev4/images/Icons/backToBack.webp", system: { rank: "untrained", trainedEquipment: Array(10).fill(""),
          specialAdvantages: {}, governingCha: "Str, Agi", baseCha: Number(state.system.characteristics?.str?.total ?? 0) >= Number(state.system.characteristics?.agi?.total ?? 0) ? "str" : "agi" } });
      spendPurchaseResources(state, cost.xpCost);
      const update = { name: input.styleId === "__new__" ? (input.styleName || item.name) : item.name,
        "system.rank": cost.targetRank, "system.trainedEquipment": cost.desiredTe, "system.specialAdvantages": cost.nextSa };
      addPurchaseUpdate(state, item, update);
      const itemRef = item._purchaseRef;
      return finishPurchaseProjection(state, intent, { details: { waivedXp: cost.freeCombatStyle ? cost.actualXpCost : 0 },
        finalize: (_live, results) => {
          const styleId = itemRef ? results[itemRef]?.id : item.id;
          return { ...(input.setActive ? { [`flags.${SYSTEM_ID}.activeCombatStyleId`]: styleId } : {}),
            [`flags.${SYSTEM_ID}.chargen.combatStyleSetup`]: { styleId, styleName: update.name, rank: cost.targetRank,
              trainedEquipment: cost.desiredTe.filter(Boolean), specialAdvantages: input.specialAdvantages,
              activeStyleId: input.setActive ? styleId : actor.getFlag(SYSTEM_ID, "activeCombatStyleId") ?? null,
              spentXp: state.xpCost, waivedXp: cost.freeCombatStyle ? cost.actualXpCost : 0, freeCombatStyle: cost.freeCombatStyle } };
        } });
    }

    if (workflow === "nativeTalent" || workflow === "talentExisting") {
      const sources = workflow === "nativeTalent" ? choices.items : [resolveItem(state, choices.itemId)];
      if (!Array.isArray(sources) || !sources.length || sources.some(source => source?.type !== "talent")) throw new Error("Talent purchase source is unavailable.");
      for (const source of sources) {
        const validation = validateTalentLearning(purchaseActorFacade(state), source, { source: "purchase-native", ignoreItemId: workflow === "talentExisting" ? source.id : null });
        if (validation.mode !== TALENT_LEARNING_MODE.ENFORCE) continue;
        if (!validation.rulesOk) throw new Error([...validation.reasons, ...validation.guidance].join(" "));
        spendPurchaseResources(state, Number(validation.xpCost ?? 0));
        if (workflow === "nativeTalent") addPurchaseCreate(state, source);
        else addPurchaseUpdate(state, source, {});
      }
      return finishPurchaseProjection(state, intent);
    }

    const access = correction(actor, choices.administrativeReason, requester);
    if (workflow === "spendXpDraft" && access.completed && !access.waiveXp) throw new Error("A GM Administrative Correction is required after character generation.");
    const entries = workflow === "spellPurchase" ? [{ id: "spell", kind: "spellLearn", payload: choices }]
      : choices.entries;
    if (!["spendXpDraft", "spellDraft", "spellPurchase"].includes(workflow) || !Array.isArray(entries) || !entries.length) throw new Error("Unsupported or empty purchase workflow.");

    for (const entry of entries) {
      const payload = entry.payload ?? {};
      const beforeXp = state.xpCost;
      const beforeWealth = state.wealthCost;
      let name = entry.label ?? entry.kind;
      if (entry.kind === "characteristicAdvance" && workflow === "spendXpDraft") {
        const key = String(payload.key ?? "");
        if (!["str", "end", "agi", "int", "wp", "prc", "prs"].includes(key)) throw new Error("This characteristic cannot be advanced.");
        const cha = state.system.characteristics?.[key];
        if (!cha || ![cha.base, cha.total, cha.bonus].every(Number.isFinite)) throw new Error("The characteristic is unavailable or inconsistent.");
        const cost = computeCharacteristicAdvancementCost(cha).xpCost;
        spendPurchaseResources(state, cost, 0, access);
        cha.base += 1; cha.total += 1; cha.bonus = Math.floor(cha.total / 10);
        state.actorPatch[`system.characteristics.${key}.base`] = cha.base;
      } else if (entry.kind === "addSkillLikeItem" && workflow === "spendXpDraft") {
        const source = payload.itemData;
        if (!["skill", "magicSkill", "combatStyle"].includes(source?.type)) throw new Error("Invalid skill purchase type.");
        const metadata = await getCoreSkillMetadata();
        const sourceId = extractCoreSkillSourceDocumentId(source);
        const folderId = getEmbeddedCoreSkillFolderId(source);
        if (source.type !== "combatStyle" && ((sourceId && !metadata.documentIds.has(sourceId))
            || (!sourceId && folderId && metadata.allFolderIds.has(folderId) && !metadata.coreFolderIds.has(folderId)))) {
          throw new Error("Only the existing core skill sources can be added here.");
        }
        const item = addPurchaseCreate(state, source, String(payload.tempId ?? ""));
        name = item.name;
      } else if (["skillRankAdvance", "skillAddSpec", "combatStyleAddEquipment"].includes(entry.kind) && workflow === "spendXpDraft") {
        const item = resolveItem(state, payload.itemRef);
        if (!item || !["skill", "magicSkill", "combatStyle"].includes(item.type)) throw new Error("The staged skill is unavailable.");
        const plan = buildSkillAdvancementPlan({ actor: purchaseActorFacade(state), item, flatData: payload.flatData, options: { bypassXpPayment: access.waiveXp } });
        if (!plan.ok) throw new Error(plan.reason);
        spendPurchaseResources(state, Number(plan.xpCost ?? 0), 0, access);
        addPurchaseUpdate(state, item, payload.flatData);
        name = item.name;
      } else if (entry.kind === "talentLearn" && workflow === "spendXpDraft") {
        const facade = purchaseActorFacade(state);
        if (access.waiveXp) facade.system = { ...state.system, xp: Number.MAX_SAFE_INTEGER };
        const validation = validateTalentLearning(facade, payload.itemData, { source: "chargen-spendxp-confirm" });
        if (!validation.rulesOk) throw new Error([...validation.reasons, ...validation.guidance].join(" "));
        spendPurchaseResources(state, Number(validation.xpCost ?? 0), 0, access);
        name = addPurchaseCreate(state, payload.itemData).name;
      } else if (entry.kind === "spellLearn") {
        name = planSpell(state, payload.itemData, payload.paymentMode === "drakes" ? "drakes" : "xp", requester,
          { waiveXp: workflow === "spendXpDraft" && access.waiveXp }).item.name;
      } else throw new Error("Unsupported purchase entry.");
      const costXp = state.xpCost - beforeXp;
      const costWealth = state.wealthCost - beforeWealth;
      if (!access.waiveXp && entry.costXp != null && Number(entry.costXp) !== costXp
          || entry.costWealth != null && Number(entry.costWealth) !== costWealth) throw new Error(`Purchase cost changed for ${name}. Restage the entry.`);
      if (workflow === "spendXpDraft") state.spendRows.push({ type: entry.kind, name, costXp, costWealth, details: { stagedKind: entry.kind } });
    }
    return finishPurchaseProjection(state, intent, {
      finalize: (live, results) => purchaseLogs(state, intent, live, results),
      result: results => ({ applied: entries.length, createdItemIds: Object.values(results).map(item => item.id).filter(Boolean) }),
    });
  } catch (error) { return { ok: false, reason: String(error?.message ?? error) }; }
}
