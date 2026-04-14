/**
 * Shield detection utilities (compatibility alias).
 * 
 * This file exists for backward compatibility with older imports.
 * New code should import directly from shield-utils.js.
 * 
 * @deprecated Use shield-utils.js instead
 */

export {
  isLegacyShieldSystemData,
  isShieldItem,
  isEquippedShieldItem,
  getShieldTypeKey,
  listEquippedShields,
  hasEquippedShield
} from './shield-utils.js';