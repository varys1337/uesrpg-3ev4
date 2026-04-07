import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { buildWarfareDisciplineTN } from "../../mass-warfare/tn.js";
import { applyResolveLoss, hasHoldNextDefend, WARFARE_EFFECT_KEYS } from "../../mass-warfare/actions.js";

const HUMANOID_TYPES = new Set(["player character", "npc"]);

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export function isWarfareActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "warfare unit";
}

export function isHumanoidActor(actor) {
  return HUMANOID_TYPES.has(String(actor?.type ?? "").trim().toLowerCase());
}

export function getCombatDomain(actor) {
  if (isWarfareActor(actor)) return "warfare";
  if (isHumanoidActor(actor)) return "humanoid";
  return "unknown";
}

export function isHybridOpposed(data) {
  return Boolean(data?.context?.hybrid?.enabled);
}

export function getHybridDomain(data, sideKey, fallbackActor = null) {
  const side = data?.[sideKey] ?? {};
  const stored = String(side?.combatDomain ?? data?.context?.hybrid?.[`${sideKey}Domain`] ?? "").trim().toLowerCase();
  if (stored === "warfare" || stored === "humanoid") return stored;
  return getCombatDomain(fallbackActor);
}

function hasWarfareEffect(actor, effectKey) {
  return Boolean(actor?.effects?.find?.((effect) =>
    !effect?.disabled && effect?.flags?.uesrpg?.key === effectKey
  ));
}

function getLeaderWarfareUnits(humanoidActor) {
  if (!humanoidActor?.uuid) return [];
  const units = game.actors?.contents ?? [];
  return units.filter((actor) =>
    isWarfareActor(actor)
    && (
      String(actor?.system?.commander?.uuid ?? "") === String(humanoidActor.uuid)
      || String(actor?.system?.commanderAttachment?.leaderActorUuid ?? "") === String(humanoidActor.uuid)
    )
  );
}

function findHybridEngagement(attacker, defender, cfg = {}) {
  const attackerDomain = getCombatDomain(attacker);
  const defenderDomain = getCombatDomain(defender);
  if (attackerDomain === defenderDomain) return null;
  if (!["warfare", "humanoid"].includes(attackerDomain) || !["warfare", "humanoid"].includes(defenderDomain)) {
    return { error: "Only PC/NPC <-> Warfare Unit pairs can use mixed opposed combat." };
  }

  const explicit = Boolean(cfg?.hybridExplicit || cfg?.context?.hybridExplicit || cfg?.context?.hybrid?.explicit);
  if (explicit) {
    return {
      enabled: true,
      explicit: true,
      reason: String(cfg?.hybridReason ?? cfg?.context?.hybridReason ?? cfg?.context?.hybrid?.reason ?? "gm-explicit"),
      attackerDomain,
      defenderDomain,
    };
  }

  const warfareActor = attackerDomain === "warfare" ? attacker : defender;
  const humanoidActor = attackerDomain === "humanoid" ? attacker : defender;
  const attachedUnits = getLeaderWarfareUnits(humanoidActor);
  if (attachedUnits.length) {
    const joinFray = attachedUnits.some((unit) => hasWarfareEffect(unit, WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH));
    return {
      enabled: true,
      explicit: true,
      reason: joinFray ? "join-fray" : "attached-commander",
      attackerDomain,
      defenderDomain,
    };
  }

  return {
    error: "Mixed PC/NPC <-> Warfare Unit combat requires an attached commander, Join the Fray, or an explicit GM-invoked mixed action.",
  };
}

export function prepareHybridPendingData(attacker, defenders, cfg = {}) {
  if (!attacker || !Array.isArray(defenders) || defenders.length === 0) return null;
  const mixedCount = defenders.filter((defender) => getCombatDomain(defender) !== getCombatDomain(attacker)).length;
  if (mixedCount > 0 && defenders.length !== 1) {
    return { error: "Mixed Warfare <-> PC/NPC opposed combat currently supports exactly one defender." };
  }
  if (defenders.length !== 1) return null;
  return findHybridEngagement(attacker, defenders[0], cfg);
}

function getDamagingSpellEntries(actor) {
  const implementEntries = Array.isArray(actor?.system?.magic?.entries) ? actor.system.magic.entries : [];
  const scrollEntries = Array.isArray(actor?.system?._derived?.equipmentEntries)
    ? actor.system._derived.equipmentEntries.filter((entry) => entry.isBattleScroll && !entry.expended)
    : [];

  const damagingImplements = implementEntries
    .map((entry) => ({ source: "implement", entry }))
    .filter(({ entry }) => {
      const key = String(entry?.key ?? "").trim();
      const count = Math.max(1, Number(entry?.count ?? 1) || 1);
      return ["fireChannels", "frostChannels", "shockChannels", "poisonChannels"].includes(key) && count >= 2;
    });

  const damagingScrolls = scrollEntries.map((entry) => ({ source: "scroll", entry }));
  return [...damagingImplements, ...damagingScrolls];
}

