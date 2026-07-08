# multi-agent-sdlc

Opinionated SDLC framework for reusable agent-assisted delivery: role-based workflows with optional multi-agent coordination, PR/issue contracts, git hooks, validators, and locally managed skills/tooling for optimized project setup.

This repository is both the distributable framework and a live example of the workflow in use. Its own issues, workflow-status comments, handover comments, PR manifests, hooks, and validators demonstrate the intended operating model.

## What this is

`multi-agent-sdlc` is a **process layer** for software projects that use AI coding agents. It does not generate an application or dictate your tech stack. Instead, it installs a repeatable delivery system around your existing project:

- role-based phases from analysis through PR readiness;
- default single-agent execution with optional role routing to other agent CLIs;
- deterministic issue, branch, commit, and PR contracts;
- local hooks and validators that catch workflow drift early;
- reusable templates for role passes, workflow status, handovers, and PR bodies;
- project-local configuration for stack-specific commands, bounded work, routing, and conventions.

Use it when you want agent-assisted work to be reviewable, auditable, and easy to resume instead of being hidden in one chat session.

## Fastest path: assisted onboarding

Adding this to an existing project is easiest with the assisted onboarding guide. The assistant inspects existing instructions, validates tools read-only, asks you to choose agents and workflow defaults, proposes setup commands, and preserves project-specific conventions.

Copy this prompt into your agent:

```text
Use the multi-agent-sdlc assisted onboarding guide:
https://github.com/smota/multi-agent-sdlc/blob/main/docs/assisted-onboarding.md

Apply it to this existing project. First inspect existing agent instructions and project docs. Validate the environment read-only. Ask me to choose agents, execution mode, branch strategy, validation commands, and GitHub automation. Propose install/setup commands but do not execute them without explicit approval. Preserve or merge existing instructions instead of overwriting them.
```

Prefer command output? Print the same onboarding prompt locally:

```bash
node bin/cli.mjs onboarding-prompt --target /path/to/your-project
```

See [`docs/assisted-onboarding.md`](docs/assisted-onboarding.md) and [`docs/environment-tools.md`](docs/environment-tools.md). The environment guide documents required, recommended, and optional tools compatible with `doctor-env`.

## Who it is for

This framework is for teams or solo maintainers who want agentic development to be manageable, auditable, and easier to reason about:

- compliance-minded teams that need durable evidence for AI-assisted work;
- maintainers coordinating multiple agents, sessions, or contributors without losing context;
- engineers who want less cognitive burden from remembering every branch, PR, handover, and review rule;
- projects that need one consistent way to run issues with Claude, Codex, Agy, Pi, or humans;
- teams that want PRs to explain what happened, why it happened, what was validated, and what remains;
- organizations that need safe defaults for branch discipline, self-review, and high-assurance human review;
- projects that want optional multi-agent handoffs without ad hoc discovery or undocumented routing;
- teams that want reusable local skills/tooling synced across repositories.

## Why these choices

The framework is intentionally structured as a control system for agent-assisted delivery, not as ceremony for its own sake.

