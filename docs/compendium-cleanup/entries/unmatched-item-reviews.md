# Unmatched equipment: individual static reviews

The stored profiles are preserved. Each review considers related Core evidence, the actual Item data and its applicable execution path; exact source and native/live behavior remain unresolved.

## Toxin of Drain Stamina (`0sbfOPge4CyX9oCR`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"drainStamina","school":"mysticism","spellLevel":3,"attributes":["toxin","upkeep"],"cost":30,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect drainStamina, level 3, 10 rounds and 3 hits. The stored school and cost agree with the current catalog entry, which alone does not prove this recipe. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Drain Stamina recipe, level 3, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Garnet - Inferior (`1cB2QO5vBkPtPZlp`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":40,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Garnet - Inferior variant its stored 40-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Toxin of Burden (`5Hgeudtp4thO7Xce`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"burden","school":"alteration","spellLevel":3,"attributes":["toxin","upkeep"],"cost":15,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect burden, level 3, 10 rounds and 3 hits. Its stored alteration school / 15 cost differs from the current catalog's alteration / 9; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Burden recipe, level 3, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Poison - Uncommon (`5QB8LNZ4R8P0Qknn`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":75,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Uncommon, its 75-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Poison - Rare (`5xALZ2fdgXUUyFBx`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":200,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Rare, its 200-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Poison (Level 5) (`61oOI70ismKCC33j`)

- Source considered: Core p. 184 gives ingredient-plus-fee pricing; the available extract does not establish this exact seeded Item, its price or its complete level profile.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"poison","poisonLevel":5,"damageFormula":"1d12","backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/runtime.js#resolvePoisonResistanceFromChat`
- Execution: The stored level 5 payload specifies 1d12; the previous on-hit path cleared the coating before recording a resistance card. Coating and old resistance cards are now held for manual review.
- Unresolved: Which Core passage establishes this level 5 profile, its 1d12 die, hit count, armor interaction, ENC and purchase price?
- Manual handling: Before any manual roll, inspect the carrier, earlier chat, target and Item quantity. Agree the applicable poison rules with the GM, then record consumption, successful hits, resistance and damage once. Existing effects and paid costs are not repaired automatically.

## Toxin of Calm (`6igEg0ZMs3T1q3aG`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"calm","school":"illusion","spellLevel":2,"attributes":["potion","toxin","upkeep"],"cost":20,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect calm, level 2, 10 rounds and 3 hits. Its stored illusion school / 20 cost differs from the current catalog's illusion / 6; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Calm recipe, level 2, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Poison - Extremely Rare (`7Aj09sCNDmbbUfDn`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":1500,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Extremely Rare, its 1500-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Toxin of Silence (`8jyIz4Cos0ibiynB`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"silence","school":"mysticism","spellLevel":2,"attributes":["toxin"],"cost":30,"toxinOverrides":{},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect silence, level 2, 10 rounds and 3 hits. Its stored mysticism school / 30 cost differs from the current catalog's illusion / 6; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Silence recipe, level 2, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Netch Leather Plate (`BGrtZfb4xUC8qqZ6`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":18,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Netch Leather Plate?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Dragon Bones (`BLvKrnnXrhHNIcjB`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":3,"price":3000,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Dragon Bones?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Skooma (`COgZwCb87GQWeHjz`)

- Source considered: Core p. 182 lists entertainment goods but does not establish this named Item or its effect in the available table.
- Stored fields: `{"quantity":1,"enc":0,"price":15,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The Item is not marked consumable and carries no alchemy payload; the inventory calculation uses its stored quantity and ENC.
- Unresolved: Which exact source supplies Skooma’s price, purchase unit, ENC and any use effects or risks?
- Manual handling: Preserve the Item and values; the GM chooses a supported or house rule and tracks any use and quantity manually.

## Poison (Level 2) (`IC6tAqg99nkkBHYd`)

- Source considered: Core p. 184 gives ingredient-plus-fee pricing; the available extract does not establish this exact seeded Item, its price or its complete level profile.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"poison","poisonLevel":2,"damageFormula":"1d6","backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/runtime.js#resolvePoisonResistanceFromChat`
- Execution: The stored level 2 payload specifies 1d6; the previous on-hit path cleared the coating before recording a resistance card. Coating and old resistance cards are now held for manual review.
- Unresolved: Which Core passage establishes this level 2 profile, its 1d6 die, hit count, armor interaction, ENC and purchase price?
- Manual handling: Before any manual roll, inspect the carrier, earlier chat, target and Item quantity. Agree the applicable poison rules with the GM, then record consumption, successful hits, resistance and damage once. Existing effects and paid costs are not repaired automatically.

