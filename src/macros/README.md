## `src/macros`

- Macro files are stable user-facing entrypoints and runtime namespace hooks.
- Macros should stay thin: resolve context, prompt when needed, and call canonical UI/core workflows.
- Reusable actor resolution and open-window reuse logic belongs in shared helpers, not duplicated in each macro.
- Travel-specific actor/group selection logic belongs in `core/travel`, not in the macro entrypoint.
