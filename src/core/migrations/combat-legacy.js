/**
 * Combat legacy migration pass for Release N readiness.
 *
 * Scope:
 * - Legacy opposed chat message stage migration (and action-button content rewrites)
 * - Post-migration readiness scan summary
 */

import { SYSTEM_ID } from "../constants.js";
import {
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState
} from "./state.js";
import { requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { runCombatLegacyReadinessScan } from "../combat/legacy-readiness-scanner.js";

const MODULE_ID = SYSTEM_ID;
const _COMBAT_LEGACY_MIGRATION_REVISION = 1;

const LEGACY_STAGE_MAP = Object.freeze({
  "attacker-roll": "attacker-commit",
  "defender-roll": "defender-commit",
  "defender-nodefense": "defender-commit-nodefense",
});

function _rewriteLegacyOpposedActions(content) {
  if (typeof content !== "string" || !content) return content;
  let next = content;
  const rewrites = [
    ["attacker-roll", "attacker-commit"],
    ["defender-roll", "defender-commit"],
    ["defender-nodefense", "defender-commit-nodefense"],
  ];
  for (const [from, to] of rewrites) {
    const rx = new RegExp(`(data-ues-opposed-action\\\\s*=\\\\s*["'])${from}(["'])`, "g");
    next = next.replace(rx, `$1${to}$2`);
  }
  return next;
}

function _buildSummary(before, after) {
  const b = before?.counts ?? {};
  const a = after?.counts ?? {};
  return [
    `qualities ${Number(b.weaponFreeTextQualities ?? 0)} -> ${Number(a.weaponFreeTextQualities ?? 0)}`,
    `range ${Number(b.weaponLegacyRange ?? 0)} -> ${Number(a.weaponLegacyRange ?? 0)}`,
    `legacyStages ${Number(b.legacyOpposedMessageStages ?? 0)} -> ${Number(a.legacyOpposedMessageStages ?? 0)}`
  ].join(", ");
}

async function _migrateLegacyOpposedMessages() {
  let visited = 0;
  let stageUpdates = 0;
  let contentUpdates = 0;
  let updated = 0;
  let failed = 0;

  for (const message of (game.messages?.contents ?? [])) {
    visited += 1;
    const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    if (!opposed || typeof opposed !== "object") continue;

    const stage = String(opposed.stage ?? "").trim();
    const mapped = LEGACY_STAGE_MAP[stage] ?? null;
    const nextContent = _rewriteLegacyOpposedActions(message?.content ?? "");
    const contentChanged = typeof message?.content === "string" && nextContent !== message.content;

    if (!mapped && !contentChanged) continue;

    const payload = {};
    if (mapped) {
      const cloned = foundry.utils.deepClone(opposed);
      cloned.stage = mapped;
      payload.flags = { "uesrpg-3ev4": { opposed: cloned } };
      stageUpdates += 1;
    }
    if (contentChanged) {
      payload.content = nextContent;
      contentUpdates += 1;
    }

    const ok = await requestUpdateChatMessage(message, payload);
    if (ok) updated += 1;
    else failed += 1;
  }

  return { visited, stageUpdates, contentUpdates, updated, failed };
}

export async function normalizeCombatLegacy() {
  if (!game.user?.isGM) return null;
  return await _migrateLegacyOpposedMessages();
}

export async function migrateCombatLegacyIfNeeded() {
  if (!game.user?.isGM) return;

  const state = getMigrationState();
  if (isMigrationRevisionApplied("combatLegacy", _COMBAT_LEGACY_MIGRATION_REVISION, state)) return;

  try {
    const before = await runCombatLegacyReadinessScan({ notify: false });
    const result = await _migrateLegacyOpposedMessages();
    const after = await runCombatLegacyReadinessScan({ notify: false });

    console.log(`${MODULE_ID} | Combat legacy migration`, {
      result,
      before: before?.counts ?? {},
      after: after?.counts ?? {}
    });

    const summary = _buildSummary(before, after);
    ui.notifications?.info?.(`Combat legacy migration complete: ${summary}`);

    markMigrationRevisionApplied(state, "combatLegacy", _COMBAT_LEGACY_MIGRATION_REVISION, {
      result,
      before: before?.counts ?? {},
      after: after?.counts ?? {}
    });
    await setMigrationState(state);
  } catch (err) {
    console.error(`${MODULE_ID} | Combat legacy migration failed`, err);
    ui.notifications?.warn?.("UESRPG combat legacy migration pass failed; check console for details.");
  }
}
