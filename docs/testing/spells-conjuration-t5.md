# T5-6: Conjuration School — Spell → AE Mapping

**School:** Conjuration  
**Source:** Chapter 6 — Magic (pp.133-134)  
**Total spells:** 5 unique (Conjure Armor, Conjure Weapon, Sunder Binding, Summon Construct, Summon Daedra)

## Spell Inventory

| # | Spell | Tags | Cost | SS | Duration |
|---|---|---|---|---|---|
| 1 | Conjure [Armor] | Upkeep, Instant | 15/22/29/36/43/50 (L2-7) | 1-6 | 1 minute (Upkeep) |
| 2 | Conjure [Weapon] | Upkeep, Instant | 15/29/43 (L2/4/6) | 1-3 (quality) | Until dropped/Upkeep end |
| 3 | Sunder Binding | Direct (also Mysticism) | 5/6/7/8/9/10/11 (L1-7) | +20/+10/0/-10/-20/-30/-40 | Instant |
| 4 | Summon Construct | Upkeep, Mindlock (SS) | 21/29 (L4/6) | 2/3 | Upkeep |
| 5 | Summon Daedra | Upkeep, Mindlock (SS) | 7-34 (per creature) | 1-3 | Upkeep |

---

## AE Profile Mapping

### Category 1: Temporary Item Creation — Deferred (2 spells)

These spells create temporary embedded items on the caster. Full implementation requires the **TemporaryItem framework** (Phase 6). The spell pack creates the spell item with flags for the framework to consume.

| Spell | Mechanism | Result |
|---|---|---|
| Conjure [Armor] | Creates temp Daedric armor set | SS maps to armor profile (Inferior Partial → Superior Full). Armor counts as one weight class lighter. Bound + Summoned traits |
| Conjure [Weapon] | Creates temp weapon | SS maps to quality (Primitive/Standard/Proven). Bound + Summoned traits. Reload -1 |

**Armor SS Profiles:**
| SS | Profile |
|---|---|
| 1 | Inferior Partial Daedric |
| 2 | Inferior Full Daedric |
| 3 | Partial Daedric |
| 4 | Full Daedric |
| 5 | Superior Partial Daedric |
| 6 | Superior Full Daedric |

**Weapon SS Profiles:**
| SS | Quality |
|---|---|
| 1 | Primitive Quality |
| 2 | Standard |
| 3 | Proven Quality |

### Category 2: Summon Service — Deferred (2 spells)

These spells use the **SummonService** to spawn tokens. Full implementation requires the summon framework (T2-E). The spell pack creates spell items with metadata for the service.

| Spell | Mechanism | Notes |
|---|---|---|
| Summon Construct | SummonService.spawn() | Flesh Atronach (L4, cost 21, SS 2), Hulking Flesh Atronach (L6, cost 29, SS 3). Mindlock = SS. WP test for binding |
| Summon Daedra | SummonService.spawn() | 21 creature variants (L1-7). Mindlock = SS. WP test for binding. Per-purchase creature selection |

**Summon Daedra Full Table:**
| Creature | Level | Cost | SS |
|---|---|---|---|
| Daedrat | 1 | 7 | 1 |
| Scamp | 1 | 8 | 1 |
| Banekin | 1 | 9 | 1 |
| Hell Hound | 2 | 12 | 1 |
| Clannfear | 2 | 13 | 1 |
| Flame Atronach | 3 | 16 | 2 |
| Hunger | 3 | 16 | 1 |
| Dremora Churl | 3 | 17 | 1 |
| Dremora Caitiff | 4 | 18 | 1 |
| Frost Atronach | 4 | 19 | 2 |
| Ogrim | 4 | 20 | 2 |
| Spider Daedra | 4 | 20 | 2 |
| Storm Atronach | 5 | 22 | 3 |
| Dremora Kynmarcher | 5 | 23 | 2 |
| Auroran | 5 | 24 | 2 |
| Winged Twilight | 6 | 27 | 3 |
| Aureal (Golden Saint) | 6 | 28 | 3 |
| Mazken (Dark Seducer) | 6 | 28 | 3 |
| Xivilai | 7 | 32 | 3 |
| Dremora Lord | 7 | 33 | 3 |
| Daedroth | 7 | 34 | 3 |

### Category 3: Anti-Summon — No AE (1 spell)

| Spell | Mechanism | Notes |
|---|---|---|
| Sunder Binding | Opposed WP test | SS modifies target WP test TN. Also Mysticism spell. Targets summoned creatures only |

---

## Coverage Summary

| Category | Count | AE Required? | Status |
|---|---|---|---|
| Temporary Item (Conjure Armor/Weapon) | 2 | Framework flags | ⚠️ Deferred: needs TemporaryItem framework |
| Summon Service (Construct, Daedra) | 2 | Framework flags | ⚠️ Deferred: needs SummonService integration |
| Anti-Summon (Sunder Binding) | 1 | No | ✅ WP test workflow |
| **Total** | **5** | | |

---

## Framework Deferred Items

1. **TemporaryItem framework** (Conjure Armor/Weapon): Create temp embedded Items, equip swap, deterministic restore on teardown, linked to Origin AE. Phase 6.
2. **SummonService integration** (Summon Construct/Daedra): Spawn tokens from compendium, set disposition/ownership, WP binding test, Mindlock application, cleanup via origin teardown. Phase 6.
3. **Bound/Summoned traits**: System traits that mark items/actors as conjured. Needed for Sunder Binding targeting validation.
4. **Mindlock mechanic**: `mindlockValue` field exists in spell schema. Needs consumption in casting workflow to enforce casting TN penalties.

---

## Test Matrix

| # | Test Case | Spells | Validation |
|---|---|---|---|
| 1 | Conjure Armor L3 | Conjure [Armor] | Partial Daedric appears, equips, counts as lighter weight class |
| 2 | Conjure Weapon L4 | Conjure [Weapon] | Standard quality weapon appears in hand, Bound trait |
| 3 | Conjure teardown | Conjure [Armor] | Origin ends → temp armor removed, prior gear restored |
| 4 | Summon Daedra L3 | Summon Daedra (Flame Atronach) | Token spawns within 5m, WP binding test, Mindlock 2 applied |
| 5 | Summon Construct L4 | Summon Construct (Flesh Atronach) | Token spawns, Bound on success, hostile on failure |
| 6 | Summon upkeep end | Summon Daedra | Upkeep ends → summoned creature returns to origin/despawns |
| 7 | Sunder Binding L3 | Sunder Binding | Opposed WP test (TN +0) vs summoned creature, dismisses on success |
| 8 | Weapon reload behavior | Conjure [Weapon] | Bound ranged weapon: first Reload action value -1 |
