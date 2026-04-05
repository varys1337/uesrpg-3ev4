# Advancement

This folder owns XP spending and learning rules.

Ownership:
- `skill-advancement.js` owns skill-style rank and specialization spending.
- `spell-learning.js` owns spell purchase validation, payment, and chargen logging.
- `progression.js` is the shared campaign-rank and XP-threshold helper layer.
- `utils.js` holds small normalization helpers reused across advancement modules.

Guidelines:
- Keep cost and gating logic deterministic and side-effect free where possible.
- Keep persistence through `authority-proxy` at the edges of the workflow.
- Reuse shared progression and normalization helpers instead of re-declaring thresholds or string coercion locally.
