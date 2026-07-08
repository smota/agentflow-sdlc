---
name: orchestrate
description: 'Workflow orchestrator. Runs issue work as a single-agent, phase-driven state machine with explicit local role-pass notes and GitHub-centric durable evidence.'
---

# /orchestrate

Run this issue end to end in-session as the default single-agent executor. Do not recreate the old
multi-agent workflow unless broad discovery, advisory review, or asynchronous support is genuinely
needed.

Read `AGENTS.md`, `docs/agent-workflow.md`, and the active issue or `SPEC.md` before starting. If
`AGENTS.md` is missing, stop before implementation or gate decisions unless the active issue is
specifically restoring that file.

## Invocation

```text
/orchestrate #<issue-number> [#<issue-number> ...]
```

## Before work

1. Confirm the issue is actionable.
2. Export `SPEC.md`, then validate it with `node scripts/validate-spec.mjs`.
3. If the raw issue export does not let the validator resolve the issue number, normalize `SPEC.md` into an explicit `# Issue #<number>: <title>` document and re-run validation.
4. Stop when open questions remain unresolved.
5. Confirm the active branch follows the configured branch strategy:
   `node scripts/resolve-branch-strategy.mjs --json`. Missing config defaults to
   `main -> staging -> development`, with edits only on feature/work branches and never directly on
   `development`.
6. Create or update the issue's signed workflow-status comment from `agents/templates/workflow-status-comment.md`.
7. Create local `.agent-runs/issues/<issue>/workflow.md` and `.agent-runs/issues/<issue>/passes/` notes before the first role-pass when useful. These files are gitignored and must be summarized into the workflow-status comment/PR body rather than committed.

## Classification

Record all three dimensions before implementation:

```json
{
  "issueNumber": 123,
  "profile": "bounded | standard | high-assurance",
  "risk": "low | medium | high",
  "effort": "low | medium | high",
  "changeSurface": ["docs | ui | service | api | data | infra | security"],
  "assessedAt": "YYYY-MM-DD"
}
```

Write metadata to `.agent-runs/scratch/<N>-task-metadata.json`.

## Phase model

Default sequence:

1. Analyst
2. Architect
3. Developer planning
4. Developer
5. Tester
6. Review
7. Tech writer
8. PR readiness

Optional phase:

- Product manager / JTBD, when feature shaping or decomposition is needed before analyst work

Each phase must:

- read the previous role-pass
- resolve configured role routing when `agent-workflow.config.json` has a `routing` section:
  `node scripts/resolve-role-route.mjs --role <role> --current <agent> --json`
- use the selected agent's documented call workflow when route resolution selects another agent
- post or update an orchestrator-owned ticket handover comment from
  `agents/templates/handover-comment.md` for every role transition, including same-agent
  single-agent transitions; include routing/fallback details for cross-agent transfer, fallback
  transfer, returned phase work, human decision/review requests, or ending a session before the next
  role can continue
- write a new local role-pass note using `agents/templates/role-pass.md`
- update local `workflow.md`
- update the workflow-status comment when the state meaningfully changes

## Required evidence

Every issue must leave evidence for:

1. Requirement and acceptance criteria
2. Architecture and risk assessment
3. Implementation and test plan
4. Implementation summary
5. Verification results
6. Security assessment
7. Acceptance decision
8. Documentation decision
9. PR-readiness decision

The selected profile changes who signs the evidence, not whether the evidence exists.

## Review policy

### Bounded

- low risk only
- reversible and deterministic
- self-review allowed

### Standard

- low or medium risk
- no high-assurance surface
- self-review allowed, but must be explicit and evidence-backed

### High-assurance

- any sensitive surface: auth, tenant isolation, RLS, schema, migration, billing, Stripe, secrets, production permissions, cross-tenant logic
- human security review required on the open PR before merge
- human acceptance review required on the open PR before merge
- do not sign your own high-assurance gate
- review happens at the PR stage: open the PR first, then request human review — implementation
  commits, pushes, and PR creation are never blocked on it (`docs/agent-workflow.md` §8)

## Branch and PR policy

During migration, both configured work branches and existing compatibility branches are operational.
Resolve the active branch policy from `agent-workflow.config.json` before creating a branch or PR.
This repository uses `development` as the default PR target and does not use `staging`; direct
implementation edits on protected branches such as `development` and `main` are denied by default.
Project overrides are documented in `docs/project-config.md`.

Every orchestration call defaults to ending with committed work, a pushed branch, and an opened PR.
For multiple issue IDs in one invocation, process them in order and defer PR creation until the final
requested issue is complete; open one coherent final PR with one `Implements #...` line per
implemented issue when targeting the integration branch.

Every PR must:

