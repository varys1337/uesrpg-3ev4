/**
 * src/core/wounds/index.js
 */

import { registerWoundHooks, WoundsAPI } from "./wound-engine.js";
import { registerDeathTestHooks, tickDeathTestsEndTurn } from "./death-tests.js";

let _woundsRegistered = false;

export function registerWounds() {
  if (_woundsRegistered) return;
  _woundsRegistered = true;
  registerWoundHooks();
  registerDeathTestHooks();
}

export function buildWoundsApi() {
  return {
    ...WoundsAPI,
    tickDeathTestsEndTurn
  };
}
