## Role Pass

**Issue:** #<number> — <title>
**Branch:** <branch>
**Phase:** <number>
**Role:** <product-manager | analyst | architect | developer-plan | developer | tester | review | techwriter | pr-readiness>
**Status:** <pass | blocked | returned | skipped>
**Workflow profile:** <bounded | standard | high-assurance>
**Planned owner:** <agent slug from roleAlternationPlan; use "not-applicable:single-agent" only when Mode is single-agent and this pass will not feed a multi-agent role attribution matrix>
**Executed by:** <human | claude | codex | agy | pi>
**Launcher:** <human | claude | codex | agy | pi>
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human>
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Context boundary:** <current-session | fresh-session | forked-context | local-cli-child-process | provider-api-call | human-handoff | worktree | intercom-session> <!-- derived from Transport + Delegation boundary; see lib/role-attribution.mjs#deriveContextBoundary -->
**Independence boundary:** <independent | self-review | not-applicable> <!-- only meaningful for the review role: "independent" when the reviewer's roleIntelligence differs from the developer pass, "self-review" when it matches and is explicitly disclosed, otherwise "not-applicable" -->
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

<!-- <agent> = the AI identity actually executing THIS pass right now (claude | codex | agy | pi | human) — never copied from a prior pass or template example. See docs/agent-workflow.md §4 (Provenance). Executor/Transport/Delegation boundary come from docs/execution-targets.md; resolve ambiguous "with <agent>" requests with scripts/resolve-execution-target.mjs before recording them. Planned owner/Context boundary/Independence boundary are the role-alternation concepts from docs/agent-workflow.md §4a and lib/role-attribution.mjs (issue #56); they feed the roleAttributionMatrix in the workflow-status comment and PR manifest. -->

Signed-off-by: `<agent>` (`<role>`)
Timestamp: `YYYY-MM-DDTHH:MM:SSZ`
