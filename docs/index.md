# Framework documentation index

This index maps the main concepts, defaults, roles, skills/workflows, templates, hooks, validators, and configuration surfaces in `multi-agent-sdlc`.

## Start here

1. [`../README.md`](../README.md) — overview, assisted onboarding/update, installation, usage, prompts, and live examples.
2. [`assisted-onboarding.md`](assisted-onboarding.md) — agent-assisted setup for existing projects with explicit approval before changes.
3. [`assisted-update.md`](assisted-update.md) — agent-assisted update workflow for already-adopted projects using `agent-framework-lock.json`, `doctor`, `sync`, and `mark-merged`.
   [`deterministic-assisted-update.md`](deterministic-assisted-update.md) documents the proposed deterministic update-plan direction.
4. [`environment-tools.md`](environment-tools.md) — required, recommended, and optional tools compatible with `doctor-env`.
5. [`../AGENTS.md`](../AGENTS.md) — required first-read repository policy.
6. [`project-setup.md`](project-setup.md) — guided setup choices for agents, execution mode, routing, branch strategy, validation, bounded work, and skill provenance.
7. [`agent-workflow.md`](agent-workflow.md) — phase model, role-pass contract, durable evidence, branch strategy, review model, and PR readiness.
8. [`issue-standards.md`](issue-standards.md) — issue titles, labels, body update rules, and lifecycle metadata.
9. [`project-config.md`](project-config.md) — project-local `agent-workflow.config.json` contract.
10. [`execution-targets.md`](execution-targets.md) — `executionTarget`, `transport`, `launcher`, `executor`, and `delegationBoundary` concepts that disambiguate `with claude`/`with agy`/`with pi` requests.
    [`agent-workflow.md` §4a](agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode) extends this with `roleAlternationPlan`, `roleIntelligence`, `contextBoundary`, `independenceBoundary`, `roleAttributionMatrix`, `multiAgentClaim`, and `selfReviewDisclosure` — whether a multi-agent claim actually alternated SDLC roles across independent intelligences.
11. [`capabilities.md`](capabilities.md) — portable PLAN/WORKFLOW/LOOP/SUB-AGENTS capability vocabulary, resolution modes, evidence, and adapter links.
12. [`release-versioning.md`](release-versioning.md) — configurable release strategy, default `main.minor.fix`, release evidence, validators, and preview helpers.
13. [`default-skills.md`](default-skills.md) — default skills, recommended companion skills, upstream repositories, and CCPM-sourced skill surfaces.

## What it is

`multi-agent-sdlc` is an opinionated agent-assisted SDLC framework. It installs process guardrails around an existing project instead of creating a new app. The default model is a single agent moving through explicit roles; optional routing can hand a role to another supported agent CLI.

## Roles and phases

The default phase sequence is defined in [`agent-workflow.md`](agent-workflow.md):

| Phase | Role                   | Default purpose                                                  |
| ----- | ---------------------- | ---------------------------------------------------------------- |
| 0     | Product manager / JTBD | Optional framing and decomposition                               |
| 1     | Analyst                | Refine the issue into testable acceptance criteria               |
| 2     | Architect              | Select workflow profile and approach                             |
| 3     | Developer planning     | Confirm files, tests, docs, branch, and PR expectations          |
| 4     | Developer              | Implement the agreed change                                      |
| 5     | Tester                 | Run verification and record evidence                             |
| 6     | Review                 | Self-review or request human review depending on assurance level |
| 7     | Tech writer            | Confirm docs and screenshot decisions                            |
| 8     | PR readiness           | Confirm merge contract and closeout evidence                     |

Each phase writes a role-pass artifact based on [`../agents/templates/role-pass.md`](../agents/templates/role-pass.md). Local role-pass files live under `.agent-runs/` and are not committed; summaries are durable in GitHub issue comments and PR bodies.

Optional sidecar role:

- [`qa-expert`](agents/qa-expert.md) — exploratory QA outside the main deterministic sequence; complements the `tester` role by finding negative-path, boundary, and UX issues that later become deterministic regression coverage.