## Toxin of Drain Magicka (`IhlmupwcNdDcWn1z`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"drainMagicka","school":"mysticism","spellLevel":3,"attributes":["toxin","upkeep"],"cost":30,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect drainMagicka, level 3, 10 rounds and 3 hits. Its stored mysticism school / 30 cost differs from the current catalog's destruction / 6; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Drain Magicka recipe, level 3, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Great Welkynd Stone (`LWc67PdBbPDt67Zw`)

- Source considered: Core pp. 190–191 describe ordinary and dark Welkynd stones and a lantern; the named Great variant and its healing blast are not established by those entries.
- Stored fields: `{"quantity":1,"enc":2,"price":2000,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/core/magic/arcane-item-use.js#getCoreArcaneItemUse`
- Execution: The source-identity based Core arcane-item helper recognizes four other specific Items; this untagged Great variant is not identified by that helper. Its healing description is not a verified automatic effect.
- Unresolved: Which exact source establishes the Great stone’s 2 ENC, 2,000-drake price, healing radius, roll, effect and exhaustion?
- Manual handling: Keep the Item; the GM chooses the governing rule and manually records any cast, healing, resource or stone change after checking earlier results. Do not substitute the ordinary stone procedure.

## Diamond - Inferior (`Lnc6Zi2xBbiMCOZk`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":400,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Diamond - Inferior variant its stored 400-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Amethyst (`MZLHDdWDlpGJjMZ9`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":120,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Amethyst variant its stored 120-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Bones (`OSZg7MKhAiCpaC67`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":15,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Bones?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Toxin of Paralysis (`Oc60qeBDOfBIm5uF`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"paralyze","school":"mysticism","spellLevel":2,"attributes":["toxin"],"cost":40,"toxinOverrides":{},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect paralyze, level 2, 10 rounds and 3 hits. Its stored mysticism school / 40 cost differs from the current catalog's illusion / 14; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Paralysis recipe, level 2, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Poison (Level 4) (`PNx4t6tNdhtZN3x8`)

- Source considered: Core p. 184 gives ingredient-plus-fee pricing; the available extract does not establish this exact seeded Item, its price or its complete level profile.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"poison","poisonLevel":4,"damageFormula":"1d10","backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/runtime.js#resolvePoisonResistanceFromChat`
- Execution: The stored level 4 payload specifies 1d10; the previous on-hit path cleared the coating before recording a resistance card. Coating and old resistance cards are now held for manual review.
- Unresolved: Which Core passage establishes this level 4 profile, its 1d10 die, hit count, armor interaction, ENC and purchase price?
- Manual handling: Before any manual roll, inspect the carrier, earlier chat, target and Item quantity. Agree the applicable poison rules with the GM, then record consumption, successful hits, resistance and damage once. Existing effects and paid costs are not repaired automatically.

## Diamond - Superior (`RR6QdAnKLgJDNk7m`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":1200,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Diamond - Superior variant its stored 1200-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Mithril Ingot (`STOmOm1iwUbm9vkL`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":180,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Mithril Ingot?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Emerald (`Sd3VsQop6rtb1Sdr`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":600,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Emerald variant its stored 600-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Alchemy Field Kit (Small) (`TKVP2EC56HyCpvKV`)

- Source considered: Core p. 181 lists Alchemist (Field) tools at ENC 1, price 500 and maximum ingredient depth 4; this Item says small and maximum depth 3, so an exact equivalence is not established.
- Stored fields: `{"quantity":1,"enc":1,"price":300,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/core/alchemy/workflow-descriptors.js#getAlchemyInventoryState`, `src/core/alchemy/workflow-validation.js#validateBrewRecipe`
- Execution: The tool-name matcher can count this Item as alchemy tools without proving its depth-3 limit; the specific Core field-kit depth warning requires a separate source tag. The stored description does not itself enforce depth.
- Unresolved: Does the small depth-3 kit represent a distinct rule, and what exact price, ENC and crafting limit apply?
- Manual handling: Preserve its 300-drake price and depth-3 text. Have the GM confirm a suitable tool and ingredient depth before brewing; do not replace it with the Core depth-4 kit automatically.

