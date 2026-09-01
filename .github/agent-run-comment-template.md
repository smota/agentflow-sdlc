## Agent Run

**Platform:** <registered platform slug>
**Executor:** claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human <!-- see docs/execution-targets.md -->
**Model / runtime:** <freeform identifier>
**Role:** orchestrator | developer | consolidated-review | security-review | acceptance | scanner | techwriter
**Step:** workflow evidence or delegated step
**Status:** PASS | FAIL | BLOCKED
**Fallback chain:** none | original model -> backup model
**Implemented by:** not applicable | <registered platform slug>
**Required reviewer:** not applicable | <registered platform slug>

## Input

- GitHub issue: #N
- Branch: `work/<theme>` | `hotfix/<theme>` | `spike/<theme>` | compatibility branch in flight
- Handoff: local `.agent-runs/` artifact or summarized context

## Output

Summarize the result and link any PR, issue comment, or follow-up issue.

## Next State

- Add async `for-*:*` label only when another session must resume:
- Required workflow profile:
- Required reviewer:

---

Signed-off-by: `<actual-executor>` (`<role>`)
