# Agent Workflow

This document defines the target operating model for this project's agentic development workflow.
It complements `AGENTS.md` by making the workflow state machine, role-pass contract, branch
strategy, and PR manifest rules explicit and machine-checkable.

## 1. Operating principles

- **Single-agent execution by default.** The normal path is one executor working end to end.
- **Multi-role, phase-driven delivery.** The single agent switches roles through formal passes.
- **Machine-checkable evidence.** Every pass records what it read, decided, and hands off.
- **Review-focused PRs.** Implementation PRs contain product/code/docs changes; generated workflow
  run files stay local so review remains focused.
- **GitHub-centric durable state.** Issues, workflow-status comments, PR bodies, commits, and
  closure metadata are the durable source of truth for delivery state.
- **Continue unless blocked.** Ordered child issues on a workstream continue automatically until a
  gate fails, scope changes, or human input is required.
- **JTBD for product management.** Product framing is grounded in the job-to-be-done.
- **Spec-driven analysis.** Analyst work refines the issue into testable acceptance criteria.
- **ADR-driven steering.** Architecture is constrained by the accepted ADR set.
- **Follow-up over drift.** Any out-of-scope finding becomes a follow-up issue, never a hidden TODO.

## 2. Decision context

The old rule — **one issue = one branch = one PR = one commit** — was deterministic, but too rigid
for related issue batches and autonomous delivery. The replacement is not a return to the old
multi-agent choreography. Instead, this project uses a **single-agent**, **multi-role** workflow with
explicit state, explicit artifacts, and explicit handoffs.

Multi-agent delegation remains optional support for broad discovery, advisory review, or offline
parallel work. It is not the default implementation model.

## 3. Workflow phases

The orchestrator is a state machine. Each issue declares which phases apply and may skip only when
that skip is recorded with a reason.

| Phase | Role                   | Purpose                                                  | Required output |
| ----- | ---------------------- | -------------------------------------------------------- | --------------- |
| 0     | Product manager / JTBD | Optional feature framing and decomposition               | role-pass       |
| 1     | Analyst                | Refine issue into testable acceptance criteria           | role-pass       |
| 2     | Architect              | Select workflow profile and implementation approach      | role-pass       |
| 3     | Developer planning     | Confirm files, tests, docs, branch/PR expectations       | role-pass       |
| 4     | Developer              | Implement the agreed change                              | role-pass       |
| 5     | Tester                 | Execute verification and record evidence                 | role-pass       |
| 6     | Review                 | Self-review for bounded/standard or request human review | role-pass       |
| 7     | Tech writer            | Confirm technical/user docs and screenshot decisions     | role-pass       |
| 8     | PR readiness           | Confirm merge contract and closeout state                | role-pass       |

### Allowed transitions

- `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8`
- `1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8` for chores/bugs that do not need JTBD framing
- `4 -> 3` only when implementation reveals a planning defect
- `6 -> 4` only when review returns findings
- `7 -> 4` only when documentation changes require remediation
- `8 -> 4` only when PR-readiness finds a merge blocker

Any other transition is a workflow defect and must be logged in the workflow artifact.

## 4. Role-pass contract

Every pass must answer the same questions:

1. **What did I read?**
2. **What did I decide?**
3. **What remains uncertain?**
4. **What must the next role do?**

Each pass uses `agents/templates/role-pass.md`.

### Required fields

- Issue number and title
- Branch name
- Phase number and role
- Workflow profile
- Actual executor identity (`human | claude | codex | agy`)
- Model / runtime when known
- Inputs read
- Decisions / findings
- Open questions or `none`
- Next-phase contract
- Status: `pass | blocked | returned | skipped`
- Signed-by and timestamp

### Provenance

- `<agent>` is the AI identity actually executing this pass right now (`claude`, `codex`, `agy`, or
  `human`). Never copy `<agent>` from a prior pass, another issue, or a template example — record
  whichever agent is producing this specific pass.
- `<role>` is the phase/role being performed (`analyst`, `architect`, ..., `orchestrator`) and is
  independent of `<agent>`. The same agent performs every role in-session, but the signature still
  names both separately.
