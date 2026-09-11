import { tf } from "./i18n.js";

/**
 * Resolve a user-invoked dynamic import without allowing an import failure to
 * become an unhandled rejection. The caller retains control when loading fails.
 */
export async function loadDeferredModule(importer, { label = "workflow", notify = true } = {}) {
  try {
    const module = await importer();
    if (!module) throw new Error("Deferred module returned no exports");
    return module;
  } catch (error) {
    console.error("UESRPG | Failed to load deferred workflow", { label, error });
    if (notify) {
      ui.notifications?.error?.(tf("UESRPG.Notifications.Workflows.LoadFailed", { workflow: label }));
    }
    return null;
  }
}