## Toxin of Drain Health (`TgdvgClCVUVaoO3U`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"drainHealth","school":"mysticism","spellLevel":3,"attributes":["toxin","upkeep"],"cost":30,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect drainHealth, level 3, 10 rounds and 3 hits. The stored school and cost agree with the current catalog entry, which alone does not prove this recipe. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Drain Health recipe, level 3, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Enchanter's Tools (`WR6BTPGNlvMf00It`)

- Source considered: Core p. 181 lists generic craft tools; pp. 163–165 state enchanting rituals consume materials, but neither establishes this named tool kit and its price.
- Stored fields: `{"quantity":1,"enc":1,"price":300,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/core/alchemy/workflow-descriptors.js#getAlchemyInventoryState`, `src/core/alchemy/workflow-validation.js#validateBrewRecipe`
- Execution: The Item is carried as inventory; its descriptive contents do not by themselves prove that the enchanting workflow validates a required tool.
- Unresolved: Which exact rule defines this kit, its 300-drake price, ENC 1, contents and eligibility for a particular enchanting ritual?
- Manual handling: Preserve the kit and ask the GM to determine the appropriate tools and ritual materials before enchanting; separately account for ritual resources and any prior writes.

## Fur Pelt (`WSowAnxwSVpMlIxV`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":12,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Fur Pelt?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Toxin of Frenzy (`XtGEY0nwxeKsl31N`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"frenzy","school":"illusion","spellLevel":2,"attributes":["toxin","upkeep"],"cost":20,"toxinOverrides":{"removeUpkeep":true},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect frenzy, level 2, 10 rounds and 3 hits. Its stored illusion school / 20 cost differs from the current catalog's illusion / 8; catalog values alone are not source proof. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Frenzy recipe, level 2, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Claws (`YSWnaLeai9Gp4Cy8`)

- Source considered: Creature natural weapon profiles differ; an unqualified Claws entry is not an exact source match to a particular creature.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":null,"damage":"1d4","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"Slashing","alchemy":null}`
- Paths: `src/core/combat/opposed/damage/roller.js#rollWeaponDamage`, `src/core/documents/item-prepare/weapon.js`
- Execution: The weapon stores 1d4 and the text quality Slashing. The normal weapon preparation and damage paths use the configured profile; this generic Item does not identify a creature-specific profile.
- Unresolved: Which creature owns this Claws profile and what damage, qualities, reach and other parameters does its source require?
- Manual handling: Before attacking, the GM matches the claws to the creature and configures its source-backed damage and qualities; review already resolved attacks rather than assuming 1d4 is universal.

## Sapphire - Inferior (`Yb6F6G5AW1EnqmV2`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":150,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Sapphire - Inferior variant its stored 150-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Hide Skin (`ahEH4TH0ihiRL8XS`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":9,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Hide Skin?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Mage Robes (`bKfjZAEWub3jK9Oa`)

- Source considered: Core p. 182 lists ordinary robes at ENC 1 and price 40; it does not identify these named magical variants, their AR or enchantment level.
- Stored fields: `{"quantity":1,"enc":1,"price":500,"consumable":null,"damage":"","armor":0,"magicAR":1,"enchantmentLevel":4,"qualities":"Magic, Full Outfit","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/core/documents/item-prepare/armor.js`, `src/core/combat/armor-state.js`
- Execution: This armor Item contributes its stored armor settings when equipped and participates in inventory worn-armor ENC handling. A descriptive Magic/Full Outfit label does not establish an exact Core variant.
- Unresolved: What source establishes Mage Robes at 500 drakes, magic AR 1, EL 4, coverage and qualities?
- Manual handling: Preserve the Item and verify coverage, Magic quality, AR, enchantment limit and equipped state with the GM before relying on them; adjust existing actor Items manually only with an agreed source.

