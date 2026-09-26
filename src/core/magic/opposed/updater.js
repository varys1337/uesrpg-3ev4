import { createOpposedCardUpdater } from '../../opposed/shared/card-persistence.js';
import { FLAG_SCOPE } from '../../system/namespace.js';

export const updateCard = createOpposedCardUpdater({
  scope: FLAG_SCOPE, key: 'magicOpposed', version: 2, family: 'magic',
});
