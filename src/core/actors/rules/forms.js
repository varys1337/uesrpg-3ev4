/**
 * @file Form transformation detection utilities
 * @module core/actors/rules/forms
 * 
 * Provides helper functions to detect if an actor has items that grant shapeshifting forms.
 * These are pure query functions - they do not mutate actor data.
 */

function _getCachedForms(actorData) {
  return actorData?._aggCache?.agg?.forms ?? null;
}

/**
 * Check if actor has vampire lord form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if vampire lord form is available
 */
export function hasVampireLordForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.vampireLord === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormVampireLord");
}

/**
 * Check if actor has werewolf or werelion form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werewolf/werelion form is available
 */
export function hasWereWolfForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereWolf === true;
  return (actorData.items || []).some(item => 
    item?.system?.shiftFormStyle === "shiftFormWereWolf" || 
    item?.system?.shiftFormStyle === "shiftFormWereLion"
  );
}

/**
 * Check if actor has werebat form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werebat form is available
 */
export function hasWereBatForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereBat === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormWereBat");
}

/**
 * Check if actor has wereboar form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if wereboar form is available
 */
export function hasWereBoarForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereBoar === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormWereBoar");
}

/**
 * Check if actor has werebear form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werebear form is available
 */
export function hasWereBearForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereBear === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormWereBear");
}

/**
 * Check if actor has werecrocodile form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werecrocodile form is available
 */
export function hasWereCrocodileForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereCrocodile === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormWereCrocodile");
}

/**
 * Check if actor has werevulture form item equipped.
 * @param {Object} actorData - The actor's data
 * @returns {boolean} True if werevulture form is available
 */
export function hasWereVultureForm(actorData) {
  const forms = _getCachedForms(actorData);
  if (forms) return forms.wereVulture === true;
  return (actorData.items || []).some(item => item?.system?.shiftFormStyle === "shiftFormWereVulture");
}