## Poison - Legendary (`bX6Ekhu317pVuuck`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":2000,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Legendary, its 2000-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Diamond (`dFoWlXi57ZW4cxLQ`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":800,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Diamond variant its stored 800-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Sapphire - Superior (`erpxWTMuiYwF55yc`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":450,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Sapphire - Superior variant its stored 450-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Poison (Level 3) (`f3GsYFFaHlRH5TJa`)

- Source considered: Core p. 184 gives ingredient-plus-fee pricing; the available extract does not establish this exact seeded Item, its price or its complete level profile.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"poison","poisonLevel":3,"damageFormula":"1d8","backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/runtime.js#resolvePoisonResistanceFromChat`
- Execution: The stored level 3 payload specifies 1d8; the previous on-hit path cleared the coating before recording a resistance card. Coating and old resistance cards are now held for manual review.
- Unresolved: Which Core passage establishes this level 3 profile, its 1d8 die, hit count, armor interaction, ENC and purchase price?
- Manual handling: Before any manual roll, inspect the carrier, earlier chat, target and Item quantity. Agree the applicable poison rules with the GM, then record consumption, successful hits, resistance and damage once. Existing effects and paid costs are not repaired automatically.

## Dragon Scales (`glbeAZq6l3lIld0Y`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":2,"price":1000,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Dragon Scales?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Garnet - Superior (`gs7e8nIAyhO76d1p`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":120,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Garnet - Superior variant its stored 120-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Garnet (`gw6GmQDptDVMEkqJ`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":80,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Garnet variant its stored 80-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Poison (Level 1) (`iG7zucrHdFaJP4gm`)

- Source considered: Core p. 184 gives ingredient-plus-fee pricing; the available extract does not establish this exact seeded Item, its price or its complete level profile.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"poison","poisonLevel":1,"damageFormula":"1d4","backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/runtime.js#resolvePoisonResistanceFromChat`
- Execution: The stored level 1 payload specifies 1d4; the previous on-hit path cleared the coating before recording a resistance card. Coating and old resistance cards are now held for manual review.
- Unresolved: Which Core passage establishes this level 1 profile, its 1d4 die, hit count, armor interaction, ENC and purchase price?
- Manual handling: Before any manual roll, inspect the carrier, earlier chat, target and Item quantity. Agree the applicable poison rules with the GM, then record consumption, successful hits, resistance and damage once. Existing effects and paid costs are not repaired automatically.

## Grandmaster Mage Robes (`lGdMavApcwJyoEle`)

- Source considered: Core p. 182 lists ordinary robes at ENC 1 and price 40; it does not identify these named magical variants, their AR or enchantment level.
- Stored fields: `{"quantity":1,"enc":1,"price":1500,"consumable":null,"damage":"","armor":0,"magicAR":2,"enchantmentLevel":5,"qualities":"Magic, Full Outfit","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/core/documents/item-prepare/armor.js`, `src/core/combat/armor-state.js`
- Execution: This armor Item contributes its stored armor settings when equipped and participates in inventory worn-armor ENC handling. A descriptive Magic/Full Outfit label does not establish an exact Core variant.
- Unresolved: What source establishes Grandmaster Mage Robes at 1500 drakes, magic AR 2, EL 5, coverage and qualities?
- Manual handling: Preserve the Item and verify coverage, Magic quality, AR, enchantment limit and equipped state with the GM before relying on them; adjust existing actor Items manually only with an agreed source.

## Amethyst - Superior (`niyZNiMVLYjk8Rvv`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":180,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Amethyst - Superior variant its stored 180-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Toxin of Demoralize (`pIMOxt3n2pROIaTZ`)

