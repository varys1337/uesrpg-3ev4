import { createOpposedCardUpdater } from '../../opposed/shared/card-persistence.js';
import { FLAG_SCOPE } from '../../system/namespace.js';
import { getDefenderEntries, getMagicDefenderDamage } from './schema.js';
import { resolveActorFromUuidSync, resolveUuidSync } from '../../../utils/uuid-cache.js';
import { prepareResolvedSpellEffectPayload } from '../effects/spell-effects.js';
import { restoreOutcomeItem } from '../../../utils/item-outcome-snapshot.js';

async function prepareNewEffects(data, previous, message) {
  const prior = getDefenderEntries(previous);
  for (const defender of getDefenderEntries(data)) {
    const damage = getMagicDefenderDamage(data, defender);
    const payload = damage?._magicPayload;
    if (!damage?.applyPayload || !payload?.needsEffects) continue;
    if ((damage.blockResult?.blocked && !damage.blockResult.isAoE) || (damage.wardResult?.blocked && !damage.wardResult.isAoE)) continue;
    const old = prior.find(entry => defender.tokenUuid ? entry.tokenUuid === defender.tokenUuid : entry.actorUuid === defender.actorUuid);
    if (old && getMagicDefenderDamage(previous, old)?.applyPayload) continue;
    const casterActor = resolveActorFromUuidSync(payload.casterUuid);
    const spell = payload.spellSnapshot ? restoreOutcomeItem(payload.spellSnapshot, payload.spellSnapshotContext) : resolveUuidSync(payload.spellUuid);
    if (!casterActor || !spell) continue;
    const prepared = await prepareResolvedSpellEffectPayload({ casterActor, spell, payload: { ...payload, message } });
    delete prepared.message;
    damage._magicPayload = prepared;
  }
}

export const updateCard = createOpposedCardUpdater({
  scope: FLAG_SCOPE, key: 'magicOpposed', version: 2, family: 'magic',
  prepare: prepareNewEffects,
});