- include explicit `Implements #<issue>` lines for PRs targeting the configured integration branch, or `Closes #<issue>` lines only for PRs targeting the repository default/trunk branch
- include `Closes #<epic>` only when this PR targets the default/trunk branch and completes the final remaining open child issues of that Epic
- include a PR manifest/evidence section using `agents/templates/pr-manifest.md`. **CRITICAL**: When executing `gh pr create`, you MUST use `--body-file` or populate the body with the full structure from this template. Do NOT just use `--body "Closes #<issue>"`.
- pass `node scripts/validate-pr-manifest.mjs --path <local-manifest-draft>` when using a local draft
- include a CI-equivalent validation decision: `passed`, `not-run-with-reason`, or `expected-fail-with-follow-up`
- summarize workflow evidence from the workflow-status comment
- cite the orchestrator-owned ticket handover comment/thread for role transitions, or explicitly
  document the exception when no role transition occurred
- record follow-up issues when non-blocking findings are deferred
- complete every required role-pass phase for the issue — including a terminal `blocked` phase-6
  for high-assurance work awaiting PR-stage review — before this PR merges (post-merge closeout,
  `docs/agent-workflow.md` §5)
- verify the created PR directly in GitHub (number, target branch, final body, closure lines, workflow-status and handover evidence links, and check status) before calling PR readiness complete
- record merge ownership: human/operator merges by default; do not merge unless explicitly instructed
- when explicit auto-merge is requested, use `gh pr merge --squash --delete-branch --auto`
- do not mark workflow status as `ready` when required GitHub checks are expected to fail; use draft PR or blocked/expected-fail status with follow-up issues instead

## Known local-environment flakiness

On some local machines, `pnpm build` / `next build` / `nest build` intermittently fail with
`MODULE_NOT_FOUND` on freshly-extracted `node_modules/.pnpm/**` binaries (e.g. `next/dist/bin/next`
or an `@nestjs/cli` command file going missing seconds after `pnpm install` wrote them), with no
related code change and no reproduction in real CI. This matches antivirus/real-time-scanning
interference deleting or quarantining files right after extraction — observed on Windows.

If this happens:

1. Do not treat it as a code defect — `tsc --noEmit` passing cleanly is the reliable signal that
   the change itself is sound.
2. Try one `pnpm install --force` and retry the build immediately afterward.
3. If it recurs, do not loop indefinitely. Rely on `tsc --noEmit` + lint + the full test suite as
   CI-equivalent evidence, mark the PR's CI-equivalent validation `Status: passed` for those checks,
   and note the local build flake explicitly in the PR body's `Notes:` line rather than blocking on
   it — the real CI run in a clean container is the authoritative build signal.
4. If the machine's owner is present, ask before spending further cycles on it — it's an
   environment/tooling question, not something an agent can fix from inside the repo.

## Bug-issue regression gate (Phase 5 — Tester)

When the issue being orchestrated carries the `bug` type label:

1. **Before writing the fix**, write a failing test (`*.spec.ts` or `*.e2e.ts`) that reproduces the
   defect exactly. Commit it alone with a message like `test: failing regression for #<N>`.
2. **Then** implement the fix in a second commit. The test must pass after the fix commit.
3. If automated testing is not feasible for this specific bug (e.g. requires live email OTP),
   record the explicit reason in the Phase 5 role-pass and in the PR body under `## Agent review`.
4. Remove the `needs-test` label from the issue only after the regression test is committed and
   passing.
5. Do not proceed to Phase 6 (Review) until this gate is satisfied or documented as infeasible.

## Rules

1. Never skip a required phase silently.
2. Never start a phase without reading the previous pass.
3. Never omit role-pass evidence; local notes are allowed, but durable summaries must be in GitHub.
4. Never let review mutate code unless the request explicitly returns to implementation.
5. Never sign your own high-assurance security or acceptance gate.
6. Use multi-agent help only when it adds clear value.
7. Prefer a follow-up issue over scope drift.
8. Continue through ordered child issues on the same workstream until blocked; do not pause only to narrate progress.
9. For validation/docs closeout children, prefer extending existing tests/assets, verifying screenshot manifest ↔ MDX placeholder alignment, and recording environment-blocked E2E evidence explicitly when local app/auth setup is unavailable.
10. Record `<agent>` in every signature as the AI identity actually executing this pass — never
    copied from a prior pass or a template default (`docs/agent-workflow.md` §4).
11. After merge, verify closure in GitHub comments or session evidence; do not require tracked repository edits on already-closed issues solely for workflow bookkeeping.
12. Never commit `.agent-runs/` files or open a commit/PR whose only purpose is workflow bookkeeping for an already-closed issue (`docs/agent-workflow.md` §5).
13. Do not stop an orchestration run after local implementation when PR creation is possible; commit, push, open the PR, and verify it as the default terminal action.
14. Once an issue's PR merges and its GitHub issue is confirmed closed, prune that issue's
    phase-tracking tasks from the session task tracker before creating the next issue's phase
    tasks — do not leave a prior issue's stale `pending`/`in_progress` entries sitting alongside a
    new issue's tasks.