export async function promptHybridWarfareAttack(actor, { initialAttackFamily = "" } = {}) {
  const canRanged = Boolean(actor?.system?._derived?.canRangedAttack);
  const spellEntries = getDamagingSpellEntries(actor);
  const hasSpell = spellEntries.length > 0;
  const chargeActive = hasWarfareEffect(actor, WARFARE_EFFECT_KEYS.CHARGE);
  const options = [
    `<option value="melee" ${initialAttackFamily === "melee" ? "selected" : ""}>Melee Attack</option>`,
    canRanged ? `<option value="ranged" ${initialAttackFamily === "ranged" ? "selected" : ""}>Ranged Attack</option>` : "",
    hasSpell ? `<option value="spell" ${initialAttackFamily === "spell" ? "selected" : ""}>Cast a Spell</option>` : "",
  ].filter(Boolean).join("");
  const spellOptions = spellEntries.map((choice, index) => {
    const name = esc(choice?.entry?.name ?? choice?.entry?.key ?? `Spell ${index + 1}`);
    const source = choice.source === "scroll" ? "battle scroll" : "implement";
    return `<option value="${index}">${name} (${source})</option>`;
  }).join("");

  return customDialog({
    title: `${actor?.name ?? "Unit"} - Mixed Attack`,
    content: `
      <div class="warfare-discipline-dialog">
        <div class="form-group">
          <label>Attack Family</label>
          <select name="attackFamily">${options}</select>
        </div>
        <div class="form-group">
          <label>Manual Modifier</label>
          <input type="number" name="modifier" value="0" style="width:90px;">
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="longRange"> Long Range (-10 TN)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="spareAmmo"> Spare Ammunition (extra die)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="charged" ${chargeActive ? "checked" : ""}> Count as Charging</label>
        </div>
        ${hasSpell ? `
        <div class="form-group">
          <label>Spell Source</label>
          <select name="spellIndex">${spellOptions}</select>
        </div>` : ""}
        <p class="notes">Mixed opposed attacks use Warfare Discipline on the unit side and the normal combat workflow on the humanoid side.</p>
      </div>`,
    buttons: {
      attack: {
        label: "Commit",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            attackFamily: String(root?.querySelector('[name="attackFamily"]')?.value ?? initialAttackFamily ?? "melee"),
            modifier: Number(root?.querySelector('[name="modifier"]')?.value ?? 0) || 0,
            longRange: Boolean(root?.querySelector('[name="longRange"]')?.checked),
            spareAmmo: Boolean(root?.querySelector('[name="spareAmmo"]')?.checked),
            charged: Boolean(root?.querySelector('[name="charged"]')?.checked),
            spellIndex: Number(root?.querySelector('[name="spellIndex"]')?.value ?? -1),
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "attack",
  }).then((choice) => {
    if (!choice) return null;
    if (choice.attackFamily === "spell") {
      const selectedSpell = spellEntries[choice.spellIndex] ?? null;
      if (!selectedSpell) {
        ui.notifications?.warn?.("Select a valid damaging implement or battle scroll.");
        return null;
      }
      choice.spell = {
        source: selectedSpell.source,
        key: String(selectedSpell.entry?.key ?? ""),
        name: String(selectedSpell.entry?.name ?? selectedSpell.entry?.key ?? "Spell"),
      };
    }
    return choice;
  });
}

export async function promptHybridWarfareDefense(actor, attacker) {
  const holdActive = hasHoldNextDefend(actor);
  return customDialog({
    title: `${actor?.name ?? "Unit"} - Mixed Defense`,
    content: `
      <div class="warfare-discipline-dialog">
        <p>Resolve this defense using the unit's current Discipline.</p>
        <div class="form-group">
          <label>Manual Modifier</label>
          <input type="number" name="modifier" value="0" style="width:90px;">
        </div>
        <p class="notes">
          Opponent: ${esc(attacker?.name ?? "Attacker")}<br>
          ${holdActive ? "Hold is active: the attacker suffers -20 TN in this mixed engagement." : "Hold is not active."}
        </p>
      </div>`,
    buttons: {
      defend: {
        label: "Commit",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            modifier: Number(root?.querySelector('[name="modifier"]')?.value ?? 0) || 0,
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "defend",
  });
}

export function applyHybridPendingState(data, hybridInfo) {
  if (!hybridInfo?.enabled) return data;
  data.context = data.context ?? {};
  data.context.hybrid = {
    enabled: true,
    explicit: true,
    reason: String(hybridInfo.reason ?? "mixed"),
    attackerDomain: hybridInfo.attackerDomain,
    defenderDomain: hybridInfo.defenderDomain,
  };
  data.attacker = data.attacker ?? {};
  data.attacker.combatDomain = hybridInfo.attackerDomain;
  data.attacker.hybrid = data.attacker.hybrid ?? {};
  const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
  for (const defender of defenders) {
    defender.combatDomain = hybridInfo.defenderDomain;
    defender.hybrid = defender.hybrid ?? {};
  }
  if (data.defender) {
    data.defender.combatDomain = hybridInfo.defenderDomain;
    data.defender.hybrid = data.defender.hybrid ?? {};
  }
  return data;
}

export function applyHybridAttackerTnPenalty(data, situationalMods = []) {
  if (!isHybridOpposed(data)) return situationalMods;
  if (String(data?.context?.hybrid?.attackerDomain ?? "") !== "humanoid") return situationalMods;
  if (String(data?.context?.hybrid?.defenderDomain ?? "") !== "warfare") return situationalMods;
  const holdActive = Boolean(data?.defender?.hybrid?.holdActive);
  if (holdActive) {
    situationalMods.push({ key: "warfare-hold", label: "Warfare Hold", value: -20, source: "warfare" });
  }
  return situationalMods;
}

export function buildHybridWarfareTn(actor, declaration = {}, { joinFray = false } = {}) {
  const extraBreakdown = [];
  if (declaration.longRange) extraBreakdown.push({ label: "Long Range", value: -10 });
  if (declaration.charged && String(actor?.system?._derived?.traditionKey ?? "") === "hammerfell") {
    extraBreakdown.push({ label: "Warrior Wave", value: 10 });
  }
  return buildWarfareDisciplineTN(actor, {
    manualModifier: Number(declaration.modifier ?? 0) || 0,
    joinFray,
    extraBreakdown,
  });
}

export async function rollHybridWarfareTest(actor, tn) {
  return doTestRoll(actor, {
    target: Number(tn ?? 0) || 0,
    allowLucky: false,
    allowUnlucky: false,
  });
}

export function getHybridWarfareDamageFormula(actor, declaration = {}, degree = 0) {
  const base = String(actor?.system?.gear?.dmg ?? "2d4").trim() || "2d4";
  const parts = [base];
  if (declaration.attackFamily === "ranged" && declaration.spareAmmo) {
    const match = base.match(/^(\d+)d(\d+)$/i);
    if (match) parts.push(`1d${match[2]}`);
  }
  if (declaration.attackFamily === "melee" && declaration.charged && actor?.system?._derived?.mountChargeDie) {
    parts.push(String(actor.system._derived.mountChargeDie));
  }
  const dos = Math.max(0, Number(degree ?? 0) || 0);
  if (dos) parts.push(String(dos));
  return parts.join(" + ");
}

export function getHybridWarfareAttackMetadata(actor, declaration = {}) {
  const family = String(declaration?.attackFamily ?? "melee");
  if (family === "spell") {
    return {
      label: String(declaration?.spell?.name ?? "Cast a Spell"),
      attackMode: "ranged",
      warfareMitigation: "magical",
      source: String(declaration?.spell?.name ?? "Warfare Spell"),
      isSpell: true,
    };
  }
  if (family === "ranged") {
    return {
      label: "Ranged Attack",
      attackMode: "ranged",
      warfareMitigation: "physical",
      source: `${actor?.name ?? "Unit"} Ranged Attack`,
      isSpell: false,
    };
  }
  return {
    label: declaration?.charged ? "Charging Attack" : "Melee Attack",
    attackMode: "melee",
    warfareMitigation: "physical",
    source: `${actor?.name ?? "Unit"} Attack`,
    isSpell: false,
  };
}

export async function applyHybridDamageToWarfareUnit(targetActor, {
  rawDamage = 0,
  damageType = "physical",
  magicSource = false,
} = {}) {
  const incoming = Math.max(0, Number(rawDamage ?? 0) || 0);
  const magical = Boolean(magicSource || String(damageType ?? "").toLowerCase() === "magic");
  const mitigation = magical
    ? Math.max(0, Number(targetActor?.system?.gear?.mar ?? 0) || 0)
    : Math.max(0, Number(targetActor?.system?.gear?.ar ?? 0) || 0);
  const resolveLoss = Math.max(0, incoming - mitigation);
  const result = await applyResolveLoss(targetActor, resolveLoss);
  return {
    resolveLoss,
    mitigation,
    mitigationType: magical ? "MAR" : "AR",
    gmDamageReport: {
      panelKey: `warfare-${targetActor?.id ?? foundry.utils.randomID()}`,
      totalDamage: resolveLoss,
      hp: null,
      tempHp: null,
      segments: [],
      traitNotes: [
        `${magical ? "MAR" : "AR"} ${mitigation}`,
        `Resolve ${result.current} -> ${result.next}`,
        result.bulkLoss > 0 ? `Bulk ${result.currentBulk} -> ${result.nextBulk}` : "No Bulk loss",
      ].filter(Boolean),
    },
  };
}
