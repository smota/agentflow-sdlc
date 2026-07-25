# Tools and actions contract

## Tool categories

| Category                   | Examples                                                                         | Authority                                                              | Boundary                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Read-only inspection       | file reads, search, `gh issue view`, validators in dry mode                      | Allowed during planning/review.                                        | Do not expose secrets in evidence.                                                        |
| File mutation              | edit/write source, docs, templates                                               | Requires issue-backed implementation or explicit maintainer direction. | Stay on allowed work branch; keep changes scoped.                                         |
| GitHub issue/PR operations | issue edit/create/comment, PR create/update                                      | Use `../../docs/issue-standards.md` and PR manifest rules.             | Preserve governance sections; use section-targeted updates when changing existing issues. |
| Validation scripts         | `validate-spec`, `validate-pr-manifest`, `validate-role-routing`, tests          | Run relevant checks before PR readiness.                               | Record exact command and result.                                                          |
| Capability resolution      | `resolve-execution-target`, `resolve-capability`, `validate-capability-evidence` | Required when advanced capabilities or routed agents are used.         | Stop or ask when required capability is unavailable.                                      |
| External integrations      | MCP, OpenAPI tools, provider APIs, local CLIs                                    | Use only when configured in consuming environment.                     | Never store credentials or private data in committed files/evidence.                      |

## Safe mutation rules

- Do not edit protected branches directly.
- Keep one writer per shared worktree.
- Review delegates are read-only unless work is explicitly returned to implementation.
- High-assurance gates require human review.
- Prefer follow-up issues over scope drift.
- Record rollback/audit notes for mutating GitHub or file operations when relevant.

## Fallbacks

| Missing capability/tool               | Fallback                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| GitHub CLI/API unavailable            | Prepare local markdown evidence and report blocker.                                     |
| Validator missing/failing to run      | Record command, error, and follow-up; do not claim passed.                              |
| MCP/OpenAPI unavailable               | Continue with local docs or stop if required for safety.                                |
| Native subagents unavailable          | Use parent-session work or manual handoff; record `optional-unavailable` when optional. |
| Required subagent/runtime unavailable | Stop and record blocker.                                                                |

## Schema note

This contract is table-based today. If AgentFlow adopts executable MCP/OpenAPI tool schemas later, those schemas must preserve this permission, fallback, confirmation, rollback, and audit model.
