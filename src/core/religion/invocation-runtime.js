import { customDialog } from "../../utils/dialog-v2-helper.js";
import { doTestRoll, formatResultSummary } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { buildCircumstanceOptionsHtml, circumstanceLabel, normalizeCircumstanceMod } from "../opposed/circumstance.js";
import { SKILL_DIFFICULTIES, computeSkillTN } from "../skills/skill-tn.js";
import { isReligionWorshipEnabled } from "../homebrew/settings.js";
import { getReligionDomain } from "./domain-registry.js";
import {
  getActorRitualDomainItems,
  getInvocationCircle,
  getInvocationDomainKey,
  getInvocationEligibleStoreDomainKeys,
  getInvocationTNDomainKey,
  getPreparedInvocationStoreKeys,
  getRitualSkillRankNumber,
} from "./ritual-domains.js";
import { getWorshipDomainState } from "./worship-store.js";
import { hasShrineWarden, getSeasonedTheurgeBindings } from "./clerical-talents.js";
import { isActorInsideMatchingConsecratedRegion } from "./consecration.js";
import { updateWorshipDomain } from "./worship-service.js";
import { getLocalizedInvocationEffect, getLocalizedInvocationName } from "./religion-i18n.js";

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function formatTextBlock(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

async function chooseStoreDomain(actor, invocation) {
  const eligible = getInvocationEligibleStoreDomainKeys(actor, invocation);
  const prepared = getPreparedInvocationStoreKeys(actor, invocation.id).filter((key) => eligible.includes(key));
  if (!prepared.length) throw new Error("Invocation is not prepared in any eligible domain.");
  if (prepared.length === 1) return prepared[0];
  const choice = await customDialog({
    title: "Choose Invocation Domain",
    content: `<div style="display:flex; flex-direction:column; gap:8px;">
      <label>Prepared Domain
        <select name="domainKey" style="width:100%;">
          ${prepared.map((key) => `<option value="${key}">${escapeHtml(getReligionDomain(key)?.label ?? key)}</option>`).join("")}
        </select>
      </label>
    </div>`,
    buttons: {
      cast: { label: "Cast", callback: (html) => (html instanceof HTMLElement ? html : html?.[0])?.querySelector('select[name="domainKey"]')?.value ?? "" },
      cancel: { label: "Cancel", callback: () => "" },
    },
    defaultButton: "cast",
    width: 360,
  });
  if (!choice) throw new Error("Invocation casting was cancelled.");
  return choice;
}

async function chooseInvocationOptions(actor, invocation, {
  storeDomainKey,
  tnDomainKey,
  baseTN,
  pietyCost,
  circlePenalty,
  shrineBonus,
} = {}) {
  const aspects = Array.isArray(invocation?.system?.aspects) ? invocation.system.aspects : [];
  return customDialog({
    title: "Invocation Options",
    content: `<div class="uesrpg-spell-options">
      <h3>${escapeHtml(getLocalizedInvocationName(invocation) || invocation?.name || "Invocation")}</h3>
      <div class="form-group">
        <label>PP Cost: <b>${pietyCost}</b></label>
      </div>
      <div class="form-group">
        <label>Store Domain: <b>${escapeHtml(getReligionDomain(storeDomainKey)?.label ?? storeDomainKey)}</b></label>
      </div>
      <div class="form-group">
        <label>TN Skill: <b>${escapeHtml(getReligionDomain(tnDomainKey)?.ritualSkillName ?? getReligionDomain(tnDomainKey)?.label ?? tnDomainKey)}</b></label>
      </div>
      <div class="form-group">
        <label>Base TN: <b>${baseTN}</b></label>
      </div>
      ${circlePenalty ? `<div class="form-group"><label>Circle Penalty: <b>${circlePenalty}</b></label></div>` : ""}
      ${shrineBonus ? `<div class="form-group"><label>Shrine Warden: <b>+${shrineBonus}</b></label></div>` : ""}
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">
          ${SKILL_DIFFICULTIES.map((difficulty) => {
            const sign = difficulty.mod >= 0 ? "+" : "";
            const selected = difficulty.key === "average" ? "selected" : "";
            return `<option value="${difficulty.key}" ${selected}>${difficulty.label} (${sign}${difficulty.mod})</option>`;
          }).join("\n")}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:8px;">
        <label style="display:block;"><b>Circumstance Modifier</b></label>
        <select name="circumstanceMod" style="width:100%;">
          ${buildCircumstanceOptionsHtml(0)}
        </select>
      </div>
      <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input type="number" name="manualModifier" value="0" style="width:120px; text-align:center;" />
      </div>
      ${aspects.length ? `
      <div class="form-group" style="margin-top:8px;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="aspectMatch" />
          <span><b>Aspect Match</b> (+10) [${escapeHtml(aspects.join(", "))}]</span>
        </label>
      </div>` : ""}
    </div>`,
    buttons: {
      cast: {
        label: "Cast",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            aspectMatch: root?.querySelector('input[name="aspectMatch"]')?.checked === true,
            difficultyKey: String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average"),
            circumstanceMod: normalizeCircumstanceMod(root?.querySelector('select[name="circumstanceMod"]')?.value ?? 0, 0),
            manualModifier: asNumber(root?.querySelector('input[name="manualModifier"]')?.value ?? 0, 0),
          };
        },
      },
      cancel: { label: "Cancel", callback: () => null },
    },
    default: "cast",
    width: 390,
  });
}