- Source considered: Core p. 155 describes toxins in general: a coating lasts one minute or three successful hits, whichever occurs first; a damaged target uses Endurance for characteristic tests required by toxin effects. Core p. 184 supplies ingredients-plus-fee guidance.
- Stored fields: `{"quantity":1,"enc":0,"price":0,"consumable":true,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":{"kind":"toxin","effects":[{"effectKey":"demoralize","school":"illusion","spellLevel":2,"attributes":["toxin"],"cost":20,"toxinOverrides":{},"params":{}}],"durationRounds":10,"maxHits":3,"backfired":false,"backfire":{},"brew":{"seeded":true,"seededAt":1771711441370}}}`
- Paths: `src/core/alchemy/apply.js`, `src/core/alchemy/carrier-state.js#getAlchemyOnHitCarrier`, `src/core/alchemy/runtime.js#applyAlchemyOnHit`, `src/core/alchemy/effects.js#getEffectByKey`
- Execution: Stored effect demoralize, level 2, 10 rounds and 3 hits. The stored school and cost agree with the current catalog entry, which alone does not prove this recipe. The old executor counted only damage events and could change hits before its card was recorded; coating and resistance cards are held for manual review.
- Unresolved: Which source establishes this particular Toxin of Demoralize recipe, level 2, school, cost, effect duration and final price, and does its effect require an Endurance test?
- Manual handling: The GM confirms the actual effect and ingredient recipe, records application and each successful hit even if no damage is dealt, expires the coating at the earlier limit, and resolves any characteristic test on a damaging hit using Endurance. Check prior results before modifying quantities or effects.

## Amethyst - Inferior (`sruhxzYGJZ1VUuLL`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":60,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Amethyst - Inferior variant its stored 60-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Emerald - Superior (`tbsX0siC11UtXZ6I`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":900,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Emerald - Superior variant its stored 900-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Poison - Very Rare (`teqg7e8H9QAyZRq6`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":500,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Very Rare, its 500-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Emerald - Inferior (`x7FhR1mh7osvkdIT`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":300,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Emerald - Inferior variant its stored 300-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Leather Plate (`xYMu7W9rSvmEMS4B`)

- Source considered: Core p. 186 gives approximate total raw-material cost for making a finished item; the supplied extract does not specify an individual raw-material purchase unit for this legacy entry.
- Stored fields: `{"quantity":1,"enc":1,"price":15,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: This is a physical inventory Item: the system applies its stored quantity and ENC, with normal valid-container handling. Its description does not establish an automated recipe or yield.
- Unresolved: What unit, ENC, price, material quality and finished-item yield does an exact source assign to Leather Plate?
- Manual handling: Keep the Item and its stored values. The GM agrees the unit and crafting requirements before consuming materials; do not infer one component or ingot per finished item from the one-third guideline.

## Sapphire (`xrtDP2Assb5mlq10`)

- Source considered: Core p. 182 lists generic gemstone 50 drakes and flawless gemstone 200; it does not specify prices by named stone or explicitly assign ENC to a loose gemstone.
- Stored fields: `{"quantity":1,"enc":0,"price":300,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`
- Execution: The inventory calculation uses stored quantity and ENC, including the actor-wide zero-ENC count and applicable container rules; there is no species-specific price rule.
- Unresolved: Which source assigns the Sapphire variant its stored 300-drake price and ENC 0, and what purchase unit is intended?
- Manual handling: Keep the stored price and ENC until the GM identifies an exact source or chooses a house value; count quantity and container placement normally and do not equate a description of flawless with a proven table mapping.

## Poison - Plentiful (`ybe9kfGg9VaWsFS4`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":15,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Plentiful, its 15-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

## Poison - Ubiquitous (`zTwRQ5uWHfsGivPq`)

- Source considered: Core p. 184 gives ingredient rarity values and alchemist-service pricing, not a named finished poison price for this legacy rarity label.
- Stored fields: `{"quantity":1,"enc":0.2,"price":6,"consumable":false,"damage":"","armor":0,"magicAR":0,"enchantmentLevel":0,"qualities":"","alchemy":null}`
- Paths: `src/core/items/inventory-encumbrance.js#buildInventoryEncumbrance`, `src/ui/sheets/shared/listeners/combat-actions.js`
- Execution: This Item has no alchemy payload and is not marked consumable; its damage formula and three-strike text are descriptive and do not enter the brewed-coating workflow.
- Unresolved: Which source identifies Poison - Ubiquitous, its 6-drake purchase unit, ENC 0.2, stated damage die and duration? Ingredient rarity alone does not establish a finished poison profile.
- Manual handling: The GM selects the applicable poison rule and verifies the damage die, hit limit, duration and price; track the dose, weapon, results and inventory manually. Do not assume the description or rarity table proves them.

