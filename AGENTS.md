# AGENTS.md — Repository Policy

This file is the required first-read policy document for agents working in this repository or in a consuming project initialized from this framework. Adapter files (`CLAUDE.md`, `CODEX.md`, `AGY.md`) are entry points for specific agent CLIs; this file is the shared authority they must defer to.

If this file is missing in a consuming checkout, stop before implementation or gate decisions and create a process follow-up unless the active issue is specifically restoring this file. Do not silently substitute another document as the single source of truth.

## Required reading order

Before issue work, architecture proposals, file writes, commits, or gate decisions, read:

1. `AGENTS.md`
2. the active adapter file for the current executor (`CLAUDE.md`, `CODEX.md`, `AGY.md`, or equivalent)
3. `docs/agent-workflow.md`
4. `docs/issue-standards.md`
5. the active issue or `SPEC.md`

## Operating model

- Single-agent execution is the default.
- Work proceeds through role-based phases defined in `docs/agent-workflow.md`.
- Optional multi-agent support is allowed only when it adds clear value or project routing selects another executor.
- An agent slug (`claude`, `codex`, `agy`, `pi`, `human`) names who is asked to work, not how the
  work runs. Resolve the execution target (`claude-cli` vs `anthropic-api`, `agy-cli` vs
  `agy-session`, `pi-parent` vs `pi-subagent`/`pi-session`/`pi-subagent-model`, `codex-cli` vs
  `provider-api`) from project config or a clarifying question before launching work — never by
  inheriting the launcher's current model or provider. See `docs/execution-targets.md`.
- Every completed phase records role-pass evidence, including launcher, executor, transport, and
  delegation boundary as distinct fields.
- Durable workflow state lives in GitHub issue comments, PR bodies, commits, and closure metadata.
- Local `.agent-runs/` files are scratch execution artifacts and must not be committed.

## Issue and PR governance

- Follow `docs/issue-standards.md` for issue titles, labels, body updates, and lifecycle metadata.
- Prefer follow-up issues over hidden TODOs or scope drift.
- Every implementation PR must include explicit `Closes #<issue>` lines for implemented issues.
- PR bodies must include workflow evidence, CI-equivalent validation, agent review fields, and follow-up issue status.

## Branch discipline

- Use the branch strategy documented in `docs/agent-workflow.md` and project configuration.
- Do not make implementation edits directly on protected integration/trunk branches.
- Keep commits issue-scoped, even when a workstream branch closes multiple related issues.

## Review and safety

- Bounded and standard work may use explicit, evidence-backed self-review.
- High-assurance work requires human security and acceptance review on the open PR before merge.
- Review roles are read-only unless the work is explicitly returned to implementation.
- Never include secrets, credentials, tokens, or private local-only data in issues, PRs, role passes, or handover comments.

## Tooling and validation

- Run the relevant repository validators before PR readiness.
- If a required policy document, validator, or setup file is missing, record the blocker in the workflow evidence and create or reference a follow-up issue.
- Validate generated or delegated output before incorporating it into role passes, commits, issue comments, or PR narratives.
