---
name: Bug report
about: Use this template to submit a bug report.
title: "[BUG] - bug title"
labels: bug
assignees: jamesjtb

---

**Environment:**

- Foundry VTT exact version and build:
- UESRPG system version (and source checkpoint if known):
- Browser/client name and exact version:
- Operating system:
- Relevant module IDs and versions:

Report the versions that failed. Upgrading is not required before reporting. Record any later version comparison separately in a backed-up test world; these fields do not imply a new browser or module compatibility claim.

**User and document context:**

- GM, owner player or non-owner:
- PC/NPC/Item sheet, chat, macro or HUD action:
- World Actor, linked Token or unlinked Token:
- Relevant automation/application mode, if known:

Use anonymous labels such as Actor A and Token B. Do not include user names, private document names or unnecessary UUIDs.

**What happened?**

Describe the observed behavior and whether the action remained pending, completed, partially applied or requested review. For interrupted work, state whether it was retried and whether the GM inspected its existing record; do not repeatedly submit it just to obtain a log.

**What did you expect?**

Describe the expected behavior separately from the observation.

**Steps to reproduce:**

1. Starting state and relevant settings:
2. Exact controls/actions used:
3. Result, including persistence after reopen/reload if tested:

**Isolation in a disposable copied world:**

- Same case without external modules: PASS / FAIL / NOT RUN
- Relevant module combination and exact versions: PASS / FAIL / NOT RUN
- Changed settings or versions between comparisons:

Use a coherent copied-world backup before stateful tests. Do not clear purchase/application records or migration markers to force a retry. If a check was not performed, leave it NOT RUN.

**Redacted evidence:**

Include only the relevant error text/code and focused diagnostic facts. Screenshots are optional; crop/redact them and inspect the final attachment. Remove credentials, session/invitation tokens, server addresses, private chat, notes, Actor/Item descriptions, names, user identifiers and unnecessary UUIDs. Keep exact versions, reproduction steps and consistent anonymous aliases. Configuration/module metadata can identify an environment, so include only what is relevant.

Raw console dumps, performance exports and Feature Inspector data are not automatically sanitized. Ask the GM/maintainer for the relevant diagnostic lane instead of enabling everything. The repository's `docs/architecture.md` support section explains the existing diagnostics and recovery boundaries. Do not attach a world backup or database to a public report.
