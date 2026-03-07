/**
 * src/core/skills/opposed-workflow/helpers.js
 *
 * Private helpers for skill opposed action handlers.
 *
 * Houses concussive-bash bonus management and special-action modifier
 * application logic shared between the attacker and defender lanes.
 */

import { _getSpecialActionContext } from "./context.js";
import { _resolveDoc } from "./core/docs.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { getPreferredWeaponUuid as _getPreferredWeaponUuid, weaponHasQuality as _weaponHasQuality } from "../../combat/opposed/helpers/workflow.js";
import { SYSTEM_ID } from "../../system/namespace.js";
const SPECIAL_ACTION_HOOKED_IDS = new Set(["disarm", "trip", "takeWeapon", "take-weapon"]);

export function getConcussiveNextBashBonus(actor) {
  if (!actor?.getFlag) return 0;
  const raw = actor.getFlag(SYSTEM_ID, "combat.concussiveNextBash");
  if (raw == null) return 0;
  if (typeof raw === "number") return Math.max(0, Number(raw) || 0);
  if (typeof raw === "object") return Math.max(0, Number(raw?.bonus ?? 0) || 0);
  return 0;
}

export async function consumeConcussiveNextBash(actor) {
  if (!actor) return;
  await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.combat.-=concussiveNextBash`]: null });
}

export function resolveSpecialActionAttackerWeapon(actor, data) {
  if (!actor) return null;
  const saCtx = _getSpecialActionContext(data);
  const sourceWeaponUuid = String(saCtx?.sourceWeaponUuid ?? "").trim();
  if (sourceWeaponUuid) {
    const doc = _resolveDoc(sourceWeaponUuid);
    if (doc?.documentName === "Item" && doc?.parent?.id === actor.id) return doc;
  }
  const preferredUuid = String(_getPreferredWeaponUuid(actor, { meleeOnly: false }) ?? "").trim();
  if (!preferredUuid) return null;
  const preferred = _resolveDoc(preferredUuid);
  return (preferred?.documentName === "Item" && preferred?.parent?.id === actor.id) ? preferred : null;
}

export function applySpecialActionMods({ side, data, actor, attackerActor, situationalMods }) {
  if (!Array.isArray(situationalMods)) return { concussiveApplied: 0 };
  const saId = String(_getSpecialActionContext(data)?.id ?? "").trim();
  let concussiveApplied = 0;

  if (side === "attacker" && saId === "bash") {
    const bonus = getConcussiveNextBashBonus(actor);
    if (bonus > 0) {
      situationalMods.push({
        key: "quality:concussive-next-bash",
        label: "Concussive (Next Bash)",
        value: bonus,
        source: "quality"
      });
      concussiveApplied = bonus;
    }
  }

  if (side === "defender" && SPECIAL_ACTION_HOOKED_IDS.has(saId)) {
    const weapon = resolveSpecialActionAttackerWeapon(attackerActor, data);
    if (weapon && _weaponHasQuality(weapon, "hooked")) {
      situationalMods.push({
        key: "quality:hooked",
        label: "Hooked",
        value: -10,
        source: "quality"
      });
    }
  }

  return { concussiveApplied };
}

