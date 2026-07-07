# multi-agent-sdlc

A reusable multi-agent software development lifecycle framework: role-based single-agent phases,
branch discipline, PR/issue contracts, git hooks, and deterministic validators. Extracted from
[Ativaly](https://github.com/smota/ativaly) so the same process guardrails can be installed and
kept in sync across unrelated projects, without carrying any of Ativaly's application-specific
stack or domain rules along with it.

## What this is

A **process layer**, not an application template. It defines _how_ an AI coding agent (Claude,
Codex, Agy, or a human) works through an issue — phases, evidence, branch naming, PR contracts,
issue labeling — independent of what the target project actually builds.

See `docs/adr/` for the design decisions behind it, starting with
[ADR 001](docs/adr/001-role-based-single-agent-workflow.md).

## What's in here

| Path                                                            | Purpose                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/agent-workflow.md`                                        | The phase state machine, role-pass contract, branch strategy, PR manifest rules  |
| `docs/issue-standards.md`                                       | Issue title/label conventions                                                    |
| `docs/project-config.md`                                        | The `agent-workflow.config.json` contract consuming projects fill in             |
| `agents/workflows/orchestrate/SKILL.md`                         | The orchestrator skill — runs an issue end to end                                |
| `agents/workflows/scan/SKILL.md`                                | Broad-context architecture/security discovery skill                              |
| `agents/templates/`                                             | Role-pass, PR-manifest, workflow-status-comment, and stack-conventions templates |
| `agents/tools/registry.md`, `agents/evals/README.md`            | Tooling inventory and eval-framework scaffold                                    |
| `scripts/validate-spec.mjs`                                     | Validates a SPEC.md export is ready for implementation                           |
| `scripts/validate-bounded.mjs`                                  | Classifies a diff as Lane B (bounded) or not, config-driven                      |
| `scripts/validate-pr-manifest.mjs`                              | Validates a PR body against the canonical manifest contract                      |
| `scripts/ensure-workflow-artifacts.mjs`                         | Scaffolds local per-issue workflow notes                                         |
| `scripts/branch-cleanup-report.mjs`                             | Reports merged-branch cleanup candidates                                         |
| `scripts/issue-markdown.mjs`                                    | Pure markdown section-replace transform for issue body updates                   |
| `scripts/verify-hooks.mjs`, `scripts/verify-agent-workflow.mjs` | Self-verification of this framework's own mechanics                              |
| `.github/hooks/*`                                               | Git hooks: branch enforcement, prettier-on-write, session status                 |
| `.github/ISSUE_TEMPLATE/`, `.github/*template.md`               | Issue and PR body templates                                                      |
| `CLAUDE.md` / `CODEX.md` / `AGY.md`                             | Thin per-agent adapters pointing at a project's own `AGENTS.md`                  |

## What's deliberately _not_ in here

Anything that encodes a specific tech stack or business domain: TypeScript/framework rules,
security/multi-tenancy specifics, CI package matrices, role-persona domain checklists. Those live
in the consuming project's own `AGENTS.md` and `docs/stack-conventions.md` (copy the template at
`agents/templates/stack-conventions.md` to start one), which this framework's generic engines read
via `agent-workflow.config.json` — see `docs/project-config.md`.

## Consuming this framework in a project

Two channels, meant to be used together:

1. **`npx skills add <this-repo-url>`** — installs the skill-shaped content (workflow skills, role
   personas) into `.claude/skills/`, `.codex/skills/`, `.agy/skills/`, alongside any other skill
   sources a project already uses.
2. **The sync CLI** (`init` / `sync` / `doctor`) — installs and keeps in sync everything else
   (hooks, templates, generic validators, issue/PR templates). Not yet built — tracked as a
   follow-up in this repo.

Until the sync CLI exists, install manually: copy this repo's files into a target project
preserving their relative paths, then add `docs/stack-conventions.md` and
`agent-workflow.config.json` with that project's own values.

## Verifying this repo

```bash
pnpm install
node scripts/verify-hooks.mjs
node scripts/verify-agent-workflow.mjs
pnpm test
```
