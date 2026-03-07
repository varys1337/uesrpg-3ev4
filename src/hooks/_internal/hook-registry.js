function ensureInternalState() {
  game.uesrpg = game.uesrpg ?? {};
  game.uesrpg._internal = game.uesrpg._internal ?? {};
  game.uesrpg._internal.hooks = game.uesrpg._internal.hooks ?? new Set();
  return game.uesrpg._internal.hooks;
}

export function getHookRegistry() {
  return ensureInternalState();
}

export function isRegistered(key) {
  const registry = ensureInternalState();
  return registry.has(String(key));
}

export function registerOnce(key, registerFn) {
  const k = String(key);
  const registry = ensureInternalState();
  if (registry.has(k)) return false;
  registerFn?.();
  registry.add(k);
  return true;
}
