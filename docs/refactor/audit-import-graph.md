# Audit: Import Graph

Generated: 2026-02-11

## Cross-Subsystem Dependencies

```
ui/sheets/ ──imports──► core/{combat,magic,traits,skills,conditions,stamina,wounds}
                         │          │          │
                         ▼          ▼          ▼
              combat ◄──────────► magic ◄───► traits
                 │                   │          ▲
                 ▼                   ▼          │
              utils/              time/      skills
```

| Direction | Import Sites | Notes |
|-----------|-------------|-------|
| combat → magic | 11 | Spell damage, magic profiles, AoE |
| magic → combat | 13 | Opposed rolls, TN, chat handlers |
| combat → traits | 13 | `hasTalent`, combat talent resolvers |
| skills → traits | 8 | TN adjustments, talent checks |
| skills → combat | 1 | `skill-tn.js` → `combat/tn.js` |
| ui → core | many | Expected: UI binds to logic |

## Utility Import Frequency

| Utility | Importers |
|---------|-----------|
| `authority-proxy.js` | ~50 |
| `debug.js` | 20+ |
| `degree-roll-helper.js` | 17 |
| `chat-message-socket.js` | 10 |
| `permissions.js` | 8 |
| `ae-helpers.js` | 4 |
| `aoe-utils.js` | 4 |
| `skillCalcHelper.js` | 3 |
| `ae-grouping.js` | 1 |

## Circular Dependency Risk

No hard cycles detected. The combat↔magic coupling (24 total cross-imports) is inherent to spell combat workflows. Dependency injection pattern already used where needed (e.g., `banking-orchestrator.js` takes `_updateCard` as parameter).
