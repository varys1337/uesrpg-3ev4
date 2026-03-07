export async function registerDevTools() {
  try {
    const mod = await import("../../utils/dev/opposed-diagnostics.js");
    mod?.registerOpposedDiagnostics?.();
  } catch (err) {
    console.warn("UESRPG | Failed to register opposed diagnostics", err);
  }
}
