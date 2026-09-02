<!-- agent-handover -->

## Agent handover

**Issue:** #<number>
**Mode:** single-agent | multi-agent
**From:** <registered-platform> / phase <number> / <role>
**To:** <registered-platform-or-role> / phase <number> / <role>
**Reason:** phase transition | fallback route | quota/setup blocker | review return | human request | session ending
**Routing decision:** single-agent continuation | owner selected | fallback selected | blocked | not-applicable
**Planned owner:** <registered platform slug from roleAlternationPlan; use "not-applicable:single-agent" only when Mode is single-agent and this handover will not feed a multi-agent role attribution matrix>
**Executor:** <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | grok-cli | xai-api | human> <!-- see docs/execution-targets.md; resolve ambiguous "with <platform>" with scripts/resolve-execution-target.mjs before recording -->
**Transport:** <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
**Delegation boundary:** <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
**Context boundary:** <current-session | fresh-session | forked-context | local-cli-child-process | provider-api-call | human-handoff | worktree | intercom-session> <!-- derived from Transport + Delegation boundary; see lib/role-attribution.mjs#deriveContextBoundary -->
**Independence boundary:** <independent | self-review | not-applicable> <!-- required when "To" is the reviewer role; see docs/agent-workflow.md section 4a -->
**Action boundary:** <observe | propose | mutate-worktree | open-pr | external-action>
**Branch:** <branch>

### Context already established

- <inputs read>
- <decisions made>
- <validation/evidence produced>

### Next executor contract

- <specific next action>
- <expected artifact/comment/update>
- <tests or checks to run>

### Acceptance contract

- Collaboration class: <linear | bilateral | council | human-gated>
- Acceptance owner: <qualified sending role>
- Candidate digest: <sha256>
- Deterministic criteria: <ids and required evidence>
- Semantic criteria: <ids or none>
- Council policy: <not-required | required seats and decision owner>
- Delivery receipt: <expected path/URL>
- Acceptance decision: <expected path/URL>

### Portable evidence

- ArtifactRefs: <paths/URLs or none>
- Transition envelope: <path/URL to validated version-1 JSON>
- Extension plays: <applied play ids or none>

### Open questions / blockers

- none

Signed-off-by: <registered-platform> (<runtime/model if known>) at <timestamp>
