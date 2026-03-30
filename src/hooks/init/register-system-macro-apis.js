export async function registerSystemMacroApis() {
  const [
    { registerEnchantingApi },
    { registerCharGenApi },
    { registerTreatWoundsMacroApi },
    { registerAwardXpMacroApi },
    { registerAlchemyApi },
    { registerTravelApi }
  ] = await Promise.all([
    import("../../macros/enchanting-workshop.js"),
    import("../../macros/character-generation.js"),
    import("../../macros/treat-wounds.js"),
    import("../../macros/award-xp.js"),
    import("../../core/alchemy/index.js"),
    import("../../core/travel/index.js")
  ]);

  registerEnchantingApi();
  registerCharGenApi();
  registerTreatWoundsMacroApi();
  registerAwardXpMacroApi();
  registerAlchemyApi();
  registerTravelApi();
}
