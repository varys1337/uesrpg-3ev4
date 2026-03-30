let runtimeInitialized = false;

export function registerAlchemyRuntimeHooks({ onDamageApplied, onUpdateCombat } = {}) {
  if (runtimeInitialized) {
    console.warn("UESRPG | Alchemy runtime already initialized - skipping duplicate registration.");
    return false;
  }

  runtimeInitialized = true;

  Hooks.on("uesrpgDamageApplied", (targetActor, context) => {
    Promise.resolve(onDamageApplied?.(targetActor, context)).catch((err) => {
      console.error("UESRPG | Alchemy on-hit resolution failed", err);
    });
  });

  Hooks.on("updateCombat", (combat, updateData) => {
    try {
      onUpdateCombat?.(combat, updateData);
    } catch (err) {
      console.warn("UESRPG | Alchemy round tick failed", err);
    }
  });

  return true;
}
