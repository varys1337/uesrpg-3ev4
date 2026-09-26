import { createOpposedCardUpdater } from '../../../opposed/shared/card-persistence.js';
import { FLAG_NS, FLAG_KEY, CARD_VERSION } from './constants.js';
import { _renderCard } from './render.js';

export const _updateCard = createOpposedCardUpdater({
  scope: FLAG_NS, key: FLAG_KEY, version: CARD_VERSION, family: 'skills', render: _renderCard,
});

/** Attach a granted free special action without mutating live document flags. */
export function setSpecialActionContext(message, context) {
  return _updateCard(message, (state) => {
    state.specialActionId = context.id;
    state.allowCombatStyle = true;
    state.isFreeAction = true;
    state.specialActionContext = foundry.utils.deepClone(context);
    return state;
  });
}
