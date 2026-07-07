## Implemented issues

- Closes #<issue>
- Closes #<epic> <!-- include only when this PR implements the final remaining open child issues of that Epic; list child issues first and the Epic last -->

## Related issues

- Refs #<issue>

## Workflow evidence

- Workflow-status comment: <GitHub issue comment URL or "to be posted before PR">
- Role-pass summary: <summarize completed phases and any blockers>
- Validation evidence: <commands and results>

## CI-equivalent validation

- Status: passed | not-run-with-reason | expected-fail-with-follow-up
- Commands: <list this project's lint/typecheck/test/build commands from its own CI config —
  see the project's CI-equivalent command list in its stack-conventions doc>
- Notes: <none, reason not run, or expected failure summary with follow-up issue>

## Agent review

- Implemented by: human | claude | codex | agy
- Model / runtime: <freeform identifier>
- Review: self-review | human-review-requested | human-reviewed
- Workflow profile: bounded | standard | high-assurance
- Fallback chain: none | original agent -> backup agent
- Regression test: added | not-applicable:<reason> <!-- required for bug fixes; omit for non-bug PRs -->

## Follow-up issues

- none
