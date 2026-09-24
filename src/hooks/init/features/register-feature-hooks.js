import { registerTalentLearningHooks } from "./register-talent-learning-hooks.js";
import { registerDefaultItemAETransferHook } from "./register-default-item-ae-transfer.js";
import { registerUpkeepDeleteGuard } from "./register-upkeep-delete-guard.js";
import { registerBufferCleanup } from "./register-buffer-cleanup.js";

export function registerFeatureHooks() {
  registerTalentLearningHooks();
  registerDefaultItemAETransferHook();
  registerUpkeepDeleteGuard();
  registerBufferCleanup();
}