- **Roles reduce ambiguity.** Analyst, architect, developer, tester, reviewer, tech writer, and PR-readiness passes each have a small job. That keeps the agent from mixing product decisions, implementation, validation, and review into one opaque step.
- **Single-agent execution is the default.** One executor carrying context end to end reduces coordination overhead and avoids recreating a noisy multi-agent process for routine work.
- **Optional routing supports specialization.** Projects can route roles to `agy`, `codex`, `claude`, or `pi` when it helps, but owners, fallbacks, and handovers are documented so agent availability or quota issues do not turn into on-the-fly process design.
- **Multi-agent claims are evidenced, not assumed.** A run that claims multi-agent mode must show its SDLC roles actually alternated across independent intelligences — a role attribution matrix, not just one `Implemented by` field. See [`docs/agent-workflow.md` §4a](docs/agent-workflow.md#4a-role-alternation-and-attribution-multi-agent-mode).
- **Execution targets are explicit, not inferred from chat.** A bare `with claude`/`with agy`/`with pi` names who is being asked, not how the work runs (local CLI, provider API, subagent, or a separate session/worktree). See [`docs/execution-targets.md`](docs/execution-targets.md).
- **Locally managed skills reduce setup drift.** Workflow skills and tooling live with the project so agents do not have to rediscover commands, templates, or handoff rules on every run.
- **Issue comments and PR manifests support compliance.** Workflow-status comments, handover comments, and PR manifests create durable evidence that survives session loss and can be reviewed by humans later.
- **Hooks and validators reduce cognitive load.** Branch checks, manifest validation, bounded-work checks, and workflow verification let humans and agents rely on executable guardrails instead of memory.
- **Follow-up issues prevent hidden drift.** Non-blocking findings are tracked as issues rather than buried as TODOs or lost in chat context.

See [`docs/index.md`](docs/index.md) for the detailed map of roles, workflows, templates, hooks, validators, and defaults.

## What is included

| Area             | Files                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy           | `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `AGY.md`                                                                                                                                |
| Workflow docs    | `docs/agent-workflow.md`, `docs/issue-standards.md`, `docs/project-config.md`, `docs/agent-routing.md`, `docs/execution-targets.md`, `docs/index.md`                          |
| Onboarding docs  | `docs/assisted-onboarding.md`, `docs/environment-tools.md`, `docs/project-setup.md`, `docs/default-skills.md`                                                                 |
| Skills/workflows | `agents/workflows/orchestrate/SKILL.md`, `agents/workflows/scan/SKILL.md`                                                                                                     |
| Templates        | `agents/templates/role-pass.md`, `pr-manifest.md`, `workflow-status-comment.md`, `handover-comment.md`, `stack-conventions.md`                                                |
| Hooks            | `.github/hooks/*` branch checks, session status, commit readiness, formatting support                                                                                         |
| Validators       | `scripts/validate-spec.mjs`, `validate-bounded.mjs`, `validate-pr-manifest.mjs`, `validate-role-routing.mjs`, `validate-role-attribution.mjs`, `resolve-execution-target.mjs` |
| Distribution     | `bin/cli.mjs`, `lib/install.mjs`, `lib/framework-files.mjs`, `agent-framework-lock.json` in consuming repos                                                                   |

## Defaults

- **Execution:** single-agent by default.
- **Roles:** product/JTBD when needed, analyst, architect, developer planning, developer, tester, review, tech writer, PR readiness.
- **Routing:** optional; projects may route roles to `agy`, `codex`, `claude`, or `pi` with fallbacks.
- **Execution targets:** deterministic per agent (`claude-cli`/`anthropic-api`, `agy-cli`/`agy-session`, `pi-parent`/`pi-subagent`/`pi-session`/`pi-subagent-model`, `codex-cli`/`provider-api`); ambiguous requests resolve from project config or require a clarifying question, never silent inheritance.
- **Evidence:** GitHub issue comments and PR bodies are durable; `.agent-runs/` files are local scratch and are not committed.
- **Review:** bounded/standard work may use explicit self-review; high-assurance work requires human review before merge.
- **Branching:** use the project branch strategy from `docs/agent-workflow.md` and `agent-workflow.config.json`; do not edit protected integration/trunk branches directly.
- **Follow-ups:** create follow-up issues instead of hidden TODOs or silent omissions.

## Contribute

This is the canonical contributor entry point for this repository. It is for both human contributors and agent contributors. It summarizes the expected path, but it is not the policy authority. Before doing issue work, architecture proposals, file writes, commits, PR readiness, or gate decisions, follow the reading order in [`AGENTS.md`](AGENTS.md): repository policy, the active adapter (`CLAUDE.md`, `CODEX.md`, `AGY.md`, or equivalent), [`docs/agent-workflow.md`](docs/agent-workflow.md), [`docs/issue-standards.md`](docs/issue-standards.md), then the active issue or `SPEC.md`.

### Required principles

- **Issue-first work:** start from a GitHub issue or explicit maintainer direction. If the work needs a new issue, use the title and label rules in [`docs/issue-standards.md`](docs/issue-standards.md).
- **Deterministic phases:** run the workflow phases that apply, record role-pass evidence, and keep durable state in GitHub issue comments, PR bodies, commits, and closure metadata.
- **Bounded branches:** do implementation work on a short-lived work branch allowed by [`docs/agent-workflow.md`](docs/agent-workflow.md) and `agent-workflow.config.json`; do not edit protected integration or trunk branches directly.
- **Evidence-backed validation:** every contribution names the commands or manual checks used to verify it, or explains why a check was not applicable.
- **Follow-ups over drift:** useful out-of-scope findings become follow-up issues instead of hidden TODOs, silent omissions, or unapproved scope expansion.
- **Safety:** never include secrets, credentials, tokens, or private local-only data in issues, PRs, commits, workflow evidence, or handover comments.
- **Human and agent parity:** humans and agents use the same public contribution contract; agent-specific evidence requirements are linked from this section rather than duplicated here.

### Contributor workflow

1. **Choose or open an issue.** Confirm the issue has a valid Conventional Commit title, a primary type/domain label, and `drafted-by:<agent>` when an agent drafted it. For new issues, include acceptance criteria, a test plan or validation plan, open questions, and workflow classification.
2. **Plan the work.** Read the required policy documents, classify the workflow profile, identify files likely to change, and decide which checks will prove the change. Use [`docs/project-config.md`](docs/project-config.md) and `agent-workflow.config.json` for project-specific branch, validation, routing, and bounded-work rules.
3. **Create a work branch.** Prefer `work/<theme>`, `feature/<theme>`, `fix/<theme>`, `hotfix/<theme>`, or `spike/<theme>` unless project configuration says otherwise.
4. **Implement narrowly.** Keep commits issue-scoped. Do not rewrite governance, templates, or unrelated docs unless the issue explicitly includes that scope.
5. **Validate.** Run the relevant repository checks, such as `pnpm test`, `pnpm test:workflow`, `pnpm format:check`, `node scripts/validate-role-routing.mjs`, or a focused validator named by the issue. Record exact commands and outcomes.
6. **Open the PR.** Use [`agents/templates/pr-manifest.md`](agents/templates/pr-manifest.md). For PRs into an integration branch, use `Implements #<issue>` lines; for PRs into default/trunk when GitHub should auto-close the issue, use `Closes #<issue>`. Include workflow evidence, validation status, agent review fields, merge owner, and follow-up issue status.

### Template and checklist decisions

The canonical `Contribute` section uses existing workflow templates instead of creating new contributor templates here:

| Contributor need                           | Decision         | Source                                                                                                                                         |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| New contributor quickstart checklist       | `include-inline` | `README.md#contribute`                                                                                                                         |
| Issue selection / issue creation checklist | `link-existing`  | [`docs/issue-standards.md`](docs/issue-standards.md)                                                                                           |
| Branch naming checklist                    | `link-existing`  | [`docs/agent-workflow.md`](docs/agent-workflow.md), `agent-workflow.config.json`                                                               |
| PR body checklist                          | `link-existing`  | [`agents/templates/pr-manifest.md`](agents/templates/pr-manifest.md), PR readiness rules in [`docs/agent-workflow.md`](docs/agent-workflow.md) |
| Validation evidence checklist              | `include-inline` | contributor workflow step 5                                                                                                                    |
| Follow-up issue checklist                  | `include-inline` | required principles and contributor workflow                                                                                                   |

### Quick checklist

- [ ] I have an issue or explicit maintainer direction.
- [ ] I read `AGENTS.md`, the active adapter, workflow docs, issue standards, and the active issue/spec.
- [ ] I am on an allowed work branch, not a protected integration/trunk branch.
- [ ] My change is scoped to the issue and records follow-ups for anything outside scope.
- [ ] I ran the relevant validation commands or documented why they were not applicable.
- [ ] My PR body uses the project manifest, the correct issue reference keyword, workflow evidence, validation evidence, agent review fields, merge owner, and follow-up status.

## Install / initialize in a project

### 1. Add skills/tooling

Install the skill-shaped workflow content using your preferred skill mechanism. For example, when using a skill installer:

```bash
npx skills add https://github.com/smota/multi-agent-sdlc
```

This makes the workflow skills available to supported agents. The exact destination depends on the consuming agent/tooling setup.

### 2. Install framework files

From a checkout of this repository, initialize another project:

```bash
git clone https://github.com/smota/multi-agent-sdlc.git
cd multi-agent-sdlc
pnpm install
node bin/cli.mjs init --target /path/to/your-project
```

`init` installs framework-owned files and seeds project-owned starter files such as `AGENTS.md` and `docs/stack-conventions.md` once.

### 3. Commit the lockfile in the consuming project

```bash
cd /path/to/your-project
git add agent-framework-lock.json AGENTS.md docs/stack-conventions.md
git commit -m "chore: initialize agent SDLC framework"
```

The lockfile lets future syncs update unmodified framework files safely.

### 4. Configure your project

Create or update `agent-workflow.config.json` in the consuming project. Start with CI commands and bounded-work settings:

```json
{
  "ciCommands": ["pnpm lint", "pnpm test", "pnpm build"],
  "bounded": {
    "allowedExactPaths": ["README.md"],
    "allowedPathPrefixes": ["docs/", "src/"],
    "deniedPathFragments": ["/auth/", "/billing/", "/migrations/"]
  }
}
```

See [`docs/project-setup.md`](docs/project-setup.md) for a guided setup checklist and [`docs/project-config.md`](docs/project-config.md) for the complete configuration contract.

### 5. Choose project defaults

Before the first real issue, make these choices explicit:

1. enabled agents (`claude`, `codex`, `agy`, `pi`);
2. execution mode: keep the single-agent default or allow optional multi-agent role routing;
3. role owners and fallbacks when routing is enabled;
4. per-agent `defaultExecutionTarget` (e.g. `claude-cli` vs `anthropic-api`) so a bare `with <agent>` resolves deterministically — see [`docs/execution-targets.md`](docs/execution-targets.md);
5. branch strategy and protected branches;
6. CI-equivalent validation commands;
7. bounded-work and sensitive-path rules;
8. skill provenance and local overrides;
9. GitHub integration automation for closing issues when PRs merge to the integration branch;
10. release versioning strategy: default `main.minor.fix`, custom tag format, package version source, and approval expectations.

Use [`docs/project-setup.md`](docs/project-setup.md) for copyable examples, [`docs/default-skills.md`](docs/default-skills.md) for skill provenance, [`docs/release-versioning.md`](docs/release-versioning.md) for release choices, and the validators listed in those docs to check the setup. The installed GitHub workflow `.github/workflows/integration-lifecycle.yml` uses `scripts/integration-lifecycle.mjs` to comment, label, and close issues referenced with implementation/closure keywords such as `Implements #...` or `Closes #...` after a PR merges into the configured integration branch. Related references such as `Refs #...` are ignored by lifecycle automation.

Validate local tooling without installing anything:

```bash
node bin/cli.mjs doctor-env --target /path/to/your-project
node bin/cli.mjs doctor-env --target /path/to/your-project --json
```

`doctor-env` is read-only. It reports found/missing tools and proposes installation options, but it never runs install commands.

## Sync / update framework files

Run sync whenever this framework changes:

```bash
node /path/to/multi-agent-sdlc/bin/cli.mjs sync --target /path/to/your-project
```

Inspect drift without writing files:

```bash
node /path/to/multi-agent-sdlc/bin/cli.mjs doctor --target /path/to/your-project
```

`sync` updates framework files only when they are unchanged since the last install/sync. Local project edits are reported as conflicts instead of being overwritten. `sync` also seeds missing seed-once project files such as `AGENTS.md` and `docs/stack-conventions.md` without touching them after they exist.

If you hand-merge framework adapter content into a project-owned file at a framework path, do not register that file as a normal tracked hash. Mark it as permanently hand-merged instead:

```bash
node /path/to/multi-agent-sdlc/bin/cli.mjs mark-merged CLAUDE.md --target /path/to/your-project
```

Marked files show separately in `sync`/`doctor` output and are never fast-forwarded over local additions.

## Day-to-day usage

### 1. Create or choose an issue

Use the issue standards in [`docs/issue-standards.md`](docs/issue-standards.md). Agent-created issues should use the required type and lifecycle labels.

Prompt example:

```text
Create a feature request for adding CSV import validation. Include acceptance criteria, test plan, open questions, and workflow classification.
```

### 2. Start a work branch

Use the configured branch strategy. A common default is a short-lived work branch:

```bash
git checkout development
git checkout -b work/csv-import-validation
```

### 3. Run the orchestrator

Ask the agent to run the issue through the workflow:

```text
orchestrate #123
```

The orchestrator should:

1. read `AGENTS.md`, the adapter, workflow docs, and the issue;
2. classify the work;
3. execute the role phases;
4. write role-pass evidence locally;
5. post/update workflow-status and handover comments on the issue;
6. run validation;
7. prepare the PR manifest;
8. commit, push, and open a PR with explicit `Implements #123` lines for integration-branch PRs.

For multiple IDs in one request, such as `orchestrate #123 #124 #125`, the orchestrator processes
the IDs in order and opens the PR after the final requested issue is complete.

### 4. Review and merge the PR

The PR body should include workflow evidence, validation results, agent review fields, merge owner, and follow-up status. A human/operator merges by default. If you explicitly want auto-merge after checks pass, tell the orchestrator to use the standard command:

```bash
gh pr merge --squash --delete-branch --auto
```

For high-assurance work, open the PR first, then request human security/acceptance review before merge.

## Copy-paste prompt examples

### Product discovery and shaping

Brainstorm before creating issues:

```text
Brainstorm a feature for improving onboarding for first-time maintainers. Ask clarifying questions, identify the job-to-be-done, risks, non-goals, and likely acceptance criteria before opening any issues.
```

Turn an idea into a feature request:

```text
Turn this idea into a product-ready feature request: <idea>. Include user value, acceptance criteria, non-goals, open questions, and a suggested workflow classification.
```

Break a feature into an epic and child issues:

```text
Break this feature request into an epic and ordered child issues. Identify dependencies, parallelizable work, validation needs, and any high-assurance review gates.
```

Create GitHub issues with this project's standards:

```text
Create GitHub issues for this epic using our issue standards, labels, acceptance criteria, workflow classification, and test plans.
```

### Orchestration

Run one issue:

```text
orchestrate #123
```

Run multiple issues and open one final PR after the last ID:

```text
orchestrate #123 #124 #125 as one coherent workstream; defer PR creation until the final issue is complete.
```

Ask for PR readiness:

```text
Run PR readiness for #123. Verify the PR body, integration references, workflow evidence, validation status, handover comments, and GitHub checks.
```

### Optional scenarios

Run exploratory QA with the optional `qa-expert` sidecar role:

```text
Plan an exploratory QA session for #123 using the qa-expert role. Focus on negative paths and boundaries not covered by the deterministic tester phase. Record findings as linked issues and apply needs-test to bugs that require regression automation.
```

Run a focused scan before implementation:

```text
/scan "scan workflow scripts for branch-policy assumptions before implementation; summarize risks, affected files, and recommended follow-up issues"
```

Use configured routing only when it helps:

```text
Use the configured role routing for #123. If the selected owner is unavailable, record the fallback in the handover comment and continue with the configured fallback.
```

Stay single-agent unless delegation adds value:

```text
Keep this single-agent unless broad discovery or advisory review would materially reduce risk; if you delegate, validate the output before using it.
```

Create a follow-up instead of drifting scope:

```text
Create a follow-up issue for the non-blocking docs gap found during review. Include acceptance criteria and a test plan.
```

### Development integration and promotion

Close implementation tracking when work reaches the integration branch:

```text
After this PR merges to development, mark linked issues integrated and prepare a promotion summary for development -> main.
```

Create a promotion issue:

```text
Create a promotion issue for the current development branch: list integrated PRs, linked issues, validation needed before main, and release notes.
```

## Live example: this repository

This repository uses its own process. Look at its GitHub issues and PRs for examples of:

- feature requests with acceptance criteria and test plans;
- workflow-status comments on issues;
- role handover comments;
- PR manifests with `Closes #...` lines;
- validation evidence such as `pnpm test`, `pnpm test:workflow`, and `pnpm format:check`;
- follow-up issues for deferred work.

Because the framework is developed using itself, the repo is the best live reference for expected behavior.

## Documentation map

Start with [`docs/index.md`](docs/index.md) for the full documentation index.

Key references:

- [`AGENTS.md`](AGENTS.md) — repository policy authority
- [`docs/agent-workflow.md`](docs/agent-workflow.md) — phases, role-pass contract, evidence, branch and PR rules
- [`docs/issue-standards.md`](docs/issue-standards.md) — issue titles, labels, and issue body updates
- [`docs/project-setup.md`](docs/project-setup.md) — guided project choices for agents, mode, branches, validation, and bounded work
- [`docs/project-config.md`](docs/project-config.md) — `agent-workflow.config.json`
- [`docs/default-skills.md`](docs/default-skills.md) — default skills, upstream sources, and provenance notes
- [`docs/agent-routing.md`](docs/agent-routing.md) — optional role routing and handovers
- [`agents/workflows/orchestrate/SKILL.md`](agents/workflows/orchestrate/SKILL.md) — orchestrator workflow
- [`agents/workflows/scan/SKILL.md`](agents/workflows/scan/SKILL.md) — advisory scan workflow

## Common mistakes

- **Starting without `AGENTS.md`:** stop and restore/document policy authority first.
- **Committing `.agent-runs/`:** these are local scratch artifacts and should stay uncommitted.
- **Opening a PR with only `Closes #123`:** use the PR manifest structure.
- **Skipping handover comments:** role transitions need issue-visible handover evidence.
- **Treating routing as required:** routing is optional; single-agent execution is the default.
- **Claiming multi-agent mode without a role attribution matrix:** `Mode: multi-agent` with only one role intelligence, or with developer/review sharing an intelligence and no self-review disclosure, fails `validate-pr-manifest.mjs`.
- **Leaving TODOs in code/docs:** create follow-up issues instead.

## Verifying this repository

```bash
pnpm install
pnpm test
pnpm test:workflow
pnpm format:check
```

Additional checks:

```bash
node scripts/verify-hooks.mjs
node scripts/validate-role-routing.mjs
node scripts/validate-pr-manifest.mjs --path .agent-runs/issues/<issue>/pr-manifest.md
```
