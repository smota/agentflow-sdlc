# qa-expert optional role

`qa-expert` is an optional exploratory QA sidecar role. It is **not** part of the main deterministic SDLC phase sequence in [`../agent-workflow.md`](../agent-workflow.md). Use it when exploratory testing would add coverage beyond the deterministic `tester` phase.

## When to use it

Use `qa-expert` for:

- exploratory/manual QA sessions;
- negative-path and boundary testing;
- system quirks that deterministic tests may miss;
- validating UX flows after deterministic acceptance tests pass;
- finding bugs that should become follow-up issues.

Do not use it to replace the deterministic `tester` role. The `tester` role owns repeatable validation and regression automation.

## Default skill/tool

Default to Vibium for browser-based `qa-expert` sessions. Vibium is an opinionated default, but it is recommended here because it has been highly and happily validated for AI-assisted exploratory QA.

- Repository: <https://github.com/VibiumDev/vibium>
- Website/docs: <https://vibium.com>

Projects may override this default when they already have a stronger validated QA stack, but the override should be documented in project conventions and environment validation notes.

## Inputs

Before starting, read:

1. the issue or exploratory QA session issue;
2. acceptance criteria and test plan;
3. existing deterministic test evidence;
4. known constraints, credentials policy, and environment blockers.

## Outputs

A `qa-expert` session should produce durable GitHub evidence:

- tested areas and skipped areas;
- environment/setup blockers;
- findings with reproduction steps;
- linked child issues for bugs or improvements;
- `needs-test` on bug issues that require regression automation.

## Handoff loop

1. `tester` records deterministic validation coverage.
2. `qa-expert` explores uncovered negative paths, boundaries, and quirks.
3. Bugs found by `qa-expert` become child issues or follow-up issues.
4. Developer fixes the bug.
5. `tester` converts the finding into deterministic regression coverage and removes `needs-test` only after the regression test is committed and passing.

## Prompt example

```text
Plan an exploratory QA session for #123 using the qa-expert role and Vibium as the default browser QA skill/tool. Focus on negative paths and boundaries not covered by the deterministic tester phase. Record findings as linked issues and apply needs-test to bugs that require regression automation.
```
