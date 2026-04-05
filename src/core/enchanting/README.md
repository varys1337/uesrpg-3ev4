# Enchanting

`index.js` remains the public barrel for the workshop engine.

- `builders/internal/session.js` owns shared builder-session validation and gem/item setup.
- `builders/internal/finalize-operations.js` owns target-item update shaping.
- `builders/internal/finalize-chat.js` owns result chat-card rendering.
- `settings.js` is the canonical reader for enchanting settings, including cast-runtime enablement.

Builders should stay focused on rules and test flow; document writes and chat output stay in explicit finalize helpers.