async function chooseSeasonedTheurgePotency(invocation, rolledDegree, rankNumber) {
  const rolled = Math.max(0, asNumber(rolledDegree, 0));
  const rank = Math.max(0, asNumber(rankNumber, 0));
  if (!rolled || rolled === rank) return Math.max(rolled, rank);

  const choice = await customDialog({
    title: "Seasoned Theurge",
    content: `<div style="display:flex; flex-direction:column; gap:8px;">
      <div><b>${escapeHtml(invocation?.name ?? "Invocation")}</b> succeeded.</div>
      <div>Choose the potency to use for this rite.</div>
      <div><b>Rolled DoS:</b> ${rolled}</div>
      <div><b>Ritual Rank:</b> ${rank}</div>
    </div>`,
    buttons: {
      rolled: { label: `Use Rolled DoS (${rolled})`, callback: () => "rolled" },
      rank: { label: `Use Ritual Rank (${rank})`, callback: () => "rank" },
      cancel: { label: "Keep Rolled DoS", callback: () => "rolled" },
    },
    defaultButton: "rolled",
    width: 360,
  });
  return choice === "rank" ? rank : rolled;
}

function buildInvocationFlavor({
  invocation,
  storeDomainKey,
  tnDomainKey,
  pietyCost,
  potencyValue,
  tn,
  options,
  result,
} = {}) {
  const tags = [];
  tags.push(`<span class="tag modifier-tag">Store ${escapeHtml(getReligionDomain(storeDomainKey)?.label ?? storeDomainKey)}</span>`);
  if (storeDomainKey !== getInvocationDomainKey(invocation)) {
    tags.push(`<span class="tag modifier-tag">Invocation ${escapeHtml(getReligionDomain(getInvocationDomainKey(invocation))?.label ?? getInvocationDomainKey(invocation))}</span>`);
  }
  if (getInvocationTNDomainKey(invocation)) {
    tags.push(`<span class="tag modifier-tag">TN ${escapeHtml(getReligionDomain(tnDomainKey)?.ritualSkillName ?? getReligionDomain(tnDomainKey)?.label ?? tnDomainKey)}</span>`);
  }
  tags.push(`<span class="tag modifier-tag">PP ${pietyCost}</span>`);
  if (options?.aspectMatch) tags.push(`<span class="tag modifier-tag">Aspect +10</span>`);
  if (options?.circumstanceMod) tags.push(`<span class="tag modifier-tag">${escapeHtml(circumstanceLabel(options.circumstanceMod))}</span>`);
  if (options?.manualModifier) tags.push(`<span class="tag modifier-tag">Mod ${options.manualModifier >= 0 ? "+" : ""}${options.manualModifier}</span>`);

  const degreeLine = result?.isSuccess
    ? `<b style="color:green;">${formatResultSummary(result, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
    : `<b style="color:rgb(168, 5, 5);">${formatResultSummary(result, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`;

  const breakdownRows = (tn?.breakdown ?? []).map((entry) => {
    const value = Number(entry?.value ?? 0);
    const sign = value >= 0 ? "+" : "";
    return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${escapeHtml(entry?.label ?? "Modifier")}</span><span>${sign}${value}</span></div>`;
  }).join("");

  const declaredParts = [];
  if (tn?.difficulty?.label) declaredParts.push(`${tn.difficulty.label} (${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod})`);
  if (options?.circumstanceMod) declaredParts.push(circumstanceLabel(options.circumstanceMod));
  if (options?.manualModifier) declaredParts.push(`Mod ${options.manualModifier >= 0 ? "+" : ""}${options.manualModifier}`);
  if (options?.aspectMatch) declaredParts.push("Aspect +10");

  const effectText = getLocalizedInvocationEffect(invocation);

  return `
    <div>
      <h2 style="margin:0 0 6px 0;"><img src="${escapeHtml(invocation?.img ?? "")}" style="height:24px; vertical-align:middle; margin-right:6px;"/>${escapeHtml(getLocalizedInvocationName(invocation) || invocation?.name || "Invocation")}</h2>
      <div><b>Target Number:</b> ${tn?.finalTN ?? 0}</div>
      ${declaredParts.length ? `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>` : ""}
      <div style="margin-top:4px;">${degreeLine}</div>
      ${potencyValue ? `<div style="margin-top:4px;"><b>Potency:</b> ${potencyValue}</div>` : ""}
      <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
      ${effectText ? `<details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">Effect</summary><div style="margin-top:4px; font-size:12px; opacity:0.95;">${formatTextBlock(effectText)}</div></details>` : ""}
      <div class="tag-container">${tags.join("")}</div>
    </div>`;
}

export async function castInvocationFromItem({ actor, invocation, token = null } = {}) {
  try {
    if (!isReligionWorshipEnabled()) throw new Error("Religion & Worship is disabled.");
    if (!actor || invocation?.type !== "invocation") throw new Error("Invalid invocation cast request.");

    const storeDomainKey = await chooseStoreDomain(actor, invocation);
    const storeState = getWorshipDomainState(actor, storeDomainKey);
    if (storeState?.penance?.blocked === true) throw new Error("Invocation is blocked by penance.");

    const pietyCost = Math.max(1, asNumber(invocation?.system?.pietyCost, getInvocationCircle(invocation)));
    if (asNumber(storeState?.piety?.value, 0) < pietyCost) throw new Error("Not enough Piety Points to invoke this rite.");

    const configuredTnDomainKey = getInvocationTNDomainKey(invocation);
    const tnDomainKey = configuredTnDomainKey || storeDomainKey;
    const ritualItem = getActorRitualDomainItems(actor)[tnDomainKey];
    if (!ritualItem) {
      if (configuredTnDomainKey) {
        throw new Error(`This invocation is bound to ${getReligionDomain(configuredTnDomainKey)?.label ?? configuredTnDomainKey}, but that ritual domain is not trained.`);
      }
      throw new Error("No ritual domain skill was found for the prepared store.");
    }

    const circle = getInvocationCircle(invocation);
    const rankNumber = getRitualSkillRankNumber(ritualItem);
    const circlePenalty = Math.max(0, circle - rankNumber) * -10;
    const shrineBonus = hasShrineWarden(actor) && isActorInsideMatchingConsecratedRegion(actor, storeDomainKey) ? 20 : 0;
    const baseTN = asNumber(ritualItem?.system?.value, 0);
    const options = await chooseInvocationOptions(actor, invocation, {
      storeDomainKey,
      tnDomainKey,
      baseTN,
      pietyCost,
      circlePenalty,
      shrineBonus,
    });
    if (!options) return null;

    const aspectBonus = options.aspectMatch ? 10 : 0;
    const situationalMods = [];
    if (circlePenalty) situationalMods.push({ label: "Circle Penalty", value: circlePenalty, source: "invocationCircle" });
    if (shrineBonus) situationalMods.push({ label: "Shrine Warden", value: shrineBonus, source: "shrineWarden" });
    if (aspectBonus) situationalMods.push({ label: "Aspect Match", value: aspectBonus, source: "invocationAspect" });
    if (options.circumstanceMod) {
      situationalMods.push({
        label: `Circumstance: ${circumstanceLabel(options.circumstanceMod)}`,
        value: options.circumstanceMod,
        source: "circumstance",
      });
    }

    const tn = computeSkillTN({
      actor,
      skillItem: ritualItem,
      difficultyKey: options.difficultyKey,
      manualMod: options.manualModifier,
      situationalMods,
    });
    const rollResult = await doTestRoll(actor, {
      target: tn.finalTN,
      allowLucky: true,
      allowUnlucky: true,
    });

    const seasonedTheurge = getSeasonedTheurgeBindings(actor).includes(storeDomainKey);
    const potencyValue = rollResult?.isSuccess
      ? (seasonedTheurge
        ? await chooseSeasonedTheurgePotency(invocation, rollResult?.degree, rankNumber)
        : Math.max(0, asNumber(rollResult?.degree, 0)))
      : 0;

    await updateWorshipDomain(actor, storeDomainKey, (current) => ({
      ...current,
      piety: {
        ...(current?.piety ?? {}),
        value: Math.max(0, asNumber(current?.piety?.value, 0) - pietyCost),
      },
      history: [
        ...(Array.isArray(current?.history) ? current.history : []),
        {
          id: foundry.utils.randomID(),
          type: "invocationCast",
          createdAt: Date.now(),
          invocationId: invocation.id,
          invocationName: getLocalizedInvocationName(invocation) || invocation.name,
          invocationDomainKey: getInvocationDomainKey(invocation),
          storeDomainKey,
          tnDomainKey,
          target: tn.finalTN,
          pietyCost,
          success: rollResult?.isSuccess === true,
          rollSummary: formatResultSummary(rollResult, { uppercase: true, includeDegree: true, degreeStyle: "dash" }),
          aspectMatch: options.aspectMatch === true,
        },
      ].slice(-50),
    }));

    const flavor = buildInvocationFlavor({
      invocation,
      storeDomainKey,
      tnDomainKey,
      pietyCost,
      potencyValue,
      tn,
      options,
      result: rollResult,
    });
    const rollMode = getCoreRollMode();
    const invocationTest = {
      actorUuid: actor.uuid,
      invocationUuid: invocation.uuid,
      invocationName: getLocalizedInvocationName(invocation) || invocation.name,
      storeDomainKey,
      tnDomainKey,
      target: tn.finalTN,
      isSuccess: Boolean(rollResult?.isSuccess),
      degree: Number(rollResult?.degree ?? 0) || 0,
      textual: String(rollResult?.textual ?? ""),
      pietyCost,
      potency: potencyValue,
    };

    await rollResult.roll.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor, token }),
      flavor,
      flags: {
        uesrpg: {
          invocationTest,
          reroll: { used: false, source: null },
        },
        "uesrpg-3ev4": { invocationTest },
      },
      rollMode,
    });

    return { storeDomainKey, target: tn.finalTN, rollResult, pietyCost, potencyValue };
  } catch (error) {
    ui.notifications?.warn?.(error?.message ?? "Invocation casting failed.");
    return null;
  }
}
