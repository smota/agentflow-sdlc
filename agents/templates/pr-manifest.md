## Implemented issues

- Implements #<issue> <!-- use for PRs targeting the configured integration branch; integration lifecycle automation comments, labels, and closes the issue after merge -->
- Closes #<issue> <!-- use only when this PR targets the repository default/trunk branch and should rely on GitHub native auto-close semantics -->
- Closes #<epic> <!-- include only when this PR implements the final remaining open child issues of that Epic; list child issues first and the Epic last -->

## Related issues

- Refs #<issue>

## Workflow evidence

- Workflow-status comment: <GitHub issue comment URL or "to be posted before PR">
- Handover comments: <GitHub issue comment/thread URL(s) for role handovers> | exception:<reason no role transition occurred>
- Role-pass summary: <summarize completed phases and any blockers>
- Validation evidence: <commands and results>

## CI-equivalent validation

- Status: passed | not-run-with-reason | expected-fail-with-follow-up
- Commands: <list this project's lint/typecheck/test/build commands from its own CI config —
  see the project's CI-equivalent command list in its stack-conventions doc>
- Notes: <none, reason not run, or expected failure summary with follow-up issue>

## Release decision

- Required for release/promotion PRs; use `not-applicable:<reason>` for ordinary implementation PRs.
- Intended version/tag: <version and tag>
- Bump type: main | minor | fix | project-configured value
- Rationale: <why this bump matches the project release strategy>
- Included issues: <implemented/integrated issues in this release>
- Deferred issues: none | <issues intentionally excluded>
- Release notes: <path or URL; must be user-facing capability/outcome wording, not issue-list headings>
- Post-merge closeout: pending:`gh release create <tag> --target <merge-commit> --title "<tag> — <capability title>" --notes-file <notes>` | verified:<release URL>
- Closeout verification: pending | `gh release view <tag>` + `gh release list` + `node scripts/validate-release-closeout.mjs --tag <tag> --target <merge-commit> --notes <notes>`
- Approval: <human/operator approval status before tags or releases are pushed>

## Role attribution matrix

<!-- Required when Agent review's Mode is multi-agent. Omit or leave empty for single-agent PRs —
role alternation is never forced. One row per executed phase; "Planned owner" is the
roleAlternationPlan owner (routing.roles.<role>.owner), "Actual agent" and "Executor" are the
roleIntelligence that actually ran the phase. See docs/agent-workflow.md §4a and
lib/role-attribution.mjs. -->

| Phase    | Role   | Planned owner | Actual agent | Executor          | Context boundary  | Independence boundary                          | Status                                   |
| -------- | ------ | ------------- | ------------ | ----------------- | ----------------- | ---------------------------------------------- | ---------------------------------------- |
| <number> | <role> | <agent>       | <agent>      | <executionTarget> | <contextBoundary> | <independent \| self-review \| not-applicable> | <pass \| blocked \| returned \| skipped> |

## Agent review

- Implemented by: human | claude | codex | agy | pi
- Launcher: <human | claude | codex | agy | pi> <!-- who initiated the implementation work; equal to "Implemented by" in single-agent execution -->
- Executor: <claude-cli | anthropic-api | agy-cli | agy-session | pi-parent | pi-subagent | pi-session | pi-subagent-model | codex-cli | provider-api | human> <!-- see docs/execution-targets.md -->
- Transport: <local-cli | provider-api | pi-subagent | intercom-session | orchestrated-worktree | manual>
- Delegation boundary: <current-session | child-subagent | separate-local-session | child-worktree | human-handoff>
- Model / runtime: <freeform identifier>
- Review: self-review | human-review-requested | human-reviewed
- Workflow profile: bounded | standard | high-assurance
- Merge owner: human/operator | auto-merge-requested:`gh pr merge --squash --delete-branch --auto`
- Fallback chain: none | original agent -> backup agent
- Regression test: added | not-applicable:<reason> <!-- required for bug fixes; omit for non-bug PRs -->
- Mode: single-agent | multi-agent <!-- multiAgentClaim; "multi-agent" requires >=2 distinct role intelligences in the Role attribution matrix above, verified by scripts/validate-pr-manifest.mjs -->
- Self-review disclosure: not-applicable | <rationale for developer and review sharing the same intelligence> <!-- required when the Role attribution matrix's developer and review rows share the same Actual agent -->

## Follow-up issues

- none
