import { createOpposedCardUpdater } from '../../opposed/shared/card-persistence.js';
import { FLAG_NS, FLAG_KEY, CARD_VERSION } from './constants.js';
import { _renderCard } from './render.js';

export const _updateCard = createOpposedCardUpdater({
  scope: FLAG_NS, key: FLAG_KEY, version: CARD_VERSION, family: 'char', render: _renderCard,
});
