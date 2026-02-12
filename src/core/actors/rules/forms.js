/**
 * @file Form transformation detection utilities
 * @module core/actors/rules/forms
 * 
 * Provides helper functions to detect if an actor has items that grant shapeshifting forms.
 * These are pure query functions - they do not mutate actor data.
 */

/**
 * Check if actor has vampire lord form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if vampire lord form is available
 */
export function hasVampireLordForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormVampireLord");
  return form.length > 0;
}

/**
 * Check if actor has werewolf or werelion form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werewolf/werelion form is available
 */
export function hasWereWolfForm(actorData) {
  const form = (actorData.items || []).filter(item => 
    item?.system?.shiftFormStyle === "shiftFormWereWolf" || 
    item?.system?.shiftFormStyle === "shiftFormWereLion"
  );
  return form.length > 0;
}

/**
 * Check if actor has werebat form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werebat form is available
 */
export function hasWereBatForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereBat");
  return form.length > 0;
}

/**
 * Check if actor has wereboar form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if wereboar form is available
 */
export function hasWereBoarForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereBoar");
  return form.length > 0;
}

/**
 * Check if actor has werebear form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werebear form is available
 */
export function hasWereBearForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereBear");
  return form.length > 0;
}

/**
 * Check if actor has werecrocodile form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werecrocodile form is available
 */
export function hasWereCrocodileForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereCrocodile");
  return form.length > 0;
}

/**
 * Check if actor has werevulture form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werevulture form is available
 */
export function hasWereVultureForm(actorData) {
  const form = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereVulture");
  return form.length > 0;
}