- The workflow-status comment's `**Implemented by:**` field must match the `<agent>` of the latest
  role-pass signature, or `human` when a human performed the latest pass.

## 5. Workflow evidence and local artifacts

Per issue, agents may keep local generated records under:

```text
.agent-runs/issues/<issue-number>/
  workflow.md
  pr-manifest.md
  passes/
    01-analyst.md
    02-architect.md
    03-developer-plan.md
    04-developer.md
    05-tester.md
    06-review.md
    07-techwriter.md
    08-pr-readiness.md
```

These files are **local execution artifacts**. They are gitignored and must not be committed in
normal implementation PRs. Their purpose is to help the active agent preserve context and produce
summaries.

Durable workflow evidence lives in GitHub:

- one signed workflow-status issue comment per addressed issue,
- the PR body's workflow evidence section,
- validation output summarized in the PR body/comment,
- follow-up issues for deferred work.

Rules:

- `workflow.md` is the local running ledger.
- `passes/` contains local role-pass notes for completed phases.
- `pr-manifest.md` is a local draft/source for the PR body.
- Before PR creation, summarize role-pass evidence into the issue workflow-status comment and PR body.
- Temporary scratch stays in `.agent-runs/scratch/`.

### Post-merge closeout

Complete every required role-pass phase for an issue — including a terminal `blocked` phase-6
status recording that high-assurance work awaits PR-stage human review — inside the same PR that
implements the issue, before that PR merges. Once the PR merges and GitHub closes the issue, do not
open a new commit or PR whose only purpose is to update workflow bookkeeping for that now-closed
issue. Record final completion via a signed edit to the issue's workflow-status comment only (see
`AGENTS.md` §15) — a comment edit, not a repository commit. Local `.agent-runs/` ledgers may be
updated for active-agent continuity, but they are never a requirement or a justification for opening
a new PR on their own.

Post-merge verification is explicit evidence, not an assumption. Record:

- merged PR number/URL
- merge commit
- closure result for every implemented issue
- closure result for the Epic too, when the PR intentionally included `Closes #<epic>`

## 6. Branch strategy

### Target model

Use short-lived workstream branches:

- `work/<theme>`
- `hotfix/<theme>`
- `spike/<theme>`

Examples:

- `work/customer-registry`
- `work/agent-workflow`
- `hotfix/tenant-guard-regression`
- `spike/route-optimization-research`

### Rules

- One coherent theme per branch
- Multiple related issues are allowed on the same branch
- Each commit must map to one issue
- One PR may close multiple related issues
- The PR must include a manifest and explicit `Closes #<issue>` lines
- Ordered child issues on the same workstream proceed in sequence without waiting for re-confirmation between children unless blocked
- A spike branch is never merged directly; promote the learning into a new `work/<theme>` issue

### Migration note

Phase 1 documented the target model.
Phase 2 updated hooks, scripts, and enforcement to allow the target workstream branches.
Existing branch patterns (`issue/*`, `wt/*`, `claude/*`) remain valid compatibility branches during
migration, but new work should prefer `work/<theme>` unless a branch is already in progress.

## 7. Commit and PR rules

### Issue-scoped commits

Each commit must map to one issue, even on a shared workstream branch.
Recommended footer:

```text
Refs: #497
Role-Pass: developer
```

### PR manifest

Every PR must include:

- implemented issues (`Closes #...`)
- related issues (`Refs #...`)
- workflow evidence summary from the issue workflow-status comment
- CI-equivalent validation status (`passed`, `not-run-with-reason`, or `expected-fail-with-follow-up`)
- agent review fields under `## Agent review`
- follow-up issues created during implementation

The PR body should mirror this structure explicitly: one `Closes #<issue>` line per implemented issue,
`Refs #<issue>` only for non-closing references, the actual implementing agent, and the model / runtime
used when known. Plain issue mentions are not sufficient for GitHub auto-closure.

