export async function registerWarfareProfiles() {
  try {
    const {
      registerWarfareProfile,
      UESRPG_0_2_PROFILE,
      LEGACY_STUB_PROFILE
    } = await import("../../core/mass-warfare/index.js");
    registerWarfareProfile(UESRPG_0_2_PROFILE);
    registerWarfareProfile(LEGACY_STUB_PROFILE);
  } catch (err) {
    console.warn("UESRPG | Failed to register Mass Warfare profiles", err);
  }
}
