<!-- ativaly-workflow-status -->

## Workflow Status

**Issue:** #N
**Profile:** bounded | standard | high-assurance
**Risk:** low | medium | high
**Effort:** low | medium | high
**Change surfaces:** docs | UI | service | API | data | infra | security
**Mode:** single-agent | multi-agent <!-- the multiAgentClaim: "multi-agent" requires >=2 distinct role intelligences in the Role attribution matrix below, or this must read "single-agent" — see docs/agent-workflow.md §4a -->
**Implemented by:** pending | human | claude | codex | agy | pi <!-- must match the <agent> of the latest role-pass signature, or `human` — see docs/agent-workflow.md §4 (Provenance) -->
**Executor:** pending | claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human <!-- see docs/execution-targets.md -->
**Transport:** pending | local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual
**Delegation boundary:** pending | current-session | child-subagent | separate-local-session | child-worktree | human-handoff
**Model / runtime:** freeform identifier | pending
**Review:** pending | self-review | human-review-requested | human-reviewed
**CI-equivalent validation:** pending | passed | not-run-with-reason | expected-fail-with-follow-up
**State:** planning | implementing | verifying | reviewing | blocked | ready | complete
**Current phase:** 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
**Workflow evidence storage:** GitHub issue comment + PR body; local `.agent-runs/` files are generated scratch artifacts and are not committed.

### Evidence

- [ ] Requirement and acceptance criteria
- [ ] Architecture and risk assessment
- [ ] Implementation and test plan
- [ ] Implementation summary
- [ ] Verification results
- [ ] Security assessment
- [ ] Acceptance decision
- [ ] Documentation decision
- [ ] PR-readiness decision

### CI Parity

- Status: pending
- Commands: not recorded yet
- Notes: none

### Current Findings

None.

### Next Action

Describe the next meaningful action or `none`.

### Latest Role Pass

- `phase`: <number>
- `role`: <role>
- `summary`: <short signed role-pass summary>
- `status`: pass | blocked | returned | skipped

### Role attribution matrix

<!-- Required when Mode: multi-agent. Omit or leave empty for single-agent runs — role alternation
is never forced. One row per executed phase; "Planned owner" is the roleAlternationPlan owner
(routing.roles.<role>.owner), "Actual agent" and "Executor" are the roleIntelligence that actually
ran the phase, "Context boundary" and "Independence boundary" come from lib/role-attribution.mjs.
See docs/agent-workflow.md §4a. -->

| Phase    | Role   | Planned owner | Actual agent | Executor          | Context boundary  | Independence boundary                          | Status                                   |
| -------- | ------ | ------------- | ------------ | ----------------- | ----------------- | ---------------------------------------------- | ---------------------------------------- |
| <number> | <role> | <agent>       | <agent>      | <executionTarget> | <contextBoundary> | <independent \| self-review \| not-applicable> | <pass \| blocked \| returned \| skipped> |

---

<!-- <agent> = the AI identity actually executing this update right now (claude | codex | agy | pi | human) — never copied from a prior pass. See docs/agent-workflow.md §4 (Provenance). -->

Signed-off-by: `<agent>` (`orchestrator`)
