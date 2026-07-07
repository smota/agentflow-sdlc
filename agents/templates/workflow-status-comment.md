<!-- ativaly-workflow-status -->

## Workflow Status

**Issue:** #N
**Profile:** bounded | standard | high-assurance
**Risk:** low | medium | high
**Effort:** low | medium | high
**Change surfaces:** docs | UI | service | API | data | infra | security
**Implemented by:** pending | human | claude | codex | agy <!-- must match the <agent> of the latest role-pass signature, or `human` — see docs/agent-workflow.md §4 (Provenance) -->
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

---

<!-- <agent> = the AI identity actually executing this update right now (claude | codex | agy | human) — never copied from a prior pass. See docs/agent-workflow.md §4 (Provenance). -->

Signed-off-by: `<agent>` (`orchestrator`)
