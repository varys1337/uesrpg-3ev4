# Rules

This folder owns pure shared rule evaluation and roll-context construction.

- `predicate.js` evaluates roll-option predicates.
- `roll-options.js` and `roll-context.js` build canonical roll-option state and serializable roll context.
- `attack-context.js`, `npc-rules.js`, and `phases.js` are shared pure rule helpers.

Do not add document writes, chat mutations, or workflow orchestration here. Callers should reuse these helpers instead of re-implementing local predicate or roll-context logic.