## Skills and workflows

| Workflow skill                                            | Use it for                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| [`orchestrate`](../agents/workflows/orchestrate/SKILL.md) | Running an issue end-to-end through the phase model                 |
| [`scan`](../agents/workflows/scan/SKILL.md)               | Broad-context architecture/security scans that feed review evidence |

The framework also supports locally managed skills/tooling in consuming projects. Install workflow skills using your agent/skill manager, then use the sync CLI for hooks, templates, docs, and validators. See [`default-skills.md`](default-skills.md) for upstream source and provenance notes.

## Defaults

| Area                  | Default                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Execution             | Single-agent role execution                                                                    |
| Multi-agent           | Optional, only when useful or when project routing selects another agent                       |
| Supported route slugs | `agy`, `codex`, `claude`, `pi`                                                                 |
| Evidence              | GitHub issue comments and PR bodies are durable; `.agent-runs/` is local scratch               |
| Handover              | Orchestrator-owned issue comments for role transitions                                         |
| Review                | Bounded/standard may self-review; high-assurance requires human review before merge            |
| PR creation           | Orchestration defaults to commit, push, and PR creation at the end                             |
| Merge                 | Human/operator merges by default; explicit auto-merge uses the standard `gh pr merge` command  |
| Follow-ups            | Create issues instead of hidden TODOs                                                          |
| Config                | Missing project config fails closed where safety-sensitive, otherwise uses documented defaults |

## Configuration

Project-specific settings live in root-level `agent-workflow.config.json` in the consuming project. Start with the guided checklist in [`project-setup.md`](project-setup.md), then use [`project-config.md`](project-config.md) for the complete field contract.

Main sections:

- `ciCommands` — commands copied into PR manifests as CI-equivalent validation.
- `bounded` — path and diff limits for bounded self-reviewable work.
- `branching` — trunk, integration, protected branch, PR target, and work branch rules.
- `capabilities` — optional policy for portable PLAN/WORKFLOW/LOOP/SUB-AGENTS behavior and fallbacks.
- `routing` — optional role owner/fallback table for `agy`, `codex`, `claude`, and `pi`.

Useful commands:

```bash
node scripts/validate-role-routing.mjs
node scripts/resolve-role-route.mjs --role developer --current claude --json
node scripts/validate-bounded.mjs --json
node scripts/resolve-capability.mjs --capability delegated-subagents --execution-target pi-subagent --json
node bin/cli.mjs doctor-env --json
```

## Routing and handovers

See [`agent-routing.md`](agent-routing.md).

Routing lets a project choose a core owner and fallback list for each role. The default remains single-agent execution when routing is absent or when the selected role owner is the active executor.

Handover comments use [`../agents/templates/handover-comment.md`](../agents/templates/handover-comment.md). They document phase-to-phase continuity, routing/fallback details, blockers, and the next-role contract.

An agent slug names who owns a role, not how it runs. See [`execution-targets.md`](execution-targets.md) for the `executionTarget`, `transport`, `launcher`, `executor`, and `delegationBoundary` vocabulary, and `scripts/resolve-execution-target.mjs` for resolving an ambiguous `with claude`/`with agy`/`with pi` request before launching work.

## Templates

| Template                                                                       | Purpose                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [`role-pass.md`](../agents/templates/role-pass.md)                             | Local phase evidence contract, including planned owner/context/independence boundary           |
| [`workflow-status-comment.md`](../agents/templates/workflow-status-comment.md) | Signed issue status comment, with a role attribution matrix when `Mode: multi-agent`           |
| [`handover-comment.md`](../agents/templates/handover-comment.md)               | Issue-visible role handover evidence, including planned/actual owner and independence boundary |
| [`pr-manifest.md`](../agents/templates/pr-manifest.md)                         | PR body structure, merge evidence, and role attribution matrix                                 |
| [`stack-conventions.md`](../agents/templates/stack-conventions.md)             | Seed-once project stack/domain checklist template                                              |

