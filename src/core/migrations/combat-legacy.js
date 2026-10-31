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
import { MIGRATION_REVISIONS } from "./revisions.js";
import { isActiveGMUser } from "../../utils/users.js";

const MODULE_ID = SYSTEM_ID;
const _COMBAT_LEGACY_MIGRATION_REVISION = MIGRATION_REVISIONS.combatLegacy;

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
  const failureReferences = [];

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
    else {
      failed += 1;
      failureReferences.push(message.uuid ?? `ChatMessage.${message.id}`);
    }
  }

  return { visited, stageUpdates, contentUpdates, updated, failed, failureReferences };
}

export async function normalizeCombatLegacy() {
  if (!game.user?.isGM) return null;
  return await _migrateLegacyOpposedMessages();
}

export async function migrateCombatLegacyIfNeeded() {
  if (!isActiveGMUser(game.user)) return;

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

    if (result.failed > 0) {
      const error = new Error(`${result.failed} combat chat update(s) failed; retry manually from Migration settings.`);
      error.migrationTelemetry = { result };
      throw error;
    }

    markMigrationRevisionApplied(state, "combatLegacy", _COMBAT_LEGACY_MIGRATION_REVISION, {
      result,
      before: before?.counts ?? {},
      after: after?.counts ?? {}
    });
    await setMigrationState(state);
    console.log(`${MODULE_ID} | Combat legacy migration complete: ${_buildSummary(before, after)}`);
  } catch (err) {
    console.error(`${MODULE_ID} | Combat legacy migration failed`, err);
    throw err;
  }
}
