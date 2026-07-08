## Role Pass

**Issue:** #<number> — <title>
**Branch:** <branch>
**Phase:** <number>
**Role:** <product-manager | analyst | architect | developer-plan | developer | tester | review | techwriter | pr-readiness>
**Status:** <pass | blocked | returned | skipped>
**Workflow profile:** <bounded | standard | high-assurance>
**Executed by:** <human | claude | codex | agy | pi>
**Launcher:** <human | claude | codex | agy | pi>
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human>
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Model / runtime:** <freeform identifier or "not recorded">

### Inputs read

- <issue, spec, ADR, prior pass, diff, test output>

### Decisions / findings

- <decision or finding>

### Open questions

- none

### Next-phase contract

- <what the next role must do>

---

<!-- <agent> = the AI identity actually executing THIS pass right now (claude | codex | agy | pi | human) — never copied from a prior pass or template example. See docs/agent-workflow.md §4 (Provenance). Executor/Transport/Delegation boundary come from docs/execution-targets.md; resolve ambiguous "with <agent>" requests with scripts/resolve-execution-target.mjs before recording them. -->

Signed-off-by: `<agent>` (`<role>`)
Timestamp: `YYYY-MM-DDTHH:MM:SSZ`
