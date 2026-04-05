## `src/integrations`

- Integration modules are adapters from external triggers into canonical system behavior.
- They should normalize inputs and delegate to existing sheet listeners, dialogs, and core workflows.
- Do not create parallel behavior layers inside integrations.
- Internal helper files are acceptable for synthetic event construction, routing, and result normalization when they reduce duplication inside one adapter.