If a PR implements the final remaining open child issues of an Epic, the PR body must also include
`Closes #<epic>` after the child closure lines. Do not add the Epic close line early while any child
issue is still open or intentionally deferred.

PR readiness is incomplete until the created PR is verified directly in GitHub for:

- PR number/URL
- target branch
- final body content
- required closure lines (`Closes` / `Refs`)
- required `## Agent review` fields
- GitHub check status

If any required GitHub check is expected to fail, the workflow-status comment must not claim `ready`.
Use a draft PR or a blocked/expected-fail state with concrete follow-up issues instead.

Use `agents/templates/pr-manifest.md` as a local draft template; copy the final manifest content into the PR body rather than committing the draft file.

## 8. Review model

- **Bounded**: self-review allowed
- **Standard**: self-review allowed, but it must be explicit and evidence-backed
- **High-assurance**: human security and acceptance review required. This review happens on the
  open PR before merge — implementation commits, pushes, and PR creation are never blocked on it.
  Only the merge and the phase-6 gate sign-off wait for the human reviewer on the now-open PR
  (`for-review:human`).

Review roles are read-only by default. If a review finds a defect, it returns the work to the
implementation phase instead of patching code inside the review pass.

Merged-PR closeout should happen in GitHub issue comments, PR metadata, and session evidence. Do not create new
tracked repository changes on already-closed issues solely to update workflow bookkeeping.

## 9. QA vs Automation Lifecycle

The QA process relies on a two-way collaboration between the deterministic `tester` role and the exploratory `qa-expert` role to eliminate rework and maximize coverage.

### Lifecycle Flow

1. **Implementation (Phase 4)**: The developer implements the feature.
2. **Deterministic Testing (Phase 5)**: The `tester` validates the specific Acceptance Criteria using Playwright and Vitest (the "Happy Path" and known edge cases). This creates the deterministic coverage baseline.
3. **Exploratory QA (Phase X)**: The `qa-expert` role takes over to run exploratory sessions using Vibium. The agent skips paths already covered in Phase 5 and focuses exclusively on negative paths, system quirks, and boundaries.
4. **Refinement**: Bugs found by `qa-expert` are converted to Level 1 child issues and fixed by a developer.
5. **Regression Automation (Phase 5)**: Fixed bugs are graduated by the `tester` into deterministic Playwright/Vitest tests. The `tester` uses the exploratory findings to harden the locators and timings of the entire test suite.

## 10. Epic workstreams and validation/docs closeout

### Epic child loop

For an Epic implemented on one workstream branch, run the session-start loop per child issue:

1. export that child to `SPEC.md`
2. validate `SPEC.md`
3. initialize/update local `.agent-runs/issues/<child>/...` notes when useful
4. execute the required phases for that child
5. commit/push the child issue work
6. advance directly to the next declared child issue unless blocked

### Validation/docs closeout child

When a child issue exists primarily to validate and document previously implemented work:

- prefer extending existing tests/assets over creating standalone screenshot-only files
- update screenshot manifests and matching MDX placeholders together
- record local E2E environment blockers explicitly when app/auth setup is missing
- do not stall the workstream when registration/manifest/docs verification still provides valid evidence

## 11. Follow-up handling

Use a follow-up issue whenever:

- a useful improvement is out of scope
- a review finds non-blocking work
- branch cleanup or operational hygiene needs later automation
- product, spec, or architecture decisions must be revisited separately

Do not leave TODO comments or silent omissions.

## 12. Phase 1 vs Phase 2 split

### Phase 1 — documentation and process

- Update `AGENTS.md`, role adapters, workflow skills, and templates
- Define the target branch strategy, state machine, and role-pass format
- Document migration from current issue branches to workstream branches

### Phase 2 — automation and enforcement

- Generate local workflow notes automatically (`scripts/ensure-workflow-artifacts.mjs`)
- Validate phase transitions where practical
- Update hooks to enforce the new branch strategy
- Validate PR manifests (`scripts/validate-pr-manifest.mjs`)
- Add merged-branch follow-up cleanup automation or deterministic guidance (`scripts/branch-cleanup-report.mjs`)
