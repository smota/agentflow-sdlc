## Agent Run

**Agent:** human | claude | codex | agy
**Model / runtime:** <freeform identifier>
**Role:** orchestrator | developer | consolidated-review | security-review | acceptance | scanner | techwriter
**Step:** workflow evidence or delegated step
**Status:** PASS | FAIL | BLOCKED
**Fallback chain:** none | original model -> backup model
**Implemented by:** not applicable | human | claude | codex | agy
**Required reviewer:** not applicable | human | claude | codex | agy

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