## Hooks and validators

| File                                                                                         | Purpose                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`../.github/hooks/check-issue-branch.mjs`](../.github/hooks/check-issue-branch.mjs)         | Blocks direct work on protected branches and invalid branch names                                                            |
| [`../.github/hooks/pre-commit`](../.github/hooks/pre-commit)                                 | Local commit guardrails                                                                                                      |
| [`../.github/hooks/pre-push`](../.github/hooks/pre-push)                                     | Blocks direct pushes to protected branches                                                                                   |
| [`../.github/hooks/session-status.mjs`](../.github/hooks/session-status.mjs)                 | Summarizes branch/spec/session state                                                                                         |
| [`../scripts/validate-spec.mjs`](../scripts/validate-spec.mjs)                               | Checks `SPEC.md` readiness                                                                                                   |
| [`../scripts/validate-bounded.mjs`](../scripts/validate-bounded.mjs)                         | Checks bounded-work eligibility                                                                                              |
| [`../scripts/validate-pr-manifest.mjs`](../scripts/validate-pr-manifest.mjs)                 | Checks PR body/manifest readiness                                                                                            |
| [`../scripts/ensure-workflow-artifacts.mjs`](../scripts/ensure-workflow-artifacts.mjs)       | Scaffolds local `.agent-runs/` issue files                                                                                   |
| [`../scripts/branch-cleanup-report.mjs`](../scripts/branch-cleanup-report.mjs)               | Reports merged branch cleanup candidates                                                                                     |
| [`../scripts/issue-markdown.mjs`](../scripts/issue-markdown.mjs)                             | Updates issue body sections deterministically                                                                                |
| [`../scripts/resolve-execution-target.mjs`](../scripts/resolve-execution-target.mjs)         | Resolves an ambiguous agent-brand mention or model id to a deterministic `executionTarget`, or fails requiring clarification |
| [`../scripts/resolve-capability.mjs`](../scripts/resolve-capability.mjs)                     | Resolves portable advanced capability requests for a selected execution target                                               |
| [`../scripts/validate-capability-evidence.mjs`](../scripts/validate-capability-evidence.mjs) | Checks role-pass/manifest capability evidence for required modes and LOOP/SUB-AGENTS guardrails                              |
| [`../scripts/validate-role-attribution.mjs`](../scripts/validate-role-attribution.mjs)       | Checks a `multiAgentClaim`'s role attribution matrix (also run automatically by `validate-pr-manifest.mjs`)                  |
| [`../scripts/validate-release-closeout.mjs`](../scripts/validate-release-closeout.mjs)       | Verifies a published GitHub Release/tag and user-facing release-note wording after release PR merge                          |

Repository self-checks:

```bash
pnpm test
pnpm test:workflow
pnpm format:check
node scripts/verify-hooks.mjs
```

## Distribution and sync

The CLI in [`../bin/cli.mjs`](../bin/cli.mjs) supports:

```bash
node bin/cli.mjs init --target /path/to/project
node bin/cli.mjs sync --target /path/to/project
node bin/cli.mjs doctor --target /path/to/project
node bin/cli.mjs update-prompt --target /path/to/project
node bin/cli.mjs mark-merged CLAUDE.md --target /path/to/project
```

The file list is maintained in [`../lib/framework-files.mjs`](../lib/framework-files.mjs). `init` installs framework files and seeds project-owned files once. `sync` updates only files that are unchanged since the last install/sync and seeds missing seed-once files without overwriting existing project-owned content. `update-prompt` prints the assisted update handoff for already-adopted projects before any writes occur. `mark-merged` records a hand-merged framework file as permanently project-managed so future syncs never fast-forward over local additions.

## Live example

This repository is a live example. Its issues and PRs show:

- feature/chore requests with acceptance criteria;
- workflow-status comments;
- handover comments;
- PR manifests with validation evidence;
- issue closure via explicit `Closes #...` lines;
- follow-up issues for deferred work.

Use the repository history as a reference when teaching another project how to adopt the framework.
