import { t } from "../../utils/i18n.js";

function _choice(id, name, labelKey) {
  return { id, name, labelKey };
}

export const LANGUAGE_CHOICES = [
  _choice("cyrodilic", "Cyrodilic", "UESRPG.Choices.Languages.cyrodilic"),
  _choice("nordic", "Nordic", "UESRPG.Choices.Languages.nordic"),
  _choice("aldmeri", "Aldmeri", "UESRPG.Choices.Languages.aldmeri"),
  _choice("dunmeri", "Dunmeri", "UESRPG.Choices.Languages.dunmeri"),
  _choice("bosmeri", "Bosmeri", "UESRPG.Choices.Languages.bosmeri"),
  _choice("yokudan", "Yokudan", "UESRPG.Choices.Languages.yokudan"),
  _choice("taagra", "Ta'agra", "UESRPG.Choices.Languages.taagra"),
  _choice("jel", "Jel", "UESRPG.Choices.Languages.jel"),
  _choice("orcish", "Orcish", "UESRPG.Choices.Languages.orcish"),
  _choice("nedic", "Nedic", "UESRPG.Choices.Languages.nedic"),
  _choice("ehlnofex", "Ehlnofex", "UESRPG.Choices.Languages.ehlnofex"),
  _choice("daedric", "Daedric", "UESRPG.Choices.Languages.daedric"),
  _choice("dovahzul", "Dovahzul", "UESRPG.Choices.Languages.dovahzul"),
  _choice("dwemeris", "Dwemeris", "UESRPG.Choices.Languages.dwemeris"),
  _choice("falmeris", "Falmeris", "UESRPG.Choices.Languages.falmeris"),
  _choice("reach-tongue", "Reach Tongue", "UESRPG.Choices.Languages.reachTongue"),
  _choice("nibenese", "Nibenese", "UESRPG.Choices.Languages.nibenese"),
  _choice("colovian", "Colovian", "UESRPG.Choices.Languages.colovian"),
];

export const FACTION_CHOICES = [
  _choice("fighters-guild", "Fighters Guild", "UESRPG.Choices.Factions.fightersGuild"),
  _choice("mages-guild", "Mages Guild", "UESRPG.Choices.Factions.magesGuild"),
  _choice("thieves-guild", "Thieves Guild", "UESRPG.Choices.Factions.thievesGuild"),
  _choice("dark-brotherhood", "Dark Brotherhood", "UESRPG.Choices.Factions.darkBrotherhood"),
  _choice("companions", "Companions", "UESRPG.Choices.Factions.companions"),
  _choice("imperial-legion", "Imperial Legion", "UESRPG.Choices.Factions.imperialLegion"),
  _choice("dawnguard", "Dawnguard", "UESRPG.Choices.Factions.dawnguard"),
  _choice("college-of-winterhold", "College of Winterhold", "UESRPG.Choices.Factions.collegeOfWinterhold"),
  _choice("blades", "Blades", "UESRPG.Choices.Factions.blades"),
  _choice("morag-tong", "Morag Tong", "UESRPG.Choices.Factions.moragTong"),
  _choice("house-hlaalu", "House Hlaalu", "UESRPG.Choices.Factions.houseHlaalu"),
  _choice("house-redoran", "House Redoran", "UESRPG.Choices.Factions.houseRedoran"),
  _choice("house-telvanni", "House Telvanni", "UESRPG.Choices.Factions.houseTelvanni"),
  _choice("tribunal-temple", "Tribunal Temple", "UESRPG.Choices.Factions.tribunalTemple"),
  _choice("penitus-oculatus", "Penitus Oculatus", "UESRPG.Choices.Factions.penitusOculatus"),
];

export function getChoiceLabel(choice) {
  return t(choice?.labelKey, choice?.name ?? "");
}
