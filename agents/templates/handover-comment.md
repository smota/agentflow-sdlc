<!-- agent-handover -->

## Agent handover

**Issue:** #<number>
**Mode:** single-agent | multi-agent
**From:** <agent> / phase <number> / <role>
**To:** <agent-or-role> / phase <number> / <role>
**Reason:** phase transition | fallback route | quota/setup blocker | review return | human request | session ending
**Routing decision:** single-agent continuation | owner selected | fallback selected | blocked | not-applicable
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human> <!-- see docs/execution-targets.md; resolve ambiguous "with <agent>" with scripts/resolve-execution-target.mjs before recording -->
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Branch:** <branch>

### Context already established

- <inputs read>
- <decisions made>
- <validation/evidence produced>

### Next executor contract

- <specific next action>
- <expected artifact/comment/update>
- <tests or checks to run>

### Open questions / blockers

- none

Signed-off-by: <agent> (<runtime/model if known>) at <timestamp>
